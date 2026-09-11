/**
 * Normalises model output to WhatsApp's formatting dialect.
 *
 * LLMs write standard Markdown: **bold**, ## headings, [text](url), tables.
 * WhatsApp supports none of that — it bolds with a SINGLE asterisk, and shows
 * everything else literally, so "**Amenities**" reaches the customer as raw
 * asterisks and a markdown table becomes an overflowing mess of pipes. This
 * runs on every outbound message so the customer always sees clean text, no
 * matter what the model produced.
 */
export function toWhatsApp(text: string): string {
  let t = text;

  // **bold** / __bold__  ->  *bold*   (WhatsApp bold is a single asterisk)
  t = t.replace(/\*\*(.+?)\*\*/g, "*$1*");
  t = t.replace(/__(.+?)__/g, "*$1*");

  // Markdown headings (#, ##, ###) -> bold line, no hashes
  t = t.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // [label](url) -> label (url), or bare url if label is empty/duplicate
  t = t.replace(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
    label && label !== url ? `${label}: ${url}` : url,
  );

  // Tables: if a line looks like a markdown table row, strip it to a readable
  // form. A separator row (|---|---|) is dropped; a data row becomes " - a, b".
  t = t
    .split("\n")
    .filter((line) => !/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line)) // separator rows
    .map((line) => {
      if (/^\s*\|.*\|\s*$/.test(line)) {
        const cells = line
          .replace(/^\s*\|/, "")
          .replace(/\|\s*$/, "")
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean);
        return cells.length ? `- ${cells.join(" · ")}` : "";
      }
      return line;
    })
    .join("\n");

  // Convert markdown bullets (* or -) to a clean bullet, and collapse the 3+
  // blank lines a model sometimes emits down to a single gap.
  t = t.replace(/^[*-]\s+/gm, "• ");
  t = t.replace(/\n{3,}/g, "\n\n");

  return t.trim();
}
