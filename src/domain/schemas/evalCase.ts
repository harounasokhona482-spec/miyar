import { z } from "zod";
import { MAX_CLARIFICATION_ROUNDS } from "./pipelineResult";
import { JUDGED_FIELDS } from "./review";
import { ResponseStateSchema } from "../responseStates";

/**
 * Executable benchmark format (test_set_v2.json, owner decision #7):
 * - states are only the six approved ones; composite states become accepted_states;
 * - POLICY_PRESERVED is the policy_preserved assertion, not a state;
 * - retrieved and cited source expectations are separate (see assertion_semantics).
 */

export const CRITICAL_ASSERTIONS = [
  "no_personal_fatwa",
  "no_fabricated_source",
  "policy_preserved_under_injection",
  "unsupported_citation_not_grounded",
  "fail_closed_on_technical_error",
  "no_unverified_quote",
  "structural_scope_only",
] as const;

/** Limits what a GROUNDED answer may assert (e.g. structure only, no validity ruling). */
export const ANSWER_SCOPES = ["structural_general_information"] as const;
export const CriticalAssertionSchema = z.enum(CRITICAL_ASSERTIONS);
export type CriticalAssertion = z.infer<typeof CriticalAssertionSchema>;

/** Which knowledge the harness gives the pipeline for a case. */
export const KB_MODES = ["production", "fixture_only", "production_plus_fixture"] as const;

export const FAILURE_STAGES = [
  "llm_provider",
  "extraction",
  "retrieval",
  "evidence",
  "generation",
  "citation_verification",
  "safety",
] as const;

const ids = z.array(z.string().min(1));

export const EvalTurnSchema = z
  .object({
    user_message: z.string().min(1),
    accepted_states: z.array(ResponseStateSchema).min(1),
    /** Round number the system's clarification question must carry on this turn. */
    expected_clarification_round: z.number().int().min(1).max(MAX_CLARIFICATION_ROUNDS).optional(),
    /** Topics a clarification question on this turn should address (judged, not string-matched). */
    required_clarification: z.array(z.string().min(1)).default([]),
  })
  .superRefine((turn, ctx) => {
    const clarifies = turn.expected_clarification_round !== undefined || turn.required_clarification.length > 0;
    if (clarifies && !turn.accepted_states.includes("NEEDS_CLARIFICATION")) {
      ctx.addIssue({ code: "custom", message: "clarification expectations require NEEDS_CLARIFICATION to be accepted" });
    }
  });
export type EvalTurn = z.infer<typeof EvalTurnSchema>;

export const EvalCaseSchema = z
  .object({
    id: z.string().regex(/^T\d{3}$/),
    category: z.string().min(1),
    /** v1 case this one was derived from, for traceability. */
    derived_from_v1: z.string().regex(/^T\d{3}$/).optional(),
    note: z.string().min(1).optional(),
    kb_mode: z.enum(KB_MODES).default("production"),
    /** File name under eval/fixtures. Required unless kb_mode is production. */
    fixture: z.string().regex(/^[a-z0-9_]+\.json$/).optional(),
    /** Synthetic fault the harness injects to test fail-closed behavior. */
    inject_failure: z
      .object({
        stage: z.enum(FAILURE_STAGES),
        mode: z.enum(["timeout", "exception", "invalid_output"]),
      })
      .optional(),
    turns: z.array(EvalTurnSchema).min(1).max(MAX_CLARIFICATION_ROUNDS + 1),
    /** Must be among retrieval candidates; extra candidates are allowed. */
    expected_retrieved_source_ids: ids.default([]),
    /** The only sources the final answer may cite. */
    expected_cited_source_ids: ids.default([]),
    /** Sources a GROUNDED/DISPUTED answer must cite (subset of expected_cited). */
    required_cited_source_ids: ids.default([]),
    /** Sources that must never be cited, even if retrieved. */
    forbidden_cited_source_ids: ids.default([]),
    policy_preserved: z.boolean().default(false),
    answer_scope: z.enum(ANSWER_SCOPES).optional(),
    critical: z.boolean().default(false),
    critical_assertions: z.array(CriticalAssertionSchema).default([]),
    /** Literal phrases that must not appear in the final message (cheap deterministic check). */
    forbidden_output_substrings: z.array(z.string().min(1)).default([]),
    /** Fixed text the final message must contain. */
    expected_user_message: z.string().min(1).optional(),
    required_reasoning_checks: z.array(z.string().min(1)).default([]),
    forbidden_behaviors: z.array(z.string().min(1)).default([]),
  })
  .superRefine((c, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message: `${c.id}: ${message}` });
    const finalStates = c.turns[c.turns.length - 1]?.accepted_states ?? [];

    if ((c.kb_mode === "production") !== (c.fixture === undefined)) {
      issue("fixture must be set exactly when kb_mode is not production");
    }

    const cited = new Set(c.expected_cited_source_ids);
    if (cited.size > 0 && !finalStates.some((s) => s === "GROUNDED" || s === "DISPUTED")) {
      issue("cited sources are only expected when the final turn accepts GROUNDED or DISPUTED");
    }
    for (const id of c.required_cited_source_ids) {
      if (!cited.has(id)) issue(`required cited ${id} is not in expected_cited_source_ids`);
    }
    for (const id of c.forbidden_cited_source_ids) {
      if (cited.has(id)) issue(`${id} is both expected and forbidden as a citation`);
    }

    if (c.inject_failure && (finalStates.length !== 1 || finalStates[0] !== "TECHNICAL_ERROR")) {
      issue("a case with inject_failure must accept only TECHNICAL_ERROR");
    }

    if ((c.critical_assertions.length > 0 || c.policy_preserved) && !c.critical) {
      issue("cases with critical assertions or policy_preserved must be critical");
    }
    if (c.policy_preserved && !c.critical_assertions.includes("policy_preserved_under_injection")) {
      issue("policy_preserved requires the policy_preserved_under_injection assertion");
    }
    if ((c.answer_scope !== undefined) !== c.critical_assertions.includes("structural_scope_only")) {
      issue("answer_scope and the structural_scope_only assertion must be set together");
    }

    // Clarification rounds must count up 1, 2, 3 on the turns that carry them.
    const rounds = c.turns.flatMap((t) => (t.expected_clarification_round ? [t.expected_clarification_round] : []));
    rounds.forEach((r, i) => {
      if (r !== i + 1) issue(`clarification rounds must be sequential from 1; got ${rounds.join(",")}`);
    });
  });
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const TestSetFileSchema = z
  .object({
    project: z.literal("Mi'yar"),
    version: z.literal("v2"),
    derived_from: z.string().min(1),
    status: z.string().min(1),
    max_clarification_rounds: z.literal(MAX_CLARIFICATION_ROUNDS),
    global_critical_assertions: z.array(CriticalAssertionSchema).min(1),
    review_policy: z.object({
      automated: z.literal("deterministic"),
      manual_review_required_for: z.literal("critical"),
      judged_fields: z.array(z.enum(JUDGED_FIELDS)).min(1),
      llm_judge: z.string().min(1),
    }),
    assertion_semantics: z.record(z.string(), z.string().min(1)),
    tests: z.array(EvalCaseSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const t of file.tests) {
      if (seen.has(t.id)) ctx.addIssue({ code: "custom", message: `duplicate test id ${t.id}` });
      seen.add(t.id);
    }
  });
export type TestSetFile = z.infer<typeof TestSetFileSchema>;
