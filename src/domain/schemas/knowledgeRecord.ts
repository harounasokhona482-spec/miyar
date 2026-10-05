import { z } from "zod";
import { ResponseStateSchema } from "../responseStates";

/** Categories that approved records may belong to (knowledge_base_v2.json). */
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
export function isQuotable(record: { verified_excerpt?: { verified: boolean } }): boolean {
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
 * Canonical form for verbatim matching. Arabic combining marks (e.g. shadda +
 * fatha) can be stored in either order, so NFC is required; whitespace is
 * collapsed. Letters and diacritics are otherwise compared exactly.
 */
export function normalizeForMatch(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Knowledge base v2: textual verification draft (knowledge_base_v2.json).
// ---------------------------------------------------------------------------

const SourcePassageSchema = z.strictObject({
  location: z.enum(["main_text", "footnote"]),
  footnote_number: z.number().int().positive().optional(),
  text: nonEmpty,
});

const VerifiedExcerptV2Schema = z.strictObject({
  text: nonEmpty,
  location_type: z.enum(["main_text", "footnote"]),
  footnote_number: z.number().int().positive().optional(),
  page_or_location: nonEmpty,
  verified: z.boolean(),
  verified_by: nonEmpty,
  verified_at: nonEmpty.nullable(),
});

export const CLAIM_STATUSES = ["supported", "partially_supported", "not_in_source", "editorial"] as const;
export const GROUNDING_SCOPES = ["full", "structural_only"] as const;
export type GroundingScope = (typeof GROUNDING_SCOPES)[number];

/** structural: describes parties/sequence/forms only; general: may state the source's ruling. */
export const CLAIM_SCOPES = ["general", "structural"] as const;

const ClaimCheckSchema = z.strictObject({
  /** Stable reference used by generation and citation verification: <source_id>-Cnn. */
  claim_id: z.string().regex(/^KB-\d{3}-C\d{2}$/),
  claim_scope: z.enum(CLAIM_SCOPES),
  claim: nonEmpty,
  status: z.enum(CLAIM_STATUSES),
  supporting_text: nonEmpty.optional(),
  note: nonEmpty.optional(),
});

export const KnowledgeRecordV2Schema = z
  .strictObject({
    source_id: nonEmpty,
    topic: nonEmpty,
    category: KbCategorySchema,
    approved: z.boolean(),
    source_title: nonEmpty,
    source_section: nonEmpty,
    source_url: z.url(),
    source_type: nonEmpty,
    source_location: z.strictObject({
      breadcrumb: z.array(nonEmpty).min(1),
      section_heading: nonEmpty,
    }),
    source_accessed_at: z.iso.date(),
    normalized_content: nonEmpty,
    /** Unverified summary from v1. Never shown as a quotation. */
    source_summary: nonEmpty,
    /** Verbatim passages copied from source_url. */
    source_text: z.array(SourcePassageSchema).min(1),
    verified_excerpt: VerifiedExcerptV2Schema,
    verification_scope: z.literal("textual_source_match"),
    scholarly_review: z.strictObject({
      reviewed: z.boolean(),
      reviewer: nonEmpty.nullable(),
      reviewed_at: nonEmpty.nullable(),
    }),
    claims_check: z.array(ClaimCheckSchema).min(1),
    original_reference: z.array(
      z.strictObject({
        citation: nonEmpty,
        as_cited_in: nonEmpty,
        checked_against_original: z.boolean(),
      }),
    ),
    /** Reviewer notes (constraints, disagreements). Never turned into positions automatically. */
    review_findings: z.array(nonEmpty),
    /** Mi'yar's own guards and usage notes, never presented as source text. */
    editorial_constraints: z.strictObject({
      origin: z.literal("miyar_editorial"),
      /** structural_only: may ground descriptive/structural claims, never a validity ruling. */
      grounding_scope: z.enum(GROUNDING_SCOPES),
      applicability_conditions: z.array(nonEmpty).min(1),
      must_not_generalize_to: z.array(nonEmpty),
      usage_notes: z.array(nonEmpty),
    }),
    retrieval_keywords: z.array(nonEmpty).min(1),
    default_response_state: ResponseStateSchema,
  })
  .superRefine((r, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message: `${r.source_id}: ${message}` });
    const passages = r.source_text.map((p) => normalizeForMatch(p.text));
    const inSource = (text: string) => passages.some((p) => p.includes(normalizeForMatch(text)));

    if (!inSource(r.verified_excerpt.text)) {
      issue(["verified_excerpt", "text"], "verified_excerpt must be a verbatim part of source_text");
    }
    r.claims_check.forEach((c, i) => {
      if (c.supporting_text && !inSource(c.supporting_text)) {
        issue(["claims_check", i, "supporting_text"], "supporting_text must be a verbatim part of source_text");
      }
      if ((c.status === "supported" || c.status === "partially_supported") && !c.supporting_text && !c.note) {
        issue(["claims_check", i], "a supported claim needs supporting_text or a note");
      }
    });
    for (const [i, p] of [...r.source_text.entries(), [-1, r.verified_excerpt] as const]) {
      const location = "location" in p ? p.location : p.location_type;
      if (location === "footnote" && p.footnote_number === undefined) {
        issue(i === -1 ? ["verified_excerpt"] : ["source_text", i], "footnote passages need footnote_number");
      }
    }

    // A quote from a footnote must say so, and must never pose as main text.
    const excerpt = r.verified_excerpt;
    if (excerpt.location_type === "footnote" && !excerpt.page_or_location.startsWith(`الهامش (${excerpt.footnote_number})`)) {
      issue(["verified_excerpt", "page_or_location"], `footnote excerpt location must start with "الهامش (${excerpt.footnote_number})"`);
    }
    if (excerpt.location_type === "main_text" && !excerpt.page_or_location.startsWith("المتن")) {
      issue(["verified_excerpt", "page_or_location"], 'main-text excerpt location must start with "المتن"');
    }

    if (excerpt.verified) {
      if (excerpt.verified_at === null || !/^\d{4}-\d{2}-\d{2}$/.test(excerpt.verified_at)) {
        issue(["verified_excerpt", "verified_at"], "verified=true requires an ISO verified_at date");
      }
      // A verified record carries only source-supported claims, and its
      // normalized_content is exactly those claims: nothing editorial, nothing unsupported.
      r.claims_check.forEach((c, i) => {
        if (c.status !== "supported" || !c.supporting_text) {
          issue(["claims_check", i], "a verified record may contain only supported claims with supporting_text");
        }
      });
      if (r.normalized_content !== r.claims_check.map((c) => c.claim).join(" ")) {
        issue(["normalized_content"], "normalized_content must be exactly the supported claims, in order");
      }
    }
    r.claims_check.forEach((c, i) => {
      const expected = `${r.source_id}-C${String(i + 1).padStart(2, "0")}`;
      if (c.claim_id !== expected) issue(["claims_check", i, "claim_id"], `claim_id must be ${expected} (stable, sequential)`);
      if (r.editorial_constraints.grounding_scope === "structural_only" && c.claim_scope !== "structural") {
        issue(["claims_check", i, "claim_scope"], "a structural_only record may hold structural claims only");
      }
    });
    if (r.scholarly_review.reviewed && (r.scholarly_review.reviewer === null || r.scholarly_review.reviewed_at === null)) {
      issue(["scholarly_review"], "reviewed=true requires reviewer and reviewed_at");
    }
    if (!PRODUCTION_SOURCE_ID.test(r.source_id) || isSyntheticRecord(r)) {
      issue(["source_id"], "v2 records must be production, non-synthetic records");
    }
  });
export type KnowledgeRecordV2 = z.infer<typeof KnowledgeRecordV2Schema>;

export const KnowledgeBaseV2FileSchema = z
  .strictObject({
    project: z.literal("Mi'yar"),
    version: nonEmpty,
    derived_from: nonEmpty,
    language: z.literal("ar"),
    status: nonEmpty,
    knowledge_policy: z.strictObject({
      mode: z.literal("closed_approved_sources"),
      note: z.string().optional(),
    }),
    records: z.array(KnowledgeRecordV2Schema).min(1),
  })
  .superRefine((file, ctx) => {
    const ids = file.records.map((r) => r.source_id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "duplicate source_id" });
  });
export type KnowledgeBaseV2File = z.infer<typeof KnowledgeBaseV2FileSchema>;

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
