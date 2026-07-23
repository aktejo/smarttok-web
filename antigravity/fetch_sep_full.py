import urllib.request
import re
import json

def scrape_sep():
    print("Fetching SEP...")
    url = "https://plato.stanford.edu/contents.html"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req).read().decode('utf-8')
    
    # We use (.*?) to capture everything inside the <a> tag, which might include <strong>
    matches = re.findall(r'<a href="entries/[^"]+">(.*?)</a>', html, flags=re.DOTALL)
    clean_matches = []
    
    for m in matches:
        # Strip any internal HTML tags (like <strong>)
        text = re.sub(r'<[^>]+>', '', m)
        # Clean up whitespace and entities
        text = text.replace('\n', ' ').replace('&amp;', '&').strip()
        if text and not text.startswith('Stanford Encyclopedia'):
            clean_matches.append(text)
            
    print(f"Found {len(clean_matches)} SEP topics via fixed regex.")
    return sorted(list(set(clean_matches)))

if __name__ == "__main__":
    sep_topics = scrape_sep()
    print(f"Unique SEP topics: {len(sep_topics)}")
    
    # Read the existing topics.js to get the ECON_TOPICS
    with open("antigravity/topics.js", "r") as f:
        content = f.read()
        
    # Extract the ECON_TOPICS array using regex or simple split since we wrote it
    # We wrote it as: const ECON_TOPICS = [ ... ];
    # Let's just find the ECON_TOPICS part
    econ_part = content[content.find("const ECON_TOPICS"):]
    
    # Write back to topics.js with the new massive SEP list and the existing ECON list
    with open("antigravity/topics.js", "w") as f:
        f.write("// Massive arrays fetched from Wikipedia Categories and SEP\n")
        f.write("const PHILOSOPHY_TOPICS = " + json.dumps(sep_topics, indent=2) + ";\n\n")
        f.write(econ_part)
        
    print("Updated antigravity/topics.js with full SEP list.")
