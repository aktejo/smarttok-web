/**
 * Philosophy adapter.
 * Picks a random topic from PHILOSOPHY_TOPICS (sourced from SEP)
 * and fetches the bite-sized summary from the Wikipedia REST API.
 */
const PhilosophyAdapter = {
  sourceKey: "philosophy",
  displayName: "Philosophy (SEP)",
  icon: "🤔",

  async fetchNext(count = 3) {
    const requests = Array.from({ length: count }, () => this._fetchOne());
    const results = await Promise.all(requests);
    return results;
  },

  async _fetchOne() {
    // Pick a random topic from our massive curated array (defined in topics.js)
    if (typeof PHILOSOPHY_TOPICS === 'undefined' || PHILOSOPHY_TOPICS.length === 0) {
       return makeErrorContent(this.sourceKey, this.displayName, "Topics list not found.");
    }
    
    // Attempt up to 3 times to find a good Wikipedia match for the topic
    for (let attempts = 0; attempts < 3; attempts++) {
      const topic = PHILOSOPHY_TOPICS[Math.floor(Math.random() * PHILOSOPHY_TOPICS.length)];
      
      try {
        // We use the specific page summary endpoint, passing the topic
        const res = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
          { headers: { Accept: "application/json" } }
        );
        
        if (!res.ok) continue; // If Wikipedia doesn't have an exact match, try another topic
        
        const data = await res.json();

        // Skip disambiguation pages or pages without extracts
        if (!data.extract || data.type === "disambiguation") {
          continue;
        }

        const body = this._stripFootnotes(data.extract);
        const thumbnail = data.thumbnail?.source || null;

        return makeContent({
          id: `philosophy-${data.pageid || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          sourceKey: this.sourceKey,
          title: data.title || topic,
          body,
          openLink: data.content_urls?.desktop?.page || null,
          media: thumbnail ? { url: thumbnail, alt: data.title || "" } : null,
          attribution: this.displayName,
          tags: ["philosophy", "concept"],
          timestamp: data.timestamp || null,
        });
      } catch (err) {
        // network error, try again
        continue;
      }
    }
    
    // If we failed 3 times, return a friendly error card
    return makeErrorContent(this.sourceKey, this.displayName, "Couldn't fetch a philosophy concept right now.");
  },

  _stripFootnotes(text) {
    return text.replace(/\[\d+\]/g, "").trim();
  },
};
