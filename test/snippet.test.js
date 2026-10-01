// SPDX-License-Identifier: MIT
//
// Run with: node --test test/

import assert from "node:assert/strict";
import { test } from "node:test";

import snippet, { hostLabels } from "../snippet.js";

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

test("the whoami page embeds a map with pinned Leaflet and a marker", async () => {
	const response = await call("https://ip.jasontally.com/whoami");
	const body = await response.text();

	assert.match(body, /<div id="map"/);
	assert.match(body, /leaflet@1\.9\.4\/dist\/leaflet\.js/);
	// Subresource Integrity must pin both files.
	assert.match(body, /leaflet\.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2\/Z9VM\+kNiyxNV1lvTlZBo="/);
	assert.match(body, /leaflet\.css" integrity="sha256-p4NxAoJBhIIN\+hmNHrzRCf9tD\/miZyoHS5obTRR9BMY="/);
	assert.match(body, /crossorigin=""/);
	// The coordinates reach Leaflet as numbers, not as strings from the CF object.
	assert.match(body, /setView\(\[30\.2672, -97\.7431\], 5\)/);
	assert.match(body, /circleMarker\(\[30\.2672, -97\.7431\]/);
	assert.match(body, /tile\.openstreetmap\.org/);
	assert.match(body, /OpenStreetMap contributors/);
});

test("the page warns that the map calls third parties, and offers a way out", async () => {
	const body = await (await call("https://ip.jasontally.com/whoami")).text();

	assert.match(body, /unpkg\.com and tile\.openstreetmap\.org/);
	assert.match(body, /id="no-map"/);
	assert.match(body, /where\.remove\(\)/);
});

test("no coordinates means no map and no Leaflet", async () => {
	const body = await (
		await call("https://ip.jasontally.com/whoami", { cf: { ...CF, latitude: undefined, longitude: undefined } })
	).text();

	assert.doesNotMatch(body, /leaflet/);
	assert.doesNotMatch(body, /<div id="map"/);
	assert.match(body, /&mdash;<\/span>/);
});

test("hostile coordinates cannot break out of the script block", async () => {
	const body = await (
		await call("https://ip.jasontally.com/whoami", {
			cf: { ...CF, latitude: "30.2);alert(1);//", longitude: "-97.7" },
		})
	).text();

	// Pull out the last inline script, which is the map code. The coordinates
	// may appear elsewhere as escaped text, which is fine.
	const script = body.slice(body.lastIndexOf("<script>"), body.lastIndexOf("</script>"));

	// Nothing from the coordinates may reach the script as code. Number()
	// drops the injected text, so Leaflet gets a real number or NaN.
	assert.doesNotMatch(script, /alert\(1\)/);
	assert.match(script, /setView\(\[NaN, -97\.7\], 5\)/);
	assert.match(script, /circleMarker\(\[NaN, -97\.7\]/);
	// The popup label is built from those numbers, so it cannot carry the text.
	assert.match(script, /\.bindPopup\("NaN, -97\.7"\)/);
});

const callHost = async (host, options) => call(`https://${host}.jasontally.com/`, options);

test("each subdomain answers with only that one value", async () => {
	const expected = {
		ip: "203.0.113.7",
		city: "Austin",
		zip: "78701",
		postal: "78701",
		country: "US",
		co: "US",
		region: "Texas",
		continent: "NA",
		timezone: "America/Chicago",
		tz: "America/Chicago",
		lat: "30.2672",
		lon: "-97.7431",
		colo: "DFW",
		edge: "DFW",
		asn: "13335",
		as: "CLOUDFLARENET",
		isp: "CLOUDFLARENET",
		http: "HTTP/2",
		tls: "TLSv1.3",
		cipher: "AEAD-AES128-GCM-SHA256",
		rtt: "12",
		metro: "635",
	};

	for (const [host, value] of Object.entries(expected)) {
		const response = await callHost(host);
		assert.equal(response.headers.get("content-type"), "text/plain", host);
		assert.equal(await response.text(), `${value}\n`, host);
	}
});

test("ray comes from the cf-ray header", async () => {
	const response = await callHost("ray", {
		headers: { "CF-Connecting-IP": "203.0.113.7", "CF-Ray": "8a1b2c3d4e5f6789-DFW" },
	});
	assert.equal(await response.text(), "8a1b2c3d4e5f6789-DFW\n");
});

test("bot and eu read nested and boolean values", async () => {
	assert.equal(await (await callHost("bot")).text(), "1\n");

	const euNo = await callHost("eu", { cf: { ...CF, isEUCountry: false } });
	assert.equal(await euNo.text(), "false\n");

	const euYes = await callHost("eu", { cf: { ...CF, isEUCountry: true } });
	assert.equal(await euYes.text(), "true\n");
});

test("region falls back to the region code when the long name is missing", async () => {
	const withName = await callHost("region", { cf: { ...CF, region: "Texas", regionCode: "TX" } });
	assert.equal(await withName.text(), "Texas\n");

	const codeOnly = await callHost("region", { cf: { ...CF, region: undefined, regionCode: "TX" } });
	assert.equal(await codeOnly.text(), "TX\n");
});

test("a subdomain with no data still answers with a line, not the page", async () => {
	const response = await callHost("city", { cf: {} });
	const body = await response.text();

	assert.equal(response.headers.get("content-type"), "text/plain");
	assert.doesNotMatch(body, /DOCTYPE/);
});

test("a subdomain keeps the whoami page for /whoami", async () => {
	const response = await call("https://colo.jasontally.com/whoami");
	assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
});

test("an unknown subdomain is not in the map and falls back to the IP", async () => {
	const response = await callHost("nosuchfield");
	assert.equal(await response.text(), "203.0.113.7\n");
});

test("a host outside jasontally.com is left to the rule, not handled here", async () => {
	const request = new Request("https://city.example.com/");
	request.cf = CF;
	const response = await snippet.fetch(request);
	assert.equal(await response.text(), "203.0.113.7\n");
});

test("hostLabels lists every host in the map, for the Snippet rule", () => {
	// These labels are what deploy.sh writes into the Snippet rule. A host
	// missing here has DNS but never runs.
	assert.deepEqual([...hostLabels].sort(), [
		"as", "asn", "bot", "cipher", "city", "co", "colo", "continent",
		"country", "edge", "eu", "http", "ip", "isp", "lat", "lon", "metro",
		"postal", "ray", "region", "rtt", "timezone", "tls", "tz", "zip",
	]);
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

	// The page has its own scripts for the map, so check the visitor value
	// itself never opens a tag.
	assert.ok(!body.includes('<script>alert("x")'), "raw tag from the header must not survive");
	assert.match(body, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
});
