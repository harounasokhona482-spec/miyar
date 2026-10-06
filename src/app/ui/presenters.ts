import { OUT_OF_SCOPE_MESSAGE, UNSUPPORTED_LANGUAGE_MESSAGE } from "../../domain/messages";
import type { ApiResponse } from "../../domain/schemas/apiResponse";

/**
 * Pure presentation helpers for the Mi'yar screens: no React, no network.
 * They only rearrange what the API returned; they never add claims.
 */

export type Grounded = Extract<ApiResponse, { state: "GROUNDED" }>;
export type Answer = Grounded["answer"];
export type Clarifying = Extract<ApiResponse, { state: "NEEDS_CLARIFICATION" }>;
export type Settled = Exclude<ApiResponse, Clarifying>;

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** 12 → «١٢». */
export function arNum(n: number): string {
  return String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]!);
}

/** «مبنية على …»: Arabic number agreement for the count of cited sources. */
export function sourcesCount(n: number): string {
  if (n === 1) return "مصدر معتمد واحد";
  if (n === 2) return "مصدرين معتمدين";
  if (n <= 10) return `${arNum(n)} مصادر معتمدة`;
  return `${arNum(n)} مصدرًا معتمدًا`;
}

// The generation stage writes these fixed limitation texts (owner-approved); the
// result screen lifts the unverified conditions into their own section.
export const CONDITIONS_INTRO = "ما سبق معلومة عامة من المصدر، وانطباقها على حالتك يعتمد على شروط لم نتحقق منها:";
export const CONDITION_PREFIX = "شرط لم نتحقق منه: ";

export function splitLimitations(limitations: readonly string[]): { conditions: string[]; other: string[] } {
  const conditions = limitations
    .filter((l) => l.startsWith(CONDITION_PREFIX))
    .map((l) => l.slice(CONDITION_PREFIX.length).trim())
    .filter(Boolean);
  if (conditions.length === 0) return { conditions: [], other: [...limitations] };
  return { conditions, other: limitations.filter((l) => l !== CONDITIONS_INTRO && !l.startsWith(CONDITION_PREFIX)) };
}

export type ScopeView = { badge: string; summary: string; heading: string; structural: boolean; conditional: boolean };

// Owner-approved summary sentences (fixed texts: do not paraphrase). They state
// what the sources support, never a jurisprudential conclusion of the interface.
export const SUMMARY_DIRECT = "وجد مِعيار في المصادر المعتمدة ما يكفي لعرض معلومة عامة موثقة حول هذه المعاملة.";
export const SUMMARY_CONDITIONAL = "وجد مِعيار مادة موثقة ذات صلة، لكن انطباقها على الحالة يعتمد على معلومات أو شروط لم تُحسم بعد.";
export const SUMMARY_STRUCTURAL = "توضح المصادر المعتمدة بنية هذه الصورة من المعاملة، دون أن يعني ذلك الحكم على صحة المعاملة أو جوازها.";
export const SUMMARY_DISPUTED = "توجد في المصادر المعتمدة معالجات مختلفة لهذه المسألة، ويعرضها مِعيار مع مصادرها دون ترجيح مستقل.";

/** Fixed wording per answer scope: the badge, the one-line summary and the heading of the sources' content. */
export function scopeView(a: Answer): ScopeView {
  switch (a.answer_scope) {
    case "structural_general_information":
      return { badge: "وصف موثق لبنية المعاملة", summary: SUMMARY_STRUCTURAL, heading: "وصف بنية المعاملة", structural: true, conditional: false };
    case "conditional_general_information":
      return { badge: "معلومة عامة مشروطة", summary: SUMMARY_CONDITIONAL, heading: "ماذا تفيد المصادر؟", structural: false, conditional: true };
    default:
      return { badge: "معلومة عامة موثقة", summary: SUMMARY_DIRECT, heading: "ماذا تفيد المصادر؟", structural: false, conditional: false };
  }
}

/** Citation numbers: the order of the answer's sources, starting at 1. */
export function sourceNumbers(a: Answer): Map<string, number> {
  return new Map(a.sources.map((s, i) => [s.source_id, i + 1] as const));
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** A source's verified excerpt is shown on its card unless a claim already quotes exactly that text. */
export function excerptShownOnCard(excerpt: string, a: Answer): boolean {
  return !a.claims.some((c) => squash(c.quote.text) === squash(excerpt));
}

export type InsufficientKind = "evidence" | "scope" | "language";

/** The three INSUFFICIENT_EVIDENCE outcomes share a state; their fixed messages tell them apart. */
export function insufficientKind(message: string): InsufficientKind {
  if (message === UNSUPPORTED_LANGUAGE_MESSAGE) return "language";
  if (message === OUT_OF_SCOPE_MESSAGE) return "scope";
  return "evidence";
}

/** «dorar.net» for display; null when the URL cannot be parsed. */
export function sourceHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A short preview of the user's own description. */
export function preview(text: string, max = 90): string {
  const t = squash(text);
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
}
