import type { Field, TargetablePath } from "./extraction";
import type { FactId } from "./missingInfo";

/**
 * Fixed, reviewed clarification questions (no LLM phrasing in the MVP).
 * One main question per round; "لا أعرف" is appended to every option list
 * by the clarification module. A later attempt on the same fact uses the
 * next variant, so a repeated question is narrower rather than identical.
 *
 * Choosing an option sets the target field deterministically: provenance
 * "explicit", evidence_span = the option the user chose, value = the
 * reviewed meaning of that option for that question.
 */

export type FieldPatch = { path: TargetablePath; field: Field };
export type OptionTemplate = {
  label: string;
  /** null: the option does not settle the fact (ask again with the next variant). */
  patch: ((ctx: TemplateContext) => FieldPatch[]) | null;
};
export type QuestionVariant = { text: (ctx: TemplateContext) => string; options: OptionTemplate[] };
export type FactTemplate = { factId: FactId; targets: TargetablePath[]; variants: QuestionVariant[] };
export type TemplateContext = { party: string };

const explicit = (value: unknown, label: string): Field => ({ value, provenance: "explicit", evidence_span: label });
const inferred = (value: unknown): Field => ({ value, provenance: "inferred" });

function option(label: string, patch: (label: string, ctx: TemplateContext) => FieldPatch[]): OptionTemplate {
  return { label, patch: (ctx) => patch(label, ctx) };
}

const YES = "نعم";
const NO = "لا";

export const CLARIFICATION_TEMPLATES: Record<FactId, FactTemplate> = {
  relationship_nature: {
    factId: "relationship_nature",
    targets: ["relationship_type"],
    variants: [
      {
        text: () => "هل المعاملة شراء سلعة أو خدمة بثمن يُدفع لاحقًا، أم اقتراض مبلغ من المال يُرد لاحقًا؟",
        options: [
          option("شراء سلعة أو خدمة بثمن مؤجل", (l) => [{ path: "relationship_type", field: explicit("sale", l) }]),
          option("اقتراض مبلغ من المال", (l) => [{ path: "relationship_type", field: explicit("loan", l) }]),
        ],
      },
      {
        text: () => "هل استلمت سلعة أو خدمة مقابل ثمن مؤجل، أم استلمت مبلغًا من المال؟",
        options: [
          option("استلمت سلعة أو خدمة مقابل ثمن مؤجل", (l) => [{ path: "relationship_type", field: explicit("sale", l) }]),
          option("استلمت مبلغًا من المال", (l) => [{ path: "relationship_type", field: explicit("loan", l) }]),
        ],
      },
      {
        text: () => "هل يصف العقد المعاملة بأنها شراء أم بأنها قرض؟",
        options: [
          option("شراء", (l) => [{ path: "relationship_type", field: explicit("sale", l) }]),
          option("قرض", (l) => [{ path: "relationship_type", field: explicit("loan", l) }]),
        ],
      },
    ],
  },

  intermediary_role: {
    factId: "intermediary_role",
    targets: ["ownership_transfer", "relationship_type"],
    variants: [
      {
        text: ({ party }) => `هل يشتري ${party} السلعة ويملكها ثم يبيعها لك، أم يدفع ثمنها عنك فقط؟`,
        options: [
          option("يشتريها ويملكها ثم يبيعها لي", (l, { party }) => [
            { path: "ownership_transfer", field: explicit(`${party} يشتري السلعة ويملكها ثم يبيعها للمستخدم`, l) },
            { path: "relationship_type", field: inferred("murabaha") },
          ]),
          option("يدفع ثمنها عني فقط", (l, { party }) => [
            { path: "ownership_transfer", field: explicit(`${party} يدفع الثمن عن المستخدم ولا يشتري السلعة`, l) },
            { path: "relationship_type", field: inferred("loan") },
          ]),
        ],
      },
      {
        text: ({ party }) => `هل تصبح السلعة ملكًا لـ${party} قبل أن تنتقل إليك؟`,
        options: [
          option(YES, (l, { party }) => [{ path: "ownership_transfer", field: explicit(`السلعة تصبح ملكًا لـ${party} قبل انتقالها إلى المستخدم`, l) }]),
          option(NO, (l, { party }) => [{ path: "ownership_transfer", field: explicit(`السلعة لا تصبح ملكًا لـ${party} قبل انتقالها إلى المستخدم`, l) }]),
        ],
      },
      {
        text: ({ party }) => `هل يوضح العقد أن ${party} يشتري السلعة لنفسه أولًا؟`,
        options: [
          option(YES, (l, { party }) => [{ path: "ownership_transfer", field: explicit(`العقد يوضح أن ${party} يشتري السلعة لنفسه أولًا`, l) }]),
          option(NO, (l, { party }) => [{ path: "ownership_transfer", field: explicit(`العقد يوضح أن ${party} لا يشتري السلعة لنفسه`, l) }]),
        ],
      },
    ],
  },

  ownership_before_sale: {
    factId: "ownership_before_sale",
    targets: ["ownership_transfer"],
    variants: [
      {
        text: () => "هل الجهة الممولة تشتري السلعة وتملكها قبل أن تبيعها لك؟",
        options: [
          option(YES, (l) => [{ path: "ownership_transfer", field: explicit("الجهة الممولة تشتري السلعة وتملكها قبل بيعها للمستخدم", l) }]),
          option(NO, (l) => [{ path: "ownership_transfer", field: explicit("الجهة الممولة لا تشتري السلعة ولا تملكها قبل بيعها للمستخدم", l) }]),
        ],
      },
      {
        text: () => "هل تنتقل ملكية السلعة إلى الجهة الممولة قبل أن تبيعها لك؟",
        options: [
          option(YES, (l) => [{ path: "ownership_transfer", field: explicit("ملكية السلعة تنتقل إلى الجهة الممولة قبل بيعها للمستخدم", l) }]),
          option(NO, (l) => [{ path: "ownership_transfer", field: explicit("ملكية السلعة لا تنتقل إلى الجهة الممولة قبل بيعها للمستخدم", l) }]),
        ],
      },
      {
        text: () => "هل يذكر العقد أن الجهة الممولة اشترت السلعة باسمها أولًا؟",
        options: [
          option(YES, (l) => [{ path: "ownership_transfer", field: explicit("العقد يذكر أن الجهة الممولة اشترت السلعة باسمها أولًا", l) }]),
          option(NO, (l) => [{ path: "ownership_transfer", field: explicit("العقد لا يذكر أن الجهة الممولة اشترت السلعة باسمها", l) }]),
        ],
      },
    ],
  },

  fee_nature: {
    factId: "fee_nature",
    targets: ["fees.type"],
    variants: [
      {
        text: () => "كيف تُحسب هذه الرسوم؟",
        options: [
          option("مبلغ ثابت مقابل خدمة محددة", (l) => [{ path: "fees.type", field: explicit("مبلغ ثابت مقابل خدمة محددة", l) }]),
          option("تتغير بحسب قيمة التمويل أو مدة السداد", (l) => [{ path: "fees.type", field: explicit("تتغير بحسب قيمة التمويل أو مدة السداد", l) }]),
          { label: "طريقة أخرى", patch: null },
        ],
      },
      {
        text: () => "هل تتغير قيمة هذه الرسوم إذا زادت قيمة المشتريات أو طالت مدة السداد؟",
        options: [
          option(YES, (l) => [{ path: "fees.type", field: explicit("تتغير بحسب قيمة التمويل أو مدة السداد", l) }]),
          option(NO, (l) => [{ path: "fees.type", field: explicit("مبلغ ثابت لا يتغير بقيمة التمويل ولا بمدة السداد", l) }]),
        ],
      },
      {
        text: () => "صف باختصار مقابل ماذا تُدفع هذه الرسوم وكيف تُحسب.",
        options: [],
      },
    ],
  },

  late_amount_nature: {
    factId: "late_amount_nature",
    targets: ["late_penalty.details"],
    variants: [
      {
        text: () => "هل هذا المبلغ يُضاف إلى المبلغ المستحق عليك بسبب التأخير، أم أنه رسم من نوع آخر؟",
        options: [
          option("يُضاف إلى المبلغ المستحق بسبب التأخير", (l) => [{ path: "late_penalty.details", field: explicit("مبلغ يُضاف إلى المبلغ المستحق بسبب التأخير", l) }]),
          option("رسم من نوع آخر", (l) => [{ path: "late_penalty.details", field: explicit("رسم من نوع آخر لا يُضاف إلى المستحق بسبب التأخير", l) }]),
        ],
      },
      {
        text: () => "هل يزيد المبلغ المستحق عليك كلما طالت مدة التأخير؟",
        options: [
          option(YES, (l) => [{ path: "late_penalty.details", field: explicit("المبلغ المستحق يزيد كلما طالت مدة التأخير", l) }]),
          option(NO, (l) => [{ path: "late_penalty.details", field: explicit("المبلغ المستحق لا يزيد بطول مدة التأخير", l) }]),
        ],
      },
      {
        text: () => "صف باختصار ما الذي ينص عليه العقد بشأن هذا المبلغ.",
        options: [],
      },
    ],
  },
};
