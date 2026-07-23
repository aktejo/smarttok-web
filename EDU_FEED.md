# Educational Depth Feed — decisions & plan

Decision record from the 2026-07-22 planning session (branch `edu-depth-feed`),
plus the Phase 2 roadmap. The goal: substantive educational content
(philosophy, ethics, politics, economics, biology, neuroscience) ranked by a
local, non-ML algorithm that learns what the user actually reads. Bar:
undergraduate survey course, not Reddit TIL.

## Constraints

- Zero recurring cost, no paid APIs
- Algorithm runs client-side; no data leaves the device
- Plain HTML/CSS/JS, no build step
- CC-licensed / public-domain sources only, attribution preserved

## Decisions (user Q&A)

| Question | Decision |
|---|---|
| Architecture | Integrate into SmartTok as adapters; extend mixing with affinity scoring — not a standalone page |
| Article pool | Fetch live at runtime, no build-time pool.json (deviates from the original brief) |
| Card format | Single card per article, like existing adapters — not a multi-card sequence |
| Signals | All four: dwell time, read-more taps, saves, skip velocity |
| Algorithm scope | Whole feed eventually, but rolled out source-by-source with per-source category mapping |
| Anti-narrowing | Both novelty penalty and ~18% exploration floor |
| Profile export/import | Skipped; profile lives in localStorage only |
| Old philosophy/economics adapters | Superseded and unwired (files kept for Phase 2 reference) |
| Target pages | Both index.html and redesign.html (+ verify.html) |

> **Taxonomy note:** Phase 1 originally used a fixed six-category vector.
> That was replaced by **open fine-grained tags** — see
> "Taxonomy v2" below, which supersedes the six-slug description here.

## Phase 1 implementation (this branch)

- **`js/affinity.js` — AffinityManager**: localStorage profile
  (`smarttok.affinity`) holding an affinity vector, a recent-shown window
  (novelty penalty), and recently-engaged titles (proximity seeds). Signal
  weights: save +4, open +3 (the depth signal — replaces the brief's
  sequence-completion), long dwell +1.5, short dwell +0.5, sub-1.2s skip
  −0.75. All weights decay 1% per signal so old interests fade. `rank()`
  reserves ~18% of slots for random picks. (Vector is now keyed by open
  fine-grained tags, not six slugs — see Taxonomy v2.)
- **`adapters/wikiedu.js` — "Deep Dives"**: pool comes from WikiProject
  assessment categories (e.g. `Category:GA-Class Philosophy articles`,
  12 categories, ~2,200 articles) — precise topical + quality tagging, unlike
  keyword search which matches any article merely mentioning a term. Members
  are Talk: pages (strip prefix). Pool cached in localStorage 7 days
  (~15 requests weekly, then one batched extract query per fetch). Graph
  proximity via `morelike:` search intersected with the pool (the REST
  `page/related` endpoint is deprecated). Scoring: affinity + tier bonus
  (FA 1.5 / GA 0.75) + proximity bonus (2.0) − novelty penalty.
- **Opt-in contract for whole-feed rollout**: any adapter that sets
  `topics: [...]` (fine-grained tags via `AffinityManager.cleanTopics`) on its
  NormalizedContent items joins the algorithm. Sources without topics are
  untouched. No mapping table needed — see Taxonomy v2.
- **Signal plumbing**: dwell observers in app.js / redesign-app.js
  (60% threshold, enter/exit timing, pagehide flush); saves recorded inside
  `LikesManager.toggle` (covers both UIs, heart buttons and double-tap);
  open taps on the card-view "Open original" button and the redesign rail
  open button.

Wikipedia API notes (verified 2026-07-22): all endpoints used support CORS
via `origin=*`; burst requests get 429s, so the pool build runs in chunks
of 4; quality-class category names have inconsistent casing per WikiProject
(exact names are in `CATEGORY_SOURCES`).

**Done when** (from the brief): affinity visibly shifts within ~20
interactions; feed doesn't collapse to one topic; works offline after first
load (pool is cached; extracts are not — offline shows other cached sources).

## Taxonomy v2 — open fine-grained tags (2026-07-23)

Replaced the fixed six-category vector (the user's words: "very dumb"). Three
problems it had: too coarse (Metaphysics, Logic, Aesthetics all collapsed to
"philosophy"), closed (chemistry/history had nowhere to go), and manual (every
source needed a hand-written mapping table onto the six).

New model — **open vocabulary of fine-grained tags**:

- The affinity vector is an open `tag → weight` map that grows as new topics
  appear; no fixed list. Each item carries its OWN real categories as `topics`
  (Wikipedia article categories via `prop=categories&clshow=!hidden`;
  WordPress essay category names). No per-source mapping table.
- **Fetching vs. learning decoupled**: an adapter can only *query* buckets its
  API supports, so it biases fetches toward whichever of its buckets your tags
  favour (`AffinityManager.chooseBucket` + `bucketScore`, backed by a
  `bucketIndex` that records which fine tags each bucket yields) — but it
  *tags* results with real fine topics, so learning stays granular and
  transfers across sources wherever tags overlap.
- **Central normalization** in `AffinityManager.cleanTopics` /
  `_normalizeTag`: lowercase; strip `Category:`, quality-class prefixes, and
  **leading nationality/era demonyms** (`_DEMONYMS` — so "american economists"
  and "british economists" both aggregate as "economists"); a small `_ALIASES`
  table for cross-source synonyms ("social and political philosophy" →
  "political philosophy"). Junk filter (`_isJunk` + `_JUNK_PATTERNS`) drops
  Wikipedia maintenance/date/biographical-origin/event noise.
- **Scoring is max-pooled**: `score()` = 0.5·mean + 0.5·max of topic weights −
  novelty + bonus, so a candidate ranks high if ANY topic is one you love — a
  noisy article carrying one great topic among trivia tags isn't buried.
- **Bounded**: vector pruned to `MAX_TAGS` (weakest |weight| dropped);
  `MAX_TOPICS_PER_ITEM` caps per-item tags; per-bucket link index capped too.
- localStorage key unchanged (`smarttok.affinity`); old six-slug profiles are
  forward-compatible (the slugs just become six coarse tags).

**Known limitation (not a tag bug):** the wikiedu *pool* is broad — WikiProject
quality categories include biographies, historical events, even a stray
Simpsons episode. Tags are now extracted cleanly, but some pool articles just
aren't "survey-course concept" material. Tightening the pool (prefer
concept articles, filter person/event pages) is a separate follow-up; the
open-tag model plus max-pooling/decay/pruning keep the resulting noise
self-limiting in the meantime.

## Feed UI additions (2026-07-23)

Three changes to the redesign UI + card renderers:

- **Removed the frequency dropdown** from the redesign Sources page — it was a
  concept mock never wired to the mixer. How often a source appears is meant to
  be algorithmic; the dropdown implied manual control that didn't exist.
- **Preferences viewer** on the redesign Sources page ("What the feed has
  learned"): renders the open-tag affinity vector as weighted bars —
  `AffinityManager.learnedTopics()`, split into liked topics and a "Tends to
  skip" (negative-weight) section. Shown feed-wide, not per source, because the
  taxonomy is one shared vocabulary. Cold-start empty state included.
- **"Did you know?" fact box** on Deep Dive (wikiedu) cards, both UIs
  (`.card-fact` / `.rd-fact`). `WikiEduAdapter.surprisingFact(content)` lazily
  fetches the full article plaintext (NB: `exchars`/`exsentences` return the
  lead only — must fetch full), strips `== headings ==`, and picks the most
  "surprising" early-body sentence by heuristic: rewards surprise markers /
  etymology / numbers; rejects intro dupes, pronoun-led and fragment sentences
  (lowercase-start, initial-truncated), clause-dense sentences, and
  biographical CV lines (received/graduated/elected/…). Cached per card;
  resolves null (no box) when nothing clears the bar. No LLM. Concept articles
  give excellent facts (Cerebellum, Photosynthesis, Black hole); person-article
  facts are weaker — another symptom of the broad pool, self-limited by the
  CV filter.

## Phase 2 — more sources (only after Phase 1 ranking feels good)

Adapter per source behind the same contract, then per-source quotas so the
highest-volume source doesn't dominate. **Critical:** normalize every
source's taxonomy onto the Phase 1 canonical category slugs via an explicit
mapping table — if categories fragment across sources, the affinity vector
stops working.

Build order:
1. **OpenStax** (Biology 2e, Principles of Economics, American Government,
   Intro to Political Science) — CC BY, diagram-rich, sections map cleanly to
   cards. Process the books once into a static manifest rather than scraping
   at runtime. Check current terms re: AI/LLM use. *(Not built yet. Probed
   2026-07: the CMS API — `openstax.org/apps/cms/api/v2/pages/` — is
   CORS-friendly and lists all four target books; content is reachable for a
   manifest build.)*
2. **1000-Word Philosophy** — ✅ **DONE** (`adapters/wordphil.js`, source #11,
   built 2026-07-23, ahead of OpenStax at user request). WordPress REST API
   (`1000wordphilosophy.com/wp-json/wp/v2`), CORS-friendly, ~229 essays,
   fetched live at runtime (not a static manifest — the API is reliable and
   the pool is small). Card body is the essay's own text with the
   "Author / Categories / Word Count" masthead stripped (its field order and
   word-count label vary essay to essay — strip up through the word-count
   number, guarded by an Author/Categories label). **Taxonomy (v2, open
   tags):** no mapping table — each essay is tagged with its real WordPress
   category names (fetched once, cached 7 days), normalized via
   `AffinityManager.cleanTopics`. Fetch bias uses `chooseBucket` over the WP
   categories. CC BY-NC — satisfied by SmartTok being personal &
   non-commercial; attribution preserved via source label + openLink.
3. **LibreTexts** — fills gaps; licensing varies per text, check individually.
4. **SEP** — summary sections only, link out for the rest. Reuse terms are
   not blanket CC; check first. (The unwired `adapters/philosophy.js` /
   `adapters/economics.js` + `antigravity/` scripts are prior art here.)
5. **CRS reports** — public domain, great content, worst format fit. Lowest
   priority.

**Political content guardrail:** institutional and theoretical only —
electoral systems, separation of powers, federalism, political philosophy.
No news, blogs, or commentary feeds. An engagement-optimizing algorithm
pointed at contested political commentary is a bad combination.

## Prior art

- `rebane2001/xikipedia` — non-ML local algorithm over Simple Wikipedia
  (closest reference for the scoring approach)
- `IsaacGemal/wikitok` — deliberately non-algorithmic; UI patterns only
