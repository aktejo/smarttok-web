/**
 * 1000-Word Philosophy adapter (Phase 2).
 * Introductory, peer-reviewed philosophy essays from 1000wordphilosophy.com,
 * an anthology where every entry is a ~1000-word survey of one topic.
 *
 * License: CC BY-NC. SmartTok is a personal, non-commercial project, so the
 * NC term is satisfied; attribution is preserved via the source label and the
 * "Open original" link to the full essay.
 *
 * Content comes from the site's WordPress REST API, which is CORS-friendly
 * (origin-reflected) — no proxy needed. Taxonomy is open and fine-grained
 * (see AffinityManager): each essay is tagged with its OWN WordPress category
 * names (Ethics, Metaphysics, Philosophy of Religion, …), normalized through
 * cleanTopics — no hand-written mapping table. Fetching is affinity-aware:
 * chooseBucket leans toward whichever WordPress categories your engaged topics
 * favour, and the query is filtered to that category.
 */
const WordPhilAdapter = {
  sourceKey: "wordphil",
  displayName: "1000-Word Philosophy",
  icon: "💭",

  API: "https://1000wordphilosophy.com/wp-json/wp/v2",
  CATS_STORAGE_KEY: "smarttok.wordphil.cats",
  CATS_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  REQUEST_TIMEOUT_MS: 10000,
  MIN_BUCKET_COUNT: 3, // ignore near-empty categories as fetch buckets

  _cats: null, // { id: {name, count} }
  _catsPromise: null,
  _totals: { all: 229 }, // X-WP-Total per filter key, self-correcting from headers
  _served: new Set(),

  async fetchNext(count = 3) {
    try {
      const cats = await this._ensureCategories();
      const bucketKeys = Object.keys(cats)
        .filter(
          (id) =>
            cats[id].count >= this.MIN_BUCKET_COUNT &&
            cats[id].name.toLowerCase() !== "uncategorized"
        )
        .map((id) => `wordphil:${id}`);

      const chosen = AffinityManager.chooseBucket(bucketKeys);
      const catId = chosen ? chosen.slice("wordphil:".length) : null;
      const posts = await this._fetchPage(catId, count);

      const items = [];
      for (const p of posts) {
        const content = this._toContent(p, cats);
        if (content && !this._served.has(content.id)) {
          this._served.add(content.id);
          items.push(content);
        }
      }
      if (items.length === 0) {
        return [makeErrorContent(this.sourceKey, this.displayName, null)];
      }
      return items;
    } catch (_) {
      return [makeErrorContent(this.sourceKey, this.displayName, null)];
    }
  },

  /** One page of posts at a random offset within the (optionally filtered) pool. */
  async _fetchPage(catId, count) {
    const key = catId || "all";
    const total = this._totals[key] || 50;
    const offset = Math.floor(Math.random() * Math.max(1, total - count));
    const params = new URLSearchParams({
      per_page: String(count),
      offset: String(offset),
      _fields: "id,link,title,content,categories,jetpack_featured_media_url",
    });
    if (catId) params.set("categories", catId);

    const { data, total: fetchedTotal } = await this._get(`/posts?${params}`);
    if (fetchedTotal !== null) this._totals[key] = fetchedTotal;

    // Overshot the range (random offset past the end) — retry from the top.
    if (Array.isArray(data) && data.length === 0 && offset > 0) {
      params.set("offset", "0");
      const retry = await this._get(`/posts?${params}`);
      return retry.data || [];
    }
    return data || [];
  },

  _toContent(p, cats) {
    const body = this._extractBody(p.content?.rendered || "");
    if (body.length < 160) return null; // too thin to be a worthwhile card

    const rawNames = (p.categories || [])
      .map((id) => cats[id]?.name)
      .filter(Boolean);
    let topics = AffinityManager.cleanTopics(rawNames);
    if (topics.length === 0) topics = ["philosophy"]; // coarse fallback

    // Link every category this essay belongs to back to its topics, so
    // chooseBucket learns which categories tend to yield content you like.
    for (const id of p.categories || []) {
      if (cats[id]) AffinityManager.linkBucket(`wordphil:${id}`, topics);
    }

    return makeContent({
      id: `wordphil-${p.id}`,
      sourceKey: this.sourceKey,
      title: this._decode(this._stripTags(p.title?.rendered || "")),
      body,
      openLink: p.link || null,
      media: p.jetpack_featured_media_url
        ? { url: p.jetpack_featured_media_url, alt: "" }
        : null,
      attribution: "1000-Word Philosophy",
      tags: [],
      topics,
    });
  },

  /** Category id -> {name, count}, fetched once and cached 7 days. */
  async _ensureCategories() {
    if (this._cats) return this._cats;
    try {
      const raw = localStorage.getItem(this.CATS_STORAGE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached.builtAt && Date.now() - cached.builtAt < this.CATS_TTL_MS) {
          this._cats = cached.cats;
          return this._cats;
        }
      }
    } catch (_) {}

    if (!this._catsPromise) {
      this._catsPromise = this._fetchCategories().finally(() => {
        this._catsPromise = null;
      });
    }
    return this._catsPromise;
  },

  async _fetchCategories() {
    const { data } = await this._get(
      "/categories?per_page=100&_fields=id,name,count"
    );
    const cats = {};
    for (const c of data || []) {
      cats[c.id] = { name: this._decode(c.name || ""), count: c.count || 0 };
    }
    if (Object.keys(cats).length === 0) throw new Error("no wordphil categories");
    this._cats = cats;
    try {
      localStorage.setItem(
        this.CATS_STORAGE_KEY,
        JSON.stringify({ builtAt: Date.now(), cats })
      );
    } catch (_) {}
    return cats;
  },

  /**
   * Turn an essay's rendered HTML into clean card prose: strip tags, drop the
   * leading "Author / Categories / Word Count" masthead every essay opens
   * with, remove footnote markers, and truncate to ~1000 chars on a sentence
   * boundary.
   *
   * The masthead is inconsistent across essays — the fields appear in varying
   * orders ("Author:" first, or "Categories:" first) and the word-count label
   * varies ("Word Count:", "Wordcount:", "Words:") as does the number
   * ("1,000" / "1000"). The one invariant is that the word-count number is the
   * last masthead field before the essay text, so we strip up through it —
   * but only when the leading block also carries an Author/Categories label,
   * so a real essay is never clipped.
   */
  _extractBody(rawHtml) {
    let txt = this._decode(this._stripTags(rawHtml));
    txt = txt.replace(/\s+/g, " ").trim();

    const head = txt.slice(0, 300);
    const wc = head.match(/(?:Word\s*count|Words)\s*:?\s*~?\s*[\d,]+\s*(?:words)?\s*/i);
    if (wc && /(?:Author|Categor(?:y|ies))\s*:/i.test(head)) {
      txt = txt.slice(wc.index + wc[0].length);
    }
    txt = txt.replace(/\[\d+\]/g, "");
    txt = txt.replace(/\s+/g, " ").trim();

    if (txt.length > 1000) {
      const slice = txt.slice(0, 1000);
      const end = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("! ")
      );
      txt = end > 400 ? slice.slice(0, end + 1) : slice.trim() + "…";
    }
    return txt;
  },

  _stripTags(s) {
    return s.replace(/<[^>]+>/g, " ");
  },

  // Decode HTML entities (curly quotes, &amp;, &#8217;, …) via the DOM.
  _decode(s) {
    const el = document.createElement("textarea");
    el.innerHTML = s;
    return el.value;
  },

  async _get(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.API}${path}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = parseInt(res.headers.get("X-WP-Total") || "", 10);
      const data = await res.json();
      return { data, total: Number.isNaN(total) ? null : total };
    } finally {
      clearTimeout(timer);
    }
  },
};
