import { normalizeArabic } from "../text/arabic";

/**
 * Evidence checks for extracted facts. A span that merely names a party
 * ("البنك") does not prove an act attributed to it ("البنك يملك السيارة").
 * Material fields therefore have their own validators requiring lexical
 * evidence in the span itself.
 */

const ARABIC_INDIC = /[٠-٩۰-۹]/g;

export function asciiDigits(text: string): string {
  return text.replace(ARABIC_INDIC, (d) => String((d.charCodeAt(0) & 0xf) % 10));
}

/** Lenient for orthography (diacritics, hamza forms, digits, punctuation), strict for words. */
export function comparable(text: string): string {
  return normalizeArabic(asciiDigits(text));
}

export function numbersIn(text: string): string[] {
  return asciiDigits(text).replace(/(\d)[,٬](?=\d)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? [];
}

// Leading clitics + article, stripped only when at least 3 letters remain.
const CLITICS = /^(?:[وف]?[بلك]?ال|[وف])(?=\p{L}{3,})/u;
const STOPWORDS = new Set(["الذي", "التي", "هذا", "هذه", "علي", "الي", "بعد", "قبل", "عند", "اذا", "يكون", "تكون", "كان"]);

function tokens(text: string): string[] {
  return comparable(text).split(" ").filter(Boolean);
}

function contentTokens(text: string): string[] {
  return tokens(text)
    .filter((t) => !STOPWORDS.has(t))
    .map((t) => t.replace(CLITICS, ""))
    .filter((t) => t.length >= 3);
}

/** Every content word of the value appears (allowing affixes) in the span. */
export function spanCoversValue(value: string, span: string): boolean {
  const spanTokens = contentTokens(span);
  return contentTokens(value).every((v) => spanTokens.some((s) => s.includes(v) || v.includes(s)));
}

/** Some word of the span contains one of the stems (stems written in normalized form). */
export function spanHasStem(span: string, stems: readonly string[]): boolean {
  return tokens(span).some((t) => stems.some((stem) => t.includes(stem)));
}

// Stems in normalized form (no hamza, ة→ه).
export const OWNERSHIP_STEMS = ["شتر", "شراء", "شرائ", "ملك", "متلك", "مالك"] as const; // اشترى، يشتري، شراء، ملك، يتملك، امتلك، مالك
export const SALE_STEMS = ["شتر", "شراء", "شرائ", "بيع", "باع", "بائع"] as const;
export const LOAN_STEMS = ["قرض", "قترض", "سلف"] as const; // أقرض، اقترض، سلف، استلف
export const MURABAHA_STEMS = ["مرابح"] as const;
export const FEE_STEMS = ["رسوم", "رسم", "اشتراك", "عموله", "مصاريف", "اجره", "تكلفه", "نسبه", "فائده"] as const;
/** The price was fixed/known/agreed: «ثابت»، «محدد»، «معلوم»، «متفق»، «الاتفاق»، «نهائي». */
export const PRICE_FIXED_STEMS = ["ثابت", "محدد", "معلوم", "متفق", "اتفاق", "نهائي"] as const;
/** The increase was a condition/agreement: «مشروط»، «شرط»، «اشترط»، «متفق»، «الاتفاق». */
export const CONDITIONED_STEMS = ["شرط", "شروط", "شترط", "متفق", "اتفاق"] as const;

/** How a calculation basis of a fee is stated (fixed / percentage / varies with amount or term). */
const FEE_BASIS = /(?<!\p{L})(?:ثابت\p{L}*|مقطوع\p{L}*|نسبه|بنسبه|ت?يتغير|تتغير|(?:ت|ي)?(?:ختلف|زيد)\s+(?:ب)?حسب\s+(?:قيمه|المبلغ|مبلغ|المده|مده))(?!\p{L})/u;

export function statesFeeBasis(text: string): boolean {
  return FEE_BASIS.test(comparable(text));
}

export type Downgrade = { reason: "insufficient_lexical_evidence"; to: "unknown" | "inferred" };

type Explicit = { value: unknown; evidence_span: string };

/**
 * Field-specific validation of an explicit field whose span is already known
 * to be in the user's words. Returns a downgrade when the span does not prove
 * the value.
 */
export function validateMaterialEvidence(path: string, field: Explicit): Downgrade | null {
  const span = field.evidence_span;
  const value = typeof field.value === "string" ? field.value : "";
  const unknown: Downgrade = { reason: "insufficient_lexical_evidence", to: "unknown" };

  switch (path) {
    case "ownership_transfer":
      return spanHasStem(span, OWNERSHIP_STEMS) ? null : unknown;
    case "financing_party":
      return spanCoversValue(value, span) ? null : unknown;
    case "fees.type":
      return spanHasStem(span, FEE_STEMS) && spanCoversValue(value, span) ? null : unknown;
    case "late_penalty.details":
      return spanCoversValue(value, span) ? null : unknown;
    case "price_fixed_at_contract":
      return spanHasStem(span, PRICE_FIXED_STEMS) ? null : unknown;
    case "increase_conditioned_at_contract":
      return spanHasStem(span, CONDITIONED_STEMS) ? null : unknown;
    case "relationship_type": {
      const stems = value === "sale" ? SALE_STEMS : value === "loan" ? LOAN_STEMS : value === "murabaha" ? MURABAHA_STEMS : null;
      // An analytical label: keep it, but only as inferred.
      return stems && spanHasStem(span, stems) ? null : { reason: "insufficient_lexical_evidence", to: "inferred" };
    }
    default:
      return null;
  }
}
