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
 */

const STOPWORDS = new Set(
  [
    "في", "من", "الى", "الي", "علي", "عن", "الا", "ان", "انه", "انها", "او", "ثم", "هل", "ما", "ماذا", "كيف", "لم", "لن", "لا",
    "قد", "كان", "يكون", "تكون", "هذا", "هذه", "ذلك", "تلك", "التي", "الذي", "الذين", "هو", "هي", "هم", "انا", "نحن", "انت",
    "لي", "له", "لها", "لهم", "به", "بها", "فيه", "فيها", "عند", "مع", "كل", "بعد", "قبل", "اذا", "اي", "ايضا", "حتي", "بين",
    "غير", "دون", "هناك", "يا", "ام", "عني", "منه", "منها", "عليه", "عليها", "او",
    "ولا", "وهل", "فهل", "وتم", "تم", "وقد", "وهو", "وهي", "لكن", "ولكن", "منذ", "توجد", "يوجد",
    "حسب", "بحسب", "نعم",
    // Recurrent wording of the knowledge base itself, not content.
    "ماده", "تقرر", "تنسب", "تذكر", "يذكر", "هامش", "تعلل", "تعرف",
    // Question-frame words: asking "is it permissible / what is the ruling" is not topical evidence.
    "حكم", "الحكم", "شرعا", "جائز", "جائزه", "يجوز", "تجوز", "حلال", "حرام",
  ].map(normalizeArabic),
);

/**
 * Same-root forms that light stemming cannot unify (broken plurals, verbal
 * nouns), limited to the domain's own vocabulary. Applied after the leading
 * clitic is removed and after each suffix pass.
 */
const LEMMAS = new Map(
  [
    ["اقساط", "قسط"],
    ["تقسيط", "قسط"],
    ["شروط", "شرط"],
    ["عقود", "عقد"],
  ].map(([form, lemma]) => [normalizeArabic(form!), lemma!] as const),
);

const LEADING_CLITICS = /^(?:وال|فال|بال|كال|لل|ال|[وفبكل])/;
const SUFFIXES = ["هما", "كما", "هم", "هن", "ها", "كم", "نا", "ني", "ات", "ون", "ين", "ان", "يه", "ته", "ه", "ي", "ت", "ا", "ك"];
const MIN_STEM = 3;

function stem(token: string): string {
  if (/^[a-z]+$/.test(token)) return token;
  let s = token;

  const clitic = LEADING_CLITICS.exec(s)?.[0];
  if (clitic && s.length - clitic.length >= (clitic.length > 1 ? 2 : MIN_STEM)) s = s.slice(clitic.length);
  if (LEMMAS.has(s)) return LEMMAS.get(s)!;

  for (let pass = 0; pass < 2; pass++) {
    const suffix = SUFFIXES.find((x) => s.endsWith(x) && s.length - x.length >= MIN_STEM);
    if (!suffix) break;
    s = s.slice(0, -suffix.length);
    if (LEMMAS.has(s)) return LEMMAS.get(s)!;
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
