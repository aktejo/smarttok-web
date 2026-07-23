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
    const liked = !this.items.has(content.id);
    if (liked) {
      this.items.set(content.id, { content, likedAt: new Date().toISOString() });
    } else {
      this.items.delete(content.id);
    }
    this._save();
    // Saves are the strongest interest signal for the educational feed.
    if (typeof AffinityManager !== "undefined") {
      AffinityManager.recordSave(content, liked);
    }
    this.dispatchEvent(new CustomEvent("change", { detail: { content, liked } }));
  }

  getAllSortedNewestFirst() {
    return [...this.items.values()].sort(
      (a, b) => new Date(b.likedAt) - new Date(a.likedAt)
    );
  }
}
