/**
 * AffinityManager
 * Local, non-ML interest learning for the educational depth feed.
 * Everything lives in localStorage — no data ever leaves the device.
 *
 * How a source opts in: set `categories: ["philosophy", ...]` (canonical
 * slugs from AffinityManager.CATEGORIES) on its NormalizedContent items.
 * Sources without categories are invisible to the algorithm — the whole-feed
 * rollout happens one source at a time by giving each a category mapping.
 *
 * Signals (recorded by app.js / redesign-app.js / card-view.js):
 *   open  +3.0  — tapped through to the full article (the depth signal)
 *   save  +4.0  — explicit save/like
 *   dwell +0.5 / +1.5 — 3s / 8s on screen (60% visible)
 *   skip  −0.75 — flicked past in under 1.2s
 *
 * Anti-narrowing:
 *   - novelty penalty: candidates from categories that dominate the last
 *     RECENT_SHOWN_MAX shown items are scored down proportionally
 *   - exploration floor: rank() reserves ~18% of slots for random picks
 *     regardless of affinity
 */
const AffinityManager = {
  STORAGE_KEY: "smarttok.affinity",

  CATEGORIES: [
    "philosophy",
    "ethics",
    "politics",
    "economics",
    "biology",
    "neuroscience",
  ],

  // Signal weights. Open > save > dwell, per the brief: reading the full
  // article is the depth signal, dwell alone is cheap.
  WEIGHTS: { open: 3.0, save: 4.0, dwellLong: 1.5, dwellShort: 0.5, skip: -0.75 },
  DWELL_SHORT_MS: 3000,
  DWELL_LONG_MS: 8000,
  SKIP_MS: 1200,

  DECAY: 0.99, // every recorded signal decays all weights slightly — old interests fade
  WEIGHT_MIN: -10,
  WEIGHT_MAX: 20,

  RECENT_SHOWN_MAX: 24, // window for the novelty penalty
  RECENT_ENGAGED_MAX: 8, // titles that seed morelike proximity queries
  EXPLORATION_RATE: 0.18,

  _profile: null,
  _saveTimer: null,

  _load() {
    if (this._profile) return this._profile;
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      const p = raw ? JSON.parse(raw) : null;
      this._profile = p && typeof p === "object" ? p : {};
    } catch (_) {
      this._profile = {};
    }
    this._profile.affinity = this._profile.affinity || {};
    this._profile.recentShown = this._profile.recentShown || []; // [category, ...]
    this._profile.recentEngaged = this._profile.recentEngaged || []; // [{title, ts}]
    return this._profile;
  },

  // Debounced write — signals fire on every scroll-past.
  _save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._profile));
      } catch (_) {}
    }, 500);
  },

  _bump(categories, delta) {
    if (!categories || categories.length === 0) return;
    const p = this._load();
    for (const key of Object.keys(p.affinity)) p.affinity[key] *= this.DECAY;
    // Split the signal across the item's categories so multi-category items
    // don't count double.
    const per = delta / categories.length;
    for (const cat of categories) {
      const next = (p.affinity[cat] || 0) + per;
      p.affinity[cat] = Math.min(this.WEIGHT_MAX, Math.max(this.WEIGHT_MIN, next));
    }
    this._save();
  },

  _noteEngaged(content) {
    if (!content?.categories?.length || !content.title) return;
    const p = this._load();
    p.recentEngaged = p.recentEngaged.filter((e) => e.title !== content.title);
    p.recentEngaged.push({ title: content.title, ts: Date.now() });
    while (p.recentEngaged.length > this.RECENT_ENGAGED_MAX) p.recentEngaged.shift();
    this._save();
  },

  // ---------- Signal recording ----------

  /** Card left the viewport after `ms` on screen (>=60% visible). */
  recordDwell(content, ms) {
    if (!content?.categories?.length) return;
    if (ms < this.SKIP_MS) {
      this._bump(content.categories, this.WEIGHTS.skip);
    } else if (ms >= this.DWELL_LONG_MS) {
      this._bump(content.categories, this.WEIGHTS.dwellLong);
      this._noteEngaged(content);
    } else if (ms >= this.DWELL_SHORT_MS) {
      this._bump(content.categories, this.WEIGHTS.dwellShort);
    }
  },

  /** User tapped through to the full article. */
  recordOpen(content) {
    if (!content?.categories?.length) return;
    this._bump(content.categories, this.WEIGHTS.open);
    this._noteEngaged(content);
  },

  /** User saved/liked (or unsaved — pass liked=false to undo the signal). */
  recordSave(content, liked = true) {
    if (!content?.categories?.length) return;
    this._bump(content.categories, liked ? this.WEIGHTS.save : -this.WEIGHTS.save);
    if (liked) this._noteEngaged(content);
  },

  /** Card was shown — feeds the novelty penalty window, not the weights. */
  recordShown(content) {
    if (!content?.categories?.length) return;
    const p = this._load();
    p.recentShown.push(...content.categories);
    while (p.recentShown.length > this.RECENT_SHOWN_MAX) p.recentShown.shift();
    this._save();
  },

  // ---------- Reads ----------

  /** Raw affinity weight for one category. */
  weight(cat) {
    return this._load().affinity[cat] || 0;
  },

  /** Titles the user recently engaged with — seeds for proximity queries. */
  recentEngagedTitles() {
    return this._load().recentEngaged.map((e) => e.title);
  },

  /** Fraction of the recent-shown window occupied by `cat` (novelty input). */
  recentShownShare(cat) {
    const shown = this._load().recentShown;
    if (shown.length === 0) return 0;
    return shown.filter((c) => c === cat).length / shown.length;
  },

  /**
   * Score a candidate: affinity match + quality/proximity bonuses the caller
   * passes in, minus the novelty penalty. Higher is better.
   * `bonus` lets adapters add source-specific terms (quality tier, morelike hit).
   */
  score(categories, bonus = 0) {
    if (!categories || categories.length === 0) return bonus;
    let affinity = 0;
    let novelty = 0;
    for (const cat of categories) {
      affinity += this.weight(cat);
      // A category filling half the recent window loses ~2 points — one long
      // read can't collapse the feed into its topic.
      novelty += this.recentShownShare(cat) * 4;
    }
    return affinity / categories.length - novelty / categories.length + bonus;
  },

  /**
   * Pick `count` items from scored candidates: top scores fill most slots,
   * but ~EXPLORATION_RATE of them are uniform-random picks so the feed never
   * narrows to the learned profile.
   * `candidates` = [{item, score}]. Returns items.
   */
  rank(candidates, count) {
    if (candidates.length <= count) return candidates.map((c) => c.item);
    const explore = Math.max(count > 1 ? 1 : 0, Math.round(count * this.EXPLORATION_RATE));
    const sorted = [...candidates].sort((a, b) => b.score - a.score);
    const picked = sorted.slice(0, count - explore);
    const rest = sorted.slice(count - explore);
    for (let i = 0; i < explore && rest.length > 0; i++) {
      const j = Math.floor(Math.random() * rest.length);
      picked.push(rest.splice(j, 1)[0]);
    }
    return picked.map((c) => c.item);
  },

  /**
   * Pick a category to fetch from, affinity-weighted with exploration:
   * softmax-ish over positive weights, uniform EXPLORATION_RATE of the time.
   */
  pickCategory() {
    const cats = this.CATEGORIES;
    if (Math.random() < this.EXPLORATION_RATE) {
      return cats[Math.floor(Math.random() * cats.length)];
    }
    const weights = cats.map((c) => Math.exp(this.weight(c) / 4));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < cats.length; i++) {
      r -= weights[i];
      if (r <= 0) return cats[i];
    }
    return cats[cats.length - 1];
  },

  /** Debugging: current profile snapshot. */
  snapshot() {
    return JSON.parse(JSON.stringify(this._load()));
  },

  reset() {
    this._profile = null;
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (_) {}
  },
};
