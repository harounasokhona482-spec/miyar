import { z } from "zod";

/**
 * What the generation model may return. It selects registered claims (by
 * source_id + claim_ref) and writes non-religious framing text only:
 * understanding (what we understood of the transaction), optional extra
 * limitations, and a next step. claim_ref and quote are optional in the
 * schema so that a missing or invented reference is caught by citation
 * verification (and fails the whole answer), not silently accepted.
 */
export const GenerationOutputSchema = z.strictObject({
  understanding: z.string().min(1).max(600),
  claims: z
    .array(
      z.strictObject({
        text: z.string().min(1),
        source_id: z.string().min(1),
        claim_ref: z.string().min(1).optional(),
        quote: z.string().min(1).optional(),
      }),
    )
    .max(8),
  limitations: z.array(z.string().min(1).max(300)).max(4).default([]),
  next_step: z.string().min(1).max(300),
});
export type GenerationOutput = z.infer<typeof GenerationOutputSchema>;

export type Environment = "production" | "production_plus_fixture" | "fixture_only";
