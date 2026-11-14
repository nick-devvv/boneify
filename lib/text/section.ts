// receipt.section: the clause number at the start of the matched source paragraph ("2.1", "§3.2", "Article 4"), or null.

const SECTION = /^[ \t]*(§+\s*\d+(?:\.\d+)*[A-Za-z]?|(?:Article|Section|Clause|Art\.)\s+\d+(?:\.\d+)*[A-Za-z]?|\d+(?:\.\d+)+|\d+\.(?=\s))(?=[\s.):,]|$)/gim;

function clean(raw: string): string {
  return raw.trim().replace(/\.$/, "").replace(/^(§+)\s*/, "$1").replace(/\s+/g, " ");
}

/**
 * Looks at the paragraph line the receipt starts on, plus the receipt itself, and returns the most specific
 * clause number found at the start of a line ("2. TERM\n2.1 Initial Term. ..." -> "2.1").
 */
export function sectionFor(text: string, charStart: number | null, charEnd: number | null, quote: string | null): string | null {
  let span: string;
  if (charStart !== null && charStart >= 0 && charStart <= text.length) {
    const lineStart = text.lastIndexOf("\n", Math.max(0, charStart - 1)) + 1;
    const end = charEnd ?? charStart + (quote?.length ?? 0);
    span = text.slice(lineStart, Math.max(end, charStart));
  } else if (quote) {
    span = quote;
  } else {
    return null;
  }
  const found = [...span.matchAll(SECTION)].map((m) => clean(m[1]));
  return found.length ? found[found.length - 1] : null;
}
