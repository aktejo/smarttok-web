/**
 * CORE adapter.
 * Open-access research papers from across every repository CORE
 * aggregates (~300M works). Docs: https://api.core.ac.uk/docs/v3
 *
 * CORS: api.core.ac.uk sends no CORS headers (verified live), so requests
 * go through api/proxy.js.
 *
 * Rate limits: anonymous access works but is tiny (~10 req/min, shared
 * per IP — and in production the proxy's egress IP is shared with other
 * Vercel customers). Two mitigations, same pattern as PubMed:
 *   1. Buffering — one search request (limit=10) fills a ~10-card buffer,
 *      so most fetchNext() calls cost zero upstream requests.
 *   2. An optional free registered key lifts the limit; the proxy injects
 *      it server-side from the CORE_API_KEY env var (see api/proxy.js) —
 *      no adapter changes needed and the key never reaches the browser.
 *
 * Random strategy: CORE has no random endpoint, so rotate broad topic
 * queries and jitter the offset — the arXiv/PubMed approach.
 */
const CoreAdapter = {
  sourceKey: "core",
  displayName: "CORE",
  icon: "🎓",
  simplify: true, // paper abstracts get on-device plain-English one-liners (js/summarizer.js)
  // Off until enabled in Settings, and tucked under the Experiments
  // section there: without CORE_API_KEY on the proxy the anonymous quota
  // is so small that most visitors would only see error cards. Remove
  // both flags once the env var is configured.
  defaultEnabled: false,
  experimental: true,
  settingsNote:
    "Needs a free CORE API key configured on the server (see README) — " +
    "without it, cards will usually fail to load.",

  _queries: [
    "climate change", "artificial intelligence", "renewable energy",
    "microbiology", "materials science", "linguistics", "archaeology",
    "behavioral economics", "oceanography", "biodiversity",
    "quantum computing", "urban planning",
  ],

  BATCH_SIZE: 10,
  OFFSET_WINDOW: 190,       // jitter within the first ~200 hits of each topic
  REQUEST_TIMEOUT_MS: 8000,
  _buffer: [],
  _fillPromise: null,

  async fetchNext(count = 3) {
    await this._ensureBuffer(count);
    const results = this._buffer.splice(0, count);
    while (results.length < count) {
      results.push(makeErrorContent(this.sourceKey, this.displayName, null));
    }
    // Kick off a background refill if the buffer is getting low.
    if (this._buffer.length < count && !this._fillPromise) {
      this._fillBuffer();
    }
    return results;
  },

  async _ensureBuffer(needed) {
    if (this._buffer.length >= needed) return;
    // If a fill is already in flight, wait for it rather than starting another.
    if (!this._fillPromise) this._fillBuffer();
    await this._fillPromise;
    // One retry: the fill is all-or-nothing, so without this a single
    // transient failure turns the whole batch into error cards.
    if (this._buffer.length < needed && !this._fillPromise) {
      await this._fillBuffer();
    }
  },

  _fillBuffer() {
    this._fillPromise = (async () => {
      try {
        const query = this._queries[Math.floor(Math.random() * this._queries.length)];
        const offset = Math.floor(Math.random() * this.OFFSET_WINDOW);
        const targetUrl =
          `https://api.core.ac.uk/v3/search/works` +
          `?q=${encodeURIComponent(query)}&limit=${this.BATCH_SIZE}&offset=${offset}`;

        const res = await this._fetchWithTimeout(proxiedUrl(targetUrl));
        if (!res.ok) return; // 429 when the anonymous quota is spent — buffer stays empty
        const data = await res.json();
        const works = Array.isArray(data?.results) ? data.results : [];

        for (const work of works) {
          const card = this._toContent(work);
          if (card) this._buffer.push(card);
        }
      } catch (_) {
        // Leave buffer as-is; fetchNext will pad with error cards.
      } finally {
        this._fillPromise = null;
      }
    })();
    return this._fillPromise;
  },

  async _fetchWithTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  },

  /** Map one CORE work to a card — or null if it lacks a usable abstract. */
  _toContent(work) {
    const title = (work?.title || "").replace(/\s+/g, " ").trim();
    const abstract = (work?.abstract || "").replace(/\s+/g, " ").trim();
    // Plenty of CORE records have no abstract (or a stub) — skip those,
    // a title alone makes a useless card.
    if (!title || abstract.length < 100) return null;

    const rawAuthor = work.authors?.[0]?.name || null;
    // Author names are usually "Last, First" — flip for display.
    const author = rawAuthor && rawAuthor.includes(",")
      ? rawAuthor.split(",").map((s) => s.trim()).reverse().join(" ")
      : rawAuthor;
    const year = work.yearPublished || null;

    const byline = author ? `\n\n— ${author}${year ? `, ${year}` : ""}` : "";

    return makeContent({
      id: `core-${work.id}`,
      sourceKey: this.sourceKey,
      title,
      body: abstract + byline,
      openLink: work.doi
        ? `https://doi.org/${work.doi}`
        : `https://core.ac.uk/works/${work.id}`,
      media: null,
      attribution: this.displayName,
      tags: work.publisher ? [String(work.publisher).trim()] : [],
      timestamp: year ? String(year) : null,
    });
  },
};
