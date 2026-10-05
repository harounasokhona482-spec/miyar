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
 * the record is approved and citation-eligible, has reviewed predicates, none
 * of its exclusions holds, and its required facts are established (explicit
 * facts only). Two support modes:
 * - direct: every required fact is established for this transaction;
 * - conditional: only "conditional" requirements are unknown; the record may
 *   give general information if the answer states those conditions as
 *   unverified, and never applies the ruling to the user's case.
 *
 * The result is internal and maps later onto the approved response states.
 */

export type EvidenceStatus = "sufficient" | "needs_clarification" | "insufficient" | "disputed";
export type GroundingScope = "general" | "structural_general_information";
export type SupportMode = "direct" | "conditional";

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

type Unknown = { check: string; clarifiableBy?: string };

export type CandidateAssessment = {
  source_id: string;
  rank: number;
  outcome: "applicable" | "conditional" | "excluded" | "undetermined";
  reasons: string[];
  coreUnknowns: Unknown[];
  conditionalUnknowns: Unknown[];
};

export type IssueAssessment = {
  id: string;
  need: "required" | "optional";
  status: "covered" | "pending" | "uncovered";
  mode: SupportMode | null;
  supporting: string | null;
  pendingFacts: string[];
};

export type UnverifiedCondition = { source_id: string; condition: string; clarifiableBy?: string };

export type EvidenceResult = {
  status: EvidenceStatus;
  /** One record per required issue (both positions when disputed). */
  supportingIds: string[];
  /** Applicable records the answer may use but does not depend on (e.g. a definition). */
  optionalSupportingIds: string[];
  excludedCandidates: { source_id: string; reasons: string[] }[];
  supportMode: SupportMode | null;
  unverifiedConditions: UnverifiedCondition[];
  /** True when an answer can be given now; clarification is then not forced. */
  answerableWithoutClarification: boolean;
  /** Facts to ask the user — only when the answer cannot be given without them. */
  askFacts: string[];
  /** Every fact known to be missing, including those an answer can carry as conditions. */
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
  const empty = { coreUnknowns: [], conditionalUnknowns: [] };
  const gate: string[] = [];
  if (!info) gate.push("record_not_found");
  else {
    if (!info.approved) gate.push("not_approved");
    if (!info.citation_eligible) gate.push("not_citation_eligible");
  }
  if (!predicates) {
    gate.push("no_reviewed_predicates");
    return { source_id: candidate.source_id, rank: candidate.rank, outcome: "excluded", reasons: gate, ...empty };
  }

  // Predicates are evaluated even when the gate fails, so every reason is reported.
  const reasons: string[] = [...gate];
  for (const ex of predicates.exclusions) if (ex.evaluate(facts) === "holds") reasons.push(`exclusion: ${ex.basis}`);
  const coreUnknowns: Unknown[] = [];
  const conditionalUnknowns: Unknown[] = [];
  for (const req of predicates.required) {
    const v: Tri = req.evaluate(facts);
    if (v === "fails") reasons.push(`required_fails: ${req.basis}`);
    if (v === "unknown") {
      const u = { check: req.basis, ...(req.clarifiableBy ? { clarifiableBy: req.clarifiableBy } : {}) };
      (req.mode === "conditional" ? conditionalUnknowns : coreUnknowns).push(u);
    }
  }
  const base = { source_id: candidate.source_id, rank: candidate.rank, coreUnknowns, conditionalUnknowns };
  if (reasons.length > 0) return { ...base, outcome: "excluded", reasons };
  if (coreUnknowns.length > 0) return { ...base, outcome: "undetermined", reasons: coreUnknowns.map((u) => `required_unknown: ${u.check}`) };
  if (conditionalUnknowns.length > 0) return { ...base, outcome: "conditional", reasons: [] };
  return { ...base, outcome: "applicable", reasons: [] };
}

function factOrder(id: string): number {
  const i = (FACT_IDS as readonly string[]).indexOf(id);
  return i === -1 ? FACT_IDS.length : i;
}

const conditionText = (basis: string) => basis.replace(/^[A-Z]+-[A-Z0-9-]+ applicability: /, "");

export function evaluateEvidence(
  input: EvidenceInput,
  table: PredicateTable = PRODUCTION_PREDICATES,
  config = DEFAULT_EVIDENCE_CONFIG,
): EvidenceResult {
  const facts = new TransactionFacts(input.transaction);
  const unknownByUser = new Set(input.clarification?.unknownByUser ?? []);
  const canAsk = (fact: string) => !input.clarification?.maxRoundsReached && !unknownByUser.has(fact);
  const askableMissing = input.missingFacts.map((m) => m.id as string).filter(canAsk);

  // 1. Assess the evidence pool: best K positive-score candidates.
  const pool = input.candidates.filter((c) => c.score > 0).slice(0, config.evidenceCandidateK);
  const predicatesById = new Map(table.records.map((r) => [r.source_id, r]));
  const assessments = pool.map((c) => assess(c, input.records.get(c.source_id), predicatesById.get(c.source_id), facts));
  const byId = new Map(assessments.map((a) => [a.source_id, a]));

  // 2. Issues the user's stated facts raise, and whether the answer needs a claim on each.
  const raised = table.issues.filter((i) => i.raisedWhen(facts));
  const raisedIds = new Set(raised.map((i) => i.id));

  const issueResults: IssueAssessment[] = raised.map((issue: IssueDefinition) => {
    const need = issue.need?.(raisedIds) ?? "required";
    const covering = issue.covering.map((id) => byId.get(id)).filter((a): a is CandidateAssessment => Boolean(a));
    const direct = covering.filter((a) => a.outcome === "applicable");
    const conditional = covering.filter((a) => a.outcome === "conditional");
    const blocking = covering.flatMap((a) => (a.outcome === "undetermined" ? a.coreUnknowns.filter((u) => u.clarifiableBy) : []));

    const coreDriven = new Set(blocking.map((u) => u.clarifiableBy!).filter(canAsk));
    const midDriven = new Set(issue.pendingWhenMissing.filter((f) => askableMissing.includes(f)));
    const allExcluded = covering.length > 0 && covering.every((a) => a.outcome === "excluded");
    if (allExcluded && issue.rerouteTo && facts.relationship() === null && canAsk(issue.rerouteTo)) midDriven.add(issue.rerouteTo);
    // A clarifiable unknown the user can no longer answer leaves the issue unsettled.
    const blockedForGood = blocking.some((u) => !canAsk(u.clarifiableBy!));

    const result = (status: IssueAssessment["status"], mode: SupportMode | null, supporting: string | null, pending: Set<string>): IssueAssessment => ({
      id: issue.id,
      need,
      status,
      mode,
      supporting,
      pendingFacts: [...pending],
    });
    // A more specific record that may apply and can be clarified must be settled first.
    if (coreDriven.size > 0) return result("pending", null, null, new Set([...coreDriven, ...midDriven]));
    if (!blockedForGood && direct.length > 0) return result("covered", "direct", direct[0]!.source_id, new Set());
    // Answerable without clarification: give conditional general information instead of asking.
    if (!blockedForGood && conditional.length > 0) return result("covered", "conditional", conditional[0]!.source_id, new Set());
    if (midDriven.size > 0) return result("pending", null, null, midDriven);
    return result("uncovered", null, null, new Set());
  });

  const required = issueResults.filter((i) => i.need === "required");
  const covered = issueResults.filter((i) => i.status === "covered");
  const supporting = [...new Set(required.filter((i) => i.status === "covered").map((i) => i.supporting!))];
  const usable = new Set(assessments.filter((a) => a.outcome === "applicable" || a.outcome === "conditional").map((a) => a.source_id));
  const optional = assessments
    .filter((a) => usable.has(a.source_id) && !supporting.includes(a.source_id))
    .filter((a) => covered.some((i) => i.id === predicatesById.get(a.source_id)!.issue))
    .map((a) => a.source_id);

  const unverifiedConditions: UnverifiedCondition[] = required
    .filter((i) => i.status === "covered" && i.mode === "conditional")
    .flatMap((i) =>
      byId.get(i.supporting!)!.conditionalUnknowns.map((u) => ({
        source_id: i.supporting!,
        condition: conditionText(u.check),
        ...(u.clarifiableBy ? { clarifiableBy: u.clarifiableBy } : {}),
      })),
    );

  // Official missing facts tied to an issue the answer already covers do not force clarification.
  const excused = new Set(
    covered.flatMap((i) => [
      ...(table.issues.find((d) => d.id === i.id)?.pendingWhenMissing ?? []),
      ...(i.supporting ? byId.get(i.supporting)!.conditionalUnknowns.flatMap((u) => (u.clarifiableBy ? [u.clarifiableBy] : [])) : []),
    ]),
  );

  const excludedCandidates = (used: Set<string>) =>
    assessments
      .filter((a) => !used.has(a.source_id))
      .map((a) => {
        const issue = predicatesById.get(a.source_id)?.issue;
        const notRaised = issue && !raisedIds.has(issue) ? [`issue_not_raised: ${issue}`] : [];
        const reasons = [...a.reasons, ...notRaised];
        if (reasons.length === 0) reasons.push(a.outcome === "conditional" ? "conditional_but_not_used" : "applicable_but_not_used: decision not sufficient");
        return { source_id: a.source_id, reasons };
      });

  const result = (
    status: EvidenceStatus,
    extra: Partial<Pick<EvidenceResult, "supportingIds" | "optionalSupportingIds" | "askFacts" | "groundingScope" | "disputedPositions" | "supportMode" | "unverifiedConditions">>,
    reasons: string[],
  ): EvidenceResult => {
    const supportingIds = extra.supportingIds ?? [];
    const optionalSupportingIds = extra.optionalSupportingIds ?? [];
    const askFacts = [...new Set(extra.askFacts ?? [])].sort((a, b) => factOrder(a) - factOrder(b));
    const conditions = extra.unverifiedConditions ?? [];
    const missingFacts = [...new Set([...askFacts, ...conditions.flatMap((c) => (c.clarifiableBy ? [c.clarifiableBy] : []))])].sort(
      (a, b) => factOrder(a) - factOrder(b),
    );
    return {
      status,
      supportingIds,
      optionalSupportingIds,
      excludedCandidates: excludedCandidates(new Set([...supportingIds, ...optionalSupportingIds])),
      supportMode: extra.supportMode ?? null,
      unverifiedConditions: conditions,
      answerableWithoutClarification: status === "sufficient" || status === "disputed",
      askFacts,
      missingFacts,
      groundingScope: extra.groundingScope ?? null,
      reasons,
      issues: issueResults,
      disputedPositions: extra.disputedPositions ?? [],
    };
  };

  // 3. Decide.
  const uncovered = required.filter((i) => i.status === "uncovered");
  if (uncovered.length > 0) {
    // Asking more cannot settle an issue no approved record covers: clarification should stop.
    return result("insufficient", {}, uncovered.map((i) => `issue_uncovered: ${i.id}`));
  }

  const ask = new Set(required.flatMap((i) => i.pendingFacts));
  if (required.length === 0) for (const f of IDENTIFICATION_FACTS) if (askableMissing.includes(f)) ask.add(f);
  if (table.enforceMissingInformation) for (const f of askableMissing) if (!excused.has(f)) ask.add(f);
  if (ask.size > 0) return result("needs_clarification", { askFacts: [...ask] }, [...ask].map((f) => `fact_missing: ${f}`));

  if (required.length === 0) return result("insufficient", {}, ["no_issue_identified"]);

  // DISPUTED only from positions: same issue_id, different position_id, both sources applicable.
  const positions = (input.positions ?? []).filter((p) => byId.get(p.source_id)?.outcome === "applicable");
  for (const issueId of new Set(positions.map((p) => p.issue_id))) {
    const onIssue = positions.filter((p) => p.issue_id === issueId);
    if (new Set(onIssue.map((p) => p.position_id)).size >= 2) {
      return result(
        "disputed",
        {
          supportingIds: [...new Set(onIssue.map((p) => p.source_id))],
          disputedPositions: onIssue.map((p) => ({ position_id: p.position_id, issue_id: p.issue_id, source_id: p.source_id })),
          groundingScope: "general",
          supportMode: "direct",
        },
        [`positions_differ: ${issueId}`],
      );
    }
  }

  const structural = supporting.some((id) => predicatesById.get(id)!.groundingScope === "structural_general_information");
  const conditionalMode = required.some((i) => i.mode === "conditional");
  return result(
    "sufficient",
    {
      supportingIds: supporting,
      optionalSupportingIds: optional,
      groundingScope: structural ? "structural_general_information" : "general",
      supportMode: conditionalMode ? "conditional" : "direct",
      unverifiedConditions,
    },
    covered.map((i) => `issue_covered: ${i.id} by ${i.supporting} (${i.mode}, ${i.need})`),
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
