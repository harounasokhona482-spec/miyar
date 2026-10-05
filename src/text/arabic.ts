/**
 * Lenient Arabic normalization for deterministic pattern matching (safety
 * rules, later keyword retrieval). NOT for verbatim source comparison; use
 * normalizeForMatch in the knowledge schema for that.
 */

// Harakat, tanween, shadda, sukun, superscript alef, Quranic marks.
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

export function normalizeArabic(text: string): string {
  return text
    .normalize("NFC")
    .replace(DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a matcher for a phrase written in natural Arabic. The phrase may be
 * preceded by common clitics (و ف ب ل ك ال). In "word" mode it must end at a
 * word boundary; in "prefix" mode it may be followed by suffixes (e.g. ـه، ـا).
 */
export function arabicPhrase(phrase: string, mode: "word" | "prefix" = "word"): RegExp {
  const body = normalizeArabic(phrase).split(" ").map(escapeRegExp).join("\\s+");
  const tail = mode === "word" ? "(?!\\p{L})" : "";
  return new RegExp(`(?<!\\p{L})(?:[وف])?(?:[بلك])?(?:ال)?${body}${tail}`, "u");
}

export function matchesAny(normalizedText: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(normalizedText));
}
