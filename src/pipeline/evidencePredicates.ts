import type { TransactionFacts, Tri } from "./evidenceFacts";
import type { FactId } from "./missingInfo";

/**
 * Evidence predicates: when a knowledge record applies to a transaction.
 * Reviewable data, one entry per record. Every check quotes its basis
 * verbatim from the record's editorial_constraints (applicability_conditions
 * or must_not_generalize_to); nothing here adds a jurisprudential condition.
 *
 * - required:   must hold; "fails" excludes the record; "unknown" leaves it undetermined.
 * - exclusions: a must_not_generalize_to item that the transaction IS; "holds" excludes.
 * - separate:   must_not_generalize_to items handled as their own issue (the record
 *               simply does not cover that issue), listed for traceability.
 * - clarifiableBy: the missing-information fact whose answer would settle an unknown.
 */

export type Check = {
  id: string;
  basis: string;
  evaluate: (f: TransactionFacts) => Tri;
  clarifiableBy?: FactId | string;
};

export type RecordPredicates = {
  source_id: string;
  /** The issue this record can settle. */
  issue: string;
  groundingScope: "general" | "structural_general_information";
  required: Check[];
  exclusions: Check[];
  separate: { basis: string; issue: string }[];
};

export type IssueDefinition = {
  id: string;
  description: string;
  /** Whether the transaction raises the issue (selection may use inferred values). */
  raisedWhen: (f: TransactionFacts) => boolean;
  /** Records that can settle it, most specific / primary first. */
  covering: string[];
  /** Official missing facts that keep this issue pending while askable. */
  pendingWhenMissing: FactId[];
  /** If one of these issues is raised, this one is folded into it. */
  subsumedBy?: string[];
  /** When every covering record is excluded by an explicit negative fact, ask this before abstaining. */
  rerouteTo?: FactId;
};

export type PredicateTable = {
  issues: IssueDefinition[];
  records: RecordPredicates[];
  /** Production: never "sufficient" while an official missing fact is still askable. */
  enforceMissingInformation: boolean;
};

const tri = (b: boolean): Tri => (b ? "holds" : "unknown");
const not = (t: Tri): Tri => (t === "holds" ? "fails" : t === "fails" ? "holds" : "unknown");
const all = (...ts: Tri[]): Tri => (ts.includes("fails") ? "fails" : ts.every((t) => t === "holds") ? "holds" : "unknown");

// ---------------------------------------------------------------------------
// Production records KB-001 … KB-006
// ---------------------------------------------------------------------------

const KB001: RecordPredicates = {
  source_id: "KB-001",
  issue: "deferred_price_above_cash",
  groundingScope: "general",
  required: [
    { id: "sale_contract", basis: "KB-001 applicability: وجود عقد بيع لسلعة أو خدمة", evaluate: (f) => f.isSale(), clarifiableBy: "relationship_nature" },
    { id: "deferred_price_known", basis: "KB-001 applicability: الثمن المؤجل معلوم ضمن العقد", evaluate: (f) => f.priceFixedAtContract(), clarifiableBy: "deferred_price_fixed_at_contract" },
    {
      id: "increase_part_of_agreed_price",
      basis: "KB-001 applicability: الزيادة جزء من الثمن المتفق عليه عند التعاقد",
      evaluate: (f) => all(tri(f.returnOrProfitStated()), f.priceFixedAtContract()),
      clarifiableBy: "deferred_price_fixed_at_contract",
    },
  ],
  exclusions: [{ id: "is_loan_with_increase", basis: "KB-001 must_not_generalize_to: قرض يشترط فيه رد مبلغ أكبر", evaluate: (f) => f.isLoan() }],
  separate: [
    { basis: "KB-001 must_not_generalize_to: زيادة تفرض بعد استقرار الدين بسبب التأخر", issue: "late_monetary_amount" },
    { basis: "KB-001 must_not_generalize_to: رسوم خدمة مجهولة الطبيعة", issue: "service_fee" },
  ],
};

const KB002: RecordPredicates = {
  source_id: "KB-002",
  issue: "installment_sale",
  groundingScope: "general",
  required: [
    { id: "sale_not_pure_loan", basis: "KB-002 applicability: المعاملة بيع وليست قرضًا محضًا", evaluate: (f) => f.isSale(), clarifiableBy: "relationship_nature" },
    { id: "deferred_price_known", basis: "KB-002 applicability: الثمن المؤجل معلوم", evaluate: (f) => f.priceFixedAtContract(), clarifiableBy: "deferred_price_fixed_at_contract" },
    { id: "several_payments", basis: "KB-002 applicability: السداد على دفعات أو آجال متعددة", evaluate: (f) => f.installments() },
  ],
  exclusions: [{ id: "is_loan_with_increase", basis: "KB-002 must_not_generalize_to: القروض ذات الزيادة", evaluate: (f) => f.isLoan() }],
  separate: [
    { basis: "KB-002 must_not_generalize_to: غرامات التأخير", issue: "late_monetary_amount" },
    { basis: "KB-002 must_not_generalize_to: الرسوم الإضافية غير الموصوفة", issue: "service_fee" },
  ],
};

const KB003: RecordPredicates = {
  source_id: "KB-003",
  issue: "acceleration_clause",
  groundingScope: "general",
  required: [
    {
      id: "installment_sale",
      basis: "KB-003 applicability: وجود بيع بالتقسيط",
      evaluate: (f) => all(f.isSale(), f.installments()),
      clarifiableBy: "relationship_nature",
    },
    { id: "accelerates_remaining_installments", basis: "KB-003 applicability: الشرط يتعلق بتعجيل استحقاق الأقساط المتبقية", evaluate: (f) => f.accelerationClause() },
    { id: "debtor_agreed_at_contract", basis: "KB-003 applicability: المدين رضي بالشرط عند التعاقد", evaluate: (f) => f.accelerationInContract() },
    {
      id: "no_new_monetary_increase",
      basis: "KB-003 applicability: لا توجد زيادة مالية جديدة لمجرد التأخير في هذا الوصف",
      evaluate: (f) => not(f.lateMonetaryAmount()),
    },
  ],
  exclusions: [{ id: "debt_not_from_installment_sale", basis: "KB-003 must_not_generalize_to: دين بأقساط لا ينشأ عن بيع بالتقسيط", evaluate: (f) => f.isLoan() }],
  separate: [
    { basis: "KB-003 must_not_generalize_to: غرامة مالية إضافية بسبب التأخير", issue: "late_monetary_amount" },
    { basis: "KB-003 must_not_generalize_to: زيادة أصل الدين بعد حلول الأجل", issue: "late_monetary_amount" },
    { basis: "KB-003 must_not_generalize_to: رسوم تأخير غير محددة الطبيعة", issue: "late_monetary_amount" },
  ],
};

const KB004: RecordPredicates = {
  source_id: "KB-004",
  issue: "murabaha_structure",
  groundingScope: "structural_general_information",
  required: [
    { id: "specific_goods", basis: "KB-004 applicability: وجود سلعة محددة", evaluate: (f) => tri(f.productStated()) },
    {
      id: "intermediary_buys_goods",
      basis: "KB-004 applicability: وجود جهة وسيطة تشتري السلعة",
      evaluate: (f) => all(tri(f.financingPartyStated()), f.intermediaryOwnsBeforeSale()),
      clarifiableBy: "ownership_before_sale",
    },
    { id: "sells_on_to_customer", basis: "KB-004 applicability: الجهة تبيع السلعة لاحقًا للعميل", evaluate: (f) => f.soldOnToCustomer() },
    {
      id: "known_profit_or_installments",
      basis: "KB-004 applicability: وجود ربح معلوم أو تقسيط",
      evaluate: (f) => (f.returnOrProfitStated() || f.installments() === "holds" ? "holds" : "unknown"),
    },
  ],
  exclusions: [
    { id: "only_pays_money", basis: "KB-004 must_not_generalize_to: مجرد دفع الجهة المال للعميل كقرض", evaluate: (f) => not(f.intermediaryOwnsBeforeSale()) },
    {
      id: "does_not_own_before_sale",
      basis: "KB-004 must_not_generalize_to: حالة لا تملك فيها الجهة السلعة قبل البيع دون تحقق إضافي",
      evaluate: (f) => not(f.intermediaryOwnsBeforeSale()),
    },
  ],
  // The remaining must_not items are enforced by groundingScope (structural only), not by facts:
  separate: [
    { basis: "KB-004 must_not_generalize_to: حكم عام بجواز أو منع المرابحة للآمر بالشراء", issue: "scope:structural_general_information" },
    { basis: "KB-004 must_not_generalize_to: حكم على صحة معاملة بعينها دون معرفة كون الوعد ملزمًا وحصول الملك والقبض", issue: "scope:structural_general_information" },
    { basis: "KB-004 must_not_generalize_to: الحكم على عقد مرابحة شخصي كامل من وصف مختصر", issue: "scope:structural_general_information" },
  ],
};

const KB005: RecordPredicates = {
  source_id: "KB-005",
  issue: "loan_increase",
  groundingScope: "general",
  required: [
    { id: "is_loan", basis: "KB-005 applicability: العلاقة قرض", evaluate: (f) => f.isLoan(), clarifiableBy: "relationship_nature" },
    {
      id: "conditioned_benefit_for_lender",
      basis: "KB-005 applicability: هناك زيادة أو منفعة مشروطة للمقرض",
      evaluate: (f) => all(tri(f.returnOrProfitStated()), f.increaseConditionedAtContract()),
      clarifiableBy: "loan_increase_conditioned_at_contract",
    },
    {
      id: "condition_at_loan_creation",
      basis: "KB-005 applicability: الشرط موجود عند إنشاء القرض",
      evaluate: (f) => f.increaseConditionedAtContract(),
      clarifiableBy: "loan_increase_conditioned_at_contract",
    },
  ],
  exclusions: [{ id: "is_deferred_sale", basis: "KB-005 must_not_generalize_to: بيع سلعة بثمن مؤجل أعلى متفق عليه من البداية", evaluate: (f) => f.isSale() }],
  separate: [
    { basis: "KB-005 must_not_generalize_to: هبة غير مشروطة تحتاج سياقًا مستقلًا", issue: "unconditioned_gift (fails condition_at_loan_creation)" },
    { basis: "KB-005 must_not_generalize_to: رسوم خدمة فعلية قبل التحقق من طبيعتها", issue: "service_fee" },
  ],
};

const KB006: RecordPredicates = {
  source_id: "KB-006",
  issue: "loan_increase",
  groundingScope: "general",
  required: [
    { id: "is_loan", basis: "KB-006 applicability: المعاملة قرض", evaluate: (f) => f.isLoan(), clarifiableBy: "relationship_nature" },
    { id: "increase_by_amount_or_time", basis: "KB-006 applicability: الفائدة أو الزيادة مرتبطة بالمبلغ أو الزمن", evaluate: (f) => f.increaseByAmountOrTime() },
    {
      id: "return_conditioned_on_borrower",
      basis: "KB-006 applicability: العائد مشروط على المقترض",
      evaluate: (f) => f.increaseConditionedAtContract(),
      clarifiableBy: "loan_increase_conditioned_at_contract",
    },
  ],
  exclusions: [
    { id: "installment_sale_fixed_price", basis: "KB-006 must_not_generalize_to: بيع بالتقسيط بسعر نهائي معلوم", evaluate: (f) => f.isSale() },
    { id: "murabaha_after_ownership", basis: "KB-006 must_not_generalize_to: مرابحة لسلعة بعد تملكها", evaluate: (f) => f.intermediaryOwnsBeforeSale() },
  ],
  separate: [{ basis: "KB-006 must_not_generalize_to: رسوم مستقلة لا نعرف طبيعتها", issue: "service_fee" }],
};

// ---------------------------------------------------------------------------
// Production issues
// ---------------------------------------------------------------------------

export const PRODUCTION_ISSUES: IssueDefinition[] = [
  {
    id: "deferred_price_above_cash",
    description: "بيع بثمن مؤجل أعلى من الثمن النقدي",
    raisedWhen: (f) => f.selectionRelationship() === "sale" && f.returnOrProfitStated(),
    covering: ["KB-001"],
    pendingWhenMissing: ["relationship_nature", "deferred_price_fixed_at_contract"],
  },
  {
    id: "installment_sale",
    description: "بيع بالتقسيط",
    raisedWhen: (f) => f.selectionRelationship() === "sale" && f.installments() === "holds",
    covering: ["KB-002"],
    pendingWhenMissing: ["relationship_nature", "deferred_price_fixed_at_contract"],
    // KB-001, KB-003 and KB-004 each address a specific term of an installment arrangement.
    subsumedBy: ["deferred_price_above_cash", "acceleration_clause", "murabaha_structure"],
  },
  {
    id: "acceleration_clause",
    description: "حلول الأقساط المتبقية عند التأخر",
    raisedWhen: (f) => f.accelerationClause() === "holds",
    covering: ["KB-003"],
    pendingWhenMissing: ["relationship_nature"],
  },
  {
    id: "murabaha_structure",
    description: "جهة تشتري السلعة ثم تبيعها للعميل",
    raisedWhen: (f) => f.t.category === "murabaha_purchase_orderer" || (f.financingPartyStated() && f.intermediaryOwnsBeforeSale() === "holds"),
    covering: ["KB-004"],
    pendingWhenMissing: ["ownership_before_sale", "intermediary_role"],
    rerouteTo: "relationship_nature",
  },
  {
    id: "loan_increase",
    description: "قرض مع زيادة",
    raisedWhen: (f) => f.selectionRelationship() === "loan" && f.returnOrProfitStated(),
    covering: ["KB-005", "KB-006"],
    pendingWhenMissing: ["relationship_nature", "loan_increase_conditioned_at_contract"],
  },
  {
    id: "service_fee",
    description: "رسوم مرتبطة بالمعاملة (لا يغطيها أي سجل معتمد حاليًا)",
    raisedWhen: (f) => f.feesStated(),
    covering: [],
    pendingWhenMissing: ["fee_nature"],
  },
  {
    id: "late_monetary_amount",
    description: "مبلغ مالي بسبب التأخر (لا يغطيه أي سجل معتمد حاليًا)",
    raisedWhen: (f) => f.lateMonetaryAmount() === "holds",
    covering: [],
    pendingWhenMissing: ["late_amount_nature"],
  },
];

/** Facts that identify which issue applies at all; asked when no issue can be raised yet. */
export const IDENTIFICATION_FACTS: readonly FactId[] = ["relationship_nature", "intermediary_role"];

export const PRODUCTION_PREDICATES: PredicateTable = {
  issues: PRODUCTION_ISSUES,
  records: [KB001, KB002, KB003, KB004, KB005, KB006],
  enforceMissingInformation: true,
};

/** Adds an environment's own issues and records (used by the benchmark harness for fixtures). */
export function extendPredicateTable(base: PredicateTable, extra: Pick<PredicateTable, "issues" | "records">): PredicateTable {
  const issues = base.issues.map((i) => ({ ...i, covering: [...i.covering] }));
  for (const issue of extra.issues) {
    const existing = issues.find((i) => i.id === issue.id);
    if (existing) existing.covering.push(...issue.covering);
    else issues.push(issue);
  }
  return { ...base, issues, records: [...base.records, ...extra.records] };
}
