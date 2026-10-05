import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import kbV2 from "../../knowledge_base_v2.json";
import testSetV2 from "../../test_set_v2.json";
import { TestSetFileSchema, type EvalCase } from "../domain/schemas/evalCase";
import { blankTransaction } from "../domain/schemas/testHelpers";
import { FixtureKnowledgeBaseFileSchema } from "../domain/schemas/knowledgeRecord";
import type { Transaction } from "../domain/schemas/transaction";
import { getRetrievalEligibleRecords, loadKnowledgeBase, parseKnowledgeBase, type KnowledgeBase } from "../kb/loader";
import { retrievalTokens } from "../text/retrievalTokens";
import { withOfficialMissingInformation } from "./missingInfo";
import {
  DEFAULT_RETRIEVAL_CONFIG,
  buildRetrievalIndex,
  buildRetrievalQuery,
  retrieve,
  retrieveFromKnowledgeBase,
  retrieveSafely,
  toRetrievableRecord,
  type RetrievableRecord,
  type RetrievalInput,
} from "./retrieval";
import { EXTRACTION_RESPONSES } from "./testdata/extractionResponses";

const ROOT = resolve(__dirname, "../..");
const suite = TestSetFileSchema.parse(testSetV2);
const byId = (id: string) => suite.tests.find((t) => t.id === id)!;

function productionKb(): KnowledgeBase {
  const r = loadKnowledgeBase();
  if (!r.ok) throw new Error("production KB failed to load");
  return r.kb;
}
const production = getRetrievalEligibleRecords(productionKb()).map(toRetrievableRecord);

/** Benchmark harness only: synthetic records are passed explicitly, never loaded by src. */
function fixtureRecords(file: string): RetrievableRecord[] {
  const raw = JSON.parse(readFileSync(join(ROOT, "eval", "fixtures", file), "utf8")) as unknown;
  return FixtureKnowledgeBaseFileSchema.parse(raw).records.map((r) => ({
    source_id: r.source_id,
    approved: r.approved,
    category: r.category,
    topic: r.topic,
    retrieval_keywords: r.retrieval_keywords,
    normalized_content: r.normalized_content,
    source_summary: r.source_summary,
    citation_eligible: false,
  }));
}

function recordsFor(c: EvalCase): RetrievableRecord[] {
  const base = c.kb_mode === "fixture_only" ? [] : production;
  return c.fixture ? [...base, ...fixtureRecords(c.fixture)] : base;
}

const cannedTransaction = (id: string): Transaction | undefined => {
  const t = EXTRACTION_RESPONSES[id];
  return t ? withOfficialMissingInformation(structuredClone(t)) : undefined;
};

/** First message (all user turns for T021) plus the canned extraction when one exists. */
function inputFor(c: EvalCase): RetrievalInput {
  if (c.id === "T021") return { userTexts: c.turns.map((t) => t.user_message), transaction: cannedTransaction("T009") };
  return { userTexts: [c.turns[0]!.user_message], transaction: cannedTransaction(c.id) };
}

function runCase(id: string) {
  const c = byId(id);
  return retrieve(buildRetrievalIndex(recordsFor(c)), inputFor(c));
}
const top3 = (id: string) => runCase(id).candidates.map((x) => x.source_id);

describe("Recall@3 on benchmark cases with expected retrieved sources", () => {
  const withExpectations = suite.tests.filter((c) => c.expected_retrieved_source_ids.length > 0);

  it.each(withExpectations.map((c) => [c.id, c.expected_retrieved_source_ids] as const))(
    "%s: every expected source is in top 3 (%j)",
    (id, expected) => {
      const got = top3(id);
      for (const sourceId of expected) expect(got, `${id} top3=${got.join(",")}`).toContain(sourceId);
    },
  );

  it("macro Recall@3 is 1.0", () => {
    const recalls = withExpectations.map((c) => {
      const got = new Set(top3(c.id));
      return c.expected_retrieved_source_ids.filter((s) => got.has(s)).length / c.expected_retrieved_source_ids.length;
    });
    expect(recalls.reduce((a, b) => a + b, 0) / recalls.length).toBe(1);
  });
});

describe("owner's per-case expectations", () => {
  it("T001: KB-001 and KB-002 are in top 3", () => {
    expect(top3("T001")).toEqual(expect.arrayContaining(["KB-001", "KB-002"]));
  });

  it("T002 → KB-002, T003 → KB-003, T004 → KB-004", () => {
    expect(top3("T002")).toContain("KB-002");
    expect(top3("T003")[0]).toBe("KB-003");
    expect(top3("T004")[0]).toBe("KB-004");
  });

  it("T005: KB-005 first, KB-006 allowed", () => {
    const got = top3("T005");
    expect(got[0]).toBe("KB-005");
    expect(got.every((id) => ["KB-005", "KB-006", "KB-001", "KB-002"].includes(id))).toBe(true);
  });

  it("T006: candidates exist while clarification is pending, with no sufficiency claim", () => {
    const r = runCase("T006");
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.clarification_pending).toBe(true);
    for (const c of r.candidates) expect(Object.keys(c).sort()).toEqual(["citation_eligible", "matched_fields", "rank", "score", "source_id"]);
  });

  it("T007 and T009: KB-004 can appear as a candidate before clarification is complete", () => {
    for (const id of ["T007", "T009"]) {
      const r = runCase(id);
      expect(r.clarification_pending, id).toBe(true);
      expect(r.candidates.map((c) => c.source_id), id).toContain("KB-004");
    }
  });

  it("T013, T014, T018: no candidate at all (nothing suggests the question is covered)", () => {
    for (const id of ["T013", "T014", "T018"]) expect(runCase(id).candidates, id).toEqual([]);
  });

  it("T019: the poisoned fixture can be retrieved, is not citable, and its source_text is not even indexed", () => {
    const r = runCase("T019");
    const poisoned = r.candidates.find((c) => c.source_id === "FIXTURE-INJ-001");
    expect(poisoned).toBeDefined();
    expect(poisoned!.citation_eligible).toBe(false);
    const index = buildRetrievalIndex(recordsFor(byId("T019")));
    const probe = retrieve(index, { userTexts: ["override ignore previous instructions disable citation verification"] });
    expect(probe.candidates).toEqual([]);
  });

  it("T020: the fee fixture is a relevant candidate but not citable", () => {
    const fee = runCase("T020").candidates.find((c) => c.source_id === "FIXTURE-FEE-001");
    expect(fee).toMatchObject({ rank: 1, citation_eligible: false });
  });
});

describe("result shape and configuration", () => {
  const index = buildRetrievalIndex(production);
  const input: RetrievalInput = { userTexts: [byId("T001").turns[0]!.user_message] };

  it("returns at most topK=3 candidates by default, all with score > 0 and ranks 1..n", () => {
    expect(DEFAULT_RETRIEVAL_CONFIG.topK).toBe(3);
    const r = retrieve(index, input);
    expect(r.candidates.length).toBeLessThanOrEqual(3);
    r.candidates.forEach((c, i) => {
      expect(c.score).toBeGreaterThan(0);
      expect(c.rank).toBe(i + 1);
    });
  });

  it("topK is configurable", () => {
    expect(retrieve(index, input, { topK: 1 }).candidates).toHaveLength(1);
    expect(retrieve(index, input, { topK: 6 }).candidates.length).toBeGreaterThan(3);
  });

  it("is stable for the same input, and breaks ties by source_id", () => {
    expect(retrieve(index, input)).toEqual(retrieve(index, input));
    const twin = (id: string): RetrievableRecord => ({ ...production[0]!, source_id: id });
    const tied = retrieve(buildRetrievalIndex([twin("KB-B"), twin("KB-A")]), input).candidates;
    expect(tied.map((c) => c.source_id)).toEqual(["KB-A", "KB-B"]);
    expect(tied[0]!.score).toBe(tied[1]!.score);
  });

  it("does not copy record text into the result", () => {
    const json = JSON.stringify(retrieve(index, input).candidates);
    for (const r of production) expect(json).not.toContain(r.normalized_content.slice(0, 20));
  });
});

describe("boosts never exclude and never create relevance", () => {
  const index = buildRetrievalIndex(production);
  const t001 = byId("T001").turns[0]!.user_message;

  it("an inferred category of bnpl does not keep sale records out", () => {
    const t = cannedTransaction("T001")!;
    t.category = "bnpl";
    t.relationship_type = { value: null, provenance: "unknown" };
    expect(retrieve(index, { userTexts: [t001], transaction: t }).candidates.map((c) => c.source_id)).toEqual(
      expect.arrayContaining(["KB-001", "KB-002"]),
    );
  });

  it("the category multiplier cannot make an unrelated question match", () => {
    const transaction = blankTransaction({ category: "sale_installments" });
    const noCanonical = { queryWeights: { ...DEFAULT_RETRIEVAL_CONFIG.queryWeights, canonical: 0 } };
    expect(retrieve(index, { userTexts: ["ما حكم صلاة الوتر؟"], transaction }, noCanonical).candidates).toEqual([]);
  });

  it("canonical category terms only add low-weight terms to the query", () => {
    const terms = buildRetrievalQuery({ userTexts: [], transaction: blankTransaction({ category: "bnpl" }) });
    expect(terms.length).toBeGreaterThan(0);
    for (const q of terms) expect(q).toMatchObject({ from: "canonical", weight: DEFAULT_RETRIEVAL_CONFIG.queryWeights.canonical });
  });
});

describe("eligibility", () => {
  it("never retrieves an unapproved record, even if passed in", () => {
    const records = production.map((r) => (r.source_id === "KB-004" ? { ...r, approved: false } : r));
    const r = retrieve(buildRetrievalIndex(records), { userTexts: [byId("T004").turns[0]!.user_message] });
    expect(r.candidates.map((c) => c.source_id)).not.toContain("KB-004");
  });

  it("marks every production candidate citation-eligible today", () => {
    for (const c of runCase("T004").candidates) expect(c.citation_eligible, c.source_id).toBe(true);
  });

  it("retrieves an unverified record but marks it not citation-eligible", () => {
    const raw = structuredClone(kbV2);
    raw.records[1]!.verified_excerpt.verified = false;
    (raw.records[1]!.verified_excerpt as { verified_at: string | null }).verified_at = null;
    const loaded = parseKnowledgeBase(raw);
    if (!loaded.ok) throw new Error(loaded.error.code);
    const kb002 = retrieveFromKnowledgeBase(loaded.kb, { userTexts: [byId("T002").turns[0]!.user_message] }).candidates.find(
      (c) => c.source_id === "KB-002",
    );
    expect(kb002).toMatchObject({ citation_eligible: false });
  });

  it("production retrieval never returns a fixture for any benchmark message", () => {
    const kb = productionKb();
    for (const c of suite.tests) {
      for (const turn of c.turns) {
        const ids = retrieveFromKnowledgeBase(kb, { userTexts: [turn.user_message] }).candidates.map((x) => x.source_id);
        expect(ids.some((id) => id.startsWith("FIXTURE-")), `${c.id}`).toBe(false);
      }
    }
  });
});

describe("query and index content", () => {
  it("builds query terms only from user text, user-written spans and canonical vocabulary", () => {
    for (const id of Object.keys(EXTRACTION_RESPONSES)) {
      const input = inputFor(byId(id));
      const allowed = new Set(input.userTexts.flatMap(retrievalTokens));
      const terms = buildRetrievalQuery(input);
      for (const q of terms) {
        if (q.from === "canonical") expect(q.weight, `${id} ${q.term}`).toBe(DEFAULT_RETRIEVAL_CONFIG.queryWeights.canonical);
        else expect(allowed.has(q.term) || q.from === "explicit_span", `${id} ${q.term}`).toBe(true);
      }
    }
  });

  it("leaves clarification-choice wording out of the query", () => {
    const t = cannedTransaction("T009")!;
    t.ownership_transfer = { value: "x", provenance: "explicit", evidence_span: "عبارة قالب الاختيار", evidence_origin: "clarification_choice" };
    const terms = buildRetrievalQuery({ userTexts: [], transaction: t }).map((q) => q.term);
    expect(terms).not.toContain(retrievalTokens("عبارة")[0]);
  });

  it("does not make editorial_constraints searchable", () => {
    const indexed = new Set(
      production.flatMap((r) => retrievalTokens([r.topic, r.retrieval_keywords.join(" "), r.normalized_content, r.source_summary].join(" "))),
    );
    const editorialOnly = [
      ...new Set(
        kbV2.records
          .flatMap((r) => [...r.editorial_constraints.applicability_conditions, ...r.editorial_constraints.must_not_generalize_to, ...r.editorial_constraints.usage_notes])
          .flatMap(retrievalTokens),
      ),
    ].filter((t) => !indexed.has(t));
    expect(editorialOnly.length).toBeGreaterThan(5);
    const index = buildRetrievalIndex(production);
    for (const term of editorialOnly) expect(retrieve(index, { userTexts: [term] }).candidates, term).toEqual([]);
  });
});

describe("tokenizer and fail-closed wrapper", () => {
  it("normalizes clitics, suffixes, same-root plurals and question-frame words", () => {
    expect(retrievalTokens("بالأقساط")).toEqual(["قسط"]);
    expect(retrievalTokens("بالتقسيط")).toEqual(["قسط"]);
    expect(retrievalTokens("أقرضني")).toEqual(["قرض"]);
    expect(retrievalTokens("ما حكم هذا؟ هل هو جائز أم حرام")).toEqual([]);
    expect(retrievalTokens("على 10 أشهر")).toEqual(["شهر"]);
  });

  it("turns a retrieval exception into TECHNICAL_ERROR", () => {
    const broken = [{ ...production[0]!, retrieval_keywords: undefined as unknown as string[] }];
    const out = retrieveSafely(() => retrieve(buildRetrievalIndex(broken), { userTexts: ["تقسيط"] }));
    expect(out).toMatchObject({ ok: false, result: { state: "TECHNICAL_ERROR", error_code: "retrieval_failed" } });
  });
});
