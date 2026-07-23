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

## Phase 1 implementation (this branch)

- **`js/affinity.js` — AffinityManager**: localStorage profile
  (`smarttok.affinity`) holding a category affinity vector over the six
  canonical slugs, a recent-shown window (novelty penalty), and
  recently-engaged titles (proximity seeds). Signal weights: save +4,
  open +3 (the depth signal — replaces the brief's sequence-completion),
  long dwell +1.5, short dwell +0.5, sub-1.2s skip −0.75. All weights decay
  1% per signal so old interests fade. `rank()` reserves ~18% of slots for
  random picks.
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
  `categories: [...]` (canonical slugs) on its NormalizedContent items joins
  the algorithm. Sources without categories are untouched. To roll out a
  source: add a mapping from its native taxonomy to the canonical slugs.
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
   the pool is small). Affinity-aware: filters to ethics/politics WP
   categories when the profile favours them, unfiltered otherwise. Card body
   is the essay's own text with the "Author / Categories / Word Count"
   masthead stripped (its field order and word-count label vary essay to
   essay — strip up through the word-count number, guarded by an
   Author/Categories label). **Taxonomy map** (WP category → canonical slug),
   in `WordPhilAdapter.CATEGORY_MAP`: Ethics / bioethics / Race / Sex & Gender
   → `ethics`; Social & Political / Philosophy of Law → `politics`; everything
   else → `philosophy`. CC BY-NC — satisfied by SmartTok being personal &
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
