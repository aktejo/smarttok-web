/**
 * Tiny markdown subset renderer.
 * Supports: **bold**, *italic*, [text](url) links, and plain newlines.
 * Deliberately not a full markdown parser — adapters only ever need
 * these primitives, matching MarkdownBodyView in the iOS version.
 */
function renderMarkdownBody(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  let html = escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(
      /\[(.+?)\]\((.+?)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

  // Preserve paragraph breaks; collapse single newlines into <br>.
  html = html
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");

  return html;
}
