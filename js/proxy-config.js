/**
 * Proxy configuration.
 *
 * Some adapters (arXiv, PubMed) need to route through api/proxy.js
 * because their upstream APIs don't send CORS headers — see
 * api/proxy.js for the full explanation.
 *
 * If you deploy the static site and the Vercel proxy together (the
 * normal case — `vercel deploy` from this folder), leave this as "" and
 * requests will hit /api/proxy on the same origin.
 *
 * If you deploy them separately (e.g. static site on GitHub Pages, proxy
 * on its own Vercel project), set this to that project's full URL, e.g.
 * "https://your-proxy.vercel.app".
 */
const PROXY_BASE_URL = "";

/** Build a same-origin (or cross-origin, if PROXY_BASE_URL is set) proxy URL for a target. */
function proxiedUrl(targetUrl) {
  return `${PROXY_BASE_URL}/api/proxy?url=${encodeURIComponent(targetUrl)}`;
}
