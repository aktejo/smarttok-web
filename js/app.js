/**
 * App
 * Wires FeedManager, SettingsManager, LikesManager to the DOM.
 * Handles tab switching, infinite scroll, pull-to-refresh, lightbox.
 */
(function () {
  const settings = new SettingsManager();
  const likes = new LikesManager();
  const history = new HistoryManager();
  const feed = new FeedManager(settings, history);

  const feedListEl = document.getElementById("feed-list");
  const feedSentinelEl = document.getElementById("feed-sentinel");
  const likedListEl = document.getElementById("liked-list");
  const historyListEl = document.getElementById("history-list");
  const settingsListEl = document.getElementById("settings-list");
  const refreshIndicatorEl = document.getElementById("refresh-indicator");
  const lightboxEl = document.getElementById("lightbox");
  const lightboxImgEl = document.getElementById("lightbox-img");

  // ---------- Tabs ----------
  const tabButtons = document.querySelectorAll(".tab-btn");
  const views = document.querySelectorAll(".view");

  function showView(name) {
    views.forEach((v) => v.classList.toggle("active", v.dataset.view === name));
    tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    if (name === "liked") renderLikedView();
    if (name === "history") renderHistoryView();
    if (name === "settings") renderSettingsView();
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab === "feed") {
        // Returning to Feed — whether by tapping it while active or
        // switching back from another tab — always shows a fresh batch.
        window.scrollTo({ top: 0, behavior: "smooth" });
        showView(tab);
        feed.loadInitial();
      } else {
        showView(tab);
      }
    });
  });

  // ---------- Feed rendering ----------
  // Cards are recorded into history only once they're actually visible on
  // screen — not when fetched/appended — so scrolling fast past a card
  // that never gets seen doesn't count it as "seen".
  const visibilityObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = entry.target.dataset.id;
          const content = feed.items.find((i) => i.id === id);
          if (content && !content.tags?.includes("error")) {
            history.record(content);
            if (document.querySelector('.view[data-view="history"]').classList.contains("active")) {
              renderHistoryView();
            }
          }
          visibilityObserver.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.6 } // at least 60% of the card must be on screen to count as "seen"
  );

  function renderFeedAppend(startIndex) {
    const frag = document.createDocumentFragment();
    for (let i = startIndex; i < feed.items.length; i++) {
      const card = createCardElement(feed.items[i], { likesManager: likes, onImageTap: openLightbox });
      frag.appendChild(card);
      visibilityObserver.observe(card);
    }
    feedListEl.appendChild(frag);
  }

  function clearSkeletons() {
    feedListEl.querySelectorAll(".skeleton-card").forEach((el) => el.remove());
  }

  function showSkeletons(n = 3) {
    for (let i = 0; i < n; i++) {
      const sk = document.createElement("div");
      sk.className = "skeleton-card";
      feedListEl.appendChild(sk);
    }
  }

  let initialLoadInProgress = false;

  feed.addEventListener("loading-start", () => {
    initialLoadInProgress = true;
    visibilityObserver.disconnect(); // drop observations of cards about to be removed
    feedListEl.innerHTML = "";
    showSkeletons(3);
  });

  let lastRenderedCount = 0;
  feed.addEventListener("loaded-initial", () => {
    initialLoadInProgress = false;
    clearSkeletons();
    lastRenderedCount = 0;
    renderFeedAppend(0);
    lastRenderedCount = feed.items.length;
    hideRefreshIndicator();
  });

  feed.addEventListener("loaded-more", () => {
    if (initialLoadInProgress) return; // loaded-initial will render the full batch
    renderFeedAppend(lastRenderedCount);
    lastRenderedCount = feed.items.length;
  });

  // ---------- Infinite scroll ----------
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && !feed.isLoading) {
        feed.appendMore(3);
      }
    },
    { rootMargin: "600px" }
  );
  observer.observe(feedSentinelEl);

  // ---------- Pull to refresh (simple top-of-page swipe) ----------
  let touchStartY = null;
  let pulling = false;

  window.addEventListener("touchstart", (e) => {
    if (window.scrollY === 0 && document.querySelector('.view[data-view="feed"]').classList.contains("active")) {
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (touchStartY === null) return;
    const delta = e.touches[0].clientY - touchStartY;
    if (delta > 60 && !pulling) {
      pulling = true;
      showRefreshIndicator();
    }
  }, { passive: true });

  window.addEventListener("touchend", () => {
    if (pulling) {
      feed.loadInitial();
    }
    touchStartY = null;
    pulling = false;
  });

  function showRefreshIndicator() {
    refreshIndicatorEl.classList.add("visible");
    refreshIndicatorEl.innerHTML = `<span class="spinner"></span> Refreshing…`;
  }
  function hideRefreshIndicator() {
    refreshIndicatorEl.classList.remove("visible");
  }

  document.getElementById("refresh-btn").addEventListener("click", () => {
    showRefreshIndicator();
    window.scrollTo({ top: 0, behavior: "smooth" });
    feed.loadInitial();
  });

  // ---------- Liked view ----------
  function renderLikedView() {
    const entries = likes.getAllSortedNewestFirst();
    likedListEl.innerHTML = "";
    if (entries.length === 0) {
      likedListEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">♡</div>
          <h3>Nothing saved yet</h3>
          <p>Tap the heart on anything you want to keep.</p>
        </div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const entry of entries) {
      frag.appendChild(
        createCardElement(entry.content, { likesManager: likes, onImageTap: openLightbox })
      );
    }
    likedListEl.appendChild(frag);
  }

  likes.addEventListener("change", () => {
    if (document.querySelector('.view[data-view="liked"]').classList.contains("active")) {
      renderLikedView();
    }
  });

  // ---------- History view ----------
  function renderHistoryView() {
    const entries = history.getRecent();
    historyListEl.innerHTML = "";
    if (entries.length === 0) {
      historyListEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">◷</div>
          <h3>No history yet</h3>
          <p>Cards you've scrolled past will show up here, newest first.</p>
        </div>`;
      return;
    }
    const header = document.createElement("div");
    header.className = "history-count";
    header.textContent = `Last ${entries.length} card${entries.length === 1 ? "" : "s"} you've seen`;
    historyListEl.appendChild(header);

    const frag = document.createDocumentFragment();
    for (const entry of entries) {
      const card = createCardElement(entry.content, { likesManager: likes, onImageTap: openLightbox });
      const seenLabel = document.createElement("div");
      seenLabel.className = "seen-at";
      seenLabel.textContent = formatRelativeTime(entry.seenAt);
      card.querySelector(".card-stamp").appendChild(seenLabel);
      frag.appendChild(card);
    }
    historyListEl.appendChild(frag);
  }

  function formatRelativeTime(isoString) {
    const then = new Date(isoString).getTime();
    const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
  }

  // ---------- Settings view ----------
  document.getElementById("clear-history-btn").addEventListener("click", () => {
    if (history.entries.length === 0) return;
    const ok = confirm(`Clear all ${history.entries.length} seen cards? They'll be eligible to show up in your feed again.`);
    if (ok) {
      history.clear();
      renderSettingsView();
      if (document.querySelector('.view[data-view="history"]').classList.contains("active")) {
        renderHistoryView();
      }
    }
  });

  function renderSettingsView() {
    settingsListEl.innerHTML = "";
    for (const adapter of ALL_ADAPTERS) {
      const row = document.createElement("div");
      row.className = "source-row";

      const label = document.createElement("div");
      label.className = "source-label";
      label.innerHTML = `<span class="source-icon">${adapter.icon}</span><span>${adapter.displayName}</span>`;
      row.appendChild(label);

      const isOn = settings.isEnabled(adapter.sourceKey);
      const onlyOneEnabled = settings.getEnabledKeys().length === 1 && isOn;

      const toggle = document.createElement("button");
      toggle.className = "toggle" + (isOn ? " on" : "");
      toggle.setAttribute("aria-label", `Toggle ${adapter.displayName}`);
      if (onlyOneEnabled) toggle.disabled = true;
      toggle.addEventListener("click", () => {
        settings.toggle(adapter.sourceKey);
        renderSettingsView();
      });
      row.appendChild(toggle);

      settingsListEl.appendChild(row);

      if (adapter.sourceKey === "arxiv" && isOn) {
        settingsListEl.appendChild(_renderArxivTopics());
      }
      if (adapter.sourceKey === "nasa" && isOn) {
        settingsListEl.appendChild(_renderNasaApiKey());
      }
    }
    settingsListEl.appendChild(_renderAiSummaries());
    const clearBtn = document.getElementById("clear-history-btn");
    clearBtn.textContent = `Clear history (${history.entries.length} card${history.entries.length === 1 ? "" : "s"})`;
    clearBtn.disabled = history.entries.length === 0;
  }

  function _renderAiSummaries() {
    const section = document.createElement("div");
    section.className = "arxiv-topics";

    const heading = document.createElement("div");
    heading.className = "arxiv-topics-heading";
    heading.textContent = "AI summaries";
    section.appendChild(heading);

    const note = document.createElement("p");
    note.className = "nasa-api-note";
    section.appendChild(note);

    const state = SummaryManager.availabilityState;

    if (!SummaryManager.supported() || state === "unavailable") {
      note.textContent =
        "Plain-English one-liners for arXiv/PubMed papers, generated on-device " +
        "by your browser's built-in AI. Needs Chrome 138+ on desktop — not " +
        "available in this browser. Nothing is ever sent to a server.";
      return section;
    }

    if (state === "downloadable" || state === "downloading") {
      note.textContent =
        "Plain-English one-liners for arXiv/PubMed papers, generated on-device. " +
        "Chrome downloads a small AI model once (a few hundred MB); after that " +
        "it's free forever and works offline. Nothing is ever sent to a server.";
      const btn = document.createElement("button");
      btn.className = "nasa-api-save";
      btn.textContent = state === "downloading" ? "Downloading…" : "Download model & enable";
      btn.disabled = state === "downloading";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Starting download…";
        try {
          await SummaryManager.ensureModel((p) => {
            btn.textContent = `Downloading… ${Math.round(p * 100)}%`;
          });
          SummaryManager.setEnabled(true);
          renderSettingsView();
          feed.loadInitial(); // re-render feed so summaries show up right away
        } catch (_) {
          btn.disabled = false;
          btn.textContent = "Download failed — try again";
        }
      });
      section.appendChild(btn);
      return section;
    }

    // state === "available" — normal on/off toggle
    note.textContent =
      "Plain-English one-liners on arXiv/PubMed papers, generated on-device " +
      "by your browser's built-in AI. Free, offline-capable; nothing is ever " +
      "sent to a server.";
    const row = document.createElement("div");
    row.className = "source-row source-row--sub";
    const label = document.createElement("div");
    label.className = "source-label";
    label.textContent = "Show summaries";
    row.appendChild(label);

    const isOn = SummaryManager.enabled();
    const toggle = document.createElement("button");
    toggle.className = "toggle" + (isOn ? " on" : "");
    toggle.setAttribute("aria-label", "Toggle AI summaries");
    toggle.addEventListener("click", () => {
      SummaryManager.setEnabled(!isOn);
      renderSettingsView();
    });
    row.appendChild(toggle);
    section.appendChild(row);
    return section;
  }

  function _renderNasaApiKey() {
    const section = document.createElement("div");
    section.className = "arxiv-topics";

    const heading = document.createElement("div");
    heading.className = "arxiv-topics-heading";
    heading.textContent = "NASA API key";
    section.appendChild(heading);

    const note = document.createElement("p");
    note.className = "nasa-api-note";
    note.innerHTML = `Free key at <a href="https://api.nasa.gov/" target="_blank" rel="noopener">api.nasa.gov</a> — avoids the shared rate limit.`;
    section.appendChild(note);

    const inputRow = document.createElement("div");
    inputRow.className = "nasa-api-row";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "nasa-api-input";
    input.placeholder = "Paste key here (or leave blank for DEMO_KEY)";
    input.value = localStorage.getItem(NasaAdapter.API_KEY_STORAGE_KEY) || "";
    input.setAttribute("aria-label", "NASA API key");

    const saveBtn = document.createElement("button");
    saveBtn.className = "nasa-api-save";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
      const val = input.value.trim();
      if (val) {
        localStorage.setItem(NasaAdapter.API_KEY_STORAGE_KEY, val);
      } else {
        localStorage.removeItem(NasaAdapter.API_KEY_STORAGE_KEY);
      }
      saveBtn.textContent = "Saved!";
      setTimeout(() => { saveBtn.textContent = "Save"; }, 1500);
    });

    inputRow.appendChild(input);
    inputRow.appendChild(saveBtn);
    section.appendChild(inputRow);
    return section;
  }

  function _renderArxivTopics() {
    const adapter = ArxivAdapter;
    const enabledSet = new Set(adapter._getEnabledCategories());

    const section = document.createElement("div");
    section.className = "arxiv-topics";

    const heading = document.createElement("div");
    heading.className = "arxiv-topics-heading";
    heading.textContent = "arXiv topics";
    section.appendChild(heading);

    for (const topic of adapter.ALL_TOPICS) {
      const row = document.createElement("div");
      row.className = "source-row source-row--sub";

      const label = document.createElement("div");
      label.className = "source-label";
      label.textContent = topic.label;
      row.appendChild(label);

      const isOn = enabledSet.has(topic.key);
      const onlyOne = enabledSet.size === 1 && isOn;

      const btn = document.createElement("button");
      btn.className = "toggle" + (isOn ? " on" : "");
      btn.setAttribute("aria-label", `Toggle ${topic.label}`);
      btn.disabled = onlyOne;
      btn.addEventListener("click", () => {
        if (enabledSet.has(topic.key)) {
          if (enabledSet.size === 1) return;
          enabledSet.delete(topic.key);
        } else {
          enabledSet.add(topic.key);
        }
        try {
          localStorage.setItem(adapter.TOPICS_STORAGE_KEY, JSON.stringify([...enabledSet]));
        } catch (_) {}
        renderSettingsView();
      });
      row.appendChild(btn);
      section.appendChild(row);
    }
    return section;
  }

  // ---------- Lightbox ----------
  function openLightbox(url, alt) {
    lightboxImgEl.src = url;
    lightboxImgEl.alt = alt || "";
    lightboxEl.classList.add("open");
  }
  function closeLightbox() {
    lightboxEl.classList.remove("open");
    lightboxImgEl.src = "";
  }
  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  lightboxEl.addEventListener("click", (e) => {
    if (e.target === lightboxEl) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });

  // ---------- Refresh on return to this browser tab ----------
  let hiddenAt = null;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const wasAwayLongEnough = hiddenAt && Date.now() - hiddenAt > 5000; // ignore quick alt-tabs
    const onFeedTab = document.querySelector('.view[data-view="feed"]').classList.contains("active");
    if (wasAwayLongEnough && onFeedTab) {
      feed.loadInitial();
    }
    hiddenAt = null;
  });

  // ---------- Boot ----------
  // Resolve the on-device summarizer's availability first (a fast local
  // check) so the first rendered cards can already include summaries.
  SummaryManager.init().finally(() => feed.loadInitial());
})();
