# SmartTok (web)

An endless feed of curated content — Wikipedia, Dogs, Cats, arXiv, and PubMed
— pulled live from public APIs. Plain HTML/CSS/JS, no build step, no framework.

## Running locally

Most sources work straight from a static file server:

```bash
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000`.

**Wikipedia, Dogs, and Cats** will work immediately this way — their APIs
send the right CORS headers for direct browser access.

**arXiv and PubMed will show "couldn't load this one" cards** unless the
proxy (see below) is also running, because neither of those APIs sends CORS
headers, so a browser can't `fetch()` them directly no matter how the
adapter code is written.

## Why a proxy?

`export.arxiv.org` and `eutils.ncbi.nlm.nih.gov` are both free, keyless,
public APIs — but neither returns an `Access-Control-Allow-Origin` header,
which means browsers block client-side `fetch()` calls to them regardless of
origin. This isn't a bug in the adapter; it's a deliberate (or at least
unaddressed) choice on those services' end.

The fix is `api/proxy.js`: a small serverless function that makes the
request server-side (servers aren't subject to CORS) and re-serves the
response with its own CORS header attached. Any adapter can use it by
wrapping its target URL with `proxiedUrl(...)` from `js/proxy-config.js`
instead of calling the upstream API directly. It's a generic relay, not
arXiv/PubMed-specific — allowlisted hosts live in `api/proxy.js`.

## Deploying the proxy (Vercel)

1. Install the Vercel CLI if you don't have it: `npm i -g vercel`
2. From this project folder: `vercel deploy`
3. Follow the prompts (first deploy will ask you to link/create a project)

That's it — `vercel.json` is already configured, and `api/proxy.js` will
deploy automatically as a serverless function at `/api/proxy`.

**If you deploy the static site and the proxy together** (the default —
just `vercel deploy` from this folder), no further config is needed. The
adapters call `/api/proxy` on the same origin.

**If you deploy them separately** (e.g. the static site on GitHub Pages or
Netlify, with only the proxy on Vercel), open `js/proxy-config.js` and set
`PROXY_BASE_URL` to your deployed proxy's full URL, e.g.:

```js
const PROXY_BASE_URL = "https://your-proxy.vercel.app";
```

## Adding a new source

1. Create `adapters/yoursource.js` — see `adapters/PROTOCOL.js` for the
   contract every adapter follows.
2. If the upstream API sends CORS headers, call it directly with `fetch()`.
   If not, route through the proxy:
   - add the API's hostname to `ALLOWED_HOSTS` in `api/proxy.js`
   - call `fetch(proxiedUrl(targetUrl))` instead of `fetch(targetUrl)`
3. Add one line to `adapters/index.js` to register it, and one `<script>`
   tag in `index.html` to load the file.

Nothing else — Settings, the Mixer, and the feed all pick up new sources
automatically from the registry.
