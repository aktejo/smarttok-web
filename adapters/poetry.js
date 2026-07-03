/**
 * Poetry adapter.
 * Pulls random classic poems from PoetryDB (free, keyless).
 * Docs: https://poetrydb.org
 *
 * CORS: poetrydb.org sends Access-Control-Allow-Origin: * — direct
 * fetch works, no proxy needed (verified live).
 *
 * /random/N returns N poems in a single call as
 * [{title, author, lines: [...], linecount}]. Stanza breaks arrive as
 * empty strings in `lines`, so joining with "\n" gives the markdown
 * renderer exactly what it needs (single \n -> <br>, \n\n -> stanza gap).
 */
const PoetryAdapter = {
  sourceKey: "poetry",
  displayName: "Poetry",
  icon: "🪶",

  // Epics don't fit a feed card; clip long poems and mark the cut.
  MAX_LINES: 24,

  async fetchNext(count = 3) {
    try {
      const res = await fetch(`https://poetrydb.org/random/${count}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const poems = await res.json();
      if (!Array.isArray(poems)) throw new Error("unexpected response shape");

      const cards = poems.map((p) => this._toContent(p)).filter(Boolean);
      while (cards.length < count) {
        cards.push(makeErrorContent(this.sourceKey, this.displayName, null));
      }
      return cards;
    } catch (err) {
      return Array.from({ length: count }, () =>
        makeErrorContent(this.sourceKey, this.displayName, null)
      );
    }
  },

  _toContent(poem) {
    if (!poem?.title || !Array.isArray(poem.lines) || poem.lines.length === 0) {
      return null;
    }

    const truncated = poem.lines.length > this.MAX_LINES;
    const lines = truncated ? poem.lines.slice(0, this.MAX_LINES) : poem.lines;

    let body = lines.join("\n").trim();
    if (truncated) body += "\n⋯";
    if (poem.author) body += `\n\n— ${poem.author}`;

    return makeContent({
      // Title+author is stable per poem, so the same poem always dedups.
      id: `poetry-${this._hash(`${poem.title}|${poem.author || ""}`)}`,
      sourceKey: this.sourceKey,
      title: poem.title,
      body,
      openLink: null, // PoetryDB has no human-readable per-poem page
      media: null,
      attribution: this.displayName,
      tags: poem.author ? [poem.author] : [],
      timestamp: null,
    });
  },

  // Small stable string hash so the same poem always yields the same ID.
  _hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h).toString(36);
  },
};
