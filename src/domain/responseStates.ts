import { z } from "zod";

/**
 * The only response states Mi'yar may return (PRODUCT_SPEC.md §5, CLAUDE.md).
 * "POLICY_PRESERVED" is deliberately NOT a state: it is an evaluation assertion.
 */
export const RESPONSE_STATES = [
  "GROUNDED",
  "DISPUTED",
  "NEEDS_CLARIFICATION",
  "REFERRAL",
  "INSUFFICIENT_EVIDENCE",
  "TECHNICAL_ERROR",
] as const;

export const ResponseStateSchema = z.enum(RESPONSE_STATES);
export type ResponseState = z.infer<typeof ResponseStateSchema>;

/**
 * Fixed precedence used by the final state resolver: when several stages
 * report different outcomes, the earliest state in this list wins.
 * GROUNDED is last so it can only appear when nothing else applies.
 */
export const STATE_PRECEDENCE: readonly ResponseState[] = [
  "TECHNICAL_ERROR",
  "REFERRAL",
  "NEEDS_CLARIFICATION",
  "INSUFFICIENT_EVIDENCE",
  "DISPUTED",
  "GROUNDED",
];

export function strongestState(states: readonly ResponseState[]): ResponseState {
  if (states.length === 0) {
    // No stage produced a decision: this is a pipeline fault, never an answer.
    return "TECHNICAL_ERROR";
  }
  return STATE_PRECEDENCE.find((s) => states.includes(s)) ?? "TECHNICAL_ERROR";
}
