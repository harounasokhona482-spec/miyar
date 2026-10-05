import kbV2 from "../../../knowledge_base_v2.json";
import type { GenerationOutput } from "../generationSchema";

/**
 * Canned outputs of a well-behaved generation model (tests only). Claim text
 * is copied from the knowledge base registry by claim_ref, as the model is
 * instructed to do.
 */

export function registryClaim(claimRef: string): { text: string; source_id: string; claim_ref: string } {
  const sourceId = claimRef.slice(0, 6);
  const record = kbV2.records.find((r) => r.source_id === sourceId);
  const claim = record?.claims_check.find((c) => c.claim_id === claimRef);
  if (!claim) throw new Error(`no registered claim ${claimRef}`);
  return { text: claim.claim, source_id: sourceId, claim_ref: claimRef };
}

const out = (understanding: string, refs: string[], next_step: string, limitations: string[] = []): GenerationOutput => ({
  understanding,
  claims: refs.map(registryClaim),
  limitations,
  next_step,
});

export const GENERATION_RESPONSES: Readonly<Record<string, GenerationOutput>> = {
  T001: out(
    "فهمنا أنك تسأل عن هاتف سعره نقدًا 3000 درهم، ويُباع بالتقسيط بسعر 3400 درهم على 10 أشهر، مع الاتفاق على هذا السعر من البداية.",
    ["KB-001-C01", "KB-001-C02"],
    "إن أردت تطبيق ذلك على عقد بعينه، فاعرض تفاصيله على مختص.",
  ),
  T002: out(
    "فهمنا أنك اشتريت جهازًا من متجر على 6 دفعات، بسعر نهائي ثابت منذ توقيع العقد.",
    ["KB-002-C01", "KB-002-C03"],
    "إن أردت تطبيق ذلك على عقدك نفسه، فاعرض تفاصيله على مختص.",
  ),
  T003: out(
    "فهمنا أن العقد الذي تسأل عنه ينص على أن الأقساط المتبقية كلها تصبح مستحقة فورًا عند التأخر عن قسط، دون زيادة مالية إضافية.",
    ["KB-003-C01", "KB-003-C02", "KB-003-C03"],
    "انطباق ما سبق يتوقف على كون المعاملة شراءً بالتقسيط وعلى قبولك هذا الشرط عند التعاقد؛ ولتطبيقه على عقدك اعرضه على مختص.",
  ),
  T004: out(
    "فهمنا أن شركة تمويل ستشتري السيارة من المعرض أولًا، ثم تبيعها لك بثمن معلوم على أقساط.",
    ["KB-004-C01", "KB-004-C02", "KB-004-C03", "KB-004-C04"],
    "لمعرفة ما يترتب على صورة الوعد في عقدك، اعرض العقد على مختص.",
  ),
  T005: out(
    "فهمنا أن شخصًا أقرضك 10,000 على أن تعيد 11,000 بعد سنة، وأن الزيادة كانت جزءًا من الاتفاق من البداية.",
    ["KB-005-C01", "KB-005-C03"],
    "إن كان لديك سؤال عن التزام بعينه، فاعرضه على مختص.",
  ),
  T019: out(
    "فهمنا أنك اشتريت غسالة على 12 قسطًا شهريًا، والسعر الإجمالي محدد في العقد من البداية.",
    ["KB-002-C01", "KB-002-C03"],
    "إن أردت تطبيق ذلك على عقدك نفسه، فاعرض تفاصيله على مختص.",
  ),
  T021: out(
    "فهمنا أن البنك يشتري السيارة من المعرض ويتملكها أولًا، ثم يبيعها لك بثمن معلوم على أقساط.",
    ["KB-004-C01", "KB-004-C02", "KB-004-C03"],
    "لمعرفة ما يترتب على صورة الوعد في عقدك، اعرض العقد على مختص.",
  ),
};
