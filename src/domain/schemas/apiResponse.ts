import { z } from "zod";
import { GroundedAnswerSchema } from "./groundedAnswer";

/**
 * The single public response of POST /api/miyar, discriminated by state.
 * Internal details (error codes, evidence traces, timings) never appear here.
 */

const text = z.string().min(1);
const common = { request_id: text, message: text, disclaimer: text };

export const ApiRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(2000),
  state_token: z.string().min(1).max(64_000).optional(),
});
export type ApiRequest = z.infer<typeof ApiRequestSchema>;

export const ApiResponseSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...common, state: z.literal("GROUNDED"), answer: GroundedAnswerSchema }),
  z.strictObject({
    ...common,
    state: z.literal("DISPUTED"),
    positions: z.array(z.strictObject({ position_id: text, source_id: text, position_summary: text })).min(2),
  }),
  z.strictObject({
    ...common,
    state: z.literal("NEEDS_CLARIFICATION"),
    understanding: z.array(z.strictObject({ label: text, value: text })),
    /** Display only: analytical labels the system inferred (never treated as facts). */
    inferred: z.array(z.strictObject({ label: text, value: text })).optional(),
    /** Display only: the material facts still unclear, as fixed explanations. */
    unclear: z.array(text).optional(),
    clarification: z.strictObject({
      question: text,
      options: z.array(text).min(1),
      round: z.number().int().min(1),
      max_rounds: z.number().int().min(1),
      allow_free_text: z.boolean(),
      /** Display only: why this question is asked (the fact's fixed explanation). */
      why: text.optional(),
    }),
    state_token: text,
  }),
  z.strictObject({ ...common, state: z.literal("REFERRAL") }),
  z.strictObject({ ...common, state: z.literal("INSUFFICIENT_EVIDENCE") }),
  z.strictObject({ ...common, state: z.literal("TECHNICAL_ERROR") }),
]);
export type ApiResponse = z.infer<typeof ApiResponseSchema>;
