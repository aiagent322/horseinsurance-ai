import assert from "node:assert/strict";
import { applyReleaseGate, evaluateCorpus, evaluateFixture, frac, type AggregateMetrics } from "./evaluate";
import type { QualityThresholds } from "./schema";
import { loadCorpus, loadThresholds } from "./load-corpus";
import { cloneActual, syntheticMatchingActual } from "./synthetic-actual";
import { CORPUS_VERSION, REPORT_SCHEMA_VERSION } from "./schema";

function passingMetrics(overrides: Partial<AggregateMetrics> = {}): AggregateMetrics {
  const one = frac(1, 1);
  return {
    total_fixtures: 1,
    total_evaluated_findings: 7,
    coverage_status_accuracy: one,
    precision_recall_f1_by_status: [],
    false_covered_findings: 0,
    false_excluded_findings: 0,
    invented_coverage_findings: 0,
    conflict_detection_recall: one,
    limit_value_accuracy: one,
    deductible_value_accuracy: one,
    exclusion_recall: one,
    requirement_recall: one,
    form_presence_accuracy: one,
    missing_form_recall: one,
    edition_mismatch_recall: one,
    completeness_accuracy: one,
    citation_document_accuracy: one,
    citation_page_accuracy: one,
    unsupported_material_findings: 0,
    uncited_material_findings: 0,
    unsupported_uncited_material_findings: 0,
    needs_review_frequency: frac(0, 1),
    critical_error_count: 0,
    ...overrides
  };
}

function requireFail(label: string, actual: ReturnType<typeof evaluateFixture>, code: string) {
  const hit = actual.errors.find((err) => err.code === code && err.critical);
  assert.ok(hit, `${label}: expected critical ${code}, got ${actual.errors.map((e) => e.code).join(", ") || "no errors"}`);
  const gate = applyReleaseGate(
    passingMetrics({
      false_covered_findings: actual.false_covered,
      invented_coverage_findings: actual.invented_coverage,
      uncited_material_findings: actual.uncited_material,
      unsupported_material_findings: actual.unsupported_material,
      unsupported_uncited_material_findings: actual.unsupported_material + actual.uncited_material,
      critical_error_count: actual.errors.filter((e) => e.critical).length,
      coverage_status_accuracy: frac(0, 1)
    }),
    {
      ...loadThresholds(),
      coverage_status_accuracy_min: 0,
      precision_by_status_min: {},
      recall_by_status_min: {},
      f1_by_status_min: {},
      false_excluded_max: 99,
      conflict_detection_recall_min: 0,
      limit_value_accuracy_min: 0,
      deductible_value_accuracy_min: 0,
      exclusion_recall_min: 0,
      requirement_recall_min: 0,
      form_presence_accuracy_min: 0,
      missing_form_recall_min: 0,
      edition_mismatch_recall_min: 0,
      completeness_accuracy_min: 0,
      citation_document_accuracy_min: 0,
      citation_page_accuracy_min: 0
    },
    [actual]
  );
  assert.equal(gate.passed, false, `${label}: release gate should fail`);
}

export function runQualityHarness(): void {
  const fixtures = loadCorpus();
  const byId = new Map(fixtures.map((f) => [f.package_id, f]));
  const denial = byId.get("edu-qa-02-explicit-denial");
  const edition = byId.get("edu-qa-08-edition-mismatch");
  const missingForm = byId.get("edu-qa-07-missing-form");
  const multi = byId.get("edu-qa-14-multi-document");
  const cancelled = byId.get("edu-qa-19-cancelled-incomplete");
  const clear = byId.get("edu-qa-01-clear-affirmative");
  const conflictFx = byId.get("edu-qa-06-conflicting-limits");
  assert.ok(denial && edition && missingForm && multi && cancelled && clear && conflictFx, "harness fixtures missing");

  const falseCovered = cloneActual(syntheticMatchingActual(denial));
  const theft = falseCovered.report?.coverages.find((c) => c.coverage_type === "Theft");
  assert.ok(theft);
  theft.coverage_status = "COVERED";
  theft.source_text = "fabricated grant";
  requireFail("false COVERED", evaluateFixture(denial, falseCovered), "FALSE_COVERED");

  const missingCite = cloneActual(syntheticMatchingActual(denial));
  const excluded = missingCite.report?.coverages.find((c) => c.coverage_type === "Theft");
  assert.ok(excluded);
  excluded.source_document_id = "";
  excluded.source_page = 0;
  excluded.source_text = "";
  requireFail("missing citation", evaluateFixture(denial, missingCite), "MISSING_REQUIRED_CITATION");

  const wrongDoc = cloneActual(syntheticMatchingActual(multi));
  const mort = wrongDoc.report?.coverages.find((c) => c.coverage_type === "Full Mortality");
  assert.ok(mort);
  mort.source_document_id = "edu-14-wrong-document";
  requireFail("wrong document citation", evaluateFixture(multi, wrongDoc), "WRONG_DOCUMENT_CITATION");

  const wrongPage = cloneActual(syntheticMatchingActual(multi));
  const mortPage = wrongPage.report?.coverages.find((c) => c.coverage_type === "Full Mortality");
  assert.ok(mortPage);
  mortPage.source_page = 99;
  requireFail("wrong page citation", evaluateFixture(multi, wrongPage), "WRONG_PAGE_CITATION");

  const missedEdition = cloneActual(syntheticMatchingActual(edition));
  const form = missedEdition.report?.form_inventory.find((f) => f.printed_identifier === "EQ-A-1");
  assert.ok(form);
  form.status = "PRESENT";
  requireFail(
    "missed form-edition mismatch",
    evaluateFixture(edition, missedEdition),
    "EDITION_MISMATCH_REPORTED_PRESENT"
  );

  const absentPresent = cloneActual(syntheticMatchingActual(missingForm));
  const listed = absentPresent.report?.form_inventory.find((f) => f.printed_identifier === "EQ-B-1");
  assert.ok(listed);
  listed.status = "PRESENT";
  requireFail(
    "missing scheduled form reported PRESENT",
    evaluateFixture(missingForm, absentPresent),
    "ABSENT_FORM_REPORTED_PRESENT"
  );

  const fabricated = cloneActual(syntheticMatchingActual(cancelled));
  fabricated.job_state = "cancelled";
  fabricated.published = true;
  fabricated.bound = false;
  fabricated.report = syntheticMatchingActual(clear).report;
  requireFail("fabricated completed report", evaluateFixture(cancelled, fabricated), "PUBLISHED_WITHOUT_BOUND_JOB");

  const invalidBinding = cloneActual(syntheticMatchingActual(clear));
  invalidBinding.job_state = "completed";
  invalidBinding.published = true;
  invalidBinding.bound = false;
  invalidBinding.binding_error = "report_session_mismatch";
  requireFail("invalid report binding", evaluateFixture(clear, invalidBinding), "INVALID_REPORT_BINDING");

  const missedConflict = cloneActual(syntheticMatchingActual(conflictFx));
  assert.ok(missedConflict.report);
  missedConflict.report.conflicts = [];
  const medical = missedConflict.report.coverages.find((c) => c.coverage_type === "Major Medical");
  if (medical) medical.coverage_status = "COVERED";
  requireFail("missed conflict", evaluateFixture(conflictFx, missedConflict), "CONFLICT_MISS");

  const metricMiss = cloneActual(syntheticMatchingActual(clear));
  const unused = metricMiss.report?.coverages.find((c) => c.coverage_type === "Theft");
  assert.ok(unused);
  unused.coverage_status = "COVERED";
  unused.source_document_id = clear.documents[0].document_id;
  unused.source_page = 1;
  unused.source_text = "fabricated";
  const thresholds: QualityThresholds = {
    ...loadThresholds(),
    coverage_status_accuracy_min: 1,
    precision_by_status_min: {},
    recall_by_status_min: {},
    f1_by_status_min: {},
    false_covered_max: 99,
    false_excluded_max: 99,
    invented_coverage_max: 99,
    conflict_detection_recall_min: 0,
    limit_value_accuracy_min: 0,
    deductible_value_accuracy_min: 0,
    exclusion_recall_min: 0,
    requirement_recall_min: 0,
    form_presence_accuracy_min: 0,
    missing_form_recall_min: 0,
    edition_mismatch_recall_min: 0,
    completeness_accuracy_min: 0,
    citation_document_accuracy_min: 0,
    citation_page_accuracy_min: 0,
    unsupported_material_max: 99,
    uncited_material_max: 99,
    unsupported_uncited_max: 99,
    critical_error_max: 99
  };
  const report = evaluateCorpus([{ fixture: clear, actuals: [metricMiss] }], thresholds, {
    corpus_version: CORPUS_VERSION,
    analyzer_version: "harness",
    analyzer_git_sha: "harness",
    report_schema_version: REPORT_SCHEMA_VERSION
  });
  assert.equal(report.gate.passed, false, "metric below threshold should fail the gate");
  assert.ok(
    report.gate.failures.some((f) => /coverage-status accuracy/.test(f)),
    `expected accuracy failure, got ${report.gate.failures.join("; ")}`
  );

  console.log("QUALITY SELF-TESTS OK");
  console.log("  1 false COVERED → FAIL");
  console.log("  2 missing required citation → FAIL");
  console.log("  3 wrong document citation → FAIL");
  console.log("  4 wrong page citation → FAIL");
  console.log("  5 missed form-edition mismatch → FAIL");
  console.log("  6 missing scheduled form reported PRESENT → FAIL");
  console.log("  7 fabricated completed report → FAIL");
  console.log("  8 invalid report binding → FAIL");
  console.log("  9 missed conflict → FAIL");
  console.log("  10 metric below threshold → FAIL");
}
