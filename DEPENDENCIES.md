# Dependency investigation plan

This is a plan, not a result. It sets out what to look at, in what order, and
what to measure before anything is built. Nothing here has been researched yet
beyond reading this repository.

**Why this exists.** This project is a page that answers from the edge and
calls nobody. Two things broke that: the map, which fetched from `unpkg.com`
and `tile.openstreetmap.org`, and four groups of hosts that ask a third party
over the network. The map is now on `tiles.jasontally.com`. What is left is
below, with the weather and registry calls the largest group.

**Boundary.** Cloudflare DNS (`cloudflare-dns.com`) is out of scope by decision.
It runs inside Cloudflare at every location the Snippet runs in, it is not rate
limited, and it is the most dependable of the network calls. Do not spend
investigation time on it.

## 1. What constrains every answer

Any replacement has to fit the Snippet, and the Snippet has fixed limits:

| Limit | Where it bites |
| --- | --- |
| 2 subrequests per request on a Pro zone | A design that needs two network calls per host does not work. `dns` already spends both. |
| 5 ms execution budget (measured 0.03 ms) | Time in JavaScript counts. Time waiting on the network does not. |
| 32 KB source (now 16.4 KB, 50% used) | New code must fit. |
| 4096 character rule expression (now 2308, 100 hosts) | No new host label without room, and each host costs about 23 characters. |
| Fail soft, always | Every network host returns empty when the call fails. A replacement that hangs is worse than one that is slow. |

## 2. The inventory, as the code stands

Counted from `snippet.js`, not from the README.

| Source | Hosts | Third party sees the visitor | Limit and terms |
| --- | --- | --- | --- |
| `request.cf` | 40 | no | no |
| request headers | 4 | no | no |
| `new Date()` | 16 | no | no |
| computed in the handler | 11 | no | no |
| `cloudflare-dns.com` | 5 | no, stays inside Cloudflare | no limit |
| `stat.ripe.net` | 7 | yes, RIPE NCC | 8 concurrent, asks you to register above 1000 a day |
| `api.open-meteo.com` | 16 | yes, Open-Meteo in Switzerland | 10,000 a day on the free tier, **non-commercial**, CC BY 4.0 |
| `tiles.jasontally.com` | 1 (`map`) | no, own host on this zone | none published, no SLA |

100 hosts in total: 71 need no network, 23 reach a third party, 5 use Cloudflare
DNS, 1 is a page. The README's summary line still says 28 reach a third party,
which is what it said before the map moved. It is 23 now.

The measured cost of the two that remain, from `README.md`:

- `stat.ripe.net` whois: p50 155 ms, p95 325 ms, **p99 5955 ms**. One sample in
  forty took nearly six seconds.
- The 16 weather hosts: near 600 ms at p95, steadily.

So the registry hosts have two problems, not one. The volume cap is the smaller
of them. The slow tail is the one a visitor feels.

### Not runtime, but dependencies all the same

| Dependency | Used for | Risk |
| --- | --- | --- |
| `npx esbuild` at deploy time | minifying for upload | fetches from npm on every deploy, floats the version |
| `cf` CLI from npm | DNS records, snippet upload, rule | version drift. Two of its bugs are worked around in `deploy.sh` today |
| `icanhazip.com` | `bench.mjs` compares byte for byte against it | a third party in the test path |
| live `stat.ripe.net`, `api.open-meteo.com`, `cloudflare-dns.com` calls | some tests | a third party in the test path |
| Protomaps basemap, OSM planet | the tiles, rebuilt weekly | the map now depends on this supply chain. Different repository, different owner. |

## 3. How to decide

A dependency is worth replacing only if it fails now, or will fail at a volume
we can foresee, or costs money, or forbids what we want to do. Score each one:

1. **Does it cost or cap?** A daily allowance, a concurrency cap, or a term that
   says non-commercial.
2. **Can the data be copied at all?** Is there a bulk form, and does the licence
   let us redistribute what we copy?
3. **How often does it change?** A weather forecast changes hourly. An IP
   allocation changes monthly. A BGP prefix changes in minutes. The answer picks
   the replacement.
4. **Can it be served in one subrequest?** If not, it cannot be a host.
5. **What does the visitor lose?** An empty answer is acceptable and is what
   happens today. A wrong answer is not.
6. **What does it cost us to run?** A Worker, a schedule, storage, and someone
   to notice when the job stops.

Rule of thumb: cache what changes slowly, mirror what is a dataset, drop what
nobody uses.

## 4. The investigation, in order

### Step 0. Know the real numbers

Nothing can be decided without them, and today no counter exists.

1. Count requests per host per day. `reliability.mjs` and `load.mjs` both drive
   every host, so extend one of them or read the logs they already leave.
2. Count outbound subrequests per host, and note that a Pro zone allows 2 per
   request while `dns` uses both.
3. Fix the README's "28 reach a third party" line to the real 23, and keep the
   table and the sentence in step from then on.

Deliverable: one table, hosts down the side, requests per day and p95 across.
Everything after this step cites that table.

### Step 1. Open-Meteo, 16 hosts

The largest group, the only one with a daily cap and a non-commercial term, and
the one whose data changes fastest.

1. Measure per-host volume from step 0. 16 hosts answering one request each
   against a 10,000 a day allowance is the whole question.
2. Read the free tier terms and write down what we would have to keep doing if
   we move: the CC BY 4.0 credit is not on any page today, and the map showed how
   easily that is forgotten.
3. Find out where the forecast comes from upstream and whether it can be fetched
   once and stored. A forecast for the visitor's coordinates is per-request, so
   the question is whether a cached copy is honest for long enough to be useful.
4. Cost out three shapes: a cache on our own host with a TTL, a scheduled job
   that writes to storage and the Snippet reads, and a static dataset. Judge each
   on latency, freshness, storage, and licence.
5. Decide: replace, or keep Open-Meteo and record that the volume does not
   justify it.

Deliverable: a decision record for the 16 hosts, with the measured volume.

### Step 2. RIPE RIS, 7 hosts

Smaller group, but the slow tail is the worst number in the project and the cap
is a real one.

1. Measure volume and the p99 tail, separately. They are different problems with
   different fixes.
2. Work out what data each of the seven actually needs: the allocation fields
   (`NetName`, `NetRange`, `CIDR`) and the announced prefix from BGP. Allocations
   change slowly; announced prefixes change fast.
3. Check what a bulk form would cost: RIS and the BGP dumps are large, and a
   trimmed table is a dataset we would have to rebuild on a schedule.
4. Re-check the paths already ruled out in the code comments, because the reason
   they were ruled out was measured in 2026 and that can change: RDAP direct
   (403 from Cloudflare's network), `rdap.org` (403), the IANA bootstrap file
   (a Snippet cannot cache it).
5. Decide per host. It is possible the honest answer is to keep `whois` and drop
   the prefix hosts, or the reverse.

Deliverable: a decision record per host, with the tail costed.

### Step 3. The build and deploy toolchain

No runtime risk, but it is a network dependency at deploy time and the source of
the drift the README already complains about.

1. Pin `esbuild` as a devDependency with a lockfile, so a deploy does not fetch
   from npm. `mac` already does this.
2. Pin Node, with a `.nvmrc` like `mac` has, so the Cloudflare build image and a
   local build agree.
3. Record the `cf` CLI version the build image installs, and re-test both
   workarounds in `deploy.sh` against it.
4. Prove a cold checkout builds offline.

Deliverable: a deploy that needs the network for nothing but the API calls.

### Step 4. Test and bench dependencies

A third party in the test path is a reliability cost too.

1. List every test that reaches the network: the live reverse DNS probe, the
   registry hosts that must not throw, the weather hosts.
2. Record fixtures for the ones whose value does not matter to what the test
   asserts, and keep live only the ones that prove the format.
3. Decide whether `bench.mjs` still needs `icanhazip.com`, or whether the byte
   comparison should become a recorded golden file.

Deliverable: `npm test` that passes with the network off.

### Step 5. The tiles supply chain

Not this repository, but the map depends on it now.

1. Write down who owns the weekly rebuild of the PMTiles archive, and where it
   fails loudly if it stops.
2. Note the archive's size and the upstream data it is rebuilt from.
3. Record it as a dependency of the `map` host, with an owner, in the same table
   as step 0.

Deliverable: a line in the dependency table with a name against it.

## 5. The shapes a replacement can take

In order of effort, to be costed per dependency rather than chosen up front.

| Shape | What it is | Good for |
| --- | --- | --- |
| Cache with a TTL | our own host serves a stored copy for N minutes | anything where a slightly stale answer is fine |
| Scheduled refresh | a job fetches on a cron and writes to storage; the Snippet reads it | data that changes hourly or daily |
| Full mirror | a bulk import, rebuilt on a schedule | datasets, not queries |
| Drop the host | the answer becomes empty or the host goes | anything the table shows nobody uses |

All four keep the one-subrequest rule, because the Snippet reads one thing.
The cache and the schedule both move the rate limit from per-visitor to per-job,
which is the whole point.

## 6. Guardrails

Do not break these while replacing anything:

- Two subrequests per request, on a Pro zone.
- Fail soft. An empty answer, never a hang. Tests already assert this for the
  registry and weather hosts.
- 32 KB source and the 4096 character rule expression.
- Licence and attribution. CC BY 4.0 for Open-Meteo, ODbL for OpenStreetMap,
  RIPE's terms for the registry data. If a page starts showing third-party data,
  the credit ships with it.
- Do not self-host something that only fails above a volume we do not have. The
  measured table decides that, not the fear of a third party.

## 7. How to run it, and when to stop

- Use the tools that exist: `reliability.mjs`, `load.mjs`, `cost.mjs`,
  `bench.mjs`. Build a new one only where none of them can count what is needed.
- One decision record per dependency. A dependency that stays on a third party is
  a valid outcome, and the record is what makes it defensible.
- Stop when every third party in the table has a recorded decision and a measured
  volume next to it. The goal is a table with no unknown column, not a table with
  no third parties in it.

## 8. Open questions

1. What is the real requests-per-day per host? Step 0, and nothing can be
   decided before it.
2. Are we willing to run a scheduled job and storage for this, or is that a new
   operational burden we do not want?
3. Does the non-commercial term on Open-Meteo conflict with where this site is
   going? That is a licence question, not a technical one.
4. Who owns the tiles rebuild, and what pages when it stops?
5. Is a six second tail on a registry lookup acceptable for a page whose whole
   point is speed?
