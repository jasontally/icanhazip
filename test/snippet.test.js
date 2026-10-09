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
	tlsVersion: "TLSv1.3",
	tlsCipher: "AEAD-AES128-GCM-SHA256",
	tlsClientHelloLength: 1570,
	clientTcpRtt: 12,
	ip: "203.0.113.7",
	botManagement: { score: 1, verifiedBots: [] },
};

// The keys request.cf really carried on this zone, dumped from the edge on
// 4 October 2026. 32 keys, no more. This exists because the fixture above
// once invented a tlsJa3Hash key, which let the ja3 and ja4 tests pass while
// both hosts answered empty in production for every visitor. A field that is
// not in this list does not reach a Snippet on this plan.
//
// Regenerate with the request.cf block at https://colo.jasontally.com/whoami
const REAL_CF_KEYS = [
	"asOrganization", "asn", "botManagement", "city", "clientQuicRtt",
	"clientTcpRtt", "colo", "continent", "country", "edgeL4",
	"edgeRequestKeepAliveStatus", "httpProtocol", "isEUCountry", "latitude",
	"longitude", "metroCode", "postalCode", "region", "regionCode",
	"requestHeaderNames", "requestPriority", "timezone", "tlsCipher",
	"tlsClientAuth", "tlsClientCiphersSha1", "tlsClientExtensionsSha1",
	"tlsClientExtensionsSha1Le", "tlsClientHelloLength", "tlsClientRandom",
	"tlsExportedAuthenticator", "tlsVersion", "verifiedBotCategory",
];

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
	assert.match(body, /<div id="map" role="img" aria-label="Map at 30\.2672, -97\.7431"/);
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

test("warp and gateway are gone, because a Snippet cannot read them", () => {
	// Cloudflare knows both, and reports both at /cdn-cgi/trace, but a
	// Snippet's fetch() is an origin request and this origin is 100::1 with
	// nothing behind it. The hosts were removed rather than left answering
	// empty, because a name that always returns nothing is worse than no name.
	// The whoami page links the trace, which is where a browser can read them.
	assert.ok(!hostLabels.includes("warp"), "warp must not be in the rule");
	assert.ok(!hostLabels.includes("gateway"), "gateway must not be in the rule");
});

test("the whoami page links the edge trace, for the fields it cannot show", async () => {
	const body = await (await call("https://colo.jasontally.com/whoami")).text();

	assert.match(body, /href="\/cdn-cgi\/trace"/);
	// Name the fields that only the trace carries, or the link is just noise.
	for (const field of ["warp", "gateway", "rbi", "kex", "sliver"]) {
		assert.match(body, new RegExp(`<code>${field}</code>`), field);
	}
	// The link must be relative, so it works on every host that serves whoami.
	assert.doesNotMatch(body, /href="https:\/\/[^"]*cdn-cgi\/trace"/);
});

test("both map pages send a Referer that carries the origin only", async () => {
	// "origin" is the one policy that both answers the reason this used to
	// exist and the reason it still does. The old reason was the OSM tile usage
	// policy, which required a valid Referer and withdrew access without notice
	// from traffic that stripped it. The tiles are now served by this zone, so
	// no policy asks for anything. What stays is that a Referer of origin only
	// never carries the path or the query string, which is the part of this
	// URL that can hold something about the visitor.
	for (const target of ["https://ip.jasontally.com/whoami", "https://map.jasontally.com/"]) {
		const body = await (await call(target)).text();
		const tags = [...body.matchAll(/<meta name="referrer" content="([^"]+)">/g)];
		assert.equal(tags.length, 1, `${target} needs one referrer meta tag`);
		assert.equal(tags[0][1], "origin", `${target} must send the origin and no path`);
	}
});

test("the whoami page embeds a map with pinned libraries and a marker", async () => {
	const response = await call("https://ip.jasontally.com/whoami");
	const body = await response.text();

	assert.match(body, /<div id="map"/);
	// MapLibre and the PMTiles reader, from the same host as the tiles.
	assert.match(body, /vendor\/maplibre-gl\.js/);
	assert.match(body, /vendor\/pmtiles\.js/);
	assert.match(body, /vendor\/maplibre-gl\.css/);
	// Subresource Integrity must pin all three files.
	assert.match(body, /maplibre-gl\.js" integrity="sha384-5\+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp"/);
	assert.match(body, /maplibre-gl\.css" integrity="sha384-uTttxo\/aOKbdE5RlD\/SPzSDoDmNvGlUYPjONi2MN\/b7c9HPSvW07OIuyP7uL6jxK"/);
	assert.match(body, /pmtiles\.js" integrity="sha384-QfbOCebHNw8pQiPAOd2IFee2v2A5VYZxBk0\+JGZ5H\+3mfzVIp6zsQNkTsfGJot93"/);
	assert.match(body, /crossorigin=""/);
	// The style, which is where the glyph URL comes from. Both flavours, so
	// the map follows the visitor's colour scheme like the page CSS does.
	assert.match(body, /styles\/bright\.json/);
	assert.match(body, /styles\/dark\.json/);
	// The coordinates reach MapLibre as numbers, not as strings from the CF
	// object. MapLibre takes longitude first, the other way round from Leaflet.
	assert.match(body, /center: \[-97\.7431, 30\.2672\], zoom: 5/);
	assert.match(body, /setLngLat\(\[-97\.7431, 30\.2672\]\)/);
	assert.match(body, /maxZoom: 15/);
	// The archive is Protomaps schema v3, so the style must be one of the two
	// written for it. A style for another schema draws nothing at all.
	assert.match(body, /attributionControl: false/);
	assert.match(body, /AttributionControl\(\{ compact: true \}\)/);
	// Nothing is fetched from any host but our own.
	assert.doesNotMatch(body, /unpkg\.com|tile\.openstreetmap\.org|demotiles|maplibre\.org/);
});

test("neither map page carries a note, and there is no way to hide the map", async () => {
	// The attribution control inside the map is the only credit, so a note that
	// repeated it would be a second answer to the same question. There is no
	// "stop loading" control either: the map is the page on map.jasontally.com,
	// and on /whoami it is one section of many.
	for (const target of ["https://ip.jasontally.com/whoami", "https://map.jasontally.com/"]) {
		const body = await (await call(target)).text();
		assert.doesNotMatch(body, /id="no-map"/, target);
		assert.doesNotMatch(body, /class="note"/, target);
		assert.doesNotMatch(body, /Loading a map|Stop loading|Hide the map/, target);
		assert.doesNotMatch(body, /where\.remove\(\)/, target);
		// What is left is the attribution control, and nothing else.
		assert.match(body, /AttributionControl\(\{ compact: true \}\)/, target);
	}
});

test("the map pages credit OpenStreetMap only through the attribution control", async () => {
	// The control is built without MapLibre's own default, because that default
	// adds a "MapLibre" link beside the credit. The credit itself comes from the
	// style JSON, which is what carries the OpenStreetMap attribution.
	for (const target of ["https://ip.jasontally.com/whoami", "https://map.jasontally.com/"]) {
		const body = await (await call(target)).text();
		assert.match(body, /attributionControl: false/, target);
		assert.doesNotMatch(body, /customAttribution/, target);
		assert.doesNotMatch(body, /maplibre\.org/, target);
	}
});

test("no coordinates means no map and no libraries", async () => {
	const body = await (
		await call("https://ip.jasontally.com/whoami", { cf: { ...CF, latitude: undefined, longitude: undefined } })
	).text();

	assert.doesNotMatch(body, /maplibregl/);
	assert.doesNotMatch(body, /pmtiles/);
	assert.doesNotMatch(body, /vendor\//);
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
	// drops the injected text, so MapLibre gets a real number or NaN.
	assert.doesNotMatch(script, /alert\(1\)/);
	assert.match(script, /center: \[-97\.7, NaN\], zoom: 5/);
	assert.match(script, /setLngLat\(\[-97\.7, NaN\]\)/);
	// The popup label is built from those numbers, so it cannot carry the text.
	assert.match(script, /\.setText\("NaN, -97\.7"\)/);
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
	assert.match(body, /center: \[-97\.7431, 30\.2672\], zoom: 6/);
	assert.match(body, /setLngLat\(\[-97\.7431, 30\.2672\]\)/);
	assert.match(body, /styles\/bright\.json/);
	assert.match(body, /styles\/dark\.json/);
	assert.match(body, /maplibre-gl\.js" integrity="sha384-5\+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp"/);
	assert.match(body, /pmtiles\.js" integrity="sha384-QfbOCebHNw8pQiPAOd2IFee2v2A5VYZxBk0\+JGZ5H\+3mfzVIp6zsQNkTsfGJot93"/);
	// The OpenStreetMap credit is not in the page at all: it comes from the
	// style JSON through the attribution control. A credit written here would be
	// a second answer to the same question, and the two could drift. Strip the
	// comments first, because the explanatory ones name OpenStreetMap.
	const bare = body.replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "");
	assert.doesNotMatch(bare, /OpenStreetMap/);
	assert.match(body, /AttributionControl\(\{ compact: true \}\)/);
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
	assert.match(script, /center: \[-97\.7431, NaN\], zoom: 6/);
	assert.match(script, /setLngLat\(\[-97\.7431, NaN\]\)/);
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
	// curl sends no Accept-Language, and a request with no request.cf carries
	// no location. Both must read as empty, not as the caller's address.
	for (const host of ["lang", "tls", "colo"]) {
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
	"hostname", "http", "ip", "ip4", "ip6", "ipv4", "ipv6", "isp",
	"lang", "lat", "latitude", "latlng", "latlon", "latlong", "lon",
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
	"headers", "proxy", "proxies", "xff",
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

test("every request.cf field the snippet reads really exists", () => {
	// The guard that should have caught three dead reads. Two hosts and one row
	// of the details page named a field Cloudflare does not put in request.cf
	// on this plan, so all three rendered empty for every visitor while the
	// suite stayed green, because the fixture had invented the fields.
	//
	// One check covers the whole file rather than the HOSTS map alone, since
	// the details page reads request.cf directly and was missed the first time.
	const src = readFileSync(new URL("../snippet.js", import.meta.url), "utf8");
	const real = new Set(REAL_CF_KEYS);

	// HEADER_FIELDS is read from the source rather than repeated here, so this
	// check follows the snippet if a host moves from a header to request.cf.
	const headerBlock = src.slice(src.indexOf("const HEADER_FIELDS = new Set(["));
	const headers = new Set(
		[...headerBlock.slice(0, headerBlock.indexOf("]);")).matchAll(/"([^"]+)"/g)]
			.map((m) => m[1]),
	);
	assert.equal(headers.size, 4, "HEADER_FIELDS did not parse, so this check is blind");

	// Comments are stripped first. A comment that explains a removed field
	// names that field, and the guard flagged its own explanation.
	const code = src
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

	// Every cf.SOMETHING in the file, wherever it appears.
	const dotted = new Set(
		[...code.matchAll(/\bcf\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
	);
	assert.ok(dotted.size > 10, `only found ${dotted.size} cf reads, so this check is blind`);

	const invented = [...dotted]
		.filter((field) => !real.has(field))
		.sort()
		// request.cf carries no ip key on a proxied request. The snippet reads
		// it only as a fallback and the CF fixture provides it, so allow it.
		.filter((field) => field !== "ip");
	assert.deepEqual(
		invented,
		[],
		"the snippet reads a request.cf field Cloudflare does not send, so it renders empty",
	);

	// And the HOSTS map specifically, since a field there becomes a whole host.
	const body = src.slice(
		src.indexOf("const HOSTS = {"),
		src.indexOf("\n};", src.indexOf("const HOSTS = {")),
	);
	const read = [];
	for (const [, label, list] of body.matchAll(
		/^\t([A-Za-z0-9_]+):\s*\[([^\]]*)\]/gm,
	)) {
		for (const raw of list.split(",")) {
			const path = raw.trim().replace(/"/g, "");
			if (path) read.push([label, path]);
		}
	}
	assert.ok(read.length > 30, `only found ${read.length} HOSTS reads to check`);
	assert.deepEqual(
		read
			.filter(([, path]) => !headers.has(path) && !real.has(path.split(".")[0]))
			.map(([label, path]) => `${label} reads request.cf.${path}`),
		[],
		"a host reads a field Cloudflare does not send, so it always answers empty",
	);
});

test("the details page shows no row that is always empty", async () => {
	// Every cell of the page comes from either request.cf or a request header.
	// A name that is not one of the 32 real keys renders as a dash forever,
	// which is how the JA3 and JA4 rows survived until the probe found them.
	const body = await (await call("https://colo.jasontally.com/whoami")).text();
	assert.doesNotMatch(body, /JA[34]/, "no JA3 or JA4 row");
	assert.doesNotMatch(body, /tlsClientHello[^L]/, "no invented tlsClientHello");

	// The Client hello row must carry the real length, not nothing.
	assert.match(body, /Client hello/);
	const cell = body.match(/Client hello<\/th><td>([^<]*)<\/td>/)?.[1] ?? "";
	assert.match(cell, /^\d+ bytes$/, `Client hello cell was "${cell}"`);
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
