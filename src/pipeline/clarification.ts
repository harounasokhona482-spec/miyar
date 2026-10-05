import type { ModelProvider } from "../ai/provider";
import { DONT_KNOW_OPTION, PRODUCT_DISCLAIMER } from "../domain/messages";
import { MAX_CLARIFICATION_ROUNDS, PipelineResultSchema, type PipelineResult } from "../domain/schemas/pipelineResult";
import type { Transaction } from "../domain/schemas/transaction";
import { CLARIFICATION_TEMPLATES, type OptionTemplate, type QuestionVariant } from "./clarificationTemplates";
import { comparable } from "./evidenceValidators";
import { extractClarificationAnswer, setExtractedField, type ExtractionCorrection, type Field } from "./extraction";
import { detectMissingInformation, withOfficialMissingInformation, type FactId } from "./missingInfo";
import { technicalErrorResult } from "./results";

/**
 * Clarification: one fixed question per round about the highest-priority
 * missing fact, at most MAX_CLARIFICATION_ROUNDS rounds.
 *
 * Replies are merged into the transaction without re-extracting the
 * conversation:
 * - a chosen option sets the target field deterministically;
 * - "لا أعرف" (or a close variant) ends clarification for a material fact;
 * - free text is read by the provider from the current question and reply
 *   only, for the targeted fields only, with spans from the reply itself.
 *
 * The caller runs the safety pre-gate on every reply before calling this.
 * This module never decides the final response; it reports an outcome.
 */

export type PendingQuestion = {
  fact_id: FactId;
  round: number;
  attempt: number;
  question: string;
  options: string[];
};

export type ClarificationAnswer = {
  fact_id: FactId;
  round: number;
  question: string;
  reply: string;
  via: "option" | "dont_know" | "free_text";
  resolved: boolean;
  corrections: ExtractionCorrection[];
};

export type ClarificationState = {
  transaction: Transaction;
  rounds_used: number;
  attempts: Partial<Record<FactId, number>>;
  unknown_by_user: FactId[];
  pending: PendingQuestion | null;
  answers: ClarificationAnswer[];
};

export type ClarificationStep =
  | { outcome: "ask"; state: ClarificationState; question: PendingQuestion; result: PipelineResult }
  | { outcome: "continue"; state: ClarificationState }
  | { outcome: "insufficient_after_unknown"; state: ClarificationState; fact_id: FactId }
  | { outcome: "max_rounds_reached"; state: ClarificationState }
  | { outcome: "failed"; result: PipelineResult };

const DONT_KNOW_VARIANTS = ["لا أعرف", "لا اعرف", "لا أعلم", "لا أدري", "ما أعرف", "مش عارف", "لست متأكدًا", "غير متأكد"].map(comparable);

function isDontKnow(reply: string): boolean {
  return DONT_KNOW_VARIANTS.includes(comparable(reply));
}

function contextFor(t: Transaction) {
  const party = t.financing_party.provenance === "explicit" && typeof t.financing_party.value === "string" ? t.financing_party.value : "الجهة التي تدفع عنك";
  return { party };
}

function variantFor(factId: FactId, attempt: number): QuestionVariant {
  const variants = CLARIFICATION_TEMPLATES[factId].variants;
  return variants[Math.min(attempt, variants.length) - 1]!;
}

function nextStep(current: ClarificationState): ClarificationStep {
  // missing_information on the transaction always mirrors deterministic detection.
  const state: ClarificationState = { ...current, transaction: withOfficialMissingInformation(current.transaction) };

  // A material fact the user cannot provide: stop, do not keep asking.
  const blocked = state.unknown_by_user[0];
  if (blocked) return { outcome: "insufficient_after_unknown", state, fact_id: blocked };

  const missing = detectMissingInformation(state.transaction).missingFacts;
  const next = missing[0];
  if (!next) return { outcome: "continue", state: { ...state, pending: null } };
  if (state.rounds_used >= MAX_CLARIFICATION_ROUNDS) return { outcome: "max_rounds_reached", state: { ...state, pending: null } };

  const attempt = (state.attempts[next.id] ?? 0) + 1;
  const variant = variantFor(next.id, attempt);
  const question: PendingQuestion = {
    fact_id: next.id,
    round: state.rounds_used + 1,
    attempt,
    question: variant.text(contextFor(state.transaction)),
    options: [...variant.options.map((o) => o.label), DONT_KNOW_OPTION],
  };
  const newState: ClarificationState = {
    ...state,
    rounds_used: question.round,
    attempts: { ...state.attempts, [next.id]: attempt },
    pending: question,
  };
  const result = PipelineResultSchema.parse({
    state: "NEEDS_CLARIFICATION",
    message: question.question,
    disclaimer: PRODUCT_DISCLAIMER,
    transaction: state.transaction,
    clarification: { missing_fact: question.fact_id, question: question.question, options: question.options, round: question.round },
  });
  return { outcome: "ask", state: newState, question, result };
}

/** Starts clarification for a freshly extracted transaction. */
export function startClarification(transaction: Transaction): ClarificationStep {
  try {
    return nextStep({ transaction: structuredClone(transaction), rounds_used: 0, attempts: {}, unknown_by_user: [], pending: null, answers: [] });
  } catch {
    return { outcome: "failed", result: technicalErrorResult("clarification_failed") };
  }
}

/** Merges target fields; an explicit fact is never overwritten by a weaker one. */
function mergeTargets(t: Transaction, fields: Partial<Record<string, Field>>): Transaction {
  const merged = structuredClone(t);
  for (const [path, field] of Object.entries(fields)) {
    if (!field) continue;
    if (field.provenance === "explicit" || !isEstablished(merged, path)) setExtractedField(merged, path, field);
  }
  return merged;
}

function isEstablished(t: Transaction, path: string): boolean {
  const [head, tail] = path.split(".") as [string, string | undefined];
  const node = (t as unknown as Record<string, Record<string, unknown>>)[head]!;
  const field = (tail ? node[tail] : node) as Field;
  return field.provenance === "explicit" && field.value !== null;
}

function findOption(variant: QuestionVariant, reply: string): OptionTemplate | undefined {
  const r = comparable(reply);
  return variant.options.find((o) => comparable(o.label) === r);
}

/** Applies the user's reply to the pending question and decides the next step. */
export async function answerClarification(
  state: ClarificationState,
  reply: string,
  provider: ModelProvider,
  options: { timeoutMs?: number } = {},
): Promise<ClarificationStep> {
  try {
    const pending = state.pending;
    if (!pending) return { outcome: "failed", result: technicalErrorResult("clarification_no_pending_question") };
    if (typeof reply !== "string" || reply.trim() === "") return { outcome: "failed", result: technicalErrorResult("clarification_empty_reply") };

    const template = CLARIFICATION_TEMPLATES[pending.fact_id];
    const variant = variantFor(pending.fact_id, pending.attempt);
    const record = (via: ClarificationAnswer["via"], resolved: boolean, corrections: ExtractionCorrection[] = []): ClarificationAnswer => ({
      fact_id: pending.fact_id, round: pending.round, question: pending.question, reply, via, resolved, corrections,
    });

    let transaction = state.transaction;
    let answer: ClarificationAnswer;

    if (isDontKnow(reply)) {
      const next: ClarificationState = {
        ...state,
        pending: null,
        unknown_by_user: [...state.unknown_by_user, pending.fact_id],
        answers: [...state.answers, record("dont_know", false)],
      };
      return nextStep(next);
    }

    const chosen = findOption(variant, reply);
    if (chosen) {
      if (chosen.patch) {
        const patch = chosen.patch(contextFor(transaction));
        transaction = mergeTargets(transaction, Object.fromEntries(patch.map((p) => [p.path, p.field])));
      }
      answer = record("option", chosen.patch !== null);
    } else {
      const read = await extractClarificationAnswer(pending.question, reply, template.targets, provider, options);
      if (!read.ok) return { outcome: "failed", result: read.result };
      transaction = mergeTargets(transaction, read.fields);
      const stillMissing = detectMissingInformation(transaction).missingFacts.some((f) => f.id === pending.fact_id);
      answer = record("free_text", !stillMissing, read.corrections);
    }

    return nextStep({ ...state, transaction, pending: null, answers: [...state.answers, answer] });
  } catch {
    return { outcome: "failed", result: technicalErrorResult("clarification_failed") };
  }
}
