"""One-time validation pass: resolve every topic against Wikipedia's REST
summary endpoint, keep only titles that land on a real (non-disambiguation)
article, and store the canonical title + pageid. Fixes the philosophy list's
~40% hit rate (SEP entry titles often don't exist on Wikipedia) and dedupes
topics that resolve to the same article.

Run from the project root:  python3 antigravity/validate_topics.py
Writes antigravity/validated.json with progress printed as it goes.
"""
import json
import re
import time
import urllib.parse
import urllib.request
import concurrent.futures as cf

SRC = "antigravity/topics.js"
OUT = "antigravity/validated.json"
UA = "SmartTok-topic-validation/1.0 (abhiramktejo@gmail.com; one-time cleanup)"
CONCURRENCY = 16  # the summary endpoint is CDN-cached; 429s are retried with backoff

src = open(SRC).read()
phil = json.loads(re.search(r"const PHILOSOPHY_TOPICS = (\[.*?\]);", src, re.S).group(1))
econ = json.loads(re.search(r"const ECON_TOPICS = (\[.*?\]);", src, re.S).group(1))


def questionable(t):
    """Same heuristic as clean_topics.py — the 222 user-reviewed flagged topics."""
    prefixes = ["List of", "Index of", "Outline of", "Glossary of",
                "Category:", "Wikipedia:", "Portal:", "Talk:", "Template:"]
    if any(t.startswith(x) for x in prefixes):
        return True
    return len(t.split()) > 5


def variants(t):
    """Query candidates for a topic: raw, bracket-stripped, and 'First Last'."""
    out = [t]
    stripped = re.sub(r"\s*\[[^\]]*\]", "", t)
    stripped = re.sub(r"\s+", " ", stripped).strip()
    if stripped != t:
        out.append(stripped)
    m = re.match(r"^([A-Z][^,]+), ([A-Z].*)$", stripped)
    if m and len(m.group(2).split()) <= 3:
        out.append(f"{m.group(2)} {m.group(1)}")
    return out


def fetch(title):
    url = ("https://en.wikipedia.org/api/rest_v1/page/summary/"
           + urllib.parse.quote(title, safe=""))
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429:
                time.sleep(1.5 * (attempt + 1))
                continue
            return None
        except Exception:
            time.sleep(0.5)
    return None


def resolve(topic):
    for cand in variants(topic):
        d = fetch(cand)
        if d and d.get("extract") and d.get("type") != "disambiguation":
            title = (d.get("titles") or {}).get("canonical") or d.get("title") or cand
            return {"topic": topic, "title": title.replace("_", " "),
                    "pageid": d.get("pageid")}
    return None


def validate(name, topics):
    topics = [t for t in topics if not questionable(t)]
    resolved, seen_pages = [], set()
    done = 0
    with cf.ThreadPoolExecutor(CONCURRENCY) as ex:
        for res in ex.map(resolve, topics):
            done += 1
            if done % 100 == 0:
                print(f"{name}: {done}/{len(topics)} checked, {len(resolved)} kept", flush=True)
            if not res:
                continue
            key = res["pageid"] or res["title"].lower()
            if key in seen_pages:
                continue
            seen_pages.add(key)
            resolved.append(res)
    print(f"{name}: DONE — {len(resolved)}/{len(topics)} topics validated", flush=True)
    return resolved


out = {
    "philosophy": validate("philosophy", phil),
    "economics": validate("economics", econ),
}
with open(OUT, "w") as f:
    json.dump(out, f, indent=1)
print("wrote", OUT, flush=True)
