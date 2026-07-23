/**
 * NormalizedContent contract.
 * Every adapter must return items shaped exactly like this.
 * The feed/UI layer only ever reads these fields — it never knows
 * anything about where the content came from.
 *
 * @typedef {Object} NormalizedContent
 * @property {string} id            - Stable unique ID, e.g. "wikipedia-12345"
 * @property {string} sourceKey     - e.g. "wikipedia"
 * @property {string} title         - May be empty string
 * @property {string} body          - Plain text or simple markdown (**bold**, *italic*, [text](url))
 * @property {string|null} openLink - "View original" action target
 * @property {{url: string, alt: string}|null} media - Optional image
 * @property {string} attribution   - Short source label shown on card, e.g. "Wikipedia"
 * @property {string[]} tags        - Optional categories
 * @property {string|null} timestamp- ISO string
 * @property {string[]} topics      - Fine-grained, normalized topic tags (via
 *                                    AffinityManager.cleanTopics). Open vocabulary,
 *                                    not a fixed list. Empty = source hasn't opted
 *                                    into interest learning.
 */

/** Build a NormalizedContent object with sane defaults. */
function makeContent({
  id,
  sourceKey,
  title = "",
  body = "",
  openLink = null,
  media = null,
  attribution,
  tags = [],
  timestamp = null,
  topics = [],
}) {
  return { id, sourceKey, title, body, openLink, media, attribution, tags, timestamp, topics };
}

/** Build a friendly error card so a failing source never crashes the feed. */
function makeErrorContent(sourceKey, attribution, message) {
  return makeContent({
    id: `${sourceKey}-error-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sourceKey,
    title: "Couldn't load this one",
    body: message || `${attribution} didn't respond. Pull to refresh to try again.`,
    attribution,
    tags: ["error"],
  });
}
