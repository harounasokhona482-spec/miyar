import { describe, expect, it } from "vitest";
import productionKb from "../../../knowledge_base_v1.json";
import { FixtureKnowledgeBaseFileSchema, KnowledgeBaseFileSchema, isQuotable } from "./knowledgeRecord";

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("production knowledge base v1", () => {
  const parsed = KnowledgeBaseFileSchema.safeParse(productionKb);

  it("parses against the schema", () => {
    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.success).toBe(true);
  });

  it("contains the six approved records", () => {
    expect(parsed.data?.records.map((r) => r.source_id)).toEqual(["KB-001", "KB-002", "KB-003", "KB-004", "KB-005", "KB-006"]);
    expect(parsed.data?.records.every((r) => r.approved)).toBe(true);
  });

  it("reads the unverified source_excerpt as source_summary", () => {
    const record = parsed.data?.records[0];
    expect(record?.source_summary).toBe(productionKb.records[0]?.source_excerpt);
    expect(record).not.toHaveProperty("source_excerpt");
  });

  it("has no record that may be shown as a verbatim quotation yet", () => {
    expect(parsed.data?.records.some(isQuotable)).toBe(false);
  });

  it("has no positions, so DISPUTED is not reachable with production data", () => {
    expect(parsed.data?.positions).toEqual([]);
  });
});

describe("production / fixture separation", () => {
  it("rejects a fixture-style ID in the production KB", () => {
    const kb = clone(productionKb);
    kb.records[0]!.source_id = "FIXTURE-A";
    expect(KnowledgeBaseFileSchema.safeParse(kb).success).toBe(false);
  });

  it("rejects a record with the synthetic source_type even under a production ID", () => {
    const kb = clone(productionKb);
    kb.records[0]!.source_type = "synthetic_test_fixture";
    expect(KnowledgeBaseFileSchema.safeParse(kb).success).toBe(false);
  });

  it("rejects a record hosted on the reserved .test domain", () => {
    const kb = clone(productionKb);
    kb.records[0]!.source_url = "https://fixtures.miyar.test/KB-001";
    expect(KnowledgeBaseFileSchema.safeParse(kb).success).toBe(false);
  });

  it("rejects a file marked as synthetic test data", () => {
    expect(KnowledgeBaseFileSchema.safeParse({ ...clone(productionKb), synthetic_test_data: true }).success).toBe(false);
  });

  it("rejects a fixture file that is not marked synthetic", () => {
    const fixture = clone(productionKb);
    fixture.records[0]!.source_id = "FIXTURE-A";
    expect(FixtureKnowledgeBaseFileSchema.safeParse(fixture).success).toBe(false);
  });

  it("rejects a fixture file that reuses production IDs", () => {
    expect(FixtureKnowledgeBaseFileSchema.safeParse({ ...clone(productionKb), synthetic_test_data: true }).success).toBe(false);
  });
});

describe("record validation", () => {
  it("rejects duplicate source IDs", () => {
    const kb = clone(productionKb);
    kb.records[1]!.source_id = "KB-001";
    expect(KnowledgeBaseFileSchema.safeParse(kb).success).toBe(false);
  });

  it("rejects a position that points to a missing source", () => {
    const kb = {
      ...clone(productionKb),
      positions: [
        {
          position_id: "P-1",
          issue_id: "I-1",
          source_id: "KB-999",
          position_summary: "ملخص",
          context: { applies_when: [] },
        },
      ],
    };
    expect(KnowledgeBaseFileSchema.safeParse(kb).success).toBe(false);
  });

  it("treats an excerpt as quotable only when verified=true", () => {
    const excerpt = { text: "نص", page_or_location: "ص 1" };
    expect(isQuotable({ verified_excerpt: { ...excerpt, verified: false } })).toBe(false);
    expect(isQuotable({ verified_excerpt: { ...excerpt, verified: true } })).toBe(true);
    expect(isQuotable({})).toBe(false);
  });
});
