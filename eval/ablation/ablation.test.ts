/**
 * Ablation evaluation (evaluation only; never part of the product):
 *
 *   A. BM25_ONLY_BASELINE: same inputs, same knowledge base, same BM25
 *      implementation, query and candidate pool; then the top candidate with
 *      score > 0 is the source a retrieval-only system would answer from.
 *      No evidence predicates, no sufficiency, no citation verification, no LLM.
 *   B. FULL_MIYAR: the production evidence gate, then grounded generation
 *      (canned well-behaved model output from the benchmark harness) and
 *      citation verification, as in the existing benchmark.
 *
 * Rows are exactly those of the existing Evidence Decision Accuracy benchmark
 * (25 rows); pre-gate cases are reported apart. Nothing in src/ is modified.
 * Run with: npx vitest run --config eval/ablation/vitest.config.mts  (writes eval/ablation/results.{json,md})
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeProvider } from "../../src/ai/fakeProvider";
import type { EvalCase } from "../../src/domain/schemas/evalCase";
import type { KnowledgeRecordV2 } from "../../src/domain/schemas/knowledgeRecord";
import type { Transaction } from "../../src/domain/schemas/transaction";
import { registeredClaims } from "../../src/pipeline/claimRegistry";
import { verifyCitations, type CitationCheck } from "../../src/pipeline/citationVerify";
import type { EvidenceResult } from "../../src/pipeline/evidence";
import { generateAnswer } from "../../src/pipeline/generation";
import type { GenerationOutput } from "../../src/pipeline/generationSchema";
import { buildRetrievalIndex, retrieveEvidencePool, type RetrievalCandidate } from "../../src/pipeline/retrieval";
import { runSafetyPreGate } from "../../src/pipeline/safetyPreGate";
import { caseOf, canned, conversation, environmentFor, evaluate, productionKnowledge } from "../../src/pipeline/testdata/benchmarkHarness";
import { GENERATION_BY_SUPPORTING_SOURCE } from "../../src/pipeline/testdata/generationResponses";

const OUT_DIR = __dirname;
const FIRST_TURN_IDS = ["T001", "T002", "T003", "T004", "T005", "T006", "T007", "T008", "T009", "T013", "T014", "T015", "T016", "T017", "T019"];
const MULTI_TURN: [string, string][] = [["T020", "T020"], ["T021", "T009"], ["T022", "T007"], ["T023", "T007"]];
const PRE_GATE_IDS = ["T010", "T011", "T012", "T018"];
const NOT_COMPARABLE = { T024: "injected provider timeout (technical failure, not a retrieval question)", T025: "injected citation-verifier crash (technical failure)" };
const STATUS_TO_STATE = { sufficient: "GROUNDED", needs_clarification: "NEEDS_CLARIFICATION", insufficient: "INSUFFICIENT_EVIDENCE", disputed: "DISPUTED" } as const;

type TopRisk = "forbidden_cited_source" | "fixture_not_citable" | "contextually_inapplicable" | "retrieved_not_supporting";

type Row = {
  label: string;
  caseId: string;
  category: string;
  accepted: string[];
  allowsGrounded: boolean;
  allowedCited: string[];
  required: string[];
  forbidden: string[];
  candidates: { source_id: string; score: number; citation_eligible: boolean }[];
  /** validSupport: among the benchmark's citable sources; requiredSource: one the benchmark requires. */
  baseline: { action: "would_answer" | "would_abstain"; source: string | null; validSupport: boolean | null; requiredSource: boolean | null; risks: TopRisk[] };
  full: {
    evidenceStatus: string;
    state: string;
    supporting: string[];
    optional: string[];
    cited: string[];
    askFacts: string[];
    reasons: string[];
    topExclusion: string[];
    groundingScope: string | null;
    supportMode: string | null;
  };
  /** A generator that followed BM25 rank and cited the top candidate, checked by the real verifier. */
  retrievalFollowing: { withEvidenceGate: CitationCheck[]; recordLevelOnly: CitationCheck[] } | null;
  improvement: string;
};

const neutralText = { understanding: "وصف المستخدم لمعاملة مالية.", next_step: "يمكن عرض التفاصيل على مختص." };

/** What a retrieval-only generator would cite: every registered claim of the top source. */
function retrievalFollowingOutput(sourceId: string, knowledge: Map<string, KnowledgeRecordV2>): GenerationOutput {
  const record = knowledge.get(sourceId);
  const refs = record ? registeredClaims(record).map((c) => c.claim_id) : [`${sourceId}-C01`];
  return { selected_claim_refs: refs.length ? refs : [`${sourceId}-C01`], ...neutralText };
}

function checks(report: ReturnType<typeof verifyCitations>): CitationCheck[] {
  return report.ok ? [] : [...new Set(report.failures.map((f) => f.check))];
}

function classifyTop(c: EvalCase, top: RetrievalCandidate, e: EvidenceResult): TopRisk[] {
  const risks: TopRisk[] = [];
  if ((c.forbidden_cited_source_ids ?? []).includes(top.source_id)) risks.push("forbidden_cited_source");
  if (!top.citation_eligible) risks.push("fixture_not_citable");
  const excluded = e.excludedCandidates.find((x) => x.source_id === top.source_id)?.reasons ?? [];
  if (excluded.some((r) => r.startsWith("required_fails") || r.startsWith("exclusion"))) risks.push("contextually_inapplicable");
  if (![...e.supportingIds, ...e.optionalSupportingIds].includes(top.source_id) || e.status !== "sufficient") risks.push("retrieved_not_supporting");
  return risks;
}

/** Which gate made the difference, derived from the evidence result and the case's own category (no judgement added). */
function improvementOf(row: Omit<Row, "improvement">, c: EvalCase): string {
  const b = row.baseline;
  const f = row.full;
  const risky = row.candidates.slice(0, 3).filter((x) => !x.citation_eligible || row.forbidden.includes(x.source_id));
  const isolation = risky.length && f.state === "GROUNDED" ? ` + ${risky.map((x) => x.source_id).join(", ")} in BM25 top-3 never citable` : "";
  if (b.action === "would_abstain") return f.state === "GROUNDED" ? "Full answers where baseline abstains" : "none (both abstain: no candidate)";
  if (f.state === "DISPUTED") return "dispute positions (no single-source answer)";
  if (f.state === "NEEDS_CLARIFICATION") return `missing material fact (${f.askFacts.join(", ") || "clarification"})${b.risks.includes("fixture_not_citable") ? " + citation eligibility" : ""}`;
  if (f.state === "INSUFFICIENT_EVIDENCE") {
    if (c.category === "multi_turn_dont_know") return "«لا أعرف» on a material fact → abstain";
    if (c.category === "multi_turn_max_rounds") return "clarification limit reached with the fact still unknown → abstain";
    if (row.full.topExclusion.some((r) => r.startsWith("exclusion") || r.startsWith("required_fails"))) return "context mismatch / applicability predicate (top excluded) + citation eligibility → abstain";
    return f.reasons.some((r) => r.startsWith("issue_uncovered")) ? "no approved record covers the issue → abstain" : "evidence sufficiency → abstain";
  }
  // Both answer.
  const sameSource = f.supporting.includes(b.source ?? "");
  const scope = f.groundingScope === "structural_general_information" ? " + structural scope" : f.supportMode === "conditional" ? " + conditional (unverified conditions stated)" : "";
  if (sameSource) return `none on source${scope}${isolation}`;
  return `applicability predicate (BM25 top ${b.source} does not cover the stated terms; ${f.supporting.join(", ")} chosen)${scope}${isolation}`;
}

async function fullFinal(c: EvalCase, e: EvidenceResult, transaction: Transaction) {
  const env = environmentFor(c);
  if (e.status !== "sufficient" && e.status !== "disputed") return { state: STATUS_TO_STATE[e.status], cited: [] as string[] };
  const output = e.status === "sufficient" ? GENERATION_BY_SUPPORTING_SOURCE[e.supportingIds[0]!] : undefined;
  const provider = new FakeProvider(() => {
    if (!output) throw new Error("no canned generation for this support");
    return JSON.stringify(output);
  });
  const { result } = await generateAnswer({ evidence: e, transaction, knowledge: productionKnowledge(), environment: env.kind, positions: env.positions }, provider);
  const cited = result.state === "GROUNDED" ? [...new Set(result.citations.map((x) => x.source_id))] : [];
  return { state: result.state, cited };
}

async function buildRow(label: string, c: EvalCase, turn: number, transaction: Transaction, userTexts: string[], e: EvidenceResult): Promise<Row> {
  const env = environmentFor(c);
  // Same retrieval call as the harness's evaluate(): same index, query and candidate pool.
  const pool = retrieveEvidencePool(buildRetrievalIndex(env.retrievable), { userTexts, transaction });
  const top = pool.candidates[0];
  const accepted = c.turns[turn]!.accepted_states;
  const allowsGrounded = accepted.includes("GROUNDED");
  const allowedCited = [...new Set([...(c.expected_cited_source_ids ?? []), ...(c.required_cited_source_ids ?? [])])];
  const forbidden = c.forbidden_cited_source_ids ?? [];
  const final = await fullFinal(c, e, transaction);
  const knowledge = productionKnowledge();

  // Not measured in fixture_only rows: fixture records are not in the citation knowledge map, so the
  // verifier would report unknown_source for reasons unrelated to the comparison.
  let retrievalFollowing: Row["retrievalFollowing"] = null;
  if (top && env.kind !== "fixture_only") {
    const output = retrievalFollowingOutput(top.source_id, knowledge);
    const withGate = verifyCitations(output, { evidence: e, knowledge, environment: env.kind });
    // Citation verification without the evidence gate: the top candidate is treated as the support.
    const record = knowledge.get(top.source_id);
    const stub: EvidenceResult = {
      ...e,
      status: "sufficient",
      supportingIds: [top.source_id],
      optionalSupportingIds: [],
      groundingScope: record?.editorial_constraints.grounding_scope === "structural_only" ? "structural_general_information" : "general",
    };
    const recordOnly = verifyCitations(output, { evidence: stub, knowledge, environment: env.kind });
    retrievalFollowing = { withEvidenceGate: checks(withGate), recordLevelOnly: checks(recordOnly) };
  }

  const partial: Omit<Row, "improvement"> = {
    label,
    caseId: c.id,
    category: c.category,
    accepted,
    allowsGrounded,
    allowedCited,
    required: c.required_cited_source_ids ?? [],
    forbidden,
    candidates: pool.candidates.map((x) => ({ source_id: x.source_id, score: x.score, citation_eligible: x.citation_eligible })),
    baseline: {
      action: top ? "would_answer" : "would_abstain",
      source: top?.source_id ?? null,
      validSupport: top ? allowsGrounded && allowedCited.includes(top.source_id) && !forbidden.includes(top.source_id) : null,
      requiredSource: top ? allowsGrounded && (c.required_cited_source_ids ?? []).includes(top.source_id) : null,
      risks: top ? classifyTop(c, top, e) : [],
    },
    full: {
      evidenceStatus: e.status,
      state: final.state,
      supporting: e.supportingIds,
      optional: e.optionalSupportingIds,
      cited: final.cited,
      askFacts: e.askFacts,
      reasons: e.reasons,
      topExclusion: top ? (e.excludedCandidates.find((x) => x.source_id === top.source_id)?.reasons ?? []) : [],
      groundingScope: e.groundingScope,
      supportMode: e.supportMode,
    },
    retrievalFollowing,
  };
  return { ...partial, improvement: improvementOf(partial, c) };
}

async function buildRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const id of FIRST_TURN_IDS) {
    const c = caseOf(id);
    const t = canned(id);
    const texts = [c.turns[0]!.user_message];
    rows.push(await buildRow(id, c, 0, t, texts, evaluate(c, t, texts)));
  }
  for (const [id, start] of MULTI_TURN) {
    const c = caseOf(id);
    const turns = await conversation(id, start);
    const texts = [c.turns[0]!.user_message];
    for (let i = 0; i < turns.length; i++) {
      if (i > 0 && c.turns[i]!.user_message !== "لا أعرف") texts.push(c.turns[i]!.user_message);
      rows.push(await buildRow(`${id}.${i + 1}`, c, i, turns[i]!.transaction, [...texts], turns[i]!.evidence));
    }
  }
  return rows;
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${n}/${d} (${Math.round((100 * n) / d)}%)`);

function metrics(rows: Row[]) {
  const n = rows.length;
  const grounded = rows.filter((r) => r.allowsGrounded);
  const notGrounded = rows.filter((r) => !r.allowsGrounded);
  const bAnswers = rows.filter((r) => r.baseline.action === "would_answer");
  const bUnsupported = bAnswers.filter((r) => !r.allowsGrounded || !r.baseline.validSupport);
  const fGrounded = rows.filter((r) => r.full.state === "GROUNDED");
  const fUnsupported = fGrounded.filter(
    (r) => !r.allowsGrounded || r.full.cited.some((s) => !r.allowedCited.includes(s) || r.forbidden.includes(s)) || !r.required.every((s) => r.full.cited.includes(s)),
  );
  const riskCount = (risk: TopRisk) => bAnswers.filter((r) => r.baseline.risks.includes(risk)).length;
  const fullCitedRisk = fGrounded.filter((r) => r.full.cited.some((s) => r.forbidden.includes(s) || s.startsWith("FIXTURE-") || !r.allowedCited.includes(s))).length;
  return {
    rows: n,
    finalDecisionAccuracy: {
      full_exact_state: pct(rows.filter((r) => r.accepted.includes(r.full.state)).length, n),
      full_answer_vs_not: pct(rows.filter((r) => (r.full.state === "GROUNDED") === r.allowsGrounded).length, n),
      baseline_answer_vs_not: pct(rows.filter((r) => (r.baseline.action === "would_answer") === r.allowsGrounded).length, n),
      baseline_answer_vs_not_and_valid_source: pct(
        rows.filter((r) => (r.baseline.action === "would_answer") === r.allowsGrounded && (!r.allowsGrounded || r.baseline.validSupport)).length,
        n,
      ),
      baseline_answer_vs_not_and_required_source: pct(
        rows.filter((r) => (r.baseline.action === "would_answer") === r.allowsGrounded && (!r.allowsGrounded || r.baseline.requiredSource)).length,
        n,
      ),
    },
    unsupportedAnswerRate: {
      baseline_of_all_rows: pct(bUnsupported.length, n),
      baseline_of_its_answers: pct(bUnsupported.length, bAnswers.length),
      full_of_all_rows: pct(fUnsupported.length, n),
      full_of_its_answers: pct(fUnsupported.length, fGrounded.length),
    },
    correctAbstentionOrDeferral: {
      rows_not_allowing_grounded: notGrounded.length,
      full_exact_state: pct(notGrounded.filter((r) => r.accepted.includes(r.full.state)).length, notGrounded.length),
      full_did_not_answer: pct(notGrounded.filter((r) => r.full.state !== "GROUNDED").length, notGrounded.length),
      baseline_did_not_answer: pct(notGrounded.filter((r) => r.baseline.action === "would_abstain").length, notGrounded.length),
    },
    supportingSourceAccuracy: {
      rows_allowing_grounded: grounded.length,
      baseline_top_is_valid_support: pct(grounded.filter((r) => r.baseline.validSupport).length, grounded.length),
      baseline_top_is_required_source: pct(grounded.filter((r) => r.baseline.source !== null && r.required.includes(r.baseline.source)).length, grounded.length),
      full_supporting_within_allowed_and_required_cited: pct(
        grounded.filter((r) => r.full.state === "GROUNDED" && r.full.supporting.every((s) => r.allowedCited.includes(s)) && r.required.every((s) => r.full.cited.includes(s))).length,
        grounded.length,
      ),
    },
    citationRisk: {
      baseline_answers: bAnswers.length,
      top_forbidden_cited_source: riskCount("forbidden_cited_source"),
      top_fixture_not_citable: riskCount("fixture_not_citable"),
      top_contextually_inapplicable: riskCount("contextually_inapplicable"),
      top_retrieved_not_supporting: riskCount("retrieved_not_supporting"),
      top_any_risk: bAnswers.filter((r) => r.baseline.risks.length > 0).length,
      full_cited_any_risk: fullCitedRisk,
      // Display topK = 3: a forbidden or non-citable source a retrieval-only system would list as a source.
      rows_with_risky_source_in_bm25_top3: rows.filter((r) => r.candidates.slice(0, 3).some((x) => !x.citation_eligible || r.forbidden.includes(x.source_id))).length,
      full_rows_citing_such_source: fGrounded.filter((r) => r.full.cited.some((s) => s.startsWith("FIXTURE-") || r.forbidden.includes(s))).length,
    },
    retrievalFollowingGenerator: (() => {
      const checked = bAnswers.filter((r) => r.retrievalFollowing !== null);
      return {
        outputs_checked: checked.length,
        not_measured_fixture_only_rows: bAnswers.length - checked.length,
        rejected_with_evidence_gate: checked.filter((r) => r.retrievalFollowing!.withEvidenceGate.length > 0).length,
        rejected_by_citation_verification_alone: checked.filter((r) => r.retrievalFollowing!.recordLevelOnly.length > 0).length,
        at_risk_but_passing_citation_verification_alone: checked.filter((r) => r.baseline.risks.length > 0 && r.retrievalFollowing!.recordLevelOnly.length === 0).length,
      };
    })(),
  };
}

/**
 * Supplementary (does not redefine the baseline): could ANY score threshold make a
 * retrieval-only system answer exactly when the benchmark allows it? The threshold is
 * tuned on these same rows, so this is an optimistic upper bound for the baseline.
 */
function thresholdSweep(rows: Row[]) {
  const scores = [...new Set(rows.map((r) => r.candidates[0]?.score ?? 0))].sort((a, b) => a - b);
  const results = scores.map((t) => {
    const answers = (r: Row) => (r.candidates[0]?.score ?? 0) >= t && t > 0;
    const decision = rows.filter((r) => answers(r) === r.allowsGrounded).length;
    const withSource = rows.filter((r) => answers(r) === r.allowsGrounded && (!answers(r) || r.baseline.requiredSource)).length;
    // A retrieval-only system can only answer (GROUNDED) or abstain (INSUFFICIENT_EVIDENCE): it never asks or shows a dispute.
    const exact = rows.filter((r) => (answers(r) ? r.accepted.includes("GROUNDED") && r.baseline.requiredSource : r.accepted.includes("INSUFFICIENT_EVIDENCE"))).length;
    const answeredGrounded = rows.filter((r) => r.allowsGrounded && answers(r) && r.baseline.requiredSource).length;
    return { threshold: t, decision, withSource, exact, answeredGrounded };
  });
  const best = results.reduce((a, b) => (b.withSource > a.withSource ? b : a));
  const groundedTops = rows.filter((r) => r.allowsGrounded).map((r) => r.candidates[0]?.score ?? 0);
  const otherTops = rows.filter((r) => !r.allowsGrounded).map((r) => r.candidates[0]?.score ?? 0);
  return {
    best_threshold: best.threshold,
    best_answer_vs_not: pct(best.decision, rows.length),
    best_answer_vs_not_and_required_source: pct(best.withSource, rows.length),
    best_answerable_rows_answered_with_required_source: pct(best.answeredGrounded, rows.filter((r) => r.allowsGrounded).length),
    best_exact_state: pct(best.exact, rows.length),
    full_exact_state: pct(rows.filter((r) => r.accepted.includes(r.full.state)).length, rows.length),
    top_score_range_rows_allowing_grounded: [Math.min(...groundedTops), Math.max(...groundedTops)],
    top_score_range_rows_not_allowing_grounded: [Math.min(...otherTops), Math.max(...otherTops)],
  };
}

function markdown(rows: Row[], m: ReturnType<typeof metrics>, preGate: { id: string; state: string }[]): string {
  const lines: string[] = [];
  lines.push("# Ablation: BM25_ONLY_BASELINE vs FULL_MIYAR", "", `Rows: ${rows.length} (same as the Evidence Decision Accuracy benchmark). Deterministic; no LLM, no judge.`, "");
  lines.push("| Row | Expected | BM25 top (score) | BM25-only | Baseline right? | Full Mi'yar | Full supporting | Improvement |", "|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const top = r.candidates[0];
    const right =
      r.baseline.action === "would_answer"
        ? !r.allowsGrounded
          ? "✗ answers unsupported"
          : r.baseline.requiredSource
            ? "✓ right"
            : r.baseline.validSupport
              ? "◐ allowed source, not the required one"
              : "✗ wrong source"
        : r.allowsGrounded
          ? "✗ abstains"
          : "✓ abstains";
    lines.push(
      `| ${r.label} | ${r.accepted.join("/")} | ${top ? `${top.source_id} (${top.score})${top.citation_eligible ? "" : " ⚠ not citable"}` : "—"} | ${r.baseline.action}${r.baseline.source ? ` → ${r.baseline.source}` : ""} | ${right} | ${r.full.state} | ${[...r.full.supporting, ...r.full.optional.map((o) => `(${o})`)].join(", ") || "—"} | ${r.improvement} |`,
    );
  }
  lines.push("", "## Adversarial / context-mismatch subset (T019, T020)", "");
  for (const r of rows.filter((x) => x.caseId === "T019" || x.caseId === "T020")) {
    const top3 = r.candidates
      .slice(0, 3)
      .map((x, i) => `${i + 1}. ${x.source_id} (${x.score})${x.citation_eligible ? "" : " not citable"}${r.forbidden.includes(x.source_id) ? " FORBIDDEN" : ""}`)
      .join("; ");
    lines.push(
      `- ${r.label} (${r.category}): BM25 top-3 = ${top3}. BM25-only → ${r.baseline.source}. Full → ${r.full.state}${r.full.cited.length ? ` citing ${r.full.cited.join(", ")}` : ""}. Verifier on a retrieval-following answer: ${r.retrievalFollowing?.recordLevelOnly.join(", ") || "passes"} (alone), ${r.retrievalFollowing?.withEvidenceGate.join(", ") || "passes"} (with the evidence gate).`,
    );
  }
  const perCase = rows.filter((r) => !r.label.includes(".") || r.label.endsWith(".1"));
  lines.push("", "## Metrics (all 25 rows)", "", "```json", JSON.stringify(m, null, 2), "```", "");
  lines.push("## Metrics (first turn only: one row per case, 19 cases)", "", "```json", JSON.stringify(metrics(perCase), null, 2), "```", "");
  lines.push("## Supplementary: best BM25 score threshold (tuned on the same rows: optimistic for the baseline)", "", "```json", JSON.stringify(thresholdSweep(rows), null, 2), "```", "");
  lines.push("## Pre-gate cases (identical in both arms, excluded from metrics)", "", ...preGate.map((p) => `- ${p.id}: ${p.state}`), "");
  lines.push("## Not comparable", "", ...Object.entries(NOT_COMPARABLE).map(([k, v]) => `- ${k}: ${v}`), "");
  return lines.join("\n");
}

describe("ablation: BM25_ONLY_BASELINE vs FULL_MIYAR", () => {
  it("evaluates every comparable benchmark row and writes the report", async () => {
    const rows = await buildRows();
    const m = metrics(rows);
    const preGate = PRE_GATE_IDS.map((id) => {
      const pre = runSafetyPreGate(caseOf(id).turns[0]!.user_message);
      return { id, state: pre.proceed ? "PASS (not pre-gated)" : pre.result.state };
    });
    const perCase = metrics(rows.filter((r) => !r.label.includes(".") || r.label.endsWith(".1")));
    writeFileSync(
      join(OUT_DIR, "results.json"),
      JSON.stringify({ metrics: m, metricsFirstTurnOnly: perCase, thresholdSweep: thresholdSweep(rows), rows, preGate, notComparable: NOT_COMPARABLE }, null, 2),
    );
    writeFileSync(join(OUT_DIR, "results.md"), markdown(rows, m, preGate));

    // Sanity: the full pipeline in this harness reproduces the benchmark (as the existing accuracy test does).
    expect(rows).toHaveLength(25);
    expect(rows.filter((r) => !r.accepted.includes(r.full.state)).map((r) => r.label)).toEqual([]);
    expect(m.citationRisk.full_cited_any_risk).toBe(0);
  });
});
