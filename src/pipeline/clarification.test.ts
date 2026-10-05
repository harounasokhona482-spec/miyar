import { describe, expect, it } from "vitest";
import testSetV2 from "../../test_set_v2.json";
import { FakeProvider } from "../ai/fakeProvider";
import { DONT_KNOW_OPTION, TECHNICAL_ERROR_MESSAGE } from "../domain/messages";
import { TestSetFileSchema } from "../domain/schemas/evalCase";
import { PipelineResultSchema } from "../domain/schemas/pipelineResult";
import type { Transaction } from "../domain/schemas/transaction";
import { answerClarification, startClarification, type ClarificationStep } from "./clarification";
import { CLARIFICATION_TEMPLATES } from "./clarificationTemplates";
import { comparable } from "./evidenceValidators";
import { listExtractedFields, userMessageOf } from "./extraction";
import { FACT_IDS } from "./missingInfo";
import { classifyPreGate } from "./safetyPreGate";
import { EXTRACTION_RESPONSES } from "./testdata/extractionResponses";

const suite = TestSetFileSchema.parse(testSetV2);
const turnsOf = (id: string) => suite.tests.find((t) => t.id === id)!.turns.map((t) => t.user_message);
const canned = (id: string): Transaction => structuredClone(EXTRACTION_RESPONSES[id]!);

const U = { value: null, provenance: "unknown" } as const;
const E = <V>(value: V, evidence_span: string) => ({ value, provenance: "explicit" as const, evidence_span });

/** Fake model for free-text replies, keyed by the reply text. */
function replyProvider(table: Record<string, object>) {
  const provider = new FakeProvider((request) => {
    expect(request.task).toBe("clarification_extraction");
    const response = table[userMessageOf(request)];
    if (!response) throw new Error("no canned clarification response");
    return JSON.stringify(response);
  });
  return provider;
}
const noProvider = new FakeProvider(() => {
  throw new Error("provider must not be called");
});

function expectAsk(step: ClarificationStep) {
  if (step.outcome !== "ask") throw new Error(`expected a question, got ${step.outcome}`);
  return step;
}

function fieldsExcept(t: Transaction, paths: string[]) {
  return listExtractedFields(t).filter((f) => !paths.includes(f.path));
}

describe("templates", () => {
  it.each(FACT_IDS)("%s: every variant is one main question with distinct options and no promise/possession topic", (id) => {
    for (const variant of CLARIFICATION_TEMPLATES[id].variants) {
      const text = variant.text({ party: "البنك" });
      expect((text.match(/؟/g) ?? []).length, text).toBeLessThanOrEqual(1);
      expect(text).not.toMatch(/وعد|قبض/);
      const labels = variant.options.map((o) => o.label);
      expect(new Set(labels).size).toBe(labels.length);
      expect(labels).not.toContain(DONT_KNOW_OPTION);
    }
  });

  it("uses the owner's wording for ownership and late amount", () => {
    expect(CLARIFICATION_TEMPLATES.ownership_before_sale.variants[0]!.text({ party: "" })).toBe("هل الجهة الممولة تشتري السلعة وتملكها قبل أن تبيعها لك؟");
    expect(CLARIFICATION_TEMPLATES.late_amount_nature.variants[0]!.text({ party: "" })).toBe(
      "هل هذا المبلغ يُضاف إلى المبلغ المستحق عليك بسبب التأخير، أم أنه رسم من نوع آخر؟",
    );
  });
});

describe("first question per case", () => {
  it.each([
    ["T006", "fee_nature", "كيف تُحسب هذه الرسوم؟"],
    ["T007", "intermediary_role", "هل يشتري التطبيق السلعة ويملكها ثم يبيعها لك، أم يدفع ثمنها عنك فقط؟"],
    ["T008", "late_amount_nature", "هل هذا المبلغ يُضاف إلى المبلغ المستحق عليك بسبب التأخير، أم أنه رسم من نوع آخر؟"],
    ["T009", "ownership_before_sale", "هل الجهة الممولة تشتري السلعة وتملكها قبل أن تبيعها لك؟"],
    ["T015", "intermediary_role", "هل يشتري التطبيق السلعة ويملكها ثم يبيعها لك، أم يدفع ثمنها عنك فقط؟"],
  ])("%s asks %s in round 1", (id, factId, question) => {
    const step = expectAsk(startClarification(canned(id)));
    expect(step.question).toMatchObject({ fact_id: factId, round: 1, question });
    expect(step.question.options.at(-1)).toBe(DONT_KNOW_OPTION);
    expect(PipelineResultSchema.parse(step.result)).toMatchObject({
      state: "NEEDS_CLARIFICATION",
      clarification: { missing_fact: factId, round: 1, question },
    });
  });

  it.each(["T001", "T004", "T005"])("%s needs no clarification → continue", (id) => {
    expect(startClarification(canned(id)).outcome).toBe("continue");
  });
});

describe("option answers update only the target field", () => {
  it("T006: a fee option sets fees.type and nothing else", async () => {
    const before = canned("T006");
    const ask = expectAsk(startClarification(before));
    const step = await answerClarification(ask.state, "مبلغ ثابت مقابل خدمة محددة", noProvider);
    expect(step.outcome).toBe("continue");
    if (step.outcome !== "continue") return;
    expect(step.state.transaction.fees.type).toEqual(E("مبلغ ثابت مقابل خدمة محددة", "مبلغ ثابت مقابل خدمة محددة"));
    expect(fieldsExcept(step.state.transaction, ["fees.type"])).toEqual(fieldsExcept(before, ["fees.type"]));
    expect(step.state.answers[0]).toMatchObject({ via: "option", resolved: true });
  });

  it("T008: the late-amount option resolves the first question", async () => {
    const ask = expectAsk(startClarification(canned("T008")));
    const step = await answerClarification(ask.state, "يُضاف إلى المبلغ المستحق بسبب التأخير", noProvider);
    expect(step.outcome).toBe("continue");
    if (step.outcome === "continue") expect(step.state.transaction.late_penalty.details.provenance).toBe("explicit");
  });

  it("T007: «يشتريها ويملكها ثم يبيعها لي» sets ownership explicit and the relationship only inferred", async () => {
    const ask = expectAsk(startClarification(canned("T007")));
    const step = await answerClarification(ask.state, "يشتريها ويملكها ثم يبيعها لي", noProvider);
    expect(step.outcome).toBe("continue");
    if (step.outcome !== "continue") return;
    expect(step.state.transaction.ownership_transfer.provenance).toBe("explicit");
    expect(step.state.transaction.relationship_type).toEqual({ value: "murabaha", provenance: "inferred" });
  });

  it("T015: two missing facts are asked one per round, in priority order", async () => {
    const first = expectAsk(startClarification(canned("T015")));
    expect(first.question.fact_id).toBe("intermediary_role");
    const second = expectAsk(await answerClarification(first.state, "يدفع ثمنها عني فقط", noProvider));
    expect(second.question).toMatchObject({ fact_id: "fee_nature", round: 2 });
    const done = await answerClarification(second.state, "تتغير بحسب قيمة التمويل أو مدة السداد", noProvider);
    expect(done.outcome).toBe("continue");
  });

  it("an option that does not settle the fact asks again with the next variant", async () => {
    const ask = expectAsk(startClarification(canned("T006")));
    const again = expectAsk(await answerClarification(ask.state, "طريقة أخرى", noProvider));
    expect(again.question).toMatchObject({ fact_id: "fee_nature", round: 2, attempt: 2 });
    expect(again.question.question).not.toBe(ask.question.question);
  });
});

describe("free-text answers (T009 → T021)", () => {
  const [t021First, t021Reply] = turnsOf("T021") as [string, string];

  it("T021: the reply is read by the provider and its span comes from the reply itself", async () => {
    expect(t021First).toBe(turnsOf("T009")[0]);
    const provider = replyProvider({
      [t021Reply]: { ownership_transfer: E("البنك يشتري السيارة ويتملكها قبل بيعها", "البنك يشتري السيارة من المعرض ويتملكها أولًا") },
    });
    const ask = expectAsk(startClarification(canned("T009")));
    const step = await answerClarification(ask.state, t021Reply, provider);
    expect(step.outcome).toBe("continue");
    if (step.outcome !== "continue") return;
    const ownership = step.state.transaction.ownership_transfer;
    expect(ownership.provenance).toBe("explicit");
    expect(comparable(t021Reply)).toContain(comparable(ownership.evidence_span!));
    expect(provider.calls).toHaveLength(1);
    expect(userMessageOf(provider.calls[0]!)).toBe(t021Reply);
    expect(provider.calls[0]!.input).not.toContain(t021First); // only the current question and reply
  });

  it("a span taken from the original message, not the reply, does not count", async () => {
    const reply = "نعم أظن ذلك";
    const provider = replyProvider({ [reply]: { ownership_transfer: E("البنك يشتري السيارة", "البنك سيمول السيارة") } });
    const ask = expectAsk(startClarification(canned("T009")));
    const next = expectAsk(await answerClarification(ask.state, reply, provider));
    expect(next.state.transaction.ownership_transfer.provenance).toBe("unknown");
    expect(next.question).toMatchObject({ fact_id: "ownership_before_sale", round: 2 });
    expect(next.state.answers[0]!.corrections[0]).toMatchObject({ reason: "evidence_span_not_in_input" });
  });

  it("a reply that only names the party does not establish ownership", async () => {
    const reply = "البنك";
    const provider = replyProvider({ [reply]: { ownership_transfer: E("البنك يملك السيارة", "البنك") } });
    const ask = expectAsk(startClarification(canned("T009")));
    const next = expectAsk(await answerClarification(ask.state, reply, provider));
    expect(next.state.transaction.ownership_transfer.provenance).toBe("unknown");
  });

  it("a free-text reply cannot change fields outside the question", async () => {
    const reply = "البنك يشتريها ويتملكها، وأسدد على 24 قسطًا";
    const provider = replyProvider({
      [reply]: {
        ownership_transfer: E("البنك يشتري السيارة ويتملكها", "البنك يشتريها ويتملكها"),
        payment_schedule: E("24 قسطًا", "على 24 قسطًا"),
      },
    });
    const before = canned("T009");
    const ask = expectAsk(startClarification(before));
    const step = await answerClarification(ask.state, reply, provider);
    expect(step.outcome).toBe("continue");
    if (step.outcome !== "continue") return;
    expect(fieldsExcept(step.state.transaction, ["ownership_transfer"])).toEqual(fieldsExcept(before, ["ownership_transfer"]));
    expect(step.state.answers[0]!.corrections).toEqual([expect.objectContaining({ path: "payment_schedule", reason: "field_not_targeted" })]);
  });
});

describe("«لا أعرف» and the round limit", () => {
  it("T022: «لا أعرف» on a material fact ends clarification at once", async () => {
    const [first, reply] = turnsOf("T022") as [string, string];
    expect(first).toBe(turnsOf("T007")[0]);
    const ask = expectAsk(startClarification(canned("T007")));
    const step = await answerClarification(ask.state, reply, noProvider);
    expect(step).toMatchObject({ outcome: "insufficient_after_unknown", fact_id: "intermediary_role" });
    if (step.outcome === "insufficient_after_unknown") expect(step.state.rounds_used).toBe(1);
  });

  it.each(["لا اعرف", "لا أدري", "لست متأكدًا"])("treats «%s» as «لا أعرف»", async (reply) => {
    const ask = expectAsk(startClarification(canned("T009")));
    expect((await answerClarification(ask.state, reply, noProvider)).outcome).toBe("insufficient_after_unknown");
  });

  it("T023: three informative replies that leave ownership open → rounds 1, 2, 3, then max_rounds_reached", async () => {
    const [first, ...replies] = turnsOf("T023");
    expect(first).toBe(turnsOf("T007")[0]);
    expect(replies).toHaveLength(3);
    for (const r of replies) expect(classifyPreGate(r).outcome).toBe("PASS");

    const provider = replyProvider(Object.fromEntries(replies.map((r) => [r, { ownership_transfer: U }])));
    let step = startClarification(canned("T007"));
    const asked: string[] = [];
    for (const [i, reply] of replies.entries()) {
      const ask = expectAsk(step);
      expect(ask.question.round).toBe(i + 1);
      expect(ask.question.fact_id).toBe("intermediary_role");
      asked.push(ask.question.question);
      step = await answerClarification(ask.state, reply, provider);
    }
    expect(step.outcome).toBe("max_rounds_reached");
    if (step.outcome === "max_rounds_reached") expect(step.state.rounds_used).toBe(3);
    expect(new Set(asked).size).toBe(3); // a narrower variant each time, not the same question
  });
});

describe("fail-closed behaviour", () => {
  it("a provider failure on a free-text reply → TECHNICAL_ERROR", async () => {
    const ask = expectAsk(startClarification(canned("T009")));
    const step = await answerClarification(ask.state, "نص حر غير معروف", replyProvider({}));
    expect(step.outcome).toBe("failed");
    if (step.outcome === "failed") expect(step.result).toMatchObject({ state: "TECHNICAL_ERROR", message: TECHNICAL_ERROR_MESSAGE });
  });

  it("a reply with no pending question → TECHNICAL_ERROR", async () => {
    const done = startClarification(canned("T004"));
    if (done.outcome !== "continue") throw new Error("expected continue");
    const step = await answerClarification(done.state, "نعم", noProvider);
    expect(step).toMatchObject({ outcome: "failed", result: { state: "TECHNICAL_ERROR", error_code: "clarification_no_pending_question" } });
  });

  it("an empty reply → TECHNICAL_ERROR", async () => {
    const ask = expectAsk(startClarification(canned("T009")));
    expect((await answerClarification(ask.state, "  ", noProvider)).outcome).toBe("failed");
  });
});
