import { z } from "zod";
import { KB_CATEGORIES } from "./knowledgeRecord";

/**
 * Provenance of every extracted fact (owner decision #14):
 * - explicit: stated by the user; must carry the literal evidence_span.
 * - inferred: derived by the extractor; never treated as an established fact.
 * - unknown:  not provided; value must be null.
 */
export const PROVENANCE = ["explicit", "inferred", "unknown"] as const;
export const ProvenanceSchema = z.enum(PROVENANCE);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export function extractedField<V>(valueSchema: z.ZodType<V>) {
  return z
    .object({
      value: valueSchema.nullable(),
      provenance: ProvenanceSchema,
      evidence_span: z.string().min(1).optional(),
    })
    .superRefine((field, ctx) => {
      if (field.provenance === "explicit") {
        if (field.value === null) {
          ctx.addIssue({ code: "custom", path: ["value"], message: "explicit field must have a value" });
        }
        if (!field.evidence_span) {
          ctx.addIssue({ code: "custom", path: ["evidence_span"], message: "explicit field must quote the user's words" });
        }
      }
      if (field.provenance === "unknown" && field.value !== null) {
        ctx.addIssue({ code: "custom", path: ["value"], message: "unknown field must have a null value" });
      }
      if (field.provenance === "inferred" && field.value === null) {
        ctx.addIssue({ code: "custom", path: ["value"], message: "inferred field must have a value; use unknown otherwise" });
      }
      if (field.provenance !== "explicit" && field.evidence_span !== undefined) {
        ctx.addIssue({ code: "custom", path: ["evidence_span"], message: "evidence_span is only allowed on explicit fields" });
      }
    });
}

/** Only explicit facts count as established; inferred values never do. */
export function isEstablishedFact(field: { provenance: Provenance; value: unknown }): boolean {
  return field.provenance === "explicit" && field.value !== null;
}

/**
 * Transaction categories the extractor may assign. The first five mirror the
 * categories of knowledge_base_v1.json; "bnpl" is in MVP scope (PRODUCT_SPEC §3)
 * but has no approved record yet, so it can be detected but not answered.
 */
export const TRANSACTION_CATEGORIES = [
  ...KB_CATEGORIES,
  "bnpl",
  "unknown",
  "out_of_scope",
] as const;
export const TransactionCategorySchema = z.enum(TRANSACTION_CATEGORIES);
export type TransactionCategory = z.infer<typeof TransactionCategorySchema>;

export const RELATIONSHIP_TYPES = ["sale", "loan", "murabaha", "unknown"] as const;
export const RelationshipTypeSchema = z.enum(RELATIONSHIP_TYPES);

/** What the user is asking for; drives the safety pre-gate (owner decision #2). */
export const USER_INTENTS = [
  "general_knowledge",
  "personal_ruling",
  "personal_obligation",
  "dispute_or_rights",
  "unclear",
] as const;
export const UserIntentSchema = z.enum(USER_INTENTS);
export type UserIntent = z.infer<typeof UserIntentSchema>;

const text = z.string().min(1);

/** PRODUCT_SPEC.md §6 schema, with provenance on every fact and the approved extensions. */
export const TransactionSchema = z.object({
  category: TransactionCategorySchema,
  possible_classification: extractedField(text),
  relationship_type: extractedField(RelationshipTypeSchema),
  user_intent: UserIntentSchema,
  in_scope: z.boolean(),
  parties: z.array(
    z.object({
      role: text,
      description: extractedField(text),
    }),
  ),
  product_or_service: extractedField(text),
  payment_method: extractedField(text),
  payment_schedule: extractedField(text),
  fees: z.object({
    exists: extractedField(z.boolean()),
    type: extractedField(text),
    amount_or_rate: extractedField(text),
  }),
  late_penalty: z.object({
    exists: extractedField(z.boolean()),
    details: extractedField(text),
  }),
  financing_party: extractedField(text),
  ownership_transfer: extractedField(text),
  return_or_profit: extractedField(text),
  missing_information: z.array(text),
  needs_clarification: z.boolean(),
});
export type Transaction = z.infer<typeof TransactionSchema>;
