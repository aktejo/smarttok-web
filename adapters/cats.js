/**
 * Cats adapter.
 * Combines two free, keyless public APIs into one card:
 *   - Picture: Cataas ("Cat as a Service") — https://cataas.com
 *   - Fact:    Cat Facts API — https://catfact.ninja
 *
 * Cataas's plain /cat endpoint returns image bytes directly (no JSON
 * wrapper with a stable per-image ID), so we mint our own ID using a
 * timestamp + random suffix and pass a matching cache-busting query
 * param so the <img> actually requests a fresh photo each time.
 */
const CatsAdapter = {
  sourceKey: "cats",
  displayName: "Cats",
  icon: "🐱",

  async fetchNext(count = 3) {
    const requests = Array.from({ length: count }, () => this._fetchOne());
    return Promise.all(requests);
  },

  async _fetchOne() {
    try {
      const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const imageUrl = `https://cataas.com/cat?width=700&t=${nonce}`;
      const fact = await this._fetchFact();

      return makeContent({
        id: `cats-${nonce}`,
        sourceKey: this.sourceKey,
        title: "",
        body: fact || "A very good cat.",
        openLink: imageUrl,
        media: { url: imageUrl, alt: "A cat" },
        attribution: this.displayName,
        tags: [],
      });
    } catch (err) {
      return makeErrorContent(this.sourceKey, this.displayName, null);
    }
  },

  async _fetchFact() {
    try {
      const res = await fetch("https://catfact.ninja/fact");
      if (!res.ok) return null;
      const data = await res.json();
      return data?.fact || null;
    } catch (_) {
      return null;
    }
  },
};
