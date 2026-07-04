/**
 * Project Gutenberg adapter.
 * Random public-domain books: cover, title, author, and the *actual first
 * page* of the text — not the license header, not the table of contents.
 *
 * Two upstreams:
 *   - Metadata: Gutendex (https://gutendex.com) — free JSON index of the
 *     Gutenberg catalog. Sends CORS headers (verified live), so it's a
 *     direct fetch. One page = 32 books; a random page out of ~62k English
 *     books gives us random picks. The very first fill uses page 1, which
 *     Gutendex orders by popularity — so the first cards are famous books.
 *   - Text: www.gutenberg.org plain-text files — NO CORS (verified live),
 *     so they go through api/proxy.js. Books run to megabytes, so we send
 *     `Range: bytes=0-65535` (the proxy forwards it; gutenberg.org answers
 *     206) and never download more than the opening slice.
 *
 * The hard part is that Gutenberg files open with a license header, then
 * often a title page, transcriber notes, and a table of contents before
 * the real text starts. _extractOpening() walks past all of that, and
 * _verifyExcerpt() is the final gate: an excerpt must actually read like
 * prose (length, lowercase ratio, sentence punctuation, no boilerplate or
 * TOC patterns) or the book is skipped and another is tried. A bad book
 * costs one retry; it never becomes a garbage card.
 */
const GutenbergAdapter = {
  sourceKey: "gutenberg",
  displayName: "Gutenberg",
  icon: "📚",

  BOOKS_PER_PAGE: 32,       // fixed by Gutendex
  MAX_TEXT_ATTEMPTS: 12,    // parallel text fetches per fill (random pages
                            // hit plays/verse the prose gate rejects, so
                            // over-provision candidates)
  TEXT_SLICE_BYTES: 65535,
  EXCERPT_TARGET_CHARS: 900,
  REQUEST_TIMEOUT_MS: 8000,

  _buffer: [],
  _fillPromise: null,
  _totalBooks: null, // learned from the first Gutendex response

  async fetchNext(count = 3) {
    await this._ensureBuffer(count);
    const results = this._buffer.splice(0, count);
    while (results.length < count) {
      results.push(makeErrorContent(this.sourceKey, this.displayName, null));
    }
    // Kick off a background refill if the buffer is getting low.
    if (this._buffer.length < count && !this._fillPromise) {
      this._fillBuffer();
    }
    return results;
  },

  async _ensureBuffer(needed) {
    if (this._buffer.length >= needed) return;
    if (!this._fillPromise) this._fillBuffer();
    await this._fillPromise;
    // One retry (a fresh random page) before fetchNext pads with errors.
    if (this._buffer.length < needed && !this._fillPromise) {
      await this._fillBuffer();
    }
  },

  _fillBuffer() {
    this._fillPromise = (async () => {
      try {
        const books = await this._fetchRandomCatalogPage();
        this._shuffle(books);

        // Fetch candidate openings in parallel — sequential fetches pushed
        // a first fill past FeedManager's 20s source cap. Each is only a
        // 64KB Range slice, so a burst of 8 is cheap.
        const candidates = books
          .filter((b) => this._pickTextUrl(b.formats))
          .slice(0, this.MAX_TEXT_ATTEMPTS);

        const cards = await Promise.all(
          candidates.map(async (book) => {
            const excerpt = await this._fetchOpening(this._pickTextUrl(book.formats));
            return excerpt ? this._toContent(book, excerpt) : null; // null = skip book
          })
        );
        this._buffer.push(...cards.filter(Boolean));
      } catch (_) {
        // Leave buffer as-is; fetchNext will pad with error cards.
      } finally {
        this._fillPromise = null;
      }
    })();
    return this._fillPromise;
  },

  async _fetchRandomCatalogPage() {
    let page = 1;
    if (this._totalBooks) {
      const lastFullPage = Math.max(1, Math.floor(this._totalBooks / this.BOOKS_PER_PAGE));
      page = 1 + Math.floor(Math.random() * lastFullPage);
    }
    const res = await this._fetchWithTimeout(
      `https://gutendex.com/books/?languages=en&page=${page}`
    );
    if (!res.ok) throw new Error(`Gutendex HTTP ${res.status}`);
    const data = await res.json();
    if (typeof data.count === "number") this._totalBooks = data.count;
    return Array.isArray(data.results) ? data.results : [];
  },

  /** Prefer a plain-text format; never a zip. */
  _pickTextUrl(formats) {
    if (!formats) return null;
    for (const [mime, url] of Object.entries(formats)) {
      if (mime.startsWith("text/plain") && !url.includes(".zip")) return url;
    }
    return null;
  },

  /** Fetch the opening slice through the proxy and extract a verified excerpt. */
  async _fetchOpening(txtUrl) {
    try {
      const res = await this._fetchWithTimeout(proxiedUrl(txtUrl), {
        headers: { Range: `bytes=0-${this.TEXT_SLICE_BYTES}` },
      });
      if (!res.ok) return null;
      return this._extractOpening(await res.text());
    } catch (_) {
      return null;
    }
  },

  async _fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * Walk from the Gutenberg START marker past front matter to the first
   * real prose, and return ~one page of it — or null if nothing passes
   * verification.
   */
  _extractOpening(rawText) {
    const startMatch = rawText.match(
      /\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*/i
    );
    if (!startMatch) return null; // unusual header format — skip this book

    let text = rawText
      .slice(startMatch.index + startMatch[0].length)
      .replace(/\r\n/g, "\n");

    // Tiny books: don't let the closing license into the excerpt.
    const endIdx = text.search(/\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i);
    if (endIdx !== -1) text = text.slice(0, endIdx);

    const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

    const isChapterHeading = (p) =>
      p.length < 60 &&
      /^((chapter|book|part|canto|letter|act|scene|stave)\b|[IVXLC]+\.?$|\d+\.?$)/i.test(p);

    // Prefer starting at the first explicit chapter heading followed
    // closely by prose — that skips prefaces and translator notes, which
    // read like prose but aren't the book's first page. Fall back to the
    // first prose paragraph when a book has no chapter structure.
    const pieces = [];
    let startIdx = -1;
    const chapterIdx = paras.findIndex(isChapterHeading);
    if (chapterIdx !== -1) {
      for (let i = chapterIdx + 1; i < Math.min(chapterIdx + 4, paras.length); i++) {
        if (this._isProse(paras[i])) {
          startIdx = i;
          // Include the heading and any short lines between it and the
          // prose (e.g. "CHAPTER I" / "The Cyclone").
          for (let j = chapterIdx; j < i; j++) {
            if (paras[j].length < 80) pieces.push(paras[j]);
          }
          break;
        }
      }
    }
    if (startIdx === -1) {
      pieces.length = 0;
      startIdx = paras.findIndex((p) => this._isProse(p));
      if (startIdx === -1) return null;
      const prev = paras[startIdx - 1];
      if (prev && isChapterHeading(prev)) pieces.push(prev);
    }

    let total = 0;
    for (let i = startIdx; i < paras.length && total < this.EXCERPT_TARGET_CHARS; i++) {
      pieces.push(paras[i]);
      total += paras[i].length;
    }

    let excerpt = pieces.join("\n\n");
    if (excerpt.length > 1400) {
      excerpt = excerpt.slice(0, 1400).replace(/\s+\S*$/, "");
    }
    excerpt += " …";

    return this._verifyExcerpt(excerpt) ? excerpt : null;
  },

  /** True if a paragraph reads like body prose rather than front matter. */
  _isProse(p) {
    if (p.length < 180) return false;
    // Gutenberg wraps dedications/epigraphs in _italic_ markers — an
    // opening paragraph starting with "_" is front matter, not the text.
    if (p.startsWith("_")) return false;
    if (this._isFrontMatter(p) || this._looksLikeToc(p)) return false;
    if (!/[.!?;]/.test(p)) return false;
    const letters = p.replace(/[^a-zA-Z]/g, "");
    if (letters.length < 100) return false;
    const lower = p.replace(/[^a-z]/g, "");
    return lower.length / letters.length >= 0.55; // caps walls = headings/TOC
  },

  _isFrontMatter(p) {
    return /^(\[?illustration|transcriber|produced by|e-?text|this ebook|this (book|work|volume|edition|translation)\s+(is|was|has been)|updated editions|copyright|all rights reserved|entered according to act|printed in|published by|first published|dedicated to|to the memory of)/i.test(p)
      || /^(contents|table of contents|list of illustrations|illustrations|index|dramatis person|introduction by|editor'?s? (note|preface))/i.test(p);
  },

  _looksLikeToc(p) {
    const lines = p.split("\n");
    if (lines.length < 3) return false;
    const entryish = lines.filter((l) =>
      /^\s*(chapter\s+)?[IVXLC\d]+[.)]?\s/i.test(l) || /\.{3,}/.test(l) || /\s\d+\s*$/.test(l)
    ).length;
    return entryish / lines.length > 0.5;
  },

  /**
   * Final gate — the excerpt must actually read like the opening of a book.
   * Rejects license text, TOCs, caps-heavy title pages, and anything that
   * doesn't contain real sentences, so a bad extraction skips the book
   * instead of ever reaching a card.
   */
  _verifyExcerpt(t) {
    if (!t || t.length < 350) return false;
    const letters = t.replace(/[^a-zA-Z]/g, "");
    if (letters.length < 200) return false;
    const lower = t.replace(/[^a-z]/g, "");
    if (lower.length / letters.length < 0.6) return false;
    if ((t.match(/[.!?]/g) || []).length < 3) return false;
    if (/project gutenberg|gutenberg ebook|transcriber|produced by|copyright|all rights reserved|start of th/i.test(t)) return false;
    if (/\.{4,}/.test(t)) return false; // dotted TOC leaders
    const tocLines = t.split("\n").filter((l) =>
      /^\s*(chapter\s+)?[IVXLC\d]+[.)]?\s.*\d+\s*$/i.test(l)
    ).length;
    return tocLines < 3;
  },

  _toContent(book, excerpt) {
    const author = book.authors?.[0]?.name || null;
    // Gutendex names are "Last, First" — flip for display.
    const displayAuthor = author && author.includes(",")
      ? author.split(",").map((s) => s.trim()).reverse().join(" ")
      : author;

    return makeContent({
      id: `gutenberg-${book.id}`,
      sourceKey: this.sourceKey,
      title: book.title || "Untitled",
      body: excerpt + (displayAuthor ? `\n\n— ${displayAuthor}` : ""),
      openLink: `https://www.gutenberg.org/ebooks/${book.id}`,
      media: book.formats?.["image/jpeg"]
        ? { url: book.formats["image/jpeg"], alt: `Cover of ${book.title || "book"}` }
        : null,
      attribution: this.displayName,
      tags: (book.subjects || []).slice(0, 2),
      timestamp: null,
    });
  },

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  },
};
