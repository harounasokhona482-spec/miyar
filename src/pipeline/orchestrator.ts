import { randomUUID } from "node:crypto";
import type { ProviderConfigResult } from "../ai/providerConfig";
import { PRODUCT_DISCLAIMER, TECHNICAL_ERROR_MESSAGE } from "../domain/messages";
import { ApiRequestSchema, ApiResponseSchema, type ApiResponse } from "../domain/schemas/apiResponse";
import { MAX_CLARIFICATION_ROUNDS, type PipelineResult } from "../domain/schemas/pipelineResult";
import type { KnowledgeRecordV2 } from "../domain/schemas/knowledgeRecord";
import { loadKnowledgeBase, getRetrievalEligibleRecords, type KbLoadResult } from "../kb/loader";
import { signState, verifyState } from "../server/stateToken";
import { retrievalTokens } from "../text/retrievalTokens";
import { applyClarificationAnswer, initialClarificationState, stepAfterEvidence, type ClarificationState } from "./clarification";
import { evaluateEvidence, evidenceRecordInfo } from "./evidence";
import { extractTransaction } from "./extraction";
import { generateAnswer } from "./generation";
import { detectMissingInformation } from "./missingInfo";
import { DEFAULT_RETRIEVAL_CONFIG, retrieveFromKnowledgeBase } from "./retrieval";
import { insufficientEvidenceResult, technicalErrorResult } from "./results";
import { runSafetyPreGate } from "./safetyPreGate";
import { understandingSummary } from "./understanding";

/**
 * The one official path of the application:
 * validate → safety pre-gate → extraction (or apply a clarification reply) →
 * missing information → retrieval → evidence sufficiency → clarification
 * decision → grounded generation → citation verification → response state.
 *
 * Every failure becomes a safe response state; nothing throws to the caller.
 * Logs carry request id, state, durations and an internal error code only —
 * never the user's text or model output.
 */

export type Timings = { extraction_ms?: number; retrieval_evidence_ms?: number; generation_ms?: number; total_ms: number };

export type LogEntry = { request_id: string; state: string; error_code?: string; turn: "first" | "follow_up"; timings: Timings };

export type OrchestratorDeps = {
  provider: () => ProviderConfigResult;
  stateSecret: string | undefined;
  knowledge?: () => KbLoadResult;
  now?: () => number;
  log?: (entry: LogEntry) => void;
  timeouts?: { extractionMs?: number; generationMs?: number };
};

export type OrchestratorOutcome = { response: ApiResponse; meta: LogEntry };

const defaultLog = (entry: LogEntry) => {
  if (process.env.NODE_ENV !== "test") console.info(JSON.stringify({ event: "miyar_request", ...entry }));
};

function errorCodeOf(result: PipelineResult): string | undefined {
  if (result.state === "TECHNICAL_ERROR") return result.error_code;
  if (result.state === "INSUFFICIENT_EVIDENCE") return result.insufficient_reason;
  if (result.state === "REFERRAL") return result.referral_reason;
  return undefined;
}

/** Maps an internal result to the public response; internal codes are dropped. */
function toApiResponse(result: PipelineResult, requestId: string): ApiResponse {
  const common = { request_id: requestId, message: result.message, disclaimer: result.disclaimer };
  switch (result.state) {
    case "GROUNDED":
      if (!result.answer) return { ...common, state: "TECHNICAL_ERROR", message: TECHNICAL_ERROR_MESSAGE };
      return { ...common, state: "GROUNDED", answer: result.answer };
    case "DISPUTED":
      return { ...common, state: "DISPUTED", positions: result.positions.map((p) => ({ position_id: p.position_id, source_id: p.source_id, position_summary: p.position_summary })) };
    case "REFERRAL":
    case "INSUFFICIENT_EVIDENCE":
    case "TECHNICAL_ERROR":
      return { ...common, state: result.state };
    case "NEEDS_CLARIFICATION":
      // Clarification responses are built by the orchestrator with a signed token.
      return { ...common, state: "TECHNICAL_ERROR", message: TECHNICAL_ERROR_MESSAGE };
  }
}

export async function handleMiyarRequest(body: unknown, deps: OrchestratorDeps): Promise<OrchestratorOutcome> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? defaultLog;
  const requestId = randomUUID();
  const started = now();
  const timings: Partial<Timings> = {};
  let turn: LogEntry["turn"] = "first";

  const finish = (response: ApiResponse, errorCode?: string): OrchestratorOutcome => {
    const meta: LogEntry = { request_id: requestId, state: response.state, turn, timings: { ...timings, total_ms: now() - started }, ...(errorCode ? { error_code: errorCode } : {}) };
    try {
      log(meta);
    } catch {
      // logging must never break a response
    }
    return { response, meta };
  };
  const finishResult = (result: PipelineResult) => finish(toApiResponse(result, requestId), errorCodeOf(result));
  const fail = (code: string) => finishResult(technicalErrorResult(code));

  try {
    // 1. Validate input.
    const request = ApiRequestSchema.safeParse(body);
    if (!request.success) return fail("invalid_request");
    const { message, state_token } = request.data;
    turn = state_token ? "follow_up" : "first";

    // 2. Safety pre-gate (every message, including clarification replies).
    const pre = runSafetyPreGate(message);
    if (!pre.proceed) return finishResult(pre.result);

    const kb = (deps.knowledge ?? loadKnowledgeBase)();
    if (!kb.ok) return fail(`kb_${kb.error.code}`);
    const providerResult = deps.provider();
    if (!providerResult.ok) return fail(providerResult.code);
    const provider = providerResult.provider;

    // 3–5. Extraction, or apply the reply to the signed clarification state.
    let state: ClarificationState;
    let priorTerms: string[] = [];
    let userTexts: string[] = [message];
    const tExtract = now();
    if (state_token) {
      const verified = verifyState(state_token, deps.stateSecret, now());
      if (!verified.ok) return fail(verified.error);
      const p = verified.payload;
      priorTerms = p.query_terms;
      const restored: ClarificationState = {
        transaction: p.transaction,
        rounds_used: p.clarification.rounds_used,
        attempts: p.clarification.attempts,
        unknown_by_user: p.clarification.unknown_by_user,
        pending: p.clarification.pending,
        answers: [],
      };
      const applied = await applyClarificationAnswer(restored, message, provider, { timeoutMs: deps.timeouts?.extractionMs });
      timings.extraction_ms = now() - tExtract;
      if (!applied.ok) return finishResult(applied.result);
      state = applied.state;
      if (applied.via !== "free_text") userTexts = [];
    } else {
      const extracted = await extractTransaction(message, provider, { timeoutMs: deps.timeouts?.extractionMs });
      timings.extraction_ms = now() - tExtract;
      if (!extracted.ok) return finishResult(extracted.result);
      state = initialClarificationState(extracted.transaction);
    }

    // 6–7. Retrieval and evidence sufficiency.
    const tEvidence = now();
    const transaction = state.transaction;
    const records = getRetrievalEligibleRecords(kb.kb);
    const pool = retrieveFromKnowledgeBase(kb.kb, { userTexts, priorTerms, transaction }, { topK: DEFAULT_RETRIEVAL_CONFIG.evidenceCandidateK });
    const evidence = evaluateEvidence({
      transaction,
      missingFacts: detectMissingInformation(transaction).missingFacts,
      candidates: pool.candidates,
      records: new Map(records.map((r) => [r.source_id, evidenceRecordInfo(r)] as const)),
      clarification: { unknownByUser: state.unknown_by_user, maxRoundsReached: state.rounds_used >= MAX_CLARIFICATION_ROUNDS },
    });
    timings.retrieval_evidence_ms = now() - tEvidence;

    // Clarification decision, steered by the evidence gate.
    const step = stepAfterEvidence(state, evidence);
    switch (step.outcome) {
      case "failed":
        return finishResult(step.result);
      case "insufficient_after_unknown":
        return finishResult(insufficientEvidenceResult("unknown_material_fact"));
      case "max_rounds_reached":
        return finishResult(insufficientEvidenceResult("clarification_limit_reached"));
      case "stopped_by_evidence":
        return finishResult(
          insufficientEvidenceResult(
            state.unknown_by_user.length > 0 ? "unknown_material_fact" : state.rounds_used >= MAX_CLARIFICATION_ROUNDS ? "clarification_limit_reached" : "no_supporting_source",
          ),
        );
      case "ask": {
        const terms = [...new Set([...priorTerms, ...userTexts.flatMap(retrievalTokens)])].filter((t) => t.length <= 40).slice(0, 200);
        const pending = step.state.pending!;
        const signed = signState(
          {
            transaction: step.state.transaction,
            clarification: { rounds_used: step.state.rounds_used, attempts: step.state.attempts, unknown_by_user: step.state.unknown_by_user, pending },
            query_terms: terms,
          },
          deps.stateSecret,
          now(),
        );
        if (!signed.ok) return fail(signed.error);
        const response = ApiResponseSchema.parse({
          state: "NEEDS_CLARIFICATION",
          request_id: requestId,
          message: pending.question,
          disclaimer: PRODUCT_DISCLAIMER,
          understanding: understandingSummary(step.state.transaction),
          clarification: { question: pending.question, options: pending.options, round: pending.round, max_rounds: MAX_CLARIFICATION_ROUNDS, allow_free_text: true },
          state_token: signed.token,
        });
        return finish(response);
      }
      case "continue": {
        // 8–9. Grounded generation and citation verification.
        const tGen = now();
        const knowledge = new Map<string, KnowledgeRecordV2>(records.map((r) => [r.source_id, r] as const));
        const generated = await generateAnswer({ evidence, transaction, knowledge, environment: "production" }, provider, { timeoutMs: deps.timeouts?.generationMs });
        timings.generation_ms = now() - tGen;
        return finishResult(generated.result);
      }
    }
  } catch {
    return fail("orchestrator_failed");
  }
}
