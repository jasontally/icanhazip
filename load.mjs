// Load test against the live zone. Run with: npm run load -- <profile> [maxCps]
//
// Only two profiles, both of which stay inside Cloudflare. The whois and
// weather profiles were removed on purpose: they drive stat.ripe.net and
// open-meteo.com, which are third parties with published daily ceilings and a
// request threshold for registration. Loading them with synthetic traffic
// spends someone else's quota and puts load on volunteer funded services, so
// this tool cannot reach them.
//
//   cf        Cloudflare metadata and new Date() only, no subrequest. Safe to
//             push until requests actually fail.
//   dns       cloudflare-dns.com, which is Cloudflare's own resolver, running
//             on the same network as the Snippet that calls it. No published
//             limit.
//   page      the HTML pages, served with no subrequest for a plain value.
//             Node fetch does not run JavaScript, so Leaflet and the OSM tiles
//             are never requested. This profile does not measure the tile path.
//
// The run ramps concurrency and reports throughput and latency at each step.
// A knee shows up as throughput flattening while p95 climbs.

import { setTimeout as sleep } from "node:timers/promises";

const PROFILES = {
	cf: ["ip", "colo", "city", "zip", "region", "country", "continent", "colo",
		"asn", "as", "http", "tls", "rtt", "ray", "bot", "metro", "eu",
		"lat", "lon", "geo", "latlong", "ver", "date", "time", "year", "month",
		"hour", "minute", "second", "epoch", "utc", "timezone", "tz", "st",
		"ip4", "ipv4", "v4", "ua", "state", "province", "cc", "countrycode",
		"zipcode", "postal", "postcode", "org", "proto", "useragent", "lang",
		"ja3", "ja4", "cipher", "dma", "edge", "isp", "asn"],
	dns: ["ptr", "hostname", "ns", "nameserver", "dns"],
	// A path, not a hostname, so it needs a host that answers on it. "whoami"
	// alone resolves to nothing and every request ENOTFOUNDs.
	page: ["ip/whoami", "map"],
};

const profile = process.argv[2] ?? "cf";
const maxCps = Number(process.argv[3] ?? 64);
const ZONE = process.env.CLOUDFLARE_ZONE_NAME ?? "jasontally.com";
// Shorten the run for the groups with a published daily ceiling, so a sweep
// stays under it. Override with RUN_MS and STEPS.
const RUN_MS = Number(process.env.RUN_MS ?? 4000);
const WARM_MS = Number(process.env.WARM_MS ?? 700);
const STEPS = (process.env.STEPS ?? "1,2,4,8,16,32,64,128,256")
	.split(",")
	.map(Number)
	.filter((n) => n <= maxCps);
if (STEPS.length === 0) STEPS.push(maxCps);

const hosts = PROFILES[profile];
if (!hosts) {
	console.error(`unknown profile "${profile}". One of: ${Object.keys(PROFILES).join(", ")}`);
	process.exit(1);
}

// One agent per concurrent request, so every socket is reused and keep-alive
// stops the measurement turning into a connect-storm test.
const hit = async (host, deadline, tally) => {
	// A profile entry may carry a path, for example "ip/whoami", where the
	// part before the slash is the hostname and the part after is the path.
	const [name, ...rest] = host.split("/");
	const path = rest.length > 0 ? `/${rest.join("/")}` : "/";
	const url = `https://${name}.${ZONE}${path}`;
	try {
		const response = await fetch(url, { headers: { "user-agent": "loadtest/1.0" } });
		await response.arrayBuffer();
		tally.status.set(response.status, (tally.status.get(response.status) ?? 0) + 1);
		if (response.status !== 200) {
			tally.errors.push(String(response.status));
			tally.serverStatus = true;
		}
	} catch (error) {
		// A rejected socket is the load generator running out, not the edge
		// refusing. Record the cause so the two are never confused.
		const cause = error.cause?.code ?? error.code ?? error.name ?? "error";
		tally.errors.push(cause);
		tally.kinds.set(cause, (tally.kinds.get(cause) ?? 0) + 1);
		tally.status.set("fail", (tally.status.get("fail") ?? 0) + 1);
	}
	if (Date.now() < deadline) await hit(host, deadline, tally);
};

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

const runStep = async (concurrency) => {
	const tally = { status: new Map(), errors: [], kinds: new Map() };
	const latencies = [];
	const deadline = Date.now() + RUN_MS;

	// Rotate hosts so one host cannot dominate the sample.
	let next = 0;
	const agents = Array.from({ length: concurrency }, async () => {
		while (Date.now() < deadline) {
			const host = hosts[next++ % hosts.length];
			const start = process.hrtime.bigint();
			await hit(host, 0, tally);
			latencies.push(Number(process.hrtime.bigint() - start) / 1e6);
			await sleep(5);
		}
	});
	await Promise.all(agents);

	const seconds = RUN_MS / 1000;
	const sorted = latencies.sort((a, b) => a - b);
	const done = (tally.status.get(200) ?? 0) + (tally.status.get("fail") ?? 0);
	const byStatus = [...tally.status.entries()].map(([k, v]) => `${k}:${v}`).join(" ");

	return {
		concurrency,
		rps: done / seconds,
		p50: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		p99: percentile(sorted, 0.99),
		max: sorted[sorted.length - 1],
		errors: tally.errors.length,
		kinds: tally.kinds,
		errorRate: tally.errors.length / Math.max(1, done),
		byStatus,
	};
};

console.log(`profile ${profile}: ${hosts.length} hosts`);
console.log(`${RUN_MS} ms per step, ${WARM_MS} ms warmup, 5 ms pause between requests\n`);

for (const host of hosts.slice(0, 2)) {
	try {
		await fetch(`https://${host}.${ZONE}/`, { headers: { "user-agent": "loadtest/1.0" } });
	} catch { /* reported by the step results */ }
}
await sleep(WARM_MS);

const head = "  cpus      rps    p50     p95     p99     max   err%  status";
console.log(head);
console.log("  " + "-".repeat(head.length - 2));

const results = [];
let best = { rps: 0, concurrency: 0 };
let knee = null;
let broken = null;
let previous = null;

for (const concurrency of STEPS) {
	const result = await runStep(concurrency);
	results.push(result);

	console.log(
		`  ${String(result.concurrency).padStart(4)} ${String(Math.round(result.rps)).padStart(7)}` +
			` ${result.p50.toFixed(1).padStart(6)} ${result.p95.toFixed(1).padStart(6)}` +
			` ${result.p99.toFixed(1).padStart(6)} ${result.max.toFixed(1).padStart(6)}` +
			` ${(result.errorRate * 100).toFixed(1).padStart(5)}  ${result.byStatus}`,
	);

	if (result.rps > best.rps) best = { rps: result.rps, concurrency };

	// A knee is throughput no longer keeping up while latency climbs.
	if (previous && !knee) {
		const throughputGained = result.rps - previous.rps;
		const latencyGrew = result.p95 / Math.max(0.1, previous.p95);
		if (latencyGrew > 1.8 && throughputGained < previous.rps * 0.25) {
			knee = {
				between: [previous.concurrency, result.concurrency],
				latencyGrew,
				throughputGained,
			};
		}
	}
	if (result.errors > 0 && !broken) broken = { concurrency: result.concurrency, ...result };
	previous = result;
	await sleep(1500); // let the edge settle before the next step
}

console.log();
console.log(`peak throughput: ${Math.round(best.rps)} req/s at ${best.concurrency} concurrent`);
if (knee) {
	console.log(
		`knee: p95 grew ${knee.latencyGrew.toFixed(1)}x between ${knee.between[0]} and ` +
			`${knee.between[1]} concurrent while throughput added ${Math.round(knee.throughputGained)} req/s`,
	);
} else {
	console.log("no knee: throughput kept climbing to the last step");
}
if (broken) {
	const kinds = [...broken.kinds.entries()].map(([k, v]) => `${k} x${v}`).join(", ");
	console.log(
		`first failures at ${broken.concurrency} concurrent: ` +
			`${(broken.errorRate * 100).toFixed(1)}% of requests  ${kinds}`,
	);
	if (!broken.serverStatus) {
		console.log(
			"  every response that arrived was a 200, so these are client side " +
				"sockets, not the edge rejecting anything",
		);
	}
} else {
	console.log("no failures: every step returned 200");
}
