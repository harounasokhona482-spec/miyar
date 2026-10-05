/**
 * Words that express a ruling on validity or permissibility. Shared by the
 * safety pre-gate (to detect requests for a personal ruling) and extraction
 * (which must never put a ruling into an extracted value).
 */
export const RULING_TERMS = [
  "حلال", "حرام", "محرم", "يحرم", "جائز", "يجوز", "تجوز", "مباح", "مشروع",
  "صحيح", "باطل", "فاسد", "شرعي", "ربا", "ربوي", "مكروه",
] as const;
