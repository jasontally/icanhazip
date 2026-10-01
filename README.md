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
| any other hostname            | not run, the snippet rule does not match    |

The plain response is `text/plain`, holds the IP address from
`CF-Connecting-IP`, ends in a newline, and carries `Cache-Control: no-store`,
so no address is ever cached. `whoami` must be the whole query string, so
`?whoami=0` gets the plain IP address.

The `whoami` page shows the request, location, network, TLS and browser
sections, then dumps every request header and the whole `request.cf` object as
JSON. The dump means new Cloudflare fields show up with no code change.

## Deploy

```console
npm i -g cf
read -rs -p "Cloudflare API token: " CF && CLOUDFLARE_API_TOKEN="$CF" ./deploy.sh
```

`deploy.sh` creates the DNS record if it is missing, uploads `snippet.js`,
and puts the rule in place. It is safe to run again.

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

### The DNS record

Snippets run before the origin and this Snippet never calls `fetch()`, so no
origin is contacted. A proxied record for `ip.jasontally.com` must still
exist, because Snippets only run on requests that reach the Cloudflare edge.
The record is an AAAA to `100::1`, from the RFC 6666 IPv6 discard prefix, which
is never routable.

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
| `test/snippet.test.js`| checks for both response shapes            |
