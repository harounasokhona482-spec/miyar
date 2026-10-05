import { describe, expect, it } from "vitest";
import { providerFromEnv } from "../ai/providerConfig";
import type { ApiResponse } from "../domain/schemas/apiResponse";
import { handleMiyarRequest, type LogEntry } from "./orchestrator";
import { caseOf } from "./testdata/benchmarkHarness";

/**
 * Real OpenAI smoke tests — `npm run test:real`, never `npm test`.
 * Requires MIYAR_LLM_API_KEY (and uses MIYAR_LLM_MODEL, default gpt-5.6).
 * Each case runs REPEAT times; every run must reach an accepted state.
 * Logs only states and timings, never text.
 */

const REPEAT = Number(process.env.MIYAR_SMOKE_REPEAT ?? 2);
const hasKey = Boolean(process.env.MIYAR_LLM_API_KEY?.trim());
const secret = process.env.MIYAR_STATE_SECRET ?? "smoke-test-state-secret-0123456789abcdef";

const timings: LogEntry["timings"][] = [];
const deps = { provider: () => providerFromEnv(process.env), stateSecret: secret, log: (e: LogEntry) => timings.push(e.timings) };

async function run(message: string, state_token?: string): Promise<ApiResponse> {
  return (await handleMiyarRequest({ message, ...(state_token ? { state_token } : {}) }, deps)).response;
}

/** Plays a benchmark conversation: the first message, then each scripted reply while clarification continues. */
async function conversation(id: string, replies: string[] = []): Promise<ApiResponse[]> {
  const out = [await run(caseOf(id).turns[0]!.user_message)];
  for (const reply of replies) {
    const last = out.at(-1)!;
    if (last.state !== "NEEDS_CLARIFICATION") break;
    out.push(await run(reply, last.state_token));
  }
  return out;
}

const CASES: { id: string; replies?: string[]; check?: (final: ApiResponse) => void }[] = [
  { id: "T001", check: (r) => r.state === "GROUNDED" && expect(r.answer.claims.some((c) => c.source_id === "KB-001")).toBe(true) },
  { id: "T003", check: (r) => r.state === "GROUNDED" && expect(r.answer.answer_scope).toBe("conditional_general_information") },
  { id: "T004", check: (r) => r.state === "GROUNDED" && expect(r.answer.answer_scope).toBe("structural_general_information") },
  { id: "T005", check: (r) => r.state === "GROUNDED" && expect(r.answer.claims.some((c) => c.source_id === "KB-001")).toBe(false) },
  { id: "T006" },
  { id: "T009" },
  { id: "T013" },
  { id: "T019", check: (r) => r.state === "GROUNDED" && expect(r.answer.claims.every((c) => c.source_id === "KB-002" || c.source_id === "KB-001")).toBe(true) },
];

describe.skipIf(!hasKey)("real OpenAI smoke tests", () => {
  for (const c of CASES) {
    it(`${c.id} (×${REPEAT}) reaches an accepted state`, async () => {
      const accepted = caseOf(c.id).turns[0]!.accepted_states;
      for (let i = 0; i < REPEAT; i++) {
        const final = (await conversation(c.id, c.replies)).at(-1)!;
        expect(accepted, `${c.id} run ${i + 1}: got ${final.state}`).toContain(final.state);
        c.check?.(final);
      }
    });
  }

  it("T009 → ownership reply → structural GROUNDED", async () => {
    const turns = await conversation("T009", [caseOf("T021").turns[1]!.user_message]);
    expect(turns.map((t) => t.state)).toEqual(["NEEDS_CLARIFICATION", "GROUNDED"]);
  });

  it("reports average latency (no text logged)", () => {
    const avg = (k: keyof LogEntry["timings"]) => {
      const xs = timings.map((t) => t[k]).filter((x): x is number => typeof x === "number");
      return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
    };
    console.info(
      JSON.stringify({ runs: timings.length, avg_extraction_ms: avg("extraction_ms"), avg_retrieval_evidence_ms: avg("retrieval_evidence_ms"), avg_generation_ms: avg("generation_ms"), avg_total_ms: avg("total_ms") }),
    );
    expect(timings.length).toBeGreaterThan(0);
  });
});

describe.runIf(!hasKey)("real OpenAI smoke tests", () => {
  it("are skipped: MIYAR_LLM_API_KEY is not set", () => {
    expect(hasKey).toBe(false);
  });
});
