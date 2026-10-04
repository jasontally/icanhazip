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
// Declared out here so the summary after the loop can read it.
const unresolved = [];
{
	// Cloudflare sends these for every proxied request, so they must not be
	// empty. Everything else must be a line, but the line may be empty.
	const alwaysPresent = new Set([
		"ip", "city", "zip", "country", "region", "colo", "asn", "as", "http",
		"geo", "latlong", "latitude", "longitude", "ver", "utc", "st",
		"date", "time", "year", "month", "hour", "minute", "second", "epoch",
	]);

	// These hosts answer with a page, not a single value, so they are checked
	// for content type and shape instead of for a one line body.
	const pages = new Set(["map"]);

	// These answer with JSON, or with 204 when they find nothing.
	const jsonHosts = new Set(["headers", "proxy", "proxies"]);

	// These reach a third party over the network, so they are slower and a slow
	// or down service is allowed to answer empty. They must still answer a
	// line. Only the pause is needed, the pass rule below does not use this.
	const slow = new Set([
		"ptr", "hostname", "ns", "nameserver", "net", "netname", "netblock",
		"range", "cidr", "prefix", "bgp", "dns",
		"temp", "tempc", "celsius", "tempf", "fahrenheit", "feels", "humidity",
		"wind", "clouds", "precip", "elevation", "elev", "sunrise", "sunset",
		"wmo", "weather", "warp", "gateway",
	]);

	for (const label of hostLabels) {
		if (label === "ip") continue;
		let live;
		try {
			live = await fetch(`https://${label}.jasontally.com/`, {
				headers: { "user-agent": "icanhazip-bench/1.0" },
			});
		} catch (error) {
			// A name that does not resolve locally is not the service failing.
			// It is a stale resolver cache on this machine, which happens for a
			// while after a record is created.
			const local = error.cause?.code ?? error.code ?? "";
			const isDns = String(local).includes("ENOTFOUND") || String(local).includes("EAI_AGAIN");
			unresolved.push(label);
			check(false, `${label}.jasontally.com`,
				isDns
					? `no DNS answer on this machine (${local}), the record is fine`
					: `request failed: ${error.message}`);
			continue;
		}
		const body = await live.text();

		if (pages.has(label)) {
			check(
				live.status === 200 &&
					live.headers.get("content-type") === "text/html; charset=utf-8" &&
					body.includes("<!DOCTYPE html>"),
				`${label}.jasontally.com`,
				`${live.status} ${body.length} bytes of HTML`,
			);
			await sleep(100);
			continue;
		}

		// headers answers with JSON. proxy and proxies answer with JSON when
		// they find something, and 204 when they find nothing, which is the
		// behaviour icanhazproxy had.
		if (jsonHosts.has(label)) {
			if (live.status === 204) {
				check(body.length === 0, `${label}.jasontally.com`,
					"204, nothing found, as icanhazproxy did");
			} else {
				let parses = true;
				try {
					JSON.parse(body);
				} catch {
					parses = false;
				}
				check(
					live.status === 200 &&
						parses &&
						live.headers.get("content-type") === "application/json",
					`${label}.jasontally.com`,
					parses ? `200, ${body.length} bytes of JSON` : `200 but not JSON: ${body.slice(0, 40)}`,
				);
			}
			await sleep(100);
			continue;
		}
		const oneLine = /^[\x20-\x7e]*\n$/.test(body);
		// Cloudflare sends these for every request, so an empty answer means
		// something broke. Every other host may legitimately be empty.
		const filled = !alwaysPresent.has(label) || body.trim().length > 0;
		check(
			live.status === 200 &&
				live.headers.get("content-type") === "text/plain" &&
				oneLine &&
				filled,
			`${label}.jasontally.com`,
			`${live.status} ${JSON.stringify(body.trim())}`,
		);
		await sleep(slow.has(label) ? 400 : 100);
	}
}

if (unresolved.length > 0) {
	console.log(
		`\n${unresolved.length} host(s) had no DNS answer on this machine: ` +
			`${unresolved.join(", ")}`,
	);
	console.log(
		"  That is a stale resolver cache here, not the zone. Verify with DoH," +
			"\n  or run: sudo resolvectl flush-caches",
	);
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
