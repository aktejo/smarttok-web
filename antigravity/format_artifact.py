import json

with open("antigravity/flagged.json", "r") as f:
    data = json.load(f)

with open("antigravity/flagged_topics.md", "w") as f:
    f.write("# Questionable Topics for Review\n\n")
    f.write("I ran a heuristic script to flag topics that might be noisy, overly broad, too long, or not actual concepts. Here are the flagged items.\n\n")
    
    f.write("## Philosophy\n\n")
    for item, reason in data["philosophy"]:
        f.write(f"- `{item}` *(Reason: {reason})*\n")
        
    f.write("\n## Economics\n\n")
    for item, reason in data["economics"]:
        f.write(f"- `{item}` *(Reason: {reason})*\n")
