#!/usr/bin/env bash
# Deploys the Snippet, its rule, and the DNS record with the cf CLI.
#
#   read -rs -p "Cloudflare API token: " CF && CLOUDFLARE_API_TOKEN="$CF" ./deploy.sh
#
# Or authenticate once with `cf auth login` and run ./deploy.sh with no token.
set -euo pipefail

ACCOUNT_ID=74036ee9a61ce6ac5682b2eade8dfb82
ZONE_ID=b540f8f1930727dace12f79100e7b9d2
HOST=ip.jasontally.com
SNIPPET_NAME=icanhazip
# RFC 6666 IPv6 discard prefix. Snippets answer before the origin, so this is
# never contacted. It exists only so the request reaches the Cloudflare edge.
ORIGIN=100::1

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CF=(cf --quiet --zone "$ZONE_ID")

command -v cf >/dev/null || { echo "cf not found. Install it with: npm i -g cf" >&2; exit 1; }
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || echo "note: no CLOUDFLARE_API_TOKEN set, relying on cf auth login"

step() { printf '\n== %s\n' "$1"; }

step "DNS: $HOST AAAA -> $ORIGIN (proxied)"
existing="$("${CF[@]}" dns records list --name "$HOST" --type AAAA)"
if printf '%s' "$existing" | grep -q '"content"'; then
	echo "already present, leaving it alone"
else
	"${CF[@]}" dns records create --body \
		"$(printf '{"type":"AAAA","name":"%s","content":"%s","ttl":1,"proxied":true}' "$HOST" "$ORIGIN")"
fi

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

step "Snippet rule: $HOST"
# PUT replaces the whole rule list, so keep every rule that is already there.
rules_file="$(mktemp)"
trap 'rm -f "$rules_file"' EXIT
"${CF[@]}" snippets rules list >"$rules_file"
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const mine = {
	description: "icanhazip: plain IP on /, full details on /whoami",
	enabled: true,
	expression: "http.host eq \"ip.jasontally.com\"",
	snippet_name: "icanhazip",
};
const current = JSON.parse(readFileSync(process.argv[1], "utf8"));
const kept = (current.result ?? current).filter((rule) => rule.snippet_name !== mine.snippet_name);
writeFileSync(process.argv[1], JSON.stringify({ rules: [...kept, mine] }, null, 2));
' "$rules_file"
"${CF[@]}" snippets rules update --rules "@$rules_file"
echo "expression: http.host eq \"$HOST\""

step "Done"
echo "  curl https://$HOST"
echo "  curl https://$HOST/whoami"
echo "  account $ACCOUNT_ID needs no token of its own; Snippets are zone scoped"
