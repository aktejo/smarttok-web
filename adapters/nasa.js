/**
 * NASA Astronomy Picture of the Day (APOD) adapter.
 * Uses a personal API key stored in localStorage, falling back to DEMO_KEY.
 * Get a free key at https://api.nasa.gov/ (1000 req/hour vs 30 for DEMO_KEY).
 * Docs: https://api.nasa.gov/
 *
 * CORS: api.nasa.gov sends Access-Control-Allow-Origin: * — no proxy needed.
 *
 * Fetches 20 random entries at a time and buffers them internally so that
 * each fetchNext() drains the buffer rather than making a tiny count=1 request.
 * This avoids NASA's small-count random bias (the same dates recurring) and
 * keeps API calls low.
 */
const NasaAdapter = {
  sourceKey: "nasa",
  displayName: "NASA APOD",
  icon: "🔭",

  API_KEY_STORAGE_KEY: "smarttok.nasaApiKey",
  _buffer: [],
  _fillPromise: null,

  _getApiKey() {
    return localStorage.getItem(this.API_KEY_STORAGE_KEY) || "DEMO_KEY";
  },

  async fetchNext(count = 3) {
    await this._ensureBuffer(count);
    const results = this._buffer.splice(0, count);
    while (results.length < count) {
      results.push(makeErrorContent(this.sourceKey, this.displayName, null));
    }
    // Kick off a background refill if the buffer is getting low.
    if (this._buffer.length < 5 && !this._fillPromise) {
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const key = this._getApiKey();
        const res = await fetch(
          `https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(key)}&count=20`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const items = await res.json();
        const cards = items
          .filter((item) => item.media_type === "image")
          .map((item) => this._toContent(item));
        this._buffer.push(...cards);
      } catch (_) {
        // Leave buffer empty; fetchNext will pad with error cards.
      } finally {
        clearTimeout(timeout);
        this._fillPromise = null;
      }
    })();
    return this._fillPromise;
  },

  _toContent(item) {
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
  },
};
