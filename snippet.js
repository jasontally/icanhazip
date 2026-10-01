// SPDX-License-Identifier: MIT
//
// icanhazip clone for ip.jasontally.com, as a Cloudflare Snippet.
//
//   https://ip.jasontally.com/            ->  "<visitor ip>\n"   text/plain
//   https://ip.jasontally.com/whoami      ->  HTML page with every field
//   https://ip.jasontally.com/?whoami     ->  same page
//   https://ip.jasontally.com/?anything   ->  "<visitor ip>\n"
//   any other hostname                    ->  not run (snippet rule)
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

export default {
	async fetch(request) {
		const url = new URL(request.url);
		const ip = request.headers.get("CF-Connecting-IP") ?? request.cf?.ip ?? "unknown";

		const wantsPage =
			url.pathname === "/whoami" || url.searchParams.get("whoami") === "";

		if (!wantsPage) {
			return new Response(`${ip}\n`, {
				headers: {
					"content-type": "text/plain; charset=utf-8",
					"cache-control": "no-store",
					"access-control-allow-origin": "*",
				},
			});
		}

		return new Response(detailsPage(request, ip), {
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
			},
		});
	},
};
