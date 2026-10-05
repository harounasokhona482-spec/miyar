import { describe, expect, it } from "vitest";
import kbV2 from "../../knowledge_base_v2.json";
import testSetV2 from "../../test_set_v2.json";
import { FakeProvider } from "../ai/fakeProvider";
import { TestSetFileSchema } from "../domain/schemas/evalCase";
import type { Transaction } from "../domain/schemas/transaction";
import { extractTransaction } from "./extraction";
import { FACT_IDS, detectMissingInformation, factDefinition } from "./missingInfo";
import { EXTRACTION_RESPONSES } from "./testdata/extractionResponses";

const suite = TestSetFileSchema.parse(testSetV2);
const canned = (id: string): Transaction => structuredClone(EXTRACTION_RESPONSES[id]!);
const ids = (t: Transaction) => detectMissingInformation(t).missingFacts.map((f) => f.id);

const U = { value: null, provenance: "unknown" } as const;
const E = <V>(value: V, evidence_span: string) => ({ value, provenance: "explicit" as const, evidence_span });

describe("missing facts per benchmark case", () => {
  it.each([
    ["T001", []],
    ["T004", []],
    ["T005", []],
    // A sale with a deferred price whose fixedness is not stated: asked after the fee (priority 5).
    ["T006", ["fee_nature", "deferred_price_fixed_at_contract"]],
    ["T007", ["intermediary_role"]],
    ["T008", ["late_amount_nature"]],
    ["T009", ["ownership_before_sale"]],
    ["T015", ["intermediary_role", "fee_nature"]],
  ])("%s → %j", (id, expected) => {
    expect(ids(canned(id))).toEqual(expected);
    expect(detectMissingInformation(canned(id)).needsClarification).toBe(expected.length > 0);
  });
});

describe("priority order", () => {
  it("orders several missing facts: relationship, then fees, then the late amount", () => {
    const t = canned("T001");
    t.category = "unknown";
    t.relationship_type = U;
    t.fees.exists = E(true, "رسوم");
    t.late_penalty.exists = E(true, "مبلغ إذا تأخرت");
    const facts = detectMissingInformation(t).missingFacts;
    expect(facts.map((f) => f.id)).toEqual(["relationship_nature", "fee_nature", "late_amount_nature"]);
    expect(facts.map((f) => f.priority)).toEqual([...facts.map((f) => f.priority)].sort((a, b) => a - b));
  });

  it("asks the amount's nature first for late-payment terms, not the relationship (T008)", () => {
    expect(ids(canned("T008"))[0]).toBe("late_amount_nature");
  });

  it("asks ownership before fees for a financing intermediary", () => {
    const t = canned("T009");
    t.fees.exists = E(true, "رسوم");
    expect(ids(t)).toEqual(["ownership_before_sale", "fee_nature"]);
  });
});

describe("only explicit facts close a gap", () => {
  it("does not ask about ownership already stated (T004)", () => {
    expect(ids(canned("T004"))).not.toContain("ownership_before_sale");
  });

  it("treats an inferred ownership as still missing", () => {
    const t = canned("T009");
    t.ownership_transfer = { value: "البنك يملك السيارة", provenance: "inferred" };
    expect(ids(t)).toEqual(["ownership_before_sale"]);
  });

  it("asks about ownership when an extracted ownership claim was hallucinated", async () => {
    const msg = suite.tests.find((c) => c.id === "T009")!.turns[0]!.user_message;
    const bad = canned("T009");
    bad.ownership_transfer = E("البنك يملك السيارة", "البنك");
    const outcome = await extractTransaction(msg, new FakeProvider(() => JSON.stringify(bad)));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(ids(outcome.transaction)).toEqual(["ownership_before_sale"]);
  });

  it("keeps a named but undescribed fee missing (no calculation basis stated)", () => {
    const t = canned("T015");
    expect(t.fees.type.provenance).toBe("explicit"); // «اشتراك شهري ورسوم خدمة»
    expect(ids(t)).toContain("fee_nature");
    t.fees.type = E("مبلغ ثابت مقابل خدمة محددة", "مبلغ ثابت مقابل خدمة محددة");
    expect(ids(t)).not.toContain("fee_nature");
  });

  it("ignores the model's own missing_information list", () => {
    const t = canned("T001");
    t.missing_information = ["أي شيء اقترحه النموذج"];
    expect(ids(t)).toEqual([]);
  });
});

describe("loan_increase_conditioned_at_contract and deferred_price_fixed_at_contract", () => {
  it("does not ask T005 again: the increase is stated as part of the agreement from the start", () => {
    expect(ids(canned("T005"))).toEqual([]);
  });

  it("asks whether a loan increase was a condition when that is not stated", () => {
    const t = canned("T005");
    t.increase_conditioned_at_contract = U;
    expect(ids(t)).toEqual(["loan_increase_conditioned_at_contract"]);
  });

  it("does not ask about conditioning when no increase is mentioned", () => {
    const t = canned("T005");
    t.increase_conditioned_at_contract = U;
    t.return_or_profit = U;
    expect(ids(t)).not.toContain("loan_increase_conditioned_at_contract");
  });

  it("asks it after the relationship becomes an explicit loan with an increase", () => {
    const t = canned("T001");
    t.category = "unknown";
    t.relationship_type = E("loan", "اقتراض مبلغ من المال");
    t.price_fixed_at_contract = U;
    expect(ids(t)).toEqual(["loan_increase_conditioned_at_contract"]);
  });

  it("does not ask T001 again: the price was agreed from the start", () => {
    expect(ids(canned("T001"))).toEqual([]);
  });

  it("asks whether the deferred price was fixed when that is not stated", () => {
    const t = canned("T001");
    t.price_fixed_at_contract = U;
    expect(ids(t)).toEqual(["deferred_price_fixed_at_contract"]);
  });

  it("never asks it for murabaha (structural only) or for late-payment terms", () => {
    expect(ids(canned("T009"))).not.toContain("deferred_price_fixed_at_contract");
    expect(ids(canned("T008"))).not.toContain("deferred_price_fixed_at_contract");
  });

  it("an explicit «no» also closes the gap (the next stage handles it)", () => {
    const t = canned("T001");
    t.price_fixed_at_contract = E(false, "لا");
    expect(ids(t)).toEqual([]);
  });
});

describe("KB-004 structural-only: no question about the promise or possession", () => {
  it("never defines a fact about a binding promise or possession", () => {
    for (const id of FACT_IDS) {
      const def = factDefinition(id);
      expect(`${def.reason} ${def.relatedFields.join(" ")}`, id).not.toMatch(/وعد|قبض/);
    }
  });
});

describe("traceability: every rule comes from approved material", () => {
  const kb = new Map(kbV2.records.map((r) => [r.source_id, r]));
  const benchmarkText = (caseId: string, field: "required_clarification" | "required_reasoning_checks") => {
    const c = suite.tests.find((t) => t.id === caseId)!;
    const items = field === "required_clarification" ? c.turns.flatMap((t) => t.required_clarification) : c.required_reasoning_checks;
    return items.join(" | ");
  };

  it.each(FACT_IDS)("%s basis quotes existing editorial constraints or benchmark text", (id) => {
    for (const basis of factDefinition(id).basis) {
      const kbRef = /^(KB-\d{3}) editorial (usage_notes|must_not_generalize_to|applicability_conditions): (.+)$/.exec(basis);
      const testRef = /^test_set_v2 (T\d{3}) (required_clarification|required_reasoning_checks): (.+)$/.exec(basis);
      expect(kbRef ?? testRef, basis).not.toBeNull();
      if (kbRef) {
        const [, sourceId, field, text] = kbRef;
        type EditorialList = "usage_notes" | "must_not_generalize_to" | "applicability_conditions";
        expect(kb.get(sourceId!)!.editorial_constraints[field as EditorialList], basis).toContain(text);
      }
      if (testRef) {
        const [, caseId, field, text] = testRef;
        for (const part of text!.split("؛").map((s) => s.trim())) {
          expect(benchmarkText(caseId!, field as "required_clarification"), basis).toContain(part);
        }
      }
    }
  });

  it("asks nothing for out-of-scope transactions", () => {
    const t = canned("T006");
    t.in_scope = false;
    expect(ids(t)).toEqual([]);
  });
});
