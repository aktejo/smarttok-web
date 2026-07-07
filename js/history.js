/**
 * HistoryManager
 * Persists every card the user has been shown, across sessions.
 * Two jobs:
 *   1. hasSeen(id) — lets FeedManager filter out repeats forever (not just this session)
 *   2. getRecent() — last 100 seen, newest first, for the History tab
 *
 * Stored as an array ordered oldest -> newest, capped at MAX_HISTORY.
 * A parallel Set gives O(1) hasSeen() lookups without re-scanning the array.
 */
class HistoryManager {
  static STORAGE_KEY = "smarttok.history";
  static MAX_HISTORY = 100;

  constructor() {
    this.entries = this._load(); // array of {content, seenAt}, oldest first
    this.seenIds = new Set(this.entries.map((e) => e.content.id));
    this._saveTimer = null;
    // Writes are debounced (record() fires on every card scrolled past, and
    // serializing 100 full items on the main thread mid-scroll causes jank),
    // so flush any pending write before the page can go away.
    addEventListener("pagehide", () => this.flush());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.flush();
    });
  }

  _load() {
    try {
      const raw = localStorage.getItem(HistoryManager.STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  /** Debounced: coalesces a burst of record() calls into one write. */
  _save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._write();
    }, 500);
  }

  _write() {
    localStorage.setItem(
      HistoryManager.STORAGE_KEY,
      JSON.stringify(this.entries)
    );
  }

  /** Write any pending changes now (page is hiding / data must not be lost). */
  flush() {
    if (!this._saveTimer) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this._write();
  }

  hasSeen(id) {
    return this.seenIds.has(id);
  }

  /** Record an item as seen. No-op if already recorded (keeps original seenAt position). */
  record(content) {
    if (this.seenIds.has(content.id)) return;
    this.entries.push({ content, seenAt: new Date().toISOString() });
    this.seenIds.add(content.id);

    // Trim from the front (oldest) once over the cap, keeping seenIds in sync.
    while (this.entries.length > HistoryManager.MAX_HISTORY) {
      const dropped = this.entries.shift();
      this.seenIds.delete(dropped.content.id);
    }
    this._save();
  }

  /** Last 100, newest first. */
  getRecent() {
    return [...this.entries].reverse();
  }

  clear() {
    this.entries = [];
    this.seenIds.clear();
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._write(); // user-initiated — persist immediately
  }
}
