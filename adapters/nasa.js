/**
 * NASA Astronomy Picture of the Day (APOD) adapter.
 * Uses the DEMO_KEY (no registration required) which allows
 * 30 requests/hour per IP — plenty for a discovery feed.
 * Docs: https://api.nasa.gov/
 *
 * CORS: api.nasa.gov sends Access-Control-Allow-Origin: * so
 * direct fetch() works — no proxy needed.
 */
const NasaAdapter = {
  sourceKey: "nasa",
  displayName: "NASA APOD",
  icon: "🔭",

  async fetchNext(count = 3) {
    const requests = Array.from({ length: count }, () => this._fetchOne());
    return Promise.all(requests);
  },

  API_KEY_STORAGE_KEY: "smarttok.nasaApiKey",

  _getApiKey() {
    return localStorage.getItem(this.API_KEY_STORAGE_KEY) || "DEMO_KEY";
  },

  async _fetchOne() {
    try {
      const key = this._getApiKey();
      const res = await fetch(
        `https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(key)}&count=1`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const [item] = await res.json();

      // APOD occasionally returns videos (YouTube embeds) — skip them
      // since we can't show a useful image card for those.
      if (item.media_type !== "image") {
        return makeErrorContent(this.sourceKey, this.displayName, null);
      }

      const attribution = item.copyright
        ? `NASA APOD · © ${item.copyright.trim()}`
        : "NASA APOD";

      return makeContent({
        id: `nasa-apod-${item.date}`,
        sourceKey: this.sourceKey,
        title: item.title,
        body: item.explanation,
        openLink: `https://apod.nasa.gov/apod/ap${item.date.replace(/-/g, "").slice(2)}.html`,
        media: { type: "image", url: item.url, alt: item.title },
        attribution,
        tags: ["astronomy", "nasa", "space"],
        timestamp: item.date,
      });
    } catch (err) {
      return makeErrorContent(this.sourceKey, this.displayName, null);
    }
  },
};
