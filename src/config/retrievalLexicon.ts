/**
 * Reviewable retrieval dictionaries (owner decision: keep small; every
 * addition needs a regression test that justifies it — see
 * src/config/retrievalLexicon.test.ts). Morphology normalization only; no
 * semantic synonyms. Entries are written in natural Arabic and normalized by
 * the tokenizer.
 */

/** Function words and particles. */
export const GENERAL_STOPWORDS = [
  "في", "من", "الى", "الي", "علي", "عن", "الا", "ان", "انه", "انها", "او", "ثم", "هل", "ما", "ماذا", "كيف", "لم", "لن", "لا",
  "قد", "كان", "يكون", "تكون", "هذا", "هذه", "ذلك", "تلك", "التي", "الذي", "الذين", "هو", "هي", "هم", "انا", "نحن", "انت",
  "لي", "له", "لها", "لهم", "به", "بها", "فيه", "فيها", "عند", "مع", "كل", "بعد", "قبل", "اذا", "اي", "ايضا", "حتي", "بين",
  "غير", "دون", "هناك", "يا", "ام", "عني", "منه", "منها", "عليه", "عليها",
  "ولا", "وهل", "فهل", "وتم", "تم", "وقد", "وهو", "وهي", "لكن", "ولكن", "منذ", "توجد", "يوجد",
  // Regression: T015 matched KB-004 on «بحسب» alone; T021 on «نعم».
  "حسب", "بحسب", "نعم",
] as const;

/** Recurrent wording of the knowledge base itself ("تقرر المادة..."), not content. */
export const KB_WORDING_STOPWORDS = ["ماده", "تقرر", "تنسب", "تذكر", "يذكر", "هامش", "تعلل", "تعرف"] as const;

/**
 * Question-frame words: asking "what is the ruling / is it permissible" is
 * not topical evidence. Regression: T018 «ما حكم صلاة الوتر؟» matched KB-004
 * on «الحكم»; T013/T014 must not match on «جائز»/«حلال».
 */
export const QUESTION_FRAME_TERMS = ["حكم", "الحكم", "شرعا", "جائز", "جائزه", "يجوز", "تجوز", "حلال", "حرام"] as const;

/**
 * Same-root forms light stemming cannot unify. Regression: T019 «12 قسطًا»
 * must reach KB-002 («أقساط»، «بالتقسيط»).
 */
export const LEMMAS: readonly (readonly [string, string])[] = [
  ["اقساط", "قسط"],
  ["تقسيط", "قسط"],
];

/** Canonical vocabulary per analytical label: a low-weight query boost only, never a filter. */
export const CATEGORY_TERMS: Readonly<Record<string, readonly string[]>> = {
  sale_installments: ["بيع بالتقسيط", "ثمن مؤجل"],
  murabaha_purchase_orderer: ["مرابحة", "الآمر بالشراء"],
  loan_with_conditioned_increase: ["قرض", "زيادة مشروطة"],
  interest_bearing_loan: ["قرض بفائدة"],
  late_payment_terms: ["تأخر", "الأقساط"],
  bnpl: ["تقسيط", "دفعات"],
};

export const RELATIONSHIP_TERMS: Readonly<Record<string, readonly string[]>> = {
  sale: ["بيع"],
  loan: ["قرض"],
  murabaha: ["مرابحة"],
};
