import { z } from "zod";

/**
 * The structured grounded answer shown to the user. Every religious claim
 * carries source_id + claim_ref into the knowledge base's claim registry;
 * claim text, quotes and source metadata come from the knowledge base, never
 * from the model.
 */

const text = z.string().min(1);

export const ANSWER_SCOPES = ["general_information", "conditional_general_information", "structural_general_information"] as const;

export const SourceReferenceSchema = z.strictObject({
  source_id: text,
  title: text,
  section: text,
  url: z.url(),
  /** Only a verified excerpt is ever shown as a quotation. */
  verified_excerpt: z.strictObject({ text, location: text }).nullable(),
});

export const GroundedClaimSchema = z.strictObject({
  text,
  source_id: text,
  claim_ref: z.string().regex(/^KB-\d{3}-C\d{2}$/),
  /** Verbatim supporting text from source_text, with its location (main text or footnote). */
  quote: z.strictObject({ text, location: text }),
});

export const GroundedAnswerSchema = z.strictObject({
  status: z.literal("grounded"),
  answer_scope: z.enum(ANSWER_SCOPES),
  support_mode: z.enum(["direct", "conditional"]),
  understanding: text,
  claims: z.array(GroundedClaimSchema).min(1),
  sources: z.array(SourceReferenceSchema).min(1),
  limitations: z.array(text),
  next_step: text,
});
export type GroundedAnswer = z.infer<typeof GroundedAnswerSchema>;
