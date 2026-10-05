import type { KnowledgeRecordV2 } from "../domain/schemas/knowledgeRecord";
import { arabicPhrase, matchesAny, normalizeArabic } from "../text/arabic";
import { RULING_TERMS } from "../text/rulingTerms";
import { findRegisteredClaim } from "./claimRegistry";
import type { EvidenceResult } from "./evidence";
import { sourceOfClaimRef, type Environment, type GenerationOutput } from "./generationSchema";

/**
 * Citation verification: deterministic checks on a generated answer before it
 * may be shown as GROUNDED. One failure fails the whole answer (v1 policy:
 * no silent dropping of a bad claim).
 *
 * The model only selects claim references; claim text, quotes and source
 * metadata come from the registry. Per selected reference: well-formed,
 * not a fixture outside a fixture-only environment, source exists, approved,
 * verified (textual_source_match), among the evidence gate's supporting /
 * optional sources, registered and supported with verbatim supporting_text,
 * scope within the record and answer scope.
 * Answer level: at least one claim, no duplicate, every supporting record
 * cited, and the model's free text (understanding, next step) carries no
 * ruling, preference, quotation or review claim.
 */

export type CitationCheck =
  | "malformed_claim_ref"
  | "unknown_source"
  | "not_approved"
  | "not_verified"
  | "source_not_supporting"
  | "fixture_not_citable"
  | "unknown_claim"
  | "claim_exceeds_structural_scope"
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

export function freeTextFailures(field: string, text: string): CitationFailure[] {
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
  const citedSources = new Set<string>();

  if (output.selected_claim_refs.length === 0) fail("no_claims", "a grounded answer needs at least one registered claim");

  output.selected_claim_refs.forEach((ref, i) => {
    const id = sourceOfClaimRef(ref);
    if (!id) return fail("malformed_claim_ref", ref, i);
    if (seen.has(ref)) fail("duplicate_claim", ref, i);
    seen.add(ref);

    // Fixture policy: synthetic records are never a final citation outside a fixture-only benchmark.
    if (id.startsWith("FIXTURE-") && ctx.environment !== "fixture_only") return fail("fixture_not_citable", `${id} in ${ctx.environment}`, i);

    const record = ctx.knowledge.get(id);
    if (!record) return fail("unknown_source", id, i);
    if (!record.approved) fail("not_approved", id, i);
    if (!record.verified_excerpt.verified || record.verification_scope !== "textual_source_match") fail("not_verified", id, i);
    if (!allowed.has(id)) fail("source_not_supporting", id, i);

    // Registered = supported in claims_check with supporting_text found verbatim in source_text.
    const registered = findRegisteredClaim(record, ref);
    if (!registered) return fail("unknown_claim", ref, i);
    citedSources.add(id);

    const recordStructural = record.editorial_constraints.grounding_scope === "structural_only";
    if (registered.claim_scope !== "structural" && (structuralAnswer || recordStructural)) fail("claim_exceeds_structural_scope", ref, i);
  });

  for (const required of ctx.evidence.supportingIds) {
    if (!citedSources.has(required)) fail("missing_required_support", required);
  }

  failures.push(...freeTextFailures("understanding", output.understanding));
  failures.push(...freeTextFailures("next_step", output.next_step));

  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}
