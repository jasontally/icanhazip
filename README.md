# icanhazip

An [icanhazip.com](https://icanhazip.com) clone that runs as a
[Cloudflare Snippet](https://developers.cloudflare.com/rules/snippets/) on
`ip.jasontally.com`. No Worker, no origin server, no build step.

```console
$ curl https://ip.jasontally.com/
203.0.113.7
```

## Behaviour

| Request                       | Response                                    |
| ----------------------------- | ------------------------------------------- |
| `https://ip.jasontally.com/`  | the visitor IP address and nothing else     |
| `https://ip.jasontally.com/anything?x=1` | the same plain IP address        |
| `https://ip.jasontally.com/?whoami` | an HTML page with every known field  |
| `https://ip.jasontally.com/whoami` | the same HTML page                |
| `https://city.jasontally.com/` | one data point about the visitor            |
| any other hostname            | not run, the snippet rule does not match    |

## One data point per subdomain

Every subdomain answers with one value and nothing else, so a shell script can
read it.

```console
$ curl https://city.jasontally.com/
Melbourne
$ echo "You appear to be in $(curl -s https://city.jasontally.com/)"
You appear to be in Melbourne
```

| Subdomain | Value | Cloudflare field |
| --- | --- | --- |
| `ip` | IP address | `CF-Connecting-IP` |
| `city` | City | `city` |
| `zip`, `zipcode`, `postal`, `postcode` | Postal code | `postalCode` |
| `country`, `co`, `cc` | Country code | `country` |
| `region`, `geo`, `st` | Region, or the code | `region`, then `regionCode` |
| `continent` | Continent code | `continent` |
| `timezone`, `tz` | IANA time zone | `timezone` |
| `lat`, `lon` | One coordinate each | `latitude`, `longitude` |
| `latlong`, `latlon`, `latlng` | Both coordinates, comma separated | `latitude`, `longitude` |
| `colo`, `edge` | Data centre code | `colo` |
| `asn` | Autonomous system number | `asn` |
| `as`, `isp`, `org` | Autonomous system name | `asOrganization` |
| `http`, `proto` | Protocol | `httpProtocol` |
| `tls` | TLS version | `tlsVersion` |
| `cipher` | TLS cipher | `tlsCipher` |
| `rtt` | Client RTT in ms | `clientTcpRtt` |
| `bot` | Bot score, 1 to 99 | `botManagement.score` |
| `metro`, `dma` | Metro code | `metroCode` |
| `eu` | `true` or `false` | `isEUCountry` |
| `ray` | Cloudflare Ray ID | `cf-ray` header |
| `utc` | Request time, ISO 8601 | computed |
| `ua` | User agent | `User-Agent` header |
| `lang` | Accepted languages | `Accept-Language` header |
| `ja3`, `ja4` | TLS fingerprints | `tlsJa3Hash`, `tlsJa4` |

41 hosts in all. A few of them are often empty, and they answer with an empty
line rather than the IP address. `curl` sends no `Accept-Language`, so `lang`
is empty for most shell use. Cloudflare sends `ja3` and `ja4` only for some
requests.

```console
$ curl https://lang.jasontally.com/
$ [ -n "$(curl -s https://lang.jasontally.com/)" ] && echo "browser" || echo "no language sent"
no language sent
```

`/whoami` on any of these hosts still gives the HTML page, so you can read one
value or read everything.

The values are approximate. Cloudflare derives them from the network, not from
a GPS fix, so `city` can be the city centre and `zip` can be the wrong one.

`request.cf` carries 59 fields. These 41 cover the ones with a name people ask
for. The rest are TLS handshake transcripts, certificate blobs,
`tlsExportedAuthenticator`, `edgeL4`, `requestPriority` and
`verifiedBotCategory`. None has a common name, so no subdomain holds them.

### One Snippet, one rule

All 41 hosts share one Snippet and one rule. The rule is a set test:

```
(http.host in {"ip.jasontally.com" "city.jasontally.com" ...})
```

A rule expression holds at most 4096 characters. The current rule is 921, so
there is room for about 190 hosts before a second Snippet is needed.
`deploy.sh` measures the expression and stops if it would pass the limit.

`deploy.sh` reads the host list out of `snippet.js`, so the DNS records, the
rule, and the code that answers can never disagree.

### What limits this, and which one binds first

Snippets have three limits. Two are comfortable. One is the ceiling.

| Limit | Now | Allowed | Used |
| --- | --- | --- | --- |
| Source size | 11901 bytes | 32768 | 36% |
| Rule expression | 921 chars | 4096 | 23% |
| Execution time | 0.03 ms | 5 ms | 0.6% |

**The rule expression is the limit that binds.** A rule may hold 4096 characters
and each host costs about 21, so one Snippet reaches roughly 190 hosts. The
source would fit about 1000 more, and execution time does not grow at all,
because the handler looks up one key in an object instead of walking a list.

`deploy.sh` measures the expression before it sends anything and stops if it
would pass 4096. At that point the fix is a second Snippet with the overflow
hosts, not a bigger one.

Execution time stays low because there are no subrequests and no `fetch()`. The
whole handler builds a string and returns it.

```console
$ npm run bench:cost
colo.jasontally.com   median 0.0300 ms   0.60% of the 5 ms budget
```

A wildcard rule would remove the 4096 character limit, but it is not usable
here. `http.host matches` needs a Business plan, and `http.host contains
"jasontally.com"` was accepted by the API yet stopped the Snippet from running
at all. The explicit set of hostnames stays.

The plain response is `text/plain`, holds the IP address from
`CF-Connecting-IP`, ends in a newline, and carries `Cache-Control: no-store`,
so no address is ever cached. `whoami` must be the whole query string, so
`?whoami=0` gets the plain IP address.

The `whoami` page shows the request, location, network, TLS and browser
sections, then dumps every request header and the whole `request.cf` object as
JSON. The dump means new Cloudflare fields show up with no code change.

Under Location there is an interactive Leaflet map with a marker at the
approximate coordinates. It loads Leaflet from unpkg.com and tiles from
tile.openstreetmap.org, both pinned by SRI, so the page is no longer private
to the visitor. A link below the map removes it and stops the tile requests.
The upstream [cf-whoami-snippet](https://github.com/xyTom/cf-whoami-snippet)
does not do this. It only builds an OpenStreetMap URL, which this project also
has as a plain link next to the map.

## Deploy

```console
npm i -g cf
read -rs -p "Cloudflare API token: " CF && CLOUDFLARE_API_TOKEN="$CF" ./deploy.sh
```

`deploy.sh` reads the host list out of `snippet.js`, creates any missing DNS
records, uploads the code, and puts the rule in place. It is safe to run again,
and it will not touch other Snippet rules in the zone.

`cf auth login` also works. It stores a credential in your keyring and needs
no token in the environment.

### API token

Create a token at
<https://dash.cloudflare.com/profile/api-tokens> with:

| Permission         | Access | Why                                      |
| ------------------ | ------ | ---------------------------------------- |
| Zone / Snippets    | Edit   | upload the code and set the rule          |
| Zone / DNS         | Edit   | create the `ip` AAAA record               |
| Zone / Zone        | Read   | let `cf` resolve the zone                 |

Scope it to Zone `jasontally.com` only. Account `74036ee9a61ce6ac5682b2eade8dfb82`
holds the zone. Snippets are zone scoped, so the account ID is not used by the
Snippets API itself.

### The DNS records

Snippets run before the origin and this Snippet never calls `fetch()`, so no
origin is contacted. A proxied record for each host must still exist, because
Snippets only run on requests that reach the Cloudflare edge. Each record is an
AAAA to `100::1`, from the RFC 6666 IPv6 discard prefix, which is never
routable.

### Known ceiling

Two `cf` v1.0.0-beta.10 bugs are worked around in `deploy.sh`. Both are marked
in the file with a CEILING comment.

1. `cf snippets update` sends the code as multipart part `file`, but the API
   needs that part named `files`, so the call fails. `deploy.sh` tries `cf`
   first, then falls back to the documented `curl` form.
2. `cf snippets rules update --rules` does not accept an `@path`, though its
   own help text says it does. `--body "@path"` works, so `deploy.sh` uses
   that.

Remove both workarounds once `cf` is fixed.

## Test

```console
npm test
```

`node --test` runs against a fake `Request`, so no network or account is
needed.

## Benchmark

```console
npm run bench
```

`bench.mjs` fetches `icanhazip.com` and checks this Snippet against it. The
address from the live call goes into the Snippet, so the two bodies hold the
same string and a byte comparison means something.

The main page body equals the icanhazip.com body byte for byte. Both answer
`<address>\n` with `content-type: text/plain`,
`access-control-allow-origin: *` and `access-control-allow-methods: GET`.

The Snippet sends two things that icanhazip.com does not send:

| Difference                    | Why                                          |
| ----------------------------- | -------------------------------------------- |
| `cache-control: no-store`     | keeps an address out of the edge cache       |
| the details page at `whoami` | the one feature of this project              |

`icanhazip.com` also sends `set-cookie`, `cf-ray`, `alt-svc` and `server`.
Cloudflare adds most of these on its own.

The timing lines in `bench.mjs` are not a comparison. The icanhazip number is a
full network round trip. The Snippet number is only the JavaScript, with no
network and no edge. Measure the real end to end time after deploy.

## Files

| File                  | Purpose                                    |
| --------------------- | ------------------------------------------ |
| `snippet.js`          | the Snippet, the only file Cloudflare runs |
| `deploy.sh`           | DNS, code and rule deployment through `cf` |
| `bench.mjs`           | byte and header check against icanhazip.com |
| `cost.mjs`            | measures size, rule size and execution time |
| `test/snippet.test.js`| checks for both response shapes            |
