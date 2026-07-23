/**
 * CardView
 * Renders a single NormalizedContent item as a DOM node.
 * Display rule (matches iOS): only title + body render as content.
 * Everything else powers actions (like, open, fullscreen image).
 */
function createCardElement(content, { likesManager, onImageTap, eagerImage = false }) {
  const card = document.createElement("article");
  card.className = "card" + (content.tags?.includes("error") ? " is-error" : "");
  card.dataset.id = content.id;

  const sourceMeta = ADAPTERS_BY_KEY[content.sourceKey];
  const icon = sourceMeta?.icon || "•";

  const stamp = document.createElement("div");
  stamp.className = "card-stamp";
  stamp.innerHTML = `<span class="stamp-icon">${icon}</span><span>${escapeHtml(content.attribution)}</span>`;
  card.appendChild(stamp);

  if (content.media?.url) {
    const mediaWrap = document.createElement("div");
    mediaWrap.className = "card-media";
    const img = document.createElement("img");
    img.src = content.media.url;
    img.alt = content.media.alt || "";
    // Above-the-fold images (the feed's first cards) fetch at full priority;
    // everything below stays lazy.
    img.loading = eagerImage ? "eager" : "lazy";
    if (eagerImage) img.fetchPriority = "high";
    img.decoding = "async";
    mediaWrap.appendChild(img);
    mediaWrap.addEventListener("click", () => onImageTap(content.media.url, content.media.alt));
    card.appendChild(mediaWrap);
  }

  const body = document.createElement("div");
  body.className = "card-body";

  if (content.title) {
    const title = document.createElement("h2");
    title.className = "card-title";
    title.textContent = content.title;
    body.appendChild(title);
  }

  // Plain-English AI one-liner between title and body, for sources that
  // opt in (adapter.simplify) — no-op unless the on-device model is ready.
  if (
    typeof SummaryManager !== "undefined" &&
    sourceMeta?.simplify &&
    !content.tags?.includes("error")
  ) {
    SummaryManager.attach(body, content);
  }

  const text = document.createElement("div");
  text.className = "card-text";
  text.innerHTML = renderMarkdownBody(content.body);
  body.appendChild(text);

  // "Did you know?" box for Deep Dives (wikiedu) — lazily fetched, appended
  // only when a surprising fact is found so there's no empty-box flash.
  if (
    content.sourceKey === "wikiedu" &&
    !content.tags?.includes("error") &&
    typeof WikiEduAdapter !== "undefined"
  ) {
    WikiEduAdapter.surprisingFact(content)
      .then((f) => {
        if (!f) return;
        const fact = document.createElement("div");
        fact.className = "card-fact";
        fact.innerHTML = `<span class="card-fact-label">Did you know?</span>`;
        const txt = document.createElement("span");
        txt.className = "card-fact-text";
        txt.textContent = f;
        fact.appendChild(txt);
        body.appendChild(fact);
      })
      .catch(() => {});
  }

  card.appendChild(body);

  // Action row — skip for error cards (nothing to like/open).
  if (!content.tags?.includes("error")) {
    const actions = document.createElement("div");
    actions.className = "card-actions";

    const left = document.createElement("div");
    left.className = "card-actions-left";

    const likeBtn = document.createElement("button");
    likeBtn.className = "action-btn" + (likesManager.isLiked(content.id) ? " liked" : "");
    likeBtn.innerHTML = `<span class="like-icon">${likesManager.isLiked(content.id) ? "♥" : "♡"}</span> Save`;
    likeBtn.addEventListener("click", () => {
      likesManager.toggle(content);
      const nowLiked = likesManager.isLiked(content.id);
      likeBtn.classList.toggle("liked", nowLiked);
      likeBtn.querySelector(".like-icon").textContent = nowLiked ? "♥" : "♡";
    });
    left.appendChild(likeBtn);
    actions.appendChild(left);

    if (content.openLink) {
      const openBtn = document.createElement("a");
      openBtn.className = "action-btn";
      openBtn.href = content.openLink;
      openBtn.target = "_blank";
      openBtn.rel = "noopener noreferrer";
      openBtn.innerHTML = `Open original ↗`;
      openBtn.addEventListener("click", () => {
        // Reading the full article is the depth signal for the edu feed.
        if (typeof AffinityManager !== "undefined") AffinityManager.recordOpen(content);
      });
      actions.appendChild(openBtn);
    }

    card.appendChild(actions);
  }

  return card;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
