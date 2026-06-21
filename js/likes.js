/**
 * LikesManager
 * Persists liked items to localStorage (web equivalent of SwiftData).
 * Stores the full NormalizedContent so the Liked tab works offline
 * and survives the original feed item scrolling away.
 */
class LikesManager extends EventTarget {
  static STORAGE_KEY = "smarttok.likedItems";

  constructor() {
    super();
    this.items = this._load(); // Map<id, {content, likedAt}>
  }

  _load() {
    try {
      const raw = localStorage.getItem(LikesManager.STORAGE_KEY);
      if (!raw) return new Map();
      const arr = JSON.parse(raw);
      return new Map(arr.map((entry) => [entry.content.id, entry]));
    } catch (_) {
      return new Map();
    }
  }

  _save() {
    localStorage.setItem(
      LikesManager.STORAGE_KEY,
      JSON.stringify([...this.items.values()])
    );
  }

  isLiked(id) {
    return this.items.has(id);
  }

  toggle(content) {
    if (this.items.has(content.id)) {
      this.items.delete(content.id);
    } else {
      this.items.set(content.id, { content, likedAt: new Date().toISOString() });
    }
    this._save();
    this.dispatchEvent(new CustomEvent("change"));
  }

  getAllSortedNewestFirst() {
    return [...this.items.values()].sort(
      (a, b) => new Date(b.likedAt) - new Date(a.likedAt)
    );
  }
}
