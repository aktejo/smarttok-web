/**
 * AffinityManager
 * Local, non-ML interest learning for the educational feed.
 * Everything lives in localStorage — no data ever leaves the device.
 *
 * Taxonomy model: OPEN, fine-grained tags — not a fixed category list.
 * Each content item carries `topics`: the item's own real categories
 * (Wikipedia article categories, WordPress essay categories, …), normalized
 * and junk-filtered through cleanTopics(). The affinity vector is an
 * open `tag -> weight` map that grows as new topics appear, so the model
 * learns that you like "epistemology" but skip "aesthetics" instead of
 * lumping both into one "philosophy" bucket. No per-source mapping table.
 *
 * Fetching vs. learning are decoupled. An adapter can only *query* the
 * buckets its API supports (e.g. Wikipedia WikiProject categories), so it
 * biases its fetch toward whichever of its own buckets your tags favour via
 * chooseBucket()/bucketScore() — but it *tags* each result with the item's
 * true fine-grained topics, so learning stays granular and transfers across
 * sources wherever tags overlap after normalization.
 *
 * Signals (recorded by app.js / redesign-app.js / card-view.js / likes.js):
 *   open  +3.0  — tapped through to the full article (the depth signal)
 *   save  +4.0  — explicit save/like
 *   dwell +0.5 / +1.5 — 3s / 8s on screen (60% visible)
 *   skip  −0.75 — flicked past in under 1.2s
 *
 * Anti-narrowing: a novelty penalty over recently-shown tags, plus a ~18%
 * exploration floor in rank() and chooseBucket().
 */
const AffinityManager = {
  STORAGE_KEY: "smarttok.affinity", // shape is forward-compatible with the old 6-slug profile

  WEIGHTS: { open: 3.0, save: 4.0, dwellLong: 1.5, dwellShort: 0.5, skip: -0.75 },
  DWELL_SHORT_MS: 3000,
  DWELL_LONG_MS: 8000,
  SKIP_MS: 1200,

  DECAY: 0.99, // every recorded signal decays all weights slightly — old interests fade
  WEIGHT_MIN: -10,
  WEIGHT_MAX: 20,

  RECENT_SHOWN_MAX: 40, // window for the novelty penalty (larger now that tags are finer)
  RECENT_ENGAGED_MAX: 8, // titles that seed morelike proximity queries
  EXPLORATION_RATE: 0.18,
  MAX_TAGS: 400, // prune the vector past this so it never grows unbounded
  MAX_TOPICS_PER_ITEM: 8, // an article with 15 categories shouldn't swamp the vector
  MAX_TAGS_PER_BUCKET: 80,

  // Maintenance / non-topical category noise to drop (mostly Wikipedia). Matched
  // as lowercase substrings; `!hidden` already removes most Wikipedia junk, this
  // catches the visible residue (dates, people/place admin, cleanup banners).
  _JUNK_PATTERNS: [
    " articles", "cs1", "webarchive", "wikipedia", "wikidata", "use dmy",
    "use mdy", "short description", "commons category", "pages using",
    "pages with", "engvar", "coordinates", "good article", "featured article",
    "template", "cite ", "living people", "births", "deaths", "faculty",
    "alumni", "people from", "recipients", "members of", "disambiguation",
    "stub", "redirect", "wikiproject", "all articles", "unsourced",
    "peer reviewed", "spoken articles", "external links",
    // Biographical / event / temporal noise that dominates Wikipedia's
    // *visible* categories on people- and event-articles but says nothing
    // about the intellectual subject (articles with none of substance fall
    // back to their coarse pool bucket).
    "consuls", "emperors", "monarchs", "saints", "clergy", "bishops",
    "popes", "knights", "fellows of", "nobility", "royalty", "dynasty",
    "coups", "mass murders", "attacks on", "massacres", "assassinations",
    "battles", "military personnel", "burials", "mausoleums", " family",
  ],
  // Leading nationality/era adjectives are stripped during normalization so
  // "american economists" and "british economists" both aggregate as
  // "economists" (faster learning, less biographical-locality noise). Compound
  // demonyms must be matched before their single-word parts — the regex is
  // built longest-first.
  _DEMONYMS: [
    "african-american", "african american", "ancient greek", "ancient roman",
    "native american", "old english", "middle english", "early modern",
    "american", "british", "english", "scottish", "welsh", "irish", "canadian",
    "australian", "french", "german", "italian", "spanish", "portuguese",
    "brazilian", "mexican", "argentine", "russian", "soviet", "chinese",
    "japanese", "korean", "vietnamese", "indian", "pakistani", "dutch",
    "belgian", "swiss", "austrian", "swedish", "norwegian", "danish", "finnish",
    "polish", "czech", "hungarian", "romanian", "greek", "roman", "egyptian",
    "turkish", "persian", "iranian", "arab", "israeli", "jewish", "african",
    "asian", "european", "byzantine", "ottoman", "prussian",
  ],
  _demonymRe: null,

  // Normalized synonym -> canonical tag. Small and honest; grows as real
  // cross-source clashes turn up.
  _ALIASES: {
    "social and political philosophy": "political philosophy",
    "social & political": "political philosophy",
    "political philosophy and theory": "political philosophy",
    "philosophy of biology": "biology",
    "molecular biology": "biology",
  },

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
    this._profile.affinity = this._profile.affinity || {}; // tag -> weight
    this._profile.recentShown = this._profile.recentShown || []; // [tag, ...]
    this._profile.recentEngaged = this._profile.recentEngaged || []; // [{title, ts}]
    this._profile.bucketIndex = this._profile.bucketIndex || {}; // bucketKey -> {tag: 1}
    return this._profile;
  },

  _save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._profile));
      } catch (_) {}
    }, 500);
  },

  // ---------- Topic normalization ----------

  _normalizeTag(raw) {
    let t = String(raw || "").toLowerCase().trim();
    t = t.replace(/^category:/, "").trim();
    t = t.replace(/\b(fa|ga|a|b|c|start|stub)-class\s+/g, ""); // quality-class prefixes
    if (!this._demonymRe) {
      const alt = [...this._DEMONYMS].sort((a, b) => b.length - a.length).join("|");
      this._demonymRe = new RegExp(`^(?:${alt})[- ]`);
    }
    t = t.replace(this._demonymRe, ""); // leading nationality/era adjective
    t = t.replace(/\s+articles?$/, ""); // trailing "… articles"
    t = t.replace(/[\s_]+/g, " ").trim();
    return this._ALIASES[t] || t;
  },

  _isJunk(tag) {
    if (!tag || tag.length < 3 || tag.length > 50) return true;
    if (/^\d{3,4}s?$/.test(tag)) return true; // bare years / decades
    if (/^\d{1,2}(st|nd|rd|th)[- ]century/.test(tag)) return true; // "2nd-century roman consuls"
    // "<occupation> from <place>" — biographical origin, not a topic. (Doesn't
    // touch idea-phrases like "arguments from analogy" — those aren't people.)
    if (/\b(people|writers|academics|activists|politicians|scientists|artists|philosophers|economists|historians|physicians|linguists|educators|singers|musicians|actors|nobles|emigrants|expatriates) from /.test(tag))
      return true;
    return this._JUNK_PATTERNS.some((p) => tag.includes(p));
  },

  /**
   * Normalize a source's raw category names into clean, deduped topic tags.
   * Adapters call this when building content.topics so normalization lives in
   * exactly one place. Returns [] if nothing survives (caller supplies a
   * coarse fallback).
   *
   * Note: eponymous categories are deliberately NOT dropped. On a concept
   * article the eponymous category ("Nihilism" on Nihilism) IS the subject;
   * on a person article ("Albert Camus") it's a harmless one-off that never
   * recurs and gets pruned — so dropping it would cost far more than it saves.
   */
  cleanTopics(rawNames) {
    const out = [];
    const seen = new Set();
    for (const raw of rawNames || []) {
      const tag = this._normalizeTag(raw);
      if (this._isJunk(tag) || seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
      if (out.length >= this.MAX_TOPICS_PER_ITEM) break;
    }
    return out;
  },

  // ---------- Signal recording ----------

  _bump(topics, delta) {
    if (!topics || topics.length === 0) return;
    const p = this._load();
    for (const key of Object.keys(p.affinity)) p.affinity[key] *= this.DECAY;
    const per = delta / topics.length; // split so multi-topic items don't count double
    for (const tag of topics) {
      const next = (p.affinity[tag] || 0) + per;
      p.affinity[tag] = Math.min(this.WEIGHT_MAX, Math.max(this.WEIGHT_MIN, next));
    }
    this._prune(p);
    this._save();
  },

  // Keep the vector bounded: drop the weakest |weight| tags past MAX_TAGS.
  _prune(p) {
    const keys = Object.keys(p.affinity);
    if (keys.length <= this.MAX_TAGS) return;
    keys
      .sort((a, b) => Math.abs(p.affinity[a]) - Math.abs(p.affinity[b]))
      .slice(0, keys.length - this.MAX_TAGS)
      .forEach((k) => delete p.affinity[k]);
  },

  _noteEngaged(content) {
    if (!content?.topics?.length || !content.title) return;
    const p = this._load();
    p.recentEngaged = p.recentEngaged.filter((e) => e.title !== content.title);
    p.recentEngaged.push({ title: content.title, ts: Date.now() });
    while (p.recentEngaged.length > this.RECENT_ENGAGED_MAX) p.recentEngaged.shift();
    this._save();
  },

  /** Card left the viewport after `ms` on screen (>=60% visible). */
  recordDwell(content, ms) {
    if (!content?.topics?.length) return;
    if (ms < this.SKIP_MS) {
      this._bump(content.topics, this.WEIGHTS.skip);
    } else if (ms >= this.DWELL_LONG_MS) {
      this._bump(content.topics, this.WEIGHTS.dwellLong);
      this._noteEngaged(content);
    } else if (ms >= this.DWELL_SHORT_MS) {
      this._bump(content.topics, this.WEIGHTS.dwellShort);
    }
  },

  /** User tapped through to the full article. */
  recordOpen(content) {
    if (!content?.topics?.length) return;
    this._bump(content.topics, this.WEIGHTS.open);
    this._noteEngaged(content);
  },

  /** User saved/liked (or unsaved — pass liked=false to undo the signal). */
  recordSave(content, liked = true) {
    if (!content?.topics?.length) return;
    this._bump(content.topics, liked ? this.WEIGHTS.save : -this.WEIGHTS.save);
    if (liked) this._noteEngaged(content);
  },

  /** Card was shown — feeds the novelty penalty window, not the weights. */
  recordShown(content) {
    if (!content?.topics?.length) return;
    const p = this._load();
    p.recentShown.push(...content.topics);
    while (p.recentShown.length > this.RECENT_SHOWN_MAX) p.recentShown.shift();
    this._save();
  },

  // ---------- Reads ----------

  weight(tag) {
    return this._load().affinity[tag] || 0;
  },

  recentEngagedTitles() {
    return this._load().recentEngaged.map((e) => e.title);
  },

  recentShownShare(tag) {
    const shown = this._load().recentShown;
    if (shown.length === 0) return 0;
    return shown.filter((c) => c === tag).length / shown.length;
  },

  /**
   * Score a candidate by its topics. The affinity term blends the MEAN topic
   * weight with the MAX (max-pooling), so a candidate ranks high if it aligns
   * overall OR if any single topic is one you strongly like — a noisy article
   * carrying one great topic among trivia tags isn't buried by the average.
   * Then subtract the mean novelty penalty and add the caller's bonus (quality
   * tier, proximity hit, …). Higher is better.
   */
  score(topics, bonus = 0) {
    if (!topics || topics.length === 0) return bonus;
    let sum = 0;
    let max = -Infinity;
    let novelty = 0;
    for (const tag of topics) {
      const w = this.weight(tag);
      sum += w;
      if (w > max) max = w;
      novelty += this.recentShownShare(tag) * 4; // a tag filling half the window costs ~2
    }
    const affinity = 0.5 * (sum / topics.length) + 0.5 * max;
    return affinity - novelty / topics.length + bonus;
  },

  /**
   * Pick `count` items from scored candidates: top scores fill most slots, but
   * ~EXPLORATION_RATE are uniform-random so the feed never narrows to profile.
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

  // ---------- Fetch buckets (bias what an adapter queries) ----------

  /**
   * Remember that these fine topics showed up under an adapter's fetch bucket
   * (bucketKey should be source-namespaced, e.g. "wikiedu:philosophy"). Lets
   * bucketScore() estimate how much the user likes what a bucket tends to
   * yield, so the adapter can bias fetches without the model itself knowing
   * anything about buckets.
   */
  linkBucket(bucketKey, topics) {
    if (!bucketKey || !topics?.length) return;
    const p = this._load();
    const idx = (p.bucketIndex[bucketKey] = p.bucketIndex[bucketKey] || {});
    for (const t of topics) idx[t] = 1;
    const keys = Object.keys(idx);
    if (keys.length > this.MAX_TAGS_PER_BUCKET) {
      // drop the lowest-affinity linked tags to stay bounded
      keys
        .sort((a, b) => this.weight(a) - this.weight(b))
        .slice(0, keys.length - this.MAX_TAGS_PER_BUCKET)
        .forEach((k) => delete idx[k]);
    }
    this._save();
  },

  /** Aggregate current affinity for a bucket = sum over its linked tags. */
  bucketScore(bucketKey) {
    const idx = this._load().bucketIndex[bucketKey];
    if (!idx) return 0;
    let s = 0;
    for (const t of Object.keys(idx)) s += this.weight(t);
    return s;
  },

  /**
   * Choose one bucket key, softmax-weighted by bucketScore with an exploration
   * floor. Cold start (no links yet) is uniform, so exploration dominates until
   * the index fills in.
   */
  chooseBucket(bucketKeys) {
    if (!bucketKeys || bucketKeys.length === 0) return null;
    if (Math.random() < this.EXPLORATION_RATE) {
      return bucketKeys[Math.floor(Math.random() * bucketKeys.length)];
    }
    const weights = bucketKeys.map((k) =>
      Math.exp(Math.max(-8, Math.min(8, this.bucketScore(k) / 6)))
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < bucketKeys.length; i++) {
      r -= weights[i];
      if (r <= 0) return bucketKeys[i];
    }
    return bucketKeys[bucketKeys.length - 1];
  },

  // ---------- Debug / lifecycle ----------

  snapshot() {
    return JSON.parse(JSON.stringify(this._load()));
  },

  /** Top-N tags by weight — handy for eyeballing what the model has learned. */
  topTags(n = 15) {
    const a = this._load().affinity;
    return Object.keys(a)
      .sort((x, y) => a[y] - a[x])
      .slice(0, n)
      .map((t) => [t, Math.round(a[t] * 100) / 100]);
  },

  reset() {
    this._profile = null;
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (_) {}
  },
};
