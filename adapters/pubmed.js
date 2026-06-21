/**
 * PubMed adapter.
 * Pulls recent medical articles from NCBI's E-utilities (no key needed)
 * in two steps:
 *   1. esearch — find a pseudo-random PMID by jittering retstart within
 *      a broad, recent query (PubMed has no dedicated "random" endpoint)
 *   2. efetch  — fetch that article's abstract, title, journal, year
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25501/
 *
 * CORS note: eutils.ncbi.nlm.nih.gov doesn't send CORS headers, so both
 * requests are routed through api/proxy.js (see proxiedUrl in
 * js/proxy-config.js) rather than calling NCBI directly from the browser.
 */
const PubMedAdapter = {
  sourceKey: "pubmed",
  displayName: "PubMed",
  icon: "🩺",

  // Broad, evergreen topic queries to rotate through so the feed isn't
  // dominated by one subfield. Restricted to recent years to favor
  // articles that are actually likely to have a public abstract.
  _queries: [
    "cancer", "cardiovascular disease", "neuroscience", "genetics",
    "immunology", "public health", "nutrition", "infectious disease",
    "mental health", "pediatrics", "pharmacology", "epidemiology",
  ],

  async fetchNext(count = 3) {
    const requests = Array.from({ length: count }, () => this._fetchOne());
    return Promise.all(requests);
  },

  async _fetchOne() {
    try {
      const pmid = await this._findRandomPmid();
      if (!pmid) {
        return makeErrorContent(this.sourceKey, this.displayName, null);
      }

      const article = await this._fetchAbstract(pmid);
      if (!article) {
        return makeErrorContent(this.sourceKey, this.displayName, null);
      }

      return makeContent({
        id: `pubmed-${pmid}`,
        sourceKey: this.sourceKey,
        title: article.title,
        body: article.abstract || "No abstract available.",
        openLink: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        media: null,
        attribution: this.displayName,
        tags: article.journal ? [article.journal] : [],
        timestamp: article.year || null,
      });
    } catch (err) {
      return makeErrorContent(this.sourceKey, this.displayName, null);
    }
  },

  async _findRandomPmid() {
    const query = this._queries[Math.floor(Math.random() * this._queries.length)];
    const windowSize = 200;
    const retstart = Math.floor(Math.random() * windowSize);
    const targetUrl =
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed` +
      `&term=${encodeURIComponent(query)}&sort=date&retmode=json` +
      `&retmax=1&retstart=${retstart}`;

    const res = await fetch(proxiedUrl(targetUrl));
    if (!res.ok) return null;
    const data = await res.json();
    const ids = data?.esearchresult?.idlist;
    return Array.isArray(ids) && ids.length > 0 ? ids[0] : null;
  },

  async _fetchAbstract(pmid) {
    const targetUrl =
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed` +
      `&id=${encodeURIComponent(pmid)}&rettype=abstract&retmode=xml`;

    const res = await fetch(proxiedUrl(targetUrl));
    if (!res.ok) return null;
    const xmlText = await res.text();

    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const articleEl = doc.querySelector("PubmedArticle");
    if (!articleEl) return null;

    const title = (articleEl.querySelector("ArticleTitle")?.textContent || "").trim();
    if (!title) return null;

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

    return { title, abstract, journal, year };
  },
};
