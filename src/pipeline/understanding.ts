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
