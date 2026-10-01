// SPDX-License-Identifier: MIT
//
// Run with: node --test test/

import assert from "node:assert/strict";
import { test } from "node:test";

import snippet from "../snippet.js";

const CF = {
	city: "Austin",
	region: "Texas",
	regionCode: "TX",
	postalCode: "78701",
	metroCode: "635",
	country: "US",
	continent: "NA",
	latitude: 30.2672,
	longitude: -97.7431,
	timezone: "America/Chicago",
	asn: 13335,
	asOrganization: "CLOUDFLARENET",
	colo: "DFW",
	httpProtocol: "HTTP/2",
	httpVersion: "2",
	network: "IPN",
	tlsVersion: "TLSv1.3",
	tlsCipher: "AEAD-AES128-GCM-SHA256",
	tlsJa3Hash: "e7d705a3286e19ea42f587b344ee6865",
	clientTcpRtt: 12,
	ip: "203.0.113.7",
	botManagement: { score: 1, verifiedBots: [] },
};

const call = async (url, { cf = CF, headers = {}, method = "GET" } = {}) => {
	const request = new Request(url, { method, headers });
	request.cf = cf;
	return snippet.fetch(request);
};

test("bare path returns only the IP address, as text", async () => {
	const response = await call("https://ip.jasontally.com/");

	// The headers match what icanhazip.com sends for the same request.
	assert.equal(response.headers.get("content-type"), "text/plain");
	assert.equal(response.headers.get("access-control-allow-origin"), "*");
	assert.equal(response.headers.get("access-control-allow-methods"), "GET");
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.equal(await response.text(), "203.0.113.7\n");
});

test("the body is the IP address and one newline, the same as icanhazip.com", async () => {
	// icanhazip.com answers "50.88.174.31\n", which is 13 bytes.
	const response = await call("https://ip.jasontally.com/", {
		headers: { "CF-Connecting-IP": "50.88.174.31" },
	});
	const body = await response.text();

	assert.equal(body, "50.88.174.31\n");
	assert.equal(Buffer.byteLength(body), 13);
});

test("any other query string still returns only the IP address", async () => {
	// ?whoami=0 is another query string, not the whoami request.
	for (const search of ["?foo=bar", "?fmt=text", "?who", "?whoami=0", "?", "?a=1&b=2", "?Whoami"]) {
		const response = await call(`https://ip.jasontally.com/${search}`);
		assert.equal(await response.text(), "203.0.113.7\n", search);
	}
});

test("?whoami and /whoami both return the details page", async () => {
	for (const target of ["/?whoami", "/whoami", "/?whoami="]) {
		const response = await call(`https://ip.jasontally.com${target}`);
		assert.equal(
			response.headers.get("content-type"),
			"text/html; charset=utf-8",
			target,
		);
		assert.match(await response.text(), /<!DOCTYPE html>/, target);
	}
});

test("?whoami returns an HTML page with the request details", async () => {
	const response = await call("https://ip.jasontally.com/?whoami", {
		headers: { "CF-Connecting-IP": "203.0.113.7", "CF-Ray": "8a1b2c3d-DFW", "User-Agent": "curl/8.5.0" },
	});
	const body = await response.text();

	assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
	assert.match(body, /<!DOCTYPE html>/);
	assert.match(body, /203\.0\.113\.7/);
	assert.match(body, /CLOUDFLARENET/);
	assert.match(body, /DFW/);
	assert.match(body, /America\/Chicago/);
	// Headers must be keyed by name, not by list index.
	assert.match(body, /<th>Ray ID<\/th><td>8a1b2c3d-DFW<\/td>/);
	assert.match(body, /<th>User agent<\/th><td>curl\/8\.5\.0<\/td>/);
	assert.doesNotMatch(body, /&quot;0&quot;: \[/);
	// The map link must be a real anchor, not escaped text.
	assert.match(body, /<a href="https:\/\/www\.openstreetmap\.org\/\?mlat=30\.2672/);
	// The raw Cloudflare object is dumped, so new fields appear with no code change.
	assert.match(body, /&quot;botManagement&quot;/);
});

test("/whoami path returns the same HTML page", async () => {
	const response = await call("https://ip.jasontally.com/whoami");

	assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
	assert.match(await response.text(), /<!DOCTYPE html>/);
});

test("the IP comes from CF-Connecting-IP and falls back to request.cf", async () => {
	const fromHeader = await call("https://ip.jasontally.com/", {
		headers: { "CF-Connecting-IP": "198.51.100.9" },
	});
	assert.equal(await fromHeader.text(), "198.51.100.9\n");

	const fromCf = await call("https://ip.jasontally.com/", { cf: { ip: "2001:db8::1" } });
	assert.equal(await fromCf.text(), "2001:db8::1\n");

	const fromNeither = await call("https://ip.jasontally.com/", { cf: {} });
	assert.equal(await fromNeither.text(), "unknown\n");
});

test("IPv6 visitors are reported verbatim", async () => {
	const response = await call("https://ip.jasontally.com/", {
		headers: { "CF-Connecting-IP": "2001:db8:85a3::8a2e:370:7334" },
	});
	assert.equal(await response.text(), "2001:db8:85a3::8a2e:370:7334\n");
});

test("hostile header values cannot inject markup into the whoami page", async () => {
	const response = await call("https://ip.jasontally.com/?whoami", {
		headers: { "CF-Connecting-IP": '<script>alert("x")</script>' },
	});
	const body = await response.text();

	assert.ok(!body.includes("<script>"), "raw script tag must not survive");
	assert.match(body, /&lt;script&gt;/);
});
