#!/usr/bin/env bash
# Deploys the Snippet, its rule, and the DNS record with the cf CLI.
#
#   read -rs -p "Cloudflare API token: " CF && CLOUDFLARE_API_TOKEN="$CF" ./deploy.sh
#
# Or authenticate once with `cf auth login` and run ./deploy.sh with no token.
set -euo pipefail

ACCOUNT_ID=74036ee9a61ce6ac5682b2eade8dfb82
ZONE_ID=b540f8f1930727dace12f79100e7b9d2
ZONE=jasontally.com
HOST=ip.$ZONE
SNIPPET_NAME=icanhazip
# RFC 6666 IPv6 discard prefix. Snippets answer before the origin, so this is
# never contacted. It exists only so the request reaches the Cloudflare edge.
ORIGIN=100::1
# A Snippet rule expression may hold 4096 characters. This is the ceiling the
# API enforces, measured against this zone.
MAX_EXPRESSION=4096

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CF=(cf --quiet --zone "$ZONE_ID")

command -v cf >/dev/null || { echo "cf not found. Install it with: npm i -g cf" >&2; exit 1; }
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || echo "note: no CLOUDFLARE_API_TOKEN set, relying on cf auth login"

step() { printf '\n== %s\n' "$1"; }

# Read the host labels out of the Snippet itself, so the DNS records and the
# rule can never disagree with the code that answers.
labels="$(node --input-type=module -e '
import { hostLabels } from "'"$ROOT"'/snippet.js";
process.stdout.write(hostLabels.join("\n"));
')"

# Build the one rule expression. A set costs less than a chain of eq tests.
expression="$(node -e '
const labels = process.argv[1].split("\n").filter(Boolean);
const zone = process.argv[2];
const hosts = labels.map((label) => `${label}.${zone}`);
process.stdout.write(`(http.host in {${hosts.map((h) => JSON.stringify(h)).join(" ")}})`);
' "$labels" "$ZONE")"

size=${#expression}
if [ "$size" -gt "$MAX_EXPRESSION" ]; then
	echo "rule expression is $size characters, over the $MAX_EXPRESSION limit." >&2
	echo "Split the hosts across a second Snippet and its own rule." >&2
	exit 1
fi
count="$(printf '%s\n' "$labels" | grep -c .)"
echo "rule expression is $size of $MAX_EXPRESSION characters, $count hosts"

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

step "Snippet: $SNIPPET_NAME"
# CEILING: cf v1.0.0-beta.10 appends the code as multipart part "file", but the
# Snippets API needs that part named "files", so the CLI upload is expected to
# fail. The curl fallback sends the part name the API documents.
# Remove the fallback once cf sends "files" (cloudflare/cf, packages/cli snippets update).
if ! "${CF[@]}" snippets update "$SNIPPET_NAME" \
	--file "@$ROOT/snippet.js" \
	--metadata '{"main_module":"snippet.js"}'; then
	echo "cf could not upload the code, falling back to the documented multipart form" >&2
	curl -fsS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/snippets/$SNIPPET_NAME" \
		-X PUT \
		-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
		-F "files=@$ROOT/snippet.js" \
		-F 'metadata={"main_module":"snippet.js"}' >/dev/null
	echo "uploaded"
fi

step "Snippet rule: $count hosts"
# PUT replaces the whole rule list, so keep every rule that is already there.
rules_file="$(mktemp)"
trap 'rm -f "$rules_file"' EXIT
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
const kept = (current.result ?? current).filter((rule) => rule.snippet_name !== mine.snippet_name);
writeFileSync(process.argv[1], JSON.stringify({ rules: [...kept, mine] }, null, 2));
' "$rules_file" "$expression"
# CEILING: --rules wants the JSON array itself, so a temp path does not work
# here. --body takes the {"rules": [...]} object and does accept @path.
"${CF[@]}" snippets rules update --body "@$rules_file"

step "Done"
echo "  curl https://$HOST"
echo "  curl https://$HOST/whoami"
while read -r label; do
	[ -n "$label" ] && printf '  curl https://%s.%s\n' "$label" "$ZONE"
done <<<"$labels"
echo "  account $ACCOUNT_ID needs no token of its own; Snippets are zone scoped"
