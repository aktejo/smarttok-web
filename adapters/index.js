/**
 * Adapter registry.
 * This is the ONLY file that needs a new line when adding a source.
 * Everything else (Mixer, Settings, FeedManager) reads from this list.
 */
const ALL_ADAPTERS = [
  WikipediaAdapter,
  DogsAdapter,
  CatsAdapter,
  ArxivAdapter,
  PubMedAdapter,
  NasaAdapter,
  PoetryAdapter,
  // ComicsAdapter,     <- load adapters/comics.js + add here
  // GutenbergAdapter,  <- load adapters/gutenberg.js + add here
];

const ADAPTERS_BY_KEY = Object.fromEntries(
  ALL_ADAPTERS.map((a) => [a.sourceKey, a])
);
