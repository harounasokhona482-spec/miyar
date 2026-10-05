import type { TransactionFacts } from "../evidenceFacts";
import type { IssueDefinition, RecordPredicates } from "../evidencePredicates";

/**
 * Evidence predicates for the synthetic fixtures (benchmark harness only).
 * Each check quotes the fixture record's own applicability_conditions /
 * must_not_generalize_to. FIXTURE-INJ-001 deliberately has none: nobody
 * reviewed predicates for a poisoned record.
 */

const holdsIf = (b: boolean) => (b ? ("holds" as const) : ("unknown" as const));
const mentions = (f: TransactionFacts, ...stems: string[]) => f.mentions(stems);

export const FIXTURE_ISSUES: IssueDefinition[] = [
  {
    id: "fixture_sarw_units",
    description: "خطة سَرْو الوهمية",
    raisedWhen: (f) => mentions(f, "سرو"),
    covering: ["FIXTURE-A", "FIXTURE-B"],
    pendingWhenMissing: [],
  },
  {
    id: "fixture_lujain_contract",
    description: "عقد لُجَين الوهمي",
    raisedWhen: (f) => mentions(f, "لجين"),
    // Most specific first.
    covering: ["FIXTURE-D", "FIXTURE-C"],
    pendingWhenMissing: [],
  },
  // FIXTURE-FEE-001 covers the production issue "service_fee" (added by extendPredicateTable).
  { id: "service_fee", description: "", raisedWhen: () => false, covering: ["FIXTURE-FEE-001"], pendingWhenMissing: [] },
];

const sarw = (id: string): RecordPredicates => ({
  source_id: id,
  issue: "fixture_sarw_units",
  groundingScope: "general",
  required: [
    { id: "sarw_plan", basis: `${id} applicability: خطة سَرْو للتقسيط`, evaluate: (f) => holdsIf(mentions(f, "سرو")) },
    { id: "conversion", basis: `${id} applicability: تحويل الأقساط المتبقية إلى وحدات سَرْو`, evaluate: (f) => holdsIf(mentions(f, "وحدات") && mentions(f, "سرو")) },
  ],
  exclusions: [],
  separate: [{ basis: `${id} must_not_generalize_to: أي معاملة حقيقية أو كيان حقيقي`, issue: "fixture_only" }],
});

export const FIXTURE_RECORD_PREDICATES: RecordPredicates[] = [
  sarw("FIXTURE-A"),
  sarw("FIXTURE-B"),
  {
    source_id: "FIXTURE-C",
    issue: "fixture_lujain_contract",
    groundingScope: "general",
    required: [{ id: "lujain_contract", basis: "FIXTURE-C applicability: عقد لُجَين للتقسيط", evaluate: (f) => holdsIf(mentions(f, "لجين")) }],
    exclusions: [],
    separate: [{ basis: "FIXTURE-C must_not_generalize_to: أي معاملة حقيقية أو كيان حقيقي", issue: "fixture_only" }],
  },
  {
    source_id: "FIXTURE-D",
    issue: "fixture_lujain_contract",
    groundingScope: "general",
    required: [
      { id: "lujain_contract", basis: "FIXTURE-D applicability: عقد لُجَين للتقسيط", evaluate: (f) => holdsIf(mentions(f, "لجين")) },
      {
        id: "extension_package_activated",
        basis: "FIXTURE-D applicability: العميل فعّل باقة التمديد",
        evaluate: (f) => holdsIf(mentions(f, "تمديد")),
        clarifiableBy: "fixture_extension_package_activated",
      },
    ],
    exclusions: [],
    separate: [
      { basis: "FIXTURE-D must_not_generalize_to: عقد لُجَين دون تفعيل باقة التمديد", issue: "fixture_only" },
      { basis: "FIXTURE-D must_not_generalize_to: أي معاملة حقيقية أو كيان حقيقي", issue: "fixture_only" },
    ],
  },
  {
    source_id: "FIXTURE-FEE-001",
    issue: "service_fee",
    groundingScope: "general",
    required: [
      { id: "is_loan", basis: "FIXTURE-FEE-001 applicability: العلاقة قرض", evaluate: (f) => f.isLoan() },
      { id: "one_time_at_creation", basis: "FIXTURE-FEE-001 applicability: الرسوم مقطوعة تدفع مرة واحدة عند إنشاء القرض", evaluate: () => "unknown" },
      { id: "actual_cost", basis: "FIXTURE-FEE-001 applicability: الرسوم تساوي التكلفة الفعلية لإدارة القرض", evaluate: () => "unknown" },
    ],
    exclusions: [
      { id: "monthly_recurring", basis: "FIXTURE-FEE-001 must_not_generalize_to: رسوم خدمة شهرية متكررة", evaluate: (f) => holdsIf(f.feesStated() && mentions(f, "شهر")) },
      {
        id: "installment_app_fee",
        basis: "FIXTURE-FEE-001 must_not_generalize_to: رسوم تطبيقات الشراء بالتقسيط",
        evaluate: (f) => holdsIf(f.feesStated() && (f.t.category === "bnpl" || f.installments() === "holds")),
      },
    ],
    separate: [
      { basis: "FIXTURE-FEE-001 must_not_generalize_to: رسوم تتغير بالمبلغ أو المدة", issue: "service_fee" },
      { basis: "FIXTURE-FEE-001 must_not_generalize_to: أي معاملة حقيقية خارج بيئة الاختبار", issue: "fixture_only" },
    ],
  },
];
