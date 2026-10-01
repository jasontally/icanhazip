// SPDX-License-Identifier: MIT
//
// Checks the main page against icanhazip.com. Run with: npm run bench
//
// The live part needs the network. The exit code is 1 if any check fails.

import { setTimeout as sleep } from "node:timers/promises";

import snippet, { hostLabels } from "./snippet.js";

const ORIGIN = "https://icanhazip.com";

// Headers that must match icanhazip.com. cache-control is a deliberate
// addition, so it is listed separately.
const MUST_MATCH = ["content-type", "access-control-allow-origin", "access-control-allow-methods"];

const callSnippet = async (path, ip) => {
	const request = new Request(`https://ip.jasontally.com${path}`, {
		headers: { "CF-Connecting-IP": ip, "user-agent": "icanhazip-bench/1.0" },
	});
	request.cf = { ip, colo: "DFW", country: "US", asn: 13335, asOrganization: "CLOUDFLARENET" };
	const response = await snippet.fetch(request);
	return {
		status: response.status,
		headers: response.headers,
		body: Buffer.from(await response.arrayBuffer()),
	};
};

let failures = 0;
const check = (ok, label, detail = "") => {
	if (!ok) failures++;
	console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

// The address icanhazip.com saw, so both bodies hold the same string and a
// byte comparison means something.
const live = await fetch(`${ORIGIN}/`, { headers: { "user-agent": "icanhazip-bench/1.0" } });
const liveBody = Buffer.from(await live.arrayBuffer());
const ip = liveBody.toString().trim();

console.log(`icanhazip.com returned ${JSON.stringify(liveBody.toString())} from ${live.status}\n`);

console.log("body bytes, same address on both sides");
{
	const mine = await callSnippet("/", ip);
	check(mine.body.equals(liveBody), "body equals icanhazip.com byte for byte",
		`${mine.body.length} bytes`);
	check(mine.body.at(-1) === 0x0a, "body ends in one newline");
	check(mine.body.subarray(0, -1).toString() === ip, "body is the address and nothing else");
	check(mine.status === 200, "status is 200", `got ${mine.status}`);
}

console.log("\nheaders the main page must match");
{
	const mine = await callSnippet("/", ip);
	for (const key of MUST_MATCH) {
		const a = live.headers.get(key);
		const b = mine.headers.get(key);
		check(a === b, key, a === b ? JSON.stringify(a) : `icanhazip ${JSON.stringify(a)} vs snippet ${JSON.stringify(b)}`);
	}
	check(mine.headers.get("cache-control") === "no-store",
		"cache-control is no-store", "(added on purpose, not sent by icanhazip.com)");
}

console.log("\npaths that must answer with the plain address");
{
	for (const path of ["/", "/foo", "/?foo=bar", "/?fmt=text", "/?whoami=0", "/ip"]) {
		const livePath = Buffer.from(
			await (await fetch(`${ORIGIN}${path}`, { headers: { "user-agent": "icanhazip-bench/1.0" } })).arrayBuffer(),
		);
		const mine = await callSnippet(path, ip);
		const shape = /^[0-9a-f.:]+\n$/i.test(mine.body.toString());
		check(shape, `${path} is an address and a newline only`,
			livePath.equals(mine.body) ? "same shape as icanhazip.com" : "same shape, different address");
		await sleep(150);
	}
}

console.log("\nsubdomains, checked against the live site");
{
	// Cloudflare sends these for every proxied request, so they must not be
	// empty. The rest may legitimately be empty: curl sends no Accept-Language,
	// Cloudflare sends no JA3 or JA4 for most requests, ip4 and ip6 are one
	// or the other, and a DNS host is empty when no record is published.
	const alwaysPresent = new Set([
		"ip", "city", "zip", "country", "region", "colo", "asn", "as", "http",
		"geo", "latlong", "latitude", "longitude", "ver", "utc", "st",
	]);

	for (const label of hostLabels) {
		if (label === "ip") continue;
		let live;
		try {
			live = await fetch(`https://${label}.jasontally.com/`, {
				headers: { "user-agent": "icanhazip-bench/1.0" },
			});
		} catch (error) {
			check(false, `${label}.jasontally.com`, `request failed: ${error.message}`);
			continue;
		}
		const body = await live.text();
		const oneLine = /^[\x20-\x7e]*\n$/.test(body);
		const filled = alwaysPresent.has(label) ? body.trim().length > 0 : true;
		check(
			live.status === 200 &&
				live.headers.get("content-type") === "text/plain" &&
				oneLine &&
				filled,
			`${label}.jasontally.com`,
			`${live.status} ${JSON.stringify(body.trim())}`,
		);
		await sleep(100);
	}
}

console.log("\ntiming, 5 samples each");
{
	const samples = async (run) => {
		const times = [];
		for (let i = 0; i < 5; i++) {
			const start = process.hrtime.bigint();
			await run();
			times.push(Number(process.hrtime.bigint() - start) / 1e6);
			await sleep(200);
		}
		return times.sort((a, b) => a - b);
	};
	const liveTimes = await samples(() => fetch(`${ORIGIN}/`));
	const mineTimes = await samples(() => callSnippet("/", ip));
	const median = (list) => list[Math.floor(list.length / 2)].toFixed(1);
	console.log(`  icanhazip.com, live round trip   median ${median(liveTimes)} ms`);
	console.log(`  snippet, JS handler only         median ${median(mineTimes)} ms`);
	console.log("  The two numbers are not comparable. The live number is a full network");
	console.log("  round trip. The snippet number is only the JavaScript, with no network");
	console.log("  and no Cloudflare edge. Measure the real end to end time after deploy.");
}

console.log(`\n${failures === 0 ? "all checks pass" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
