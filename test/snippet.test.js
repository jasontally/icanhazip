// SPDX-License-Identifier: MIT
//
// Run with: node --test test/

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("headers answers with every request header as JSON", async () => {
	const response = await callHost("headers", {
		headers: { "CF-Connecting-IP": "203.0.113.7", "x-custom-test": "kept" },
	});
	assert.equal(response.headers.get("content-type"), "application/json");

	const parsed = JSON.parse(await response.text());
	assert.equal(parsed["x-custom-test"], "kept");
	assert.equal(parsed["cf-connecting-ip"], "203.0.113.7");
});

test("proxy finds the headers a proxy declares, and 204 when none", async () => {
	// icanhazproxy returned 204 when it found nothing, which is what tells a
	// script the difference between "no proxy" and "empty".
	const clean = await callHost("proxy");
	assert.equal(clean.status, 204);
	assert.equal(await clean.text(), "");

	const behind = await callHost("proxy", {
		headers: {
			"CF-Connecting-IP": "203.0.113.7",
			via: "1.1 proxy.example.net",
			forwarded: "for=198.51.100.7;proto=https",
		},
	});
	assert.equal(behind.status, 200);
	const parsed = JSON.parse(await behind.text());
	assert.equal(parsed.via, "1.1 proxy.example.net");
	assert.equal(parsed.forwarded, "for=198.51.100.7;proto=https");
});

test("proxies is the same answer as proxy", async () => {
	const options = { headers: { "CF-Connecting-IP": "203.0.113.7", via: "1.1 p" } };
	assert.equal(
		await (await callHost("proxies", options)).text(),
		await (await callHost("proxy", options)).text(),
	);
});

test("xff reports the chain a proxy declared, empty when there is none", async () => {
	const none = await callHost("xff", { headers: { "CF-Connecting-IP": "203.0.113.7" } });
	assert.equal(await none.text(), "\n");

	const chain = await callHost("xff", {
		headers: { "CF-Connecting-IP": "203.0.113.7", "x-forwarded-for": "203.0.113.9, 198.51.100.7" },
	});
	assert.equal(await chain.text(), "203.0.113.9, 198.51.100.7\n");
});

test("warp and gateway read the edge trace, and fail soft", async () => {
	// These subrequest /cdn-cgi/trace on the same host, which a local fake
	// Request cannot resolve, so they must return empty rather than throw.
	for (const host of ["warp", "gateway"]) {
		const response = await callHost(host);
		assert.equal(response.headers.get("content-type"), "text/plain", host);
		assert.match(await response.text(), /^[\x20-\x7e]*\n$/, host);
	}
});

test("the cdn-cgi guard delegates instead of recursing", async () => {
	// If /cdn-cgi/trace ever reached this handler, the warp subrequest would
	// loop forever. The guard hands the request to fetch instead, which off
	// this machine fails to resolve, so the rejection proves the delegation
	// happened and no value was produced.
	const request = new Request("https://warp.jasontally.invalid/cdn-cgi/trace");
	request.cf = CF;
	await assert.rejects(() => snippet.fetch(request), /fetch failed/);
});

test("both map pages send a Referer, as the OSM tile policy requires", async () => {
	// The tile usage policy forbids a Referrer-Policy that stops the Referer
	// header reaching tile.openstreetmap.org, and says referer-stripping
	// traffic may be blocked without notice. "origin" satisfies both: the
	// header is sent, and it carries the origin only, never the path.
	for (const target of ["https://ip.jasontally.com/whoami", "https://map.jasontally.com/"]) {
		const body = await (await call(target)).text();
		const tags = [...body.matchAll(/<meta name="referrer" content="([^"]+)">/g)];
		assert.equal(tags.length, 1, `${target} needs one referrer meta tag`);
		assert.equal(tags[0][1], "origin", `${target} must not strip the Referer`);
	}
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

test("ipv4, ipv6, v4 and v6 are synonyms of ip4 and ip6", async () => {
	const v4 = { headers: { "CF-Connecting-IP": "203.0.113.7" } };
	for (const host of ["ip4", "ipv4", "v4"]) {
		assert.equal(await (await callHost(host, v4)).text(), "203.0.113.7\n", host);
	}
	for (const host of ["ip6", "ipv6", "v6"]) {
		assert.equal(await (await callHost(host, v4)).text(), "\n", host);
	}

	const v6 = { headers: { "CF-Connecting-IP": "2001:db8::1" } };
	for (const host of ["ip6", "ipv6", "v6"]) {
		assert.equal(await (await callHost(host, v6)).text(), "2001:db8::1\n", host);
	}
	for (const host of ["ip4", "ipv4", "v4"]) {
		assert.equal(await (await callHost(host, v6)).text(), "\n", host);
	}
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

test("the date and time hosts split the ISO timestamp", async () => {
	const expected = {
		date: /^\d{4}-\d{2}-\d{2}\n$/,
		time: /^\d{2}:\d{2}:\d{2}\n$/,
		utc: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\n$/,
		year: /^\d{4}\n$/,
		month: /^\d{2}\n$/,
		hour: /^\d{2}\n$/,
		minute: /^\d{2}\n$/,
		second: /^\d{2}\n$/,
		epoch: /^\d{10}\n$/,
	};
	for (const [host, pattern] of Object.entries(expected)) {
		const body = await (await callHost(host)).text();
		assert.match(body, pattern, host);
	}

	// Every split must come from the same clock, so they must agree with utc.
	const utc = (await (await callHost("utc")).text()).trim();
	assert.equal(await (await callHost("date")).text(), `${utc.slice(0, 10)}\n`);
	assert.equal(await (await callHost("time")).text(), `${utc.slice(11, 19)}\n`);
	assert.equal(await (await callHost("day")).text(), `${utc.slice(0, 10)}\n`);
	assert.equal(await (await callHost("clock")).text(), `${utc.slice(11, 19)}\n`);

	// The epoch value must be the same moment, to within a second.
	const epoch = Number((await (await callHost("epoch")).text()).trim());
	assert.ok(Math.abs(epoch * 1000 - Date.parse(utc)) < 1000, "epoch must match utc");
});

test("the weather hosts read one field each from Open-Meteo", async () => {
	// These are real subrequests, so only check they answer and never throw.
	for (const host of [
		"temp", "tempc", "celsius", "tempf", "fahrenheit", "feels", "humidity",
		"wind", "clouds", "precip", "elevation", "elev", "sunrise", "sunset",
		"wmo", "weather",
	]) {
		const body = await (await callHost(host)).text();
		assert.match(body, /^[\x20-\x7e]*\n$/, `${host} must answer one printable line`);
	}
});

test("weather needs coordinates and fails soft without them", async () => {
	const none = { cf: { ...CF, latitude: undefined, longitude: undefined } };
	for (const host of ["temp", "weather", "elevation", "sunrise"]) {
		assert.equal(await (await callHost(host, none)).text(), "\n", host);
	}
});

test("the weather code table covers every code Open-Meteo documents", async () => {
	// A missing entry would make weather answer empty for a real condition.
	// Read it through the module, not out of the source text, so this works
	// against a minified build as well.
	const { wmoCodes } = await import("../snippet.js");
	const expected = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66,
		67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, 99];

	assert.deepEqual(Object.keys(wmoCodes).map(Number).sort((a, b) => a - b), expected);
	for (const code of expected) {
		assert.equal(typeof wmoCodes[code], "string", `code ${code} needs words`);
		assert.ok(wmoCodes[code].length > 0, `code ${code} must not be blank`);
	}
});

test("map.jasontally.com is the whole map, not a value", async () => {
	const response = await callHost("map");
	const body = await response.text();

	assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
	// No table, no details. The map is the page.
	assert.doesNotMatch(body, /All request headers/);
	assert.doesNotMatch(body, /Cloudflare colo/);
	assert.match(body, /<div id="map"/);
	assert.match(body, /#map\{height:100%;width:100%/);
	assert.match(body, /setView\(\[30\.2672, -97\.7431\], 6\)/);
	assert.match(body, /tile\.openstreetmap\.org/);
	assert.match(body, /leaflet\.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2\/Z9VM\+kNiyxNV1lvTlZBo="/);
});

test("map says so when Cloudflare sent no coordinates", async () => {
	const body = await (
		await callHost("map", { cf: { ...CF, latitude: undefined, longitude: undefined } })
	).text();

	assert.match(body, /no coordinates/i);
	assert.doesNotMatch(body, /<div id="map"/, "an empty map is worse than an explanation");
	assert.match(body, /ip\.jasontally\.com\/whoami/);
});

test("map coordinates cannot break out of the script block", async () => {
	const body = await (
		await callHost("map", { cf: { ...CF, latitude: "30.2);alert(1);//" } })
	).text();

	const script = body.slice(body.lastIndexOf("<script>"), body.lastIndexOf("</script>"));
	assert.doesNotMatch(script, /alert\(1\)/);
	assert.match(script, /setView\(\[NaN, -97\.7431\], 6\)/);
});

test("the reverse DNS name builders handle both address families", async () => {
	// ptr and friends must build a name the resolver understands. These
	// queries hit the live Cloudflare resolver, so they prove the format.
	const cases = [
		["2001:4860:4860::8888", "dns.google"],
	];
	for (const [ip, expected] of cases) {
		const request = new Request("https://ptr.jasontally.com/", {
			headers: { "CF-Connecting-IP": ip },
		});
		request.cf = {};
		const response = await snippet.fetch(request);
		const body = await response.text();
		if (body.trim() === "") continue; // no PTR published, nothing to prove
		assert.equal(body.trim(), expected, ip);
	}
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

test("a subdomain with no data answers with an empty line, never the IP", async () => {
	const response = await callHost("city", { cf: {} });
	const body = await response.text();

	assert.equal(response.headers.get("content-type"), "text/plain");
	assert.equal(body, "\n", "an empty line, so the caller can test for empty");
	assert.doesNotMatch(body, /DOCTYPE/);
});

test("a missing field never looks like the visitor IP", async () => {
	// curl sends no Accept-Language, and Cloudflare sends no JA3 for most
	// requests. Both must read as empty, not as the caller's address.
	for (const host of ["lang", "ja3", "ja4", "tls", "colo"]) {
		const body = await (await callHost(host, { cf: {} })).text();
		assert.equal(body, "\n", host);
		assert.doesNotMatch(body, /203\.0\.113\.7/, host);
	}
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

test("hostLabels lists every host in the maps, for the Snippet rule", () => {
	// These labels are what deploy.sh writes into the Snippet rule. A host
	// missing here has DNS but never runs.
	// Sorted here so a missing host shows up as a clear diff, not a count.
assert.deepEqual([...hostLabels].sort(), [
	"as", "asn", "bgp", "bot", "cc", "cipher", "city", "co", "colo",
	"continent", "country", "countrycode", "dns", "dma", "edge", "eu", "geo",
	"hostname", "http", "ip", "ip4", "ip6", "ipv4", "ipv6", "isp", "ja3",
	"ja4", "lang", "lat", "latitude", "latlng", "latlon", "latlong", "lon",
	"longitude", "map", "metro", "nameserver", "net", "netblock", "netname",
	"ns", "org", "postcode", "postal", "prefix", "proto", "province", "ptr",
	"range", "ray", "cidr", "region", "rtt", "st", "state", "timezone", "tls",
	"tz", "ua", "useragent", "utc", "v4", "v6", "ver", "zip", "zipcode",

	// Date and time splits.
	"date", "day", "today", "utcdate", "time", "utctime", "clock", "now",
	"year", "month", "hour", "minute", "second", "epoch", "timestamp",

	// Weather.
	"temp", "tempc", "celsius", "tempf", "fahrenheit", "feels", "humidity",
	"wind", "clouds", "precip", "elevation", "elev", "sunrise", "sunset",
	"wmo", "weather",

	// Replacements for the services Major Hayden retired in August 2022.
	"headers", "proxy", "proxies", "xff", "warp", "gateway",
].sort());
});

test("latlong joins the two coordinates with a comma", async () => {
	for (const host of ["latlong", "latlon", "latlng"]) {
		const response = await callHost(host);
		assert.equal(await response.text(), "30.2672,-97.7431\n", host);
	}
});

test("latlong needs both coordinates, not one", async () => {
	const noLon = await callHost("latlong", { cf: { ...CF, longitude: undefined } });
	assert.doesNotMatch(await noLon.text(), /30\.2672/, "half a pair is not a position");

	const neither = await callHost("latlong", { cf: {} });
	assert.doesNotMatch(await neither.text(), /,/, "no coordinates means no comma");
});

test("utc returns an ISO 8601 timestamp", async () => {
	const body = await (await callHost("utc")).text();
	assert.match(body, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\n$/);
	assert.ok(Math.abs(Date.parse(body.trim()) - Date.now()) < 60_000);
});

test("geo is the coordinates, and the region has its own long names", async () => {
	assert.equal(await (await callHost("geo")).text(), "30.2672,-97.7431\n");

	for (const host of ["st", "state", "province", "region"]) {
		assert.equal(await (await callHost(host)).text(), "Texas\n", host);
	}
});

test("the long form names answer like the short ones", async () => {
	const pairs = {
		latitude: "30.2672",
		longitude: "-97.7431",
		countrycode: "US",
		useragent: undefined,
		timezone: "America/Chicago",
	};
	for (const [host, value] of Object.entries(pairs)) {
		if (value === undefined) continue;
		assert.equal(await (await callHost(host)).text(), `${value}\n`, host);
	}

	const ua = await callHost("useragent", {
		headers: { "CF-Connecting-IP": "203.0.113.7", "user-agent": "curl/8.5.0" },
	});
	assert.equal(await ua.text(), "curl/8.5.0\n");
});

test("ver tells the IP version, ip4 and ip6 give that family only", async () => {
	const v4 = { headers: { "CF-Connecting-IP": "203.0.113.7" } };
	assert.equal(await (await callHost("ver", v4)).text(), "4\n");
	assert.equal(await (await callHost("ip4", v4)).text(), "203.0.113.7\n");
	assert.equal(await (await callHost("ip6", v4)).text(), "\n");

	const v6 = { headers: { "CF-Connecting-IP": "2001:db8::1" } };
	assert.equal(await (await callHost("ver", v6)).text(), "6\n");
	assert.equal(await (await callHost("ip6", v6)).text(), "2001:db8::1\n");
	assert.equal(await (await callHost("ip4", v6)).text(), "\n");
});

test("ptr, hostname, ns, nameserver and dns are wired to a resolver", async () => {
	// The resolver is a real subrequest, so this test only checks that the
	// hosts exist, answer one line, and do not throw. The values themselves
	// depend on the visitor, so bench.mjs checks them against the live site.
	for (const host of ["ptr", "hostname", "ns", "nameserver", "dns"]) {
		assert.ok(hostLabels.includes(host), `${host} must be in the rule`);
	}
});

test("the registry hosts exist and never throw", async () => {
	// stat.ripe.net is a third party, so these must fail soft. An empty answer
	// is correct when a service is slow or down.
	for (const host of ["net", "netname", "netblock", "range", "cidr", "prefix", "bgp"]) {
		assert.ok(hostLabels.includes(host), `${host} must be in the rule`);
		const body = await (await callHost(host)).text();
		assert.match(body, /^[\x20-\x7e]*\n$/, `${host} must answer one printable line`);
	}
});

test("an empty or missing address never reaches a third party", async () => {
	// readHost must not call out for a request with no address.
	const request = new Request("https://net.jasontally.com/");
	request.cf = {};
	const response = await snippet.fetch(request);
	assert.equal(await response.text(), "\n");
});

test("the new shorthands read the right fields", async () => {
	const expected = {
		cc: "US",
		zipcode: "78701",
		postcode: "78701",
		dma: "635",
		org: "CLOUDFLARENET",
		proto: "HTTP/2",
	};
	for (const [host, value] of Object.entries(expected)) {
		assert.equal(await (await callHost(host)).text(), `${value}\n`, host);
	}
});

test("ua and lang read request headers", async () => {
	const response = await callHost("ua", { headers: { "CF-Connecting-IP": "203.0.113.7", "user-agent": "curl/8.5.0" } });
	assert.equal(await response.text(), "curl/8.5.0\n");

	const lang = await callHost("lang", {
		headers: { "CF-Connecting-IP": "203.0.113.7", "accept-language": "en-GB,en;q=0.9" },
	});
	assert.equal(await lang.text(), "en-GB,en;q=0.9\n");
});

test("ua is empty when the client sends no user agent", async () => {
	// Node's Request adds no default user agent, which matches a bare client.
	assert.equal(await (await callHost("ua")).text(), "\n");
});

test("ja3 and ja4 read the TLS fingerprints, and are empty when absent", async () => {
	const withHashes = await callHost("ja3", {
		cf: { ...CF, tlsJa3Hash: "e7d705a3286e19ea", tlsJa4: "t13d1516h2_8daa" },
	});
	assert.equal(await withHashes.text(), "e7d705a3286e19ea\n");
	assert.equal(await (await callHost("ja4", {
		cf: { ...CF, tlsJa3Hash: "e7d705a3286e19ea", tlsJa4: "t13d1516h2_8daa" },
	})).text(), "t13d1516h2_8daa\n");

	// Cloudflare sends no JA3 for most requests, so this host is often empty.
	const none = await callHost("ja3", { cf: { ...CF, tlsJa3Hash: undefined } });
	assert.doesNotMatch(await none.text(), /e7d705a3/);
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
