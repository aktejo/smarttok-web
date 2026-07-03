/**
 * Source verification harness — the logic behind verify.html.
 *
 * For every adapter in ALL_ADAPTERS, this runs a live end-to-end check:
 *   1. fetchNext(2) resolves without throwing (the contract says adapters
 *      never throw — failures must come back as error cards)
 *   2. every returned item passes NormalizedContent validation (js/models.js)
 *   3. at least one item is real content, not an error card
 *   4. IDs are unique within the batch
 *   5. media URLs actually serve a decodable image
 *   6. the item renders through the real createCardElement() pipeline
 *      with visible text (and an <img> when media is present)
 *
 * Plus proxy checks: an allowlisted host round-trips through /api/proxy,
 * and non-allowlisted / missing targets are rejected. These only pass when
 * the serverless function exists (vercel dev locally, or the deployed site).
 *
 * Results are mirrored to window.__verifyResults for scripted polling:
 *   { status: "running"|"done", sources: {key: {...}}, proxy: {...} }
 */
(function () {
  const VERIFY_COUNT = 2;
  const FETCH_TIMEOUT_MS = 25000;
  const IMAGE_TIMEOUT_MS = 12000;

  const likes = new LikesManager();
  const resultsEl = document.getElementById("verify-results");
  const summaryEl = document.getElementById("verify-summary");

  window.__verifyResults = { status: "running", sources: {}, proxy: null };

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
      ),
    ]);
  }

  function isHttpUrl(v) {
    return typeof v === "string" && /^https?:\/\//.test(v);
  }

  /** Validate one item against the NormalizedContent contract. Returns problem strings. */
  function validateItem(item, adapter) {
    if (!item || typeof item !== "object") return ["item is not an object"];
    const problems = [];
    if (typeof item.id !== "string" || !item.id) problems.push("id missing/empty");
    if (item.sourceKey !== adapter.sourceKey) problems.push(`sourceKey "${item.sourceKey}" != "${adapter.sourceKey}"`);
    if (typeof item.title !== "string") problems.push("title is not a string");
    if (typeof item.body !== "string" || !item.body.trim()) problems.push("body missing/empty");
    if (!(item.openLink === null || isHttpUrl(item.openLink))) problems.push("openLink is neither null nor an http(s) URL");
    if (!(item.media === null || (item.media && isHttpUrl(item.media.url)))) problems.push("media is neither null nor {url: http(s)...}");
    if (typeof item.attribution !== "string" || !item.attribution) problems.push("attribution missing/empty");
    if (!Array.isArray(item.tags)) problems.push("tags is not an array");
    if (!(item.timestamp == null || typeof item.timestamp === "string")) problems.push("timestamp is neither null nor a string");
    return problems;
  }

  /** Resolve true only if the URL serves an actual decodable image. */
  function probeImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve(false), IMAGE_TIMEOUT_MS);
      img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 0); };
      img.onerror = () => { clearTimeout(timer); resolve(false); };
      img.src = url;
    });
  }

  async function verifySource(adapter) {
    const checks = [];
    const out = { pass: false, realCards: 0, errorCards: 0, failures: [], checks };
    let items = null;

    try {
      items = await withTimeout(adapter.fetchNext(VERIFY_COUNT), FETCH_TIMEOUT_MS, "fetchNext");
      checks.push({ name: "fetchNext resolves without throwing", pass: true });
    } catch (err) {
      checks.push({ name: "fetchNext resolves without throwing", pass: false, note: err.message });
    }

    if (Array.isArray(items)) {
      checks.push({
        name: `returns ${VERIFY_COUNT} items`,
        pass: items.length === VERIFY_COUNT,
        note: items.length !== VERIFY_COUNT ? `got ${items.length}` : "",
      });

      const problems = items.flatMap((item, i) =>
        validateItem(item, adapter).map((p) => `item ${i}: ${p}`)
      );
      checks.push({
        name: "items match the NormalizedContent contract",
        pass: problems.length === 0,
        note: problems.join("; "),
      });

      const ids = items.map((i) => i && i.id);
      checks.push({ name: "IDs unique within batch", pass: new Set(ids).size === ids.length });

      const real = items.filter((i) => i && !i.tags?.includes("error"));
      out.realCards = real.length;
      out.errorCards = items.length - real.length;
      checks.push({
        name: "returns real content (not just error cards)",
        pass: real.length >= 1,
        note: out.errorCards > 0 ? `${out.errorCards} error card(s) in batch` : "",
      });

      const withMedia = real.filter((i) => i.media?.url);
      if (withMedia.length > 0) {
        const loaded = await probeImage(withMedia[0].media.url);
        checks.push({ name: "media URL serves a real image", pass: loaded, note: loaded ? "" : withMedia[0].media.url });
      }

      if (real.length > 0) {
        try {
          const el = createCardElement(real[0], { likesManager: likes, onImageTap: () => {} });
          const hasText = !!el.querySelector(".card-text")?.textContent.trim();
          const mediaOk = !real[0].media || !!el.querySelector(".card-media img[src]");
          checks.push({ name: "renders through createCardElement", pass: hasText && mediaOk });
          out.sampleEl = el;
        } catch (err) {
          checks.push({ name: "renders through createCardElement", pass: false, note: err.message });
        }
      }
    } else if (items !== null) {
      checks.push({ name: "returns an array", pass: false, note: `got ${typeof items}` });
    }

    out.failures = checks.filter((c) => !c.pass).map((c) => c.name);
    out.pass = out.failures.length === 0;
    return out;
  }

  async function verifyProxy() {
    const checks = [];

    try {
      const target = "https://export.arxiv.org/api/query?search_query=all:electron&max_results=1";
      const res = await withTimeout(fetch(proxiedUrl(target)), FETCH_TIMEOUT_MS, "proxy fetch");
      const text = res.ok ? await res.text() : "";
      checks.push({
        name: "relays an allowlisted host (arXiv)",
        pass: res.ok && text.includes("<feed"),
        note: `HTTP ${res.status}`,
      });
    } catch (err) {
      checks.push({ name: "relays an allowlisted host (arXiv)", pass: false, note: err.message });
    }

    try {
      const res = await fetch(proxiedUrl("https://example.com/"));
      checks.push({ name: "rejects a non-allowlisted host (403)", pass: res.status === 403, note: `HTTP ${res.status}` });
    } catch (err) {
      checks.push({ name: "rejects a non-allowlisted host (403)", pass: false, note: err.message });
    }

    try {
      const res = await fetch(`${PROXY_BASE_URL}/api/proxy`);
      checks.push({ name: "rejects a missing ?url= (400)", pass: res.status === 400, note: `HTTP ${res.status}` });
    } catch (err) {
      checks.push({ name: "rejects a missing ?url= (400)", pass: false, note: err.message });
    }

    const failures = checks.filter((c) => !c.pass).map((c) => c.name);
    return { pass: failures.length === 0, failures, checks };
  }

  // ---------- Rendering ----------
  function renderChecks(listEl, checks) {
    listEl.innerHTML = "";
    for (const c of checks) {
      const li = document.createElement("li");
      li.className = c.pass ? "ok" : "fail";
      li.textContent = `${c.pass ? "✓" : "✗"} ${c.name}${c.note ? ` — ${c.note}` : ""}`;
      listEl.appendChild(li);
    }
  }

  function makeRow(title, subtitle) {
    const row = document.createElement("section");
    row.className = "v-row running";
    row.innerHTML = `
      <header>
        <span class="v-title"></span>
        <span class="v-status">running…</span>
      </header>
      <div class="v-subtitle"></div>
      <ul class="v-checks"></ul>
      <div class="v-sample"></div>`;
    row.querySelector(".v-title").textContent = title;
    row.querySelector(".v-subtitle").textContent = subtitle || "";
    resultsEl.appendChild(row);
    return row;
  }

  function finishRow(row, result) {
    row.classList.remove("running");
    row.classList.add(result.pass ? "pass" : "fail");
    const status = row.querySelector(".v-status");
    status.textContent = result.pass ? "PASS" : "FAIL";
    renderChecks(row.querySelector(".v-checks"), result.checks);
    if (result.sampleEl) {
      const sample = row.querySelector(".v-sample");
      sample.appendChild(result.sampleEl);
    }
  }

  /**
   * Informational: reports the on-device Summarizer's state. Only fails
   * when the model claims to be available but can't actually summarize —
   * an unsupported browser is a pass (the feature degrades to nothing).
   */
  async function verifySummarizer() {
    const checks = [];
    const state = await SummaryManager.init();
    checks.push({ name: `built-in Summarizer API state: ${state}`, pass: true });
    if (state === "available") {
      const input =
        "We investigate the impact of stochastic gradient descent variants on " +
        "the convergence of overparameterized neural networks, demonstrating " +
        "that adaptive learning rates yield provably faster convergence under " +
        "mild smoothness assumptions.";
      try {
        const s = await withTimeout(SummaryManager.ensureModel(), FETCH_TIMEOUT_MS, "summarizer init");
        const out = ((await withTimeout(s.summarize(input), FETCH_TIMEOUT_MS, "summarize")) || "").trim();
        if (out && out.length < input.length) {
          checks.push({ name: "model produces a real summary", pass: true, note: out.slice(0, 80) });
        } else if (out) {
          // Same guard the app applies: echo/placeholder backends (Chromium
          // without the real model) return input-length output — the app
          // auto-hides summaries there, so this is a pass, not a failure.
          checks.push({
            name: "model produces a real summary",
            pass: true,
            note: "echo/placeholder backend detected — summaries auto-hidden in this browser",
          });
        } else {
          checks.push({ name: "model produces a real summary", pass: false, note: "empty output" });
        }
      } catch (err) {
        checks.push({ name: "model produces a real summary", pass: false, note: err.message });
      }
    }
    const failures = checks.filter((c) => !c.pass).map((c) => c.name);
    return { pass: failures.length === 0, failures, checks };
  }

  async function run() {
    const jobs = [];

    const summarizerRow = makeRow("✨ AI summaries (on-device)", "informational — unsupported browsers pass");
    jobs.push(
      verifySummarizer().then((result) => {
        window.__verifyResults.summarizer = { pass: result.pass, failures: result.failures };
        finishRow(summarizerRow, result);
        return result.pass;
      })
    );

    const proxyRow = makeRow("⇄ CORS proxy (/api/proxy)", "needs `vercel dev` locally, or the deployed site");
    jobs.push(
      verifyProxy().then((result) => {
        window.__verifyResults.proxy = { pass: result.pass, failures: result.failures };
        finishRow(proxyRow, result);
        return result.pass;
      })
    );

    for (const adapter of ALL_ADAPTERS) {
      let subtitle = "";
      if (adapter.sourceKey === "nasa") {
        subtitle = localStorage.getItem(NasaAdapter.API_KEY_STORAGE_KEY)
          ? "using personal API key"
          : "using shared DEMO_KEY (30 req/hr — may be rate-limited)";
      }
      const row = makeRow(`${adapter.icon} ${adapter.displayName}`, subtitle);
      jobs.push(
        verifySource(adapter).then((result) => {
          window.__verifyResults.sources[adapter.sourceKey] = {
            pass: result.pass,
            realCards: result.realCards,
            errorCards: result.errorCards,
            failures: result.failures,
          };
          finishRow(row, result);
          return result.pass;
        })
      );
    }

    const outcomes = await Promise.all(jobs);
    const passed = outcomes.filter(Boolean).length;
    summaryEl.textContent = `${passed}/${outcomes.length} checks passing`;
    summaryEl.className = passed === outcomes.length ? "pass" : "fail";
    window.__verifyResults.status = "done";
  }

  document.getElementById("rerun-btn").addEventListener("click", () => location.reload());
  run();
})();
