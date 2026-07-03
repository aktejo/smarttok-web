/**
 * PubMed adapter.
 * Pulls recent medical articles from NCBI's E-utilities (no key needed):
 *   1. esearch — grab a window of PMIDs from a pseudo-random offset within
 *      a broad, recent topic query (PubMed has no "random" endpoint)
 *   2. efetch  — fetch ALL of those abstracts in one comma-separated call
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25501/
 *
 * CORS note: eutils.ncbi.nlm.nih.gov doesn't send CORS headers, so both
 * requests are routed through api/proxy.js (see proxiedUrl in
 * js/proxy-config.js) rather than calling NCBI directly from the browser.
 *
 * Rate-limit note: NCBI allows only 3 req/s per IP, and in production the
 * proxy's egress IP is shared with other Vercel customers — per-card
 * requests got 429'd constantly. So this adapter batches: 2 upstream calls
 * fill a ~10-card buffer, and fetchNext() drains it with zero network
 * traffic. One batch is all one topic, but the mixer only shows 1-2 PubMed
 * cards per feed batch, so the variety loss isn't visible in practice.
 */
const PubMedAdapter = {
  sourceKey: "pubmed",
  displayName: "PubMed",
  icon: "🩺",
  simplify: true, // paper abstracts get on-device plain-English one-liners (js/summarizer.js)

  // Broad, evergreen topic queries to rotate through so the feed isn't
  // dominated by one subfield. Restricted to recent years to favor
  // articles that are actually likely to have a public abstract.
  _queries: [
    "cancer", "cardiovascular disease", "neuroscience", "genetics",
    "immunology", "public health", "nutrition", "infectious disease",
    "mental health", "pediatrics", "pharmacology", "epidemiology",
  ],

  BATCH_SIZE: 10,
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
        const pmids = await this._findRandomPmids(this.BATCH_SIZE);
        if (pmids.length === 0) return;
        const cards = await this._fetchAbstracts(pmids);
        this._buffer.push(...cards);
      } catch (_) {
        // Leave buffer as-is; fetchNext will pad with error cards.
      } finally {
        this._fillPromise = null;
      }
    })();
    return this._fillPromise;
  },

  /** fetch() with a hard timeout so a hung request can't wedge _fillPromise forever. */
  async _fetchWithTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  },

  async _findRandomPmids(n) {
    const query = this._queries[Math.floor(Math.random() * this._queries.length)];
    const windowSize = 200;
    const retstart = Math.floor(Math.random() * windowSize);
    const targetUrl =
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed` +
      `&term=${encodeURIComponent(query)}&sort=date&retmode=json` +
      `&retmax=${n}&retstart=${retstart}`;

    const res = await this._fetchWithTimeout(proxiedUrl(targetUrl));
    if (!res.ok) return [];
    const data = await res.json();
    const ids = data?.esearchresult?.idlist;
    return Array.isArray(ids) ? ids : [];
  },

  async _fetchAbstracts(pmids) {
    const targetUrl =
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed` +
      `&id=${encodeURIComponent(pmids.join(","))}&rettype=abstract&retmode=xml`;

    const res = await this._fetchWithTimeout(proxiedUrl(targetUrl));
    if (!res.ok) return [];
    const xmlText = await res.text();

    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const cards = [];
    for (const articleEl of doc.querySelectorAll("PubmedArticle")) {
      const pmid = articleEl.querySelector("MedlineCitation > PMID")?.textContent?.trim();
      const title = (articleEl.querySelector("ArticleTitle")?.textContent || "").trim();
      if (!pmid || !title) continue;

      // AbstractText can be split into multiple labeled sections
      // (Background, Methods, Results, Conclusions); join them with spaces.
      const abstractParts = [...articleEl.querySelectorAll("Abstract > AbstractText")]
        .map((el) => el.textContent.trim())
        .filter(Boolean);
      const abstract = abstractParts.join(" ");

      const journal = (articleEl.querySelector("Journal > Title")?.textContent || "").trim();
      const year =
        articleEl.querySelector("Journal PubDate Year")?.textContent?.trim() ||
        articleEl.querySelector("PubDate Year")?.textContent?.trim() ||
        null;

      cards.push(makeContent({
        id: `pubmed-${pmid}`,
        sourceKey: this.sourceKey,
        title,
        body: abstract || "No abstract available.",
        openLink: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        media: null,
        attribution: this.displayName,
        tags: journal ? [journal] : [],
        timestamp: year,
      }));
    }
    return cards;
  },
};
