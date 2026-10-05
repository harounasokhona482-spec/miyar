import { describe, expect, it } from "vitest";
import kbV2 from "../../knowledge_base_v2.json";
import { KnowledgeBaseV2FileSchema } from "../domain/schemas/knowledgeRecord";
import { answerClarification, startClarification, stepAfterEvidence, type ClarificationState } from "./clarification";
import { registeredClaims } from "./claimRegistry";
import { canned, caseOf, conversation, evaluate, firstTurn, productionKnowledge, replyProvider } from "./testdata/benchmarkHarness";

const stateFor = (id: string): ClarificationState => {
  const step = startClarification(canned(id));
  if (step.outcome === "failed") throw new Error("failed");
  return step.state;
};

describe("evidence steers clarification", () => {
  it("T003: answerable with conditional support → continue, no question", () => {
    expect(stepAfterEvidence(stateFor("T003"), firstTurn("T003")).outcome).toBe("continue");
  });

  it("T020: once the fee is described and no record covers it, further questions stop", async () => {
    const last = (await conversation("T020")).at(-1)!;
    expect(last.step.outcome).toBe("ask"); // missing-information detection alone would ask about the price next
    const step = stepAfterEvidence((last.step as { state: ClarificationState }).state, last.evidence);
    expect(step).toMatchObject({ outcome: "stopped_by_evidence", reasons: ["issue_uncovered: service_fee"] });
  });

  it("T009: asks only the evidence gate's askFacts", () => {
    const step = stepAfterEvidence(stateFor("T009"), firstTurn("T009"));
    expect(step).toMatchObject({ outcome: "ask", question: { fact_id: "ownership_before_sale" } });
  });

  it("after an explicit «لا» on ownership, asks the rerouted relationship question", async () => {
    const ask = startClarification(canned("T009"));
    if (ask.outcome !== "ask") throw new Error("expected a question");
    const answered = await answerClarification(ask.state, "لا", replyProvider);
    if (answered.outcome === "failed") throw new Error("failed");
    const evidence = evaluate(caseOf("T009"), answered.state.transaction, [caseOf("T009").turns[0]!.user_message]);
    expect(stepAfterEvidence(answered.state, evidence)).toMatchObject({ outcome: "ask", question: { fact_id: "relationship_nature", round: 2 } });
  });

  it("T017: a missing fact with no reviewed question stops instead of improvising one", () => {
    const step = stepAfterEvidence(stateFor("T017"), firstTurn("T017"));
    expect(step).toMatchObject({ outcome: "stopped_by_evidence", reasons: ["no_reviewed_question_for_missing_fact"] });
  });
});

describe("claim registry", () => {
  it("registers every supported claim with a stable, sequential id and a location", () => {
    const k = productionKnowledge();
    const all = [...k.values()].flatMap(registeredClaims);
    expect(all).toHaveLength(kbV2.records.reduce((n, r) => n + r.claims_check.length, 0));
    for (const r of kbV2.records) {
      expect(r.claims_check.map((c) => c.claim_id)).toEqual(r.claims_check.map((_, i) => `${r.source_id}-C${String(i + 1).padStart(2, "0")}`));
    }
    expect(all.filter((c) => c.source_id === "KB-004").every((c) => c.claim_scope === "structural")).toBe(true);
    expect(all.find((c) => c.claim_id === "KB-006-C03")!.location.startsWith("الهامش (1)")).toBe(true);
  });

  it("rejects an out-of-sequence claim_id and a general claim on a structural_only record", () => {
    const a = structuredClone(kbV2);
    a.records[0]!.claims_check[0]!.claim_id = "KB-001-C07";
    expect(KnowledgeBaseV2FileSchema.safeParse(a).success).toBe(false);
    const b = structuredClone(kbV2);
    b.records[3]!.claims_check[0]!.claim_scope = "general";
    expect(KnowledgeBaseV2FileSchema.safeParse(b).success).toBe(false);
  });
});
