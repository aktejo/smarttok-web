import json
import re

with open("antigravity/topics.js", "r") as f:
    content = f.read()

# very rough extraction since it's valid JS
phil_match = re.search(r'const PHILOSOPHY_TOPICS = (\[.*?\]);', content, re.DOTALL)
econ_match = re.search(r'const ECON_TOPICS = (\[.*?\]);', content, re.DOTALL)

phil_topics = json.loads(phil_match.group(1)) if phil_match else []
econ_topics = json.loads(econ_match.group(1)) if econ_match else []

questionable = []

def is_questionable(topic):
    # Too long (more than 4 words)
    if len(topic.split()) > 4:
        return "Too long"
    # Contains Wikipedia admin stuff
    if any(topic.startswith(x) for x in ["List of", "Index of", "Outline of", "Glossary of", "Category:", "Wikipedia:", "Portal:", "Talk:", "Template:"]):
        return "Wiki meta"
    # Contains a year or specific date (regex for 4 digits)
    if re.search(r'\b(19|20)\d{2}\b', topic):
        return "Contains year"
    # Single letter or very short
    if len(topic) <= 2:
        return "Too short"
    # Contains strange characters (not alphanumeric, space, hyphen, apostrophe, parens, comma)
    if re.search(r'[^\w\s\-\'(),]', topic):
        return "Strange characters"
    return None

phil_flagged = [(t, is_questionable(t)) for t in phil_topics if is_questionable(t)]
econ_flagged = [(t, is_questionable(t)) for t in econ_topics if is_questionable(t)]

print(f"Total Phil flagged: {len(phil_flagged)} out of {len(phil_topics)}")
print(f"Total Econ flagged: {len(econ_flagged)} out of {len(econ_topics)}")

with open("antigravity/flagged.json", "w") as f:
    json.dump({"philosophy": phil_flagged, "economics": econ_flagged}, f, indent=2)
