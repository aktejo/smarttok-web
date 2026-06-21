/**
 * SettingsManager
 * Tracks which sources are enabled. Persists to localStorage
 * (the web equivalent of UserDefaults in the iOS version).
 */
class SettingsManager extends EventTarget {
  static STORAGE_KEY = "smarttok.enabledSources";

  constructor() {
    super();
    this.enabledSources = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(SettingsManager.STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        // Only keep keys that still correspond to a real adapter.
        const valid = arr.filter((k) => k in ADAPTERS_BY_KEY);
        if (valid.length > 0) return new Set(valid);
      }
    } catch (_) {
      /* fall through to default */
    }
    // Default: every registered adapter enabled.
    return new Set(ALL_ADAPTERS.map((a) => a.sourceKey));
  }

  _save() {
    localStorage.setItem(
      SettingsManager.STORAGE_KEY,
      JSON.stringify([...this.enabledSources])
    );
  }

  isEnabled(sourceKey) {
    return this.enabledSources.has(sourceKey);
  }

  toggle(sourceKey) {
    if (this.enabledSources.has(sourceKey)) {
      // Don't allow disabling the last remaining source.
      if (this.enabledSources.size === 1) return;
      this.enabledSources.delete(sourceKey);
    } else {
      this.enabledSources.add(sourceKey);
    }
    this._save();
    this.dispatchEvent(new CustomEvent("change", { detail: this.getEnabledKeys() }));
  }

  getEnabledKeys() {
    return [...this.enabledSources];
  }
}
