import { describe, expect, it } from "vitest";
import { DONT_KNOW_OPTION, PRODUCT_DISCLAIMER } from "../messages";
import { PipelineResultSchema } from "./pipelineResult";

const base = { message: "رسالة", disclaimer: PRODUCT_DISCLAIMER };

describe("GROUNDED contract", () => {
  const grounded = {
    ...base,
    state: "GROUNDED",
    supporting_source_ids: ["KB-001", "KB-002"],
    citations: [{ claim: "ادعاء", source_id: "KB-002", display: "summary" }],
  };

  it("accepts citations that are a subset of supporting sources", () => {
    expect(PipelineResultSchema.safeParse(grounded).success).toBe(true);
  });

  it("rejects a citation to a non-supporting source (T020 guard)", () => {
    const bad = { ...grounded, citations: [{ claim: "ادعاء", source_id: "KB-005", display: "summary" }] };
    expect(PipelineResultSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects GROUNDED without citations", () => {
    expect(PipelineResultSchema.safeParse({ ...grounded, citations: [] }).success).toBe(false);
  });
});

describe("DISPUTED contract", () => {
  const position = (id: string, issue = "I-1") => ({
    position_id: id,
    issue_id: issue,
    source_id: "FIXTURE-A",
    position_summary: "ملخص",
  });

  it("requires two distinct positions on the same issue", () => {
    expect(PipelineResultSchema.safeParse({ ...base, state: "DISPUTED", positions: [position("P-1"), position("P-2")] }).success).toBe(true);
    expect(PipelineResultSchema.safeParse({ ...base, state: "DISPUTED", positions: [position("P-1"), position("P-1")] }).success).toBe(false);
    expect(PipelineResultSchema.safeParse({ ...base, state: "DISPUTED", positions: [position("P-1"), position("P-2", "I-2")] }).success).toBe(false);
  });
});

describe("NEEDS_CLARIFICATION contract", () => {
  const clarification = (options: string[], round = 1) => ({
    ...base,
    state: "NEEDS_CLARIFICATION",
    clarification: { missing_fact: "ownership_transfer", question: "سؤال؟", options, round },
  });

  it("requires the 'I don't know' option", () => {
    expect(PipelineResultSchema.safeParse(clarification(["نعم", "لا", DONT_KNOW_OPTION])).success).toBe(true);
    expect(PipelineResultSchema.safeParse(clarification(["نعم", "لا"])).success).toBe(false);
  });

  it("allows at most three rounds", () => {
    expect(PipelineResultSchema.safeParse(clarification(["نعم", DONT_KNOW_OPTION], 3)).success).toBe(true);
    expect(PipelineResultSchema.safeParse(clarification(["نعم", DONT_KNOW_OPTION], 4)).success).toBe(false);
  });
});

describe("other states", () => {
  it("accepts REFERRAL and INSUFFICIENT_EVIDENCE with a reason", () => {
    expect(PipelineResultSchema.safeParse({ ...base, state: "REFERRAL", referral_reason: "personal_ruling" }).success).toBe(true);
    expect(PipelineResultSchema.safeParse({ ...base, state: "INSUFFICIENT_EVIDENCE", insufficient_reason: "out_of_scope" }).success).toBe(true);
  });

  it("rejects a state that is not one of the approved six", () => {
    expect(PipelineResultSchema.safeParse({ ...base, state: "POLICY_PRESERVED" }).success).toBe(false);
  });
});
