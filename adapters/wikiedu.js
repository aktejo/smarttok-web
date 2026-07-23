/**
 * WikiEdu adapter — "Deep Dives".
 * Substantive educational Wikipedia articles (philosophy, ethics, politics,
 * economics, biology, neuroscience), quality-gated to Featured/Good articles.
 *
 * Pool: instead of keyword search (any article merely *mentioning*
 * "philosophy" matches), the pool comes from WikiProject assessment
 * categories — e.g. "Category:GA-Class Philosophy articles" — which are
 * precise topical + quality tagging (~2,200 articles across 12 categories).
 * Members are Talk: pages; strip the prefix to get article titles. The full
 * title pool is fetched once (~15 requests) and cached in localStorage for
 * 7 days, so steady-state cost is one batched extract query per fetch.
 *
 * Ranking per fetch (via AffinityManager):
 *   - candidate titles picked per-slot from affinity-weighted categories
 *   - plus "morelike:" neighbors of recently-engaged articles intersected
 *     with the pool (graph proximity, replaces the deprecated page/related)
 *   - scored: affinity + tier bonus (FA > GA) + proximity bonus − novelty
 *   - ~18% of slots are random (exploration floor)
 *
 * All Wikipedia APIs here support CORS via origin=* — no proxy needed.
 */
const WikiEduAdapter = {
  sourceKey: "wikiedu",
  displayName: "Deep Dives",
  icon: "🎓",

  API: "https://en.wikipedia.org/w/api.php",
  POOL_STORAGE_KEY: "smarttok.wikiedu.pool",
  POOL_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  REQUEST_TIMEOUT_MS: 10000,

  // canonical category slug -> its two WikiProject quality-class categories.
  // Names are exact (casing varies per WikiProject — verified 2026-07).
  CATEGORY_SOURCES: {
    philosophy: { FA: "FA-Class Philosophy articles", GA: "GA-Class Philosophy articles" },
    ethics: { FA: "FA-Class ethics articles", GA: "GA-Class ethics articles" },
    politics: { FA: "FA-Class politics articles", GA: "GA-Class politics articles" },
    economics: { FA: "FA-Class Economics articles", GA: "GA-Class Economics articles" },
    biology: { FA: "FA-Class Biology articles", GA: "GA-Class Biology articles" },
    neuroscience: { FA: "FA-Class neuroscience articles", GA: "GA-Class neuroscience articles" },
  },

  TIER_BONUS: { FA: 1.5, GA: 0.75 },
  PROXIMITY_BONUS: 2.0,
  CANDIDATES_PER_SLOT: 3,

  _poolPromise: null,
  _served: new Set(), // titles handed out this session — cheap pre-dedup

  async fetchNext(count = 3) {
    try {
      const pool = await this._ensurePool();
      const candidates = await this._gatherCandidates(pool, count);
      if (candidates.length === 0) {
        return [makeErrorContent(this.sourceKey, this.displayName, null)];
      }
      const chosen = AffinityManager.rank(candidates, count);
      const items = await this._fetchExtracts(chosen);
      if (items.length === 0) {
        return [makeErrorContent(this.sourceKey, this.displayName, null)];
      }
      for (const item of items) this._served.add(item.title);
      return items;
    } catch (_) {
      return [makeErrorContent(this.sourceKey, this.displayName, null)];
    }
  },

  // ---------- Candidate selection ----------

  /**
   * Build a scored candidate list ~3x the requested count: affinity-weighted
   * random picks from the pool, plus morelike proximity hits when the user
   * has recent engagement to seed from.
   */
  async _gatherCandidates(pool, count) {
    const byTitle = new Map(); // title -> {item:{title, cat, tier}, score}

    const addCandidate = (title, cat, tier, bonus) => {
      if (this._served.has(title) || byTitle.has(title)) return;
      const score = AffinityManager.score([cat], (this.TIER_BONUS[tier] || 0) + bonus);
      byTitle.set(title, { item: { title, cat, tier }, score });
    };

    // Graph proximity: morelike neighbors of one recently-engaged article,
    // kept only if they're in the quality pool. Best-effort — a failed or
    // empty proximity query just means no proximity candidates this round.
    const engaged = AffinityManager.recentEngagedTitles();
    if (engaged.length > 0) {
      const seed = engaged[Math.floor(Math.random() * engaged.length)];
      try {
        const neighbors = await this._moreLike(seed);
        for (const title of neighbors) {
          const home = this._findInPool(pool, title);
          if (home) addCandidate(title, home.cat, home.tier, this.PROXIMITY_BONUS);
        }
      } catch (_) {}
    }

    // Affinity-weighted picks fill the rest.
    const want = count * this.CANDIDATES_PER_SLOT;
    let guard = want * 6;
    while (byTitle.size < want && guard-- > 0) {
      const cat = AffinityManager.pickCategory();
      const tiers = pool[cat];
      if (!tiers) continue;
      // FA lists are tiny; give them a 1-in-4 draw so they surface without
      // drowning out the much larger GA pools.
      const tier = Math.random() < 0.25 && tiers.FA.length > 0 ? "FA" : "GA";
      const list = tiers[tier].length > 0 ? tiers[tier] : tiers.GA;
      if (list.length === 0) continue;
      addCandidate(list[Math.floor(Math.random() * list.length)], cat, tier, 0);
    }

    return [...byTitle.values()];
  },

  _findInPool(pool, title) {
    for (const [cat, tiers] of Object.entries(pool)) {
      if (tiers.FA.includes(title)) return { cat, tier: "FA" };
      if (tiers.GA.includes(title)) return { cat, tier: "GA" };
    }
    return null;
  },

  async _moreLike(title) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      list: "search",
      srsearch: `morelike:${title}`,
      srnamespace: "0",
      srlimit: "20",
      srprop: "",
    });
    const data = await this._get(params);
    return (data.query?.search || []).map((r) => r.title);
  },

  // ---------- Content fetch ----------

  /** One batched query for extracts + thumbnails + canonical URLs. */
  async _fetchExtracts(chosen) {
    const byTitle = new Map(chosen.map((c) => [c.title, c]));
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      titles: chosen.map((c) => c.title).join("|"),
      redirects: "1",
      prop: "extracts|pageimages|info",
      exintro: "1",
      explaintext: "1",
      exchars: "1200",
      exlimit: "20",
      inprop: "url",
      piprop: "thumbnail",
      pithumbsize: "640",
    });
    const data = await this._get(params);

    // Follow redirect mapping so metadata found under the original title
    // still attaches to the resolved page.
    const redirected = new Map(
      (data.query?.redirects || []).map((r) => [r.to, r.from])
    );

    const items = [];
    for (const page of Object.values(data.query?.pages || {})) {
      if (page.missing !== undefined) continue;
      const extract = (page.extract || "").replace(/\[\d+\]/g, "").trim();
      if (extract.length < 200) continue; // stubs/disambiguation aren't worth a card
      const meta =
        byTitle.get(page.title) || byTitle.get(redirected.get(page.title)) || {};
      items.push(
        makeContent({
          id: `wikiedu-${page.pageid}`,
          sourceKey: this.sourceKey,
          title: page.title,
          body: extract,
          openLink: page.fullurl || null,
          media: page.thumbnail
            ? { url: page.thumbnail.source, alt: page.title }
            : null,
          attribution: "Wikipedia",
          tags: meta.cat ? [meta.cat, meta.tier] : [],
          timestamp: page.touched || null,
          categories: meta.cat ? [meta.cat] : [],
        })
      );
    }
    return items;
  },

  // ---------- Pool build ----------

  /** Load the cached title pool, rebuilding it (single-flight) when stale. */
  async _ensurePool() {
    try {
      const raw = localStorage.getItem(this.POOL_STORAGE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached.builtAt && Date.now() - cached.builtAt < this.POOL_TTL_MS) {
          return cached.pool;
        }
      }
    } catch (_) {}

    if (!this._poolPromise) {
      this._poolPromise = this._buildPool().finally(() => {
        this._poolPromise = null;
      });
    }
    return this._poolPromise;
  },

  async _buildPool() {
    const jobs = [];
    for (const [cat, tiers] of Object.entries(this.CATEGORY_SOURCES)) {
      for (const [tier, categoryName] of Object.entries(tiers)) {
        jobs.push({ cat, tier, categoryName });
      }
    }

    const pool = {};
    for (const cat of Object.keys(this.CATEGORY_SOURCES)) {
      pool[cat] = { FA: [], GA: [] };
    }

    // Chunked concurrency: fast enough to beat FeedManager's 20s source
    // timeout, gentle enough not to trip Wikipedia's burst rate limit
    // (rapid-fire requests get 429s — learned the hard way).
    const CHUNK = 4;
    for (let i = 0; i < jobs.length; i += CHUNK) {
      await Promise.all(
        jobs.slice(i, i + CHUNK).map(async (job) => {
          pool[job.cat][job.tier] = await this._categoryTitles(job.categoryName);
        })
      );
    }

    if (Object.values(pool).every((t) => t.FA.length === 0 && t.GA.length === 0)) {
      throw new Error("wikiedu pool build got no titles");
    }
    try {
      localStorage.setItem(
        this.POOL_STORAGE_KEY,
        JSON.stringify({ builtAt: Date.now(), pool })
      );
    } catch (_) {}
    return pool;
  },

  /** All article titles in one assessment category (members are Talk: pages). */
  async _categoryTitles(categoryName) {
    const titles = [];
    let cmcontinue = null;
    do {
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        origin: "*",
        list: "categorymembers",
        cmtitle: `Category:${categoryName}`,
        cmnamespace: "1",
        cmtype: "page",
        cmlimit: "500",
      });
      if (cmcontinue) params.set("cmcontinue", cmcontinue);
      const data = await this._get(params);
      for (const m of data.query?.categorymembers || []) {
        if (m.title.startsWith("Talk:")) titles.push(m.title.slice(5));
      }
      cmcontinue = data.continue?.cmcontinue || null;
    } while (cmcontinue);
    return titles;
  },

  async _get(params) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.API}?${params}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  },
};
