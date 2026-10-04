import { z } from "zod";
import { ResponseStateSchema } from "../responseStates";

/** Categories that approved records may belong to (knowledge_base_v1.json). */
export const KB_CATEGORIES = [
  "sale_installments",
  "late_payment_terms",
  "murabaha_purchase_orderer",
  "loan_with_conditioned_increase",
  "interest_bearing_loan",
] as const;
export const KbCategorySchema = z.enum(KB_CATEGORIES);

/** Production IDs look like KB-001. Fixture IDs (FIXTURE-*) can never pass this. */
export const PRODUCTION_SOURCE_ID = /^KB-\d{3}$/;

/** Markers every synthetic fixture record carries; production rejects both. */
export const SYNTHETIC_SOURCE_TYPE = "synthetic_test_fixture";
export const SYNTHETIC_URL_HOST_SUFFIX = ".test";

function isSyntheticRecord(record: { source_type: string; source_url: string }): boolean {
  return (
    record.source_type === SYNTHETIC_SOURCE_TYPE ||
    new URL(record.source_url).hostname.endsWith(SYNTHETIC_URL_HOST_SUFFIX)
  );
}

/**
 * A verbatim excerpt that a reviewer has checked against the original source.
 * Only an excerpt with verified=true may be shown to users as a quotation
 * (owner decision #6).
 */
export const VerifiedExcerptSchema = z.object({
  text: z.string().min(1),
  page_or_location: z.string().min(1),
  verified: z.boolean(),
  verified_by: z.string().min(1).optional(),
  verified_at: z.string().min(1).optional(),
});
export type VerifiedExcerpt = z.infer<typeof VerifiedExcerptSchema>;

const nonEmpty = z.string().min(1);

/**
 * Record as stored in knowledge_base_v1.json. The v1 field `source_excerpt`
 * is NOT verified, so it is read as a summary, never as a quotation.
 */
export const RawKnowledgeRecordSchema = z.object({
  source_id: nonEmpty,
  topic: nonEmpty,
  category: KbCategorySchema,
  source_title: nonEmpty,
  source_section: nonEmpty,
  source_url: z.url(),
  source_type: nonEmpty,
  approved: z.boolean(),
  normalized_content: nonEmpty,
  source_excerpt: nonEmpty.optional(),
  source_summary: nonEmpty.optional(),
  source_text: nonEmpty.optional(),
  verified_excerpt: VerifiedExcerptSchema.optional(),
  applicability_conditions: z.array(nonEmpty).min(1),
  must_not_generalize_to: z.array(nonEmpty),
  retrieval_keywords: z.array(nonEmpty).min(1),
  default_response_state: ResponseStateSchema,
  notes: z.string(),
});

/** Normalized record used by the pipeline. */
export const KnowledgeRecordSchema = RawKnowledgeRecordSchema.transform((raw, ctx) => {
  const { source_excerpt, source_summary, ...rest } = raw;
  const summary = source_summary ?? source_excerpt;
  if (!summary) {
    ctx.addIssue({ code: "custom", message: `record ${raw.source_id} has no source_summary` });
    return z.NEVER;
  }
  return { ...rest, source_summary: summary };
});
export type KnowledgeRecord = z.infer<typeof KnowledgeRecordSchema>;

/** True only when the record has a reviewer-verified verbatim excerpt. */
export function isQuotable(record: Pick<KnowledgeRecord, "verified_excerpt">): boolean {
  return record.verified_excerpt?.verified === true;
}

/**
 * A scholarly position held in an approved source on a given issue
 * (owner decision #5: no simplified halal/haram field). DISPUTED means
 * two or more applicable positions with different position_ids on the
 * same issue_id; they are shown side by side with no preference.
 */
export const PositionSchema = z.object({
  position_id: nonEmpty,
  issue_id: nonEmpty,
  source_id: nonEmpty,
  position_summary: nonEmpty,
  context: z.object({
    applies_when: z.array(nonEmpty),
    notes: z.string().optional(),
  }),
});
export type Position = z.infer<typeof PositionSchema>;

const knowledgeBaseFileShape = {
  project: z.literal("Mi'yar"),
  version: nonEmpty,
  language: z.literal("ar"),
  knowledge_policy: z.object({
    mode: z.literal("closed_approved_sources"),
    note: z.string().optional(),
  }),
  records: z.array(KnowledgeRecordSchema).min(1),
  positions: z.array(PositionSchema).default([]),
};

function checkReferences(
  file: { records: KnowledgeRecord[]; positions: Position[] },
  ctx: z.RefinementCtx,
) {
  const ids = new Set<string>();
  for (const record of file.records) {
    if (ids.has(record.source_id)) {
      ctx.addIssue({ code: "custom", path: ["records"], message: `duplicate source_id ${record.source_id}` });
    }
    ids.add(record.source_id);
  }
  for (const position of file.positions) {
    if (!ids.has(position.source_id)) {
      ctx.addIssue({
        code: "custom",
        path: ["positions"],
        message: `position ${position.position_id} references unknown source ${position.source_id}`,
      });
    }
  }
}

/** Production knowledge base: real records only, never synthetic data. */
export const KnowledgeBaseFileSchema = z
  .object({ ...knowledgeBaseFileShape, synthetic_test_data: z.literal(false).optional() })
  .superRefine((file, ctx) => {
    checkReferences(file, ctx);
    for (const record of file.records) {
      if (!PRODUCTION_SOURCE_ID.test(record.source_id)) {
        ctx.addIssue({
          code: "custom",
          path: ["records"],
          message: `source_id ${record.source_id} is not a production ID`,
        });
      }
      if (isSyntheticRecord(record)) {
        ctx.addIssue({
          code: "custom",
          path: ["records"],
          message: `record ${record.source_id} is synthetic test data`,
        });
      }
    }
  });
export type KnowledgeBaseFile = z.infer<typeof KnowledgeBaseFileSchema>;

/**
 * Synthetic test fixtures (eval/fixtures). Must be explicitly marked and must
 * never be loaded by the application (owner decision #4).
 */
export const FixtureKnowledgeBaseFileSchema = z
  .object({ ...knowledgeBaseFileShape, synthetic_test_data: z.literal(true) })
  .superRefine((file, ctx) => {
    checkReferences(file, ctx);
    for (const record of file.records) {
      if (PRODUCTION_SOURCE_ID.test(record.source_id)) {
        ctx.addIssue({
          code: "custom",
          path: ["records"],
          message: `fixture record ${record.source_id} must not use a production ID`,
        });
      }
      if (record.source_type !== SYNTHETIC_SOURCE_TYPE || !new URL(record.source_url).hostname.endsWith(SYNTHETIC_URL_HOST_SUFFIX)) {
        ctx.addIssue({
          code: "custom",
          path: ["records"],
          message: `fixture record ${record.source_id} must use source_type ${SYNTHETIC_SOURCE_TYPE} and a ${SYNTHETIC_URL_HOST_SUFFIX} URL`,
        });
      }
    }
  });
