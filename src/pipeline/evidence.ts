import type { Position } from "../domain/schemas/knowledgeRecord";
import type { Transaction } from "../domain/schemas/transaction";
import { TransactionFacts, type Tri } from "./evidenceFacts";
import { IDENTIFICATION_FACTS, PRODUCTION_PREDICATES, type IssueDefinition, type PredicateTable, type RecordPredicates } from "./evidencePredicates";
import { FACT_IDS, type MissingFact } from "./missingInfo";
import { DEFAULT_RETRIEVAL_CONFIG, type RetrievalCandidate } from "./retrieval";

/**
 * Evidence sufficiency gate: deterministic, no LLM.
 *
 * Retrieval relevance is NOT evidence. A candidate supports an answer only if
 * the record is approved and citation-eligible, has reviewed predicates, all
 * its required facts are established (explicit facts only), and none of its
 * exclusions holds. Each issue the transaction raises must be settled by such
 * a record; the minimal set takes one record per issue.
 *
 * The result is internal ("sufficient" | "needs_clarification" |
 * "insufficient" | "disputed") and maps later onto the approved states.
 */

export type EvidenceStatus = "sufficient" | "needs_clarification" | "insufficient" | "disputed";
export type GroundingScope = "general" | "structural_general_information";

/** What the evidence gate needs to know about each knowledge record. */
export type EvidenceRecordInfo = {
  source_id: string;
  approved: boolean;
  /** approved && verified && verification_scope = textual_source_match (or the test environment's equivalent). */
  citation_eligible: boolean;
};

export type EvidenceInput = {
  transaction: Transaction;
  /** Official missing information (deterministic detection). */
  missingFacts: readonly MissingFact[];
  /** Retrieval candidates, best first; only the first evidenceCandidateK are evaluated. */
  candidates: readonly RetrievalCandidate[];
  records: ReadonlyMap<string, EvidenceRecordInfo>;
  /** Positions of the active environment (none in production today). */
  positions?: readonly Position[];
  /** Clarification can no longer ask: rounds exhausted, or the user said «لا أعرف». */
  clarification?: { maxRoundsReached?: boolean; unknownByUser?: readonly string[] };
};

export type CandidateAssessment = {
  source_id: string;
  rank: number;
  outcome: "applicable" | "excluded" | "undetermined";
  reasons: string[];
  /** Unknown required facts and the clarification fact that could settle each. */
  unknowns: { check: string; clarifiableBy?: string }[];
};

export type IssueAssessment = {
  id: string;
  status: "covered" | "pending" | "uncovered";
  supporting: string | null;
  pendingFacts: string[];
};

export type EvidenceResult = {
  status: EvidenceStatus;
  /** Minimal set: one record per raised issue (both positions when disputed). */
  supportingIds: string[];
  /** Applicable records not needed for the minimal set (e.g. a definition the generator may cite). */
  optionalSupportingIds: string[];
  excludedCandidates: { source_id: string; reasons: string[] }[];
  missingFacts: string[];
  groundingScope: GroundingScope | null;
  reasons: string[];
  issues: IssueAssessment[];
  disputedPositions: { position_id: string; issue_id: string; source_id: string }[];
};

export const DEFAULT_EVIDENCE_CONFIG = { evidenceCandidateK: DEFAULT_RETRIEVAL_CONFIG.evidenceCandidateK };

function assess(
  candidate: RetrievalCandidate,
  info: EvidenceRecordInfo | undefined,
  predicates: RecordPredicates | undefined,
  facts: TransactionFacts,
): CandidateAssessment {
  const base = { source_id: candidate.source_id, rank: candidate.rank, unknowns: [] as CandidateAssessment["unknowns"] };
  const gate: string[] = [];
  if (!info) gate.push("record_not_found");
  else {
    if (!info.approved) gate.push("not_approved");
    if (!info.citation_eligible) gate.push("not_citation_eligible");
  }
  if (!predicates) gate.push("no_reviewed_predicates");
  if (!predicates) return { ...base, outcome: "excluded", reasons: gate };

  // Predicates are evaluated even when the gate fails, so every reason is reported.
  const reasons: string[] = [...gate];
  for (const ex of predicates.exclusions) {
    if (ex.evaluate(facts) === "holds") reasons.push(`exclusion: ${ex.basis}`);
  }
  const unknowns: CandidateAssessment["unknowns"] = [];
  for (const req of predicates.required) {
    const v: Tri = req.evaluate(facts);
    if (v === "fails") reasons.push(`required_fails: ${req.basis}`);
    if (v === "unknown") unknowns.push({ check: req.basis, ...(req.clarifiableBy ? { clarifiableBy: req.clarifiableBy } : {}) });
  }
  if (reasons.length > 0) return { ...base, outcome: "excluded", reasons };
  if (unknowns.length > 0) {
    return { ...base, outcome: "undetermined", reasons: unknowns.map((u) => `required_unknown: ${u.check}`), unknowns };
  }
  return { ...base, outcome: "applicable", reasons: [] };
}

function factOrder(id: string): number {
  const i = (FACT_IDS as readonly string[]).indexOf(id);
  return i === -1 ? FACT_IDS.length : i;
}

export function evaluateEvidence(
  input: EvidenceInput,
  table: PredicateTable = PRODUCTION_PREDICATES,
  config = DEFAULT_EVIDENCE_CONFIG,
): EvidenceResult {
  const facts = new TransactionFacts(input.transaction);
  const unknownByUser = new Set(input.clarification?.unknownByUser ?? []);
  const canAsk = (fact: string) => !input.clarification?.maxRoundsReached && !unknownByUser.has(fact);
  const officialMissing = input.missingFacts.map((m) => m.id as string);
  const askableMissing = officialMissing.filter(canAsk);

  // 1. Assess the evidence pool: best K positive-score candidates.
  const pool = input.candidates.filter((c) => c.score > 0).slice(0, config.evidenceCandidateK);
  const predicatesById = new Map(table.records.map((r) => [r.source_id, r]));
  const assessments = pool.map((c) => assess(c, input.records.get(c.source_id), predicatesById.get(c.source_id), facts));
  const byId = new Map(assessments.map((a) => [a.source_id, a]));

  // 2. Issues raised by the transaction (subsumed ones folded into their parent).
  const raisedAll = table.issues.filter((i) => i.raisedWhen(facts));
  const raisedIds = new Set(raisedAll.map((i) => i.id));
  const raised = raisedAll.filter((i) => !(i.subsumedBy ?? []).some((p) => raisedIds.has(p)));
  const subsumed = raisedAll.filter((i) => !raised.includes(i));

  const issueResults: IssueAssessment[] = raised.map((issue: IssueDefinition) => {
    const covering = issue.covering.map((id) => byId.get(id)).filter((a): a is CandidateAssessment => Boolean(a));
    const applicable = covering.filter((a) => a.outcome === "applicable");
    const blocking = covering.flatMap((a) => (a.outcome === "undetermined" ? a.unknowns.filter((u) => u.clarifiableBy) : []));
    const pendingFacts = new Set<string>();
    for (const u of blocking) if (canAsk(u.clarifiableBy!)) pendingFacts.add(u.clarifiableBy!);
    for (const f of issue.pendingWhenMissing) if (askableMissing.includes(f)) pendingFacts.add(f);

    // An explicit negative fact excluded every covering record: try another reading before abstaining.
    const allExcluded = covering.length > 0 && covering.every((a) => a.outcome === "excluded");
    if (allExcluded && issue.rerouteTo && facts.relationship() === null && canAsk(issue.rerouteTo)) pendingFacts.add(issue.rerouteTo);

    // A clarifiable unknown the user can no longer answer leaves the issue unsettled.
    const blockedForGood = blocking.some((u) => !canAsk(u.clarifiableBy!));

    let status: IssueAssessment["status"];
    if (pendingFacts.size > 0) status = "pending";
    else if (applicable.length > 0 && !blockedForGood) status = "covered";
    else status = "uncovered";
    return { id: issue.id, status, supporting: status === "covered" ? applicable[0]!.source_id : null, pendingFacts: [...pendingFacts] };
  });

  const excludedCandidates = (supporting: Set<string>, optional: Set<string>) =>
    assessments
      .filter((a) => !supporting.has(a.source_id) && !optional.has(a.source_id))
      .map((a) => {
        const issue = predicatesById.get(a.source_id)?.issue;
        const notRaised = issue && !raisedAll.some((i) => i.id === issue) ? [`issue_not_raised: ${issue}`] : [];
        const unused = a.outcome === "applicable" && a.reasons.length === 0 && notRaised.length === 0 ? ["applicable_but_not_used: decision not sufficient"] : [];
        return { source_id: a.source_id, reasons: [...a.reasons, ...notRaised, ...unused] };
      });

  const result = (
    status: EvidenceStatus,
    extra: Partial<Pick<EvidenceResult, "supportingIds" | "optionalSupportingIds" | "missingFacts" | "groundingScope" | "disputedPositions">>,
    reasons: string[],
  ): EvidenceResult => {
    const supportingIds = extra.supportingIds ?? [];
    const optionalSupportingIds = extra.optionalSupportingIds ?? [];
    return {
      status,
      supportingIds,
      optionalSupportingIds,
      excludedCandidates: excludedCandidates(new Set(supportingIds), new Set(optionalSupportingIds)),
      missingFacts: [...new Set(extra.missingFacts ?? [])].sort((a, b) => factOrder(a) - factOrder(b)),
      groundingScope: extra.groundingScope ?? null,
      reasons,
      issues: issueResults,
      disputedPositions: extra.disputedPositions ?? [],
    };
  };

  // 3. Decide.
  const uncovered = issueResults.filter((i) => i.status === "uncovered");
  if (uncovered.length > 0) {
    // Asking more cannot settle an issue no approved record covers.
    return result("insufficient", {}, uncovered.map((i) => `issue_uncovered: ${i.id}`));
  }

  const pending = new Set(issueResults.flatMap((i) => i.pendingFacts));
  if (raised.length === 0) for (const f of IDENTIFICATION_FACTS) if (askableMissing.includes(f)) pending.add(f);
  if (table.enforceMissingInformation) for (const f of askableMissing) pending.add(f);
  if (pending.size > 0) {
    return result("needs_clarification", { missingFacts: [...pending] }, [...pending].map((f) => `fact_missing: ${f}`));
  }

  if (raised.length === 0) return result("insufficient", {}, ["no_issue_identified"]);

  const supporting = issueResults.map((i) => i.supporting!).filter((id, i, a) => a.indexOf(id) === i);
  const applicableIds = new Set(assessments.filter((a) => a.outcome === "applicable").map((a) => a.source_id));

  // DISPUTED only from positions: same issue_id, different position_id, both sources applicable.
  const positions = (input.positions ?? []).filter((p) => applicableIds.has(p.source_id));
  for (const issueId of new Set(positions.map((p) => p.issue_id))) {
    const onIssue = positions.filter((p) => p.issue_id === issueId);
    if (new Set(onIssue.map((p) => p.position_id)).size >= 2) {
      return result(
        "disputed",
        {
          supportingIds: [...new Set(onIssue.map((p) => p.source_id))],
          disputedPositions: onIssue.map((p) => ({ position_id: p.position_id, issue_id: p.issue_id, source_id: p.source_id })),
          groundingScope: "general",
        },
        [`positions_differ: ${issueId}`],
      );
    }
  }

  const relatedIssues = new Set([...raised, ...subsumed].map((i) => i.id));
  const optional = assessments
    .filter((a) => a.outcome === "applicable" && !supporting.includes(a.source_id))
    .filter((a) => relatedIssues.has(predicatesById.get(a.source_id)!.issue))
    .map((a) => a.source_id);
  const structural = supporting.some((id) => predicatesById.get(id)!.groundingScope === "structural_general_information");

  return result(
    "sufficient",
    { supportingIds: supporting, optionalSupportingIds: optional, groundingScope: structural ? "structural_general_information" : "general" },
    issueResults.map((i) => `issue_covered: ${i.id} by ${i.supporting}`),
  );
}

/** Production view of a loaded record for the evidence gate. */
export function evidenceRecordInfo(record: {
  source_id: string;
  approved: boolean;
  verified_excerpt: { verified: boolean };
  verification_scope: string;
}): EvidenceRecordInfo {
  return {
    source_id: record.source_id,
    approved: record.approved,
    citation_eligible: record.approved && record.verified_excerpt.verified && record.verification_scope === "textual_source_match",
  };
}
