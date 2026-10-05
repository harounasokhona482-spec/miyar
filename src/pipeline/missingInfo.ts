import type { Transaction } from "../domain/schemas/transaction";
import { statesFeeBasis } from "./evidenceValidators";

/**
 * Missing information detection: deterministic, no LLM. Reads a structured
 * transaction and lists the material facts still missing before the next
 * stage. Only explicit facts count as known; inferred values never do.
 *
 * Every rule is traced in `basis` to approved material only: editorial
 * constraints of knowledge_base_v2 and required_clarification in
 * test_set_v2. No new jurisprudential condition is introduced here.
 * The model's own missing_information list is not used.
 */

export const FACT_IDS = [
  "relationship_nature",
  "intermediary_role",
  "ownership_before_sale",
  "fee_nature",
  "late_amount_nature",
] as const;
export type FactId = (typeof FACT_IDS)[number];

export type MissingFact = {
  id: FactId;
  /** Lower asks first. */
  priority: number;
  reason: string;
  relatedFields: string[];
  /** Where the rule comes from (KB editorial constraints, benchmark cases). */
  basis: string[];
};

export type MissingInfoResult = { missingFacts: MissingFact[]; needsClarification: boolean };

const FACTS: Record<FactId, Omit<MissingFact, "id">> = {
  relationship_nature: {
    priority: 1,
    reason: "طبيعة العلاقة غير محددة: شراء سلعة بثمن مؤجل أم اقتراض مال.",
    relatedFields: ["relationship_type"],
    basis: [
      "KB-002 editorial usage_notes: إذا كانت طبيعة المعاملة غير واضحة بين بيع وقرض، يجب الاستيضاح أولًا.",
      "KB-005 editorial usage_notes: لا يستخدم السجل قبل التأكد من أن المعاملة قرض وليست بيعًا.",
      "KB-006 editorial usage_notes: إذا كانت العلاقة العقدية غير واضحة، يجب الاستيضاح قبل تطبيق هذا السجل.",
    ],
  },
  intermediary_role: {
    priority: 1,
    reason: "جهة تدفع عن المستخدم، ولا يُعرف هل تشتري السلعة وتملكها ثم تبيعها أم تدفع المال فقط.",
    relatedFields: ["ownership_transfer", "relationship_type"],
    basis: [
      "test_set_v2 T007 required_clarification: هل التطبيق يشتري السلعة ويمتلكها ثم يبيعها أم يدفع المال فقط",
      "test_set_v2 T015 required_clarification: العلاقة التعاقدية بين الأطراف",
      "KB-004 editorial must_not_generalize_to: مجرد دفع الجهة المال للعميل كقرض",
    ],
  },
  ownership_before_sale: {
    priority: 2,
    reason: "لا يُعرف هل تشتري الجهة الممولة السلعة وتملكها قبل بيعها للمستخدم.",
    relatedFields: ["ownership_transfer"],
    basis: [
      "test_set_v2 T009 required_clarification: هل البنك يشتري السيارة ويمتلكها قبل أن يبيعها",
      "KB-004 editorial usage_notes: إذا لم تتضح الملكية وتسلسل الشراء، تكون الحالة NEEDS_CLARIFICATION.",
      "KB-004 editorial must_not_generalize_to: حالة لا تملك فيها الجهة السلعة قبل البيع دون تحقق إضافي",
    ],
  },
  fee_nature: {
    priority: 3,
    reason: "توجد رسوم، ولا يُعرف كيف تُحسب: مبلغ ثابت مقابل خدمة أم تتغير بقيمة التمويل أو مدته.",
    relatedFields: ["fees.type"],
    basis: [
      "test_set_v2 T006 required_clarification: طبيعة الرسوم؛ هل تتغير مع قيمة التمويل أو المدة",
      "test_set_v2 T015 required_clarification: كيفية احتساب الرسوم",
      "KB-001 editorial must_not_generalize_to: رسوم خدمة مجهولة الطبيعة",
      "KB-002 editorial must_not_generalize_to: الرسوم الإضافية غير الموصوفة",
    ],
  },
  late_amount_nature: {
    priority: 4,
    reason: "يوجد مبلغ مرتبط بالتأخير، ولا يُعرف هل يُضاف إلى المستحق أم هو رسم من نوع آخر.",
    relatedFields: ["late_penalty.details"],
    basis: [
      "test_set_v2 T008 required_clarification: طبيعة المبلغ؛ هل هو زيادة على الدين",
      "KB-003 editorial must_not_generalize_to: رسوم تأخير غير محددة الطبيعة",
    ],
  },
};

type AnyField = { value: unknown; provenance: string; evidence_span?: string };

function known(field: AnyField): boolean {
  return field.provenance === "explicit" && field.value !== null;
}

function feeNatureKnown(t: Transaction): boolean {
  if (!known(t.fees.type)) return false;
  return statesFeeBasis(`${String(t.fees.type.value)} ${t.fees.type.evidence_span ?? ""}`);
}

/** Which material facts are missing, ordered by priority. Pure and deterministic. */
export function detectMissingInformation(t: Transaction): MissingInfoResult {
  const missing = new Set<FactId>();

  if (t.in_scope && t.category !== "out_of_scope") {
    const relationshipKnown = known(t.relationship_type);
    const thirdPartyPayer = known(t.financing_party);
    const ownershipKnown = known(t.ownership_transfer);

    // 1. Nature of the core relationship.
    if (t.category === "murabaha_purchase_orderer") {
      // Category-specific: the relationship is a sale by the financing party; what matters is ownership.
      if (!ownershipKnown) missing.add("ownership_before_sale");
    } else if (!relationshipKnown && (t.category === "bnpl" || t.category === "unknown") && thirdPartyPayer) {
      if (!ownershipKnown) missing.add("intermediary_role");
    } else if (!relationshipKnown && t.category !== "late_payment_terms" && !thirdPartyPayer) {
      // Category-specific: for late-payment terms the amount itself is asked first.
      missing.add("relationship_nature");
    }

    // 3. Fees whose basis is not described.
    if (t.fees.exists.provenance === "explicit" && t.fees.exists.value === true && !feeNatureKnown(t)) {
      missing.add("fee_nature");
    }

    // 4. An amount tied to late payment whose nature is not described.
    if (t.late_penalty.exists.provenance === "explicit" && t.late_penalty.exists.value === true && !known(t.late_penalty.details)) {
      missing.add("late_amount_nature");
    }
  }

  const missingFacts = FACT_IDS.filter((id) => missing.has(id))
    .map((id) => ({ id, ...structuredClone(FACTS[id]) }))
    .sort((a, b) => a.priority - b.priority);
  return { missingFacts, needsClarification: missingFacts.length > 0 };
}

/** The fact definitions, for review and traceability tests. */
export function factDefinition(id: FactId): Omit<MissingFact, "id"> {
  return structuredClone(FACTS[id]);
}
