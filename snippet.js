// SPDX-License-Identifier: MIT
//
// icanhazip clone for ip.jasontally.com, as a Cloudflare Snippet.
//
//   https://ip.jasontally.com/            ->  "<visitor ip>\n"   text/plain
//   https://ip.jasontally.com/whoami      ->  HTML page with every field
//   https://ip.jasontally.com/?whoami     ->  same page
//   https://ip.jasontally.com/?anything   ->  "<visitor ip>\n"
//   https://city.jasontally.com/          ->  the visitor city
//   https://colo.jasontally.com/          ->  the Cloudflare data centre
//   any other hostname                    ->  not run (snippet rule)
//
// Every subdomain in HOSTS is in the one Snippet rule. A rule expression can
// hold 4096 characters, which is about 160 hosts, so they all fit together.
//
// "whoami" must be the whole query string. "?whoami=0" counts as another
// query string, so it gets the plain IP.
//
// The snippet answers from the edge and never calls fetch(), so no origin
// server is contacted. A proxied DNS record for the hostname must still
// exist, because Snippets only run on requests that reach Cloudflare.

const SOURCE = "https://github.com/jasontally/icanhazip";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

const escapeHtml = (value) =>
	String(value ?? "").replace(/[&<>"]/g, (char) => ESCAPES[char]);

// Marks a value as trusted markup, so `show` does not escape it.
const RAW = Symbol("raw");

const raw = (html) => ({ [RAW]: html });

const show = (value) => {
	if (value === null || value === undefined || value === "") {
		return '<span class="none">&mdash;</span>';
	}
	if (typeof value === "object" && RAW in value) {
		return value[RAW];
	}
	if (typeof value === "object") {
		return `<code>${escapeHtml(JSON.stringify(value))}</code>`;
	}
	return escapeHtml(value);
};

const table = (rows) =>
	`<table>${rows
		.map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${show(value)}</td></tr>`)
		.join("")}</table>`;

const section = (title, body) => `<h2>${escapeHtml(title)}</h2>${body}`;

// Same headers as icanhazip.com, so scripts see the same result.
// no-store is the one addition: it keeps an address out of the edge cache.
const plain = (value) =>
	new Response(`${value}\n`, {
		headers: {
			"content-type": "text/plain",
			"cache-control": "no-store",
			"access-control-allow-origin": "*",
			"access-control-allow-methods": "GET",
		},
	});

// Leaflet is 45 KB, over the 32 KB Snippet limit, so it loads from a CDN.
// SRI pins the exact bytes. Loading it makes this page contact unpkg.com and
// tile.openstreetmap.org, so the page is no longer private to the visitor.
const map = (latitude, longitude) => {
	// Coordinates come from Cloudflare, but they go inside a script block, so
	// keep them to plain numbers and nothing else.
	const lat = String(Number(latitude));
	const lon = String(Number(longitude));
	return `<div id="map" role="img" aria-label="Map at ${escapeHtml(latitude)}, ${escapeHtml(longitude)}"></div>
<p class="note">Loading a map sends this visit to unpkg.com and tile.openstreetmap.org. <a href="#" id="no-map">Hide the map</a> and stop that.</p>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script>
  window.addEventListener("load", function () {
    var where = L.map("map", { scrollWheelZoom: false }).setView([${lat}, ${lon}], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(where);
    L.circleMarker([${lat}, ${lon}], { radius: 8, color: "#2563eb", fillOpacity: 0.6 })
      .addTo(where)
      .bindPopup(${JSON.stringify(`${lat}, ${lon}`)});
    document.getElementById("no-map").addEventListener("click", function (event) {
      event.preventDefault();
      where.remove();
      document.getElementById("map").remove();
    });
  });
</script>`;
};

const detailsPage = (request, ip) => {
	const url = new URL(request.url);
	const cf = request.cf ?? {};
	const headers = Object.fromEntries(request.headers);

	const asn = cf.asn ? `AS${cf.asn}` : null;
	const place = [cf.city, cf.region, cf.postalCode, cf.country].filter(Boolean);
	const located = cf.latitude != null && cf.longitude != null;

	return `<!DOCTYPE html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(ip)} &mdash; whoami</title>
<style>
:root{color-scheme:light dark}
body{margin:0 auto;padding:2rem 1rem;max-width:60rem;font:16px/1.5 system-ui,sans-serif}
h1{font-size:1.75rem;margin:0 0 .25rem;overflow-wrap:anywhere}
h2{font-size:1.1rem;margin:2rem 0 .5rem;text-transform:uppercase;letter-spacing:.06em;opacity:.7}
p{margin:0 0 1rem;opacity:.8}
table{border-collapse:collapse;width:100%}
th,td{border-bottom:1px solid color-mix(in srgb,currentColor 15%,transparent);padding:.35rem .5rem;text-align:left;vertical-align:top}
th{width:14rem;font-weight:600;opacity:.75}
code,td{overflow-wrap:anywhere}
pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-size:.85rem;background:color-mix(in srgb,currentColor 5%,transparent);padding:.75rem;border-radius:.25rem}
.none{opacity:.4}
#map{height:20rem;border-radius:.25rem;margin:0;background:color-mix(in srgb,currentColor 8%,transparent);border:1px solid color-mix(in srgb,currentColor 15%,transparent)}
.note{font-size:.85rem;margin:.5rem 0 0}
footer{margin-top:2.5rem;font-size:.85rem;opacity:.6}
</style>
<h1>${escapeHtml(ip)}</h1>
<p>You are looking at your own request. Nothing here is stored or sent anywhere.</p>
${section(
	"Request",
	table([
		["IP address", ip],
		["IP version", ip.includes(":") ? 6 : 4],
		["Method", request.method],
		["URL", `${url.pathname}${url.search}`],
		["Protocol", cf.httpProtocol ?? url.protocol.replace(":", "")],
		["HTTP version", cf.httpVersion],
		["Network", cf.network],
		["UTC time", new Date().toISOString()],
	]),
)}
${section(
	"Location",
	table([
		["City", cf.city],
		["Region", cf.region],
		["Region code", cf.regionCode],
		["Postal code", cf.postalCode],
		["Metro code", cf.metroCode],
		["Country", cf.country],
		["Continent", cf.continent],
		["Latitude", cf.latitude],
		["Longitude", cf.longitude],
		["Timezone", cf.timezone],
		[
			"Map",
			located
				? raw(
						`<a href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(cf.latitude)}&mlon=${encodeURIComponent(cf.longitude)}#map=12/${cf.latitude}/${cf.longitude}">OpenStreetMap</a>`,
					)
				: null,
		],
	]),
)}
${located ? section("Where that is", map(cf.latitude, cf.longitude)) : ""}
${section(
	"Network",
	table([
		["Autonomous system", asn],
		["AS organisation", cf.asOrganization],
		["Cloudflare colo", cf.colo],
		["Ray ID", headers["cf-ray"]],
		["TCP RTT", cf.clientTcpRtt == null ? null : `${cf.clientTcpRtt} ms`],
	]),
)}
${section(
	"TLS",
	table([
		["Version", cf.tlsVersion],
		["Cipher", cf.tlsCipher],
		["Client hello", cf.tlsClientHello],
		["JA3", cf.tlsJa3Hash],
		["JA4", cf.tlsJa4],
	]),
)}
${section(
	"Browser",
	table([
		["User agent", headers["user-agent"]],
		["Accept", headers.accept],
		["Accept-Language", headers["accept-language"]],
		["Accept-Encoding", headers["accept-encoding"]],
		["Referer", headers.referer],
		["Cookie", headers.cookie],
	]),
)}
${section("All request headers", `<pre>${escapeHtml(JSON.stringify(headers, null, 2))}</pre>`)}
${section("All request.cf", `<pre>${escapeHtml(JSON.stringify(cf, null, 2))}</pre>`)}
<footer>Served by a Cloudflare Snippet. <a href="${SOURCE}">${SOURCE}</a></footer>
</html>
`;
};

// One subdomain per data point. Each key is the host label, and the value
// reads that field out of the request. Any host in this map answers with the
// value and nothing else.
//
// A host may hold more than one field name. The first one that holds a value
// wins, so "region" can offer the long name and fall back to the code.
const HOSTS = {
	ip: ["CF-Connecting-IP"],
	city: ["city"],
	zip: ["postalCode"],
	postal: ["postalCode"],
	country: ["country"],
	co: ["country"],
	region: ["region", "regionCode"],
	continent: ["continent"],
	timezone: ["timezone"],
	tz: ["timezone"],
	lat: ["latitude"],
	lon: ["longitude"],
	colo: ["colo"],
	edge: ["colo"],
	asn: ["asn"],
	as: ["asOrganization"],
	isp: ["asOrganization"],
	http: ["httpProtocol"],
	tls: ["tlsVersion"],
	cipher: ["tlsCipher"],
	rtt: ["clientTcpRtt"],
	bot: ["botManagement.score"],
	metro: ["metroCode"],
	dma: ["metroCode"],
	eu: ["isEUCountry"],
	ray: ["cf-ray"],
	geo: ["region", "regionCode"],
	st: ["region", "regionCode"],
	cc: ["country"],
	zipcode: ["postalCode"],
	postcode: ["postalCode"],
	org: ["asOrganization"],
	proto: ["httpProtocol"],
	ua: ["User-Agent"],
	lang: ["Accept-Language"],
	ja3: ["tlsJa3Hash"],
	ja4: ["tlsJa4"],
};

// These live in request headers, not in request.cf. Everything else in HOSTS
// is a request.cf path, where "." means "step into".
const HEADER_FIELDS = new Set([
	"CF-Connecting-IP",
	"cf-ray",
	"User-Agent",
	"Accept-Language",
]);

const readField = (name, request) => {
	if (HEADER_FIELDS.has(name)) return request.headers.get(name.toLowerCase());
	return name
		.split(".")
		.reduce((node, part) => (node == null ? undefined : node[part]), request.cf);
};

// These hosts join fields or compute a value, so they do not fit HOSTS.
// "lat,long" is one string, the order everyone writes on a map.
const DERIVED = {
	latlong: (request) => pair(request),
	latlon: (request) => pair(request),
	latlng: (request) => pair(request),
	utc: () => new Date().toISOString(),
};

const pair = (request) => {
	const lat = readField("latitude", request);
	const lon = readField("longitude", request);
	return lat != null && lon != null ? `${lat},${lon}` : null;
};

// "colo" -> the value for the colo host, or null when Cloudflare sent none.
const readHost = (label, request) => {
	const derived = DERIVED[label];
	if (derived) {
		const value = derived(request);
		return value == null || value === "" ? null : value;
	}

	for (const name of HOSTS[label] ?? []) {
		const value = readField(name, request);
		if (value === undefined || value === null || value === "") continue;
		return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
	}
	return null;
};

// Labels for the host maps, joined for the Snippet rule expression.
// deploy.sh writes this into the rule, so the rule and the map cannot drift.
export const hostLabels = [...Object.keys(HOSTS), ...Object.keys(DERIVED)];

export default {
	async fetch(request) {
		const url = new URL(request.url);
		const ip = request.headers.get("CF-Connecting-IP") ?? request.cf?.ip ?? "unknown";
		const label = url.hostname.split(".")[0];

		const wantsPage =
			url.pathname === "/whoami" || url.searchParams.get("whoami") === "";

		// A subdomain answers with one value, so shell scripts can read it.
		// The details page wins over the value, so /whoami still works there.
		// The zone check keeps an unrelated host such as city.example.com out.
		if (!wantsPage && url.hostname.endsWith(".jasontally.com") && hostLabels.includes(label) && label !== "ip") {
			// A known host with no data answers with an empty line. It must not
			// fall through to the IP address, or a missing field would look
			// like a result. curl sends no Accept-Language, so lang is often
			// empty, and Cloudflare sends no JA3 for most requests.
			return plain(readHost(label, request) ?? "");
		}

		if (!wantsPage) {
			return plain(ip);
		}

		return new Response(detailsPage(request, ip), {
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
			},
		});
	},
};
