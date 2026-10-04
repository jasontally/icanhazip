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
//   https://ptr.jasontally.com/           ->  the visitor reverse DNS name
//   any other hostname                    ->  not run (snippet rule)
//
// Every subdomain is in the one Snippet rule. A rule expression can hold 4096
// characters, which is about 190 hosts, so they all fit together.
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
const LEAFLET = `<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>`;

const map = (latitude, longitude) => {
	// Coordinates come from Cloudflare, but they go inside a script block, so
	// keep them to plain numbers and nothing else.
	const lat = String(Number(latitude));
	const lon = String(Number(longitude));
	return `<div id="map" role="img" aria-label="Map at ${escapeHtml(latitude)}, ${escapeHtml(longitude)}"></div>
<p class="note">Loading a map sends this visit to unpkg.com and tile.openstreetmap.org. <a href="#" id="no-map">Hide the map</a> and stop that.</p>
${LEAFLET}
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

// map.jasontally.com is nothing but the map, filling the viewport. It is the
// one host that answers with a page instead of a single value.
const mapPage = (request) => {
	const cf = request.cf ?? {};
	if (cf.latitude == null || cf.longitude == null) {
		return `<!DOCTYPE html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>No location</title>
<style>
:root{color-scheme:light dark}
body{margin:0;display:grid;place-items:center;height:100vh;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:1rem}
</style>
<p>Cloudflare sent no coordinates for your address, so there is nothing to map.</p>
<p><a href="https://ip.jasontally.com/whoami">See what Cloudflare did send</a></p>
</html>`;
	}

	// The same Number() guard as the details page, so a coordinate that is not
	// a number cannot break out of the script block.
	const lat = String(Number(cf.latitude));
	const lon = String(Number(cf.longitude));

	return `<!DOCTYPE html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(lat)}, ${escapeHtml(lon)}</title>
<style>
:root{color-scheme:light dark}
html,body{height:100%;margin:0}
body{font:14px/1.4 system-ui,sans-serif}
#map{height:100%;width:100%;background:#ddd}
.note{position:absolute;z-index:1000;left:.5rem;bottom:.5rem;margin:0;padding:.35rem .6rem;border-radius:.25rem;background:rgba(0,0,0,.72);color:#fff;max-width:min(30rem,calc(100vw - 1rem))}
.note a{color:#cfe3ff}
</style>
<div id="map" role="img" aria-label="Map at ${escapeHtml(lat)}, ${escapeHtml(lon)}"></div>
<p class="note">Approximate, from your network not a GPS fix. Tiles from
<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>,
code from unpkg.com. <a href="#" id="no-map">Stop loading them</a>.</p>
${LEAFLET}
<script>
  window.addEventListener("load", function () {
    var where = L.map("map").setView([${lat}, ${lon}], 6);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(where);
    L.circleMarker([${lat}, ${lon}], { radius: 10, color: "#2563eb", fillOpacity: 0.6 })
      .addTo(where)
      .bindPopup(${JSON.stringify(`${lat}, ${lon}`)});
    document.getElementById("no-map").addEventListener("click", function (event) {
      event.preventDefault();
      where.remove();
      document.getElementById("map").remove();
      document.querySelector(".note").remove();
    });
  });
</script>
</html>`;
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
	latitude: ["latitude"],
	lon: ["longitude"],
	longitude: ["longitude"],
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
	st: ["region", "regionCode"],
	cc: ["country"],
	countrycode: ["country"],
	zipcode: ["postalCode"],
	postcode: ["postalCode"],
	org: ["asOrganization"],
	proto: ["httpProtocol"],
	ua: ["User-Agent"],
	useragent: ["User-Agent"],
	lang: ["Accept-Language"],
	ja3: ["tlsJa3Hash"],
	ja4: ["tlsJa4"],
	state: ["region", "regionCode"],
	province: ["region", "regionCode"],
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
	geo: (request) => pair(request),
	latlong: (request) => pair(request),
	latlon: (request) => pair(request),
	latlng: (request) => pair(request),
	utc: () => new Date().toISOString(),
	ver: (request) => (ipOf(request).includes(":") ? "6" : "4"),
	ip4: (request) => (ipOf(request).includes(":") ? "" : ipOf(request)),
	ipv4: (request) => (ipOf(request).includes(":") ? "" : ipOf(request)),
	v4: (request) => (ipOf(request).includes(":") ? "" : ipOf(request)),
	ip6: (request) => (ipOf(request).includes(":") ? ipOf(request) : ""),
	ipv6: (request) => (ipOf(request).includes(":") ? ipOf(request) : ""),
	v6: (request) => (ipOf(request).includes(":") ? ipOf(request) : ""),
	// These four ask a DNS resolver over the network. Each one costs a
	// subrequest, and a Pro zone allows 2 per request.
	ptr: async (request) => (await resolve(reverseName(ipOf(request)), "PTR"))[0] ?? "",
	hostname: async (request) => (await resolve(reverseName(ipOf(request)), "PTR"))[0] ?? "",
	ns: async (request) => (await resolve(reverseZone(ipOf(request)), "NS")).join(" "),
	nameserver: async (request) => (await resolve(reverseZone(ipOf(request)), "NS")).join(" "),
	// Forward confirmed name: the PTR target, but only if it resolves back
	// to the same address. Costs 2 subrequests, the whole Pro budget.
	dns: async (request) => {
		const ip = ipOf(request);
		const [name] = await resolve(reverseName(ip), "PTR");
		if (!name) return "";
		const back = await resolve(name, ip.includes(":") ? "AAAA" : "A");
		return back.includes(ip) ? name : "";
	},
	// The address block, which Cloudflare does not report. asn and as come
	// from the routing registry. These come from the address registry.
	net: async (request) => (await whois(ipOf(request))).NetName ?? "",
	netname: async (request) => (await whois(ipOf(request))).NetName ?? "",
	netblock: async (request) => (await whois(ipOf(request))).NetRange ?? "",
	range: (request) => whois(ipOf(request)).then((w) => w.NetRange ?? ""),
	cidr: async (request) => (await whois(ipOf(request))).CIDR ?? "",
	// The block the network actually announces in BGP, which can be tighter
	// than the allocation.
	prefix: (request) => announcedPrefix(ipOf(request)),
	bgp: (request) => announcedPrefix(ipOf(request)),

	// Splits of the ISO timestamp. Same clock, different slice of the string.
	date: () => new Date().toISOString().slice(0, 10),
	day: () => new Date().toISOString().slice(0, 10),
	time: () => new Date().toISOString().slice(11, 19),
	now: () => new Date().toISOString(),
	today: () => new Date().toISOString().slice(0, 10),
	year: () => new Date().toISOString().slice(0, 4),
	month: () => new Date().toISOString().slice(5, 7),
	hour: () => new Date().toISOString().slice(11, 13),
	minute: () => new Date().toISOString().slice(14, 16),
	second: () => new Date().toISOString().slice(17, 19),
	epoch: () => String(Math.floor(Date.now() / 1000)),
	timestamp: () => String(Math.floor(Date.now() / 1000)),
	clock: () => new Date().toISOString().slice(11, 19),
	utcdate: () => new Date().toISOString().slice(0, 10),
	utctime: () => new Date().toISOString().slice(11, 19),

	// Weather for the visitor coordinates. Open-Meteo is free and needs no
	// key. Each host asks for only the one field it returns, so the response
	// is as small as the API will make it.
	temp: (request) => weather(request, "temperature_2m"),
	tempc: (request) => weather(request, "temperature_2m"),
	celsius: (request) => weather(request, "temperature_2m"),
	tempf: (request) => weather(request, "temperature_2m", "fahrenheit"),
	fahrenheit: (request) => weather(request, "temperature_2m", "fahrenheit"),
	feels: (request) => weather(request, "apparent_temperature"),
	humidity: (request) => weather(request, "relative_humidity_2m"),
	wind: (request) => weather(request, "wind_speed_10m"),
	clouds: (request) => weather(request, "cloud_cover"),
	precip: (request) => weather(request, "precipitation"),
	elevation: (request) => elevation(request),
	elev: (request) => elevation(request),
	sunrise: (request) => daily(request, "sunrise"),
	sunset: (request) => daily(request, "sunset"),
	wmo: (request) => weather(request, "weather_code"),
	// A missing code must stay missing. Number("") is 0, and 0 is "clear sky",
	// so an empty answer would be reported as fine weather.
	weather: async (request) => {
		const code = (await weather(request, "weather_code")).trim();
		return code === "" ? "" : describeWeather(Number(code));
	},
};

// WMO weather interpretation codes, the standard table Open-Meteo documents.
// A number is not useful on its own, so weather turns it into words.
const WMO = {
	0: "clear sky",
	1: "mainly clear",
	2: "partly cloudy",
	3: "overcast",
	45: "fog",
	48: "rime fog",
	51: "light drizzle",
	53: "moderate drizzle",
	55: "dense drizzle",
	56: "light freezing drizzle",
	57: "dense freezing drizzle",
	61: "slight rain",
	63: "moderate rain",
	65: "heavy rain",
	66: "light freezing rain",
	67: "heavy freezing rain",
	71: "slight snowfall",
	73: "moderate snowfall",
	75: "heavy snowfall",
	77: "snow grains",
	80: "slight rain showers",
	81: "moderate rain showers",
	82: "violent rain showers",
	85: "slight snow showers",
	86: "heavy snow showers",
	95: "thunderstorm",
	96: "thunderstorm with hail",
	97: "heavy thunderstorm",
	99: "thunderstorm with heavy hail",
};

const describeWeather = (code) => WMO[code] ?? "";

// Exported so a test can check every code is present, and so the table can be
// reused without the rest of the module.
export const wmoCodes = WMO;

const weather = async (request, field, unit) => {
	const coords = coordinates(request);
	if (!coords) return "";
	try {
		const url = new URL("https://api.open-meteo.com/v1/forecast");
		url.searchParams.set("latitude", coords.lat);
		url.searchParams.set("longitude", coords.lon);
		url.searchParams.set("current", field);
		url.searchParams.set("timezone", "UTC");
		if (unit) url.searchParams.set("temperature_unit", unit);
		const response = await fetch(url, { headers: { accept: "application/json" } });
		if (!response.ok) return "";
		const value = (await response.json()).current?.[field];
		return value == null ? "" : String(value);
	} catch {
		return "";
	}
};

// Elevation sits beside current, not inside it, so it needs its own shape.
const elevation = async (request) => {
	const coords = coordinates(request);
	if (!coords) return "";
	try {
		const url = new URL("https://api.open-meteo.com/v1/forecast");
		url.searchParams.set("latitude", coords.lat);
		url.searchParams.set("longitude", coords.lon);
		url.searchParams.set("current", "temperature_2m");
		const response = await fetch(url, { headers: { accept: "application/json" } });
		if (!response.ok) return "";
		const value = (await response.json()).elevation;
		return value == null ? "" : String(value);
	} catch {
		return "";
	}
};

// Sunrise and sunset are daily fields, and daily needs a timezone parameter.
const daily = async (request, field) => {
	const coords = coordinates(request);
	if (!coords) return "";
	try {
		const url = new URL("https://api.open-meteo.com/v1/forecast");
		url.searchParams.set("latitude", coords.lat);
		url.searchParams.set("longitude", coords.lon);
		url.searchParams.set("daily", field);
		url.searchParams.set("timezone", "UTC");
		const response = await fetch(url, { headers: { accept: "application/json" } });
		if (!response.ok) return "";
		const value = (await response.json()).daily?.[field]?.[0];
		return value == null ? "" : String(value);
	} catch {
		return "";
	}
};

// "30.2672,-97.7431" with both halves proven to be numbers, or null.
const coordinates = (request) => {
	const lat = Number(readField("latitude", request));
	const lon = Number(readField("longitude", request));
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	return { lat: String(lat), lon: String(lon) };
};

// RIPE RIS WHOIS, free and keyless, covers all five registries. It answers
// with the allocation that holds the address: its name, range and CIDR.
//
// CEILING: rdap.org would be the tidier source, since RDAP is the successor to
// WHOIS, but it answers 403 to Cloudflare's own network. Calling a RIR
// directly needs the IANA bootstrap file to know which one, and Snippets
// cannot cache it. RIPE RIS needs no lookup and no key, so it goes last.
const whois = async (ip) => {
	if (!ip) return {};
	try {
		const response = await fetch(
			`https://stat.ripe.net/data/whois/data.json?resource=${encodeURIComponent(ip)}`,
			{ headers: { accept: "application/json" } },
		);
		if (!response.ok) return {};
		const records = (await response.json()).data?.records;
		const first = Array.isArray(records) ? records[0] : null;
		if (!Array.isArray(first)) return {};
		const fields = {};
		for (const field of first) {
			if (typeof field.key === "string" && typeof field.value === "string") {
				fields[field.key] = field.value;
			}
		}
		return fields;
	} catch {
		return {};
	}
};

// RIPE RIS routing history, free and keyless. Returns the announced prefix,
// which is usually the same block but can be tighter than the allocation.
const announcedPrefix = async (ip) => {
	if (!ip) return "";
	try {
		const response = await fetch(
			`https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(ip)}`,
			{ headers: { accept: "application/json" } },
		);
		if (!response.ok) return "";
		const prefix = (await response.json()).data?.prefix;
		return typeof prefix === "string" ? prefix : "";
	} catch {
		return "";
	}
};

// DNS over HTTPS, using Cloudflare's own resolver so no third party sees the
// lookup. The zone owner is Cloudflare, so this stays inside one company.
const DOH = "https://cloudflare-dns.com/dns-query";

const resolve = async (name, type) => {
	if (!name) return [];
	try {
		const url = `${DOH}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
		const response = await fetch(url, { headers: { accept: "application/dns-json" } });
		if (!response.ok) return [];
		const answers = (await response.json()).Answer;
		if (!Array.isArray(answers)) return [];
		return answers
			.filter((a) => a.type === typeNumber(type))
			.map((a) => String(a.data).replace(/\.$/, ""));
	} catch {
		return [];
	}
};

const TYPE_NUMBERS = { PTR: 12, A: 1, AAAA: 28, NS: 2 };
const typeNumber = (type) => TYPE_NUMBERS[type] ?? 0;

const ipOf = (request) => request.headers.get("CF-Connecting-IP") ?? request.cf?.ip ?? "";

// "50.88.174.31" -> "31.174.88.50.in-addr.arpa"
const reverseName = (ip) =>
	ip.includes(":")
		? nibbles(ip, 8) + ".ip6.arpa"
		: ip.split(".").reverse().join(".") + ".in-addr.arpa";

// "50.88.174.31" -> "31.174.88.in-addr.arpa", the block a resolver is
// authoritative for.
const reverseZone = (ip) =>
	ip.includes(":")
		? nibbles(ip, 4) + ".ip6.arpa"
		: ip.split(".").slice(1).reverse().join(".") + ".in-addr.arpa";

// Writes an IPv6 address as reversed nibbles, which is how ip6.arpa reads.
// IPv6 text can be short, so pad it to the full 32 hex digits first.
const nibbles = (ip, groups) => {
	const [head = "", tail = ""] = ip.split("::");
	const out = [...head.split(":"), ...Array(8 - head.split(":").length).fill("0"), ...tail.split(":")];
	const hex = out.map((g) => g.padStart(4, "0")).join("");
	return [...hex].slice(0, groups * 4).reverse().join(".");
};

const pair = (request) => {
	const lat = readField("latitude", request);
	const lon = readField("longitude", request);
	return lat != null && lon != null ? `${lat},${lon}` : null;
};

// "colo" -> the value for the colo host, or null when Cloudflare sent none.
// Async because a few hosts ask a DNS resolver.
const readHost = async (label, request) => {
	const derived = DERIVED[label];
	if (derived) {
		const value = await derived(request);
		return value == null || value === "" ? null : String(value);
	}

	for (const name of HOSTS[label] ?? []) {
		const value = readField(name, request);
		if (value === undefined || value === null || value === "") continue;
		return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
	}
	return null;
};

// Hosts that answer with a whole page instead of a single value.
const PAGES = { map: mapPage };

// Labels for the host maps, joined for the Snippet rule expression.
// deploy.sh writes this into the rule, so the rule and the map cannot drift.
export const hostLabels = [
	...Object.keys(HOSTS),
	...Object.keys(DERIVED),
	...Object.keys(PAGES),
];

const page = (body) =>
	new Response(body, {
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
		},
	});

export default {
	async fetch(request) {
		const url = new URL(request.url);
		const ip = request.headers.get("CF-Connecting-IP") ?? request.cf?.ip ?? "unknown";
		const label = url.hostname.split(".")[0];
		const inZone = url.hostname.endsWith(".jasontally.com");

		const wantsPage =
			url.pathname === "/whoami" || url.searchParams.get("whoami") === "";

		// /whoami always gives the details page, on every host.
		if (wantsPage) return page(detailsPage(request, ip));

		// These hosts answer with a page, not a value.
		if (inZone && label in PAGES) return page(PAGES[label](request));

		// A subdomain answers with one value, so shell scripts can read it.
		// The zone check keeps an unrelated host such as city.example.com out.
		if (inZone && hostLabels.includes(label) && label !== "ip") {
			// A known host with no data answers with an empty line. It must not
			// fall through to the IP address, or a missing field would look
			// like a result. curl sends no Accept-Language, so lang is often
			// empty, and Cloudflare sends no JA3 for most requests.
			return plain((await readHost(label, request)) ?? "");
		}

		return plain(ip);
	},
};
