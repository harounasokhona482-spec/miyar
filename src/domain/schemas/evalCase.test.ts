import { describe, expect, it } from "vitest";
import { EvalCaseSchema } from "./evalCase";

const base = {
  id: "T900",
  category: "unit",
  turns: [{ user_message: "سؤال", accepted_states: ["GROUNDED"] }],
};

describe("EvalCaseSchema", () => {
  it("accepts a minimal case and fills defaults", () => {
    const parsed = EvalCaseSchema.parse(base);
    expect(parsed.kb_mode).toBe("production");
    expect(parsed.expected_retrieved_source_ids).toEqual([]);
    expect(parsed.policy_preserved).toBe(false);
  });

  it("rejects POLICY_PRESERVED and composite strings as states", () => {
    for (const state of ["POLICY_PRESERVED", "DISPUTED_OR_NEEDS_CLARIFICATION"]) {
      expect(EvalCaseSchema.safeParse({ ...base, turns: [{ user_message: "س", accepted_states: [state] }] }).success).toBe(false);
    }
  });

  it("requires policy_preserved cases to be critical with the injection assertion", () => {
    expect(EvalCaseSchema.safeParse({ ...base, policy_preserved: true }).success).toBe(false);
    expect(
      EvalCaseSchema.safeParse({
        ...base,
        policy_preserved: true,
        critical: true,
        critical_assertions: ["policy_preserved_under_injection"],
      }).success,
    ).toBe(true);
  });

  it("rejects cited expectations when the final turn cannot answer", () => {
    const c = { ...base, turns: [{ user_message: "س", accepted_states: ["REFERRAL"] }], expected_cited_source_ids: ["KB-001"] };
    expect(EvalCaseSchema.safeParse(c).success).toBe(false);
  });

  it("rejects required citations outside the allowed list, and forbidden ones inside it", () => {
    expect(EvalCaseSchema.safeParse({ ...base, expected_cited_source_ids: ["KB-001"], required_cited_source_ids: ["KB-002"] }).success).toBe(false);
    expect(EvalCaseSchema.safeParse({ ...base, expected_cited_source_ids: ["KB-001"], forbidden_cited_source_ids: ["KB-001"] }).success).toBe(false);
  });

  it("requires a fixture exactly when kb_mode is not production", () => {
    expect(EvalCaseSchema.safeParse({ ...base, kb_mode: "fixture_only" }).success).toBe(false);
    expect(EvalCaseSchema.safeParse({ ...base, fixture: "x.json" }).success).toBe(false);
    expect(EvalCaseSchema.safeParse({ ...base, kb_mode: "fixture_only", fixture: "x.json" }).success).toBe(true);
  });

  it("accepts only TECHNICAL_ERROR when a failure is injected", () => {
    const failing = { ...base, critical: true, inject_failure: { stage: "generation", mode: "timeout" } };
    expect(EvalCaseSchema.safeParse(failing).success).toBe(false);
    expect(
      EvalCaseSchema.safeParse({ ...failing, turns: [{ user_message: "س", accepted_states: ["TECHNICAL_ERROR"] }] }).success,
    ).toBe(true);
  });

  it("requires clarification rounds to count up from 1 and caps turns at 4", () => {
    const nc = (round: number) => ({ user_message: "س", accepted_states: ["NEEDS_CLARIFICATION"], expected_clarification_round: round });
    expect(EvalCaseSchema.safeParse({ ...base, turns: [nc(1), nc(2), nc(3)] }).success).toBe(true);
    expect(EvalCaseSchema.safeParse({ ...base, turns: [nc(1), nc(3)] }).success).toBe(false);
    expect(EvalCaseSchema.safeParse({ ...base, turns: [nc(1), nc(2), nc(3), nc(4)] }).success).toBe(false);
    const five = Array.from({ length: 5 }, () => ({ user_message: "س", accepted_states: ["NEEDS_CLARIFICATION"] }));
    expect(EvalCaseSchema.safeParse({ ...base, turns: five }).success).toBe(false);
  });

  it("rejects clarification expectations on a turn that does not accept NEEDS_CLARIFICATION", () => {
    const turn = { user_message: "س", accepted_states: ["GROUNDED"], required_clarification: ["طبيعة الرسوم"] };
    expect(EvalCaseSchema.safeParse({ ...base, turns: [turn] }).success).toBe(false);
  });
});
