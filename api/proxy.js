/**
 * Generic CORS proxy.
 *
 * Some public APIs (arXiv, NCBI/PubMed) are perfectly free and keyless,
 * but don't send Access-Control-Allow-Origin headers, so a browser can't
 * fetch() them directly from a client-side-only app. This function runs
 * server-side (no CORS restriction applies to server-to-server requests),
 * fetches the target URL, and re-serves the response with CORS headers
 * attached — so any adapter can route through it with one extra step.
 *
 * Usage from an adapter:
 *   const proxied = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
 *   const res = await fetch(proxied);
 *
 * Security: only hosts in ALLOWED_HOSTS may be proxied. This is NOT an
 * open relay — add a host here deliberately when wiring up a new adapter
 * that needs it, the same way adapters/index.js is the deliberate
 * registration point for new sources.
 */

const ALLOWED_HOSTS = new Set([
  "export.arxiv.org",
  "eutils.ncbi.nlm.nih.gov",
]);

const TIMEOUT_MS = 10000;

export default async function handler(req, res) {
  // CORS preflight + response headers — wide open since this only ever
  // proxies public, read-only, keyless GET endpoints.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Only GET is supported" });
    return;
  }

  const target = req.query.url;
  if (!target || typeof target !== "string") {
    res.status(400).json({ error: "Missing required ?url= parameter" });
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch (_) {
    res.status(400).json({ error: "Invalid url parameter" });
    return;
  }

  if (parsed.protocol !== "https:") {
    res.status(400).json({ error: "Only https:// targets are allowed" });
    return;
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    res.status(403).json({ error: `Host not allowed: ${parsed.hostname}` });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: { Accept: "application/json, application/xml, text/xml, */*" },
      signal: controller.signal,
    });

    const contentType = upstream.headers.get("content-type") || "text/plain";
    const body = await upstream.text();

    res.status(upstream.status);
    res.setHeader("Content-Type", contentType);
    // Light caching: these are public, slowly-changing-enough feeds, and
    // caching cuts upstream load from repeat fetches across users.
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
    res.send(body);
  } catch (err) {
    const timedOut = err.name === "AbortError";
    res.status(timedOut ? 504 : 502).json({
      error: timedOut ? "Upstream request timed out" : "Upstream request failed",
    });
  } finally {
    clearTimeout(timeout);
  }
}
