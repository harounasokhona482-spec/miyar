import type { ResponseState } from "./responseStates";

// Fixed texts approved by the project owner. Do not paraphrase or generate them.

export const PRODUCT_DISCLAIMER =
  "مِعيار أداة معرفية مدعومة بالذكاء الاصطناعي، وليست جهة فتوى. يعرض معلومات عامة موثقة من المصادر المعتمدة.";

export const REFERRAL_MESSAGE =
  "هذه الحالة تعتمد على تفاصيل واقعية أو تقدير شرعي متخصص لا يستطيع مِعيار حسمه. يمكننا تلخيص عناصر المعاملة والمصادر ذات الصلة لمراجعتها مع مختص.";

export const INSUFFICIENT_EVIDENCE_MESSAGE =
  "لم نجد في المصادر المعتمدة المتاحة دليلًا كافيًا لتقديم إجابة موثقة. لذلك لن نخمن أو نعتمد على مصدر خارج نطاق مِعيار.";

export const DISPUTED_MESSAGE =
  "توجد في المصادر المعتمدة معالجات مختلفة لهذه المسألة. يعرض مِعيار هذه المعالجات مع مصادرها دون ترجيح مستقل.";

export const TECHNICAL_ERROR_MESSAGE =
  "حدث خطأ تقني ولم نتمكن من إكمال التحقق. لم تُعرض أي نتيجة غير موثقة. حاول مرة أخرى.";

// From test_set_v1.json T018.
export const OUT_OF_SCOPE_MESSAGE =
  "هذا السؤال خارج نطاق النسخة الحالية من مِعيار التي تركز على معاملات مالية محددة.";

/** The "I don't know" option that every clarification question must offer. */
export const DONT_KNOW_OPTION = "لا أعرف";

/** Fixed message per state where one exists; GROUNDED/NEEDS_CLARIFICATION are composed elsewhere. */
export const FIXED_STATE_MESSAGES: Partial<Record<ResponseState, string>> = {
  REFERRAL: REFERRAL_MESSAGE,
  INSUFFICIENT_EVIDENCE: INSUFFICIENT_EVIDENCE_MESSAGE,
  DISPUTED: DISPUTED_MESSAGE,
  TECHNICAL_ERROR: TECHNICAL_ERROR_MESSAGE,
};
