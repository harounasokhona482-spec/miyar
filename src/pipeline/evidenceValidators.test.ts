import { describe, expect, it } from "vitest";
import { negatesIncrease, validateMaterialEvidence } from "./evidenceValidators";

/**
 * Negated financial facts: an increase/interest/return can never be established
 * from words that deny it, whatever the model labels the field.
 */

const explicit = (value: unknown, evidence_span: string) => ({ value, evidence_span });
const DOWNGRADE = { reason: "insufficient_lexical_evidence", to: "unknown" };

describe("negatesIncrease", () => {
  it.each([
    "لا توجد زيادة",
    "بدون فائدة",
    "المبلغ نفسه دون زيادة",
    "لا توجد أرباح إضافية",
    "لا يزيد المبلغ",
    "ولا توجد أي زيادة إذا التزمت بالمواعيد",
    "ولا توجد زيادة مالية إضافية",
    "من غير فوائد",
    "خالية من الفوائد",
    "بلا عائد",
    "لن يزداد المبلغ",
  ])("detects the denied increase in «%s»", (text) => {
    expect(negatesIncrease(text)).toBe(true);
  });

  it.each([
    "أقرضني 10,000 وقال أعيدها بعد سنة 11,000، والزيادة جزء من الاتفاق من البداية",
    "فائدة 5% سنويًا على المبلغ",
    "زيادة 1,000 لا تتغير",
    "إذا لم أدفع في الموعد تزيد الأقساط",
    "قال لا مشكلة، والزيادة 1,000",
    "سعر التقسيط 3400 درهم مقابل 3000 درهم نقدًا",
  ])("does not treat «%s» as denying an increase", (text) => {
    expect(negatesIncrease(text)).toBe(false);
  });
});

describe("validateMaterialEvidence: return_or_profit", () => {
  it.each([
    ["لا توجد زيادة", "لا توجد زيادة"],
    ["بدون فائدة", "أعيدها بعد شهرين بدون فائدة"],
    ["المبلغ نفسه دون زيادة", "أرد المبلغ نفسه دون زيادة"],
    // What the real model returned for T002 before the prompt fix.
    ["لا توجد أي زيادة إذا التزمت بالمواعيد", "لا توجد أي زيادة إذا التزمت بالمواعيد"],
  ])("a denied increase («%s») is downgraded to unknown", (value, span) => {
    expect(validateMaterialEvidence("return_or_profit", explicit(value, span))).toEqual(DOWNGRADE);
  });

  it("a positive value is downgraded when its span denies the increase", () => {
    expect(validateMaterialEvidence("return_or_profit", explicit("زيادة 1,000", "لا توجد زيادة"))).toEqual(DOWNGRADE);
  });

  it("keeps a real stated increase (T005)", () => {
    const span = "أقرضني 10,000 وقال أعيدها بعد سنة 11,000، والزيادة جزء من الاتفاق من البداية";
    expect(validateMaterialEvidence("return_or_profit", explicit("يرد 11,000 عن قرض 10,000، والزيادة مشروطة من البداية", span))).toBeNull();
  });

  it("keeps stated prices (T001)", () => {
    const span = "سعره نقدًا 3000 درهم، وإذا اشتريته بالتقسيط يكون السعر 3400 درهم";
    expect(validateMaterialEvidence("return_or_profit", explicit("سعر التقسيط 3400 درهم مقابل 3000 درهم نقدًا", span))).toBeNull();
  });
});

describe("validateMaterialEvidence: increase_conditioned_at_contract", () => {
  it("rejects «the increase was conditioned» from a span that denies the increase", () => {
    expect(validateMaterialEvidence("increase_conditioned_at_contract", explicit(true, "لا توجد زيادة مشروطة في الاتفاق"))).toEqual(DOWNGRADE);
  });

  it("keeps an explicit «no» on the same words", () => {
    expect(validateMaterialEvidence("increase_conditioned_at_contract", explicit(false, "لا توجد زيادة مشروطة في الاتفاق"))).toBeNull();
  });

  it("keeps a real conditioned increase (T005)", () => {
    expect(validateMaterialEvidence("increase_conditioned_at_contract", explicit(true, "والزيادة جزء من الاتفاق من البداية"))).toBeNull();
  });
});
