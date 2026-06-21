/**
 * Adapter protocol.
 *
 * Every source adapter is a plain object with this shape:
 *
 *   {
 *     sourceKey: "wikipedia",        // unique string id, matches NormalizedContent.sourceKey
 *     displayName: "Wikipedia",      // shown in Settings
 *     icon: "📖",                    // shown in Settings (emoji keeps this dependency-free)
 *     async fetchNext(count) {       // returns Promise<NormalizedContent[]>
 *       // 1. Call the source's public API
 *       // 2. Normalize each raw item into NormalizedContent (see models.js)
 *       // 3. On any failure, return [makeErrorContent(...)] — never throw
 *     }
 *   }
 *
 * That's the whole contract. The Mixer and FeedManager only ever call
 * `fetchNext(count)` and only ever read NormalizedContent fields.
 * No adapter should be imported anywhere outside adapters/index.js.
 *
 * To add a new source:
 *   1. Create adapters/yoursource.js exporting an object matching this shape
 *   2. Add one line to adapters/index.js
 *   That's it — Settings, Mixer, and the feed pick it up automatically.
 */
