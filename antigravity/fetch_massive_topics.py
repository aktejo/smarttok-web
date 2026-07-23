import urllib.request
import urllib.parse
import json
import time

def fetch_category_members(category_name):
    print(f"Fetching category: {category_name}...")
    topics = set()
    url = f"https://en.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:{urllib.parse.quote(category_name)}&cmlimit=500&cmtype=page&format=json"
    
    while url:
        req = urllib.request.Request(url, headers={'User-Agent': 'SmartTokDataFetcher/1.0 (contact@example.com)'})
        try:
            response = urllib.request.urlopen(req).read().decode('utf-8')
            data = json.loads(response)
            
            for item in data.get('query', {}).get('categorymembers', []):
                title = item.get('title')
                if title and not title.startswith('Category:') and not title.startswith('List of'):
                    topics.add(title)
            
            if 'continue' in data and 'cmcontinue' in data['continue']:
                cmcontinue = data['continue']['cmcontinue']
                url = f"https://en.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:{urllib.parse.quote(category_name)}&cmlimit=500&cmtype=page&cmcontinue={urllib.parse.quote(cmcontinue)}&format=json"
                time.sleep(1.0) # Respect API limits
            else:
                url = None
        except Exception as e:
            print(f"Error fetching {category_name}: {e}")
            if "429" in str(e):
                print("Rate limited. Waiting 5 seconds...")
                time.sleep(5.0)
                # Keep the same url to retry
            else:
                break
                
    return topics

# We use very broad categories that contain hundreds/thousands of pages
philosophy_categories = [
    "Philosophical_concepts",
    "Philosophical_theories",
    "Branches_of_philosophy",
    "Epistemology",
    "Metaphysics",
    "Ethics",
    "Logic",
    "Aesthetics",
    "Political_philosophy",
    "Philosophy_of_mind"
]

economics_categories = [
    "Concepts_in_economics",
    "Macroeconomics",
    "Microeconomics",
    "Financial_markets",
    "Economic_theories",
    "International_economics",
    "Behavioral_economics",
    "Monetary_policy",
    "Economic_indicators",
    "Taxation"
]

phil_topics = set()
for cat in philosophy_categories:
    phil_topics.update(fetch_category_members(cat))
    time.sleep(1.0)

econ_topics = set()
for cat in economics_categories:
    econ_topics.update(fetch_category_members(cat))
    time.sleep(1.0)

print(f"\nFound {len(phil_topics)} Philosophy topics and {len(econ_topics)} Economics topics.")

with open("antigravity/topics.js", "w") as f:
    f.write("// Massive arrays fetched from Wikipedia Categories\n")
    f.write("const PHILOSOPHY_TOPICS = " + json.dumps(sorted(list(phil_topics)), indent=2) + ";\n\n")
    f.write("const ECON_TOPICS = " + json.dumps(sorted(list(econ_topics)), indent=2) + ";\n")

print("Saved to antigravity/topics.js")
