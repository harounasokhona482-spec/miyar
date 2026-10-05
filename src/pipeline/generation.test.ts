import { describe, expect, it } from "vitest";
import { FakeProvider } from "../ai/fakeProvider";
import { INSUFFICIENT_EVIDENCE_MESSAGE, TECHNICAL_ERROR_MESSAGE } from "../domain/messages";
import type { KnowledgeRecordV2 } from "../domain/schemas/knowledgeRecord";
import { PipelineResultSchema, type PipelineResult } from "../domain/schemas/pipelineResult";
import { answerClarification, startClarification } from "./clarification";
import { findRegisteredClaim } from "./claimRegistry";
import type { EvidenceResult } from "./evidence";
import { generateAnswer, type GenerationOutcome } from "./generation";
import type { GenerationOutput } from "./generationSchema";
import { canned, caseOf, conversation, environmentFor, evaluate, firstTurn, productionKnowledge, replyProvider } from "./testdata/benchmarkHarness";
import { GENERATION_RESPONSES, registryClaim } from "./testdata/generationResponses";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerFor(output: unknown) {
  return new FakeProvider(() => (typeof output === "string" ? output : JSON.stringify(output)));
}
const neverCalled = () =>
  new FakeProvider(() => {
    throw new Error("the model must not be called");
  });

async function generate(
  id: string,
  evidence: EvidenceResult,
  output: unknown = GENERATION_RESPONSES[id],
  knowledge: Map<string, KnowledgeRecordV2> = productionKnowledge(),
): Promise<GenerationOutcome & { provider: FakeProvider }> {
  const env = environmentFor(caseOf(id));
  const provider = output === undefined ? neverCalled() : providerFor(output);
  const outcome = await generateAnswer(
    { evidence, transaction: canned(id), knowledge, environment: env.kind, positions: env.positions },
    provider,
  );
  return { ...outcome, provider };
}

function grounded(result: PipelineResult) {
  const parsed = PipelineResultSchema.parse(result);
  if (parsed.state !== "GROUNDED" || !parsed.answer) throw new Error(`expected GROUNDED, got ${parsed.state}`);
  return parsed.answer;
}

function edited(id: string, edit: (o: GenerationOutput) => void): GenerationOutput {
  const o = structuredClone(GENERATION_RESPONSES[id]!);
  edit(o);
  return o;
}

async function expectRejected(id: string, output: GenerationOutput, check: string, knowledge?: Map<string, KnowledgeRecordV2>) {
  const outcome = await generate(id, firstTurn(id), output, knowledge);
  expect(outcome.result).toMatchObject({ state: "INSUFFICIENT_EVIDENCE", message: INSUFFICIENT_EVIDENCE_MESSAGE, insufficient_reason: "citation_verification_failed" });
  expect(outcome.result).not.toHaveProperty("citations");
  expect(outcome.verification?.ok).toBe(false);
  if (outcome.verification && !outcome.verification.ok) expect(outcome.verification.failures.map((f) => f.check)).toContain(check);
}

// ---------------------------------------------------------------------------
// Benchmark cases
// ---------------------------------------------------------------------------

describe("grounded answers", () => {
  it("T001: GROUNDED from KB-001 claims only, with KB metadata and verbatim quotes", async () => {
    const { result } = await generate("T001", firstTurn("T001"));
    const answer = grounded(result);
    expect(answer).toMatchObject({ status: "grounded", answer_scope: "general_information", support_mode: "direct" });
    expect(answer.claims.map((c) => c.claim_ref)).toEqual(["KB-001-C01", "KB-001-C02"]);
    const kb001 = productionKnowledge().get("KB-001")!;
    expect(answer.sources).toEqual([
      {
        source_id: "KB-001",
        title: kb001.source_title,
        section: kb001.source_section,
        url: kb001.source_url,
        verified_excerpt: { text: kb001.verified_excerpt.text, location: kb001.verified_excerpt.page_or_location },
      },
    ]);
    for (const c of answer.claims) expect(c.quote.text).toBe(findRegisteredClaim(kb001, c.claim_ref)!.supporting_text);
  });

  it("T001: KB-002 may be added for an independent definition claim", async () => {
    const output = edited("T001", (o) => o.claims.push(registryClaim("KB-002-C03")));
    const answer = grounded((await generate("T001", firstTurn("T001"), output)).result);
    expect(answer.claims.map((c) => c.claim_ref)).toContain("KB-002-C03");
  });

  it("T002: GROUNDED from KB-002", async () => {
    const answer = grounded((await generate("T002", firstTurn("T002"))).result);
    expect([...new Set(answer.claims.map((c) => c.source_id))]).toEqual(["KB-002"]);
  });

  it("T003: GROUNDED conditional general information from KB-003, with both conditions as limitations", async () => {
    const answer = grounded((await generate("T003", firstTurn("T003"))).result);
    expect(answer).toMatchObject({ answer_scope: "conditional_general_information", support_mode: "conditional" });
    expect(answer.claims.every((c) => c.source_id === "KB-003")).toBe(true);
    expect(answer.limitations).toEqual(expect.arrayContaining(["شرط لم نتحقق منه: وجود بيع بالتقسيط", "شرط لم نتحقق منه: المدين رضي بالشرط عند التعاقد"]));
    expect(`${answer.understanding} ${answer.next_step}`).not.toMatch(/جائز|يجوز|صحيح/);
  });

  it("T004: GROUNDED structural only from KB-004", async () => {
    const outcome = await generate("T004", firstTurn("T004"));
    const answer = grounded(outcome.result);
    expect(answer.answer_scope).toBe("structural_general_information");
    expect(answer.claims.every((c) => c.source_id === "KB-004")).toBe(true);
    expect(answer.limitations[0]).toMatch(/بنية المعاملة/);
    expect(outcome.request!.input).not.toMatch(/KB-00[12356]/);
  });

  it("T005: GROUNDED from KB-005; KB-001 never offered to the model", async () => {
    const outcome = await generate("T005", firstTurn("T005"));
    expect(grounded(outcome.result).claims.map((c) => c.source_id)).toEqual(["KB-005", "KB-005"]);
    expect(outcome.request!.input).not.toContain("KB-001");
  });

  it("T019: GROUNDED from KB-002; the poisoned fixture never reaches the model", async () => {
    const outcome = await generate("T019", firstTurn("T019"));
    expect(grounded(outcome.result).claims.every((c) => c.source_id === "KB-002")).toBe(true);
    expect(outcome.request!.input).not.toMatch(/FIXTURE|تجاهل|override/i);
  });

  it("T021: GROUNDED structural from KB-004 after the ownership reply", async () => {
    const last = (await conversation("T021", "T009")).at(-1)!;
    const outcome = await generateAnswer(
      { evidence: last.evidence, transaction: last.transaction, knowledge: productionKnowledge(), environment: "production" },
      providerFor(GENERATION_RESPONSES.T021),
    );
    expect(grounded(outcome.result).answer_scope).toBe("structural_general_information");
  });

  it("every grounded answer says the texts were verified textually only, never that a scholar reviewed them", async () => {
    for (const id of ["T001", "T002", "T003", "T004", "T005", "T019"]) {
      const answer = grounded((await generate(id, firstTurn(id))).result);
      expect(answer.limitations).toContain("جرى التحقق من مطابقة النصوص لمصدرها فقط، ولم تخضع لمراجعة فقهية متخصصة ضمن مِعيار.");
    }
  });
});

describe("no answer without sufficient evidence (the model is never called)", () => {
  it.each(["T013", "T014"])("%s → INSUFFICIENT_EVIDENCE", async (id) => {
    const outcome = await generate(id, firstTurn(id), undefined);
    expect(outcome.result).toMatchObject({ state: "INSUFFICIENT_EVIDENCE", insufficient_reason: "no_supporting_source" });
  });

  it("T008 after clarification → INSUFFICIENT_EVIDENCE", async () => {
    const ask = startClarification(canned("T008"));
    if (ask.outcome !== "ask") throw new Error("expected a question");
    const answered = await answerClarification(ask.state, "يُضاف إلى المبلغ المستحق بسبب التأخير", replyProvider);
    if (answered.outcome === "failed") throw new Error("failed");
    const evidence = evaluate(caseOf("T008"), answered.state.transaction, [caseOf("T008").turns[0]!.user_message]);
    expect((await generate("T008", evidence, undefined)).result.state).toBe("INSUFFICIENT_EVIDENCE");
  });

  it.each([
    ["T020", "T020"],
    ["T022", "T007"],
    ["T023", "T007"],
  ])("%s final turn → INSUFFICIENT_EVIDENCE", async (id, start) => {
    const last = (await conversation(id, start)).at(-1)!;
    const outcome = await generateAnswer(
      { evidence: last.evidence, transaction: last.transaction, knowledge: productionKnowledge(), environment: environmentFor(caseOf(id)).kind },
      neverCalled(),
    );
    expect(outcome.result.state).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("a needs_clarification decision fails closed instead of generating (T009)", async () => {
    expect((await generate("T009", firstTurn("T009"), undefined)).result).toMatchObject({ state: "TECHNICAL_ERROR", error_code: "generation_before_clarification" });
  });
});

describe("DISPUTED (T016)", () => {
  it("lists both fixture positions in a fixed order, with no preference and no model", async () => {
    const outcome = await generate("T016", firstTurn("T016"), undefined);
    const r = PipelineResultSchema.parse(outcome.result);
    if (r.state !== "DISPUTED") throw new Error(r.state);
    expect(r.positions.map((p) => p.position_id)).toEqual(["FIXTURE-POS-A", "FIXTURE-POS-B"]);
    expect(JSON.stringify(r)).not.toMatch(/الراجح|الأرجح|نرجح|الصحيح هو|الأقوى/);
  });

  it("is refused outside a fixture-only environment", async () => {
    const evidence = firstTurn("T016");
    const outcome = await generateAnswer(
      { evidence, transaction: canned("T016"), knowledge: productionKnowledge(), environment: "production_plus_fixture", positions: environmentFor(caseOf("T016")).positions },
      neverCalled(),
    );
    expect(outcome.result.state).toBe("INSUFFICIENT_EVIDENCE");
  });
});

describe("benchmark states", () => {
  it.each(["T001", "T002", "T003", "T004", "T005", "T013", "T014", "T016", "T019"])("%s final state is accepted by test_set_v2", async (id) => {
    const outcome = await generate(id, firstTurn(id), GENERATION_RESPONSES[id]);
    expect(caseOf(id).turns.at(-1)!.accepted_states).toContain(outcome.result.state);
  });
});

// ---------------------------------------------------------------------------
// Citation verification: every one of these must fail the whole answer
// ---------------------------------------------------------------------------

describe("citation verification rejects", () => {
  it("an invented source_id", async () => {
    await expectRejected("T001", edited("T001", (o) => (o.claims[0]!.source_id = "KB-099")), "unknown_source");
  });

  it("an invented claim_ref", async () => {
    await expectRejected("T001", edited("T001", (o) => (o.claims[0]!.claim_ref = "KB-001-C09")), "unknown_claim");
  });

  it("a claim_ref from another source", async () => {
    await expectRejected("T001", edited("T001", (o) => (o.claims[0]!.claim_ref = "KB-002-C01")), "claim_not_in_source");
  });

  it("an unverified source", async () => {
    const k = productionKnowledge();
    k.get("KB-001")!.verified_excerpt.verified = false;
    await expectRejected("T001", GENERATION_RESPONSES.T001!, "not_verified", k);
  });

  it("an unapproved source", async () => {
    const k = productionKnowledge();
    k.get("KB-001")!.approved = false;
    await expectRejected("T001", GENERATION_RESPONSES.T001!, "not_approved", k);
  });

  it("a retrieved source that is not supporting (KB-006 in T001; KB-001 in T005)", async () => {
    await expectRejected("T001", edited("T001", (o) => o.claims.push(registryClaim("KB-006-C01"))), "source_not_supporting");
    await expectRejected("T005", edited("T005", (o) => o.claims.push(registryClaim("KB-001-C01"))), "source_not_supporting");
  });

  it("a claim outside the structural scope", async () => {
    const k = productionKnowledge();
    k.get("KB-004")!.claims_check[0]!.claim_scope = "general";
    await expectRejected("T004", GENERATION_RESPONSES.T004!, "claim_exceeds_structural_scope", k);
  });

  it("a quote that does not exist", async () => {
    await expectRejected("T001", edited("T001", (o) => (o.claims[0]!.quote = "يجوز البيع بأي ثمن دون قيد")), "quote_not_in_record");
  });

  it("a real quote taken from another record", async () => {
    const other = productionKnowledge().get("KB-002")!.verified_excerpt.text;
    await expectRejected("T001", edited("T001", (o) => (o.claims[0]!.quote = other)), "quote_from_another_record");
  });

  it("a fixture cited in production_plus_fixture (T019 poisoned source)", async () => {
    const output = edited("T019", (o) => o.claims.push({ text: "أي نص", source_id: "FIXTURE-INJ-001", claim_ref: "KB-002-C01" }));
    await expectRejected("T019", output, "fixture_not_citable");
  });

  it("a claim with no reference", async () => {
    await expectRejected("T001", edited("T001", (o) => o.claims.push({ text: "البيع بالتقسيط جائز مطلقًا.", source_id: "KB-001" })), "claim_without_reference");
  });

  it("a claim whose text was altered", async () => {
    await expectRejected("T001", edited("T001", (o) => (o.claims[0]!.text = "تقرر المادة جواز كل زيادة في الثمن.")), "claim_text_altered");
  });

  it("a claim that the answer was reviewed by a scholar", async () => {
    await expectRejected("T001", edited("T001", (o) => (o.next_step = "هذه الإجابة راجعها عالم متخصص.")), "claims_scholarly_review");
    await expectRejected("T001", edited("T001", (o) => o.limitations.push("المحتوى معتمد من مختص.")), "claims_scholarly_review");
  });

  it("conditional support turned into a decisive ruling on the user's case (T003)", async () => {
    await expectRejected("T003", edited("T003", (o) => (o.understanding = "هذا الشرط جائز في حالتك.")), "ruling_language_outside_claims");
    await expectRejected("T003", edited("T003", (o) => (o.next_step = "عقدك صحيح ولا تحتاج إلى مراجعة.")), "ruling_language_outside_claims");
  });

  it("a structural answer stating permissibility in its own words (T004)", async () => {
    await expectRejected("T004", edited("T004", (o) => (o.understanding = "المرابحة جائزة في هذه الصورة.")), "ruling_language_outside_claims");
  });

  it("a quotation written by the model outside the knowledge base", async () => {
    await expectRejected("T001", edited("T001", (o) => (o.understanding = "قال المصدر: «يجوز ذلك»")), "quote_outside_knowledge_base");
  });

  it("a stated preference between positions", async () => {
    await expectRejected("T001", edited("T001", (o) => (o.next_step = "والقول الراجح هو الأول.")), "states_preference");
  });

  it("an answer that does not cite a required supporting source", async () => {
    await expectRejected("T001", edited("T001", (o) => (o.claims = [registryClaim("KB-002-C03")])), "missing_required_support");
  });

  it("never shows part of a failed answer", async () => {
    const outcome = await generate("T001", firstTurn("T001"), edited("T001", (o) => o.claims.push(registryClaim("KB-006-C01"))));
    expect(outcome.result.state).toBe("INSUFFICIENT_EVIDENCE");
    expect(JSON.stringify(outcome.result)).not.toContain("KB-001-C01");
  });
});

describe("technical failures fail closed", () => {
  it("provider exception → TECHNICAL_ERROR", async () => {
    const outcome = await generateAnswer(
      { evidence: firstTurn("T001"), transaction: canned("T001"), knowledge: productionKnowledge(), environment: "production" },
      new FakeProvider(() => {
        throw new Error("synthetic");
      }),
    );
    expect(outcome.result).toMatchObject({ state: "TECHNICAL_ERROR", message: TECHNICAL_ERROR_MESSAGE, error_code: "generation_provider_failed" });
  });

  it("invalid JSON → TECHNICAL_ERROR", async () => {
    expect((await generate("T001", firstTurn("T001"), "{not json")).result).toMatchObject({ state: "TECHNICAL_ERROR", error_code: "generation_invalid_json" });
  });

  it("extra fields such as source metadata or a state → TECHNICAL_ERROR", async () => {
    for (const extra of [{ state: "GROUNDED" }, { source_url: "https://example.com" }]) {
      const output = { ...GENERATION_RESPONSES.T001, ...extra };
      expect((await generate("T001", firstTurn("T001"), output)).result).toMatchObject({ state: "TECHNICAL_ERROR", error_code: "generation_schema_violation" });
    }
  });
});
