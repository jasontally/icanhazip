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

`cf` v1.0.0-beta.10 sends the snippet code as multipart part `file`, but the
Snippets API needs that part named `files`, so `cf snippets update` fails.
`deploy.sh` tries `cf` first and falls back to the documented `curl` form.
Remove the fallback once `cf` sends `files`.

## Test

```console
npm test
```

`node --test` runs against a fake `Request`, so no network or account is
needed.

## Files

| File               | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `snippet.js`       | the Snippet, the only file Cloudflare runs   |
| `deploy.sh`        | DNS, code and rule deployment through `cf`   |
| `test/snippet.test.js` | checks for both response shapes          |
