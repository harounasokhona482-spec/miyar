import type { Transaction } from "../domain/schemas/transaction";
import { listExtractedFields } from "./extraction";

/**
 * What we understood of the transaction, shown while clarifying: explicit
 * facts only (never inferred values), with fixed Arabic labels.
 */

const LABELS: Record<string, string> = {
  relationship_type: "نوع المعاملة",
  product_or_service: "السلعة أو الخدمة",
  payment_method: "طريقة الدفع",
  payment_schedule: "مواعيد السداد",
  financing_party: "الجهة التي تموّل أو تدفع",
  ownership_transfer: "الملكية وتسلسل الشراء",
  return_or_profit: "الزيادة أو الربح",
  "fees.exists": "توجد رسوم",
  "fees.type": "طبيعة الرسوم",
  "fees.amount_or_rate": "مقدار الرسوم",
  "late_penalty.exists": "مبلغ عند التأخر",
  "late_penalty.details": "ما يحدث عند التأخر",
  price_fixed_at_contract: "الثمن محدد عند الاتفاق",
  increase_conditioned_at_contract: "الزيادة مشروطة عند القرض",
};

const RELATIONSHIP: Record<string, string> = { sale: "بيع", loan: "قرض", murabaha: "مرابحة" };

function display(path: string, value: unknown): string | null {
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (path === "relationship_type") return RELATIONSHIP[String(value)] ?? null;
  return typeof value === "string" && value.trim() ? value : null;
}

export function understandingSummary(t: Transaction): { label: string; value: string }[] {
  return listExtractedFields(t).flatMap(({ path, field }) => {
    const label = LABELS[path];
    if (!label || field.provenance !== "explicit" || field.value === null) return [];
    const value = display(path, field.value);
    return value ? [{ label, value }] : [];
  });
}

const INFERRED_LABELS: Record<string, string> = {
  possible_classification: "نوع المعاملة المحتمل",
  relationship_type: "طبيعة العلاقة المحتملة",
};

/** A label fit for the user: Arabic text, not an internal code such as «murabaha_purchase_orderer». */
const READABLE = /\p{Script=Arabic}/u;

/**
 * Display only: the analytical labels the extractor inferred (never facts), so
 * the screen can show them apart from what the user stated.
 */
export function inferredSummary(t: Transaction): { label: string; value: string }[] {
  return (["possible_classification", "relationship_type"] as const).flatMap((path) => {
    const field = t[path];
    if (field.provenance !== "inferred" || field.value === null) return [];
    const value = display(path, field.value);
    return value && READABLE.test(value) ? [{ label: INFERRED_LABELS[path]!, value }] : [];
  });
}
