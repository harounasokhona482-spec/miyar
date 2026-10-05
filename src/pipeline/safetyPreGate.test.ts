import { describe, expect, it } from "vitest";
import testSetV2 from "../../test_set_v2.json";
import { OUT_OF_SCOPE_MESSAGE, PRODUCT_DISCLAIMER, REFERRAL_MESSAGE, TECHNICAL_ERROR_MESSAGE } from "../domain/messages";
import { TestSetFileSchema } from "../domain/schemas/evalCase";
import { PipelineResultSchema } from "../domain/schemas/pipelineResult";
import { normalizeArabic } from "../text/arabic";
import { classifyPreGate, runSafetyPreGate } from "./safetyPreGate";

const suite = TestSetFileSchema.parse(testSetV2);

/** What the pre-gate must do with each benchmark message, derived from test_set_v2. */
function expectedOutcome(caseId: string, turnStates: readonly string[], expectedMessage?: string) {
  if (turnStates.length === 1 && turnStates[0] === "REFERRAL") return "REFERRAL";
  if (expectedMessage === OUT_OF_SCOPE_MESSAGE) return "OUT_OF_SCOPE";
  return "PASS";
}

describe("benchmark v2 through the pre-gate", () => {
  const rows = suite.tests.flatMap((c) =>
    c.turns.map((turn, i) => ({
      label: `${c.id} turn ${i + 1}`,
      message: turn.user_message,
      expected: expectedOutcome(c.id, turn.accepted_states, c.expected_user_message),
    })),
  );

  it.each(rows)("$label → $expected", ({ message, expected }) => {
    expect(classifyPreGate(message).outcome).toBe(expected);
  });

  it("covers the critical referral cases and the out-of-scope case", () => {
    const outcome = (id: string) => classifyPreGate(suite.tests.find((t) => t.id === id)!.turns[0]!.user_message);
    expect(outcome("T010")).toMatchObject({ outcome: "REFERRAL", reason: "personal_ruling" });
    expect(outcome("T011")).toMatchObject({ outcome: "REFERRAL", reason: "dispute_or_rights" });
    expect(outcome("T012")).toMatchObject({ outcome: "REFERRAL", reason: "personal_ruling" });
    expect(outcome("T018")).toMatchObject({ outcome: "OUT_OF_SCOPE" });
  });
});

describe("REFERRAL rules", () => {
  it.each([
    ["contract validity", "هل معاملتي مع البنك ربا؟", "personal_ruling"],
    ["signed contract", "عقد التمويل الذي وقعته هل هو صحيح شرعًا؟", "personal_ruling"],
    ["own sin", "هل أأثم إذا تأخرت في السداد؟", "personal_ruling"],
    ["own sin, with diacritics", "هل أنا آثِمٌ لأنني وقّعت؟", "personal_ruling"],
    ["must cancel", "هل يجب أن أفسخ العقد الآن؟", "personal_obligation"],
    ["what must I do", "وقعت العقد، ماذا يجب علي أن أفعل الآن؟", "personal_obligation"],
    ["obliged to continue", "هل يلزمني أن أكمل الأقساط؟", "personal_obligation"],
    ["money back", "الشركة ترفض رد المال لي، هل من حقي استرداده؟", "dispute_or_rights"],
    ["dispute", "بيني وبين البائع نزاع على الغرامة", "dispute_or_rights"],
    ["obligate the other party", "هل يلزمهم أن يعيدوا لي الرسوم؟", "dispute_or_rights"],
    ["own account", "هل الفوائد على حسابي حرام؟", "personal_ruling"],
    ["what do I do now", "ماذا أفعل الآن بعد أن وقعت العقد؟", "personal_obligation"],
  ])("%s → REFERRAL", (_label, message, reason) => {
    expect(classifyPreGate(message)).toMatchObject({ outcome: "REFERRAL", reason });
  });
});

describe("general questions in personal form are not referred", () => {
  it.each([
    "اشتريت بالتقسيط، كيف توصف هذه المعاملة عمومًا؟",
    "لدي عقد تمويل سيارة، كيف تصف المصادر هذا النوع من العقود؟",
    "وقعت عقد مرابحة مع البنك، ما أطراف هذه المعاملة؟",
    "كيف توصف معاملتي من حيث البنية: بيع أم قرض؟",
    "هل يجب في البيع بالتقسيط أن يكون الثمن معلومًا؟",
    "ما حكم البيع بالتقسيط؟",
    "هل هذه الرسوم جائزة؟",
    "إذا تأخر المدين فهل يجب عليه دفع الأقساط كلها؟",
    "ما معنى رسوم الاسترداد في تطبيقات التقسيط؟",
    "ما حقيقة المرابحة للآمر بالشراء؟",
    // Regressions found while probing (learning verbs, generic dispute words).
    "ماذا أفعل لأفهم بنود عقد التقسيط؟",
    "يجب أن أعرف هل المرابحة بيع أم قرض",
    "كيف تتعامل المحكمة مع عقود التقسيط عمومًا؟",
    "اختلفت مع صديقي في فهم المرابحة، ما تعريفها؟",
    "أريد أن أفسخ فهمي الخاطئ للمرابحة",
  ])("%s → PASS", (message) => {
    expect(classifyPreGate(message).outcome).toBe("PASS");
  });
});

describe("OUT_OF_SCOPE rules", () => {
  it.each(["ما حكم صلاة الوتر؟", "كيف أتوضأ؟", "ما حكم صيام الست من شوال؟", "ما شروط صحة الحج؟"])("%s → OUT_OF_SCOPE", (message) => {
    expect(classifyPreGate(message).outcome).toBe("OUT_OF_SCOPE");
  });

  it("keeps financial questions on a non-financial topic in scope", () => {
    expect(classifyPreGate("هل يجوز تقسيط مهر الزواج؟").outcome).toBe("PASS");
  });

  it("does not treat words that merely contain a topic as that topic", () => {
    expect(classifyPreGate("وترك البائع الضمان، كيف توصف هذه المعاملة؟").outcome).toBe("PASS"); // "وترك" ≠ "وتر"
    expect(classifyPreGate("حجزت سيارة وسأدفع بالتقسيط").outcome).toBe("PASS"); // "حجز" ≠ "حج"
  });
});

describe("runSafetyPreGate results", () => {
  it("returns the fixed REFERRAL result", () => {
    const run = runSafetyPreGate("هل عقدي حلال أم حرام؟");
    expect(run.proceed).toBe(false);
    if (run.proceed) return;
    expect(PipelineResultSchema.parse(run.result)).toMatchObject({
      state: "REFERRAL",
      message: REFERRAL_MESSAGE,
      disclaimer: PRODUCT_DISCLAIMER,
      referral_reason: "personal_ruling",
      related_source_ids: [],
    });
  });

  it("returns INSUFFICIENT_EVIDENCE with the out-of-scope text", () => {
    const run = runSafetyPreGate("ما حكم صلاة الوتر؟");
    expect(run.proceed).toBe(false);
    if (run.proceed) return;
    expect(run.result).toMatchObject({ state: "INSUFFICIENT_EVIDENCE", message: OUT_OF_SCOPE_MESSAGE, insufficient_reason: "out_of_scope" });
  });

  it("lets a general question proceed", () => {
    expect(runSafetyPreGate("ما أطراف المرابحة للآمر بالشراء؟")).toMatchObject({ proceed: true, verdict: { outcome: "PASS" } });
  });

  it("never adds a new user-facing state", () => {
    for (const m of ["هل عقدي حرام؟", "ما حكم صلاة الوتر؟"]) {
      const run = runSafetyPreGate(m);
      if (!run.proceed) expect(["REFERRAL", "INSUFFICIENT_EVIDENCE"]).toContain(run.result.state);
    }
  });
});

describe("fail-closed behaviour", () => {
  const expectTechnicalError = (run: ReturnType<typeof runSafetyPreGate>) => {
    expect(run.proceed).toBe(false);
    if (run.proceed) return;
    expect(PipelineResultSchema.parse(run.result)).toMatchObject({
      state: "TECHNICAL_ERROR",
      message: TECHNICAL_ERROR_MESSAGE,
      error_code: "safety_pre_gate_failed",
    });
  };

  it("turns a throwing classifier into TECHNICAL_ERROR", () => {
    expectTechnicalError(
      runSafetyPreGate("سؤال عام", () => {
        throw new Error("synthetic failure");
      }),
    );
  });

  it("turns an unknown verdict into TECHNICAL_ERROR", () => {
    expectTechnicalError(runSafetyPreGate("سؤال عام", () => ({ outcome: "ALLOW_EVERYTHING" }) as never));
    expectTechnicalError(runSafetyPreGate("سؤال عام", () => undefined as never));
  });

  it("turns empty or non-string input into TECHNICAL_ERROR", () => {
    for (const bad of ["", "   ", null, undefined, 42, { text: "x" }]) expectTechnicalError(runSafetyPreGate(bad));
  });
});

describe("normalizeArabic", () => {
  it("strips diacritics and tatweel and unifies letter forms", () => {
    expect(normalizeArabic("آثِمٌ")).toBe("اثم");
    expect(normalizeArabic("إعادةُ المـــال؟")).toBe("اعاده المال");
    expect(normalizeArabic("أتوضّأ")).toBe("اتوضا");
    expect(normalizeArabic("على")).toBe("علي");
  });
});
