import { GENERAL_STOPWORDS, KB_WORDING_STOPWORDS, LEMMAS, QUESTION_FRAME_TERMS } from "../config/retrievalLexicon";
import { normalizeArabic } from "./arabic";

/**
 * Tokenizer for lexical retrieval. Applied identically to documents and
 * queries, so a light, consistent stemmer is enough:
 * 1. normalizeArabic (no diacritics, unified alef/ya/ta marbuta, no punctuation);
 * 2. drop stopwords and pure numbers;
 * 3. strip one leading clitic group (وال، بال، لل، ال، و، ف، ب، ك، ل);
 * 4. strip up to two common suffixes (ـه، ـها، ـات، ـي، ـت...);
 * 5. strip a leading alef (أفعل / إفعال forms: «أقرضني» → «قرض»).
 * Each step keeps at least 3 letters, so short roots are left intact.
 * The dictionaries live in src/config/retrievalLexicon.ts.
 */

const STOPWORDS = new Set([...GENERAL_STOPWORDS, ...KB_WORDING_STOPWORDS, ...QUESTION_FRAME_TERMS].map(normalizeArabic));
const LEMMA_MAP = new Map(LEMMAS.map(([form, lemma]) => [normalizeArabic(form), lemma] as const));

const LEADING_CLITICS = /^(?:وال|فال|بال|كال|لل|ال|[وفبكل])/;
const SUFFIXES = ["هما", "كما", "هم", "هن", "ها", "كم", "نا", "ني", "ات", "ون", "ين", "ان", "يه", "ته", "ه", "ي", "ت", "ا", "ك"];
const MIN_STEM = 3;

function stem(token: string): string {
  if (/^[a-z]+$/.test(token)) return token;
  let s = token;

  const clitic = LEADING_CLITICS.exec(s)?.[0];
  if (clitic && s.length - clitic.length >= (clitic.length > 1 ? 2 : MIN_STEM)) s = s.slice(clitic.length);
  if (LEMMA_MAP.has(s)) return LEMMA_MAP.get(s)!;

  for (let pass = 0; pass < 2; pass++) {
    const suffix = SUFFIXES.find((x) => s.endsWith(x) && s.length - x.length >= MIN_STEM);
    if (!suffix) break;
    s = s.slice(0, -suffix.length);
    if (LEMMA_MAP.has(s)) return LEMMA_MAP.get(s)!;
  }

  if (s.startsWith("ا") && s.length - 1 >= MIN_STEM) s = s.slice(1);
  return s;
}

export function retrievalTokens(text: string): string[] {
  return normalizeArabic(text)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t) && !/^\d+$/.test(t))
    .map(stem)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}
