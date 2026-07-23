import urllib.request
import re
import json

def scrape_sep():
    print("Fetching SEP...")
    url = "https://plato.stanford.edu/contents.html"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req).read().decode('utf-8')
    
    # SEP has entries like <li><a href="entries/abduction/">abduction</a> (Igor Douven)</li>
    # Let's find all href="entries/..."
    matches = re.findall(r'<a href="entries/[^"]+">([^<]+)</a>', html)
    clean_matches = []
    for m in matches:
        m = m.replace('\n', ' ').replace('&amp;', '&').strip()
        if m and not m.startswith('Stanford Encyclopedia'):
            clean_matches.append(m)
            
    print(f"Found {len(clean_matches)} SEP topics via regex.")
    
    # Let's see if there is another format.
    # Actually, the entire list is in an unordered list. 
    # Are there ~1800 matches?
    return sorted(list(set(clean_matches)))

if __name__ == "__main__":
    sep_topics = scrape_sep()
    print(f"Unique SEP topics: {len(sep_topics)}")
    
    # We will just write this to a temporary json to see
    with open("antigravity/sep_test.json", "w") as f:
        json.dump(sep_topics, f, indent=2)
