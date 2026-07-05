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
  // Ephemeral history: dedup within this visit only; nothing persisted.
  const ephemeralHistory = {
    seen: new Set(),
    hasSeen(id) { return this.seen.has(id); },
    record(content) { this.seen.add(content.id); },
  };
  const feed = new FeedManager(settings, ephemeralHistory);

  const scrollerEl = document.getElementById("rd-scroller");
  const searchSheet = document.getElementById("rd-search");
  const sourcesSheet = document.getElementById("rd-sources");

  let activeTab = "today";
  let renderedCount = 0;

  // ---------- Icons ----------
  const ICONS = {
    bookmark: '<svg viewBox="0 0 24 24"><path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.3.3 0 0 1-.47.25L12 16.4l-6.03 4.05a.3.3 0 0 1-.47-.25V4a.5.5 0 0 1 .5-.5z"/></svg>',
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

  function readMinutes(text) {
    return Math.max(1, Math.round(text.split(/\s+/).length / 200));
  }

  function createRedesignCard(content) {
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

    // Top bar: source chip + save/share
    const top = document.createElement("div");
    top.className = "rd-top";
    const chip = document.createElement("div");
    chip.className = "rd-chip";
    chip.innerHTML = `<span class="rd-chip-icon">${sourceMeta?.icon || "•"}</span><span>${sourceName}</span>`;
    top.appendChild(chip);

    const actions = document.createElement("div");
    actions.className = "rd-top-actions";
    const saveBtn = document.createElement("button");
    saveBtn.className = "rd-icon-btn" + (likes.isLiked(content.id) ? " saved" : "");
    saveBtn.setAttribute("aria-label", "Save");
    saveBtn.innerHTML = ICONS.bookmark;
    saveBtn.addEventListener("click", () => {
      likes.toggle(content);
      saveBtn.classList.toggle("saved", likes.isLiked(content.id));
    });
    actions.appendChild(saveBtn);

    const shareBtn = document.createElement("button");
    shareBtn.className = "rd-icon-btn";
    shareBtn.setAttribute("aria-label", "Share");
    shareBtn.innerHTML = ICONS.share;
    shareBtn.addEventListener("click", async () => {
      const payload = { title: content.title || "SmartTok", url: content.openLink || location.href };
      try {
        if (navigator.share) await navigator.share(payload);
        else await navigator.clipboard.writeText(payload.url);
      } catch (_) { /* user cancelled */ }
    });
    actions.appendChild(shareBtn);
    top.appendChild(actions);
    card.appendChild(top);

    if (content.media?.url) {
      const media = document.createElement("div");
      media.className = "rd-media";
      const img = document.createElement("img");
      img.src = content.media.url;
      img.alt = content.media.alt || "";
      img.loading = "lazy";
      media.appendChild(img);
      card.appendChild(media);
    }

    const body = document.createElement("div");
    body.className = "rd-body";

    if (content.title) {
      const h1 = document.createElement("h1");
      h1.className = "rd-title";
      h1.textContent = content.title;
      body.appendChild(h1);
    }

    if (byline || credit || content.timestamp) {
      const bylineEl = document.createElement("div");
      bylineEl.className = "rd-byline";
      const year = content.timestamp ? String(content.timestamp).slice(0, 4) : null;
      bylineEl.textContent = [byline, credit, byline?.includes(year) ? null : year]
        .filter(Boolean)
        .join(" · ");
      body.appendChild(bylineEl);
    }

    if (isPaper) {
      const section = document.createElement("div");
      section.className = "rd-section";
      section.textContent = "Abstract";
      body.appendChild(section);
    }

    // On-device AI one-liner, same pipeline as the production UI.
    if (typeof SummaryManager !== "undefined" && isPaper && !content.tags?.includes("error")) {
      SummaryManager.attach(body, content);
    }

    const textEl = document.createElement("div");
    textEl.className = "rd-text";
    textEl.textContent = text;
    body.appendChild(textEl);

    const meta = document.createElement("div");
    meta.className = "rd-meta";
    meta.innerHTML = `${ICONS.clock}<span>${readMinutes(text)} min read</span>`;
    body.appendChild(meta);
    card.appendChild(body);

    if (content.openLink) {
      const cta = document.createElement("a");
      cta.className = "rd-cta";
      cta.href = content.openLink;
      cta.target = "_blank";
      cta.rel = "noopener noreferrer";
      cta.innerHTML = `<span>Read on ${sourceName}</span>${ICONS.open}`;
      card.appendChild(cta);
    }

    return card;
  }

  // ---------- Feed wiring ----------
  function showState(html) {
    scrollerEl.innerHTML = `<div class="rd-state">${html}</div>`;
  }

  function appendCards(fromIndex) {
    const frag = document.createDocumentFragment();
    for (let i = fromIndex; i < feed.items.length; i++) {
      const item = feed.items[i];
      if (item.tags?.includes("error")) continue; // no fullscreen error cards
      frag.appendChild(createRedesignCard(item));
    }
    scrollerEl.appendChild(frag);
    renderedCount = feed.items.length;
    observeLastCards();
  }

  feed.addEventListener("loading-start", () => {
    renderedCount = 0;
    showState('<div class="rd-spinner"></div><div>Loading the good stuff…</div>');
  });

  feed.addEventListener("loaded-initial", () => {
    if (activeTab !== "today") return;
    scrollerEl.innerHTML = "";
    appendCards(0);
    if (!scrollerEl.children.length) {
      showState("Nothing loaded — check your connection and pull this tab again.");
    }
  });

  feed.addEventListener("loaded-more", () => {
    if (activeTab !== "today") return;
    if (scrollerEl.querySelector(".rd-state")) return; // initial render owns the reset
    appendCards(renderedCount);
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

  // ---------- Tabs ----------
  function renderSaved() {
    const entries = likes.getAllSortedNewestFirst();
    scrollerEl.innerHTML = "";
    if (entries.length === 0) {
      showState("Nothing saved yet.<br>Tap the bookmark on any card.");
      return;
    }
    const frag = document.createDocumentFragment();
    for (const entry of entries) frag.appendChild(createRedesignCard(entry.content));
    scrollerEl.appendChild(frag);
    scrollerEl.scrollTop = 0;
  }

  function renderSources() {
    const list = document.getElementById("rd-sources-list");
    list.innerHTML = "";
    for (const adapter of ALL_ADAPTERS) {
      const row = document.createElement("div");
      row.className = "rd-source-row";
      const isOn = settings.isEnabled(adapter.sourceKey);
      const onlyOne = settings.getEnabledKeys().length === 1 && isOn;
      row.innerHTML = `<span class="rd-source-name"><span>${adapter.icon}</span><span>${adapter.displayName}</span>${adapter.experimental ? '<span class="beta">beta</span>' : ""}</span>`;
      const sw = document.createElement("button");
      sw.className = "rd-switch" + (isOn ? " on" : "");
      sw.disabled = onlyOne;
      sw.setAttribute("aria-label", `Toggle ${adapter.displayName}`);
      sw.addEventListener("click", () => {
        settings.toggle(adapter.sourceKey); // FeedManager reloads itself on change
        renderSources();
      });
      row.appendChild(sw);
      list.appendChild(row);
    }
  }

  const tabs = document.querySelectorAll(".rd-nav button");
  function setTab(name) {
    activeTab = name;
    tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    searchSheet.classList.toggle("open", name === "search");
    sourcesSheet.classList.toggle("open", name === "sources");

    if (name === "today") {
      scrollerEl.innerHTML = "";
      renderedCount = 0;
      appendCards(0);
      scrollerEl.scrollTop = 0;
      if (!scrollerEl.children.length) feed.loadInitial();
    } else if (name === "saved") {
      renderSaved();
    } else if (name === "sources") {
      renderSources();
    }
  }
  tabs.forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  // ---------- Boot ----------
  SummaryManager.init().finally(() => feed.loadInitial());
})();
