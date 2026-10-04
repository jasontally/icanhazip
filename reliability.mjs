// Measures how dependable each host is, by asking each one many times.
//
//   node reliability.mjs [samples] [concurrency] [hosts]
//
// The fourth argument is a comma separated host filter, so one group can be
// measured on its own with more samples. "node reliability.mjs 40 6 prefix,bgp"
// gives the two BGP hosts forty samples each.
//
// Reliability here means three things a user can see:
//   - failures, where the host did not answer at all
//   - blanks, where it answered 200 with nothing, which is not useful
//   - churn, how many different answers it gave, which shows what varies
//
// Latency is measured too, because a name that is usually fast and sometimes
// very slow is unreliable in a way a blank is not.
//
// Rate limits. Open-Meteo allows 600 a minute, 5000 an hour, 10000 a day.
// RIPE RIS asks for fewer than 1000 a day and 8 at a time per address, and
// every subrequest here leaves from a Cloudflare edge, so all visitors share
// that budget. The default 12 samples over 102 hosts costs 12 calls to each
// weather host and 12 to each whois host, which is far inside both limits.
import { hostLabels } from "./snippet.js";

const ZONE = process.env.CLOUDFLARE_ZONE_NAME ?? "jasontally.com";
const SAMPLES = Number(process.argv[2] ?? 12);
const CONCURRENCY = Number(process.argv[3] ?? 8);
const FILTER = (process.argv[4] ?? "")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);

// Which upstream each group needs, read off the maps in snippet.js. Kept here
// rather than derived, because the grouping is a judgement about what can fail,
// not something the code states. Checked against hostLabels below, so a host
// cannot be added or renamed without this list following it.
const GROUPS = {
	"request.cf, no upstream": [
		"ip", "city", "zip", "postal", "country", "co", "region", "st",
		"state", "province", "continent", "timezone", "tz", "lat", "latitude",
		"lon", "longitude", "colo", "edge", "asn", "as", "isp", "http", "tls",
		"cipher", "rtt", "bot", "metro", "dma", "eu", "ray", "cc",
		"countrycode", "zipcode", "postcode", "org", "proto", "ua", "useragent",
		"lang",
	],
	"computed, no upstream": [
		"geo", "latlong", "latlon", "latlng", "utc", "ver", "ip4", "ipv4", "v4",
		"ip6", "ipv6", "v6", "date", "day", "time", "now", "today", "year",
		"month", "hour", "minute", "second", "epoch", "timestamp", "clock",
		"utcdate", "utctime",
	],
	"cloudflare-dns.com": ["ptr", "hostname", "ns", "nameserver", "dns"],
	"stat.ripe.net whois": ["net", "netname", "netblock", "range", "cidr"],
	"stat.ripe.net network-info": ["prefix", "bgp"],
	"api.open-meteo.com": [
		"temp", "tempc", "celsius", "tempf", "fahrenheit", "feels", "humidity",
		"wind", "clouds", "precip", "elevation", "elev", "sunrise", "sunset",
		"wmo", "weather",
	],
	"reads the request only": ["xff", "headers", "proxy", "proxies"],
	"page": ["map"],
};

const groupOf = new Map();
const duplicated = [];
for (const [group, labels] of Object.entries(GROUPS)) {
	for (const label of labels) {
		if (groupOf.has(label)) duplicated.push(label);
		groupOf.set(label, group);
	}
}
const ungrouped = hostLabels.filter((label) => !groupOf.has(label));
const invented = [...groupOf.keys()].filter((label) => !hostLabels.includes(label));
if (ungrouped.length > 0 || invented.length > 0 || duplicated.length > 0) {
	console.error("GROUPS is out of step with snippet.js");
	if (ungrouped.length) console.error(`  hosts with no group: ${ungrouped.join(", ")}`);
	if (invented.length) console.error(`  groups naming no host: ${invented.join(", ")}`);
	if (duplicated.length) console.error(`  in two groups: ${duplicated.join(", ")}`);
	process.exit(1);
}

// The group check below runs against the full list, so a filter cannot let a
// host slip out of its group unnoticed.
const targets = FILTER.length === 0
	? hostLabels
	: hostLabels.filter((label) => FILTER.includes(label));
if (targets.length === 0) {
	console.error(`no host matches ${FILTER.join(", ")}`);
	process.exit(1);
}

const samples = [];
for (let i = 0; i < SAMPLES; i += 1) samples.push(i);

const results = new Map(
	hostLabels.map((label) => [
		label,
		{ ok: 0, blank: 0, failed: 0, values: new Set(), ms: [], codes: new Set() },
	]),
);

const one = async (label, n) => {
	const bucket = results.get(label);
	const host = `${label}.${ZONE}`;
	// A cache buster, because a repeated GET may come from Cloudflare's cache
	// and would then measure the cache rather than the Snippet.
	const url = `https://${host}/?r=${n}-${Date.now()}`;
	const started = process.hrtime.bigint();
	try {
		const response = await fetch(url, {
			headers: { "user-agent": "icanhazip-reliability/1.0" },
			signal: AbortSignal.timeout(15000),
		});
		const ms = Number(process.hrtime.bigint() - started) / 1e6;
		const body = await response.text();
		bucket.ms.push(ms);
		bucket.codes.add(response.status);
		bucket.ok += 1;
		if (response.status === 200 && body.trim().length === 0) bucket.blank += 1;
		else bucket.values.add(body.trim().slice(0, 120));
	} catch (error) {
		bucket.failed += 1;
		bucket.codes.add(0);
		bucket.ms.push(Number(process.hrtime.bigint() - started) / 1e6);
	}
};

// A small queue, so concurrency stays flat and no host is hammered in a burst.
const queue = samples.flatMap((n) => targets.map((label) => [label, n]));
await Promise.all(
	Array.from({ length: CONCURRENCY }, async () => {
		for (;;) {
			const job = queue.shift();
			if (!job) return;
			await one(job[0], job[1]);
		}
	}),
);

const percentile = (values, p) => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

const rows = targets.map((label) => {
	const r = results.get(label);
	return {
		label,
		group: groupOf.get(label),
		failed: r.failed,
		blank: r.blank,
		distinct: r.values.size,
		p50: percentile(r.ms, 0.5),
		p95: percentile(r.ms, 0.95),
		max: r.ms.length === 0 ? 0 : Math.max(...r.ms),
		codes: [...r.codes].sort((a, b) => a - b),
	};
});

console.log(`${SAMPLES} samples per host, ${CONCURRENCY} at a time\n`);

// Worst first. A host that always fails or always answers nothing is the
// problem. A host with many distinct answers is interesting but not broken.
rows.sort((a, b) => {
	const score = (r) => r.failed / SAMPLES + r.blank / SAMPLES;
	return score(b) - score(a) || b.p95 - a.p95;
});

const pad = (text, width) => String(text).padEnd(width);
console.log(
	`${pad("host", 12)}${pad("group", 30)}${pad("fail", 6)}${pad("blank", 7)}` +
		`${pad("values", 8)}${pad("p50ms", 8)}${pad("p95ms", 8)}${pad("maxms", 8)}codes`,
);
console.log("-".repeat(104));
for (const row of rows) {
	console.log(
		`${pad(row.label, 12)}${pad(row.group, 30)}${pad(row.failed, 6)}` +
			`${pad(row.blank, 7)}${pad(row.distinct, 8)}${pad(row.p50.toFixed(0), 8)}` +
			`${pad(row.p95.toFixed(0), 8)}${pad(row.max.toFixed(0), 8)}${row.codes.join(",")}`,
	);
}

console.log("\nby group, mean failure rate and mean blank rate");
const byGroup = new Map();
for (const row of rows) {
	if (!byGroup.has(row.group)) byGroup.set(row.group, []);
	byGroup.get(row.group).push(row);
}
for (const [group, groupRows] of [...byGroup].sort()) {
	const fail =
		groupRows.reduce((sum, r) => sum + r.failed, 0) / (groupRows.length * SAMPLES);
	const blank =
		groupRows.reduce((sum, r) => sum + r.blank, 0) / (groupRows.length * SAMPLES);
	const p95 = groupRows.reduce((sum, r) => sum + r.p95, 0) / groupRows.length;
	// The worst single sample in the group, because a host that is usually
	// fast and occasionally very slow is unreliable in a way a mean hides.
	const worst = groupRows.reduce((sum, r) => Math.max(sum, r.max), 0);
	console.log(
		`  ${pad(group, 32)}${pad(groupRows.length + " hosts", 10)}` +
			`fail ${(fail * 100).toFixed(0)}%  blank ${(blank * 100).toFixed(0)}%  ` +
			`mean p95 ${p95.toFixed(0).padStart(5)} ms  worst ${worst.toFixed(0).padStart(6)} ms`,
	);
}

const clean = rows.filter((r) => r.failed === 0 && r.blank === 0).length;
console.log(
	`\n${clean} of ${rows.length} hosts answered every sample with a value.`,
);
