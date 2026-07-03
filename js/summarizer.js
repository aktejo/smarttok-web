/**
 * SummaryManager
 * On-device AI "in plain English" one-liners for paper-style cards,
 * inserted between the title and the abstract.
 *
 * Uses Chrome's built-in Summarizer API (Gemini Nano) — free, keyless,
 * and fully on-device: card text never leaves the browser. In browsers
 * without the API the feature simply doesn't exist and cards render
 * exactly as before. https://developer.mozilla.org/docs/Web/API/Summarizer
 *
 * Which sources get summaries is declared by the adapter (`simplify: true`
 * on arXiv/PubMed), so feed/UI code stays source-agnostic.
 *
 * Model download is only ever started from the Settings row (it needs a
 * user gesture and is a one-time multi-hundred-MB download managed by
 * Chrome itself). Until the model is "available", attach() is a no-op.
 *
 * Summaries are cached in localStorage by card id, so a card is only ever
 * summarized once — Liked/History views get instant cached summaries.
 */
const SummaryManager = {
  PREF_KEY: "smarttok.aiSummaries",     // "on" | "off" (default on when available)
  CACHE_KEY: "smarttok.summaryCache",   // [[id, summary], ...] oldest first
  CACHE_MAX: 300,
  MIN_BODY_LENGTH: 200,                 // shorter bodies don't need simplifying

  availabilityState: "unknown",         // unavailable | downloadable | downloading | available
  downloadProgress: 0,
  _summarizerPromise: null,
  _queue: [],
  _draining: false,
  _cache: null,

  supported() {
    return typeof self !== "undefined" && "Summarizer" in self;
  },

  async init() {
    if (!this.supported()) {
      this.availabilityState = "unavailable";
      return this.availabilityState;
    }
    try {
      this.availabilityState = await Summarizer.availability();
    } catch (_) {
      this.availabilityState = "unavailable";
    }
    return this.availabilityState;
  },

  enabled() {
    return localStorage.getItem(this.PREF_KEY) !== "off";
  },

  setEnabled(on) {
    localStorage.setItem(this.PREF_KEY, on ? "on" : "off");
  },

  /**
   * Create (or reuse) the summarizer instance. When the model still needs
   * downloading this MUST be called from a user gesture (the Settings
   * button) — Chrome requires user activation to start the download.
   */
  ensureModel(onProgress) {
    if (!this._summarizerPromise) {
      const mgr = this;
      this._summarizerPromise = Summarizer.create({
        type: "tldr", // NB: the shipped enum is "tldr" — "tl;dr" (explainer spelling) throws
        format: "plain-text",
        length: "short",
        sharedContext:
          "These are academic paper abstracts. Restate the gist in one short, " +
          "friendly plain-English sentence that a curious high-schooler would " +
          "understand. No jargon, no hedging.",
        monitor(m) {
          m.addEventListener("downloadprogress", (e) => {
            mgr.availabilityState = "downloading";
            mgr.downloadProgress = e.loaded || 0;
            if (onProgress) onProgress(mgr.downloadProgress);
          });
        },
      }).then((s) => {
        mgr.availabilityState = "available";
        return s;
      }).catch((err) => {
        mgr._summarizerPromise = null; // allow retrying
        throw err;
      });
    }
    return this._summarizerPromise;
  },

  /**
   * Called by card-view while building a card whose adapter opted in.
   * Synchronously inserts a slot into `container` (between title and body
   * text) if a summary exists or can be generated; no-op otherwise.
   */
  attach(container, content) {
    if (!this.supported() || !this.enabled()) return;
    if (this.availabilityState !== "available") return;
    if ((content.body || "").length < this.MIN_BODY_LENGTH) return;

    const slot = document.createElement("div");
    slot.className = "card-simple";

    const cached = this._cacheGet(content.id);
    if (cached) {
      slot.textContent = `✨ ${cached}`;
      container.appendChild(slot);
      return;
    }

    slot.textContent = "✨ Putting this in plain English…";
    slot.classList.add("pending");
    container.appendChild(slot);
    this._queue.push({ slot, content });
    this._drain();
  },

  async _drain() {
    if (this._draining) return;
    this._draining = true;
    try {
      const summarizer = await this.ensureModel();
      while (this._queue.length > 0) {
        const { slot, content } = this._queue.shift();
        try {
          const summary = (await summarizer.summarize(content.body)).trim();
          // Sanity: a real summary is shorter than its source. Chromium
          // builds without the actual model ship a test backend that echoes
          // the input back with a warning prepended — never show or cache that.
          if (!summary || summary.length >= content.body.length) {
            throw new Error("implausible summary");
          }
          this._cachePut(content.id, summary);
          if (slot.isConnected) {
            slot.textContent = `✨ ${summary}`;
            slot.classList.remove("pending");
          }
        } catch (_) {
          slot.remove(); // quietly fall back to the plain card
        }
      }
    } catch (_) {
      // Model failed to initialize — clear pending placeholders.
      for (const { slot } of this._queue.splice(0)) slot.remove();
    } finally {
      this._draining = false;
    }
  },

  // ---------- summary cache ----------
  _loadCache() {
    if (this._cache) return;
    this._cache = new Map();
    try {
      const raw = localStorage.getItem(this.CACHE_KEY);
      if (raw) this._cache = new Map(JSON.parse(raw));
    } catch (_) { /* start empty */ }
  },

  _cacheGet(id) {
    this._loadCache();
    return this._cache.get(id) || null;
  },

  _cachePut(id, summary) {
    this._loadCache();
    this._cache.set(id, summary);
    while (this._cache.size > this.CACHE_MAX) {
      this._cache.delete(this._cache.keys().next().value); // drop oldest
    }
    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify([...this._cache]));
    } catch (_) { /* cache is best-effort */ }
  },
};
