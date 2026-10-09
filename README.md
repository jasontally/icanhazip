# icanhazip

An [icanhazip.com](https://icanhazip.com) clone built as a
[Cloudflare Snippet](https://developers.cloudflare.com/rules/snippets/) on
`ip.jasontally.com`. No Worker, no origin server.

```console
$ curl https://ip.jasontally.com/
203.0.113.7
```

100 subdomains, one data point each. `city` gives the city, `colo` the Cloudflare
data centre, `ptr` the reverse DNS name, `temp` the temperature.

## Behaviour

| Request | Response |
| --- | --- |
| `https://ip.jasontally.com/` | the visitor IP address and nothing else |
| `https://ip.jasontally.com/anything?x=1` | the same plain IP address |
| `https://ip.jasontally.com/?whoami` | an HTML page with every known field |
| `https://ip.jasontally.com/whoami` | the same HTML page |
| `https://city.jasontally.com/` | one data point about the visitor |
| `https://colo.jasontally.com/whoami` | the HTML page, from any host |
| a hostname with no DNS record | not run |

The plain response is `text/plain`, holds the address from `CF-Connecting-IP`,
ends in a newline, and carries `Cache-Control: no-store`. No address is ever
cached. `whoami` must be the whole query string, so `?whoami=0` gets the plain
IP address.

`/whoami` shows the request, location, network, TLS and browser sections, then
dumps every request header and the whole `request.cf` object as JSON. New
Cloudflare fields appear there with no code change.

## The hosts

Each subdomain answers with one value, so a shell script can read it.

```console
$ curl https://city.jasontally.com/
Melbourne
$ echo "You appear to be in $(curl -s https://city.jasontally.com/)"
You appear to be in Melbourne
```

### Straight from Cloudflare, 40 hosts, no network call

| Host | Value | Field |
| --- | --- | --- |
| `ip` | IP address | `CF-Connecting-IP` |
| `city` | City | `city` |
| `zip`, `zipcode`, `postal`, `postcode` | Postal code | `postalCode` |
| `country`, `co`, `cc`, `countrycode` | Country code | `country` |
| `region`, `st`, `state`, `province` | Region, or the code | `region`, then `regionCode` |
| `continent` | Continent code | `continent` |
| `timezone`, `tz` | IANA time zone | `timezone` |
| `lat`, `latitude` | Latitude | `latitude` |
| `lon`, `longitude` | Longitude | `longitude` |
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
| `ua`, `useragent` | User agent | `User-Agent` header |
| `lang` | Accepted languages | `Accept-Language` header |
| `ver` | `4` or `6` | computed |
| `ip4`, `ipv4`, `v4` | The address, only for IPv4 | computed |
| `ip6`, `ipv6`, `v6` | The address, only for IPv6 | computed |

`region` falls back to the two letter code when the long name is missing, so it
answers `FL` rather than nothing.

`dma` is a second name for `metro` and it does not mean what the name suggests.
A DMA is a Designated Market Area, the US television and radio geography, and
`request.cf` carries no such field. Both names return Cloudflare's `metroCode`.
They answer the same value, and neither is a DMA.

### The clock, 16 hosts, no network call

String slices of `new Date()`, the same clock as `utc`, so they agree with each
other.

| Host | Value |
| --- | --- |
| `utc`, `now` | the whole ISO 8601 string |
| `date`, `day`, `today`, `utcdate` | `2026-10-04` |
| `time`, `utctime`, `clock` | `14:39:51` |
| `year`, `month` | `2026`, `10` |
| `hour`, `minute`, `second` | `14`, `39`, `51` |
| `epoch`, `timestamp` | `1791124791` |

```console
$ curl https://date.jasontally.com/
2026-10-04
$ curl https://epoch.jasontally.com/
1791124791
```

### Weather, 16 hosts, one call each

[Open-Meteo](https://open-meteo.com/), free and no API key. Each host asks for
the one field it returns, which keeps the response as small as the API allows.

**Rate limits.** The free tier allows 600 calls a minute, 5000 an hour, 10,000 a
day and 300,000 a month, with no uptime guarantee and no hard cutoff in place
yet. One request to one weather host is one call, so 10,000 requests to
`temp` on one day uses the entire daily allowance. Every weather host is
uncached by design, since the answer depends on the visitor, so there is no
way to soften a burst from here. A Cloudflare Cache Rule keyed on nothing would
leak one visitor's weather to another, which is worse. Three things follow:
keep these hosts off any front page, expect them to answer empty once the
allowance runs out, and expect them to be of little use above a few hundred
requests a day.

The free tier is **non-commercial**, and the data is CC BY 4.0, which means
attribution is a licence obligation rather than a courtesy. Neither page shows
it. Add a credit line to `snippet.js` before this goes anywhere commercial.

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

```console
$ curl https://temp.jasontally.com/
29.3
$ curl https://weather.jasontally.com/
mainly clear
$ curl https://sunset.jasontally.com/
2026-10-04T23:05
```

### DNS, 5 hosts, one call each

Cloudflare's own resolver at
[`cloudflare-dns.com`](https://developers.cloudflare.com/1.1.1.1/dns/encryption/dns-over-https/),
asked in JSON form, so no third party sees the lookup.

| Host | Value | Calls |
| --- | --- | --- |
| `ptr`, `hostname` | Reverse DNS name | 1 |
| `ns`, `nameserver` | Nameservers for the block | 1 |
| `dns` | Forward confirmed name | 2 |

`ptr` and `hostname` want the PTR record of the visitor address. `ns` and
`nameserver` want the nameservers authoritative for the block it sits in, which
is the /24 for IPv4 and the /64 for IPv6. `dns` wants the PTR record and then
checks that it points back at the same address, the same test a mail server runs
before accepting mail. That is why `dns` is often empty: many home ISPs publish
a PTR name with no forward record.

No rate limit applies here, and none is expected. The resolver runs on the same
network as the Snippet that calls it, which makes these the most dependable of
every host that reaches outside Cloudflare's own metadata.

```console
$ curl https://ptr.jasontally.com/
syn-050-088-174-031.res.spectrum.com
$ curl https://ns.jasontally.com/
ns2-rev.proxad.net ns3-rev.proxad.net
```

A Pro zone allows 2 subrequests per request, and `dns` spends both.

### The address block, 7 hosts, one call each

Cloudflare reports `asn` and `as` from the routing registry. An address block
comes from the address registry instead, and it is different data.

| Host | Value |
| --- | --- |
| `net`, `netname` | Name of the allocation |
| `netblock`, `range` | Allocated range |
| `cidr` | Allocated CIDR |
| `prefix`, `bgp` | Announced prefix |

```console
$ curl https://as.jasontally.com/          # from Cloudflare, the ASN owner
Charter Communications, Inc
$ curl https://net.jasontally.com/         # from WHOIS, the allocation name
BHN
$ curl https://cidr.jasontally.com/
50.88.0.0/14
$ curl https://prefix.jasontally.com/      # what the network announces
50.88.0.0/15
```

`cidr` and `prefix` can disagree. An allocation is what the registry recorded;
the prefix is what the network announces in BGP. Announced blocks are sometimes
tighter.

These hosts use RIPE RIS at `stat.ripe.net`, free, no key, answering for all
five registries.

**Rate limits.** RIPEstat sets no limit on the number of requests, but asks you
to mail `stat@ripe.net` if you plan to make **more than 1000 requests a day**
regularly, and caps traffic at **8 concurrent requests from one address**. The
subrequests leave from Cloudflare's edge rather than from the visitor, so a
burst of visitors shares one address for that cap. Nothing here caches, so
above roughly 1000 requests a day this is worth registering, and above a few
hundred concurrent requests a day these hosts start failing.

RDAP would suit better, since it replaces WHOIS, but
`rdap.org` answers **403 to Cloudflare's own network**. Reaching a RIR directly
needs the IANA bootstrap file to know which one, and a Snippet cannot cache
that file. Ceiling and upgrade path sit in the comment above `whois` in
`snippet.js`.

### The map, 1 host, a page rather than a value

`map` fills the viewport with the map and nothing else, centred on your
coordinates.

```console
$ curl -o /dev/null -w '%{http_code} %{size_download}\n' https://map.jasontally.com/
200 1920
```

It uses the same SRI-pinned map libraries as `/whoami`, where the map sits
under Location.

**Where the map comes from.** Everything a map needs is on one host,
`tiles.jasontally.com`: MapLibre GL JS and the PMTiles reader, the styles, the
glyph files and the tiles themselves. There is no unpkg.com, no
`tile.openstreetmap.org` and no third party of any kind, so the page no longer
trades its privacy for a map. The tiles are the Protomaps Basemap, an
OpenStreetMap rebuild served as one PMTiles archive, and MapLibre GL JS reads
them, which needs WebGL. Where a browser has none, the page says so instead of
showing an empty box.

All three files load with Subresource Integrity, which pins the exact bytes and
makes a tampered copy fail to load rather than run. The versions are pinned by
path, so the bytes under a URL cannot change while the URL stays the same.

The style JSON is one of the two that host publishes, `bright.json` and
`dark.json`, and the page picks between them the way its own CSS already does,
by the visitor's colour scheme.

**The only credit is the one in the corner.** Neither page carries a note, and
there is no control that stops the map loading: the credit is MapLibre's
attribution control, in the lower right, holding what the style names for the
source, which is "© OpenStreetMap contributors" with a link to the licence. It
starts visible, and MapLibre collapses it to an "i" button on the first drag. A
click brings it back. That is deliberate. The OpenStreetMap
[attribution guideline](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
asks for the credit to be presented with no interaction at all, and allows a
collapse only on a dismiss, on map interaction, or after five seconds. Starting
the control collapsed would satisfy none of those, so it stays open. The
attribution text itself is not written in this repo: it is read from the style
JSON, which is also what makes the licence link correct.

Two of the three permitted collapses were measured in a browser, on both pages:
clicking the credit while it is open collapses it, and one drag collapses it. In
both cases the "i" button stays and brings the credit back, which is the
"user must still be able to find the licence information" half of the same rule.
The third, a five second timer, does not exist and is not wanted: the guideline
permits any one of the three rather than all three, and this build already
collapses on the two that need no code. A timer would hide the credit sooner for
someone who is still reading it.

The map page used to say the position was approximate rather than a GPS fix.
That line went with the note, so the caveat now sits only in the page title and
the `aria-label` on the map. Restore it as a `title` if a visitor should see it.

The archive holds zoom 0 to 15, so the map stops at 15 as well; going past it
would ask for tiles that are not in the file. The style is Protomaps schema v3,
which is the schema this archive holds: a style written for another schema loads
and then draws nothing.

Upstream
[cf-whoami-snippet](https://github.com/xyTom/cf-whoami-snippet) does neither; it
builds only an OpenStreetMap URL. This project used to carry that as a plain
link beside the map, and no longer does, because a link is the last thing that
led a visitor off to a third party. When Cloudflare sends no coordinates, both
pages say so instead of showing an empty map.

### Replacements for the services Major retired

[Major Hayden switched off six extra services](https://major.io/p/extra-icanhaz-services-going-offline/)
in August 2022. Two already exist here, two now do, and two cannot be done by a
Snippet at all.

| Retired service | Replaced by | How |
| --- | --- | --- |
| `icanhazptr.com` | `ptr`, `hostname` | one DNS lookup, already had it |
| `icanhazepoch` | `epoch`, `timestamp` | computed, already had it |
| `icanhazheaders` | `headers` | JSON of every request header |
| `icanhazproxy` | `proxy`, `proxies` | JSON of the proxy headers found |
| `icanhaztrace` | nothing | needs raw sockets |
| `icanhaztraceroute` | nothing | needs raw sockets |

```console
$ curl https://headers.jasontally.com/
{
  "accept": "*/*",
  "cf-connecting-ip": "203.0.113.7",
  "cf-ray": "a456b246ab184e75",
  ...
}

$ curl -i https://proxy.jasontally.com/ | head -1
HTTP/2 204

$ curl https://proxy.jasontally.com/ -H 'Via: 1.1 proxy.example.net'
{
  "via": "1.1 proxy.example.net"
}
```

`proxy` returns **204 No Content** when it finds nothing, which is what the
original did and what lets a script tell "no proxy" from "empty". A plain line
would lose that.

It scans the same nine headers Major scanned. Three of them,
`http_pc_remote_addr`, `http_client_ip` and `http_x_appengine_country`, are from
Google App Engine and nothing sends them any more. `xff` covers
`x-forwarded-for`, which Major's list never included, and reports the chain a
proxy declared. Cloudflare does not add that header itself, so it is empty
unless something upstream sent one.

### VPN and gateway detection, which a Snippet cannot do

There are no `warp` or `gateway` hosts. They were built, then removed.

Cloudflare knows whether a visitor is on WARP or Gateway, and it reports both at
`/cdn-cgi/trace`:

```console
$ curl https://colo.jasontally.com/cdn-cgi/trace | grep -E '^(warp|gateway)'
warp=off
gateway=off
```

A Snippet cannot read that. `fetch()` inside a Snippet is an origin request, and
this zone's origin is `100::1` with nothing behind it, so the subrequest finds no
trace. Cloudflare serves `/cdn-cgi/` to a browser before any Snippet runs, but
that ordering is exactly what a subrequest cannot exploit.

A first attempt used a guard that returned `fetch(request)` for any `/cdn-cgi/`
path. That made it worse, because it replaced Cloudflare's internal trace response
with the same dead origin fetch, and `/cdn-cgi/trace` stopped working for
browsers too. The guard is gone.

The names were removed rather than left answering empty, because a host that
always returns nothing is worse than no host at all. Two upgrade paths remain:
Cloudflare's
Ruleset Engine exposes `warp`, `gateway` and `rbi` as `http.request.cf.*` fields,
so a Transform Rule can act on them, though a Snippet still cannot read them.
Failing that, a second zone with no Snippet rule would let `fetch()` reach
`/cdn-cgi/trace` on Cloudflare rather than an origin.

### Getting those values from the browser instead

`/cdn-cgi/trace` answers on every host, Cloudflare serving it before any Snippet
runs, so `/whoami` links to it in a "Cloudflare edge trace" section. A browser
following that link sees the three fields this Snippet cannot:

```console
$ curl https://colo.jasontally.com/cdn-cgi/trace
fl=369f707
h=colo.jasontally.com
ip=50.88.174.31
ts=1791146264.000
visit_scheme=https
uag=curl/8.14.1
colo=MIA
sliver=none
http=http/2
loc=US
tls=TLSv1.3
sni=plaintext
warp=off
gateway=off
rbi=off
kex=X25519MLKEM768
```

`warp`, `gateway` and `rbi` say whether the visitor is on Cloudflare WARP,
Gateway or RBI, which is the authoritative answer to "am I on a VPN".
`kex` is the key exchange, so `X25519MLKEM768` means post-quantum hybrid.
`sliver` is Cloudflare's finer-grained hardware tier inside a colo.

The link is relative, so it works from every host that serves `/whoami`.

### Hosts that are often empty

A known host with no data answers with an empty line. It never falls through to
the IP address, so a missing field cannot pass for a result.

| Host | Why it is empty |
| --- | --- |
| `lang` | `curl` sends no `Accept-Language` |
| `ua`, `useragent` | a bare client sends no user agent |
| `xff` | no proxy sent `X-Forwarded-For` |
| `ip4`, `ipv4`, `v4` | empty for an IPv6 visitor, and the reverse for `ip6` |
| `ip6`, `ipv6`, `v6` | empty for an IPv4 visitor, and the reverse for `ip4` |
| `dns` | the PTR record has no forward record |
| `ptr`, `ns`, `net`, `prefix` | the address has no such record |
| weather hosts | Open-Meteo did not return the field |

```console
$ [ -n "$(curl -s https://lang.jasontally.com/)" ] && echo browser || echo "no language sent"
no language sent
```

## How dependable each host is

The table above says which hosts can be empty. This says which ones are,
measured rather than guessed.

```console
npm run reliability                        # every host, 12 samples
node reliability.mjs 40 6 prefix,bgp,cidr  # one group, 40 samples
```

The tool asks each host N times and records failures, blanks, how many
different answers came back, and the latency including the worst single
sample. It checks its own group list against `snippet.js` on every run, so a
host cannot be added without being classified.

### The result: nothing fails

Across 1200 requests, one per host per sample, **there were no failures at
all**. 95 of the 100 hosts answered every sample with a value. Five never did,
and in all five the empty answer is the correct one:

| Host | Why empty every time |
| --- | --- |
| `ip6`, `ipv6`, `v6` | the probe runs over IPv4, and these answer only for IPv6 |
| `xff` | no proxy sent `X-Forwarded-For`, and the probe sent none |
| `dns` | the address has a PTR record but no forward record, which is the normal case |

`dns` is the weakest of the five. It stays empty for most of the internet,
because most networks publish a PTR record without a matching forward record.
The name is honest, but it will rarely be useful.

### Two hosts were broken and are gone

The probe found `ja3` and `ja4` empty on all 12 samples, while `ja3` and `ja4`
had been in the suite and passing the whole time.

Both read a field Cloudflare never sends. `request.cf` on this zone has **32
keys** and neither `tlsJa3Hash` nor `tlsJa4` is among them. Their tests passed
because the fixture had invented the field, so each test proved only that the
invented field was passed through.

Removing them exposed three more of the same fault, all on the details page,
all invisible to the old tests. Every one of these read a field that does not
exist and rendered a dash for every visitor:

| Was on `/whoami` | Field it read | Is there a real field |
| --- | --- | --- |
| `JA3` | `cf.tlsJa3Hash` | no |
| `JA4` | `cf.tlsJa4` | no |
| `HTTP version` | `cf.httpVersion` | no, and `Protocol` above it already says `HTTP/2` |
| `Network` | `cf.network` | no, and the Network section below says something else |
| `Client hello` | `cf.tlsClientHello` | no, the key is `tlsClientHelloLength` |

`Client hello` now reads the real key and shows `1570 bytes`. The other four
rows are gone. **The page has no empty cell anywhere**, which was the test.

### The guard

One test now scans the whole file for every `cf.SOMETHING` and fails if any of
it is not one of the 32 real keys. It reads `HEADER_FIELDS` out of the source
rather than repeating it, and it strips comments first, because a comment
explaining a removed field names that field and the guard flagged its own
explanation.

Verified against all five dead field names: put each one back and the suite
fails. `load.mjs` and `bench.mjs` each check their own host lists against
`hostLabels` and refuse to run against a name that has been removed, which is
what stopped `ja3` and `ja4` from being load tested after they were gone.

### The fault that is left is a slow tail, not a failure

No host returned an error. But the upstream groups have a long tail, measured
over 40 samples each:

| Group | Median | p95 | Worst single sample |
| --- | --- | --- | --- |
| `request.cf`, no upstream | 31 ms | 34 ms | 190 ms |
| computed, no upstream | 28 ms | 39 ms | 123 ms |
| `cloudflare-dns.com` | 34 ms | 120 ms | 311 ms |
| `api.open-meteo.com` | 172 ms | 608 ms | 642 ms |
| `stat.ripe.net` whois | 155 ms | 325 ms | **5955 ms** |
| `stat.ripe.net` network-info | 153 ms | 254 ms | 1053 ms |

**The whois hosts are the least dependable names here, and not because they
fail.** A local host is 30 ms and never goes above 200 ms. A whois host is
usually 155 ms, and one sample in forty took nearly six seconds. The median
hides this completely, which is why the table carries the worst sample.

`netblock` produced that six second sample. The cause is RIPE RIS, not the
Snippet: the request leaves the Cloudflare edge, crosses to RIPE NCC, and waits
in their queue. A Snippet has a 5 ms execution budget but no timeout budget,
and no way to shorten a slow upstream.

So the honest ranking of the 100 names, worst first:

1. `netblock`, `range`, `cidr`, `net`, `netname`, `prefix`, `bgp` reach RIPE
   and can stall for seconds. They always answer correctly.
2. The 16 weather hosts reach Open-Meteo and sit near 600 ms at p95, steadily.
3. `dns` answers empty for most of the internet.
4. The 71 hosts that read Cloudflare's own data answer in about 30 ms and are
   as dependable as the edge itself.

### What is left of the TLS fingerprint

Cloudflare sends no JA3 or JA4 hash here, but it does send the parts a JA3 hash
is computed from, and every one of them has a value:

| Field | Example |
| --- | --- |
| `tlsClientCiphersSha1` | `hCCNuWP9ky6AR69i97wdKYbhFQo=` |
| `tlsClientExtensionsSha1` | `4oF0LRxQXUDhrRY0MazQAVJh7Go=` |
| `tlsClientExtensionsSha1Le` | `Ea9swA+X7+AQtmDnJ28MlyPK/Fg=` |
| `tlsClientHelloLength` | `1570` |

These are stable for one client software and differ between client software, so
they fingerprint a browser the way a JA3 hash would, in two halves rather than
one. They are not exposed as hosts today. Adding them is a small change and a
judgement call, because a hash of the ciphers is not a hash of the browser.

## Where the values come from

| Source | Hosts | Third party sees the visitor | Rate limited |
| --- | --- | --- | --- |
| `request.cf` | 40 | no | no |
| request headers | 4 | no | no |
| `new Date()` | 16 | no | no |
| computed in the handler | 11 | no | no |
| `cloudflare-dns.com` | 5 | no, stays inside Cloudflare | no |
| `stat.ripe.net` | 7 | yes, RIPE NCC | 8 concurrent, register above 1000 a day |
| `api.open-meteo.com` | 16 | yes, Open-Meteo in Switzerland | 10,000 a day on the free tier |
| tiles.jasontally.com | `map` and `/whoami` | yes, own hostname on this zone | none published, no SLA |

71 of the 100 never leave Cloudflare. 23 reach a third party, 5 use Cloudflare's
own resolver, and 1 returns a page. The five DNS hosts are not rate limited and
are the most dependable of the third party group, since they run on Cloudflare's
own resolver in the same network as the Snippet itself.

**`request.cf` carries 32 keys on this plan, not more.** That was measured from
the live edge, not taken from the documentation, and the number matters: 40 of
those keys are named things, and the rest are TLS handshake transcripts,
certificate blobs, `tlsExportedAuthenticator`, `edgeL4`, `requestPriority` and
`verifiedBotCategory`. None of the rest has a common name, so no host holds them.
There is no JA3 or JA4 key either, which is why those two hosts are gone.

The four `tlsClient*` hash fields are the exception worth naming. They have no
common name but they do fingerprint a client, and their values are in the
"dependable" section above.

Values are approximate. Cloudflare derives them from the network rather than a
GPS fix, so `city` can land on the city centre and `zip` can be wrong.

## One Snippet, one rule

All 100 hosts share one Snippet and one rule, written as a set test:

```
(http.host in {"ip.jasontally.com" "city.jasontally.com" ...})
```

`deploy.sh` reads the host list out of `snippet.js`, so the DNS records, the
rule, and the code that answers cannot disagree. It also confirms that the
minified build lists the same hosts before uploading.

It creates records for hosts that are missing and **deletes records for hosts
that are no longer in the list**, so a removed name stops resolving rather than
sitting there failing. The delete only touches a single label under the zone
with type AAAA pointing at the discard prefix, and it confirms the record is
gone afterwards. That last part matters, because `cf dns records delete` asks
for confirmation, aborts in a script and still exits 0, so the first version of
this printed "removed" for records that were still there.

### What limits this, and which one binds first

| Limit | Now | Allowed | Used |
| --- | --- | --- | --- |
| Source size, as uploaded minified | 16402 bytes | 32768 | 50% |
| Rule expression | 2308 chars | 4096 | 56% |
| Execution time | 0.03 ms | 5 ms | 0.6% |

The rule expression is the limit that binds. A rule holds 4096 characters and
each host costs about 23, so one Snippet reaches roughly 175 hosts. At 100
there is room for about 71 more, after which a second Snippet takes the
overflow.

`deploy.sh` measures the expression and stops if it would pass 4096.

Execution time stays low because the handler looks up one key in an object and
builds a string. DNS and weather hosts wait on the network, which is not
computation, and all of them stayed inside the 5 ms budget on the live site.

```console
$ npm run bench:cost
colo.jasontally.com   median 0.0300 ms   0.60% of the 5 ms budget
```

A wildcard rule would remove the 4096 character limit, though it does not work
here. `http.host matches` needs a Business plan, and `http.host contains
"jasontally.com"` passed the API check yet stopped the Snippet from running at
all. The explicit set stays.

## Deploy

```console
npm i -g cf
export CLOUDFLARE_API_TOKEN=<token>
export CLOUDFLARE_ZONE_ID=b540f8f1930727dace12f79100e7b9d2
./deploy.sh
```

`deploy.sh` checks the token, minifies the source, reads the host list out of
`snippet.js`, creates missing DNS records, uploads the code, and puts the rule
in place. Running it twice is safe, and it leaves other Snippet rules in the
zone alone.

Three checks guard against a quiet failure. `deploy.sh` stops if the rule
expression would pass 4096 characters, it verifies by SHA-256 that the code on
the edge is the build it sent, and it reads the rule list back afterwards to
prove the other project's rule on this zone survived the update.

It also stops when `CLOUDFLARE_API_TOKEN` is missing. An earlier version only
warned, so the upload failed without a visible error and the zone sat on old DNS
while every host returned `error code: 1016`.

`cf auth login` works too. It keeps a credential in your keyring and needs no
token in the environment.

### API token

Create one at <https://dash.cloudflare.com/profile/api-tokens>:

| Permission | Access | Why |
| --- | --- | --- |
| Zone / Snippets | Edit | upload the code and set the rule |
| Zone / Snippets | Read | read the stored code back to hash it, and read the rule list |
| Zone / DNS | Edit | create the 100 AAAA records, delete the stale ones |
| Zone / DNS | Read | list what is there, to find both |
| Zone / Zone | Read | let `cf` resolve the zone |

Scope it to Zone `jasontally.com`. Account
`74036ee9a61ce6ac5682b2eade8dfb82` holds the zone. Snippets are zone scoped, so
the account ID never reaches the Snippets API.

Edit covers Read for the same resource, so an Edit token can do all of it. Both
halves are needed: this script reads back what it wrote, and a Read-only token
would fail the write.

### Run the build and the deploy on Cloudflare

`deploy.sh` does two separable things: minify and check the build, then talk to
the zone. Cloudflare's CI asks for exactly those two things as two commands, so
the script takes a mode and the token stays in Cloudflare rather than on this
machine.

| Command | What it does | Needs the token |
| --- | --- | --- |
| `./deploy.sh`, or `./deploy.sh all` | build into `dist/`, then deploy | yes |
| `./deploy.sh build` | minify into `dist/`, then every check that needs no network | no |
| `./deploy.sh deploy` | deploy what `dist/` holds | yes |
| `npm run build`, `npm run deploy` | the same two | as above |

`dist/` is in `.gitignore` and is rebuilt every build, so the two commands share
it through the workspace and never through git. A build stops after the three
offline checks, so a broken build never reaches the deploy command.

**Workers Builds settings**, under Workers & Pages → the Worker → Settings →
Builds:

| Setting | Value | Why |
| --- | --- | --- |
| Build command | `npm run build` | minify, plus the size, host-list and rule-length checks |
| Deploy command | `npm i -g cf && npm run deploy` | the build image carries no `cf`, and the DNS steps need it |
| Preview command | `npm run build` | a branch that is not `main` builds and deploys nothing |
| Production branch | `main` | |
| Root directory | `/` | this repo is one project, not a monorepo |

**Build variables and secrets**, under Settings → Build → Build variables and
secrets. They are available to both commands.

| Name | Type | Value |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | the token from the table above |
| `CLOUDFLARE_ZONE_ID` | Variable | `b540f8f1930727dace12f79100e7b9d2` |

`CI`, `WORKERS_CI=1` and `WORKERS_CI_BUILD_UUID` are injected for free.

**The Worker this hangs on.** Workers Builds keys every build off a Worker: the
repository connects to a Worker, and the build and deploy commands are settings
on that Worker. There is no Snippets-specific CI, and wrangler has no
`snippets` subcommand, because a Snippet is a zone-level Rules resource rather
than a Worker artifact. That is why the deploy command here is a package script.

So the repo carries one Worker shell, and it is not the product: `wrangler.jsonc`
names `icanhazip-ci`, and `ci-worker.js` inside it is three lines that nobody
routes to. `workers_dev` is off and the deploy command never publishes it
again. It exists to hold the build configuration. Create it once, then connect
the repository to it:

```console
npx wrangler deploy --config wrangler.jsonc
```

The `name` in `wrangler.jsonc` has to match the Worker in the dashboard, or the
build fails on Cloudflare's name check before either command runs.

The minifier default differs by machine. This machine puts npm behind `sfw`,
Cloudflare's build image does not, and `deploy.sh` picks the right one, so
neither place needs a flag. `MINIFY` still overrides it.

### The DNS records

Snippets run before the origin, and this Snippet never calls `fetch()` for a
plain value, so no origin is contacted. Each host still needs a proxied record,
because Snippets only run on requests that reach the Cloudflare edge. Every
record is an AAAA to `100::1`, from the RFC 6666 IPv6 discard prefix, which is
never routable.

### Known ceiling

Two `cf` v1.0.0-beta.10 bugs are worked around in `deploy.sh`, each marked in
the file with a CEILING comment.

1. `cf snippets update` sends the code as multipart part `file`, while the API
   needs that part named `files`, so the call fails. `deploy.sh` tries `cf`
   first, then falls back to the documented `curl` form.
2. `cf snippets rules update --rules` will not accept an `@path`, though its own
   help text says it does. `--body "@path"` works, so `deploy.sh` uses that.

Drop both workarounds once `cf` is fixed.

## Minification

`snippet.js` is the readable source, and the tests import it. `deploy.sh`
minifies with [esbuild](https://esbuild.github.io/) and uploads the result,
since the 32768 byte limit applies to whatever Cloudflare stores.

```
29961 bytes -> 16402 bytes, 45.3% smaller, 16366 free of 32768
```

esbuild arrives through `sfw npx`, so nothing needs installing and nothing needs
committing. Four builds were measured on this file:

| Build | Bytes |
| --- | --- |
| esbuild, `--minify` | 16402 |
| terser, `--compress --mangle` | 16536 |
| terser, `passes=3` | 16523 |
| terser, all `unsafe_*` transforms | 16391 |

esbuild is the default. Terser with every `unsafe_*` transform on is 6 bytes
smaller, which is 0.02% of the limit, and those transforms can change behaviour.
Switch with `MINIFY`:

```console
$ MINIFY='sfw npx --yes terser' ./deploy.sh
```

Minifying leaves run time alone. V8 parses once per isolate, then works from
bytecode either way.

```console
$ npm run bench:runtime
source 29961 bytes, minified 16402 bytes
  colo.jasontally.com      source 0.0208 ms   minified 0.0210 ms
  ip.jasontally.com        source 0.0201 ms   minified 0.0203 ms
```

## Test

```console
npm test
```

`node --test` runs against a fake `Request`, so no network or account is needed.
It covers both response shapes, the date and weather splits, the `Number()`
guard that stops a hostile coordinate reaching the script block, the `origin`
Referrer-Policy that keeps the path out of the tile requests, and the WMO table,
which is read through the module so it also passes on a minified build.

One test is worth naming. **Every `request.cf` field the snippet reads really
exists.** It scans the whole file rather than one map, because the details page
reads `request.cf` directly and reading only the map missed four dead rows
there.

That test exists because two hosts and four page rows were broken on the live
site while the suite was green. The fixture had invented the fields they read,
so each test proved only that the invented field was passed through. The
fixture no longer invents anything: `httpVersion` and `network` came out of it
along with the rows that used them.

## Benchmark

```console
npm run bench
```

`bench.mjs` fetches `icanhazip.com` and compares. An address from the live call
goes into the Snippet, so both bodies hold the same string and a byte
comparison means something.

Main page body equals the icanhazip.com body byte for byte. Both answer
`<address>\n` with `content-type: text/plain`,
`access-control-allow-origin: *` and `access-control-allow-methods: GET`.

Two things differ from what icanhazip.com sends:

| Difference | Why |
| --- | --- |
| `cache-control: no-store` | keeps an address out of the edge cache |
| the details page at `whoami` | the one feature of this project |

icanhazip.com also sends `set-cookie`, `cf-ray`, `alt-svc` and `server`.
Cloudflare adds most of those on its own.

`bench.mjs` walks all 100 hosts against the live site too, so a host that stops
answering gets caught.

Its timing lines compare nothing. The icanhazip number is a full network round
trip, while the Snippet number is only the JavaScript, without network or edge.

## Load

```console
npm run load -- cf 128
npm run load -- dns 256
```

`load.mjs` ramps concurrency against the live zone and reports throughput and
latency at each step. Only two profiles exist, `cf` for the Cloudflare metadata
hosts and `dns` for the five that use `cloudflare-dns.com`. The whois and
weather profiles were removed on purpose, because they drive `stat.ripe.net`
and `open-meteo.com`, which have published daily ceilings, and loading them
with synthetic traffic spends a third party's quota.

### Measured on a 2 core box

These numbers are a floor, not a ceiling. The load generator shares two cores
with everything else on the machine, and it is the first thing to fall over.

| Concurrent | req/s | p50 ms | p95 ms | p99 ms | Errors |
| --- | --- | --- | --- | --- | --- |
| 1 | 8 | 120 | 150 | 160 | 0 |
| 4 | 96 | 30 | 100 | 136 | 0 |
| 16 | 444 | 31 | 37 | 43 | 0 |
| 32 | 877 | 31 | 39 | 50 | 0 |
| 64 | 1658 | 31 | 46 | 73 | 0 |
| 96 | 2451 | 32 | 48 | 63 | 0 |
| 128 | 3012 | 33 | 54 | 77 | 0 |

`cf`, 56 hosts, 5 s per step.

| Concurrent | req/s | p50 ms | p95 ms | p99 ms | Errors |
| --- | --- | --- | --- | --- | --- |
| 1 | 26 | 32 | 39 | 100 | 0 |
| 32 | 797 | 33 | 42 | 69 | 0 |
| 128 | 2829 | 35 | 59 | 119 | 0 |
| 256 | 3936 | 47 | 89 | 168 | 0 |

`dns`, 5 hosts, 6 s per step. One `cloudflare-dns.com` subrequest per request.

| Concurrent | req/s | p50 ms | p95 ms | p99 ms | Errors |
| --- | --- | --- | --- | --- | --- |
| 8 | 208 | 32 | 40 | 48 | 0 |
| 32 | 778 | 34 | 45 | 68 | 0 |
| 64 | 1382 | 37 | 62 | 95 | 0 |
| 128 | 1987 | 52 | 87 | 224 | 0 |

`page`, the two HTML pages, 5 s per step.

### Where it slows down, and where it stops

**It slows down at 512 concurrent and above.** Throughput flattens around
3400 req/s and p95 climbs from 230 ms to 813 ms between 512 and 1024.

**It never stopped.** Across every step up to 1024 concurrent the edge returned
zero non-200 responses. Every failure recorded was `ETIMEDOUT` on a local
socket, and `load.mjs` reports the cause so a client side timeout is never
counted as the edge refusing. That happened at roughly 3000 req/s from one
2-core box, which places the limit at the load generator rather than at
Cloudflare.

Three readings worth keeping. Latency is flat from 16 to 96 concurrent, where
p50 sits at 31 ms and p95 at 37 to 48 ms, so the Snippet itself adds nothing
measurable and queues in bursts rather than backing up. The `cf` and `dns`
groups land within a few percent of each other at 256 concurrent, 3938 against
3936 req/s, so a subrequest to Cloudflare's own resolver costs no more than
local metadata. The HTML pages run about half the throughput of a plain value,
1987 against 3012 req/s at 128 concurrent, which is the 8.9 KB of HTML rather
than 13 bytes.

A caveat on the `page` profile. Node fetch does not run JavaScript, so MapLibre
and the tiles are never requested. Nothing here measures the map path, and
`/whoami` as a browser sees it fetches three more files from
`tiles.jasontally.com` before it draws anything.

## Files

| File | Purpose |
| --- | --- |
| `snippet.js` | the Snippet source, minified on deploy |
| `deploy.sh` | DNS, code and rule deployment through `cf` |
| `wrangler.jsonc`, `ci-worker.js` | the Worker shell that Workers Builds hangs the build on |
| `DEPENDENCIES.md` | the plan for investigating the remaining third-party dependencies |
| `bench.mjs` | byte and header check against icanhazip.com, plus all 100 hosts live |
| `reliability.mjs` | asks every host 12 times and ranks it by failures, blanks and latency |
| `cost.mjs` | measures size, rule size and execution time |
| `runtime.mjs` | compares source and minified run time |
| `load.mjs` | ramps concurrency against the live zone |
| `test/snippet.test.js` | checks every response shape, and every field read |

The repo holds the readable source, not the uploaded bytes. `npm run
bench:runtime` rebuilds the same minified file, so the upload is reproducible.
