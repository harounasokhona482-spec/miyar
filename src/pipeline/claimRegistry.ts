import { normalizeForMatch, type KnowledgeRecordV2 } from "../domain/schemas/knowledgeRecord";

/**
 * Claim registry: the only religious statements the answer may contain.
 * Built from claims_check in knowledge_base_v2: each claim has a stable
 * claim_id (KB-001-C01 …), its text (part of normalized_content), and a
 * supporting_text copied verbatim from source_text.
 */

export type RegisteredClaim = {
  claim_id: string;
  source_id: string;
  text: string;
  claim_scope: "general" | "structural";
  supporting_text: string;
  /** Where supporting_text sits: main text or a numbered footnote. */
  location: string;
};

/** Where a verbatim passage sits in the record, labelled as main text or footnote. */
export function passageLocation(record: KnowledgeRecordV2, passage: string): string | null {
  const needle = normalizeForMatch(passage);
  const hit = record.source_text.find((p) => normalizeForMatch(p.text).includes(needle));
  if (!hit) return null;
  const where = hit.location === "footnote" ? `الهامش (${hit.footnote_number})` : "المتن";
  return `${where} — ${record.source_section}`;
}

/** Supported, verbatim-backed claims of a record. Anything else is not registered. */
export function registeredClaims(record: KnowledgeRecordV2): RegisteredClaim[] {
  return record.claims_check.flatMap((c) => {
    if (c.status !== "supported" || !c.supporting_text) return [];
    const location = passageLocation(record, c.supporting_text);
    if (!location) return [];
    return [
      {
        claim_id: c.claim_id,
        source_id: record.source_id,
        text: c.claim,
        claim_scope: c.claim_scope,
        supporting_text: c.supporting_text,
        location,
      },
    ];
  });
}

export function findRegisteredClaim(record: KnowledgeRecordV2, claimId: string): RegisteredClaim | undefined {
  return registeredClaims(record).find((c) => c.claim_id === claimId);
}
