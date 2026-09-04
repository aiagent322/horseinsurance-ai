import assert from "node:assert/strict";
import { applyReleaseGate, evaluateCorpus, evaluateFixture } from "./evaluate";
import type { QualityThresholds } from "./schema";
import { loadCorpus, loadThresholds } from "./load-corpus";
import { cloneActual, syntheticMatchingActual } from "./synthetic-actual";
import { CORPUS_VERSION } from "./schema";

function requireFail(label: string, actual: ReturnType<typeof evaluateFixture>, code: string) {
  const hit = actual.errors.find((err) => err.code === code && err.critical);
  assert.ok(hit, `${label}: expected critical ${code}, got ${actual.errors.map((e) => e.code).join(", ") || "no errors"}`);
  const gate = applyReleaseGate(
    {
      coverage_status_accuracy: 1,
      precision_recall_f1_by_status: [],
      false_covered_findings: actual.false_covered,
      false_excluded_findings: actual.false_excluded,
      conflict_detection_recall: 1,
      limit_value_accuracy: 1,
      exclusion_recall: 1,
      form_presence_accuracy: 1,
      edition_mismatch_recall: 1,
      completeness_accuracy: 1,
      citation_document_accuracy: 1,
      citation_page_accuracy: 1,
      unsupported_uncited_material_findings: actual.unsupported_uncited,
      needs_review_frequency: 0,
      critical_error_count: actual.errors.filter((e) => e.critical).length
    },
    {
      ...loadThresholds(),
      coverage_status_accuracy_min: 0,
      precision_by_status_min: {},
      recall_by_status_min: {},
      f1_by_status_min: {},
      false_excluded_max: 99,
      conflict_detection_recall_min: 0,
      limit_value_accuracy_min: 0,
      exclusion_recall_min: 0,
      form_presence_accuracy_min: 0,
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
  const multi = byId.get("edu-qa-14-multi-document");
  const cancelled = byId.get("edu-qa-19-cancelled-incomplete");
  const clear = byId.get("edu-qa-01-clear-affirmative");
  assert.ok(denial && edition && multi && cancelled && clear, "harness fixtures missing");

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

  const missedEdition = cloneActual(syntheticMatchingActual(edition));
  const form = missedEdition.report?.form_inventory.find((f) => f.printed_identifier === "EQ-A-1");
  assert.ok(form);
  form.status = "PRESENT";
  requireFail(
    "missed form-edition mismatch",
    evaluateFixture(edition, missedEdition),
    "EDITION_MISMATCH_REPORTED_PRESENT"
  );

  const fabricated = cloneActual(syntheticMatchingActual(cancelled));
  fabricated.job_state = "cancelled";
  fabricated.published = true;
  fabricated.bound = false;
  fabricated.report = syntheticMatchingActual(clear).report;
  requireFail(
    "fabricated completed report",
    evaluateFixture(cancelled, fabricated),
    "PUBLISHED_WITHOUT_BOUND_JOB"
  );

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
    conflict_detection_recall_min: 0,
    limit_value_accuracy_min: 0,
    exclusion_recall_min: 0,
    form_presence_accuracy_min: 0,
    edition_mismatch_recall_min: 0,
    completeness_accuracy_min: 0,
    citation_document_accuracy_min: 0,
    citation_page_accuracy_min: 0,
    unsupported_uncited_max: 99,
    critical_error_max: 99
  };
  const report = evaluateCorpus(
    [{ fixture: clear, actuals: [metricMiss] }],
    thresholds,
    { corpus_version: CORPUS_VERSION, analyzer_version: "harness", analyzer_git_sha: "harness" }
  );
  assert.equal(report.gate.passed, false, "metric below threshold should fail the gate");
  assert.ok(
    report.gate.failures.some((f) => /coverage-status accuracy/.test(f)),
    `expected accuracy failure, got ${report.gate.failures.join("; ")}`
  );

  console.log("QUALITY HARNESS OK");
  console.log("  false COVERED → FAIL");
  console.log("  missing citation → FAIL");
  console.log("  wrong document citation → FAIL");
  console.log("  missed form-edition mismatch → FAIL");
  console.log("  fabricated completed report → FAIL");
  console.log("  metric below threshold → FAIL");
}
