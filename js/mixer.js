/**
 * Mixer
 * Fairly distributes fetch requests across enabled sources.
 * Mirrors the iOS Mixer: tracks a running count per source and always
 * pulls from the currently most-underrepresented source(s) next.
 */
class Mixer {
  constructor(enabledKeys) {
    this.counts = {}; // sourceKey -> number of items fetched so far
    this.setEnabled(enabledKeys);
  }

  setEnabled(enabledKeys) {
    this.enabledKeys = [...enabledKeys];
    for (const key of this.enabledKeys) {
      if (!(key in this.counts)) this.counts[key] = 0;
    }
  }

  /**
   * Returns an ordered list of `n` source keys to fetch from,
   * always preferring the least-represented source so far (round-robin).
   */
  pickSources(n) {
    if (this.enabledKeys.length === 0) return [];
    const picks = [];
    // Work on a local copy of counts so a single pickSources() call
    // distributes evenly even before fetches resolve.
    const localCounts = { ...this.counts };

    for (let i = 0; i < n; i++) {
      const next = this.enabledKeys.reduce((min, key) =>
        localCounts[key] < localCounts[min] ? key : min
      , this.enabledKeys[0]);
      picks.push(next);
      localCounts[next] += 1;
    }
    return picks;
  }

  /** Call once a fetch for `sourceKey` actually completes. */
  recordFetch(sourceKey) {
    this.counts[sourceKey] = (this.counts[sourceKey] || 0) + 1;
  }

  reset() {
    this.counts = {};
    for (const key of this.enabledKeys) this.counts[key] = 0;
  }
}
