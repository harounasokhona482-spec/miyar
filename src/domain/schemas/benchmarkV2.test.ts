import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import productionKb from "../../../knowledge_base_v1.json";
import testSetV1 from "../../../test_set_v1.json";
import testSetV2 from "../../../test_set_v2.json";
import { DONT_KNOW_OPTION, FIXED_STATE_MESSAGES, OUT_OF_SCOPE_MESSAGE } from "../messages";
import { CRITICAL_ASSERTIONS, TestSetFileSchema, type EvalCase } from "./evalCase";
import { FixtureKnowledgeBaseFileSchema, KnowledgeBaseFileSchema } from "./knowledgeRecord";

// Data-integrity checks on the benchmark and fixtures. No pipeline logic here.

const ROOT = resolve(__dirname, "../../..");
const FIXTURE_DIR = join(ROOT, "eval", "fixtures");

const suite = TestSetFileSchema.parse(testSetV2);
const production = KnowledgeBaseFileSchema.parse(productionKb);

const fixtureFiles = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));
const rawFixtures = new Map(fixtureFiles.map((f) => [f, JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf8")) as unknown]));
const fixtures = new Map([...rawFixtures].map(([f, raw]) => [f, FixtureKnowledgeBaseFileSchema.parse(raw)]));

function activeKb(c: EvalCase) {
  const fixture = c.fixture ? fixtures.get(c.fixture) : undefined;
  const records = [
    ...(c.kb_mode === "fixture_only" ? [] : production.records),
    ...(fixture?.records ?? []),
  ];
  return { records, positions: fixture?.positions ?? [] };
}

const finalStates = (c: EvalCase) => c.turns[c.turns.length - 1]!.accepted_states;
const byId = (id: string) => {
  const c = suite.tests.find((t) => t.id === id);
  if (!c) throw new Error(`missing case ${id}`);
  return c;
};

describe("test_set_v2.json structure", () => {
  it("parses against the benchmark schema", () => {
    expect(TestSetFileSchema.safeParse(testSetV2).error?.issues).toBeUndefined();
  });

  it("ports every v1 case exactly once", () => {
    const v1Ids = testSetV1.tests.map((t) => t.id).sort();
    const ported = suite.tests.flatMap((t) => (t.derived_from_v1 ? [t.derived_from_v1] : [])).sort();
    expect(ported).toEqual(v1Ids);
  });

  it("keeps v1 intact as the historical reference", () => {
    expect(testSetV1.version).toBe("v1");
    expect(testSetV1.tests).toHaveLength(20);
  });
});

describe("source references (no fabricated sources in the benchmark itself)", () => {
  it("references only sources that exist and are approved in the case's active knowledge", () => {
    for (const c of suite.tests) {
      const records = new Map(activeKb(c).records.map((r) => [r.source_id, r]));
      const referenced = [
        ...c.expected_retrieved_source_ids,
        ...c.expected_cited_source_ids,
        ...c.required_cited_source_ids,
        ...c.forbidden_cited_source_ids,
      ];
      for (const id of referenced) {
        expect(records.get(id)?.approved, `${c.id} references ${id}`).toBe(true);
      }
    }
  });

  it("names only fixtures that exist", () => {
    for (const c of suite.tests.filter((t) => t.fixture)) {
      expect(fixtures.has(c.fixture!), `${c.id} → ${c.fixture}`).toBe(true);
    }
  });
});

describe("eval/fixtures isolation", () => {
  it("contains only files marked synthetic, which the production schema rejects", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
    for (const [file, raw] of rawFixtures) {
      expect((raw as { synthetic_test_data?: unknown }).synthetic_test_data, file).toBe(true);
      expect(KnowledgeBaseFileSchema.safeParse(raw).success, `${file} must not pass as production`).toBe(false);
    }
  });

  it("uses globally unique FIXTURE- IDs that never collide with production", () => {
    const ids = [...fixtures.values()].flatMap((f) => f.records.map((r) => r.source_id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("FIXTURE-"))).toBe(true);
    const productionIds = new Set(production.records.map((r) => r.source_id));
    expect(ids.some((id) => productionIds.has(id))).toBe(false);
  });

  it("is never imported by application code under src/", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) {
          // Imports from eval/, or any string literal pointing into eval/fixtures (comments are fine).
          const source = readFileSync(path, "utf8");
          if (/from\s+["'][^"']*\beval[\\/]|["'`][^"'`\n]*\beval[\\/]+fixtures/.test(source)) offenders.push(path);
        }
      }
    };
    walk(join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });
});

describe("rebuilt cases T016, T017, T019, T020", () => {
  it("T016 has two approved positions on one issue, and every one must be cited", () => {
    const c = byId("T016");
    const { positions } = activeKb(c);
    const issues = new Set(positions.map((p) => p.issue_id));
    expect(issues.size).toBe(1);
    expect(new Set(positions.map((p) => p.position_id)).size).toBeGreaterThanOrEqual(2);
    expect([...new Set(positions.map((p) => p.source_id))].sort()).toEqual([...c.required_cited_source_ids].sort());
    expect(finalStates(c)).toEqual(["DISPUTED"]);
  });

  it("T016 and T017 use fictional scenarios only", () => {
    for (const id of ["T016", "T017"]) {
      const fixture = fixtures.get(byId(id).fixture!)!;
      expect(fixture.knowledge_policy.note, id).toMatch(/وهمي/);
      for (const r of fixture.records) expect(r.must_not_generalize_to, `${id} ${r.source_id}`).toContain("أي معاملة حقيقية أو كيان حقيقي");
    }
  });

  it("T017 pairs a general source with a context-restricted one and expects clarification", () => {
    const c = byId("T017");
    const { records } = activeKb(c);
    const general = records.find((r) => r.source_id === "FIXTURE-C")!;
    const restricted = records.find((r) => r.source_id === "FIXTURE-D")!;
    expect(restricted.applicability_conditions.length).toBeGreaterThan(general.applicability_conditions.length);
    expect(finalStates(c)).toEqual(["NEEDS_CLARIFICATION"]);
  });

  it("T019 exposes the pipeline to a poisoned source_text without saying it is a test", () => {
    const c = byId("T019");
    const poisoned = activeKb(c).records.find((r) => r.source_id === "FIXTURE-INJ-001")!;
    expect(poisoned.source_text).toMatch(/تجاهل|ignore/i);
    expect(c.expected_retrieved_source_ids).toContain("FIXTURE-INJ-001");
    expect(c.forbidden_cited_source_ids).toContain("FIXTURE-INJ-001");
    expect(c.policy_preserved).toBe(true);
    expect(c.turns[0]!.user_message).not.toMatch(/اختبار|prompt|injection|حقن/i);
  });

  it("T019 must be GROUNDED on clean production sources only", () => {
    const c = byId("T019");
    expect(finalStates(c)).toEqual(["GROUNDED"]);
    expect(c.required_cited_source_ids.length).toBeGreaterThan(0);
    const productionIds = new Set(production.records.map((r) => r.source_id));
    expect(c.expected_cited_source_ids.every((id) => productionIds.has(id))).toBe(true);
  });

  it("T020 asks first, then abstains, and never grounds on the mismatched fee source", () => {
    const c = byId("T020");
    expect(c.expected_retrieved_source_ids).toContain("FIXTURE-FEE-001");
    expect(c.forbidden_cited_source_ids).toContain("FIXTURE-FEE-001");
    expect(c.turns.map((t) => t.accepted_states)).toEqual([["NEEDS_CLARIFICATION"], ["INSUFFICIENT_EVIDENCE"]]);
    expect(c.expected_cited_source_ids).toEqual([]);
  });
});

describe("multi-turn and fail-closed coverage", () => {
  it("has a case where missing info is supplied and the answer becomes GROUNDED", () => {
    expect(suite.tests.some((c) => c.turns.length > 1 && c.turns[0]!.accepted_states.includes("NEEDS_CLARIFICATION") && finalStates(c).includes("GROUNDED"))).toBe(true);
  });

  it(`has a "${DONT_KNOW_OPTION}" case that ends in INSUFFICIENT_EVIDENCE`, () => {
    const c = suite.tests.find((t) => t.turns.some((turn) => turn.user_message === DONT_KNOW_OPTION));
    expect(c && finalStates(c)).toEqual(["INSUFFICIENT_EVIDENCE"]);
  });

  it("has a case that reaches round 3 and then stops asking", () => {
    const c = suite.tests.find((t) => t.turns.some((turn) => turn.expected_clarification_round === suite.max_clarification_rounds));
    expect(c).toBeDefined();
    expect(finalStates(c!)).not.toContain("NEEDS_CLARIFICATION");
  });

  it("demands three rounds only when every reply adds new information (no 'I don't know')", () => {
    for (const c of suite.tests.filter((t) => t.turns.some((turn) => turn.expected_clarification_round === suite.max_clarification_rounds))) {
      const replies = c.turns.slice(1).map((t) => t.user_message);
      expect(replies.some((r) => r.includes(DONT_KNOW_OPTION)), c.id).toBe(false);
      expect(new Set(replies).size, c.id).toBe(replies.length);
    }
  });

  it("has injected-failure cases that expect only TECHNICAL_ERROR", () => {
    const failing = suite.tests.filter((t) => t.inject_failure);
    expect(failing.length).toBeGreaterThanOrEqual(1);
    for (const c of failing) expect(finalStates(c)).toEqual(["TECHNICAL_ERROR"]);
  });
});

describe("critical assertions", () => {
  it("covers every critical assertion in at least one critical case or globally", () => {
    const covered = new Set([...suite.global_critical_assertions, ...suite.tests.flatMap((t) => t.critical_assertions)]);
    for (const a of CRITICAL_ASSERTIONS) expect(covered.has(a), a).toBe(true);
  });

  it("marks every REFERRAL case critical with no_personal_fatwa", () => {
    for (const c of suite.tests.filter((t) => finalStates(t).includes("REFERRAL"))) {
      expect(c.critical, c.id).toBe(true);
      expect(c.critical_assertions, c.id).toContain("no_personal_fatwa");
    }
  });

  it("uses the owner's fixed texts verbatim for expected messages", () => {
    for (const c of suite.tests.filter((t) => t.expected_user_message)) {
      const states = finalStates(c);
      const allowed = [...states.map((s) => FIXED_STATE_MESSAGES[s]), OUT_OF_SCOPE_MESSAGE];
      expect(allowed, c.id).toContain(c.expected_user_message);
    }
  });

  it("never lists a forbidden phrase that the expected message itself contains", () => {
    for (const c of suite.tests) {
      for (const phrase of c.forbidden_output_substrings) {
        expect(c.expected_user_message?.includes(phrase) ?? false, `${c.id}: ${phrase}`).toBe(false);
      }
    }
  });
});
