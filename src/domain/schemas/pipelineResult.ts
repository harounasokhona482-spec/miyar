import { z } from "zod";
import { DONT_KNOW_OPTION } from "../messages";
import { TransactionSchema } from "./transaction";

export const MAX_CLARIFICATION_ROUNDS = 3;

const sourceIds = z.array(z.string().min(1));

const base = {
  message: z.string().min(1),
  disclaimer: z.string().min(1),
  transaction: TransactionSchema.optional(),
  retrieved_source_ids: sourceIds.default([]),
};

/**
 * A claim in a grounded answer. Display "verified_quote" is allowed only
 * for records with a verified excerpt; citation verification enforces this
 * against the knowledge base. Everything else is shown as a summary.
 */
export const CitationSchema = z.object({
  claim: z.string().min(1),
  source_id: z.string().min(1),
  display: z.enum(["summary", "verified_quote"]),
});
export type Citation = z.infer<typeof CitationSchema>;

const GroundedSchema = z
  .object({
    ...base,
    state: z.literal("GROUNDED"),
    supporting_source_ids: sourceIds.min(1),
    citations: z.array(CitationSchema).min(1),
  })
  .superRefine((r, ctx) => {
    const supporting = new Set(r.supporting_source_ids);
    r.citations.forEach((c, i) => {
      if (!supporting.has(c.source_id)) {
        ctx.addIssue({
          code: "custom",
          path: ["citations", i, "source_id"],
          message: `cited ${c.source_id} is not a supporting source`,
        });
      }
    });
  });

const DisputedPositionSchema = z.object({
  position_id: z.string().min(1),
  issue_id: z.string().min(1),
  source_id: z.string().min(1),
  position_summary: z.string().min(1),
});

const DisputedSchema = z
  .object({
    ...base,
    state: z.literal("DISPUTED"),
    positions: z.array(DisputedPositionSchema).min(2),
  })
  .superRefine((r, ctx) => {
    if (new Set(r.positions.map((p) => p.position_id)).size < 2) {
      ctx.addIssue({ code: "custom", path: ["positions"], message: "DISPUTED needs at least two distinct positions" });
    }
    if (new Set(r.positions.map((p) => p.issue_id)).size !== 1) {
      ctx.addIssue({ code: "custom", path: ["positions"], message: "DISPUTED positions must address the same issue" });
    }
  });

const NeedsClarificationSchema = z.object({
  ...base,
  state: z.literal("NEEDS_CLARIFICATION"),
  clarification: z.object({
    missing_fact: z.string().min(1),
    question: z.string().min(1),
    options: z
      .array(z.string().min(1))
      .min(2)
      .refine((o) => o.includes(DONT_KNOW_OPTION), { message: `options must include "${DONT_KNOW_OPTION}"` }),
    round: z.number().int().min(1).max(MAX_CLARIFICATION_ROUNDS),
  }),
});

export const REFERRAL_REASONS = [
  "personal_ruling",
  "personal_obligation",
  "dispute_or_rights",
  "specialist_judgment_required",
] as const;

const ReferralSchema = z.object({
  ...base,
  state: z.literal("REFERRAL"),
  referral_reason: z.enum(REFERRAL_REASONS),
  related_source_ids: sourceIds.default([]),
});

export const INSUFFICIENT_REASONS = [
  "no_supporting_source",
  "out_of_scope",
  "unsupported_language",
  "unknown_material_fact",
  "clarification_limit_reached",
  "citation_verification_failed",
] as const;

const InsufficientEvidenceSchema = z.object({
  ...base,
  state: z.literal("INSUFFICIENT_EVIDENCE"),
  insufficient_reason: z.enum(INSUFFICIENT_REASONS),
});

const TechnicalErrorSchema = z.object({
  ...base,
  state: z.literal("TECHNICAL_ERROR"),
  error_code: z.string().min(1),
});

/** The single output contract of the pipeline: exactly one approved state. */
export const PipelineResultSchema = z.discriminatedUnion("state", [
  GroundedSchema,
  DisputedSchema,
  NeedsClarificationSchema,
  ReferralSchema,
  InsufficientEvidenceSchema,
  TechnicalErrorSchema,
]);
export type PipelineResult = z.infer<typeof PipelineResultSchema>;
