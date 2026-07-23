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
 * (origin-reflected) — no proxy needed. Fetching is affinity-aware: when the
 * user's profile favours ethics or politics, the query is filtered to those
 * WordPress categories; otherwise it pulls unfiltered (the anthology is
 * philosophy top-to-bottom). Each essay is tagged with canonical
 * AffinityManager slugs via CATEGORY_MAP, so it feeds the same interest
 * vector as the Deep Dives (wikiedu) source.
 */
const WordPhilAdapter = {
  sourceKey: "wordphil",
  displayName: "1000-Word Philosophy",
  icon: "💭",

  API: "https://1000wordphilosophy.com/wp-json/wp/v2",
  REQUEST_TIMEOUT_MS: 10000,

  // WordPress category ID -> canonical slug. Everything not listed defaults to
  // "philosophy": the anthology is entirely philosophy, and only ethics /
  // politics get their own affinity bucket in our taxonomy. (IDs verified
  // 2026-07 against wp/v2/categories.)
  CATEGORY_MAP: {
    8289: "ethics", // Ethics
    766334143: "ethics", // bioethics
    11798: "ethics", // Race
    146694: "ethics", // Sex & Gender
    2118287: "politics", // Social & Political
    524128: "politics", // Philosophy of Law
  },

  // Canonical slug -> WordPress category IDs to filter on when affinity favours
  // it. Slugs with no 1000WP content (economics/biology/neuroscience) and the
  // catch-all "philosophy" fall through to an unfiltered pull.
  SLUG_FILTERS: {
    ethics: [8289, 766334143, 11798, 146694],
    politics: [2118287, 524128],
  },

  _totals: { all: 229 }, // X-WP-Total per filter key, self-correcting from headers
  _served: new Set(),

  async fetchNext(count = 3) {
    try {
      const slug = AffinityManager.pickCategory();
      const cats = this.SLUG_FILTERS[slug] || null;
      const key = cats ? cats.join(",") : "all";
      const posts = await this._fetchPage(key, cats, count);

      const items = [];
      for (const p of posts) {
        const content = this._toContent(p);
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

  /** One page of posts at a random offset within the (filtered) pool. */
  async _fetchPage(key, cats, count) {
    const total = this._totals[key] || 50;
    const offset = Math.floor(Math.random() * Math.max(1, total - count));
    const params = new URLSearchParams({
      per_page: String(count),
      offset: String(offset),
      _fields: "id,link,title,content,categories,jetpack_featured_media_url",
    });
    if (cats) params.set("categories", cats.join(","));

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

  _toContent(p) {
    const body = this._extractBody(p.content?.rendered || "");
    if (body.length < 160) return null; // too thin to be a worthwhile card

    const cats = [
      ...new Set((p.categories || []).map((id) => this.CATEGORY_MAP[id] || "philosophy")),
    ];
    const categories = cats.length > 0 ? cats : ["philosophy"];

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
      tags: categories,
      categories,
    });
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
