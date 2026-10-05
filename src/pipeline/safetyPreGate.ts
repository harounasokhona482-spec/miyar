import { PipelineResultSchema, type PipelineResult } from "../domain/schemas/pipelineResult";
import { anyPhraseSource, arabicPhrase, matchesAny, normalizeArabic } from "../text/arabic";
import { detectLanguage } from "../text/language";
import { RULING_TERMS } from "../text/rulingTerms";
import {
  outOfScopeResult,
  referralResult,
  technicalErrorResult,
  unsupportedLanguageResult,
  type ReferralReason,
} from "./results";

/**
 * Safety pre-gate: deterministic, no LLM. Runs on every user message before
 * any attempt to answer. It stops two kinds of input:
 *
 * - REFERRAL: the user asks for a ruling on their own case (validity of their
 *   contract, their sin, what they personally must do) or for a decision on
 *   rights/disputes between parties. Mentioning a personal transaction alone
 *   ("اشتريت", "لدي عقد") is NOT enough.
 * - OUT_OF_SCOPE: clearly non-financial religious topics with no financial term,
 *   and zakat/inheritance (financial, but outside the MVP's transactions).
 * - UNSUPPORTED_LANGUAGE: clearly non-Arabic messages.
 *
 * Anything else PASSes to the next stage. Any internal failure fails closed
 * to TECHNICAL_ERROR.
 */

export type PreGateVerdict =
  | { outcome: "PASS" }
  | { outcome: "REFERRAL"; reason: ReferralReason; matched_rules: string[] }
  | { outcome: "OUT_OF_SCOPE"; matched_rules: string[] }
  | { outcome: "UNSUPPORTED_LANGUAGE" };

type Rule = { id: string; reason: ReferralReason; test: (normalized: string) => boolean };

const words = (list: string[]) => list.map((p) => arabicPhrase(p, "word"));
const prefixes = (list: string[]) => list.map((p) => arabicPhrase(p, "prefix"));

// The user's own contract or transaction (first-person possessive or "that I signed").
const OWN_TRANSACTION_PHRASES = [
  "عقدي", "عقدنا", "عقودي", "معاملتي", "معاملتنا", "تمويلي", "قرضي", "أقساطي", "قسطي",
  "صفقتي", "شرائي", "اتفاقي", "حسابي", "وقعته", "وقعت عليه", "أبرمته", "أمضيته",
];
const OWN = anyPhraseSource(OWN_TRANSACTION_PHRASES, "word");
const RULING = anyPhraseSource(RULING_TERMS, "prefix");
const GAP = (max: number) => `(?:\\s+\\S+){0,${max}}\\s+`;

/**
 * A ruling asked about the user's OWN transaction, judged by proximity rather
 * than by words like «عمومًا»:
 * - own transaction then a ruling word within 3 words: «هل عقدي جائز»، «الذي وقعته هل هو صحيح»
 * - a ruling word then the own transaction within 3 words: «هل يجوز لي الاستمرار في عقدي»
 * - a question that opens on the own transaction: «هل عقدي الذي فيه شرط كذا جائز»
 * «عقدي فيه شرط حلول الأقساط، هل هذا الشرط جائز عمومًا؟» asks about the clause type and does not match.
 */
const OWN_RULING = [
  new RegExp(`${OWN}${GAP(3)}${RULING}`, "u"),
  new RegExp(`${RULING}${GAP(3)}${OWN}`, "u"),
  new RegExp(`(?<!\\p{L})هل\\s+${OWN}.*${RULING}`, "u"),
];

// The user's own sin.
const OWN_SIN = prefixes(["أنا آثم", "أكون آثم", "سأكون آثم", "أأثم", "علي إثم", "علي ذنب", "علي وزر", "أنا مذنب"]);

// What the user personally must do.
// Verbs of learning: "I must know / understand ..." is a knowledge request, not an obligation.
const LEARNING_VERB = "(?:عرف|فهم|علم|تعلم|سال)";

const OWN_OBLIGATION = [
  ...words([
    "يجب علي", "يجب علينا", "يلزمني", "يلزمنا", "هل علي أن", "ماذا علي", "ما الذي أفعله",
    "هل أفسخ", "أفسخ العقد", "أفسخه", "أفسخها", "فسخ عقدي", "هل أكمل", "هل أستمر", "هل أتوقف", "هل ألغي",
  ]),
  // "ماذا أفعل" — except "ماذا أفعل لأفهم/لأعرف ..."
  new RegExp(`(?<!\\p{L})ماذا\\s+افعل(?!\\p{L})(?!\\s+لا?${LEARNING_VERB})`, "u"),
  // "يجب أن أ..." — a first-person verb after "must", except learning verbs.
  new RegExp(`(?<!\\p{L})يجب\\s+(?:علي\\s+)?ان\\s+ا(?!${LEARNING_VERB})\\p{L}+`, "u"),
];

// Rights or disputes between parties.
const RIGHTS_OR_DISPUTE = [
  ...words([
    "يجب عليهم", "يلزمهم", "عليهم أن", "يحق لي", "يحق لهم", "من حقي", "حقي", "حقوقي",
    "إعادة المال", "إعادة مالي", "رد المال", "رد مالي", "إرجاع المال", "استرد", "استرجع", "استرداده", "استرجاعه",
    "يعيدوا", "يعيدون", "يردوا", "يردون", "يرجعوا", "أطالب", "نزاع", "خلاف بيني",
    "شكوى", "أشتكي", "أقاضي", "مقاضاة", "رفعت قضية", "من المحق",
  ]),
];

const REFERRAL_RULES: readonly Rule[] = [
  { id: "own_contract_ruling", reason: "personal_ruling", test: (t) => matchesAny(t, OWN_RULING) },
  { id: "own_sin", reason: "personal_ruling", test: (t) => matchesAny(t, OWN_SIN) },
  { id: "own_obligation", reason: "personal_obligation", test: (t) => matchesAny(t, OWN_OBLIGATION) },
  { id: "rights_or_dispute", reason: "dispute_or_rights", test: (t) => matchesAny(t, RIGHTS_OR_DISPUTE) },
];

// Clearly non-financial religious topics (out of scope unless a financial term is present).
const OUT_OF_SCOPE_TOPICS = words([
  "صلاة", "صلاتي", "الصلوات", "وتر", "وضوء", "أتوضأ", "طهارة", "تيمم", "صوم", "صيام", "حج", "عمرة",
  "أذان", "دعاء", "نكاح", "زواج", "طلاق", "خلع", "حضانة", "أضحية", "عقيقة", "حجاب", "جنازة",
]);

// Financial topics outside the MVP's transaction categories: always out of scope.
// («تركة» is left out: normalized it equals «تركه», "he left it".)
const OUT_OF_SCOPE_FINANCIAL_TOPICS = words([
  "زكاة", "زكاتي", "زكاته", "ميراث", "مواريث", "إرث", "الورثة", "ورثة", "توزيع التركة", "قسمة التركة",
]);

// Any of these keeps the question in scope (e.g. a financial question about a marriage dowry).
const FINANCIAL_TERMS = prefixes([
  "بيع", "بائع", "مشتري", "اشتري", "اشترى", "شراء", "تقسيط", "قسط", "أقساط", "مقسط", "قرض", "أقرض", "مقرض", "مقترض",
  "تمويل", "ممول", "مرابحة", "فائدة", "فوائد", "ربا", "ربوي", "رسوم", "عمولة", "بنك", "مصرف", "مدين", "دائن", "ديون",
  "سداد", "أسدد", "ثمن", "سعر", "أسعار", "درهم", "ريال", "دولار", "دينار", "جنيه", "أموال", "مبلغ", "غرامة",
  "تداول", "أسهم", "سهم", "عملات", "staking", "options", "bnpl", "بطاقة", "إيجار", "إجارة", "تأجير", "تأمين", "دفع", "مهر",
]);

/** Pure classification of one user message. Order: language, referral, scope. */
export function classifyPreGate(message: string): PreGateVerdict {
  if (detectLanguage(message) === "non_arabic") {
    return { outcome: "UNSUPPORTED_LANGUAGE" };
  }

  const text = normalizeArabic(message);

  const referral = REFERRAL_RULES.filter((r) => r.test(text));
  if (referral.length > 0) {
    return { outcome: "REFERRAL", reason: referral[0]!.reason, matched_rules: referral.map((r) => r.id) };
  }

  if (matchesAny(text, OUT_OF_SCOPE_FINANCIAL_TOPICS)) {
    return { outcome: "OUT_OF_SCOPE", matched_rules: ["out_of_scope_financial_topic"] };
  }
  if (matchesAny(text, OUT_OF_SCOPE_TOPICS) && !matchesAny(text, FINANCIAL_TERMS)) {
    return { outcome: "OUT_OF_SCOPE", matched_rules: ["non_financial_topic"] };
  }

  return { outcome: "PASS" };
}

export type SafetyPreGateResult =
  | { proceed: true; verdict: PreGateVerdict }
  | { proceed: false; verdict: PreGateVerdict | null; result: PipelineResult };

/**
 * Runs the pre-gate and fails closed: invalid input, a throwing classifier or
 * an unexpected verdict all yield TECHNICAL_ERROR, never an answer.
 */
export function runSafetyPreGate(message: unknown, classify: (m: string) => PreGateVerdict = classifyPreGate): SafetyPreGateResult {
  try {
    if (typeof message !== "string" || message.trim() === "") {
      throw new Error("pre-gate received an empty or non-string message");
    }
    const verdict = classify(message);
    switch (verdict?.outcome) {
      case "PASS":
        return { proceed: true, verdict };
      case "REFERRAL":
        return { proceed: false, verdict, result: PipelineResultSchema.parse(referralResult(verdict.reason)) };
      case "OUT_OF_SCOPE":
        return { proceed: false, verdict, result: PipelineResultSchema.parse(outOfScopeResult()) };
      case "UNSUPPORTED_LANGUAGE":
        return { proceed: false, verdict, result: PipelineResultSchema.parse(unsupportedLanguageResult()) };
      default:
        throw new Error("pre-gate produced an unknown verdict");
    }
  } catch {
    return { proceed: false, verdict: null, result: technicalErrorResult("safety_pre_gate_failed") };
  }
}
