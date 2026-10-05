import { describe, expect, it } from "vitest";
import { FakeProvider } from "../ai/fakeProvider";
import type { ModelProvider, ModelRequest } from "../ai/provider";
import {
  INSUFFICIENT_EVIDENCE_MESSAGE,
  OUT_OF_SCOPE_MESSAGE,
  REFERRAL_MESSAGE,
  TECHNICAL_ERROR_MESSAGE,
  UNSUPPORTED_LANGUAGE_MESSAGE,
} from "../domain/messages";
import { ApiResponseSchema, type ApiResponse } from "../domain/schemas/apiResponse";
import { userMessageOf } from "./extraction";
import { handleMiyarRequest, type LogEntry, type OrchestratorDeps } from "./orchestrator";
import { CLARIFICATION_REPLIES, caseOf } from "./testdata/benchmarkHarness";
import { EXTRACTION_RESPONSES } from "./testdata/extractionResponses";
import { GENERATION_BY_SUPPORTING_SOURCE } from "./testdata/generationResponses";

// ---------------------------------------------------------------------------
// End-to-end harness: the real orchestrator with a fake model that answers
// each task like a well-behaved model would.
// ---------------------------------------------------------------------------

const SECRET = "test-state-secret-0123456789-abcdefghij";
const extractionByMessage = new Map(Object.keys(EXTRACTION_RESPONSES).map((id) => [caseOf(id).turns[0]!.user_message, EXTRACTION_RESPONSES[id]!]));

function generationPayload(request: ModelRequest): { sources: { source_id: string; role: string }[] } {
  const json = request.input.replace(/^<generation_input>\n/, "").replace(/\n<\/generation_input>$/, "");
  return JSON.parse(json);
}

function e2eProvider(overrides: Partial<Record<ModelRequest["task"], (r: ModelRequest) => string | Promise<string>>> = {}) {
  return new FakeProvider((request) => {
    const override = overrides[request.task];
    if (override) return override(request);
    if (request.task === "transaction_extraction") {
      const t = extractionByMessage.get(userMessageOf(request));
      if (!t) throw new Error("no canned extraction");
      return JSON.stringify(t);
    }
    if (request.task === "clarification_extraction") {
      const r = CLARIFICATION_REPLIES[userMessageOf(request)];
      if (!r) throw new Error("no canned clarification");
      return JSON.stringify(r);
    }
    const supporting = generationPayload(request).sources.find((s) => s.role === "supporting")!.source_id;
    return JSON.stringify(GENERATION_BY_SUPPORTING_SOURCE[supporting]);
  });
}

function deps(provider: ModelProvider | null, extra: Partial<OrchestratorDeps> = {}): OrchestratorDeps & { logs: LogEntry[] } {
  const logs: LogEntry[] = [];
  return {
    provider: () => (provider ? { ok: true, provider } : { ok: false, code: "provider_not_configured" }),
    stateSecret: SECRET,
    log: (e) => logs.push(e),
    logs,
    ...extra,
  };
}

async function ask(body: unknown, d: OrchestratorDeps) {
  const { response, meta } = await handleMiyarRequest(body, d);
  expect(ApiResponseSchema.safeParse(response).success).toBe(true);
  return { response, meta };
}

const first = (id: string) => caseOf(id).turns[0]!.user_message;

function expectState<S extends ApiResponse["state"]>(r: ApiResponse, state: S): Extract<ApiResponse, { state: S }> {
  expect(r.state).toBe(state);
  return r as Extract<ApiResponse, { state: S }>;
}

// ---------------------------------------------------------------------------
// End-to-end cases
// ---------------------------------------------------------------------------

describe("end-to-end with the fake provider", () => {
  it("1. T001 → GROUNDED", async () => {
    const r = expectState((await ask({ message: first("T001") }, deps(e2eProvider()))).response, "GROUNDED");
    expect(r.answer.claims.map((c) => c.claim_ref)).toEqual(["KB-001-C01", "KB-001-C02"]);
    expect(r.answer.sources[0]!.url).toBe("https://dorar.net/feqhia/6883/");
  });

  it("2. T003 → conditional GROUNDED", async () => {
    const r = expectState((await ask({ message: first("T003") }, deps(e2eProvider()))).response, "GROUNDED");
    expect(r.answer).toMatchObject({ answer_scope: "conditional_general_information", support_mode: "conditional" });
    expect(r.answer.limitations).toContain("شرط لم نتحقق منه: المدين رضي بالشرط عند التعاقد");
  });

  it("3. T004 → structural GROUNDED", async () => {
    const r = expectState((await ask({ message: first("T004") }, deps(e2eProvider()))).response, "GROUNDED");
    expect(r.answer.answer_scope).toBe("structural_general_information");
  });

  it("4. T005 → GROUNDED from KB-005", async () => {
    const r = expectState((await ask({ message: first("T005") }, deps(e2eProvider()))).response, "GROUNDED");
    expect(r.answer.claims.every((c) => c.source_id === "KB-005")).toBe(true);
  });

  it("5. T006 → NEEDS_CLARIFICATION with one question, «لا أعرف», understanding and a signed token", async () => {
    const r = expectState((await ask({ message: first("T006") }, deps(e2eProvider()))).response, "NEEDS_CLARIFICATION");
    expect(r.clarification).toMatchObject({ question: "كيف تُحسب هذه الرسوم؟", round: 1, max_rounds: 3, allow_free_text: true });
    expect(r.clarification.options.at(-1)).toBe("لا أعرف");
    expect(r.understanding).toEqual(expect.arrayContaining([{ label: "طريقة الدفع", value: "تقسيط" }]));
    expect(r.state_token.split(".")).toHaveLength(2);
  });

  it("6. T008 → clarification, then INSUFFICIENT_EVIDENCE after choosing an option", async () => {
    const d = deps(e2eProvider());
    const q = expectState((await ask({ message: first("T008") }, d)).response, "NEEDS_CLARIFICATION");
    expect(q.clarification.question).toBe("هل هذا المبلغ يُضاف إلى المبلغ المستحق عليك بسبب التأخير، أم أنه رسم من نوع آخر؟");
    const a = await ask({ message: q.clarification.options[0], state_token: q.state_token }, d);
    expect(a.response).toMatchObject({ state: "INSUFFICIENT_EVIDENCE", message: INSUFFICIENT_EVIDENCE_MESSAGE });
  });

  it("7. T009 → clarification, then structural GROUNDED after the ownership reply (T021)", async () => {
    const d = deps(e2eProvider());
    const q = expectState((await ask({ message: first("T009") }, d)).response, "NEEDS_CLARIFICATION");
    expect(q.clarification.question).toBe("هل الجهة الممولة تشتري السلعة وتملكها قبل أن تبيعها لك؟");
    const a = expectState((await ask({ message: caseOf("T021").turns[1]!.user_message, state_token: q.state_token }, d)).response, "GROUNDED");
    expect(a.answer.answer_scope).toBe("structural_general_information");
  });

  it.each(["T013", "T014"])("8–9. %s → INSUFFICIENT_EVIDENCE", async (id) => {
    expect((await ask({ message: first(id) }, deps(e2eProvider()))).response).toMatchObject({ state: "INSUFFICIENT_EVIDENCE" });
  });

  it("10. T019 → GROUNDED; no fixture or injected text reaches generation", async () => {
    const provider = e2eProvider();
    expectState((await ask({ message: first("T019") }, deps(provider))).response, "GROUNDED");
    const gen = provider.calls.find((c) => c.task === "grounded_generation")!;
    expect(gen.input).not.toMatch(/FIXTURE|تجاهل|override/i);
  });

  it("11. REFERRAL — with no model call (and even with no provider configured)", async () => {
    for (const id of ["T010", "T011", "T012"]) {
      expect((await ask({ message: first(id) }, deps(null))).response).toMatchObject({ state: "REFERRAL", message: REFERRAL_MESSAGE });
    }
  });

  it("12. OUT OF SCOPE → INSUFFICIENT_EVIDENCE with the out-of-scope text", async () => {
    expect((await ask({ message: first("T018") }, deps(null))).response).toMatchObject({ state: "INSUFFICIENT_EVIDENCE", message: OUT_OF_SCOPE_MESSAGE });
  });

  it("13. unsupported language → INSUFFICIENT_EVIDENCE with the Arabic-only text", async () => {
    expect((await ask({ message: "Is my installment purchase allowed?" }, deps(null))).response).toMatchObject({
      state: "INSUFFICIENT_EVIDENCE",
      message: UNSUPPORTED_LANGUAGE_MESSAGE,
    });
  });

  it("T022: «لا أعرف» → INSUFFICIENT_EVIDENCE", async () => {
    const d = deps(e2eProvider());
    const q = expectState((await ask({ message: first("T022") }, d)).response, "NEEDS_CLARIFICATION");
    const a = await ask({ message: "لا أعرف", state_token: q.state_token }, d);
    expect(a.response.state).toBe("INSUFFICIENT_EVIDENCE");
    expect(a.meta.error_code).toBe("unknown_material_fact");
  });

  it("T023: three informative replies → rounds 1, 2, 3 then INSUFFICIENT_EVIDENCE", async () => {
    const d = deps(e2eProvider());
    let r = (await ask({ message: first("T023") }, d)).response;
    const rounds: number[] = [];
    for (const turn of caseOf("T023").turns.slice(1)) {
      const q = expectState(r, "NEEDS_CLARIFICATION");
      rounds.push(q.clarification.round);
      r = (await ask({ message: turn.user_message, state_token: q.state_token }, d)).response;
    }
    expect(rounds).toEqual([1, 2, 3]);
    expect(r.state).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("T020: the fee question, then INSUFFICIENT_EVIDENCE once the fee is described (no useless extra question)", async () => {
    const d = deps(e2eProvider());
    const q = expectState((await ask({ message: first("T020") }, d)).response, "NEEDS_CLARIFICATION");
    const a = await ask({ message: caseOf("T020").turns[1]!.user_message, state_token: q.state_token }, d);
    expect(a.response.state).toBe("INSUFFICIENT_EVIDENCE");
  });
});

// ---------------------------------------------------------------------------
// Failures never break the orchestrator
// ---------------------------------------------------------------------------

describe("state token integrity", () => {
  async function tokenFor(id: string) {
    return expectState((await ask({ message: first(id) }, deps(e2eProvider()))).response, "NEEDS_CLARIFICATION").state_token;
  }

  it("14. a tampered transaction in the token → TECHNICAL_ERROR", async () => {
    const token = await tokenFor("T009");
    const [body, mac] = token.split(".") as [string, string];
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    payload.transaction.ownership_transfer = { value: "البنك يشتري السيارة ويتملكها", provenance: "explicit", evidence_span: "البنك يشتري", evidence_origin: "clarification_choice" };
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${mac}`;
    const r = await ask({ message: "نعم", state_token: forged }, deps(e2eProvider()));
    expect(r.response).toMatchObject({ state: "TECHNICAL_ERROR", message: TECHNICAL_ERROR_MESSAGE });
    expect(r.meta.error_code).toBe("state_token_bad_signature");
  });

  it("rejects garbage, a token signed with another secret, and an expired token", async () => {
    const token = await tokenFor("T009");
    expect((await ask({ message: "نعم", state_token: "not-a-token" }, deps(e2eProvider()))).meta.error_code).toBe("state_token_malformed");
    expect((await ask({ message: "نعم", state_token: token }, deps(e2eProvider(), { stateSecret: "another-secret-another-secret-123456" }))).meta.error_code).toBe(
      "state_token_bad_signature",
    );
    const later = deps(e2eProvider(), { now: () => Date.now() + 2 * 60 * 60 * 1000 });
    expect((await ask({ message: "نعم", state_token: token }, later)).meta.error_code).toBe("state_token_expired");
  });

  it("fails closed when the state secret is missing and a question must be asked", async () => {
    const r = await ask({ message: first("T009") }, deps(e2eProvider(), { stateSecret: undefined }));
    expect(r.response.state).toBe("TECHNICAL_ERROR");
    expect(r.meta.error_code).toBe("state_secret_missing");
  });
});

describe("provider failures", () => {
  it("15. provider exception → TECHNICAL_ERROR", async () => {
    const provider = e2eProvider({
      transaction_extraction: () => {
        throw new Error("synthetic");
      },
    });
    expect((await ask({ message: first("T001") }, deps(provider))).response).toMatchObject({ state: "TECHNICAL_ERROR", message: TECHNICAL_ERROR_MESSAGE });
  });

  it("16. provider timeout (extraction or generation) → TECHNICAL_ERROR", async () => {
    const hang = () => new Promise<string>(() => {});
    const short = { timeouts: { extractionMs: 20, generationMs: 20 } };
    const a = await ask({ message: first("T001") }, deps(e2eProvider({ transaction_extraction: hang }), short));
    expect(a.meta.error_code).toBe("extraction_timeout");
    const b = await ask({ message: first("T001") }, deps(e2eProvider({ grounded_generation: hang }), short));
    expect(b.meta.error_code).toBe("generation_timeout");
  });

  it("17. invalid structured output (extraction or generation) → TECHNICAL_ERROR", async () => {
    const a = await ask({ message: first("T001") }, deps(e2eProvider({ transaction_extraction: () => "{not json" })));
    expect(a.meta.error_code).toBe("extraction_invalid_json");
    const b = await ask({ message: first("T001") }, deps(e2eProvider({ grounded_generation: () => JSON.stringify({ selected_claim_refs: [], understanding: "x", next_step: "y", extra: 1 }) })));
    expect(b.meta.error_code).toBe("generation_schema_violation");
  });

  it("a generation that fails citation verification → INSUFFICIENT_EVIDENCE, never a partial answer", async () => {
    const provider = e2eProvider({ grounded_generation: () => JSON.stringify({ selected_claim_refs: ["KB-006-C01"], understanding: "فهمنا المعاملة.", next_step: "اعرضها على مختص." }) });
    const r = await ask({ message: first("T001") }, deps(provider));
    expect(r.response.state).toBe("INSUFFICIENT_EVIDENCE");
    expect(r.meta.error_code).toBe("citation_verification_failed");
  });

  it("no provider configured → TECHNICAL_ERROR (the page never crashes)", async () => {
    const r = await ask({ message: first("T001") }, deps(null));
    expect(r.response.state).toBe("TECHNICAL_ERROR");
    expect(r.meta.error_code).toBe("provider_not_configured");
  });
});

describe("request validation and privacy", () => {
  it.each([[null], [{}], [{ message: "" }], [{ message: "   " }], [{ message: "أ".repeat(2001) }], [{ message: "سؤال", extra: true }], ["text"]])(
    "invalid request %j → TECHNICAL_ERROR",
    async (body) => {
      const r = await ask(body, deps(e2eProvider()));
      expect(r.response.state).toBe("TECHNICAL_ERROR");
      expect(r.meta.error_code).toBe("invalid_request");
    },
  );

  it("never exposes internal codes or details in the response", async () => {
    const r = await ask({ message: first("T001") }, deps(null));
    expect(JSON.stringify(r.response)).not.toMatch(/provider_not_configured|error_code|stack/);
  });

  it("logs request id, state and timings — never the user's text or model output", async () => {
    const d = deps(e2eProvider());
    await ask({ message: first("T001") }, d);
    const entry = d.logs[0]!;
    expect(entry).toMatchObject({ state: "GROUNDED", turn: "first" });
    expect(entry.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.timings.total_ms).toBeGreaterThanOrEqual(0);
    const serialized = JSON.stringify(d.logs);
    expect(serialized).not.toContain("هاتف");
    expect(serialized).not.toContain("تقرر المادة");
  });

  it("the token carries no knowledge-base text and no raw user message", async () => {
    const q = expectState((await ask({ message: first("T006") }, deps(e2eProvider()))).response, "NEEDS_CLARIFICATION");
    const payload = Buffer.from(q.state_token.split(".")[0]!, "base64url").toString("utf8");
    expect(payload).not.toContain(first("T006"));
    expect(payload).not.toContain("تقرر المادة");
  });
});
