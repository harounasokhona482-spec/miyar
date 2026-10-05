import {
  INSUFFICIENT_EVIDENCE_MESSAGE,
  OUT_OF_SCOPE_MESSAGE,
  PRODUCT_DISCLAIMER,
  REFERRAL_MESSAGE,
  TECHNICAL_ERROR_MESSAGE,
  UNSUPPORTED_LANGUAGE_MESSAGE,
} from "../domain/messages";
import { PipelineResultSchema, type PipelineResult, type REFERRAL_REASONS } from "../domain/schemas/pipelineResult";

export type ReferralReason = (typeof REFERRAL_REASONS)[number];

// Builders for terminal results that carry only fixed texts. They cite
// nothing and contain no religious content of their own.

/** Fail-closed result: never an answer, never a citation. */
export function technicalErrorResult(errorCode: string): PipelineResult {
  return {
    state: "TECHNICAL_ERROR",
    message: TECHNICAL_ERROR_MESSAGE,
    disclaimer: PRODUCT_DISCLAIMER,
    retrieved_source_ids: [],
    error_code: errorCode,
  };
}

export function referralResult(reason: ReferralReason): PipelineResult {
  return PipelineResultSchema.parse({
    state: "REFERRAL",
    message: REFERRAL_MESSAGE,
    disclaimer: PRODUCT_DISCLAIMER,
    referral_reason: reason,
    related_source_ids: [],
  });
}

export function unsupportedLanguageResult(): PipelineResult {
  return PipelineResultSchema.parse({
    state: "INSUFFICIENT_EVIDENCE",
    message: UNSUPPORTED_LANGUAGE_MESSAGE,
    disclaimer: PRODUCT_DISCLAIMER,
    insufficient_reason: "unsupported_language",
  });
}

export function insufficientEvidenceResult(
  reason: "no_supporting_source" | "unknown_material_fact" | "clarification_limit_reached" | "citation_verification_failed",
): PipelineResult {
  return PipelineResultSchema.parse({
    state: "INSUFFICIENT_EVIDENCE",
    message: INSUFFICIENT_EVIDENCE_MESSAGE,
    disclaimer: PRODUCT_DISCLAIMER,
    insufficient_reason: reason,
  });
}

export function outOfScopeResult(): PipelineResult {
  return PipelineResultSchema.parse({
    state: "INSUFFICIENT_EVIDENCE",
    message: OUT_OF_SCOPE_MESSAGE,
    disclaimer: PRODUCT_DISCLAIMER,
    insufficient_reason: "out_of_scope",
  });
}
