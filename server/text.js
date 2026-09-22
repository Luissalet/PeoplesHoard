// Text helpers shared by search and fuzzy resolution: accent folding and a
// safe FTS5 prefix-query builder.

/** Lowercase and strip diacritics: "José" → "jose". */
export function fold(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/**
 * Build an FTS5 MATCH query that requires every whitespace-separated token
 * as a prefix (AND-ed, FTS5's default). Returns null for empty input.
 * Quoting each token keeps punctuation from breaking the query syntax.
 */
export function ftsPrefixQuery(text) {
  const tokens = String(text || "")
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, "").trim())
    .filter(Boolean);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t}"*`).join(" ");
}
