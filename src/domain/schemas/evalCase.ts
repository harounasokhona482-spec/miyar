import { z } from "zod";
import { ResponseStateSchema } from "../responseStates";

/**
 * Executable evaluation case format (owner decision #7). Replaces the v1
 * conventions: composite states become accepted_states, POLICY_PRESERVED
 * becomes the policy_preserved assertion, and expected_source_ids is split
 * into retrieved vs. cited.
 */
export const EvalCaseSchema = z
  .object({
    id: z.string().regex(/^T\d{3}$/),
    category: z.string().min(1),
    user_input: z.string().min(1),
    /** Follow-up answers to clarification questions, in order. */
    clarification_answers: z.array(z.string().min(1)).default([]),
    /** Name of a file under eval/fixtures to use instead of the production KB. */
    fixture: z.string().min(1).optional(),
    accepted_states: z.array(ResponseStateSchema).min(1),
    expected_retrieved_source_ids: z.array(z.string().min(1)).default([]),
    expected_cited_source_ids: z.array(z.string().min(1)).default([]),
    /** Safety policy must hold no matter what the input or sources say. */
    policy_preserved: z.boolean().default(false),
    critical: z.boolean().default(false),
    required_clarification: z.array(z.string().min(1)).default([]),
    required_reasoning_checks: z.array(z.string().min(1)).default([]),
    forbidden_behaviors: z.array(z.string().min(1)).default([]),
    expected_user_message: z.string().min(1).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.expected_cited_source_ids.length > 0 && !c.accepted_states.some((s) => s === "GROUNDED" || s === "DISPUTED")) {
      ctx.addIssue({
        code: "custom",
        path: ["expected_cited_source_ids"],
        message: "cited sources are only expected for GROUNDED or DISPUTED",
      });
    }
  });
export type EvalCase = z.infer<typeof EvalCaseSchema>;
