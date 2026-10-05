/**
 * Deterministic check that a message is Arabic. Latin product names,
 * acronyms and digits inside an Arabic sentence are fine
 * ("اشتريت iPhone عن طريق BNPL على 4 دفعات").
 */

// Arabic letters proper (excludes Persian/Urdu-only letters).
const ARABIC_LETTER = /[ء-غف-يٱ]/gu;
// Letters used in Persian/Urdu but not in Arabic.
const PERSIAN_URDU_ONLY = /[پچژگٹڈڑںے]/gu;
const LATIN_WORD = /^[A-Za-z][A-Za-z'’-]*$/;

export type LanguageVerdict = "arabic" | "non_arabic";

export function detectLanguage(text: string): LanguageVerdict {
  if ((text.match(PERSIAN_URDU_ONLY) ?? []).length >= 2) return "non_arabic";

  const tokens = text.split(/[\s،,.؟?!:;()«»"]+/u).filter(Boolean);
  const arabicWords = tokens.filter((t) => (t.match(ARABIC_LETTER) ?? []).length >= 2).length;
  const latinWords = tokens.filter((t) => LATIN_WORD.test(t) && t.length >= 2).length;

  if (arabicWords === 0) return "non_arabic";
  // Mostly a foreign-language sentence with an Arabic word or two.
  if (arabicWords < 2 && latinWords >= 3) return "non_arabic";
  return "arabic";
}
