import urllib.request
import urllib.parse
import json

def fetch_all_links(page_title):
    print(f"Fetching links for {page_title}...")
    links = set()
    url = f"https://en.wikipedia.org/w/api.php?action=query&titles={urllib.parse.quote(page_title)}&prop=links&plnamespace=0&pllimit=max&format=json"
    
    while url:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        try:
            response = urllib.request.urlopen(req).read().decode('utf-8')
            data = json.loads(response)
            
            pages = data['query']['pages']
            for page_id in pages:
                if 'links' in pages[page_id]:
                    for link in pages[page_id]['links']:
                        title = link['title']
                        if not title.startswith('List of') and not title.startswith('Index of'):
                            links.add(title)
            
            if 'continue' in data and 'plcontinue' in data['continue']:
                plcontinue = data['continue']['plcontinue']
                url = f"https://en.wikipedia.org/w/api.php?action=query&titles={urllib.parse.quote(page_title)}&prop=links&plnamespace=0&pllimit=max&plcontinue={urllib.parse.quote(plcontinue)}&format=json"
            else:
                url = None
        except Exception as e:
            print(f"Error fetching links for {page_title}: {e}")
            break
            
    print(f"Found {len(links)} links for {page_title}.")
    return links

if __name__ == "__main__":
    econ_topics = set()
    econ_topics.update(fetch_all_links("Glossary of economics"))
    econ_topics.update(fetch_all_links("Outline of economics"))
    
    # "Index of economics articles" is split alphabetically. Let's fetch the main ones if they exist, or just use the Glossary and Outline.
    # Let's try to fetch links from the alphabetic index pages too.
    import string
    for letter in string.ascii_uppercase:
        econ_topics.update(fetch_all_links(f"Index of economics articles ({letter})"))

    print(f"Total unique Economics topics: {len(econ_topics)}")
    
    # Write back to topics.js
    with open("antigravity/topics.js", "r") as f:
        content = f.read()
        
    phil_part = content[:content.find("const ECON_TOPICS")]
    
    with open("antigravity/topics.js", "w") as f:
        f.write(phil_part)
        f.write("const ECON_TOPICS = " + json.dumps(sorted(list(econ_topics)), indent=2) + ";\n")
        
    print("Updated antigravity/topics.js with full Economics list.")
