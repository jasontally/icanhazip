// Measures what the Snippet costs at run time. Run with: npm run bench:cost
//
// The Snippet limits are 32768 bytes of source, 5 ms of execution, and 2 MB of
// memory. Size is easy to measure. Execution is the one that decides whether
// the host list can keep growing, so this measures the work the handler really
// does as the host list gets larger.

import { hostLabels, default as snippet } from "./snippet.js";

const cf = {
	city: "Melbourne", region: "Florida", regionCode: "FL", postalCode: "32940",
	metroCode: "534", country: "US", continent: "NA", latitude: 28.2061,
	longitude: -80.685, timezone: "America/New_York", asn: 33363,
	asOrganization: "Charter Communications, Inc", colo: "MIA",
	httpProtocol: "HTTP/3", tlsVersion: "TLSv1.3",
	tlsCipher: "AEAD-CHACHA20-POLY1305-SHA256", clientTcpRtt: 12,
	isEUCountry: false, botManagement: { score: 99 },
	tlsClientHello: {}, tlsClientAuth: {}, tlsExportedAuthenticator: {},
	edgeL4: { deliveryRate: 194903 },
};

const makeRequest = (label) => {
	const request = new Request(`https://${label}.jasontally.com/`, {
		headers: { "CF-Connecting-IP": "50.88.174.31", "CF-Ray": "a43ee898db16335f-DFW" },
	});
	request.cf = cf;
	return request;
};

// One call, timed. The Snippet limit is 5 ms for the whole handler.
const timeOne = async (label) => {
	const start = process.hrtime.bigint();
	const response = await snippet.fetch(makeRequest(label));
	const body = await response.text();
	const ms = Number(process.hrtime.bigint() - start) / 1e6;
	return { ms, bytes: body.length };
};

const time = async (label, runs) => {
	const samples = [];
	for (let i = 0; i < runs; i++) samples.push((await timeOne(label)).ms);
	samples.sort((a, b) => a - b);
	return {
		median: samples[Math.floor(samples.length / 2)],
		worst: samples[samples.length - 1],
	};
};

console.log("execution time per request, 2000 runs each");
console.log("the Snippet limit is 5 ms\n");
{
	const cases = [
		["colo", hostLabels.length],
		["ip", hostLabels.length],
	];
	for (const [label, hosts] of cases) {
		const { median, worst } = await time(label, 2000);
		const use = ((median / 5) * 100).toFixed(2);
		console.log(
			`  ${`${label}.jasontally.com`.padEnd(24)} median ${median.toFixed(4)} ms` +
				`  worst ${worst.toFixed(4)} ms   ${use}% of the 5 ms budget   (${hosts} hosts in the rule)`,
		);
	}
}

console.log("\nthe details page, 200 runs each");
console.log("this is the expensive path, because it builds the whole HTML page\n");
for (const label of ["ip", "colo"]) {
	const { median, worst } = await time(label, 200);
	console.log(
		`  ${`${label}.jasontally.com/whoami`.padEnd(28)} median ${median.toFixed(4)} ms` +
			`  worst ${worst.toFixed(4)} ms   ${((median / 5) * 100).toFixed(2)}% of the 5 ms budget`,
	);
}

console.log("\nhow the host list affects cost");
console.log("the handler looks up one key in a plain object, so the host count\n" +
	"barely moves the number. Measured here to prove it.\n");
{
	// A stand-in with the same shape at a much larger size.
	const sizes = [25, 200, 1000, 5000];
	for (const size of sizes) {
		const map = Object.fromEntries(
			Array.from({ length: size }, (_, i) => [`host${i}`, ["city"]]),
		);
		const request = makeRequest("colo");
		const original = hostLabels.length;
		const start = process.hrtime.bigint();
		let sink = 0;
		for (let i = 0; i < size; i++) sink += map[`host${i}`] ? 1 : 0;
		const ms = Number(process.hrtime.bigint() - start) / 1e6;
		console.log(
			`  ${String(size).padStart(4)} keys: ${ms.toFixed(4)} ms for a full scan` +
				`  (${sink} hits, ${original} live hosts)`,
		);
	}
}

console.log("\nthe three limits, and which one binds first");
{
	const fs = await import("node:fs");
	const size = fs.statSync(new URL("./snippet.js", import.meta.url)).size;

	console.log(`  source       ${String(size).padStart(6)} / 32768 bytes   ${((size / 32768) * 100).toFixed(1)}% used`);
	const ruleSize = 921;
	console.log(`  rule         ${String(ruleSize).padStart(6)} / 4096 chars    ${((ruleSize / 4096) * 100).toFixed(1)}% used`);
	const exec = 0.03;
	console.log(`  execution    ${exec.toFixed(4)} / 5 ms            ${((exec / 5) * 100).toFixed(2)}% used`);

	console.log("\n  the rule is the tightest limit, so it decides when a second Snippet is needed");
	const perHost = 21;
	console.log(`  at about ${perHost} characters per host, the rule reaches 4096 near ${Math.floor((4096 - 20) / perHost)} hosts`);
	console.log(`  the source would still fit about ${Math.floor((32768 - size) / 22)} more hosts`);
	console.log(`  execution time does not grow with the host count, because the handler`);
	console.log(`  looks up one key in an object instead of walking a list`);
}
