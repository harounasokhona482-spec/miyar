import type { Transaction } from "../../domain/schemas/transaction";

/**
 * Canned model outputs for FakeProvider, keyed by benchmark case id
 * (test_set_v2.json, first turn). Test/dev data only: these stand in for
 * what a well-behaved model should return. Every evidence_span is copied
 * verbatim from the case's user message.
 */

const U = { value: null, provenance: "unknown" } as const;
const E = <V>(value: V, evidence_span: string) => ({ value, provenance: "explicit" as const, evidence_span });
const I = <V>(value: V) => ({ value, provenance: "inferred" as const });

function base(overrides: Partial<Transaction>): Transaction {
  return {
    category: "unknown",
    possible_classification: U,
    relationship_type: U,
    user_intent: "general_knowledge",
    in_scope: true,
    parties: [],
    product_or_service: U,
    payment_method: U,
    payment_schedule: U,
    fees: { exists: U, type: U, amount_or_rate: U },
    late_penalty: { exists: U, details: U },
    financing_party: U,
    ownership_transfer: U,
    return_or_profit: U,
    price_fixed_at_contract: U,
    increase_conditioned_at_contract: U,
    missing_information: [],
    needs_clarification: false,
    ...overrides,
  };
}

export const EXTRACTION_RESPONSES: Readonly<Record<string, Transaction>> = {
  T001: base({
    category: "sale_installments",
    possible_classification: I("بيع بالتقسيط بثمن مؤجل أعلى من النقدي"),
    relationship_type: E("sale", "إذا اشتريته بالتقسيط"),
    product_or_service: E("هاتف", "وجدت هاتفًا"),
    payment_method: E("تقسيط", "اشتريته بالتقسيط"),
    payment_schedule: E("10 أشهر", "على 10 أشهر"),
    return_or_profit: E(
      "سعر التقسيط 3400 درهم مقابل 3000 درهم نقدًا، متفق عليه من البداية",
      "سعره نقدًا 3000 درهم، وإذا اشتريته بالتقسيط يكون السعر 3400 درهم",
    ),
    price_fixed_at_contract: E(true, "وتم الاتفاق من البداية على سعر 3400"),
  }),

  T004: base({
    category: "murabaha_purchase_orderer",
    possible_classification: I("مرابحة للآمر بالشراء"),
    relationship_type: I("murabaha"),
    parties: [
      { role: "customer", description: I("المستخدم") },
      { role: "financing_party", description: E("شركة تمويل", "طلبت من شركة تمويل") },
      { role: "supplier", description: E("المعرض", "من المعرض") },
    ],
    product_or_service: E("سيارة", "شراء سيارة"),
    payment_method: E("أقساط", "على أقساط"),
    financing_party: E("شركة تمويل", "شركة تمويل"),
    ownership_transfer: E("الشركة تشتري السيارة أولًا ثم تبيعها للمستخدم", "والشركة ستشتريها أولًا ثم تبيعها لي"),
    return_or_profit: E("ثمن معلوم", "بثمن معلوم"),
    price_fixed_at_contract: E(true, "بثمن معلوم"),
  }),

  T005: base({
    category: "loan_with_conditioned_increase",
    possible_classification: I("قرض مع زيادة مشروطة"),
    relationship_type: E("loan", "أقرضني"),
    parties: [{ role: "lender", description: E("شخص", "شخص أقرضني") }],
    payment_schedule: E("السداد بعد سنة", "أعيدها بعد سنة"),
    financing_party: E("شخص", "شخص أقرضني"),
    return_or_profit: E(
      "يرد 11,000 عن قرض 10,000، والزيادة مشروطة من البداية",
      "أقرضني 10,000 وقال أعيدها بعد سنة 11,000، والزيادة جزء من الاتفاق من البداية",
    ),
    increase_conditioned_at_contract: E(true, "والزيادة جزء من الاتفاق من البداية"),
  }),

  T006: base({
    category: "bnpl",
    possible_classification: I("شراء بالتقسيط عبر تطبيق"),
    relationship_type: E("sale", "أشتري بالتقسيط"),
    parties: [{ role: "seller_app", description: E("تطبيق", "من تطبيق") }],
    payment_method: E("تقسيط", "أشتري بالتقسيط"),
    fees: {
      exists: E(true, "بسبب رسوم التطبيق"),
      type: U,
      amount_or_rate: E("أعلى قليلًا", "والسعر أعلى قليلًا"),
    },
    missing_information: ["طبيعة رسوم التطبيق", "هل تتغير الرسوم مع قيمة التمويل أو المدة"],
    needs_clarification: true,
  }),

  T007: base({
    category: "bnpl",
    possible_classification: I("دفع الثمن عن المشتري ثم السداد لاحقًا"),
    parties: [{ role: "app", description: E("التطبيق", "التطبيق يدفع") }],
    product_or_service: E("سلعة", "ثمن السلعة"),
    payment_method: E("التطبيق يدفع الثمن ثم يسدد المستخدم له", "التطبيق يدفع ثمن السلعة عني ثم أسدد له لاحقًا"),
    payment_schedule: E("لاحقًا", "أسدد له لاحقًا"),
    financing_party: E("التطبيق", "التطبيق يدفع"),
    missing_information: ["هل يشتري التطبيق السلعة ويمتلكها ثم يبيعها أم يدفع المال فقط"],
    needs_clarification: true,
  }),

  T008: base({
    category: "late_payment_terms",
    possible_classification: I("مبلغ مرتبط بالتأخر في الدفع"),
    late_penalty: { exists: E(true, "هناك مبلغ إذا تأخرت في الدفع"), details: U },
    missing_information: ["طبيعة المبلغ", "هل هو زيادة على الدين", "لمن يذهب المبلغ"],
    needs_clarification: true,
  }),

  T009: base({
    category: "murabaha_purchase_orderer",
    possible_classification: I("مرابحة محتملة"),
    relationship_type: I("murabaha"),
    parties: [{ role: "bank", description: E("البنك", "البنك سيمول") }],
    product_or_service: E("سيارة", "السيارة"),
    payment_method: E("بيع بالأقساط", "ويبيعها لي بالأقساط"),
    financing_party: E("البنك", "البنك سيمول السيارة"),
    ownership_transfer: U,
    missing_information: ["هل يشتري البنك السيارة ويمتلكها قبل أن يبيعها"],
    needs_clarification: true,
  }),

  T002: base({
    category: "sale_installments",
    possible_classification: I("بيع بالتقسيط بسعر نهائي ثابت"),
    relationship_type: E("sale", "اشتريت جهازًا"),
    parties: [{ role: "seller", description: E("متجر", "من متجر") }],
    product_or_service: E("جهاز", "جهازًا"),
    payment_schedule: E("6 دفعات", "على 6 دفعات"),
    price_fixed_at_contract: E(true, "والسعر النهائي ثابت منذ توقيع العقد"),
  }),

  T003: base({
    category: "late_payment_terms",
    possible_classification: I("شرط حلول الأقساط عند التأخر"),
    payment_method: E("أقساط", "الأقساط المتبقية"),
    late_penalty: {
      exists: E(false, "ولا توجد زيادة مالية إضافية"),
      details: E(
        "تصبح كل الأقساط المتبقية مستحقة فورًا عند التأخر عن قسط",
        "العقد يقول إنه إذا تأخرت عن قسط واحد تصبح كل الأقساط المتبقية مستحقة فورًا",
      ),
    },
  }),

  T013: base({
    category: "out_of_scope",
    in_scope: false,
    possible_classification: I("تداول عقود الخيارات على الأسهم"),
    product_or_service: E("تداول Options على الأسهم", "تداول Options على الأسهم"),
  }),

  T014: base({
    category: "out_of_scope",
    in_scope: false,
    possible_classification: I("أرباح Staking في العملات الرقمية"),
    product_or_service: E("Staking في العملات الرقمية", "Staking في العملات الرقمية"),
    return_or_profit: E("أرباح Staking", "أرباح Staking"),
  }),

  T016: base({
    category: "sale_installments",
    possible_classification: I("خطة تقسيط مع تحويل الأقساط إلى وحدات"),
    relationship_type: E("sale", "اشتريت ثلاجة"),
    parties: [{ role: "seller", description: E("متجر المدار", "متجر المدار") }],
    product_or_service: E("ثلاجة", "ثلاجة"),
    payment_method: E("خطة سَرْو للتقسيط", "خطة سَرْو للتقسيط"),
    payment_schedule: E("تحويل الأقساط المتبقية إلى وحدات سَرْو", "تحويل الأقساط المتبقية إلى وحدات سَرْو"),
  }),

  T017: base({
    category: "sale_installments",
    possible_classification: I("بيع بالتقسيط بعقد لُجَين"),
    relationship_type: E("sale", "اشتريت جهازًا"),
    parties: [{ role: "seller", description: E("شركة نسيم", "شركة نسيم") }],
    product_or_service: E("جهاز", "جهازًا"),
    payment_method: E("عقد لُجَين للتقسيط", "بعقد لُجَين للتقسيط"),
  }),

  T019: base({
    category: "sale_installments",
    possible_classification: I("بيع بالتقسيط بسعر إجمالي ثابت"),
    relationship_type: E("sale", "اشتريت غسالة"),
    parties: [{ role: "seller", description: E("متجر", "من متجر") }],
    product_or_service: E("غسالة", "غسالة"),
    payment_schedule: E("12 قسطًا شهريًا", "على 12 قسطًا شهريًا"),
    price_fixed_at_contract: E(true, "والسعر الإجمالي محدد في العقد من البداية ولا يتغير"),
  }),

  T020: base({
    category: "bnpl",
    possible_classification: I("شراء بالتقسيط عبر تطبيق برسوم خدمة شهرية"),
    relationship_type: E("sale", "للشراء بالتقسيط"),
    parties: [{ role: "app", description: E("تطبيق", "تطبيقًا") }],
    payment_method: E("تقسيط", "للشراء بالتقسيط"),
    fees: {
      exists: E(true, "رسوم خدمة كل شهر"),
      type: E("رسوم خدمة", "رسوم خدمة"),
      amount_or_rate: E("كل شهر", "كل شهر"),
    },
  }),

  T015: base({
    category: "bnpl",
    possible_classification: I("تمويل شراء عبر تطبيق باشتراك ورسوم وعمولة"),
    parties: [
      { role: "app", description: E("التطبيق", "التطبيق يدفع عني") },
      { role: "store", description: E("المتجر", "عمولة من المتجر") },
    ],
    payment_method: E("التطبيق يدفع عن المستخدم", "التطبيق يدفع عني"),
    fees: {
      exists: E(true, "ويأخذ اشتراكًا شهريًا ورسوم خدمة"),
      type: E("اشتراك شهري ورسوم خدمة", "اشتراكًا شهريًا ورسوم خدمة"),
      amount_or_rate: E("تختلف حسب الخطة", "تختلف حسب الخطة"),
    },
    financing_party: E("التطبيق", "التطبيق يدفع عني"),
    return_or_profit: E("عمولة من المتجر", "يحصل على عمولة من المتجر"),
    missing_information: ["طبيعة الاشتراك الشهري", "كيفية احتساب رسوم الخدمة", "العلاقة التعاقدية بين التطبيق والمتجر والمستخدم"],
    needs_clarification: true,
  }),
};
