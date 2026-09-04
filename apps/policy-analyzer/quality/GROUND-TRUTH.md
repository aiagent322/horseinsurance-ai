# Policy Analyzer ground-truth format

This directory is the independent accuracy-evaluation corpus for the policy analyzer. Expected answers are hand-authored. They are never generated from the analyzer’s own output.

These fixtures use original synthetic educational language only. They are not carrier policy forms. Metrics from this corpus are not a claim of production accuracy, carrier-form performance, or claim-payment prediction.

## Versions

| Field | Current value |
| --- | --- |
| Corpus version | `quality-corpus-v1` (`corpus.json`) |
| Fixture version | `1` (per fixture; omitted files default to `1`) |
| Analyzer report schema | `policy-record-v1` |
| Minimum fixture count | 25 |

Changing the schema or rewriting expected answers requires a new corpus version. Do not rewrite expected answers to match analyzer output.

## Fixture files

Each file in `fixtures/` is one package. The JSON schema is `ground-truth.schema.json`. TypeScript validation lives in `lib/quality/schema.ts`. Ground-truth files are separate from generated analyzer output (`quality/reports/`, gitignored).

### Required machine-readable fields

| Field | Meaning |
| --- | --- |
| `corpus_version` | Must equal `quality-corpus-v1` |
| `fixture_version` | Per-fixture version string |
| `package_id` | Stable package identifier |
| `documents[].document_id` | Stable document identifiers used in citations |
| `document_order` | Optional explicit document order; defaults to `documents` array order |
| `documents[].pages[]` | Synthetic page text (and optional extraction quality) |
| `expected.declarations` | Whether a declarations page is present, plus named insured, policy number, and related identity fields |
| `expected.coverages` | Expected status, limits, deductibles, and citations for **every** supported coverage |
| `expected.coverages.*.acceptable_statuses` | Explicitly justified alternative statuses |
| `expected.limits` | Expected limit amounts with citations |
| `expected.exclusions` | Expected named exclusions |
| `expected.requirements` | Expected duties / conditions |
| `expected.conflicts` | Expected unresolved contradictions (`kind`, optional `description_contains`, `critical`) |
| `expected.forms` | Expected form inventory and editions (`PRESENT`, `MISSING`, `EDITION MISMATCH`) |
| `expected.completeness` | `APPEARS COMPLETE` or `DOCUMENT PACKAGE MAY BE INCOMPLETE` |
| `expected.citations.required` | Source document and page that must back material findings |
| `expected.acceptable_needs_review` | Whether `needs_review` / `NEEDS CLARIFICATION` is an acceptable package outcome |
| `expected.human_review_required` | Whether a human reviewer must see the package before any production-like use |
| `expected.critical_errors` | Error codes that must fail the release gate if they occur on this fixture |
| `job` | Expected terminal job state, publishability, and runner mode |

Supported coverages (must all appear under `expected.coverages`):

- Full Mortality
- Major Medical
- Surgical
- Colic Surgery
- Loss of Use
- Stallion Infertility
- Theft

Coverage statuses match the analyzer’s labels: `COVERED`, `COVERED WITH LIMITATIONS`, `LIMITED`, `EXCLUDED`, `NOT FOUND`, `POSSIBLE CONFLICT`, `DOCUMENT MISSING`, `NEEDS CLARIFICATION`.

A coverage may list `acceptable_statuses` or `acceptable_needs_review` when human review is the professionally correct outcome. Those alternatives are explicit and fixture-local. They are never inferred from analyzer output.

## Evaluation scopes

- `analysis` — run `analyzeDocuments` on the authored pages and score findings
- `job` — score publication gating only (cancellation / incomplete / missing job / inconsistent binding)
- `both` — score findings and publication gating

Job runner modes: `analyze`, `cancelled`, `incomplete`, `missing_job`, `inconsistent_binding`.

## Fixture inventory (`quality-corpus-v1`)

| File | Package id | Scenario |
| --- | --- | --- |
| `01-clear-affirmative.json` | `edu-qa-01-clear-affirmative` | 1. Clear affirmative coverage |
| `02-explicit-denial.json` | `edu-qa-02-explicit-denial` | 2. Explicit coverage denial |
| `03-conditional-limited.json` | `edu-qa-03-conditional-limited` | 3. Conditional or limited coverage |
| `04-base-contradicted.json` | `edu-qa-04-base-contradicted` | 4. Base form contradicted by an endorsement |
| `05-later-endorsement-controls.json` | `edu-qa-05-later-endorsement` | 5. Multiple endorsements; later endorsement controls |
| `06-conflicting-limits.json` | `edu-qa-06-conflicting-limits` | 6. Conflicting limits on different pages |
| `07-missing-scheduled-form.json` | `edu-qa-07-missing-form` | 7. Missing scheduled form |
| `08-edition-mismatch.json` | `edu-qa-08-edition-mismatch` | 8. Form-edition mismatch |
| `09-mentioned-only.json` | `edu-qa-09-mentioned-only` | 9. Coverage mentioned without being granted or denied |
| `10-anatomical-not-denial.json` | `edu-qa-10-anatomical` | 10. Anatomical wording that must not be treated as coverage denial |
| `11-negation-separated.json` | `edu-qa-11-negation-separated` | 11. Negation separated from the coverage name |
| `12-ocr-wrap.json` | `edu-qa-12-ocr-wrap` | 12. OCR noise and broken line wrapping |
| `13-duplicate-pages.json` | `edu-qa-13-duplicate-pages` | 13. Duplicate pages |
| `14-multi-document.json` | `edu-qa-14-multi-document` | 14. Multi-document package |
| `15-missing-declarations.json` | `edu-qa-15-missing-declarations` | 15. Missing declarations |
| `16-missing-identity.json` | `edu-qa-16-missing-identity` | 16. Missing named insured |
| `21-missing-policy-number.json` | `edu-qa-21-missing-policy-number` | 17. Missing policy number |
| `17-unreadable-page.json` | `edu-qa-17-unreadable` | 18. Unreadable page |
| `18-duplicate-document-ids.json` | `edu-qa-18-duplicate-ids` | 19. Duplicate or inconsistent document identifiers |
| `19-cancelled-incomplete.json` | `edu-qa-19-cancelled-incomplete` | 20. Cancelled or incomplete job with no publishable report |
| `22-missing-durable-job.json` | `edu-qa-22-missing-durable-job` | 21. Missing durable job with no publishable report |
| `23-inconsistent-binding.json` | `edu-qa-23-inconsistent-binding` | 22. Completed job with missing or inconsistent report binding |
| `20-ambiguous-review.json` | `edu-qa-20-ambiguous` | 23. Deliberately ambiguous language requiring human review |
| `24-theft-grant-and-deny.json` | `edu-qa-24-theft-grant-deny` | 24. Theft granted and denied in separate clauses |
| `25-cross-document-limits.json` | `edu-qa-25-cross-document-limits` | 25. Mortality, medical, and surgical limits differ across documents |

## Release gate

The evaluation fails when any of the following occur:

1. Denied or excluded coverage is incorrectly reported as `COVERED`, `COVERED WITH LIMITATIONS`, or `LIMITED`
2. An unmentioned coverage is materially invented as a granting status
3. A report is published without a valid `completed` or `needs_review` job
4. A report is published without valid report binding
5. A required material citation is missing
6. A material citation points to the wrong document
7. A listed but absent form is reported `PRESENT`
8. An edition mismatch is reported `PRESENT`
9. A critical conflict is missed
10. The critical-error count is greater than zero
11. Any documented threshold in `thresholds.json` is missed

## Metrics

The evaluator reports numerator/denominator pairs, not percentages alone:

- total fixtures
- total evaluated findings
- coverage-status accuracy
- precision, recall, and F1 by coverage status
- false-COVERED findings
- false-EXCLUDED findings
- conflict-detection recall
- limit-value accuracy
- deductible-value accuracy
- exclusion recall
- requirement/condition recall
- form-presence accuracy
- missing-form recall
- edition-mismatch recall
- completeness accuracy
- citation-document accuracy
- citation-page accuracy
- unsupported material findings
- uncited material findings
- NEEDS REVIEW frequency
- critical-error count

Thresholds are in `thresholds.json`. They are a synthetic-corpus release bar, not a production accuracy claim.
