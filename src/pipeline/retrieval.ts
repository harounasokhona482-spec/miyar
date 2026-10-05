import type { KnowledgeRecordV2 } from "../domain/schemas/knowledgeRecord";
import type { PipelineResult } from "../domain/schemas/pipelineResult";
import type { Transaction } from "../domain/schemas/transaction";
import { getRetrievalEligibleRecords, isCitationEligible, type KnowledgeBase } from "../kb/loader";
import { retrievalTokens } from "../text/retrievalTokens";
import { listExtractedFields } from "./extraction";
import { technicalErrorResult } from "./results";

/**
 * Deterministic lexical retrieval (BM25F, local only). It returns candidate
 * records by relevance and nothing more: a score is not evidence, and a
 * candidate is not a citation. Evidence sufficiency is a separate stage.
 *
 * Indexed text: topic, retrieval_keywords, normalized_content, source_summary.
 * Never indexed: editorial_constraints, source_text, verified_excerpt.
 * Category and relationship type only boost; they never exclude a record.
 */

export const INDEXED_FIELDS = ["topic", "retrieval_keywords", "normalized_content", "source_summary"] as const;
export type IndexedField = (typeof INDEXED_FIELDS)[number];

export type RetrievalConfig = {
  topK: number;
  /** BM25 term-frequency saturation. */
  k1: number;
  /** BM25 length normalization. */
  b: number;
  /** BM25F weight of each indexed field. */
  fieldWeights: Record<IndexedField, number>;
  /** Weights of query terms by where they came from. */
  queryWeights: { userText: number; explicitSpan: number; canonical: number };
  /** Multiplier for a record whose category equals the transaction's category (applied only to scores > 0). */
  categoryBoost: number;
};

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  topK: 3,
  k1: 1.2,
  b: 0.75,
  fieldWeights: { topic: 2, retrieval_keywords: 3, normalized_content: 1, source_summary: 1 },
  queryWeights: { userText: 1, explicitSpan: 1, canonical: 0.3 },
  categoryBoost: 1.15,
};

/** The minimum a record must provide to be retrieved. Production builds it from KnowledgeRecordV2. */
export type RetrievableRecord = {
  source_id: string;
  approved: boolean;
  category: string;
  topic: string;
  retrieval_keywords: readonly string[];
  normalized_content: string;
  source_summary: string;
  /** approved && textually verified: may later be cited. Retrieval does not require it. */
  citation_eligible: boolean;
};

export function toRetrievableRecord(record: KnowledgeRecordV2): RetrievableRecord {
  return {
    source_id: record.source_id,
    approved: record.approved,
    category: record.category,
    topic: record.topic,
    retrieval_keywords: record.retrieval_keywords,
    normalized_content: record.normalized_content,
    source_summary: record.source_summary,
    citation_eligible: isCitationEligible(record),
  };
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

type IndexedDoc = {
  record: RetrievableRecord;
  fieldTerms: Record<IndexedField, Map<string, number>>;
  /** Weighted document length (BM25F). */
  length: number;
};

export type RetrievalIndex = {
  docs: readonly IndexedDoc[];
  documentFrequency: ReadonlyMap<string, number>;
  averageLength: number;
};

function counts(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

function fieldText(record: RetrievableRecord, field: IndexedField): string {
  return field === "retrieval_keywords" ? record.retrieval_keywords.join(" ، ") : record[field];
}

/** Builds the index from approved records only; anything else is left out. */
export function buildRetrievalIndex(
  records: readonly RetrievableRecord[],
  weights: Record<IndexedField, number> = DEFAULT_RETRIEVAL_CONFIG.fieldWeights,
): RetrievalIndex {
  const docs: IndexedDoc[] = records
    .filter((r) => r.approved === true)
    .map((record) => {
      const fieldTerms = Object.fromEntries(
        INDEXED_FIELDS.map((f) => [f, counts(retrievalTokens(fieldText(record, f)))]),
      ) as Record<IndexedField, Map<string, number>>;
      let length = 0;
      for (const f of INDEXED_FIELDS) for (const n of fieldTerms[f].values()) length += weights[f] * n;
      return { record, fieldTerms, length };
    });

  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    const terms = new Set(INDEXED_FIELDS.flatMap((f) => [...doc.fieldTerms[f].keys()]));
    for (const t of terms) documentFrequency.set(t, (documentFrequency.get(t) ?? 0) + 1);
  }
  const averageLength = docs.length ? docs.reduce((s, d) => s + d.length, 0) / docs.length : 0;
  return { docs, documentFrequency, averageLength };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/** Canonical vocabulary per analytical label, used only as a low-weight boost. */
const CATEGORY_TERMS: Record<string, string[]> = {
  sale_installments: ["بيع بالتقسيط", "ثمن مؤجل"],
  murabaha_purchase_orderer: ["مرابحة", "الآمر بالشراء"],
  loan_with_conditioned_increase: ["قرض", "زيادة مشروطة"],
  interest_bearing_loan: ["قرض بفائدة"],
  late_payment_terms: ["تأخر", "الأقساط"],
  bnpl: ["تقسيط", "دفعات"],
};
const RELATIONSHIP_TERMS: Record<string, string[]> = {
  sale: ["بيع"],
  loan: ["قرض"],
  murabaha: ["مرابحة"],
};

export type QueryTerm = { term: string; weight: number; from: "user_text" | "explicit_span" | "canonical" };

export type RetrievalInput = {
  /** The user's own words relevant to the context: first message and free-text replies. */
  userTexts: readonly string[];
  /** Structured transaction, if extracted. */
  transaction?: Transaction;
};

export function buildRetrievalQuery(input: RetrievalInput, config: RetrievalConfig = DEFAULT_RETRIEVAL_CONFIG): QueryTerm[] {
  const terms = new Map<string, QueryTerm>();
  const add = (text: string, weight: number, from: QueryTerm["from"]) => {
    for (const term of retrievalTokens(text)) {
      const existing = terms.get(term);
      if (!existing || existing.weight < weight) terms.set(term, { term, weight, from });
    }
  };

  for (const text of input.userTexts) add(text, config.queryWeights.userText, "user_text");

  const t = input.transaction;
  if (t) {
    // Spans the user actually wrote. Clarification choices are template wording, so they are left out.
    for (const { field } of listExtractedFields(t)) {
      if (field.provenance === "explicit" && field.evidence_span && field.evidence_origin !== "clarification_choice") {
        add(field.evidence_span, config.queryWeights.explicitSpan, "explicit_span");
      }
    }
    const canonical = [...(CATEGORY_TERMS[t.category] ?? []), ...(RELATIONSHIP_TERMS[String(t.relationship_type.value)] ?? [])];
    for (const phrase of canonical) add(phrase, config.queryWeights.canonical, "canonical");
  }

  return [...terms.values()].sort((a, b) => a.term.localeCompare(b.term));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type RetrievalCandidate = {
  source_id: string;
  score: number;
  rank: number;
  matched_fields: IndexedField[];
  /** A candidate is not necessarily citable: this must be true before any citation. */
  citation_eligible: boolean;
};

export type RetrievalResult = {
  query: string;
  query_terms: QueryTerm[];
  candidates: RetrievalCandidate[];
  /** True while clarification is pending: candidates are for tracing only, never for an answer. */
  clarification_pending: boolean;
};

export function retrieve(index: RetrievalIndex, input: RetrievalInput, overrides: Partial<RetrievalConfig> = {}): RetrievalResult {
  const config: RetrievalConfig = { ...DEFAULT_RETRIEVAL_CONFIG, ...overrides };
  const queryTerms = buildRetrievalQuery(input, config);
  const n = index.docs.length;

  const scored = index.docs.map((doc) => {
    let score = 0;
    const matched = new Set<IndexedField>();
    for (const { term, weight } of queryTerms) {
      let tf = 0;
      for (const f of INDEXED_FIELDS) {
        const c = doc.fieldTerms[f].get(term) ?? 0;
        if (c > 0) {
          tf += config.fieldWeights[f] * c;
          matched.add(f);
        }
      }
      if (tf === 0) continue;
      const df = index.documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const norm = config.k1 * (1 - config.b + (config.b * doc.length) / (index.averageLength || 1));
      score += weight * idf * ((tf * (config.k1 + 1)) / (tf + norm));
    }
    if (score > 0 && input.transaction && doc.record.category === input.transaction.category) score *= config.categoryBoost;
    return { doc, score, matched };
  });

  const candidates = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.record.source_id.localeCompare(b.doc.record.source_id))
    .slice(0, config.topK)
    .map((s, i) => ({
      source_id: s.doc.record.source_id,
      score: Math.round(s.score * 1e6) / 1e6,
      rank: i + 1,
      matched_fields: INDEXED_FIELDS.filter((f) => s.matched.has(f)),
      citation_eligible: s.doc.record.citation_eligible,
    }));

  return {
    query: queryTerms.map((q) => q.term).join(" "),
    query_terms: queryTerms,
    candidates,
    clarification_pending: input.transaction?.needs_clarification ?? false,
  };
}

const productionIndexes = new WeakMap<KnowledgeBase, RetrievalIndex>();

/** Production entry point: indexes only the loaded knowledge base's retrieval-eligible records. */
export function retrieveFromKnowledgeBase(kb: KnowledgeBase, input: RetrievalInput, overrides: Partial<RetrievalConfig> = {}): RetrievalResult {
  let index = productionIndexes.get(kb);
  if (!index || overrides.fieldWeights) {
    index = buildRetrievalIndex(getRetrievalEligibleRecords(kb).map(toRetrievableRecord), overrides.fieldWeights);
    if (!overrides.fieldWeights) productionIndexes.set(kb, index);
  }
  return retrieve(index, input, overrides);
}

/** Fail-closed wrapper for the pipeline: any exception becomes TECHNICAL_ERROR. */
export function retrieveSafely(
  run: () => RetrievalResult,
): { ok: true; retrieval: RetrievalResult } | { ok: false; result: PipelineResult } {
  try {
    return { ok: true, retrieval: run() };
  } catch {
    return { ok: false, result: technicalErrorResult("retrieval_failed") };
  }
}
