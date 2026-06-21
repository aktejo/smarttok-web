/**
 * Wikipedia adapter.
 * Pulls random article summaries from the Wikipedia REST API (no key needed).
 * Docs: https://en.wikipedia.org/api/rest_v1/
 */
const WikipediaAdapter = {
  sourceKey: "wikipedia",
  displayName: "Wikipedia",
  icon: "📖",

  async fetchNext(count = 3) {
    const requests = Array.from({ length: count }, () => this._fetchOne());
    const results = await Promise.all(requests);
    return results;
  },

  async _fetchOne() {
    try {
      const res = await fetch(
        "https://en.wikipedia.org/api/rest_v1/page/random/summary",
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Some pages (disambiguation, etc.) have no extract — skip via error item.
      if (!data.extract || data.type === "disambiguation") {
        return makeErrorContent(this.sourceKey, this.displayName, null);
      }

      const body = this._stripFootnotes(data.extract);
      const thumbnail = data.thumbnail?.source || null;

      return makeContent({
        id: `wikipedia-${data.pageid}`,
        sourceKey: this.sourceKey,
        title: data.title || "",
        body,
        openLink: data.content_urls?.desktop?.page || null,
        media: thumbnail ? { url: thumbnail, alt: data.title || "" } : null,
        attribution: this.displayName,
        tags: data.description ? [data.description] : [],
        timestamp: data.timestamp || null,
      });
    } catch (err) {
      return makeErrorContent(this.sourceKey, this.displayName, null);
    }
  },

  // Wikipedia summaries occasionally include footnote markers like [1], [2].
  _stripFootnotes(text) {
    return text.replace(/\[\d+\]/g, "").trim();
  },
};
