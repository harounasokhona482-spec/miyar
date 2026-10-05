import { describe, expect, it } from "vitest";
import { getRetrievalEligibleRecords, loadKnowledgeBase } from "../kb/loader";
import { buildRetrievalIndex, retrieve, toRetrievableRecord } from "../pipeline/retrieval";
import { retrievalTokens } from "../text/retrievalTokens";
import { CATEGORY_TERMS, GENERAL_STOPWORDS, LEMMAS, QUESTION_FRAME_TERMS } from "./retrievalLexicon";

// Owner rule: every dictionary entry needs a regression test that justifies it.
// Adding an entry without adding it here makes these tests fail.

const kb = loadKnowledgeBase();
if (!kb.ok) throw new Error("production KB failed to load");
const index = buildRetrievalIndex(getRetrievalEligibleRecords(kb.kb).map(toRetrievableRecord));
const candidatesFor = (text: string) => retrieve(index, { userTexts: [text] }).candidates.map((c) => c.source_id);

describe("LEMMAS (morphology only)", () => {
  const JUSTIFIED: Record<string, string> = {
    اقساط: "T019 «12 قسطًا» must meet KB-002 «أقساط»",
    تقسيط: "T019 «قسطًا» must meet KB-002 «بالتقسيط»",
  };

  it("has a justification for every lemma and nothing more", () => {
    expect(LEMMAS.map(([form]) => form).sort()).toEqual(Object.keys(JUSTIFIED).sort());
  });

  it("unifies installment forms of the same root", () => {
    const forms = ["قسطًا", "الأقساط", "بالتقسيط", "أقساط"];
    expect(new Set(forms.flatMap(retrievalTokens))).toEqual(new Set(["قسط"]));
  });

  it("T019 regression: «12 قسطًا شهريًا» reaches KB-002", () => {
    expect(candidatesFor("اشتريت غسالة من متجر على 12 قسطًا شهريًا")).toContain("KB-002");
  });
});

describe("QUESTION_FRAME_TERMS (asking for a ruling is not topical evidence)", () => {
  it("lists exactly the reviewed terms", () => {
    expect([...QUESTION_FRAME_TERMS].sort()).toEqual(["الحكم", "تجوز", "جائز", "جائزه", "حرام", "حكم", "حلال", "شرعا", "يجوز"].sort());
  });

  it.each([...QUESTION_FRAME_TERMS])("«%s» alone retrieves nothing", (term) => {
    expect(candidatesFor(term)).toEqual([]);
  });

  it("T018 regression: «ما حكم صلاة الوتر؟» retrieves nothing (it matched KB-004 on «الحكم»)", () => {
    expect(candidatesFor("ما حكم صلاة الوتر؟")).toEqual([]);
  });

  it("T013/T014 regression: «جائز»/«حلال» do not create candidates", () => {
    expect(candidatesFor("هل تداول Options على الأسهم جائز؟")).toEqual([]);
    expect(candidatesFor("هل أرباح Staking في العملات الرقمية حلال؟")).toEqual([]);
  });
});

describe("noise stopwords added after regressions", () => {
  const JUSTIFIED: Record<string, string> = {
    حسب: "T015 matched KB-004 on «بحسب» alone",
    بحسب: "T015 matched KB-004 on «بحسب» alone",
    نعم: "T021 reply «نعم، ...» added a meaningless term",
  };

  it.each(Object.keys(JUSTIFIED))("«%s» is a stopword and retrieves nothing alone", (word) => {
    expect(GENERAL_STOPWORDS).toContain(word);
    expect(candidatesFor(word)).toEqual([]);
  });
});

describe("CATEGORY_TERMS stay small", () => {
  it("has at most two short phrases per category", () => {
    for (const [category, phrases] of Object.entries(CATEGORY_TERMS)) expect(phrases.length, category).toBeLessThanOrEqual(2);
  });
});
