import { describe, expect, it } from "vitest";
import kbV1 from "../../../knowledge_base_v1.json";
import kbV2 from "../../../knowledge_base_v2.json";
import { KnowledgeBaseFileSchema, KnowledgeBaseV2FileSchema, isQuotable, normalizeForMatch } from "./knowledgeRecord";

// Validation of knowledge_base_v2.json only. No loader logic here.

const parsed = KnowledgeBaseV2FileSchema.safeParse(kbV2);
const v2 = parsed.data!;
const v1ById = new Map(kbV1.records.map((r) => [r.source_id, r]));
const byId = (id: string) => v2.records.find((r) => r.source_id === id)!;

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("knowledge_base_v2.json structure", () => {
  it("parses against the v2 schema", () => {
    expect(parsed.error?.issues).toBeUndefined();
  });

  it("covers exactly the six v1 records, from the same approved URLs (no new source)", () => {
    expect(v2.records.map((r) => r.source_id)).toEqual(kbV1.records.map((r) => r.source_id));
    for (const r of v2.records) {
      const old = v1ById.get(r.source_id)!;
      expect(r.source_url, r.source_id).toBe(old.source_url);
      expect(r.approved, r.source_id).toBe(old.approved);
    }
  });

  it("leaves knowledge_base_v1.json valid and untouched in shape", () => {
    expect(KnowledgeBaseFileSchema.safeParse(kbV1).success).toBe(true);
  });
});

describe("textual verification (owner approval 2026-10-05)", () => {
  it("marks all six records verified for textual_source_match only, with no scholarly review", () => {
    for (const r of v2.records) {
      expect(r.verified_excerpt.verified, r.source_id).toBe(true);
      expect(r.verified_excerpt.verified_by, r.source_id).toBe("project_owner");
      expect(r.verified_excerpt.verified_at, r.source_id).toBe("2026-10-05");
      expect(r.verification_scope, r.source_id).toBe("textual_source_match");
      expect(r.scholarly_review, r.source_id).toEqual({ reviewed: false, reviewer: null, reviewed_at: null });
    }
  });

  it("makes every verified excerpt quotable, and nothing else", () => {
    expect(v2.records.every(isQuotable)).toBe(true);
  });

  it("keeps every original reference unchecked against the printed source", () => {
    expect(v2.records.flatMap((r) => r.original_reference).every((ref) => !ref.checked_against_original)).toBe(true);
  });
});

describe("no unsupported or editorial claim in source-facing text", () => {
  it("builds normalized_content only from supported claims", () => {
    for (const r of v2.records) {
      expect(r.claims_check.every((c) => c.status === "supported" && c.supporting_text), r.source_id).toBe(true);
      expect(r.normalized_content, r.source_id).toBe(r.claims_check.map((c) => c.claim).join(" "));
    }
  });

  it("keeps editorial phrasing out of normalized_content and source_summary", () => {
    const editorial = /يستخدم|يُستخدم|يختلف عن|لا يغطي|لا يكفي|من حيث الأصل|جزءًا من عقد البيع/;
    for (const r of v2.records) {
      expect(r.normalized_content, r.source_id).not.toMatch(editorial);
      expect(r.source_summary, r.source_id).not.toMatch(editorial);
    }
  });

  it("moves v1 notes into editorial usage_notes", () => {
    for (const r of v2.records) {
      expect(r.editorial_constraints.usage_notes.length, r.source_id).toBeGreaterThan(0);
      expect(r, r.source_id).not.toHaveProperty("notes");
    }
  });
});

describe("owner decisions on specific records", () => {
  it("KB-003 applies only to installment sales, not to every installment debt", () => {
    const conditions = byId("KB-003").editorial_constraints.applicability_conditions;
    expect(conditions).toContain("وجود بيع بالتقسيط");
    expect(conditions.join(" ")).not.toMatch(/دين بأقساط/);
    expect(byId("KB-003").editorial_constraints.must_not_generalize_to).toContain("دين بأقساط لا ينشأ عن بيع بالتقسيط");
  });

  it("KB-004 grounds structural claims only, and forbids a general validity ruling", () => {
    const kb004 = byId("KB-004");
    expect(kb004.editorial_constraints.grounding_scope).toBe("structural_only");
    expect(kb004.editorial_constraints.must_not_generalize_to).toContain("حكم عام بجواز أو منع المرابحة للآمر بالشراء");
    expect(v2.records.filter((r) => r.editorial_constraints.grounding_scope === "structural_only").map((r) => r.source_id)).toEqual(["KB-004"]);
  });

  it("labels footnote excerpts as footnotes, never as main text (KB-006)", () => {
    const e = byId("KB-006").verified_excerpt;
    expect(e.location_type).toBe("footnote");
    expect(e.page_or_location.startsWith("الهامش (1)")).toBe(true);
  });
});

describe("verbatim and labelling rules", () => {
  it("matches across different orderings of Arabic combining marks", () => {
    expect(normalizeForMatch("الثَّمَنُ")).toBe(normalizeForMatch("الثَّمَنُ"));
  });

  it("rejects a verified_excerpt that is not verbatim in source_text", () => {
    const kb = clone(kbV2);
    kb.records[0]!.verified_excerpt.text = "يجوز أن يؤدى الثمن مؤجلا"; // diacritics stripped: not verbatim
    expect(KnowledgeBaseV2FileSchema.safeParse(kb).success).toBe(false);
  });

  it("rejects a claim whose supporting_text is not in source_text", () => {
    const kb = clone(kbV2);
    kb.records[0]!.claims_check[0]!.supporting_text = "نص غير موجود في المصدر";
    expect(KnowledgeBaseV2FileSchema.safeParse(kb).success).toBe(false);
  });

  it("rejects an extra sentence in normalized_content that is not a claim", () => {
    const kb = clone(kbV2);
    kb.records[0]!.normalized_content += " يستخدم هذا السجل للتمييز.";
    expect(KnowledgeBaseV2FileSchema.safeParse(kb).success).toBe(false);
  });

  it("rejects a verified record with a non-supported claim", () => {
    const kb = clone(kbV2);
    kb.records[0]!.claims_check[0]!.status = "partially_supported";
    expect(KnowledgeBaseV2FileSchema.safeParse(kb).success).toBe(false);
  });

  it("rejects a footnote excerpt whose location does not say الهامش (n)", () => {
    const kb = clone(kbV2);
    kb.records[5]!.verified_excerpt.page_or_location = "المتن — المبحث الأول: حكم الربا";
    expect(KnowledgeBaseV2FileSchema.safeParse(kb).success).toBe(false);
  });

  it("rejects verified=true without a date, and a scholarly review without reviewer", () => {
    const a = clone(kbV2) as unknown as { records: { verified_excerpt: { verified_at: string | null } }[] };
    a.records[0]!.verified_excerpt.verified_at = null;
    expect(KnowledgeBaseV2FileSchema.safeParse(a).success).toBe(false);

    const b = clone(kbV2);
    b.records[0]!.scholarly_review.reviewed = true;
    expect(KnowledgeBaseV2FileSchema.safeParse(b).success).toBe(false);
  });

  it("rejects legacy top-level editorial fields", () => {
    const kb = clone(kbV2) as unknown as { records: Record<string, unknown>[] };
    kb.records[0]!.applicability_conditions = ["x"];
    expect(KnowledgeBaseV2FileSchema.safeParse(kb).success).toBe(false);
  });

  it("rejects footnote passages without a footnote number", () => {
    const kb = clone(kbV2);
    const footnote = kb.records[1]!.source_text.find((p) => p.location === "footnote")!;
    delete (footnote as { footnote_number?: number }).footnote_number;
    expect(KnowledgeBaseV2FileSchema.safeParse(kb).success).toBe(false);
  });
});
