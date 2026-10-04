import type { PipelineResult } from "./pipelineResult";
import type { EvalCase } from "./evalCase";

/**
 * Benchmark fields that string matching cannot check. In v2 they are
 * reviewed manually for critical cases. ReviewJudge is the seam for a
 * future automated judge; nothing implements it yet.
 */
export const JUDGED_FIELDS = ["required_clarification", "required_reasoning_checks", "forbidden_behaviors"] as const;
export type JudgedField = (typeof JUDGED_FIELDS)[number];

export type ReviewVerdict = {
  field: JudgedField;
  item: string;
  verdict: "pass" | "fail" | "needs_review";
  reviewer: "manual" | "llm";
  note?: string;
};

export interface ReviewJudge {
  review(testCase: EvalCase, turnResults: readonly PipelineResult[]): Promise<ReviewVerdict[]>;
}
