/**
 * FeedManager
 * Orchestrates loading the feed: initial balanced batch, continuous
 * append near scroll-end, dedup by stable ID.
 *
 * Two dedup layers:
 *   - seenIds (in-memory, this load only): stops the same item rendering
 *     twice within one batch/session.
 *   - historyManager (persistent, cross-session): stops cards the user has
 *     ever actually seen on screen from being fetched again. FeedManager only
 *     reads history here (hasSeen) to filter; it does NOT record items —
 *     recording happens in app.js once a card is actually visible in the
 *     viewport, not merely fetched/appended to the DOM.
 */
class FeedManager extends EventTarget {
  // Hard cap on how long one source can take. Without this, a single hung
  // fetch (e.g. a proxy that accepts the connection but never responds)
  // leaves isLoading stuck true and kills infinite scroll for the session.
  static SOURCE_TIMEOUT_MS = 20000;

  constructor(settingsManager, historyManager) {
    super();
    this.settings = settingsManager;
    this.history = historyManager;
    this.items = [];
    this.seenIds = new Set();
    this.mixer = new Mixer(this.settings.getEnabledKeys());
    this.isLoading = false;

    this.settings.addEventListener("change", (e) => {
      this.mixer.setEnabled(e.detail);
      this.reload();
    });
  }

  async loadInitial(count = 9) {
    this.items = [];
    this.seenIds.clear();
    this.mixer.reset();
    this._emit("loading-start");
    await this._fetchAndAppend(count, { shuffle: true });
    this._emit("loaded-initial");
  }

  async reload() {
    await this.loadInitial();
  }

  async appendMore(count = 3) {
    if (this.isLoading) return;
    await this._fetchAndAppend(count, { shuffle: false });
  }

  async _fetchAndAppend(count, { shuffle }) {
    if (this.settings.getEnabledKeys().length === 0) {
      this._emit("loaded-more");
      return;
    }
    this.isLoading = true;

    let newItems = [];
    let stillNeeded = count;
    let attempts = 0;
    const MAX_ATTEMPTS = 6; // guards against a near-exhausted history looping forever

    while (stillNeeded > 0 && attempts < MAX_ATTEMPTS) {
      attempts++;
      const fetched = await this._fetchBatch(stillNeeded);

      // Filter out anything seen this session OR ever seen before (persistent history).
      const fresh = fetched.filter((item) => {
        const isErrorCard = item.tags?.includes("error");
        if (isErrorCard) return true; // always show error cards, don't dedup/retry them
        if (this.seenIds.has(item.id) || this.history.hasSeen(item.id)) return false;
        this.seenIds.add(item.id);
        return true;
      });

      newItems.push(...fresh);
      const freshNonError = fresh.filter((i) => !i.tags?.includes("error"));
      stillNeeded = count - newItems.filter((i) => !i.tags?.includes("error")).length;

      // If a whole attempt produced nothing fresh, no point hammering further
      // (likely means this source's pool is mostly exhausted by history).
      if (freshNonError.length === 0 && fetched.length > 0) break;
    }

    if (shuffle) newItems = this._shuffle(newItems);

    this.items.push(...newItems);
    this.isLoading = false;
    this._emit("loaded-more");
  }

  /** Fetch `count` items from the mixer's chosen sources, recording mixer counts. */
  async _fetchBatch(count) {
    const sourcesToFetch = this.mixer.pickSources(count);
    const grouped = {};
    for (const key of sourcesToFetch) grouped[key] = (grouped[key] || 0) + 1;

    const fetches = Object.entries(grouped).map(async ([key, n]) => {
      const adapter = ADAPTERS_BY_KEY[key];
      if (!adapter) return [];
      try {
        const results = await this._withTimeout(
          adapter.fetchNext(n),
          FeedManager.SOURCE_TIMEOUT_MS
        );
        for (let i = 0; i < n; i++) this.mixer.recordFetch(key);
        return results;
      } catch (_) {
        for (let i = 0; i < n; i++) this.mixer.recordFetch(key);
        return [makeErrorContent(key, adapter.displayName, null)];
      }
    });

    const batches = await Promise.all(fetches);
    return batches.flat();
  }

  _withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("source timed out")), ms)
      ),
    ]);
  }

  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  _emit(name) {
    this.dispatchEvent(new CustomEvent(name));
  }
}
