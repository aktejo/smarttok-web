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
    const inner = document.createElement("div");
    inner.className = "rd-body-inner";
    body.appendChild(inner);

    // Grab pill (image cards): the handle for the expand/minimize gesture.
    let grabEl = null;
    if (mediaEl) {
      grabEl = document.createElement("div");
      grabEl.className = "rd-grab";
      grabEl.setAttribute("aria-label", "Expand image");
      inner.appendChild(grabEl);
    }

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

    // "Did you know?" box for Deep Dives — appended only once a fact resolves,
    // so there's no empty-box flash when there isn't one.
    if (
      content.sourceKey === "wikiedu" &&
      !content.tags?.includes("error") &&
      typeof WikiEduAdapter !== "undefined"
    ) {
      WikiEduAdapter.surprisingFact(content)
        .then((f) => {
          if (!f) return;
          const fact = document.createElement("div");
          fact.className = "rd-fact";
          const lbl = document.createElement("span");
          lbl.className = "rd-fact-label";
          lbl.textContent = "Did you know?";
          const txt = document.createElement("span");
          txt.className = "rd-fact-text";
          txt.textContent = f;
          fact.appendChild(lbl);
          fact.appendChild(txt);
          inner.appendChild(fact);
        })
        .catch(() => {});
    }

    card.appendChild(body);

    // ---- Image-card gestures ----
    if (mediaEl) {
      const img = mediaEl.querySelector("img");

      // (1) Collapse the hero as the sheet rides up: the image slides
      // upward, shrinks toward the top edge, and fades out. rAF-coalesced;
      // will-change only while animating (a static hint per card piles up
      // GPU layers under infinite scroll).
      let rafId = 0;
      let idleTimer = 0;
      const applyCollapse = () => {
        rafId = 0;
        const y = Math.max(0, body.scrollTop);
        mediaEl.style.transform =
          `translateY(${-(y * 0.45)}px) scale(${Math.max(0.86, 1 - y / 900)})`;
        mediaEl.style.opacity = String(Math.max(0, 1 - y / 440));
        // Once the sheet reaches the top, the sticky pill is pinned over
        // scrolling text — give it a contrast treatment so it stays visible.
        grabEl.classList.toggle("pinned", y > card.clientHeight * 0.4 - 30);
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

      // (2) Expand: dragging the grab pill down parks the sheet at the
      // bottom (just the title, or the first caption line) and morphs the
      // hero from its 48dvh cover-crop preview to a letterboxed box at the
      // image's OWN aspect ratio — a cover-fit box AT the image's ratio
      // crops nothing, so the crop melts away as the box approaches it.
      let expandP = 0;   // 0 = rest, 1 = fullscreen image
      let geom = null;   // gesture geometry, computed at drag start
      let settleRaf = 0;

      const computeGeom = () => {
        const ch = card.clientHeight;
        const cw = card.clientWidth;
        const innerTop = inner.getBoundingClientRect().top;
        // Visible strip in the expanded state: pill + title, or pill +
        // first line of the caption on title-less cards (cats/dogs).
        const titleEl = inner.querySelector(".rd-title");
        const stripBottom = titleEl
          ? titleEl.getBoundingClientRect().bottom
          : textEl.getBoundingClientRect().top +
            (parseFloat(getComputedStyle(textEl).lineHeight) || 24);
        const stripH = stripBottom - innerTop + 14;
        // Park the strip just above the nav bar, not behind it: the card's
        // bottom padding is exactly the nav allowance.
        const navPad = parseFloat(getComputedStyle(card).paddingBottom) || 0;
        const availH = Math.max(120, ch - navPad - stripH);
        const nw = img.naturalWidth || cw;
        const nh = img.naturalHeight || availH;
        const k = Math.min(cw / nw, availH / nh);
        return {
          h0: mediaEl.offsetHeight,           // the 48dvh preview height
          fitH: nh * k,
          fitTop: (availH - nh * k) / 2,
          side: (cw - nw * k) / 2,
          // sheet rests at 40dvh = 0.4*ch
          dist: Math.max(0, ch * 0.6 - navPad - stripH),
        };
      };

      const setExpand = (p) => {
        expandP = p;
        if (p <= 0) {
          // Fully back to rest: clear inline geometry so the pure-CSS
          // preview (and future viewport resizes) win again.
          mediaEl.style.height = "";
          mediaEl.style.top = "";
          mediaEl.style.left = "";
          mediaEl.style.right = "";
          mediaEl.style.removeProperty("--rd-scrim-o");
          body.style.transform = "";
          card.classList.remove("rd-expanded");
          return;
        }
        const g = geom;
        const lerp = (a, b) => a + (b - a) * p;
        mediaEl.style.height = `${lerp(g.h0, g.fitH)}px`;
        mediaEl.style.top = `${lerp(0, g.fitTop)}px`;
        mediaEl.style.left = `${lerp(0, g.side)}px`;
        mediaEl.style.right = `${lerp(0, g.side)}px`;
        mediaEl.style.setProperty("--rd-scrim-o", String(1 - p));
        body.style.transform = `translateY(${lerp(0, g.dist)}px)`;
        card.classList.toggle("rd-expanded", p >= 1);
      };

      const settleTo = (target) => {
        cancelAnimationFrame(settleRaf);
        const from = expandP;
        const t0 = performance.now();
        const DUR = 220;
        const tick = (now) => {
          const t = Math.min(1, (now - t0) / DUR);
          const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
          setExpand(from + (target - from) * e);
          if (t < 1) settleRaf = requestAnimationFrame(tick);
        };
        settleRaf = requestAnimationFrame(tick);
      };

      let drag = null;
      grabEl.addEventListener("pointerdown", (e) => {
        cancelAnimationFrame(settleRaf);
        // Mid-read the pill is pinned (sticky) at the top of the screen:
        // there, a pull-down (or tap) means "bring the sheet back down".
        if (expandP === 0 && body.scrollTop > 2) {
          drag = { y0: e.clientY, returnMode: true };
          try { grabEl.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
          return;
        }
        if (!geom || expandP === 0) geom = computeGeom();
        // Sanity gate: mid-layout (rotation, viewport churn) the measured
        // geometry can be degenerate — refuse the gesture rather than
        // expanding into a broken state.
        if (!(geom.dist > 40) || !(geom.fitH > 60)) { geom = null; return; }
        drag = { y0: e.clientY, p0: expandP, moved: false };
        try { grabEl.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
      });
      grabEl.addEventListener("pointermove", (e) => {
        if (!drag) return;
        if (drag.returnMode) {
          if (e.clientY - drag.y0 > 24) {
            drag = null;
            body.scrollTo({ top: 0, behavior: "smooth" });
          }
          return;
        }
        if (!geom.dist) return;
        const dy = e.clientY - drag.y0;
        if (Math.abs(dy) > 4) drag.moved = true;
        setExpand(Math.min(1, Math.max(0, drag.p0 + dy / geom.dist)));
      });
      const endDrag = () => {
        if (!drag) return;
        if (drag.returnMode) {
          drag = null;
          body.scrollTo({ top: 0, behavior: "smooth" }); // tap = same intent
          return;
        }
        const target = !drag.moved
          ? (drag.p0 > 0.5 ? 0 : 1) // a plain tap toggles
          : drag.p0 === 0
            ? (expandP > 0.25 ? 1 : 0)
            : (expandP < 0.75 ? 0 : 1);
        drag = null;
        settleTo(target);
      };
      grabEl.addEventListener("pointerup", endDrag);
      grabEl.addEventListener("pointercancel", endDrag);

      // (3) Pinch-to-zoom on the expanded image, Instagram-style: zooms
      // while the fingers are down, springs back to fit on release.
      let pinch = null;
      mediaEl.addEventListener("touchstart", (e) => {
        if (expandP < 0.99 || e.touches.length !== 2) return;
        const [a, b] = e.touches;
        const r = mediaEl.getBoundingClientRect();
        pinch = {
          d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          mx: (a.clientX + b.clientX) / 2,
          my: (a.clientY + b.clientY) / 2,
        };
        img.style.transformOrigin =
          `${pinch.mx - r.left}px ${pinch.my - r.top}px`;
        img.style.transition = "none";
      }, { passive: true });
      mediaEl.addEventListener("touchmove", (e) => {
        if (!pinch || e.touches.length !== 2) return;
        e.preventDefault(); // this gesture is ours — no page pan/zoom
        const [a, b] = e.touches;
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const s = Math.min(4, Math.max(1, d / pinch.d0));
        const mx = (a.clientX + b.clientX) / 2;
        const my = (a.clientY + b.clientY) / 2;
        img.style.transform =
          `translate(${mx - pinch.mx}px, ${my - pinch.my}px) scale(${s})`;
      }, { passive: false });
      const endPinch = () => {
        if (!pinch) return;
        pinch = null;
        img.style.transition = "transform 0.25s ease";
        img.style.transform = "";
        setTimeout(() => { img.style.transition = ""; }, 300);
      };
      mediaEl.addEventListener("touchend", (e) => {
        if (e.touches.length < 2) endPinch();
      }, { passive: true });
      mediaEl.addEventListener("touchcancel", endPinch, { passive: true });
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
      openBtn.addEventListener("click", () => {
        // Reading the full article is the depth signal for the edu feed.
        if (typeof AffinityManager !== "undefined") AffinityManager.recordOpen(content);
      });
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
        }
        seenObserver.observe(cardEl);
        dwellObserver.observe(cardEl);
      }
    });
  }

  // Dwell tracking for the interest algorithm: how long each card stays
  // ≥60% on screen. Enter stamps a start time; exit reports the duration
  // (a fast swipe-past registers as a skip inside recordDwell).
  const dwellStart = new Map(); // element -> timestamp
  const dwellObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const content = feed.items.find((i) => i.id === entry.target.dataset.id);
        if (!content) continue;
        if (entry.isIntersecting) {
          if (!dwellStart.has(entry.target)) {
            dwellStart.set(entry.target, performance.now());
            AffinityManager.recordShown(content);
          }
        } else if (dwellStart.has(entry.target)) {
          const ms = performance.now() - dwellStart.get(entry.target);
          dwellStart.delete(entry.target);
          AffinityManager.recordDwell(content, ms);
        }
      }
    },
    { threshold: 0.6 }
  );
  // Card still on screen when the page goes away = a real read; don't lose it.
  addEventListener("pagehide", () => {
    for (const [el, start] of dwellStart) {
      const content = feed.items.find((i) => i.id === el.dataset.id);
      if (content) AffinityManager.recordDwell(content, performance.now() - start);
    }
    dwellStart.clear();
  });

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
    dwellObserver.disconnect();
    dwellStart.clear();
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

  // ---------- Sources (enabled/available sections + learned preferences) ----------
  function _sourceRow(adapter) {
    const isOn = settings.isEnabled(adapter.sourceKey);
    const onlyOne = settings.getEnabledKeys().length === 1 && isOn;

    const row = document.createElement("div");
    row.className = "rd-source-row";
    row.innerHTML = `<span class="rd-source-name"><span class="rd-source-badge">${adapter.icon}</span><span>${adapter.displayName}</span>${adapter.experimental ? '<span class="beta">beta</span>' : ""}</span>`;

    const controls = document.createElement("span");
    controls.className = "rd-source-controls";

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

  // "What the feed has learned": the open-tag affinity vector, rendered as
  // weighted bars. The vector is shared across sources (one taxonomy), so it's
  // shown for the feed as a whole rather than per source.
  function _renderPreferences() {
    const wrap = document.createElement("div");
    wrap.className = "rd-prefs";

    const label = document.createElement("div");
    label.className = "rd-section-label";
    label.textContent = "What the feed has learned";
    wrap.appendChild(label);

    const topics = AffinityManager.learnedTopics();
    const liked = topics.filter((t) => t.weight > 0.05).slice(0, 15);
    const avoided = topics.filter((t) => t.weight < -0.05).slice(-6).reverse();

    if (liked.length === 0 && avoided.length === 0) {
      const empty = document.createElement("p");
      empty.className = "rd-hint";
      empty.textContent =
        "Nothing yet — read, save, and open a few cards and the topics you gravitate toward will show up here.";
      wrap.appendChild(empty);
      return wrap;
    }

    const maxAbs = Math.max(1, ...topics.map((t) => Math.abs(t.weight)));
    const makeRow = (t) => {
      const row = document.createElement("div");
      row.className = "rd-pref-row" + (t.weight < 0 ? " neg" : "");
      const name = document.createElement("span");
      name.className = "rd-pref-name";
      name.textContent = t.tag;
      const bar = document.createElement("span");
      bar.className = "rd-pref-bar";
      const fill = document.createElement("span");
      fill.className = "rd-pref-fill";
      fill.style.width = `${Math.round((Math.abs(t.weight) / maxAbs) * 100)}%`;
      bar.appendChild(fill);
      row.appendChild(name);
      row.appendChild(bar);
      return row;
    };

    for (const t of liked) wrap.appendChild(makeRow(t));
    if (avoided.length > 0) {
      const sub = document.createElement("div");
      sub.className = "rd-pref-sub";
      sub.textContent = "Tends to skip";
      wrap.appendChild(sub);
      for (const t of avoided) wrap.appendChild(makeRow(t));
    }
    return wrap;
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
      for (const adapter of enabled) list.appendChild(_sourceRow(adapter));
    }

    if (available.length > 0) {
      const label = document.createElement("div");
      label.className = "rd-section-label";
      label.textContent = "Available Sources";
      list.appendChild(label);
      for (const adapter of available) list.appendChild(_sourceRow(adapter));
    }

    list.appendChild(_renderPreferences());
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
