# Policy Analyzer ground-truth format

This directory is the independent accuracy-evaluation corpus for the policy analyzer. Expected answers are hand-authored. They are never generated from the analyzer’s own output.

These fixtures use synthetic educational language only. They are not carrier policy forms. Metrics from this corpus are not a claim of production accuracy.

## Corpus version

`quality-corpus-v1` (`corpus.json`). Changing the schema or rewriting expected answers requires a new corpus version.

## Fixture files

Each file in `fixtures/` is one package. The JSON schema is `ground-truth.schema.json`. TypeScript validation lives in `lib/quality/schema.ts`.

Required fields:

| Field | Meaning |
| --- | --- |
| `package_id` | Stable package identifier |
| `documents[].document_id` | Stable document identifiers used in citations |
| `documents[].pages[]` | Synthetic page text (and optional extraction quality) |
| `expected.declarations` | Whether a declarations page is present, plus named insured, policy number, and related identity fields |
| `expected.coverages` | Expected status for **every** supported coverage |
| `expected.limits` | Expected limit/deductible amounts with citations |
| `expected.exclusions` | Expected named exclusions |
| `expected.requirements` | Expected duties / conditions |
| `expected.conflicts` | Expected unresolved contradictions |
| `expected.forms` | Expected form inventory and editions (`PRESENT`, `MISSING`, `EDITION MISMATCH`) |
| `expected.completeness` | `APPEARS COMPLETE` or `DOCUMENT PACKAGE MAY BE INCOMPLETE` |
| `expected.citations.required` | Source document and page that must back material findings |
| `expected.acceptable_needs_review` | Whether `needs_review` / `NEEDS CLARIFICATION` is an acceptable package outcome |
| `expected.critical_errors` | Error codes that must fail the release gate if they occur on this fixture |
| `job` | Expected terminal job state and whether a report is publishable |

Supported coverages (must all appear under `expected.coverages`):

- Full Mortality
- Major Medical
- Surgical
- Colic Surgery
- Loss of Use
- Stallion Infertility
- Theft

Coverage statuses match the analyzer’s labels: `COVERED`, `COVERED WITH LIMITATIONS`, `LIMITED`, `EXCLUDED`, `NOT FOUND`, `POSSIBLE CONFLICT`, `DOCUMENT MISSING`, `NEEDS CLARIFICATION`.

A coverage may list `acceptable_statuses` or `acceptable_needs_review` when human review is the professionally correct outcome.

## Evaluation scopes

- `analysis` — run `analyzeDocuments` on the authored pages and score findings
- `job` — score publication gating only (cancellation / incomplete jobs)
- `both` — score findings and publication gating

## Release gate

The evaluation fails when any of the following occur:

1. An excluded or denied coverage is reported as `COVERED`, `COVERED WITH LIMITATIONS`, or `LIMITED`
2. A report is published without a valid `completed` / `needs_review` job and a bound report
3. A required source citation is missing
4. A citation points to the wrong document
5. A listed but absent form is reported `PRESENT`
6. An edition mismatch is reported `PRESENT`
7. Aggregate metrics fall below `thresholds.json`

## Metrics

The evaluator reports:

- coverage-status accuracy
- precision, recall, and F1 by coverage status
- false-COVERED findings
- false-EXCLUDED findings
- conflict-detection recall
- limit-value accuracy
- exclusion recall
- form-presence accuracy
- edition-mismatch recall
- completeness accuracy
- citation-document accuracy
- citation-page accuracy
- unsupported or uncited material findings
- NEEDS REVIEW frequency
- critical-error count

Thresholds are in `thresholds.json`. They are a synthetic-corpus release bar, not a production accuracy claim.
