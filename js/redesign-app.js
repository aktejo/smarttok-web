/**
 * Redesign workshop app — fullscreen snap-scroll cards (see redesign.html).
 *
 * Deliberately parallel to js/app.js rather than replacing it: this is a
 * design playground. It reuses the real adapters, Mixer, SettingsManager,
 * LikesManager, FeedManager and SummaryManager, so every card is live
 * content — but history is an in-memory stub, so scrolling here never
 * marks cards as "seen" for the production feed.
 */
(function () {
  const settings = new SettingsManager();
  const likes = new LikesManager();
  // Ephemeral history: dedup + History tab within this visit only; nothing
  // persisted, so workshopping never marks cards "seen" for the real feed.
  const ephemeralHistory = {
    seen: new Set(),
    entries: [], // {content, seenAt}, oldest first
    hasSeen(id) { return this.seen.has(id); },
    record(content) {
      if (this.seen.has(content.id)) return;
      this.seen.add(content.id);
      this.entries.push({ content, seenAt: Date.now() });
    },
  };
  const feed = new FeedManager(settings, ephemeralHistory);

  const scrollerEl = document.getElementById("rd-scroller");
  const savedSheet = document.getElementById("rd-saved");
  const historySheet = document.getElementById("rd-history");
  const sourcesSheet = document.getElementById("rd-sources");

  let activeTab = "today";
  let renderedCount = 0;

  // ---------- Icons ----------
  const ICONS = {
    bookmark: '<svg viewBox="0 0 24 24"><path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.3.3 0 0 1-.47.25L12 16.4l-6.03 4.05a.3.3 0 0 1-.47-.25V4a.5.5 0 0 1 .5-.5z"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20.8s-8.2-5-10-9.4C.6 7.8 2.8 4.6 6 4.6c2 0 3.5 1.1 4.4 2.4l1.6 2.1 1.6-2.1c.9-1.3 2.4-2.4 4.4-2.4 3.2 0 5.4 3.2 4 6.8-1.8 4.4-10 9.4-10 9.4z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M12 3l-4 4M12 3l4 4M5 12v8h14v-8"/></svg>',
    open: '<svg viewBox="0 0 24 24"><path d="M14 5h5v5M19 5l-8 8M19 14v5H5V5h5"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
    grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>',
  };
  document.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = ICONS[el.dataset.icon] + (el.dataset.label ? `<span>${el.dataset.label}</span>` : "");
  });

  // ---------- Card rendering ----------
  /** Split a trailing "\n\n— Author[, Year]" byline off the body for the meta line. */
  function splitByline(body) {
    const m = body.match(/\n\n— ([^\n]+)$/);
    if (!m) return { text: body, byline: null };
    return { text: body.slice(0, m.index), byline: m[1] };
  }

  function relativeTime(ts) {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
  }

  function createRedesignCard(content, eagerImage = false) {
    const sourceMeta = ADAPTERS_BY_KEY[content.sourceKey];
    const { text, byline } = splitByline(content.body || "");
    const isPaper = !!sourceMeta?.simplify;
    // "NASA APOD · © Photographer" → chip/CTA show the source name; the
    // credit moves down into the byline.
    const sourceName = sourceMeta?.displayName || content.attribution;
    const credit = content.attribution.startsWith(`${sourceName} · `)
      ? content.attribution.slice(sourceName.length + 3)
      : null;

    const card = document.createElement("article");
    card.className = "rd-card" + (content.media?.url ? " has-media" : "");
    card.dataset.id = content.id;

    // Top bar: source chip only — actions live in the right-side rail.
    const top = document.createElement("div");
    top.className = "rd-top";
    const chip = document.createElement("div");
    chip.className = "rd-chip";
    chip.innerHTML = `<span class="rd-chip-icon">${sourceMeta?.icon || "•"}</span><span>${sourceName}</span>`;
    top.appendChild(chip);
    card.appendChild(top);

    let mediaEl = null;
    if (content.media?.url) {
      mediaEl = document.createElement("div");
      mediaEl.className = "rd-media";
      const img = document.createElement("img");
      img.src = content.media.url;
      img.alt = content.media.alt || "";
      // The first on-screen card's hero is the LCP element — fetch it at
      // full priority; everything below the fold stays lazy.
      img.loading = eagerImage ? "eager" : "lazy";
      if (eagerImage) img.fetchPriority = "high";
      img.decoding = "async";
      mediaEl.appendChild(img);
      card.appendChild(mediaEl);
    }

    // body is the scroll container on image cards (the whole inner sheet
    // rides up over the fixed hero image); on text cards .rd-text scrolls.
    const body = document.createElement("div");
    body.className = "rd-body";
    // Expansion headroom (media cards): scroll room ABOVE the sheet so
    // pulling down past the top reveals the hero fullscreen. Height comes
    // from CSS (60dvh once the body is marked .scrollable, else 0), and
    // appendCards starts the body scrolled to the sheet's resting point.
    let spacerEl = null;
    if (content.media?.url) {
      spacerEl = document.createElement("div");
      spacerEl.className = "rd-expand-spacer";
      body.appendChild(spacerEl);
    }
    const inner = document.createElement("div");
    inner.className = "rd-body-inner";
    body.appendChild(inner);

    if (content.title) {
      const h1 = document.createElement("h1");
      h1.className = "rd-title";
      h1.textContent = content.title;
      inner.appendChild(h1);
    }

    if (byline || credit || content.timestamp) {
      const bylineEl = document.createElement("div");
      bylineEl.className = "rd-byline";
      const year = content.timestamp ? String(content.timestamp).slice(0, 4) : null;
      bylineEl.textContent = [byline, credit, byline?.includes(year) ? null : year]
        .filter(Boolean)
        .join(" · ");
      inner.appendChild(bylineEl);
    }

    if (isPaper) {
      const section = document.createElement("div");
      section.className = "rd-section";
      section.textContent = "Abstract";
      inner.appendChild(section);
    }

    // On-device AI one-liner, same pipeline as the production UI.
    if (typeof SummaryManager !== "undefined" && isPaper && !content.tags?.includes("error")) {
      SummaryManager.attach(inner, content);
    }

    // Full text, no clamp: if it overflows its region it becomes its own
    // scroll area (marked .scrollable after measuring in appendCards) with
    // overscroll containment — so swipes on text scroll the text, while
    // swipes anywhere else snap to the next card.
    const textEl = document.createElement("div");
    textEl.className = "rd-text";
    textEl.textContent = text;
    inner.appendChild(textEl);
    card.appendChild(body);

    // Collapse the hero as the sheet rides up: the image slides upward,
    // shrinks toward the top edge, and fades out. Transform/opacity only,
    // so it runs on the compositor. Two jank guards:
    //   - updates are coalesced to one style write per frame (rAF), so a
    //     burst of scroll events can't stack redundant main-thread work;
    //   - will-change is applied only while actively animating — a static
    //     will-change on every hero kept a GPU layer alive per image card,
    //     which piled up under infinite scroll and made the collapse lag.
    if (mediaEl) {
      let rafId = 0;
      let idleTimer = 0;
      const applyCollapse = () => {
        rafId = 0;
        // y is relative to the sheet's REST position: the first
        // spacer-height pixels of scroll are the fullscreen-image zone,
        // where the hero stays untransformed and the sheet does the moving.
        const y = Math.max(0, body.scrollTop - spacerEl.offsetHeight);
        mediaEl.style.transform =
          `translateY(${-(y * 0.45)}px) scale(${Math.max(0.86, 1 - y / 900)})`;
        mediaEl.style.opacity = String(Math.max(0, 1 - y / 440));
      };
      body.addEventListener(
        "scroll",
        () => {
          mediaEl.style.willChange = "transform, opacity";
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => { mediaEl.style.willChange = ""; }, 200);
          if (!rafId) rafId = requestAnimationFrame(applyCollapse);
        },
        { passive: true }
      );
    }

    // Right-side action rail, reels-style: like / share / open.
    const rail = document.createElement("div");
    rail.className = "rd-rail";

    const likeBtn = document.createElement("button");
    likeBtn.className = "rd-rail-btn" + (likes.isLiked(content.id) ? " saved" : "");
    likeBtn.setAttribute("aria-label", "Like");
    likeBtn.innerHTML = ICONS.heart;
    likeBtn.addEventListener("click", () => {
      likes.toggle(content);
      likeBtn.classList.toggle("saved", likes.isLiked(content.id));
    });
    rail.appendChild(likeBtn);

    const shareBtn = document.createElement("button");
    shareBtn.className = "rd-rail-btn";
    shareBtn.setAttribute("aria-label", "Share");
    shareBtn.innerHTML = ICONS.share;
    shareBtn.addEventListener("click", async () => {
      const payload = { title: content.title || "SmartTok", url: content.openLink || location.href };
      try {
        if (navigator.share) await navigator.share(payload);
        else await navigator.clipboard.writeText(payload.url);
      } catch (_) { /* user cancelled */ }
    });
    rail.appendChild(shareBtn);

    if (content.openLink) {
      const openBtn = document.createElement("a");
      openBtn.className = "rd-rail-btn";
      openBtn.href = content.openLink;
      openBtn.target = "_blank";
      openBtn.rel = "noopener noreferrer";
      openBtn.setAttribute("aria-label", `Read on ${sourceName}`);
      openBtn.innerHTML = ICONS.open;
      rail.appendChild(openBtn);
    }
    card.appendChild(rail);

    // Double-tap to like (like always, never unlike), with a heart burst.
    // Manual tap detection so scroll flicks don't count: a tap = small
    // movement, short press; two taps within 350ms = double-tap.
    let downX = 0, downY = 0, downT = 0, lastTapT = 0;
    card.addEventListener("pointerdown", (e) => {
      downX = e.clientX; downY = e.clientY; downT = Date.now();
    });
    card.addEventListener("pointerup", (e) => {
      if (e.target.closest(".rd-rail")) return;
      const isTap =
        Math.hypot(e.clientX - downX, e.clientY - downY) < 12 &&
        Date.now() - downT < 300;
      if (!isTap) { lastTapT = 0; return; }
      const now = Date.now();
      if (now - lastTapT < 350) {
        lastTapT = 0;
        if (!likes.isLiked(content.id)) {
          likes.toggle(content);
          likeBtn.classList.add("saved");
        }
        const rect = card.getBoundingClientRect();
        const burst = document.createElement("div");
        burst.className = "rd-heart-burst";
        burst.innerHTML = ICONS.heart;
        burst.style.left = `${e.clientX - rect.left}px`;
        burst.style.top = `${e.clientY - rect.top}px`;
        card.appendChild(burst);
        setTimeout(() => burst.remove(), 750);
      } else {
        lastTapT = now;
      }
    });

    return card;
  }

  // ---------- Feed wiring ----------
  function showState(html) {
    scrollerEl.innerHTML = `<div class="rd-state">${html}</div>`;
  }

  function appendCards(fromIndex) {
    const frag = document.createDocumentFragment();
    let eagerNext = !scrollerEl.querySelector(".rd-card"); // first visible card
    for (let i = fromIndex; i < feed.items.length; i++) {
      const item = feed.items[i];
      if (item.tags?.includes("error")) continue; // no fullscreen error cards
      frag.appendChild(createRedesignCard(item, eagerNext));
      eagerNext = false;
    }
    scrollerEl.appendChild(frag);
    renderedCount = feed.items.length;
    observeLastCards();

    // Mark overflowing regions as their own scroll areas: on image cards
    // the whole body sheet scrolls up over the hero image; on text cards
    // just the text scrolls. Only overflowing regions get overscroll
    // containment — short content stays transparent to the card snap.
    // Also start watching each card for the History tab (60% visible).
    requestAnimationFrame(() => {
      for (const cardEl of scrollerEl.querySelectorAll(".rd-card:not(.measured)")) {
        cardEl.classList.add("measured");
        const target = cardEl.classList.contains("has-media")
          ? cardEl.querySelector(".rd-body")
          : cardEl.querySelector(".rd-text");
        if (target && target.scrollHeight > target.clientHeight + 4) {
          target.classList.add("scrollable");
          // Media cards gain 60dvh of expansion headroom above the sheet
          // once scrollable — start them at the sheet's resting point
          // (fullscreen image is one pull-down away, snap-assisted).
          const spacer = target.querySelector(".rd-expand-spacer");
          if (spacer) target.scrollTop = spacer.offsetHeight;
        }
        seenObserver.observe(cardEl);
      }
    });
  }

  // Record a card into this visit's history once it's actually been seen.
  const seenObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const item = feed.items.find((i) => i.id === e.target.dataset.id);
        if (item) ephemeralHistory.record(item);
        seenObserver.unobserve(e.target);
      }
    },
    { threshold: 0.6 }
  );

  feed.addEventListener("loading-start", () => {
    renderedCount = 0;
    showState('<div class="rd-spinner"></div><div>Loading the good stuff…</div>');
  });

  // Fires per source as each resolves — the first card paints as soon as the
  // fastest source answers instead of waiting out the slowest one.
  feed.addEventListener("loaded-more", () => {
    if (activeTab !== "today") return;
    if (scrollerEl.querySelector(".rd-state")) {
      // Spinner still up: only swap it out once something renderable arrived
      // (error items are skipped on this fullscreen UI).
      if (!feed.items.slice(renderedCount).some((i) => !i.tags?.includes("error"))) return;
      scrollerEl.innerHTML = "";
    }
    appendCards(renderedCount);
  });

  feed.addEventListener("loaded-initial", () => {
    if (activeTab !== "today") return;
    if (!scrollerEl.querySelector(".rd-card")) {
      showState("Nothing loaded — check your connection and pull this tab again.");
    }
  });

  // Infinite scroll: when one of the last two cards is on screen, fetch more.
  const nearEndObserver = new IntersectionObserver(
    (entries) => {
      if (activeTab !== "today") return;
      if (entries.some((e) => e.isIntersecting) && !feed.isLoading) {
        feed.appendMore(3);
      }
    },
    { threshold: 0.4 }
  );
  function observeLastCards() {
    nearEndObserver.disconnect();
    const cards = scrollerEl.querySelectorAll(".rd-card");
    for (const el of [...cards].slice(-2)) nearEndObserver.observe(el);
  }

  // ---------- Saved (compact list with filter chips) ----------
  const SAVED_FILTERS = [
    { key: "all", label: "All" },
    { key: "articles", label: "Articles" },
    { key: "papers", label: "Papers" },
    { key: "books", label: "Books" },
    { key: "poems", label: "Poems" },
    { key: "images", label: "Images" },
  ];
  const CATEGORY_BY_SOURCE = {
    wikipedia: "articles",
    arxiv: "papers",
    pubmed: "papers",
    core: "papers",
    gutenberg: "books",
    poetry: "poems",
    nasa: "images",
    dogs: "images",
    cats: "images",
  };
  let savedFilter = "all";
  let savedEditMode = false;

  document.getElementById("rd-saved-edit").addEventListener("click", () => {
    savedEditMode = !savedEditMode;
    renderSaved();
  });

  function savedMetaLine(content) {
    if (content.sourceKey === "gutenberg") return "Free ebook";
    return content.timestamp ? String(content.timestamp).slice(0, 4) : "";
  }

  /** Shared compact list row used by the Liked and History pages. */
  function buildListRow(content, metaText) {
    const sourceMeta = ADAPTERS_BY_KEY[content.sourceKey];
    const { text, byline } = splitByline(content.body || "");
    const title = content.title || text.slice(0, 80);
    // No-title sources use their body as the title — don't repeat it below.
    const desc = byline || (content.title ? text.replace(/\s+/g, " ").trim() : "");

    const row = document.createElement("div");
    row.className = "rd-saved-row";

    const textWrap = document.createElement("div");
    textWrap.className = "rd-saved-text";
    textWrap.innerHTML = `
      <div class="rd-saved-src"><span class="rd-mini-badge">${sourceMeta?.icon || "•"}</span><span>${sourceMeta?.displayName || content.attribution}</span></div>
      <div class="rd-saved-title"></div>
      <div class="rd-saved-desc"></div>
      <div class="rd-saved-meta"></div>`;
    textWrap.querySelector(".rd-saved-title").textContent = title;
    const descEl = textWrap.querySelector(".rd-saved-desc");
    if (desc) descEl.textContent = desc;
    else descEl.remove();
    const metaEl = textWrap.querySelector(".rd-saved-meta");
    if (metaText) metaEl.textContent = metaText;
    else metaEl.remove();
    row.appendChild(textWrap);

    if (content.media?.url) {
      const thumb = document.createElement("img");
      thumb.className = "rd-saved-thumb";
      thumb.src = content.media.url;
      thumb.alt = content.media.alt || "";
      thumb.loading = "lazy";
      row.appendChild(thumb);
    }
    return row;
  }

  function renderSaved() {
    const chipsEl = document.getElementById("rd-saved-chips");
    const listEl = document.getElementById("rd-saved-list");
    const editBtn = document.getElementById("rd-saved-edit");

    const anySaved = likes.getAllSortedNewestFirst().length > 0;
    if (!anySaved) savedEditMode = false;
    editBtn.hidden = !anySaved;
    editBtn.textContent = savedEditMode ? "Done" : "Edit";
    editBtn.classList.toggle("done", savedEditMode);

    chipsEl.innerHTML = "";
    for (const f of SAVED_FILTERS) {
      const chip = document.createElement("button");
      chip.className = "rd-filter-chip" + (savedFilter === f.key ? " active" : "");
      chip.textContent = f.label;
      chip.addEventListener("click", () => {
        savedFilter = f.key;
        renderSaved();
      });
      chipsEl.appendChild(chip);
    }

    const entries = likes.getAllSortedNewestFirst().filter(
      (e) => savedFilter === "all" || CATEGORY_BY_SOURCE[e.content.sourceKey] === savedFilter
    );

    listEl.innerHTML = "";
    if (entries.length === 0) {
      listEl.innerHTML = `<p class="rd-hint">${
        savedFilter === "all"
          ? "Nothing liked yet — double-tap any card, or tap its heart."
          : "Nothing liked in this category yet."
      }</p>`;
      return;
    }

    for (const entry of entries) {
      const content = entry.content;
      const row = buildListRow(content, savedMetaLine(content));

      if (savedEditMode) {
        row.classList.add("editing");
        const removeBtn = document.createElement("button");
        removeBtn.className = "rd-remove-btn";
        removeBtn.setAttribute("aria-label", `Remove from Liked`);
        removeBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>';
        removeBtn.addEventListener("click", () => {
          likes.toggle(content);
          row.classList.add("removing");
          setTimeout(renderSaved, 180); // let the slide-out play before re-rendering
        });
        row.prepend(removeBtn);
      } else if (content.openLink) {
        // Tapping a row opens the original — but not while editing.
        row.classList.add("linked");
        row.addEventListener("click", () => window.open(content.openLink, "_blank", "noopener"));
      }
      listEl.appendChild(row);
    }
  }

  // ---------- History (this visit, newest first) ----------
  function renderHistory() {
    const listEl = document.getElementById("rd-history-list");
    listEl.innerHTML = "";
    const entries = [...ephemeralHistory.entries].reverse();
    if (entries.length === 0) {
      listEl.innerHTML = `<p class="rd-hint">Cards you've scrolled past this visit will show up here, newest first.</p>`;
      return;
    }
    for (const entry of entries) {
      const row = buildListRow(entry.content, relativeTime(entry.seenAt));
      if (entry.content.openLink) {
        row.classList.add("linked");
        row.addEventListener("click", () => window.open(entry.content.openLink, "_blank", "noopener"));
      }
      listEl.appendChild(row);
    }
  }

  // ---------- Sources (enabled/available sections + frequency concept) ----------
  const FREQ_KEY_PREFIX = "smarttok.rd.freq.";

  function _sourceRow(adapter, { withFreq }) {
    const isOn = settings.isEnabled(adapter.sourceKey);
    const onlyOne = settings.getEnabledKeys().length === 1 && isOn;

    const row = document.createElement("div");
    row.className = "rd-source-row";
    row.innerHTML = `<span class="rd-source-name"><span class="rd-source-badge">${adapter.icon}</span><span>${adapter.displayName}</span>${adapter.experimental ? '<span class="beta">beta</span>' : ""}</span>`;

    const controls = document.createElement("span");
    controls.className = "rd-source-controls";

    if (withFreq) {
      const wrap = document.createElement("span");
      wrap.className = "rd-freq-wrap";
      const select = document.createElement("select");
      select.className = "rd-freq";
      select.setAttribute("aria-label", `${adapter.displayName} frequency`);
      for (const opt of ["Frequently", "Daily", "Weekly"]) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        select.appendChild(o);
      }
      select.value = localStorage.getItem(FREQ_KEY_PREFIX + adapter.sourceKey) || "Frequently";
      select.addEventListener("change", () => {
        localStorage.setItem(FREQ_KEY_PREFIX + adapter.sourceKey, select.value);
      });
      wrap.appendChild(select);
      controls.appendChild(wrap);
    }

    const sw = document.createElement("button");
    sw.className = "rd-switch" + (isOn ? " on" : "");
    sw.disabled = onlyOne;
    sw.setAttribute("aria-label", `Toggle ${adapter.displayName}`);
    sw.addEventListener("click", () => {
      settings.toggle(adapter.sourceKey); // FeedManager reloads itself on change
      renderSources();
    });
    controls.appendChild(sw);
    row.appendChild(controls);
    return row;
  }

  function renderSources() {
    const list = document.getElementById("rd-sources-list");
    list.innerHTML = "";

    const enabled = ALL_ADAPTERS.filter((a) => settings.isEnabled(a.sourceKey));
    const available = ALL_ADAPTERS.filter((a) => !settings.isEnabled(a.sourceKey));

    if (enabled.length > 0) {
      const label = document.createElement("div");
      label.className = "rd-section-label";
      label.textContent = "Enabled Sources";
      list.appendChild(label);
      for (const adapter of enabled) list.appendChild(_sourceRow(adapter, { withFreq: true }));
    }

    if (available.length > 0) {
      const label = document.createElement("div");
      label.className = "rd-section-label";
      label.textContent = "Available Sources";
      list.appendChild(label);
      for (const adapter of available) list.appendChild(_sourceRow(adapter, { withFreq: false }));
    }
  }

  const tabs = document.querySelectorAll(".rd-nav button");
  function setTab(name) {
    activeTab = name;
    if (name !== "saved") savedEditMode = false; // leaving Saved always exits edit mode
    tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    savedSheet.classList.toggle("open", name === "saved");
    historySheet.classList.toggle("open", name === "history");
    sourcesSheet.classList.toggle("open", name === "sources");

    if (name === "today") {
      scrollerEl.innerHTML = "";
      renderedCount = 0;
      appendCards(0);
      scrollerEl.scrollTop = 0;
      if (!scrollerEl.children.length) feed.loadInitial();
    } else if (name === "saved") {
      renderSaved();
    } else if (name === "history") {
      renderHistory();
    } else if (name === "sources") {
      renderSources();
    }
  }
  tabs.forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  // ---------- Boot ----------
  SummaryManager.init().finally(() => feed.loadInitial());
})();
