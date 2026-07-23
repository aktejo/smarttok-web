/**
 * Economics adapter.
 * Picks a random topic from ECON_TOPICS (sourced from Economist / Wikipedia glossaries)
 * and fetches the bite-sized summary from the Wikipedia REST API.
 */
const EconomicsAdapter = {
  sourceKey: "economics",
  displayName: "Economics (Wiki)",
  icon: "📈",

  async fetchNext(count = 3) {
    const requests = Array.from({ length: count }, () => this._fetchOne());
    const results = await Promise.all(requests);
    return results;
  },

  async _fetchOne() {
    if (typeof ECON_TOPICS === 'undefined' || ECON_TOPICS.length === 0) {
       return makeErrorContent(this.sourceKey, this.displayName, "Topics list not found.");
    }
    
    for (let attempts = 0; attempts < 3; attempts++) {
      const topic = ECON_TOPICS[Math.floor(Math.random() * ECON_TOPICS.length)];
      
      try {
        const res = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
          { headers: { Accept: "application/json" } }
        );
        
        if (!res.ok) continue; 
        
        const data = await res.json();

        if (!data.extract || data.type === "disambiguation") {
          continue;
        }

        const body = this._stripFootnotes(data.extract);
        const thumbnail = data.thumbnail?.source || null;

        return makeContent({
          id: `economics-${data.pageid || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          sourceKey: this.sourceKey,
          title: data.title || topic,
          body,
          openLink: data.content_urls?.desktop?.page || null,
          media: thumbnail ? { url: thumbnail, alt: data.title || "" } : null,
          attribution: this.displayName,
          tags: ["economics", "concept"],
          timestamp: data.timestamp || null,
        });
      } catch (err) {
        continue;
      }
    }
    
    return makeErrorContent(this.sourceKey, this.displayName, "Couldn't fetch an economics concept right now.");
  },

  _stripFootnotes(text) {
    return text.replace(/\[\d+\]/g, "").trim();
  },
};
