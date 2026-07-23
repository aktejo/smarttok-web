import json
import html
import re

with open("antigravity/topics.js", "r") as f:
    content = f.read()

phil_match = re.search(r'const PHILOSOPHY_TOPICS = (\[.*?\]);', content, re.DOTALL)
econ_match = re.search(r'const ECON_TOPICS = (\[.*?\]);', content, re.DOTALL)

phil_topics = json.loads(phil_match.group(1)) if phil_match else []
econ_topics = json.loads(econ_match.group(1)) if econ_match else []

# Clean up HTML entities that were missed
phil_topics = sorted(list(set([html.unescape(t) for t in phil_topics])))
econ_topics = sorted(list(set([html.unescape(t) for t in econ_topics])))

# Identify truly questionable ones
def is_questionable(topic):
    if any(topic.startswith(x) for x in ["List of", "Index of", "Outline of", "Glossary of", "Category:", "Wikipedia:", "Portal:", "Talk:", "Template:"]):
        return "Wiki meta-page (not a concept)"
    if len(topic.split()) > 5:
        return "Very long (might be a specific essay/event, not a general concept)"
    return None

phil_flagged = [(t, is_questionable(t)) for t in phil_topics if is_questionable(t)]
econ_flagged = [(t, is_questionable(t)) for t in econ_topics if is_questionable(t)]

# Create an artifact file
artifact_path = "/Users/abhiramtejomurtula/.gemini/antigravity/brain/2ab7cb86-8677-45e5-ab3c-d9f1688ed094/flagged_topics.md"
with open(artifact_path, "w") as f:
    f.write("# Questionable Topics for Review\n\n")
    f.write("I've auto-fixed formatting issues (like HTML entities). Here are the remaining topics that seem questionable based on my heuristics:\n\n")
    
    f.write("## Philosophy (Flagged)\n\n")
    for item, reason in phil_flagged:
        f.write(f"- `{item}` *(Reason: {reason})*\n")
        
    f.write("\n## Economics (Flagged)\n\n")
    for item, reason in econ_flagged:
        f.write(f"- `{item}` *(Reason: {reason})*\n")

# Write the cleaned list back to topics.js (but keeping the flagged ones in for now until user decides)
with open("antigravity/topics.js", "w") as f:
    f.write("// Massive arrays fetched from Wikipedia Categories and SEP\n")
    f.write("const PHILOSOPHY_TOPICS = " + json.dumps(phil_topics, indent=2) + ";\n\n")
    f.write("const ECON_TOPICS = " + json.dumps(econ_topics, indent=2) + ";\n")

print(f"Cleaned lists. Flagged {len(phil_flagged)} Phil and {len(econ_flagged)} Econ topics.")
