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
 *
 * Speed model:
 *   - Progressive render: sources are fetched in parallel and items are
 *     appended (with a "loaded-more" event) the moment EACH source resolves,
 *     so the fastest source paints in a few hundred ms instead of the whole
 *     batch waiting out the slowest one (Poetry's cold dynos alone can take
 *     8s). The cost is that the initial batch is no longer globally shuffled
 *     — arrival order is effectively random anyway.
 *   - Prefetch buffer: after every load, the NEXT batch is fetched in the
 *     background (and its images warmed into the HTTP cache), so appendMore
 *     near scroll-end is usually instant instead of a network round trip.
 *
 * Events: "loading-start" (feed reset), "loaded-more" (this.items grew —
 * render from your last count), "loaded-initial" (initial load settled;
 * check for the empty case).
 */
class FeedManager extends EventTarget {
  // Hard cap on how long one source can take. Without this, a single hung
  // fetch (e.g. a proxy that accepts the connection but never responds)
  // leaves isLoading stuck true and kills infinite scroll for the session.
  static SOURCE_TIMEOUT_MS = 20000;
  static PREFETCH_COUNT = 6; // headroom for two instant appends between refills

  constructor(settingsManager, historyManager) {
    super();
    this.settings = settingsManager;
    this.history = historyManager;
    this.items = [];
    this.seenIds = new Set();
    this.mixer = new Mixer(this.settings.getEnabledKeys());
    this.isLoading = false;
    // Bumped by every loadInitial; in-flight fetches from an older
    // generation check it and drop their results instead of appending
    // stale items into the freshly reset feed.
    this._loadGen = 0;
    this._prefetched = []; // ready-to-show items fetched ahead of need
    this._prefetchPromise = null;

    this.settings.addEventListener("change", (e) => {
      this.mixer.setEnabled(e.detail);
      this.reload();
    });
  }

  async loadInitial(count = 9) {
    const gen = ++this._loadGen;
    this.items = [];
    this.seenIds.clear();
    this._prefetched = [];
    this.mixer.reset();
    this.isLoading = true;
    this._emit("loading-start");
    await this._fetchRounds(count, gen);
    if (gen !== this._loadGen) return; // superseded by a newer load
    this.isLoading = false;
    this._emit("loaded-initial");
    this._prefetch();
  }

  async reload() {
    await this.loadInitial();
  }

  async appendMore(count = 3) {
    if (this.isLoading) return;
    this.isLoading = true;
    const gen = this._loadGen;

    // Prefer the prefetch buffer. Serve whatever is already buffered
    // immediately — only when it's empty wait for an in-flight prefetch
    // (still better than racing it with a duplicate fetch).
    if (this._prefetched.length === 0 && this._prefetchPromise) {
      await this._prefetchPromise;
    }
    if (gen !== this._loadGen) return; // a reload happened; it owns state now

    if (this._prefetched.length > 0) {
      this._append(this._prefetched.splice(0, count)); // instant
    } else {
      await this._fetchRounds(count, gen);
      if (gen !== this._loadGen) return;
    }
    this.isLoading = false;
    this._prefetch();
  }

  /**
   * Fetch up to `count` fresh non-error items, retrying with new picks when
   * dedup eats a round. Items are appended (and events fired) per source as
   * each resolves — see _fetchRound.
   */
  async _fetchRounds(count, gen) {
    if (this.settings.getEnabledKeys().length === 0) return;

    let freshSoFar = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 6; // guards against a near-exhausted history looping forever

    while (freshSoFar < count && attempts < MAX_ATTEMPTS) {
      attempts++;
      const round = await this._fetchRound(count - freshSoFar, gen, (fresh) =>
        this._append(fresh)
      );
      if (gen !== this._loadGen) return;
      freshSoFar += round.freshNonError;
      // If a whole round produced nothing fresh, no point hammering further
      // (likely means the sources' pools are mostly exhausted by history).
      if (round.freshNonError === 0 && round.fetchedAny) break;
    }
  }

  /**
   * One round of parallel per-source fetches. Each source's fresh items are
   * handed to `sink` the moment that source resolves — the feed never waits
   * for the slowest source to paint the fastest one.
   */
  async _fetchRound(count, gen, sink) {
    const grouped = {};
    for (const key of this.mixer.pickSources(count)) {
      grouped[key] = (grouped[key] || 0) + 1;
    }

    let freshNonError = 0;
    let fetchedAny = false;

    await Promise.all(
      Object.entries(grouped).map(async ([key, n]) => {
        const adapter = ADAPTERS_BY_KEY[key];
        if (!adapter) return;
        let results;
        try {
          results = await this._withTimeout(
            adapter.fetchNext(n),
            FeedManager.SOURCE_TIMEOUT_MS
          );
        } catch (_) {
          results = [makeErrorContent(key, adapter.displayName, null)];
        }
        if (gen !== this._loadGen) return; // stale — the feed was reset meanwhile
        for (let i = 0; i < n; i++) this.mixer.recordFetch(key);
        fetchedAny = fetchedAny || results.length > 0;

        const fresh = results.filter((item) => {
          const isErrorCard = item.tags?.includes("error");
          if (isErrorCard) return true; // always surface error cards, don't dedup/retry them
          if (this.seenIds.has(item.id) || this.history.hasSeen(item.id)) return false;
          this.seenIds.add(item.id);
          return true;
        });
        freshNonError += fresh.filter((i) => !i.tags?.includes("error")).length;
        if (fresh.length > 0) sink(fresh);
      })
    );

    return { freshNonError, fetchedAny };
  }

  _append(items) {
    this.items.push(...items);
    this._emit("loaded-more");
  }

  /**
   * Background-fetch the next batch into a buffer so the next appendMore is
   * instant. Best-effort: no retries, error cards dropped (never stockpile
   * stale failures), images pre-warmed into the browser HTTP cache.
   */
  _prefetch() {
    if (this._prefetchPromise) return;
    const need = FeedManager.PREFETCH_COUNT - this._prefetched.length;
    if (need <= 0) return;
    if (this.settings.getEnabledKeys().length === 0) return;

    const gen = this._loadGen;
    this._prefetchPromise = this._fetchRound(need, gen, (fresh) => {
      const real = fresh.filter((i) => !i.tags?.includes("error"));
      this._prefetched.push(...real);
      for (const item of real) {
        if (item.media?.url) new Image().src = item.media.url;
      }
    })
      .catch(() => {})
      .finally(() => {
        this._prefetchPromise = null;
      });
  }

  _withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("source timed out")), ms)
      ),
    ]);
  }

  _emit(name) {
    this.dispatchEvent(new CustomEvent(name));
  }
}
