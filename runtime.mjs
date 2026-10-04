// Compares the readable source against a minified build for run time.
// Run with: npm run bench:runtime
//
// Minifying makes the file smaller. The question here is whether it also makes
// the handler slower, because V8 has to parse the file once per isolate and
// then the JIT works from bytecode either way.

import { statSync } from "node:fs";
import { execFileSync } from "node:child_process";

const build = "/tmp/opencode/runtime-build.js";
execFileSync(
	"sfw",
	["npx", "--yes", "esbuild", "snippet.js", "--format=esm", "--minify", "--log-level=error", `--outfile=${build}`],
	{ env: { ...process.env, SFW_SKIP_UPDATE_CHECK: "1" } },
);

const cf = {
	city: "Melbourne", region: "Florida", regionCode: "FL", postalCode: "32940",
	metroCode: "534", country: "US", continent: "NA", latitude: 28.2061,
	longitude: -80.685, timezone: "America/New_York", asn: 33363,
	asOrganization: "Charter Communications, Inc", colo: "MIA",
	httpProtocol: "HTTP/3", tlsVersion: "TLSv1.3", isEUCountry: false,
	botManagement: { score: 99 }, tlsClientAuth: {}, tlsExportedAuthenticator: {},
};

const make = (label) => {
	const request = new Request(`https://${label}.jasontally.com/`, {
		headers: { "CF-Connecting-IP": "50.88.174.31", "CF-Ray": "a43ee898db16335f-DFW" },
	});
	request.cf = cf;
	return request;
};

const timeOne = async (snippet, label) => {
	const start = process.hrtime.bigint();
	const response = await snippet.fetch(make(label));
	await response.text();
	return Number(process.hrtime.bigint() - start) / 1e6;
};

// Run each build in its own process, because both modules export the same
// names and the first import would win in a shared process.
const measure = async (file, label, runs) => {
	const script = `
		const m = await import(${JSON.stringify(file)});
		const cf = ${JSON.stringify(cf)};
		const make = () => {
			const r = new Request("https://${label}.jasontally.com/", {
				headers: { "CF-Connecting-IP": "50.88.174.31", "CF-Ray": "a43ee898db16335f-DFW" },
			});
			r.cf = cf;
			return r;
		};
		for (let i = 0; i < 2000; i++) await (await m.default.fetch(make())).text();
		const samples = [];
		for (let i = 0; i < ${runs}; i++) {
			const s = process.hrtime.bigint();
			await (await m.default.fetch(make())).text();
			samples.push(Number(process.hrtime.bigint() - s) / 1e6);
		}
		samples.sort((a, b) => a - b);
		process.stdout.write(String(samples[Math.floor(samples.length / 2)]));
	`;
	return Number(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }));
};

const source = new URL("./snippet.js", import.meta.url).pathname;
const sourceSize = statSync(source).size;
const buildSize = statSync(build).size;

console.log(`source ${sourceSize} bytes, minified ${buildSize} bytes\n`);
console.log("handler time, median of 20000 calls after 2000 warmup calls");
console.log("the Snippet limit is 5 ms per request\n");

for (const label of ["colo", "ip", "geo", "date"]) {
	const a = await measure(source, label, 20000);
	const b = await measure(build, label, 20000);
	const which = b < a ? "minified is faster" : a < b ? "source is faster" : "the same";
	console.log(
		`  ${`${label}.jasontally.com`.padEnd(24)} source ${a.toFixed(4)} ms   ` +
			`minified ${b.toFixed(4)} ms   ${which}`,
	);
}