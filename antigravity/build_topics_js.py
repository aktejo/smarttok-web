"""Build adapters/topics.js from validated.json — canonical, deduped,
Wikipedia-resolving titles only. Run from the project root after
validate_topics.py finishes:  python3 antigravity/build_topics_js.py
"""
import json

data = json.load(open("antigravity/validated.json"))
phil = sorted({e["title"] for e in data["philosophy"]})
econ = sorted({e["title"] for e in data["economics"]})

HEADER = """\
/**
 * Topic pools for the Philosophy and Economics adapters.
 *
 * GENERATED — don't hand-edit. Sources:
 *   PHILOSOPHY_TOPICS: Stanford Encyclopedia of Philosophy's entry index
 *   ECON_TOPICS:       Wikipedia's economics glossaries and outlines
 * Every title was validated against Wikipedia's REST summary endpoint
 * (real article, not a disambiguation page) and stored in canonical form,
 * so adapter fetches essentially never miss. Scraper + validator live in
 * the repo history under antigravity/ if the lists ever need a refresh.
 */
"""

with open("adapters/topics.js", "w") as f:
    f.write(HEADER)
    f.write("const PHILOSOPHY_TOPICS = " + json.dumps(phil, ensure_ascii=False) + ";\n\n")
    f.write("const ECON_TOPICS = " + json.dumps(econ, ensure_ascii=False) + ";\n")

print(f"philosophy: {len(phil)} topics, economics: {len(econ)} topics")
