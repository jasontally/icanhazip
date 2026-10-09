#!/usr/bin/env bash
# Deploys the Snippet, its rule, and the DNS records with the cf CLI.
#
#   CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ZONE_ID=<zone id> ./deploy.sh
#
# Or authenticate once with `cf auth login` and run ./deploy.sh with no token.
#
# Three modes, because Cloudflare's CI asks for two commands and this is both of
# them. Workers Builds has no Snippets support of its own: wrangler has no
# `snippets` subcommand, and a Snippet is a zone-level Rules resource rather than
# a Worker artifact. So the build command minifies, the deploy command runs this
# file in `deploy` mode, and the API token it holds does the rest.
#
#   ./deploy.sh          build into dist/, then deploy. The local default.
#   ./deploy.sh build    minify into dist/ and stop. No token, no zone ID.
#   ./deploy.sh deploy   deploy what dist/ holds. Fails if dist/ is missing.
#   npm run build        same as ./deploy.sh build
#   npm run deploy       same as ./deploy.sh deploy
set -euo pipefail

# Which half this run does. See the header: `build` is the CI build command and
# `deploy` is the CI deploy command, and they share the workspace, so dist/
# written by one is read by the other.
MODE="${1:-all}"
case "$MODE" in
	all | build | deploy) ;;
	*) echo "usage: $0 [all|build|deploy]" >&2; exit 1 ;;
esac

ACCOUNT_ID=74036ee9a61ce6ac5682b2eade8dfb82
# Both deploy modes talk to the zone, so both need the zone ID. A build does not.
if [ "$MODE" != build ]; then
	: "${CLOUDFLARE_ZONE_ID:?set CLOUDFLARE_ZONE_ID to the zone id}"
fi
ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"
ZONE="${CLOUDFLARE_ZONE_NAME:-jasontally.com}"
HOST=ip.$ZONE
SNIPPET_NAME=icanhazip
# RFC 6666 IPv6 discard prefix. Snippets answer before the origin, so this is
# never contacted. It exists only so the request reaches the Cloudflare edge.
ORIGIN=100::1
# A Snippet rule expression may hold 4096 characters. This is the ceiling the
# API enforces, measured against this zone.
MAX_EXPRESSION=4096
# A Snippet source may hold 32768 bytes.
MAX_SOURCE=32768

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CF=(cf --quiet --zone "$ZONE_ID")
API="https://api.cloudflare.com/client/v4/zones/$ZONE_ID/snippets"

command -v node >/dev/null || { echo "node not found" >&2; exit 1; }
# `cf` is only needed to deploy. The CI build image has no `cf` in it, so the
# deploy command there installs it first.
if [ "$MODE" != build ]; then
	command -v cf >/dev/null || { echo "cf not found. Install it with: npm i -g cf" >&2; exit 1; }
fi

# Fail before touching anything if the token is not usable. A missing token used
# to make the code upload fail quietly, which left the zone serving old DNS.
# CEILING: cf auth login is accepted as an alternative, but this script always
# uses the token for the raw upload, so it cannot detect that case.
# A build skips this: it uploads nothing, so the CI build command runs with no
# token in its environment at all.
if [ "$MODE" != build ]; then
	[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || {
		echo "CLOUDFLARE_API_TOKEN is not set, so the code upload cannot run." >&2
		echo "Set it, or sign in first with: cf auth login" >&2
		exit 1
	}
fi

step() { printf '\n== %s\n' "$1"; }

die() { printf '%s\n' "$1" >&2; exit 1; }

# Build the one rule expression. A set costs less than a chain of eq tests.
expression_from() {
	node -e '
	const labels = process.argv[1].split("\n").filter(Boolean);
	const hosts = labels.map((label) => `${label}.${process.argv[2]}`);
	process.stdout.write(`(http.host in {${hosts.map((h) => JSON.stringify(h)).join(" ")}})`);
	' "$1" "$ZONE"
}

# A build needs no token: nothing is read and nothing is deployed. Both of the
# other modes do, and they are the ones that touch the zone.
#
# The deploy half also needs what the build half wrote. That is checked here,
# before the network, so a build that produced nothing fails with its own
# message rather than on a token verification.
if [ "$MODE" = deploy ]; then
	[ -f "$ROOT/dist/snippet.js" ] \
		|| die "$ROOT/dist/snippet.js is missing. Run 'npm run build' first."
fi
if [ "$MODE" != build ]; then
	step "Checking the token"
	verify="$(curl -fsS "https://api.cloudflare.com/client/v4/user/tokens/verify" \
		-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")" \
		|| die "the token was rejected by Cloudflare"
	printf '%s' "$verify" | grep -q '"status":"active"' \
		|| die "the token is not active: $verify"
	echo "  token active"
fi

build="$ROOT/dist"
built="$build/snippet.js"
if [ "$MODE" = deploy ]; then
	# The build command already wrote this. Every check below still has to hold,
	# or a dist/ left over from another branch would deploy itself.
	step "Using the build in $built"
else
	# Minifier. esbuild is fetched on demand, so there is no dependency to
	# install and nothing to commit. Set MINIFY to use a local copy instead.
	#
	# sfw is the socket firewall this machine puts npm behind. It is not in
	# Cloudflare's build image, where plain npm works, so the default depends on
	# which one is present and neither place has to remember a flag.
	#
	# Measured on this file.
	#   esbuild        16709 bytes
	#   terser plain   16848 bytes
	#   terser p3      16835 bytes
	#   terser max     16703 bytes   6 bytes smaller than esbuild, 0.02%
	#
	# esbuild is the default. The 6 byte difference is noise against a 32768 byte
	# limit, and esbuild does not use the unsafe_* transforms that terser max
	# needs, so it is the safer build. Minification does not change run time
	# either, see runtime.mjs. MINIFY='npx --yes terser' will switch.
	step "Building $SNIPPET_NAME.js"
	# The uploaded code is minified, because the 32768 byte limit applies to what
	# Cloudflare stores. snippet.js stays readable and is what the tests import.
	#
	# dist/ is where the build lands, and it is in .gitignore: every build
	# regenerates it. `deploy` reads what `build` wrote, which is what lets the
	# two run as separate commands in the same workspace.
	if [ -z "${MINIFY:-}" ]; then
		if command -v sfw >/dev/null 2>&1; then
			MINIFY="sfw npx --yes esbuild"
			# sfw fails on its root-owned cache without this.
			export SFW_SKIP_UPDATE_CHECK=1
		else
			MINIFY="npx --yes esbuild"
		fi
	fi
	mkdir -p "$build"
	# shellcheck disable=SC2086
	$MINIFY "$ROOT/snippet.js" --format=esm --minify --log-level=warning \
		--outfile="$built" || die "the minifier failed"
fi

source_bytes=$(wc -c <"$ROOT/snippet.js")
built_bytes=$(wc -c <"$built")
[ "$built_bytes" -le "$MAX_SOURCE" ] \
	|| die "minified source is $built_bytes bytes, over the $MAX_SOURCE limit"
printf '  %s bytes -> %s bytes (%.0f%% smaller), %s free of %s\n' \
	"$source_bytes" "$built_bytes" \
	"$(( (source_bytes - built_bytes) * 100 / source_bytes ))" \
	"$(( MAX_SOURCE - built_bytes ))" "$MAX_SOURCE"

# Read the host labels from the readable source for the rule, then prove the
# minified build has the same list. A mismatch means the rule and the code on
# the edge would disagree, which is the one failure that is hard to see.
labels="$(node --input-type=module -e '
import { hostLabels } from "'"$ROOT"'/snippet.js";
process.stdout.write(hostLabels.join("\n"));
')"
built_labels="$(node --input-type=module -e '
import { hostLabels } from "'"$built"'";
process.stdout.write(hostLabels.join("\n"));
')"
[ "$labels" = "$built_labels" ] \
	|| die "the minified build lists different hosts than the source"

expression="$(expression_from "$labels")"
size=${#expression}
[ "$size" -le "$MAX_EXPRESSION" ] \
	|| die "rule expression is $size characters, over the $MAX_EXPRESSION limit. Split the hosts across a second Snippet."
count="$(printf '%s\n' "$labels" | grep -c .)"
echo "  rule expression $size of $MAX_EXPRESSION characters, $count hosts"

# Everything that can be checked without touching the zone now has been, so a
# build stops here. The CI build command fails on any of the three checks above,
# so a broken build never reaches the deploy command.
if [ "$MODE" = build ]; then
	echo "  built $built"
	exit 0
fi

step "DNS: $count records, AAAA -> $ORIGIN (proxied)"
while read -r label; do
	[ -n "$label" ] || continue
	name="$label.$ZONE"
	existing="$("${CF[@]}" dns records list --name "$name" --type AAAA)"
	if printf '%s' "$existing" | grep -q '"content"'; then
		printf '  %-24s present\n' "$name"
		continue
	fi
	"${CF[@]}" dns records create --body \
		"$(printf '{"type":"AAAA","name":"%s","content":"%s","ttl":1,"proxied":true}' "$name" "$ORIGIN")" >/dev/null
	printf '  %-24s created\n' "$name"
done <<<"$labels"

step "DNS: removing records for hosts the Snippet no longer serves"
# A host removed from the maps must lose its DNS record too, or the name keeps
# resolving and returns a Cloudflare error for ever. This deletes only records
# that are unmistakably ours: a single-label name under the zone, type AAAA,
# pointing at the discard prefix. Any other record in the zone is left alone.
current="$(printf '%s\n' "$labels" | grep . | sort)"
stale="$("${CF[@]}" dns records list --type AAAA | node -e '
const records = JSON.parse(require("fs").readFileSync(0, "utf8"));
const zone = process.argv[1];
const origin = process.argv[2];
const keep = new Set(process.argv[3].split("\n"));
const suffix = "." + zone;
for (const record of records) {
	if (record.type !== "AAAA" || record.content !== origin) continue;
	const name = record.name;
	// One label under the zone only. Not @, not a subdomain, not *.zone.
	if (!name.endsWith(suffix)) continue;
	const label = name.slice(0, name.length - suffix.length);
	if (label.length === 0 || label.includes(".")) continue;
	if (keep.has(label)) continue;
	process.stdout.write(`${record.id} ${name}\n`);
}
' "$ZONE" "$ORIGIN" "$current")"
if [ -z "$stale" ]; then
	echo "  none"
else
	while read -r id name; do
		[ -n "$id" ] || continue
		# --force is required. Without it cf asks for confirmation, aborts in
		# a script, and still exits 0, so the record survived while this said
		# "removed". Confirm the record is gone rather than trusting the exit.
		"${CF[@]}" dns records delete --force "$id" >/dev/null 2>&1 || true
		left="$("${CF[@]}" dns records list --name "$name" --type AAAA \
			| grep -c '"id"' || true)"
		if [ "${left:-0}" -gt 0 ]; then
			die "$name is not in the Snippet, and its DNS record would not delete"
		fi
		printf '  %-24s removed\n' "$name"
	done <<<"$stale"
fi

step "Snippet: $SNIPPET_NAME"
# CEILING: cf v1.0.0-beta.10 appends the code as multipart part "file", but the
# Snippets API needs that part named "files", so the CLI upload cannot work.
# Remove the cf attempt once cloudflare/cf sends "files".
if "${CF[@]}" snippets update "$SNIPPET_NAME" \
	--file "@$build/snippet.js" \
	--metadata '{"main_module":"snippet.js"}' >/dev/null 2>&1; then
	echo "  cf uploaded the code"
else
	# -f makes curl fail the script on an error, so a rejected upload cannot
	# pass silently. That was the bug that left the zone on old DNS.
	status="$(curl -sS -o "$build/reply.json" -w '%{http_code}' \
		"$API/$SNIPPET_NAME" \
		-X PUT \
		-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
		-F "files=@$build/snippet.js" \
		-F 'metadata={"main_module":"snippet.js"}')" \
		|| die "the code upload failed and curl gave no status"
	[ "$status" = "200" ] || die "the code upload returned HTTP $status: $(cat "$build/reply.json")"
	grep -q '"success":true' "$build/reply.json" || die "the API refused the code: $(cat "$build/reply.json")"
	echo "  uploaded $built_bytes bytes"
fi

# Confirm the edge now holds what we sent, rather than trusting the reply. The
# content endpoint wraps the file in a multipart body, so hash the part and not
# the whole reply.
curl -fsS "$API/$SNIPPET_NAME/content" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
	-o "$build/stored.txt" || die "could not read the stored code back"

if node --input-type=module -e '
	import { createHash } from "node:crypto";
	import { readFileSync } from "node:fs";
	const [storedPath, builtPath] = process.argv.slice(1);
	const raw = readFileSync(storedPath, "utf8");
	// Skip the MIME headers before the file and the closing boundary after it.
	const body = raw
		.replace(/^[\s\S]*?\r?\n\r?\n/, "")
		.replace(/\r?\n--[\w-]+--[\s\S]*$/, "")
		.trim();
	const sha = (text) => createHash("sha256").update(text).digest("hex");
	// Compare trimmed, because the multipart wrapper drops the trailing
	// newline. Comparing raw made every deploy report a false mismatch.
	process.exit(sha(body) === sha(readFileSync(builtPath, "utf8").trim()) ? 0 : 1);
' "$build/stored.txt" "$build/snippet.js"; then
	echo "  confirmed on the edge, sha256 matches"
else
	echo "  warning: the code now on the edge is not the build we sent." >&2
	echo "  Snippets take a moment to apply. Check again in a minute." >&2
fi

step "Snippet rule: $count hosts"
# PUT replaces the whole rule list, so keep every rule that is already there.
# Two projects put Snippets on this zone: icanhazip and mcp_lookup. A single-rule
# list would delete the other one, so the list is merged rather than replaced.
rules_file="$(mktemp)"
after_file="$(mktemp)"
trap 'rm -f "$rules_file" "$after_file"' EXIT
"${CF[@]}" snippets rules list >"$rules_file"
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const mine = {
	description: `icanhazip: plain value on each subdomain, full details on /whoami (${process.argv[2].split(" ").length} hosts)`,
	enabled: true,
	expression: process.argv[2],
	snippet_name: "icanhazip",
};
const current = JSON.parse(readFileSync(process.argv[1], "utf8"));
// A list has arrived as a bare array, as {result: [...]}, as {rules: [...]},
// and once as {result: null} when the list call itself had already failed.
// Read all of them, and refuse anything else: writing a shorter rule list from
// a failed read would delete a rule this project does not own. The check after
// the PUT reads the same shapes.
const first = current?.result ?? current?.rules ?? current;
const list = Array.isArray(first) ? first : (first?.rules ?? first?.result);
if (!Array.isArray(list)) {
	throw new Error(`the rule list did not come back as a list: ${JSON.stringify(current).slice(0, 400)}`);
}
const kept = list.filter((rule) => rule.snippet_name !== mine.snippet_name);
writeFileSync(process.argv[1], JSON.stringify({ rules: [...kept, mine] }, null, 2));
' "$rules_file" "$expression"
# CEILING: --rules wants the JSON array itself, so a temp path does not work
# here. --body takes the {"rules": [...]} object and does accept @path.
"${CF[@]}" snippets rules update --body "@$rules_file"

# Read the list back and prove the rules this project does not own survived. A
# PUT that drops one answers 200 with the shorter list, so there is no other way
# to see it. Same shape as the DNS delete check above: confirm the state rather
# than trusting the reply. It matters more now that this runs unattended.
#
# Two shapes have been seen from `cf snippets rules list`: a bare array, and an
# envelope. The first read of this check crashed on an envelope whose `result`
# was null, because the list call had failed and null coalesces straight past to
# the envelope. Both shapes are read here, an unknown one prints what arrived,
# and a read that will not parse is retried, because a flaky read-back here
# would turn a deploy that already succeeded red.
after_file="$build/rules-after.json"
lost_file="$build/rules-lost.txt"
for attempt in 1 2 3; do
	"${CF[@]}" snippets rules list >"$after_file" 2>/dev/null || true
	if node --input-type=module -e '
import { readFileSync } from "node:fs";
// A list may arrive bare, or wrapped once in `result` or `rules`, or wrapped
// twice as {result: {rules: [...]}}. All of them end up here as an array.
const listOf = (body) => {
	const first = body?.result ?? body?.rules ?? body;
	const second = first?.rules ?? first?.result;
	return Array.isArray(first) ? first : Array.isArray(second) ? second : first;
};
const names = (path) => {
	const list = listOf(JSON.parse(readFileSync(path, "utf8")));
	if (!Array.isArray(list)) {
		console.error(`the rule list did not come back as a list: ${JSON.stringify(list).slice(0, 400)}`);
		process.exit(2);
	}
	return new Set(list.map((rule) => rule.snippet_name));
};
const before = names(process.argv[1]);
const after = names(process.argv[2]);
const lost = [...before].filter((name) => !after.has(name));
if (lost.length > 0) process.stdout.write(lost.join(", "));
' "$rules_file" "$after_file" >"$lost_file"; then
		break
	fi
	if [ "$attempt" = 3 ]; then
		die "could not read the rule list back, so it cannot be shown that the other project's rule survived. $(head -c 300 "$after_file")"
	fi
	sleep 2
done
if [ -s "$lost_file" ]; then
	die "the rule update dropped rule(s) this project does not own: $(cat "$lost_file"). Restore them from the API before anything else."
fi

step "Done"
echo "  curl https://$HOST"
echo "  curl https://$HOST/whoami"
while read -r label; do
	[ -n "$label" ] && printf '  curl https://%s.%s\n' "$label" "$ZONE"
done <<<"$labels"
echo "  account $ACCOUNT_ID needs no token of its own; Snippets are zone scoped"
