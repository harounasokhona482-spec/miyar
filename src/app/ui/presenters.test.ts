import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INSUFFICIENT_EVIDENCE_MESSAGE, OUT_OF_SCOPE_MESSAGE, UNSUPPORTED_LANGUAGE_MESSAGE } from "../../domain/messages";
import {
  CONDITION_PREFIX,
  CONDITIONS_INTRO,
  arNum,
  excerptShownOnCard,
  insufficientKind,
  preview,
  scopeView,
  sourceHost,
  sourceNumbers,
  sourcesCount,
  splitLimitations,
  type Answer,
} from "./presenters";

const answer = (over: Partial<Answer> = {}): Answer => ({
  status: "grounded",
  answer_scope: "general_information",
  support_mode: "direct",
  understanding: "فهمنا أنك تسأل عن بيع بالتقسيط.",
  claims: [
    { text: "شرح أول.", source_id: "KB-001", claim_ref: "KB-001-C01", quote: { text: "نص   مقتبس", location: "المتن" } },
    { text: "شرح ثانٍ.", source_id: "KB-002", claim_ref: "KB-002-C01", quote: { text: "نص آخر", location: "الهامش (2)" } },
  ],
  sources: [
    { source_id: "KB-001", title: "مصدر ١", section: "قسم", url: "https://www.dorar.net/feqhia/1/", verified_excerpt: { text: "نص مقتبس", location: "المتن" } },
    { source_id: "KB-002", title: "مصدر ٢", section: "قسم", url: "https://dorar.net/feqhia/2/", verified_excerpt: null },
  ],
  limitations: ["هذه معلومات عامة من المصادر المعتمدة، ولا تتضمن حكمًا على عقد أو معاملة بعينها."],
  next_step: "اعرض العقد على مختص.",
  ...over,
});

describe("presenters", () => {
  it("writes Arabic-Indic digits and agrees the source count", () => {
    expect(arNum(2026)).toBe("٢٠٢٦");
    expect(sourcesCount(1)).toBe("مصدر معتمد واحد");
    expect(sourcesCount(2)).toBe("مصدرين معتمدين");
    expect(sourcesCount(3)).toBe("٣ مصادر معتمدة");
    expect(sourcesCount(11)).toBe("١١ مصدرًا معتمدًا");
  });

  it("lifts unverified conditions out of the limitations, keeping the rest in order", () => {
    const limitations = [CONDITIONS_INTRO, `${CONDITION_PREFIX}وجود بيع بالتقسيط`, `${CONDITION_PREFIX}المدين رضي بالشرط عند التعاقد`, "حد ١", "حد ٢"];
    expect(splitLimitations(limitations)).toEqual({ conditions: ["وجود بيع بالتقسيط", "المدين رضي بالشرط عند التعاقد"], other: ["حد ١", "حد ٢"] });
  });

  it("leaves limitations untouched when there are no conditions", () => {
    expect(splitLimitations(["حد ١", CONDITIONS_INTRO])).toEqual({ conditions: [], other: ["حد ١", CONDITIONS_INTRO] });
  });

  it("states the scope: structural answers are a description, never a ruling", () => {
    expect(scopeView(answer()).badge).toBe("معلومة عامة موثقة");
    expect(scopeView(answer({ answer_scope: "conditional_general_information" })).conditional).toBe(true);
    const s = scopeView(answer({ answer_scope: "structural_general_information" }));
    expect(s.heading).toBe("وصف بنية المعاملة");
    expect(s.summary).toContain("ليس حكمًا");
  });

  it("numbers sources in the answer's order and hides an excerpt a claim already quotes", () => {
    const a = answer();
    expect([...sourceNumbers(a)]).toEqual([["KB-001", 1], ["KB-002", 2]]);
    expect(excerptShownOnCard("نص مقتبس", a)).toBe(false); // same text as claim 1 (whitespace aside)
    expect(excerptShownOnCard("نص أطول من المصدر", a)).toBe(true);
  });

  it("tells the three INSUFFICIENT_EVIDENCE messages apart", () => {
    expect(insufficientKind(INSUFFICIENT_EVIDENCE_MESSAGE)).toBe("evidence");
    expect(insufficientKind(OUT_OF_SCOPE_MESSAGE)).toBe("scope");
    expect(insufficientKind(UNSUPPORTED_LANGUAGE_MESSAGE)).toBe("language");
  });

  it("shows a host instead of a long URL, and previews long descriptions", () => {
    expect(sourceHost("https://www.dorar.net/feqhia/6883/")).toBe("dorar.net");
    expect(sourceHost("not a url")).toBeNull();
    const p = preview("كلمة ".repeat(40), 20);
    expect(p.endsWith("…")).toBe(true);
    expect(p.length).toBeLessThanOrEqual(21);
    expect(preview("قصير")).toBe("قصير");
  });

  it("stays aligned with the fixed limitation texts the generation stage writes", () => {
    const generation = readFileSync(new URL("../../pipeline/generation.ts", import.meta.url), "utf8");
    expect(generation).toContain(CONDITIONS_INTRO);
    expect(generation).toContain(`\`${CONDITION_PREFIX}\${`);
  });
});
