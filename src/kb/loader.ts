import productionKnowledgeBase from "../../knowledge_base_v2.json";
import {
  KnowledgeBaseV2FileSchema,
  SYNTHETIC_SOURCE_TYPE,
  type KnowledgeRecordV2,
} from "../domain/schemas/knowledgeRecord";

/**
 * Production knowledge loader. Loads knowledge_base_v2.json only, validates it
 * whole, and fails closed: any invalid, synthetic or unapproved record rejects
 * the entire knowledge base. There is never a partial load.
 *
 * Records are DATA. Source-facing fields (normalized_content, source_text,
 * verified_excerpt) and Mi'yar's editorial_constraints stay separate as in the
 * schema.
 */

export type KnowledgeBase = {
  readonly version: string;
  readonly records: readonly KnowledgeRecordV2[];
  readonly byId: ReadonlyMap<string, KnowledgeRecordV2>;
};

export type KbLoadErrorCode = "synthetic_data" | "invalid_schema" | "unapproved_record" | "unexpected_error";

export type KbLoadError = {
  code: KbLoadErrorCode;
  message: string;
  /** Short "path: message" lines for logs; never shown to users. */
  details: string[];
};

export type KbLoadResult = { ok: true; kb: KnowledgeBase } | { ok: false; error: KbLoadError };

function fail(code: KbLoadErrorCode, message: string, details: string[] = []): KbLoadResult {
  return { ok: false, error: { code, message, details } };
}

/** Explicit check before the schema so synthetic data gets a clear, specific error. */
function findSyntheticMarkers(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  const found: string[] = [];
  const file = raw as { synthetic_test_data?: unknown; records?: unknown };
  if (file.synthetic_test_data === true) found.push("file is marked synthetic_test_data");
  if (Array.isArray(file.records)) {
    file.records.forEach((r: unknown, i) => {
      if (typeof r !== "object" || r === null) return;
      const rec = r as { source_id?: unknown; source_type?: unknown };
      if (typeof rec.source_id === "string" && rec.source_id.startsWith("FIXTURE-")) {
        found.push(`records[${i}]: fixture id ${rec.source_id}`);
      }
      if (rec.source_type === SYNTHETIC_SOURCE_TYPE) {
        found.push(`records[${i}]: source_type ${SYNTHETIC_SOURCE_TYPE}`);
      }
    });
  }
  return found;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Validates raw knowledge-base data. Exported for tests; production code uses loadKnowledgeBase(). */
export function parseKnowledgeBase(raw: unknown): KbLoadResult {
  try {
    const synthetic = findSyntheticMarkers(raw);
    if (synthetic.length > 0) {
      return fail("synthetic_data", "synthetic test data is not allowed in the production knowledge base", synthetic);
    }

    const parsed = KnowledgeBaseV2FileSchema.safeParse(structuredClone(raw));
    if (!parsed.success) {
      return fail(
        "invalid_schema",
        "knowledge base does not match the v2 schema",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    }

    const unapproved = parsed.data.records.filter((r) => !r.approved).map((r) => r.source_id);
    if (unapproved.length > 0) {
      return fail("unapproved_record", "unapproved records are not allowed in the production knowledge base", unapproved);
    }

    const records = deepFreeze(parsed.data.records);
    const byId = new Map(records.map((r) => [r.source_id, r] as const));
    return { ok: true, kb: Object.freeze({ version: parsed.data.version, records, byId }) };
  } catch (e) {
    return fail("unexpected_error", "knowledge base could not be loaded", [e instanceof Error ? e.message : String(e)]);
  }
}

let cached: KbLoadResult | undefined;

/** Loads the bundled production knowledge base (knowledge_base_v2.json), once. */
export function loadKnowledgeBase(): KbLoadResult {
  cached ??= parseKnowledgeBase(productionKnowledgeBase);
  return cached;
}

export function getKnowledgeRecordById(kb: KnowledgeBase, sourceId: string): KnowledgeRecordV2 | undefined {
  return kb.byId.get(sourceId);
}

/** May be offered to retrieval as a candidate. */
export function isRetrievalEligible(record: KnowledgeRecordV2): boolean {
  return record.approved;
}

/**
 * May be cited and may support GROUNDED. Requires textual verification;
 * scholarly review is tracked separately and is not required here.
 */
export function isCitationEligible(record: KnowledgeRecordV2): boolean {
  return record.approved && record.verified_excerpt.verified;
}

export function getRetrievalEligibleRecords(kb: KnowledgeBase): readonly KnowledgeRecordV2[] {
  return kb.records.filter(isRetrievalEligible);
}

export function getCitationEligibleRecords(kb: KnowledgeBase): readonly KnowledgeRecordV2[] {
  return kb.records.filter(isCitationEligible);
}
