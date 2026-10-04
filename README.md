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
| `lat`, `latitude`, `lon`, `longitude` | One coordinate each | `latitude`, `longitude` |
| `geo`, `latlong`, `latlon`, `latlng` | Both coordinates, comma separated | `latitude`, `longitude` |
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
| `ua`, `useragent` | User agent | `User-Agent` header |
| `lang` | Accepted languages | `Accept-Language` header |
| `ja3`, `ja4` | TLS fingerprints | `tlsJa3Hash`, `tlsJa4` |
| `ver` | `4` or `6` | computed |
| `ip4`, `ipv4`, `v4` | The address, only for IPv4 | computed |
| `ip6`, `ipv6`, `v6` | The address, only for IPv6 | computed |
| `ptr`, `hostname` | Reverse DNS name | DNS lookup |
| `ns`, `nameserver` | Nameservers for the address block | DNS lookup |
| `dns` | Forward confirmed name | two DNS lookups |
| `net`, `netname` | Name of the allocation | WHOIS |
| `netblock`, `range` | Allocated range | WHOIS |
| `cidr` | Allocated CIDR | WHOIS |
| `prefix`, `bgp` | Announced prefix | BGP route |
| `map` | The map on its own page | page, not a value |
| `date`, `day`, `today`, `utcdate` | Date part of `utc` | computed |
| `time`, `utctime`, `clock` | Time part of `utc` | computed |
| `year`, `month`, `hour`, `minute`, `second` | One part each | computed |
| `epoch`, `timestamp` | Unix seconds | computed |
| `now` | The whole ISO string | computed |
| `temp`, `tempc`, `celsius` | Temperature in Celsius | weather |
| `tempf`, `fahrenheit` | Temperature in Fahrenheit | weather |
| `feels` | Apparent temperature | weather |
| `humidity`, `wind`, `clouds`, `precip` | Those readings | weather |
| `elevation`, `elev` | Metres above sea level | weather |
| `sunrise`, `sunset` | ISO times | weather |
| `wmo` | Numeric weather code | weather |
| `weather` | That code in words | weather |

98 hosts in all. A few of them are often empty, and they answer with an empty
line rather than the IP address. `curl` sends no `Accept-Language`, so `lang`
is empty for most shell use. Cloudflare sends `ja3` and `ja4` only for some
requests. `ip4` and `ip6` are one or the other, never both.

```console
$ curl https://lang.jasontally.com/
$ [ -n "$(curl -s https://lang.jasontally.com/)" ] && echo "browser" || echo "no language sent"
no language sent
```

### The DNS hosts

Five hosts ask a resolver over the network. They use
[`cloudflare-dns.com`](https://developers.cloudflare.com/1.1.1.1/dns/encryption/dns-over-https/)
in JSON form, so no third party sees the lookup. The zone owner is Cloudflare,
so the lookup stays inside one company.

```console
$ curl https://ptr.jasontally.com/
syn-050-088-174-031.res.spectrum.com
$ curl https://ns.jasontally.com/
ns2-rev.proxad.net ns3-rev.proxad.net
```

`ptr` and `hostname` ask for the PTR record of the visitor address.
`ns` and `nameserver` ask for the nameservers that are authoritative for the
block the address sits in, which is the /24 for IPv4 and the /64 for IPv6.
`dns` asks for the PTR record and then checks that it points back at the same
address, which is what a mail server checks before accepting mail. That is why
it is often empty. Many home ISPs publish a PTR name that has no forward
record, so forward confirmation fails.

These hosts cost a subrequest each. A Pro zone allows 2 subrequests per
request, and `dns` uses both. They also take longer than the other hosts,
about 120 ms to 400 ms against 90 ms, because the lookup is a network round
trip.

| Host | Subrequests |
| --- | --- |
| `ptr`, `hostname` | 1 |
| `ns`, `nameserver` | 1 |
| `dns` | 2 |

The WHOIS and BGP hosts below also cost one subrequest each.

`/whoami` on any of these hosts still gives the HTML page, so you can read one
value or read everything.

### The date and time hosts

These are slices of the same clock as `utc`, so they all agree with each other.

| Host | Value |
| --- | --- |
| `date`, `day`, `today`, `utcdate` | `2026-10-04` |
| `time`, `utctime`, `clock` | `14:39:51` |
| `year`, `month` | `2026`, `10` |
| `hour`, `minute`, `second` | `14`, `39`, `51` |
| `epoch`, `timestamp` | Unix seconds |
| `now` | the whole ISO string |

```console
$ curl https://date.jasontally.com/
2026-10-04
$ curl https://epoch.jasontally.com/
1791124791
```

Nothing leaves Cloudflare for these. They are string slices of `new Date()`.

### The weather hosts

Weather for the visitor coordinates, from
[Open-Meteo](https://open-meteo.com/), which is free and needs no API key. Each
host asks for only the one field it returns, so the response is as small as the
API will make it.

```console
$ curl https://temp.jasontally.com/
29.3
$ curl https://weather.jasontally.com/
mainly clear
$ curl https://sunset.jasontally.com/
2026-10-04T23:05
```

| Host | Value |
| --- | --- |
| `temp`, `tempc`, `celsius` | temperature in Celsius |
| `tempf`, `fahrenheit` | temperature in Fahrenheit |
| `feels` | apparent temperature |
| `humidity`, `wind`, `clouds`, `precip` | those readings |
| `elevation`, `elev` | metres above sea level |
| `sunrise`, `sunset` | ISO local times |
| `wmo` | the numeric WMO weather code |
| `weather` | that code in words |

These hosts send the visitor coordinates to Open-Meteo, a third party in
Switzerland. That is a different privacy posture from the DNS hosts, which stay
inside Cloudflare. The coordinates are the same coarse ones as `lat` and `lon`,
which `map` and `/whoami` already show.

### The address block

Cloudflare reports `asn` and `as`, which come from the routing registry. The
address block comes from the address registry instead, and is different data.

```console
$ curl https://as.jasontally.com/          # from Cloudflare, the ASN owner
Charter Communications, Inc
$ curl https://net.jasontally.com/         # from WHOIS, the allocation name
BHN
$ curl https://netblock.jasontally.com/
50.88.0.0 - 50.91.255.255
$ curl https://cidr.jasontally.com/
50.88.0.0/14
$ curl https://prefix.jasontally.com/      # what the network announces
50.88.0.0/15
```

Note that `cidr` and `prefix` can differ. The allocation is what the registry
recorded, the prefix is what the network announces in BGP, and the announced
block is sometimes tighter.

These hosts use RIPE RIS at `stat.ripe.net`, which is free, needs no key, and
answers for all five registries. RDAP is the tidier source, since it replaces
WHOIS, but `rdap.org` answers **403 to Cloudflare's own network**. Calling a
RIR directly needs the IANA bootstrap file to know which one, and a Snippet
cannot cache that. The ceiling and the upgrade path are in the comment above
`whois` in `snippet.js`.

### map.jasontally.com

This host is nothing but the map, filling the whole viewport, with the
coordinates you came from.

```console
$ curl -o /dev/null -w '%{http_code} %{size_download}\n' https://map.jasontally.com/
200 1920
```

It uses the same pinned Leaflet as `/whoami`. If Cloudflare sent no
coordinates, it says so and links to `/whoami` rather than showing an empty
map.

The values are approximate. Cloudflare derives them from the network, not from
a GPS fix, so `city` can be the city centre and `zip` can be the wrong one.

`request.cf` carries 59 fields. These 98 cover the ones with a name people ask
for. The rest are TLS handshake transcripts, certificate blobs,
`tlsExportedAuthenticator`, `edgeL4`, `requestPriority` and
`verifiedBotCategory`. None has a common name, so no subdomain holds them.

### One Snippet, one rule

All 98 hosts share one Snippet and one rule. The rule is a set test:

```
(http.host in {"ip.jasontally.com" "city.jasontally.com" ...})
```

A rule expression holds at most 4096 characters. The current rule is 1525, so
there is room for about 190 hosts before a second Snippet is needed.
`deploy.sh` measures the expression and stops if it would pass the limit.

`deploy.sh` reads the host list out of `snippet.js`, so the DNS records, the
rule, and the code that answers can never disagree.

### What limits this, and which one binds first

Snippets have three limits. Two are comfortable. One is the ceiling.

| Limit | Now | Allowed | Used |
| --- | --- | --- | --- |
| Source size, uploaded minified | 14852 bytes | 32768 | 45% |
| Rule expression | 2256 chars | 4096 | 55% |
| Execution time | 0.03 ms | 5 ms | 0.6% |

**The rule expression is the limit that binds.** A rule may hold 4096 characters
and each host costs about 21, so one Snippet reaches roughly 190 hosts. The
minified source has room for about 1200 more names, and execution time does not
grow at all, because the handler looks up one key in an object instead of
walking a list.

`deploy.sh` measures the expression before it sends anything and stops if it
would pass 4096. At that point the fix is a second Snippet with the overflow
hosts, not a bigger one.

Execution time stays low because the handler builds a string and returns it. The
DNS and weather hosts do call out over the network, so they cost more, but that
is network wait rather than computation. All of them stayed inside the 5 ms
budget on the live site.

```console
$ npm run bench:cost
colo.jasontally.com   median 0.0300 ms   0.60% of the 5 ms budget
```

### Minification

`snippet.js` is the readable source and is what the tests import.
`deploy.sh` minifies it with [esbuild](https://esbuild.github.io/) and uploads
the result, because the 32768 byte limit applies to what Cloudflare stores.

```
26312 bytes -> 14852 bytes, 43% smaller, 17916 free of 32768
```

Four builds were measured on this file. All four passed all 45 tests.

| Build | Bytes | Time |
| --- | --- | --- |
| esbuild, `--minify` | 14874 | 1.6 s |
| terser, `--compress --mangle` | 14992 | 2.0 s |
| terser, `passes=3` | 14979 | 2.0 s |
| terser, all `unsafe_*` transforms | 14848 | 2.0 s |

esbuild is the default. The 26 byte difference against terser with every
`unsafe_*` transform enabled is 0.08% of the limit, and those transforms can
change behaviour, so esbuild is the safer build. Set `MINIFY` to switch:

```console
$ MINIFY='sfw npx --yes terser' ./deploy.sh
```

Minifying does not change run time. V8 parses once per isolate and then works
from bytecode either way.

```console
$ npm run bench:runtime
source 26312 bytes, minified 14874 bytes
  colo.jasontally.com      source 0.0208 ms   minified 0.0210 ms
  ip.jasontally.com        source 0.0201 ms   minified 0.0203 ms
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
export CLOUDFLARE_API_TOKEN=<token>
export CLOUDFLARE_ZONE_ID=b540f8f1930727dace12f79100e7b9d2
./deploy.sh
```

`deploy.sh` checks the token first, minifies the source, reads the host list out
of `snippet.js`, creates any missing DNS records, uploads the code, and puts the
rule in place. It is safe to run again, and it will not touch other Snippet
rules in the zone.

It stops before sending anything if the rule expression would pass 4096
characters, and it confirms by hash that the code on the edge is the build it
sent.

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
| `runtime.mjs`         | compares the source and minified run time   |
| `test/snippet.test.js`| checks every response shape                |
