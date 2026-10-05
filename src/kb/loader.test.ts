import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import kbV2 from "../../knowledge_base_v2.json";
import { technicalErrorResult } from "../pipeline/results";
import {
  getCitationEligibleRecords,
  getKnowledgeRecordById,
  getRetrievalEligibleRecords,
  isCitationEligible,
  isRetrievalEligible,
  loadKnowledgeBase,
  parseKnowledgeBase,
  type KnowledgeBase,
} from "./loader";

const ROOT = resolve(__dirname, "../..");

function clone<T>(value: T): T {
  return structuredClone(value);
}

function loadedKb(): KnowledgeBase {
  const result = loadKnowledgeBase();
  if (!result.ok) throw new Error(`production KB failed to load: ${result.error.code}`);
  return result.kb;
}

function errorCode(raw: unknown) {
  const result = parseKnowledgeBase(raw);
  return result.ok ? "ok" : result.error.code;
}

describe("loadKnowledgeBase (production v2)", () => {
  it("loads knowledge_base_v2 successfully", () => {
    const result = loadKnowledgeBase();
    expect(result.ok).toBe(true);
    expect(loadedKb().version).toBe("v2");
  });

  it("contains the six approved records", () => {
    const kb = loadedKb();
    expect(kb.records.map((r) => r.source_id)).toEqual(["KB-001", "KB-002", "KB-003", "KB-004", "KB-005", "KB-006"]);
    expect(kb.records.every((r) => r.approved)).toBe(true);
  });

  it("preserves verification, scope and editorial fields exactly as stored", () => {
    const kb = loadedKb();
    expect(kb.records).toEqual(kbV2.records);
    const kb004 = getKnowledgeRecordById(kb, "KB-004")!;
    expect(kb004.editorial_constraints.grounding_scope).toBe("structural_only");
    expect(kb004.verification_scope).toBe("textual_source_match");
    expect(kb004.scholarly_review.reviewed).toBe(false);
    expect(kb004.verified_excerpt.verified).toBe(true);
  });

  it("keeps editorial constraints apart from source-facing text", () => {
    for (const r of loadedKb().records) {
      for (const note of r.editorial_constraints.usage_notes) {
        expect(r.normalized_content.includes(note), r.source_id).toBe(false);
      }
      expect(r, r.source_id).not.toHaveProperty("applicability_conditions");
    }
  });

  it("returns frozen records that cannot be mutated at runtime", () => {
    const r = getKnowledgeRecordById(loadedKb(), "KB-001")!;
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.verified_excerpt)).toBe(true);
    expect(() => {
      (r.verified_excerpt as { verified: boolean }).verified = false;
    }).toThrow();
  });

  it("looks records up by id and returns undefined for unknown ids", () => {
    const kb = loadedKb();
    expect(getKnowledgeRecordById(kb, "KB-003")?.topic).toBe("اشتراط حلول باقي الأقساط عند التأخر");
    expect(getKnowledgeRecordById(kb, "KB-999")).toBeUndefined();
    expect(getKnowledgeRecordById(kb, "FIXTURE-A")).toBeUndefined();
  });
});

describe("retrieval vs citation eligibility", () => {
  it("makes all six records retrieval- and citation-eligible today", () => {
    const kb = loadedKb();
    expect(getRetrievalEligibleRecords(kb)).toHaveLength(6);
    expect(getCitationEligibleRecords(kb)).toHaveLength(6);
  });

  it("requires verified=true for citation, but not for retrieval", () => {
    const raw = clone(kbV2);
    raw.records[1]!.verified_excerpt.verified = false;
    (raw.records[1]!.verified_excerpt as { verified_at: string | null }).verified_at = null;
    const result = parseKnowledgeBase(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kb002 = getKnowledgeRecordById(result.kb, "KB-002")!;
    expect(isRetrievalEligible(kb002)).toBe(true);
    expect(isCitationEligible(kb002)).toBe(false);
    expect(getRetrievalEligibleRecords(result.kb).map((r) => r.source_id)).toContain("KB-002");
    expect(getCitationEligibleRecords(result.kb).map((r) => r.source_id)).not.toContain("KB-002");
  });
});

describe("fail-closed loading (never a partial knowledge base)", () => {
  it("rejects a file marked synthetic_test_data", () => {
    expect(errorCode({ ...clone(kbV2), synthetic_test_data: true })).toBe("synthetic_data");
  });

  it("rejects a FIXTURE-* record inside production data", () => {
    const raw = clone(kbV2);
    raw.records[2]!.source_id = "FIXTURE-A";
    expect(errorCode(raw)).toBe("synthetic_data");
  });

  it("rejects a record with source_type synthetic_test_fixture", () => {
    const raw = clone(kbV2);
    raw.records[0]!.source_type = "synthetic_test_fixture";
    expect(errorCode(raw)).toBe("synthetic_data");
  });

  it("rejects every eval fixture file as production data", () => {
    const dir = join(ROOT, "eval", "fixtures");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
      expect(parseKnowledgeBase(raw).ok, file).toBe(false);
    }
  });

  it("rejects an unapproved record instead of silently dropping it", () => {
    const raw = clone(kbV2);
    raw.records[3]!.approved = false;
    const result = parseKnowledgeBase(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unapproved_record");
      expect(result.error.details).toEqual(["KB-004"]);
    }
  });

  it("rejects an invalid production record (excerpt not verbatim) and loads nothing", () => {
    const raw = clone(kbV2);
    raw.records[0]!.verified_excerpt.text = "نص غير موجود في المصدر";
    const result = parseKnowledgeBase(raw);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("kb");
  });

  it("rejects a record with a missing required field", () => {
    const raw = clone(kbV2) as unknown as { records: Record<string, unknown>[] };
    delete raw.records[0]!.claims_check;
    expect(errorCode(raw)).toBe("invalid_schema");
  });

  it("rejects corrupted input without throwing", () => {
    for (const bad of [null, undefined, 42, "not json", [], {}, { records: "x" }]) {
      expect(() => parseKnowledgeBase(bad)).not.toThrow();
      expect(parseKnowledgeBase(bad).ok).toBe(false);
    }
  });

  it("maps a load failure to TECHNICAL_ERROR with no answer and no citation", () => {
    const result = parseKnowledgeBase(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const out = technicalErrorResult(`kb_${result.error.code}`);
    expect(out.state).toBe("TECHNICAL_ERROR");
    expect(out).not.toHaveProperty("citations");
    expect(out.retrieved_source_ids).toEqual([]);
  });
});

describe("runtime source boundaries", () => {
  const runtimeFiles: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      // testdata/ holds test-only modules (fixtures harness, canned model outputs).
      if (statSync(path).isDirectory()) {
        if (name !== "testdata") walk(path);
      } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) && name !== "testHelpers.ts") runtimeFiles.push(path);
    }
  };
  walk(join(ROOT, "src"));

  it("never imports test-only modules (testdata/, testHelpers) from application code", () => {
    const offenders = runtimeFiles.filter((f) => /from\s+["'][^"']*(?:\/testdata\/|testHelpers)/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("never imports eval/fixtures from application code", () => {
    const offenders = runtimeFiles.filter((f) => /from\s+["'][^"']*\beval[\\/]|["'`][^"'`\n]*\beval[\\/]+fixtures/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("never uses knowledge_base_v1 at runtime", () => {
    // Imports or path strings only; comments describing the v1 format are fine.
    const offenders = runtimeFiles.filter((f) => /["'`][^"'`\n]*knowledge_base_v1/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("loads the production knowledge base from knowledge_base_v2.json", () => {
    const loader = readFileSync(join(ROOT, "src", "kb", "loader.ts"), "utf8");
    expect(loader).toMatch(/from\s+["'][./]+knowledge_base_v2\.json["']/);
  });
});
