import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import testSetV2 from "../../../test_set_v2.json";
import { FakeProvider } from "../../ai/fakeProvider";
import { TestSetFileSchema, type EvalCase } from "../../domain/schemas/evalCase";
import { FixtureKnowledgeBaseFileSchema, type KnowledgeRecordV2, type Position } from "../../domain/schemas/knowledgeRecord";
import type { Transaction } from "../../domain/schemas/transaction";
import { getRetrievalEligibleRecords, loadKnowledgeBase } from "../../kb/loader";
import { answerClarification, startClarification, type ClarificationStep } from "../clarification";
import { evaluateEvidence, evidenceRecordInfo, type EvidenceRecordInfo, type EvidenceResult, type EvidenceStatus } from "../evidence";
import { PRODUCTION_PREDICATES, extendPredicateTable, type PredicateTable } from "../evidencePredicates";
import { userMessageOf } from "../extraction";
import type { Environment } from "../generationSchema";
import { detectMissingInformation, withOfficialMissingInformation } from "../missingInfo";
import { buildRetrievalIndex, retrieveEvidencePool, toRetrievableRecord, type RetrievableRecord } from "../retrieval";
import { EXTRACTION_RESPONSES } from "./extractionResponses";
import { FIXTURE_ISSUES, FIXTURE_RECORD_PREDICATES } from "./fixturePredicates";

/**
 * Benchmark harness (tests only): builds the inputs for a benchmark case in
 * its environment. Fixtures are passed explicitly here; runtime code never
 * imports this module or loads fixtures.
 */

const ROOT = resolve(__dirname, "../../..");
export const suite = TestSetFileSchema.parse(testSetV2);
export const caseOf = (id: string): EvalCase => suite.tests.find((t) => t.id === id)!;

const kbResult = loadKnowledgeBase();
if (!kbResult.ok) throw new Error("production KB failed to load");
export const productionRecords: readonly KnowledgeRecordV2[] = getRetrievalEligibleRecords(kbResult.kb);
export const productionKnowledge = (): Map<string, KnowledgeRecordV2> =>
  new Map(productionRecords.map((r) => [r.source_id, structuredClone(r)] as const));

export type HarnessEnvironment = {
  kind: Environment;
  retrievable: RetrievableRecord[];
  info: Map<string, EvidenceRecordInfo>;
  table: PredicateTable;
  positions: Position[];
};

function fixtureFile(name: string) {
  return FixtureKnowledgeBaseFileSchema.parse(JSON.parse(readFileSync(join(ROOT, "eval", "fixtures", name), "utf8")));
}

export function environmentFor(c: EvalCase): HarnessEnvironment {
  const kind: Environment = c.kb_mode;
  const retrievable = kind === "fixture_only" ? [] : productionRecords.map(toRetrievableRecord);
  const info = new Map(kind === "fixture_only" ? [] : productionRecords.map((r) => [r.source_id, evidenceRecordInfo(r)] as const));
  let table = PRODUCTION_PREDICATES;
  let positions: Position[] = [];
  if (c.fixture) {
    const fixture = fixtureFile(c.fixture);
    // fixture_only: the synthetic KB is the benchmark's approved environment.
    // production_plus_fixture: synthetic records may be retrieved and examined, never cited.
    const citable = kind === "fixture_only";
    for (const r of fixture.records) {
      retrievable.push({
        source_id: r.source_id,
        approved: r.approved,
        category: r.category,
        topic: r.topic,
        retrieval_keywords: r.retrieval_keywords,
        normalized_content: r.normalized_content,
        source_summary: r.source_summary,
        citation_eligible: citable,
      });
      info.set(r.source_id, { source_id: r.source_id, approved: r.approved, citation_eligible: citable });
    }
    positions = fixture.positions;
    const fixtureRecords = FIXTURE_RECORD_PREDICATES.filter((p) => fixture.records.some((r) => r.source_id === p.source_id));
    table =
      kind === "fixture_only"
        ? { issues: FIXTURE_ISSUES, records: fixtureRecords, enforceMissingInformation: false }
        : extendPredicateTable(PRODUCTION_PREDICATES, { issues: FIXTURE_ISSUES, records: fixtureRecords });
  }
  return { kind, retrievable, info, table, positions };
}

export function canned(id: string): Transaction {
  return withOfficialMissingInformation(structuredClone(EXTRACTION_RESPONSES[id]!));
}

export function evaluate(
  c: EvalCase,
  transaction: Transaction,
  userTexts: string[],
  clarification?: { maxRoundsReached?: boolean; unknownByUser?: string[] },
  tweak: (env: HarnessEnvironment) => void = () => {},
): EvidenceResult {
  const env = environmentFor(c);
  tweak(env);
  const pool = retrieveEvidencePool(buildRetrievalIndex(env.retrievable), { userTexts, transaction });
  return evaluateEvidence(
    {
      transaction,
      missingFacts: detectMissingInformation(transaction).missingFacts,
      candidates: pool.candidates,
      records: env.info,
      positions: env.positions,
      ...(clarification ? { clarification } : {}),
    },
    env.table,
  );
}

export const firstTurn = (id: string) => evaluate(caseOf(id), canned(id), [caseOf(id).turns[0]!.user_message]);

/** Free-text clarification replies answered by a fake model (only the targeted fields). */
const E = <V>(value: V, evidence_span: string) => ({ value, provenance: "explicit" as const, evidence_span });
export const CLARIFICATION_REPLIES: Record<string, object> = {
  [caseOf("T021").turns[1]!.user_message]: {
    ownership_transfer: E("البنك يشتري السيارة ويتملكها قبل بيعها", "البنك يشتري السيارة من المعرض ويتملكها أولًا"),
  },
  [caseOf("T020").turns[1]!.user_message]: {
    "fees.type": E("مبلغ ثابت 15 درهمًا كل شهر مقابل استخدام خدمة التقسيط", "مبلغ ثابت 15 درهمًا كل شهر مقابل استخدام خدمة التقسيط"),
  },
  ...Object.fromEntries(caseOf("T023").turns.slice(1).map((t) => [t.user_message, { ownership_transfer: { value: null, provenance: "unknown" } }])),
};
export const replyProvider = new FakeProvider((request) => {
  const response = CLARIFICATION_REPLIES[userMessageOf(request)];
  if (!response) throw new Error("no canned clarification response");
  return JSON.stringify(response);
});

export type ConversationTurn = { step: ClarificationStep; evidence: EvidenceResult; transaction: Transaction };

/** Runs a benchmark conversation through clarification; returns the evidence result after every turn. */
export async function conversation(id: string, startFrom = id): Promise<ConversationTurn[]> {
  const c = caseOf(id);
  const texts = [c.turns[0]!.user_message];
  let step = startClarification(canned(startFrom));
  const out: ConversationTurn[] = [];
  const record = (s: ClarificationStep) => {
    if (s.outcome === "failed") throw new Error("clarification failed");
    const closed =
      s.outcome === "insufficient_after_unknown"
        ? { unknownByUser: s.state.unknown_by_user }
        : s.outcome === "max_rounds_reached"
          ? { maxRoundsReached: true }
          : undefined;
    out.push({ step: s, evidence: evaluate(c, s.state.transaction, texts, closed), transaction: s.state.transaction });
  };
  record(step);
  for (const turn of c.turns.slice(1)) {
    if (step.outcome !== "ask") break;
    if (turn.user_message !== "لا أعرف") texts.push(turn.user_message);
    step = await answerClarification(step.state, turn.user_message, replyProvider);
    record(step);
  }
  return out;
}

export const STATE_TO_STATUS: Record<string, EvidenceStatus> = {
  GROUNDED: "sufficient",
  NEEDS_CLARIFICATION: "needs_clarification",
  INSUFFICIENT_EVIDENCE: "insufficient",
  DISPUTED: "disputed",
};
