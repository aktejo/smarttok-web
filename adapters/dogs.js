/**
 * Dogs adapter.
 * Combines free, keyless public APIs into one card:
 *   - Picture: Dog CEO API — https://dog.ceo/dog-api/
 *              falling back to TheDogAPI — https://thedogapi.com/
 *              (dog.ceo has real outages — it was serving HTTP 520s for a
 *              while — so the picture comes from whichever responds)
 *   - Fact:    Dog API by kinduff (v2, JSON:API format) — https://dogapi.dog/
 */
const DogsAdapter = {
  sourceKey: "dogs",
  displayName: "Dogs",
  icon: "🐶",

  async fetchNext(count = 3) {
    const requests = Array.from({ length: count }, () => this._fetchOne());
    return Promise.all(requests);
  },

  async _fetchOne() {
    try {
      const [imageUrl, fact] = await Promise.all([
        this._fetchImage(),
        this._fetchFact(),
      ]);

      if (!imageUrl) {
        return makeErrorContent(this.sourceKey, this.displayName, null);
      }

      // Image URLs from Dog CEO are stable and unique per-breed-photo, so they
      // double as a good dedup ID (e.g. ".../shiba/shiba-12.jpg").
      const id = `dogs-${this._hash(imageUrl)}`;

      return makeContent({
        id,
        sourceKey: this.sourceKey,
        title: "",
        body: fact || "A very good dog.",
        openLink: imageUrl,
        media: { url: imageUrl, alt: "A dog" },
        attribution: this.displayName,
        tags: [],
      });
    } catch (err) {
      return makeErrorContent(this.sourceKey, this.displayName, null);
    }
  },

  async _fetchImage() {
    return (await this._fetchImageDogCeo()) || (await this._fetchImageTheDogApi());
  },

  async _fetchImageDogCeo() {
    try {
      const res = await fetch("https://dog.ceo/api/breeds/image/random");
      if (!res.ok) return null;
      const data = await res.json();
      return data.status === "success" ? data.message : null;
    } catch (_) {
      return null;
    }
  },

  async _fetchImageTheDogApi() {
    try {
      const res = await fetch("https://api.thedogapi.com/v1/images/search");
      if (!res.ok) return null;
      const data = await res.json();
      return data?.[0]?.url || null;
    } catch (_) {
      return null;
    }
  },

  async _fetchFact() {
    try {
      const res = await fetch("https://dogapi.dog/api/v2/facts?limit=1");
      if (!res.ok) return null;
      const data = await res.json();
      return data?.data?.[0]?.attributes?.body || null;
    } catch (_) {
      return null;
    }
  },

  // Small stable string hash so the same image URL always yields the same ID.
  _hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h).toString(36);
  },
};
