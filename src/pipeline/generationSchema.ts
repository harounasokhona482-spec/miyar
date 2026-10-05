import { z } from "zod";

/**
 * What the generation model may return: references to registered claims and
 * two short non-religious framing fields. The model cannot supply claim text,
 * quotes or source metadata — the system takes all of those from the claim
 * registry / knowledge base. Any extra field fails the schema (fail closed).
 */
export const GenerationOutputSchema = z.strictObject({
  selected_claim_refs: z.array(z.string().min(1)).max(8),
  understanding: z.string().min(1).max(600),
  next_step: z.string().min(1).max(300),
});
export type GenerationOutput = z.infer<typeof GenerationOutputSchema>;

export type Environment = "production" | "production_plus_fixture" | "fixture_only";

/** "KB-001-C02" → "KB-001"; any reference that is not <source>-Cnn yields null. */
export function sourceOfClaimRef(ref: string): string | null {
  return /^(.+)-C\d{2}$/.exec(ref)?.[1] ?? null;
}
