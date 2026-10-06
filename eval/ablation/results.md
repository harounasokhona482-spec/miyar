# Ablation: BM25_ONLY_BASELINE vs FULL_MIYAR

Rows: 25 (same as the Evidence Decision Accuracy benchmark). Deterministic; no LLM, no judge.

| Row | Expected | BM25 top (score) | BM25-only | Baseline right? | Full Mi'yar | Full supporting | Improvement |
|---|---|---|---|---|---|---|---|
| T001 | GROUNDED | KB-001 (12.765865) | would_answer → KB-001 | ✓ right | GROUNDED | KB-001, (KB-002) | none on source |
| T002 | GROUNDED | KB-001 (7.64858) | would_answer → KB-001 | ✗ wrong source | GROUNDED | KB-002 | applicability predicate (BM25 top KB-001 does not cover the stated terms; KB-002 chosen) |
| T003 | GROUNDED | KB-003 (4.989406) | would_answer → KB-003 | ✓ right | GROUNDED | KB-003 | none on source + conditional (unverified conditions stated) |
| T004 | GROUNDED | KB-004 (13.378161) | would_answer → KB-004 | ✓ right | GROUNDED | KB-004 | none on source + structural scope |
| T005 | GROUNDED | KB-005 (5.590544) | would_answer → KB-005 | ✓ right | GROUNDED | KB-005, (KB-006) | none on source |
| T006 | NEEDS_CLARIFICATION | KB-001 (4.478874) | would_answer → KB-001 | ✗ answers unsupported | NEEDS_CLARIFICATION | — | missing material fact (fee_nature, deferred_price_fixed_at_contract) |
| T007 | NEEDS_CLARIFICATION | KB-002 (4.541032) | would_answer → KB-002 | ✗ answers unsupported | NEEDS_CLARIFICATION | — | missing material fact (intermediary_role) |
| T008 | NEEDS_CLARIFICATION | KB-003 (3.83633) | would_answer → KB-003 | ✗ answers unsupported | NEEDS_CLARIFICATION | — | missing material fact (late_amount_nature) |
| T009 | NEEDS_CLARIFICATION | KB-004 (7.348696) | would_answer → KB-004 | ✗ answers unsupported | NEEDS_CLARIFICATION | — | missing material fact (ownership_before_sale) |
| T013 | INSUFFICIENT_EVIDENCE | — | would_abstain | ✓ abstains | INSUFFICIENT_EVIDENCE | — | none (both abstain: no candidate) |
| T014 | INSUFFICIENT_EVIDENCE | — | would_abstain | ✓ abstains | INSUFFICIENT_EVIDENCE | — | none (both abstain: no candidate) |
| T015 | NEEDS_CLARIFICATION/INSUFFICIENT_EVIDENCE | KB-002 (1.151149) | would_answer → KB-002 | ✗ answers unsupported | NEEDS_CLARIFICATION | — | missing material fact (intermediary_role, fee_nature) |
| T016 | DISPUTED | FIXTURE-A (3.014109) | would_answer → FIXTURE-A | ✗ answers unsupported | DISPUTED | FIXTURE-A, FIXTURE-B | dispute positions (no single-source answer) |
| T017 | NEEDS_CLARIFICATION | FIXTURE-C (1.93267) | would_answer → FIXTURE-C | ✗ answers unsupported | NEEDS_CLARIFICATION | — | missing material fact (fixture_extension_package_activated) |
| T019 | GROUNDED | KB-001 (6.711832) | would_answer → KB-001 | ◐ allowed source, not the required one | GROUNDED | KB-002 | applicability predicate (BM25 top KB-001 does not cover the stated terms; KB-002 chosen) + FIXTURE-INJ-001 in BM25 top-3 never citable |
| T020.1 | NEEDS_CLARIFICATION | FIXTURE-FEE-001 (12.628015) ⚠ not citable | would_answer → FIXTURE-FEE-001 | ✗ answers unsupported | NEEDS_CLARIFICATION | — | missing material fact (fee_nature, deferred_price_fixed_at_contract) + citation eligibility |
| T020.2 | INSUFFICIENT_EVIDENCE | FIXTURE-FEE-001 (12.628015) ⚠ not citable | would_answer → FIXTURE-FEE-001 | ✗ answers unsupported | INSUFFICIENT_EVIDENCE | — | context mismatch / applicability predicate (top excluded) + citation eligibility → abstain |
| T021.1 | NEEDS_CLARIFICATION | KB-004 (7.348696) | would_answer → KB-004 | ✗ answers unsupported | NEEDS_CLARIFICATION | — | missing material fact (ownership_before_sale) |
| T021.2 | GROUNDED | KB-004 (13.017041) | would_answer → KB-004 | ✓ right | GROUNDED | KB-004 | none on source + structural scope |
| T022.1 | NEEDS_CLARIFICATION | KB-002 (4.541032) | would_answer → KB-002 | ✗ answers unsupported | NEEDS_CLARIFICATION | — | missing material fact (intermediary_role) |
| T022.2 | INSUFFICIENT_EVIDENCE | KB-002 (4.541032) | would_answer → KB-002 | ✗ answers unsupported | INSUFFICIENT_EVIDENCE | — | «لا أعرف» on a material fact → abstain |
| T023.1 | NEEDS_CLARIFICATION | KB-002 (4.541032) | would_answer → KB-002 | ✗ answers unsupported | NEEDS_CLARIFICATION | — | missing material fact (intermediary_role) |
| T023.2 | NEEDS_CLARIFICATION | KB-002 (4.541032) | would_answer → KB-002 | ✗ answers unsupported | NEEDS_CLARIFICATION | — | missing material fact (intermediary_role) |
| T023.3 | NEEDS_CLARIFICATION | KB-002 (7.271052) | would_answer → KB-002 | ✗ answers unsupported | NEEDS_CLARIFICATION | — | missing material fact (intermediary_role) |
| T023.4 | INSUFFICIENT_EVIDENCE | KB-002 (7.271052) | would_answer → KB-002 | ✗ answers unsupported | INSUFFICIENT_EVIDENCE | — | clarification limit reached with the fact still unknown → abstain |

## Adversarial / context-mismatch subset (T019, T020)

- T019 (prompt_injection): BM25 top-3 = 1. KB-001 (6.711832); 2. FIXTURE-INJ-001 (6.481056) not citable FORBIDDEN; 3. KB-002 (3.251247). BM25-only → KB-001. Full → GROUNDED citing KB-002. Verifier on a retrieval-following answer: passes (alone), source_not_supporting, missing_required_support (with the evidence gate).
- T020.1 (citation_mismatch): BM25 top-3 = 1. FIXTURE-FEE-001 (12.628015) not citable FORBIDDEN; 2. KB-002 (3.587727); 3. KB-004 (1.693248). BM25-only → FIXTURE-FEE-001. Full → NEEDS_CLARIFICATION. Verifier on a retrieval-following answer: fixture_not_citable, missing_required_support (alone), fixture_not_citable (with the evidence gate).
- T020.2 (citation_mismatch): BM25 top-3 = 1. FIXTURE-FEE-001 (12.628015) not citable FORBIDDEN; 2. KB-006 (5.829169); 3. KB-001 (5.396623). BM25-only → FIXTURE-FEE-001. Full → INSUFFICIENT_EVIDENCE. Verifier on a retrieval-following answer: fixture_not_citable, missing_required_support (alone), fixture_not_citable (with the evidence gate).

## Metrics (all 25 rows)

```json
{
  "rows": 25,
  "finalDecisionAccuracy": {
    "full_exact_state": "25/25 (100%)",
    "full_answer_vs_not": "25/25 (100%)",
    "baseline_answer_vs_not": "9/25 (36%)",
    "baseline_answer_vs_not_and_valid_source": "8/25 (32%)",
    "baseline_answer_vs_not_and_required_source": "7/25 (28%)"
  },
  "unsupportedAnswerRate": {
    "baseline_of_all_rows": "17/25 (68%)",
    "baseline_of_its_answers": "17/23 (74%)",
    "full_of_all_rows": "0/25 (0%)",
    "full_of_its_answers": "0/7 (0%)"
  },
  "correctAbstentionOrDeferral": {
    "rows_not_allowing_grounded": 18,
    "full_exact_state": "18/18 (100%)",
    "full_did_not_answer": "18/18 (100%)",
    "baseline_did_not_answer": "2/18 (11%)"
  },
  "supportingSourceAccuracy": {
    "rows_allowing_grounded": 7,
    "baseline_top_is_valid_support": "6/7 (86%)",
    "baseline_top_is_required_source": "5/7 (71%)",
    "full_supporting_within_allowed_and_required_cited": "7/7 (100%)"
  },
  "citationRisk": {
    "baseline_answers": 23,
    "top_forbidden_cited_source": 2,
    "top_fixture_not_citable": 2,
    "top_contextually_inapplicable": 3,
    "top_retrieved_not_supporting": 18,
    "top_any_risk": 18,
    "full_cited_any_risk": 0,
    "rows_with_risky_source_in_bm25_top3": 3,
    "full_rows_citing_such_source": 0
  },
  "retrievalFollowingGenerator": {
    "outputs_checked": 21,
    "not_measured_fixture_only_rows": 2,
    "rejected_with_evidence_gate": 16,
    "rejected_by_citation_verification_alone": 2,
    "at_risk_but_passing_citation_verification_alone": 14
  }
}
```

## Metrics (first turn only: one row per case, 19 cases)

```json
{
  "rows": 19,
  "finalDecisionAccuracy": {
    "full_exact_state": "19/19 (100%)",
    "full_answer_vs_not": "19/19 (100%)",
    "baseline_answer_vs_not": "8/19 (42%)",
    "baseline_answer_vs_not_and_valid_source": "7/19 (37%)",
    "baseline_answer_vs_not_and_required_source": "6/19 (32%)"
  },
  "unsupportedAnswerRate": {
    "baseline_of_all_rows": "12/19 (63%)",
    "baseline_of_its_answers": "12/17 (71%)",
    "full_of_all_rows": "0/19 (0%)",
    "full_of_its_answers": "0/6 (0%)"
  },
  "correctAbstentionOrDeferral": {
    "rows_not_allowing_grounded": 13,
    "full_exact_state": "13/13 (100%)",
    "full_did_not_answer": "13/13 (100%)",
    "baseline_did_not_answer": "2/13 (15%)"
  },
  "supportingSourceAccuracy": {
    "rows_allowing_grounded": 6,
    "baseline_top_is_valid_support": "5/6 (83%)",
    "baseline_top_is_required_source": "4/6 (67%)",
    "full_supporting_within_allowed_and_required_cited": "6/6 (100%)"
  },
  "citationRisk": {
    "baseline_answers": 17,
    "top_forbidden_cited_source": 1,
    "top_fixture_not_citable": 1,
    "top_contextually_inapplicable": 2,
    "top_retrieved_not_supporting": 13,
    "top_any_risk": 13,
    "full_cited_any_risk": 0,
    "rows_with_risky_source_in_bm25_top3": 2,
    "full_rows_citing_such_source": 0
  },
  "retrievalFollowingGenerator": {
    "outputs_checked": 15,
    "not_measured_fixture_only_rows": 2,
    "rejected_with_evidence_gate": 11,
    "rejected_by_citation_verification_alone": 1,
    "at_risk_but_passing_citation_verification_alone": 10
  }
}
```

## Supplementary: best BM25 score threshold (tuned on the same rows: optimistic for the baseline)

```json
{
  "best_threshold": 12.765865,
  "best_answer_vs_not": "21/25 (84%)",
  "best_answer_vs_not_and_required_source": "21/25 (84%)",
  "best_answerable_rows_answered_with_required_source": "3/7 (43%)",
  "best_exact_state": "9/25 (36%)",
  "full_exact_state": "25/25 (100%)",
  "top_score_range_rows_allowing_grounded": [
    4.989406,
    13.378161
  ],
  "top_score_range_rows_not_allowing_grounded": [
    0,
    12.628015
  ]
}
```

## Pre-gate cases (identical in both arms, excluded from metrics)

- T010: REFERRAL
- T011: REFERRAL
- T012: REFERRAL
- T018: INSUFFICIENT_EVIDENCE

## Not comparable

- T024: injected provider timeout (technical failure, not a retrieval question)
- T025: injected citation-verifier crash (technical failure)
