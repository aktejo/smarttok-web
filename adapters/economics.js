/**
 * Economics adapter.
 * Serves bite-sized economics concepts: picks a random topic from
 * ECON_TOPICS (adapters/topics.js — Wikipedia's economics glossaries and
 * outlines, validated so every entry resolves to a real article) and
 * fetches the summary extract from the Wikipedia REST API. No key needed;
 * en.wikipedia.org sends CORS headers.
 */
const EconomicsAdapter = {
  sourceKey: "economics",
  displayName: "Economics",
  icon: "📈",

  async fetchNext(count = 3) {
    const requests = Array.from({ length: count }, () => this._fetchOne());
    return Promise.all(requests);
  },

  async _fetchOne() {
    if (typeof ECON_TOPICS === "undefined" || ECON_TOPICS.length === 0) {
      return makeErrorContent(this.sourceKey, this.displayName, null);
    }

    // Topics are pre-validated, so misses are rare — retries cover
    // transient network errors and the odd page that changed since.
    for (let attempts = 0; attempts < 3; attempts++) {
      const topic = ECON_TOPICS[Math.floor(Math.random() * ECON_TOPICS.length)];
      try {
        const res = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
          { headers: { Accept: "application/json" } }
        );
        if (!res.ok) continue;
        const data = await res.json();
        if (!data.extract || data.type === "disambiguation") continue;

        return makeContent({
          // pageid is stable per article, so the same concept always dedups
          // against seenIds/history (a per-fetch random id would not).
          id: `economics-${data.pageid}`,
          sourceKey: this.sourceKey,
          title: data.title || topic,
          body: this._stripFootnotes(data.extract),
          openLink: data.content_urls?.desktop?.page || null,
          media: data.thumbnail?.source
            ? { url: data.thumbnail.source, alt: data.title || "" }
            : null,
          attribution: this.displayName,
          tags: ["economics", "concept"],
          timestamp: data.timestamp || null,
        });
      } catch (_) {
        continue; // network hiccup — try another topic
      }
    }
    return makeErrorContent(this.sourceKey, this.displayName, null);
  },

  // Wikipedia extracts occasionally include footnote markers like [1], [2].
  _stripFootnotes(text) {
    return text.replace(/\[\d+\]/g, "").trim();
  },
};
