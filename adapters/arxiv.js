/**
 * arXiv adapter.
 * Pulls recent papers from the arXiv API and picks a pseudo-random one
 * by jittering the `start` offset, since arXiv has no dedicated
 * "random paper" endpoint.
 * Docs: https://info.arxiv.org/help/api/user-manual.html
 *
 * Note: the arXiv API returns Atom 1.0 XML, not JSON, so responses are
 * parsed with the browser's built-in DOMParser — no extra library needed.
 *
 * CORS note: export.arxiv.org doesn't send CORS headers, so requests
 * are routed through api/proxy.js (see proxiedUrl in js/proxy-config.js)
 * rather than calling arXiv directly from the browser.
 */
const ArxivAdapter = {
  sourceKey: "arxiv",
  displayName: "arXiv",
  icon: "🧪",

  TOPICS_STORAGE_KEY: "smarttok.arxivTopics",

  // All available categories with human-readable labels.
  // See https://arxiv.org/category_taxonomy
  ALL_TOPICS: [
    { key: "cs.AI",          label: "Artificial Intelligence" },
    { key: "cs.LG",          label: "Machine Learning (CS)" },
    { key: "cs.CL",          label: "Computational Linguistics" },
    { key: "cs.CV",          label: "Computer Vision" },
    { key: "cs.RO",          label: "Robotics" },
    { key: "physics.gen-ph", label: "General Physics" },
    { key: "astro-ph.GA",    label: "Astrophysics" },
    { key: "quant-ph",       label: "Quantum Physics" },
    { key: "math.CO",        label: "Combinatorics (Math)" },
    { key: "q-bio.NC",       label: "Neuroscience" },
    { key: "stat.ML",        label: "Machine Learning (Stats)" },
    { key: "econ.GN",        label: "Economics" },
  ],

  _getEnabledCategories() {
    try {
      const raw = localStorage.getItem(this.TOPICS_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        const valid = arr.filter((k) => this.ALL_TOPICS.some((t) => t.key === k));
        if (valid.length > 0) return valid;
      }
    } catch (_) { /* fall through */ }
    return this.ALL_TOPICS.map((t) => t.key);
  },

  async fetchNext(count = 3) {
    const requests = Array.from({ length: count }, () => this._fetchOne());
    return Promise.all(requests);
  },

  async _fetchOne() {
    try {
      const enabled = this._getEnabledCategories();
      const category = enabled[Math.floor(Math.random() * enabled.length)];
      // Search recent submissions in this category, sorted by submission date,
      // then jump to a random offset within a modest, fast-to-query window.
      const windowSize = 200;
      const start = Math.floor(Math.random() * windowSize);
      const targetUrl =
        `https://export.arxiv.org/api/query?search_query=cat:${encodeURIComponent(category)}` +
        `&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=1`;

      const res = await fetch(proxiedUrl(targetUrl));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xmlText = await res.text();

      const entry = this._parseFirstEntry(xmlText);
      if (!entry) {
        return makeErrorContent(this.sourceKey, this.displayName, null);
      }

      return makeContent({
        id: `arxiv-${entry.arxivId}`,
        sourceKey: this.sourceKey,
        title: entry.title,
        body: entry.summary + (entry.firstAuthor ? `\n\n— ${entry.firstAuthor}, ${entry.year}` : ""),
        openLink: entry.absUrl,
        media: null,
        attribution: this.displayName,
        tags: entry.categories,
        timestamp: entry.published,
      });
    } catch (err) {
      return makeErrorContent(this.sourceKey, this.displayName, null);
    }
  },

  _parseFirstEntry(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");

    // A malformed/error response from arXiv is still a valid Atom feed,
    // just with an entry whose <id> contains "/api/errors#".
    const entryEl = doc.querySelector("entry");
    if (!entryEl) return null;

    const idUrl = entryEl.querySelector("id")?.textContent?.trim() || "";
    if (idUrl.includes("/api/errors")) return null;

    const title = (entryEl.querySelector("title")?.textContent || "").replace(/\s+/g, " ").trim();
    const summary = (entryEl.querySelector("summary")?.textContent || "").replace(/\s+/g, " ").trim();
    const published = entryEl.querySelector("published")?.textContent?.trim() || null;

    const authorNames = [...entryEl.querySelectorAll("author > name")].map((n) => n.textContent.trim());
    const firstAuthor = authorNames[0] || null;
    const year = published ? published.slice(0, 4) : "";

    const categories = [...entryEl.querySelectorAll("category")]
      .map((c) => c.getAttribute("term"))
      .filter(Boolean);

    // Prefer the "alternate" link (abstract page); fall back to the <id>.
    const links = [...entryEl.querySelectorAll("link")];
    const altLink = links.find((l) => l.getAttribute("rel") === "alternate");
    const absUrl = altLink?.getAttribute("href") || idUrl;

    // arXiv id is the path segment after /abs/, stripped of any version suffix.
    const arxivId = idUrl.split("/abs/")[1] || idUrl;

    if (!title || !summary) return null;

    return { title, summary, published, firstAuthor, year, categories, absUrl, arxivId };
  },
};
