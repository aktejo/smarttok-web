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
 *   - candidate titles gathered from bucket-biased pool picks (chooseBucket
 *     leans toward WikiProject buckets whose articles you engage with)
 *   - plus "morelike:" neighbors of recently-engaged articles intersected
 *     with the pool (graph proximity, replaces the deprecated page/related)
 *   - each candidate's extract query returns the article's OWN categories,
 *     which become its fine-grained topics; items are then scored on those
 *     topics (affinity + tier bonus (FA > GA) + proximity bonus − novelty)
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
      if (candidates.size === 0) {
        return [makeErrorContent(this.sourceKey, this.displayName, null)];
      }
      // Fetch extracts + real categories for the whole candidate set, then
      // rank on the fine-grained topics (which only exist post-fetch).
      const items = await this._fetchExtracts(candidates);
      if (items.length === 0) {
        return [makeErrorContent(this.sourceKey, this.displayName, null)];
      }
      const scored = items.map((it) => ({
        item: it,
        score: AffinityManager.score(it.topics, it._bonus || 0),
      }));
      const chosen = AffinityManager.rank(scored, count);
      for (const it of chosen) {
        this._served.add(it.title);
        delete it._bonus;
      }
      return chosen;
    } catch (_) {
      return [makeErrorContent(this.sourceKey, this.displayName, null)];
    }
  },

  // ---------- Candidate selection ----------

  /**
   * Gather ~3x the requested count of candidate titles: bucket-biased random
   * picks from the quality pool (chooseBucket leans toward WikiProject buckets
   * whose articles you've engaged with), plus morelike proximity hits when the
   * user has recent engagement to seed from. Returns a Map title -> {slug,
   * tier, bonus}. Fine-grained topics and final scoring happen after the
   * extract fetch — pre-fetch we only know the pool bucket, not the article's
   * real categories.
   */
  async _gatherCandidates(pool, count) {
    const byTitle = new Map();
    const bucketKeys = Object.keys(this.CATEGORY_SOURCES).map((s) => `wikiedu:${s}`);

    const add = (title, slug, tier, bonus) => {
      if (this._served.has(title) || byTitle.has(title)) return;
      byTitle.set(title, { slug, tier, bonus });
    };

    // Graph proximity: morelike neighbors of one recently-engaged article,
    // kept only if they're in the quality pool. Best-effort.
    const engaged = AffinityManager.recentEngagedTitles();
    if (engaged.length > 0) {
      const seed = engaged[Math.floor(Math.random() * engaged.length)];
      try {
        const neighbors = await this._moreLike(seed);
        for (const title of neighbors) {
          const home = this._findInPool(pool, title);
          if (home) add(title, home.slug, home.tier, this.PROXIMITY_BONUS);
        }
      } catch (_) {}
    }

    // Bucket-biased picks fill the rest (capped at the 20-title extract limit).
    const want = Math.min(20, count * this.CANDIDATES_PER_SLOT);
    let guard = want * 6;
    while (byTitle.size < want && guard-- > 0) {
      const bucketKey = AffinityManager.chooseBucket(bucketKeys);
      if (!bucketKey) break;
      const slug = bucketKey.slice("wikiedu:".length);
      const tiers = pool[slug];
      if (!tiers) continue;
      // FA lists are tiny; give them a 1-in-4 draw so they surface without
      // drowning out the much larger GA pools.
      const tier = Math.random() < 0.25 && tiers.FA.length > 0 ? "FA" : "GA";
      const list = tiers[tier].length > 0 ? tiers[tier] : tiers.GA;
      if (list.length === 0) continue;
      add(list[Math.floor(Math.random() * list.length)], slug, tier, 0);
    }

    return byTitle;
  },

  _findInPool(pool, title) {
    for (const [slug, tiers] of Object.entries(pool)) {
      if (tiers.FA.includes(title)) return { slug, tier: "FA" };
      if (tiers.GA.includes(title)) return { slug, tier: "GA" };
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

  /**
   * One batched query for extracts + thumbnails + canonical URLs + the
   * articles' own (non-hidden) categories. Those categories become the item's
   * fine-grained topics via cleanTopics; `clshow=!hidden` drops most Wikipedia
   * maintenance junk for free. Each item also links its topics back to its
   * pool bucket so chooseBucket learns what that bucket tends to yield.
   */
  async _fetchExtracts(candidates) {
    const titles = [...candidates.keys()];
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      titles: titles.join("|"),
      redirects: "1",
      prop: "extracts|pageimages|info|categories",
      exintro: "1",
      explaintext: "1",
      exchars: "1200",
      exlimit: "20",
      inprop: "url",
      piprop: "thumbnail",
      pithumbsize: "640",
      cllimit: "500",
      clshow: "!hidden",
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
        candidates.get(page.title) || candidates.get(redirected.get(page.title)) || {};
      const rawCats = (page.categories || []).map((c) =>
        c.title.replace(/^Category:/, "")
      );
      let topics = AffinityManager.cleanTopics(rawCats);
      if (topics.length === 0 && meta.slug) topics = [meta.slug]; // coarse fallback
      if (meta.slug) AffinityManager.linkBucket(`wikiedu:${meta.slug}`, topics);

      const item = makeContent({
        id: `wikiedu-${page.pageid}`,
        sourceKey: this.sourceKey,
        title: page.title,
        body: extract,
        openLink: page.fullurl || null,
        media: page.thumbnail
          ? { url: page.thumbnail.source, alt: page.title }
          : null,
        attribution: "Wikipedia",
        tags: [],
        timestamp: page.touched || null,
        topics,
      });
      item._bonus = (this.TIER_BONUS[meta.tier] || 0) + (meta.bonus || 0);
      items.push(item);
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
