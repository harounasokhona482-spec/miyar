import { normalizeForMatch, type KnowledgeRecordV2 } from "../domain/schemas/knowledgeRecord";
import { arabicPhrase, matchesAny, normalizeArabic } from "../text/arabic";
import { RULING_TERMS } from "../text/rulingTerms";
import { findRegisteredClaim } from "./claimRegistry";
import type { EvidenceResult } from "./evidence";
import type { Environment, GenerationOutput } from "./generationSchema";

/**
 * Citation verification: deterministic checks on a generated answer before it
 * may be shown as GROUNDED. One failure fails the whole answer (v1 policy:
 * no silent dropping of a bad claim).
 *
 * Per claim: source exists, approved, verified (textual_source_match),
 * among the evidence gate's supporting/optional sources, not a fixture
 * outside a fixture-only environment, claim_ref present, registered in the
 * same record, supported with verbatim supporting_text, text unchanged,
 * scope within the record and answer scope, optional quote verbatim from
 * the same record.
 * Answer level: every supporting record cited, at least one claim, no
 * duplicate claim, and the model's free text (understanding, limitations,
 * next step) carries no ruling, preference, quotation or review claim.
 */

export type CitationCheck =
  | "unknown_source"
  | "not_approved"
  | "not_verified"
  | "source_not_supporting"
  | "fixture_not_citable"
  | "claim_without_reference"
  | "unknown_claim"
  | "claim_not_in_source"
  | "claim_text_altered"
  | "claim_exceeds_structural_scope"
  | "quote_not_in_record"
  | "quote_from_another_record"
  | "duplicate_claim"
  | "no_claims"
  | "missing_required_support"
  | "ruling_language_outside_claims"
  | "quote_outside_knowledge_base"
  | "claims_scholarly_review"
  | "states_preference";

export type CitationFailure = { check: CitationCheck; detail: string; claim_index?: number };
export type VerificationReport = { ok: true } | { ok: false; failures: CitationFailure[] };

export type VerificationContext = {
  evidence: EvidenceResult;
  /** Every record of the active production knowledge base (to tell invented from non-supporting). */
  knowledge: ReadonlyMap<string, KnowledgeRecordV2>;
  environment: Environment;
};

const RULING_IN_FREE_TEXT = RULING_TERMS.map((t) => arabicPhrase(t, "prefix"));
const QUOTE_MARKS = /["«»“”„]/;
const SCHOLARLY_REVIEW = [
  /(?<!\p{L})راجع(?:ها|ه|هما)\s+(?:عالم|مختص|شيخ|فقيه)/u,
  /(?<!\p{L})(?:مراجع|معتمد|مجاز)\S*\s+من\s+(?:عالم|مختص|شيخ|فقيه|هيئه|لجنه)/u,
  /(?<!\p{L})(?:اقر|اعتمد|اجاز)(?:ه|ها)\s+(?:عالم|مختص|شيخ|فقيه|هيئه|لجنه)/u,
  /(?<!\p{L})مراجعه\s+(?:فقهيه|شرعيه|علميه)/u,
];
const PREFERENCE = [/(?<!\p{L})(?:ال)?(?:راجح|ارجح|اقوي)(?!\p{L})/u, /(?<!\p{L})نرجح/u, /(?<!\p{L})الصحيح\s+(?:هو|من)/u];

function freeTextFailures(field: string, text: string): CitationFailure[] {
  const n = normalizeArabic(text);
  const out: CitationFailure[] = [];
  if (matchesAny(n, RULING_IN_FREE_TEXT)) out.push({ check: "ruling_language_outside_claims", detail: field });
  if (QUOTE_MARKS.test(text)) out.push({ check: "quote_outside_knowledge_base", detail: field });
  if (SCHOLARLY_REVIEW.some((r) => r.test(n))) out.push({ check: "claims_scholarly_review", detail: field });
  if (PREFERENCE.some((r) => r.test(n))) out.push({ check: "states_preference", detail: field });
  return out;
}

export function verifyCitations(output: GenerationOutput, ctx: VerificationContext): VerificationReport {
  const failures: CitationFailure[] = [];
  const fail = (check: CitationCheck, detail: string, claim_index?: number) =>
    failures.push({ check, detail, ...(claim_index !== undefined ? { claim_index } : {}) });

  const allowed = new Set([...ctx.evidence.supportingIds, ...ctx.evidence.optionalSupportingIds]);
  const structuralAnswer = ctx.evidence.groundingScope === "structural_general_information";
  const seen = new Set<string>();

  if (output.claims.length === 0) fail("no_claims", "a grounded answer needs at least one registered claim");

  output.claims.forEach((claim, i) => {
    const id = claim.source_id;
    // Fixture policy: synthetic records are never a final citation outside a fixture-only benchmark.
    if (id.startsWith("FIXTURE-") && ctx.environment !== "fixture_only") {
      fail("fixture_not_citable", `${id} in ${ctx.environment}`, i);
      return;
    }
    const record = ctx.knowledge.get(id);
    if (!record) return fail("unknown_source", id, i);
    if (!record.approved) fail("not_approved", id, i);
    if (!record.verified_excerpt.verified || record.verification_scope !== "textual_source_match") fail("not_verified", id, i);
    if (!allowed.has(id)) fail("source_not_supporting", id, i);

    if (!claim.claim_ref) return fail("claim_without_reference", claim.text.slice(0, 40), i);
    if (seen.has(claim.claim_ref)) fail("duplicate_claim", claim.claim_ref, i);
    seen.add(claim.claim_ref);

    const owner = claim.claim_ref.slice(0, 6);
    if (owner !== id) fail("claim_not_in_source", `${claim.claim_ref} cited under ${id}`, i);
    const registered = findRegisteredClaim(record, claim.claim_ref);
    if (!registered) return fail(owner !== id ? "claim_not_in_source" : "unknown_claim", claim.claim_ref, i);

    // supporting_text is re-checked verbatim against source_text (registeredClaims only keeps located ones).
    if (normalizeForMatch(claim.text) !== normalizeForMatch(registered.text)) fail("claim_text_altered", claim.claim_ref, i);

    const recordStructural = record.editorial_constraints.grounding_scope === "structural_only";
    if (registered.claim_scope !== "structural" && (structuralAnswer || recordStructural)) {
      fail("claim_exceeds_structural_scope", claim.claim_ref, i);
    }

    if (claim.quote) {
      const q = normalizeForMatch(claim.quote);
      const ownQuotes = [record.verified_excerpt.text, registered.supporting_text].map(normalizeForMatch);
      if (!ownQuotes.includes(q)) {
        const elsewhere = [...ctx.knowledge.values()].some(
          (r) => r.source_id !== id && [r.verified_excerpt.text, ...r.claims_check.map((c) => c.supporting_text ?? "")].map(normalizeForMatch).includes(q),
        );
        fail(elsewhere ? "quote_from_another_record" : "quote_not_in_record", claim.claim_ref, i);
      }
    }
  });

  for (const required of ctx.evidence.supportingIds) {
    if (!output.claims.some((c) => c.source_id === required && c.claim_ref)) fail("missing_required_support", required);
  }

  failures.push(...freeTextFailures("understanding", output.understanding));
  failures.push(...freeTextFailures("next_step", output.next_step));
  output.limitations.forEach((l, i) => failures.push(...freeTextFailures(`limitations[${i}]`, l)));

  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}
