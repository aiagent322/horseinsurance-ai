import type {
  AnalysisStatus,
  CoverageRecord,
  PolicyFormRecord,
  PolicyRecord
} from "@/lib/types";
import {
  ANALYSIS_STATUSES,
  DENYING_STATUSES,
  GRANTING_STATUSES,
  SUPPORTED_COVERAGES,
  type GroundTruthFixture,
  type QualityThresholds
} from "./schema";
import type { ActualRun } from "./run-analyzer";

export type Fraction = {
  numerator: number;
  denominator: number;
  value: number | null;
};

export type StatusConfusion = {
  status: AnalysisStatus;
  precision: Fraction;
  recall: Fraction;
  f1: number | null;
  true_positives: number;
  false_positives: number;
  false_negatives: number;
};

export type FixtureError = {
  code: string;
  critical: boolean;
  message: string;
  subject?: string;
  expected?: string;
  actual?: string;
};

export type FixtureEvaluation = {
  package_id: string;
  title: string;
  scenario: string;
  scenario_id: string;
  result: "PASS" | "FAIL";
  job_state_actual: string;
  job_state_expected: string;
  published: boolean;
  bound: boolean;
  errors: FixtureError[];
  expected_versus_actual: Array<{ subject: string; expected: string; actual: string }>;
  coverage_comparisons: number;
  coverage_matches: number;
  false_covered: number;
  false_excluded: number;
  invented_coverage: number;
  conflicts_expected: number;
  conflicts_detected: number;
  critical_conflicts_expected: number;
  critical_conflicts_detected: number;
  limits_expected: number;
  limits_matched: number;
  deductibles_expected: number;
  deductibles_matched: number;
  exclusions_expected: number;
  exclusions_found: number;
  requirements_expected: number;
  requirements_found: number;
  forms_expected: number;
  forms_matched: number;
  missing_forms_expected: number;
  missing_forms_found: number;
  edition_mismatch_expected: number;
  edition_mismatch_found: number;
  completeness_match: boolean | null;
  citation_document_checked: number;
  citation_document_matched: number;
  citation_page_checked: number;
  citation_page_matched: number;
  unsupported_material: number;
  uncited_material: number;
  needs_review: boolean;
};

export type AggregateMetrics = {
  total_fixtures: number;
  total_evaluated_findings: number;
  coverage_status_accuracy: Fraction;
  precision_recall_f1_by_status: StatusConfusion[];
  false_covered_findings: number;
  false_excluded_findings: number;
  invented_coverage_findings: number;
  conflict_detection_recall: Fraction;
  limit_value_accuracy: Fraction;
  deductible_value_accuracy: Fraction;
  exclusion_recall: Fraction;
  requirement_recall: Fraction;
  form_presence_accuracy: Fraction;
  missing_form_recall: Fraction;
  edition_mismatch_recall: Fraction;
  completeness_accuracy: Fraction;
  citation_document_accuracy: Fraction;
  citation_page_accuracy: Fraction;
  unsupported_material_findings: number;
  uncited_material_findings: number;
  unsupported_uncited_material_findings: number;
  needs_review_frequency: Fraction;
  critical_error_count: number;
};

export type GateResult = {
  passed: boolean;
  failures: string[];
};

export type CorpusReport = {
  corpus_version: string;
  report_schema_version: string;
  analyzer_version: string;
  analyzer_git_sha: string;
  generated_at: string;
  disclaimer: string;
  thresholds: QualityThresholds;
  metrics: AggregateMetrics;
  gate: GateResult;
  fixtures: FixtureEvaluation[];
};

export function frac(numerator: number, denominator: number): Fraction {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

function f1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null) return null;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function metricValue(input: number | Fraction | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return input;
  return input.value;
}

export function normalizeMoney(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/[\s,]/g, "").toUpperCase();
  const m = compact.match(/\$?-?\d+(?:\.\d+)?%?/);
  return m ? m[0].replace(/^\$/, "$") : compact;
}

function coverageOf(report: PolicyRecord | null, type: string): CoverageRecord | undefined {
  return report?.coverages.find((c) => c.coverage_type === type);
}

function statusMatches(
  expected: GroundTruthFixture["expected"]["coverages"][string],
  actual: AnalysisStatus | undefined
): boolean {
  if (!actual) return false;
  if (actual === expected.status) return true;
  if (expected.acceptable_statuses?.includes(actual)) return true;
  if (expected.acceptable_needs_review && actual === "NEEDS CLARIFICATION") return true;
  return false;
}

function formOf(report: PolicyRecord | null, printed: string): PolicyFormRecord | undefined {
  const want = printed.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return report?.form_inventory.find(
    (f) => f.normalized_identifier === want || f.printed_identifier.replace(/[^A-Za-z0-9]/g, "").toUpperCase() === want
  );
}

function validJobForPublish(state: string): boolean {
  return state === "completed" || state === "needs_review";
}

function packageDocumentIds(fixture: GroundTruthFixture): string[] {
  return fixture.document_order && fixture.document_order.length
    ? fixture.document_order
    : fixture.documents.map((d) => d.document_id);
}

function conflictDetected(report: PolicyRecord, expected: GroundTruthFixture["expected"]["conflicts"][number]): boolean {
  const hasConflictRow = report.conflicts.length > 0;
  const hasPossible = report.coverages.some((cov) => cov.coverage_status === "POSSIBLE CONFLICT");
  if (!hasConflictRow && !hasPossible) return false;
  if (!expected.description_contains) return true;
  const needle = expected.description_contains.toLowerCase();
  if (report.conflicts.some((row) => `${row.title} ${row.description}`.toLowerCase().includes(needle))) {
    return true;
  }
  return report.coverages.some(
    (cov) =>
      cov.coverage_status === "POSSIBLE CONFLICT" &&
      (cov.coverage_type.toLowerCase().includes(needle) || needle.includes(cov.coverage_type.toLowerCase()))
  );
}

export function evaluateFixture(fixture: GroundTruthFixture, actual: ActualRun): FixtureEvaluation {
  const errors: FixtureError[] = [];
  const diffs: Array<{ subject: string; expected: string; actual: string }> = [];
  const jobExpected =
    fixture.job.scenarios?.find((s) => s.id === actual.scenario_id)?.expected_state || fixture.job.expected_state;
  const publishable =
    fixture.job.scenarios?.find((s) => s.id === actual.scenario_id)?.publishable ?? fixture.job.publishable;
  const packageIds = packageDocumentIds(fixture);

  const evaln: FixtureEvaluation = {
    package_id: fixture.package_id,
    title: fixture.title,
    scenario: fixture.scenario,
    scenario_id: actual.scenario_id,
    result: "PASS",
    job_state_actual: actual.job_state,
    job_state_expected: jobExpected,
    published: actual.published,
    bound: actual.bound,
    errors,
    expected_versus_actual: diffs,
    coverage_comparisons: 0,
    coverage_matches: 0,
    false_covered: 0,
    false_excluded: 0,
    invented_coverage: 0,
    conflicts_expected: 0,
    conflicts_detected: 0,
    critical_conflicts_expected: 0,
    critical_conflicts_detected: 0,
    limits_expected: 0,
    limits_matched: 0,
    deductibles_expected: 0,
    deductibles_matched: 0,
    exclusions_expected: 0,
    exclusions_found: 0,
    requirements_expected: 0,
    requirements_found: 0,
    forms_expected: 0,
    forms_matched: 0,
    missing_forms_expected: 0,
    missing_forms_found: 0,
    edition_mismatch_expected: 0,
    edition_mismatch_found: 0,
    completeness_match: null,
    citation_document_checked: 0,
    citation_document_matched: 0,
    citation_page_checked: 0,
    citation_page_matched: 0,
    unsupported_material: 0,
    uncited_material: 0,
    needs_review:
      actual.job_state === "needs_review" ||
      (actual.report?.coverages.some((c) => c.coverage_status === "NEEDS CLARIFICATION") ?? false)
  };

  const note = (code: string, critical: boolean, message: string, extra?: Partial<FixtureError>) => {
    errors.push({ code, critical, message, ...extra });
    if (extra?.expected !== undefined || extra?.actual !== undefined) {
      diffs.push({
        subject: extra?.subject || code,
        expected: extra?.expected || "",
        actual: extra?.actual || ""
      });
    }
  };

  if (actual.published && (!validJobForPublish(actual.job_state) || !actual.bound)) {
    note("PUBLISHED_WITHOUT_BOUND_JOB", true, `Report published with job_state=${actual.job_state} bound=${actual.bound}`);
  }
  if (actual.published && !actual.bound) {
    note(
      "INVALID_REPORT_BINDING",
      true,
      `Published report is not bound (${actual.binding_error || "unbound"})`
    );
  }
  if (actual.published !== publishable) {
    note("PUBLISHABLE_MISMATCH", actual.published && !publishable, `publishable expected ${publishable}, actual published=${actual.published}`, {
      expected: String(publishable),
      actual: String(actual.published)
    });
  }
  if (actual.job_state !== jobExpected) {
    note("JOB_STATE_MISMATCH", false, `job state expected ${jobExpected}, actual ${actual.job_state}`, {
      subject: "job_state",
      expected: jobExpected,
      actual: actual.job_state
    });
  }

  if (fixture.evaluation_scope === "job") {
    evaln.result = errors.length ? "FAIL" : "PASS";
    return evaln;
  }

  const report = actual.report;
  if (!report) {
    note("REPORT_MISSING", fixture.evaluation_scope === "analysis", "No analyzer report was produced for an analysis-scoped fixture.");
    evaln.result = errors.length ? "FAIL" : "PASS";
    return evaln;
  }

  for (const type of SUPPORTED_COVERAGES) {
    const expected = fixture.expected.coverages[type];
    const rec = coverageOf(report, type);
    const actualStatus = rec?.coverage_status;
    evaln.coverage_comparisons += 1;
    if (statusMatches(expected, actualStatus)) evaln.coverage_matches += 1;
    else {
      note("COVERAGE_STATUS_MISMATCH", false, `${type}: expected ${expected.status}, actual ${actualStatus || "missing"}`, {
        subject: type,
        expected: expected.status,
        actual: actualStatus || "missing"
      });
    }
    if (DENYING_STATUSES.has(expected.status) && actualStatus && GRANTING_STATUSES.has(actualStatus)) {
      evaln.false_covered += 1;
      note("FALSE_COVERED", true, `${type} is ${expected.status} in ground truth but reported ${actualStatus}`, {
        subject: type,
        expected: expected.status,
        actual: actualStatus
      });
    }
    if (GRANTING_STATUSES.has(expected.status) && actualStatus === "EXCLUDED") {
      evaln.false_excluded += 1;
      note("FALSE_EXCLUDED", false, `${type} is ${expected.status} in ground truth but reported EXCLUDED`, {
        subject: type,
        expected: expected.status,
        actual: "EXCLUDED"
      });
    }
    if (expected.status === "NOT FOUND" && actualStatus && GRANTING_STATUSES.has(actualStatus)) {
      evaln.invented_coverage += 1;
      note("INVENTED_COVERAGE", true, `${type} is unmentioned in ground truth but reported ${actualStatus}`, {
        subject: type,
        expected: "NOT FOUND",
        actual: actualStatus
      });
    }

    if (expected.status !== "NOT FOUND") {
      const required = expected.citation;
      if (required) {
        evaln.citation_document_checked += 1;
        evaln.citation_page_checked += 1;
        const docOk = rec?.source_document_id === required.document_id;
        const pageOk = rec?.source_page === required.page;
        if (docOk) evaln.citation_document_matched += 1;
        else {
          note(
            rec?.source_document_id ? "WRONG_DOCUMENT_CITATION" : "MISSING_REQUIRED_CITATION",
            true,
            `${type} citation document expected ${required.document_id}, actual ${rec?.source_document_id || "(empty)"}`,
            { subject: type, expected: required.document_id, actual: rec?.source_document_id || "(empty)" }
          );
        }
        if (pageOk) evaln.citation_page_matched += 1;
        else {
          note(
            rec?.source_page && rec.source_page > 0 ? "WRONG_PAGE_CITATION" : "MISSING_REQUIRED_CITATION",
            true,
            `${type} citation page expected ${required.page}, actual ${rec?.source_page ?? 0}`,
            { subject: type, expected: String(required.page), actual: String(rec?.source_page ?? 0) }
          );
        }
      }
      const noCite = !rec || !rec.source_document_id || rec.source_page <= 0 || !rec.source_text?.trim();
      if (noCite) {
        evaln.uncited_material += 1;
        note("UNCITED_MATERIAL", true, `${type} is ${actualStatus || "missing"} without a usable source citation`, {
          subject: type
        });
      } else if (rec && !packageIds.includes(rec.source_document_id)) {
        evaln.unsupported_material += 1;
        note("UNSUPPORTED_MATERIAL", true, `${type} cites unknown document ${rec.source_document_id}`, {
          subject: type,
          actual: rec.source_document_id
        });
      }
    }

    if (expected.limit) {
      evaln.limits_expected += 1;
      const actualLimit = rec?.coverage_limit?.value || rec?.occurrence_limit?.value;
      if (normalizeMoney(actualLimit) === normalizeMoney(expected.limit)) evaln.limits_matched += 1;
      else {
        note("LIMIT_MISMATCH", false, `${type} limit expected ${expected.limit}, actual ${actualLimit || "(none)"}`, {
          subject: `${type} limit`,
          expected: expected.limit,
          actual: actualLimit || "(none)"
        });
      }
    }
    if (expected.deductible) {
      evaln.deductibles_expected += 1;
      if (normalizeMoney(rec?.deductible?.value) === normalizeMoney(expected.deductible)) evaln.deductibles_matched += 1;
      else {
        note(
          "DEDUCTIBLE_MISMATCH",
          false,
          `${type} deductible expected ${expected.deductible}, actual ${rec?.deductible?.value || "(none)"}`,
          { subject: `${type} deductible`, expected: expected.deductible, actual: rec?.deductible?.value || "(none)" }
        );
      }
    }
  }

  for (const limit of fixture.expected.limits) {
    evaln.limits_expected += 1;
    const hit = report.financial_limits.find(
      (item) =>
        item.label.toLowerCase().includes(limit.label_contains.toLowerCase()) &&
        normalizeMoney(item.amount) === normalizeMoney(limit.amount)
    );
    if (hit) evaln.limits_matched += 1;
    else {
      note("LIMIT_MISMATCH", false, `limit ${limit.label_contains}=${limit.amount} not found`, {
        subject: limit.label_contains,
        expected: limit.amount,
        actual: "(none)"
      });
    }
  }

  evaln.conflicts_expected = fixture.expected.conflicts.length;
  for (const conflict of fixture.expected.conflicts) {
    const found = conflictDetected(report, conflict);
    if (found) evaln.conflicts_detected += 1;
    if (conflict.critical !== false) {
      evaln.critical_conflicts_expected += 1;
      if (found) evaln.critical_conflicts_detected += 1;
      else {
        note("CONFLICT_MISS", true, `critical conflict not detected: ${conflict.kind}`, {
          subject: conflict.kind,
          expected: conflict.description_contains || conflict.kind,
          actual: "not detected"
        });
      }
    } else if (!found) {
      note("CONFLICT_MISS", false, `detected conflict miss: ${conflict.kind}`);
    }
  }

  evaln.exclusions_expected = fixture.expected.exclusions.length;
  for (const excl of fixture.expected.exclusions) {
    const hit = report.exclusions.find((row) =>
      `${row.condition || ""} ${row.description} ${row.anatomical_area || ""}`
        .toLowerCase()
        .includes(excl.condition_contains.toLowerCase())
    );
    if (hit) evaln.exclusions_found += 1;
    else {
      note("EXCLUSION_MISS", false, `exclusion containing "${excl.condition_contains}" not found`, {
        subject: "exclusion",
        expected: excl.condition_contains,
        actual: "(none)"
      });
    }
  }

  evaln.requirements_expected = fixture.expected.requirements.length;
  for (const req of fixture.expected.requirements) {
    const hit = report.requirements.find((row) =>
      row.requirement.toLowerCase().includes(req.requirement_contains.toLowerCase())
    );
    if (hit) evaln.requirements_found += 1;
    else {
      note("REQUIREMENT_MISS", false, `requirement containing "${req.requirement_contains}" not found`, {
        subject: "requirement",
        expected: req.requirement_contains,
        actual: "(none)"
      });
    }
  }

  evaln.forms_expected = fixture.expected.forms.length;
  for (const form of fixture.expected.forms) {
    const rec = formOf(report, form.printed_identifier);
    if (rec?.status === form.status) evaln.forms_matched += 1;
    else {
      note(
        "FORM_STATUS_MISMATCH",
        false,
        `${form.printed_identifier}: expected ${form.status}, actual ${rec?.status || "missing"}`,
        { subject: form.printed_identifier, expected: form.status, actual: rec?.status || "missing" }
      );
    }
    if (form.status === "MISSING") {
      evaln.missing_forms_expected += 1;
      if (rec?.status === "MISSING") evaln.missing_forms_found += 1;
      if (rec?.status === "PRESENT") {
        note(
          "ABSENT_FORM_REPORTED_PRESENT",
          true,
          `Listed form ${form.printed_identifier} is absent but reported PRESENT`,
          { subject: form.printed_identifier, expected: "MISSING", actual: "PRESENT" }
        );
      }
    }
    if (form.status === "EDITION MISMATCH") {
      evaln.edition_mismatch_expected += 1;
      if (rec?.status === "EDITION MISMATCH") evaln.edition_mismatch_found += 1;
      if (rec?.status === "PRESENT") {
        note(
          "EDITION_MISMATCH_REPORTED_PRESENT",
          true,
          `Edition mismatch for ${form.printed_identifier} was reported PRESENT`,
          { subject: form.printed_identifier, expected: "EDITION MISMATCH", actual: "PRESENT" }
        );
      }
    }
  }

  evaln.completeness_match = report.completeness.status === fixture.expected.completeness;
  if (!evaln.completeness_match) {
    note(
      "COMPLETENESS_MISMATCH",
      false,
      `completeness expected ${fixture.expected.completeness}, actual ${report.completeness.status}`,
      { subject: "completeness", expected: fixture.expected.completeness, actual: report.completeness.status }
    );
  }

  const named = report.identification.named_insured?.value || null;
  const policyNo = report.identification.policy_number?.value || null;
  if (Boolean(fixture.expected.declarations.named_insured) !== Boolean(named)) {
    note(
      "DECLARATIONS_FIELD_MISMATCH",
      false,
      `named insured expected ${fixture.expected.declarations.named_insured}, actual ${named}`,
      { subject: "named_insured", expected: String(fixture.expected.declarations.named_insured), actual: String(named) }
    );
  }
  if (Boolean(fixture.expected.declarations.policy_number) !== Boolean(policyNo)) {
    note(
      "DECLARATIONS_FIELD_MISMATCH",
      false,
      `policy number expected ${fixture.expected.declarations.policy_number}, actual ${policyNo}`,
      { subject: "policy_number", expected: String(fixture.expected.declarations.policy_number), actual: String(policyNo) }
    );
  }

  for (const cite of fixture.expected.citations.required) {
    if (SUPPORTED_COVERAGES.includes(cite.subject as (typeof SUPPORTED_COVERAGES)[number])) continue;
    const rec = report.exclusions.find(
      (row) =>
        cite.subject.toLowerCase().startsWith("exclusion") &&
        `${row.condition || ""} ${row.description}`.toLowerCase().includes(cite.subject.replace(/^exclusion:?\s*/i, "").toLowerCase())
    );
    const docId = rec?.source_document_id;
    const page = rec?.source_page;
    evaln.citation_document_checked += 1;
    evaln.citation_page_checked += 1;
    if (docId === cite.document_id) evaln.citation_document_matched += 1;
    else {
      note(
        docId ? "WRONG_DOCUMENT_CITATION" : "MISSING_REQUIRED_CITATION",
        true,
        `required citation ${cite.subject} document expected ${cite.document_id}, actual ${docId || "(empty)"}`,
        { subject: cite.subject, expected: cite.document_id, actual: docId || "(empty)" }
      );
    }
    if (page === cite.page) evaln.citation_page_matched += 1;
    else {
      note(
        page && page > 0 ? "WRONG_PAGE_CITATION" : "MISSING_REQUIRED_CITATION",
        true,
        `required citation ${cite.subject} page expected ${cite.page}, actual ${page ?? 0}`,
        { subject: cite.subject, expected: String(cite.page), actual: String(page ?? 0) }
      );
    }
  }

  evaln.result = errors.length ? "FAIL" : "PASS";
  return evaln;
}

export function aggregateMetrics(fixtures: FixtureEvaluation[]): AggregateMetrics {
  const sum = (pick: (f: FixtureEvaluation) => number) => fixtures.reduce((n, f) => n + pick(f), 0);
  const completenessCompared = fixtures.filter((f) => f.completeness_match !== null);
  const critical = fixtures.reduce((n, f) => n + f.errors.filter((e) => e.critical).length, 0);
  const needs = fixtures.filter((f) => f.needs_review).length;
  const unsupportedUncited = sum((f) => f.unsupported_material + f.uncited_material);
  return {
    total_fixtures: fixtures.length,
    total_evaluated_findings: sum((f) => f.coverage_comparisons),
    coverage_status_accuracy: frac(sum((f) => f.coverage_matches), sum((f) => f.coverage_comparisons)),
    precision_recall_f1_by_status: [],
    false_covered_findings: sum((f) => f.false_covered),
    false_excluded_findings: sum((f) => f.false_excluded),
    invented_coverage_findings: sum((f) => f.invented_coverage),
    conflict_detection_recall: frac(sum((f) => f.conflicts_detected), sum((f) => f.conflicts_expected)),
    limit_value_accuracy: frac(sum((f) => f.limits_matched), sum((f) => f.limits_expected)),
    deductible_value_accuracy: frac(sum((f) => f.deductibles_matched), sum((f) => f.deductibles_expected)),
    exclusion_recall: frac(sum((f) => f.exclusions_found), sum((f) => f.exclusions_expected)),
    requirement_recall: frac(sum((f) => f.requirements_found), sum((f) => f.requirements_expected)),
    form_presence_accuracy: frac(sum((f) => f.forms_matched), sum((f) => f.forms_expected)),
    missing_form_recall: frac(sum((f) => f.missing_forms_found), sum((f) => f.missing_forms_expected)),
    edition_mismatch_recall: frac(sum((f) => f.edition_mismatch_found), sum((f) => f.edition_mismatch_expected)),
    completeness_accuracy: frac(
      completenessCompared.filter((f) => f.completeness_match).length,
      completenessCompared.length
    ),
    citation_document_accuracy: frac(sum((f) => f.citation_document_matched), sum((f) => f.citation_document_checked)),
    citation_page_accuracy: frac(sum((f) => f.citation_page_matched), sum((f) => f.citation_page_checked)),
    unsupported_material_findings: sum((f) => f.unsupported_material),
    uncited_material_findings: sum((f) => f.uncited_material),
    unsupported_uncited_material_findings: unsupportedUncited,
    needs_review_frequency: frac(needs, fixtures.length),
    critical_error_count: critical
  };
}

export function confusionByStatus(
  pairs: Array<{ expected: AnalysisStatus; actual: AnalysisStatus | "missing" }>
): StatusConfusion[] {
  return ANALYSIS_STATUSES.map((status) => {
    const true_positives = pairs.filter((p) => p.expected === status && p.actual === status).length;
    const false_positives = pairs.filter((p) => p.actual === status && p.expected !== status).length;
    const false_negatives = pairs.filter((p) => p.expected === status && p.actual !== status).length;
    const precision = frac(true_positives, true_positives + false_positives);
    const recall = frac(true_positives, true_positives + false_negatives);
    return {
      status,
      precision,
      recall,
      f1: f1(precision.value, recall.value),
      true_positives,
      false_positives,
      false_negatives
    };
  });
}

export function collectCoveragePairs(
  fixture: GroundTruthFixture,
  actual: ActualRun
): Array<{ expected: AnalysisStatus; actual: AnalysisStatus | "missing" }> {
  if (fixture.evaluation_scope === "job" || !actual.report) return [];
  return SUPPORTED_COVERAGES.map((type) => {
    const expected = fixture.expected.coverages[type].status;
    const rec = actual.report?.coverages.find((c) => c.coverage_type === type);
    return { expected, actual: rec?.coverage_status || "missing" };
  });
}

function below(metric: number | Fraction | null | undefined, min: number | undefined): boolean {
  if (min === undefined) return false;
  const value = metricValue(metric);
  if (value === null) return false;
  return value < min;
}

function formatMetric(metric: number | Fraction | null | undefined): string {
  const value = metricValue(metric);
  if (value === null) return "n/a";
  if (metric && typeof metric === "object") return `${metric.numerator}/${metric.denominator} (${value.toFixed(3)})`;
  return value.toFixed(3);
}

export function applyReleaseGate(
  metrics: AggregateMetrics,
  thresholds: QualityThresholds,
  fixtures: FixtureEvaluation[]
): GateResult {
  const failures: string[] = [];
  const criticalCodes = new Set(fixtures.flatMap((f) => f.errors.filter((e) => e.critical).map((e) => e.code)));
  if (metrics.false_covered_findings > thresholds.false_covered_max) {
    failures.push(`false-COVERED findings ${metrics.false_covered_findings} exceed max ${thresholds.false_covered_max}`);
  }
  if (metrics.invented_coverage_findings > (thresholds.invented_coverage_max ?? 0)) {
    failures.push(`invented coverage findings ${metrics.invented_coverage_findings} exceed max ${thresholds.invented_coverage_max ?? 0}`);
  }
  if (criticalCodes.has("PUBLISHED_WITHOUT_BOUND_JOB")) {
    failures.push("a report was published without a valid completed/needs-review job and bound report");
  }
  if (criticalCodes.has("INVALID_REPORT_BINDING")) {
    failures.push("a report was published without valid report binding");
  }
  if (criticalCodes.has("MISSING_REQUIRED_CITATION")) {
    failures.push("a required source citation is missing");
  }
  if (criticalCodes.has("WRONG_DOCUMENT_CITATION")) {
    failures.push("a citation points to the wrong document");
  }
  if (criticalCodes.has("WRONG_PAGE_CITATION")) {
    failures.push("a citation points to the wrong page");
  }
  if (criticalCodes.has("ABSENT_FORM_REPORTED_PRESENT")) {
    failures.push("a listed but absent form was reported PRESENT");
  }
  if (criticalCodes.has("EDITION_MISMATCH_REPORTED_PRESENT")) {
    failures.push("an edition mismatch was reported PRESENT");
  }
  if (criticalCodes.has("CONFLICT_MISS")) {
    failures.push("a critical conflict was missed");
  }
  if (below(metrics.coverage_status_accuracy, thresholds.coverage_status_accuracy_min)) {
    failures.push(`coverage-status accuracy ${formatMetric(metrics.coverage_status_accuracy)} < ${thresholds.coverage_status_accuracy_min}`);
  }
  if (metrics.false_excluded_findings > thresholds.false_excluded_max) {
    failures.push(`false-EXCLUDED findings ${metrics.false_excluded_findings} exceed max ${thresholds.false_excluded_max}`);
  }
  if (below(metrics.conflict_detection_recall, thresholds.conflict_detection_recall_min)) {
    failures.push(`conflict-detection recall ${formatMetric(metrics.conflict_detection_recall)} < ${thresholds.conflict_detection_recall_min}`);
  }
  if (below(metrics.limit_value_accuracy, thresholds.limit_value_accuracy_min)) {
    failures.push(`limit-value accuracy ${formatMetric(metrics.limit_value_accuracy)} < ${thresholds.limit_value_accuracy_min}`);
  }
  if (below(metrics.deductible_value_accuracy, thresholds.deductible_value_accuracy_min)) {
    failures.push(`deductible-value accuracy ${formatMetric(metrics.deductible_value_accuracy)} < ${thresholds.deductible_value_accuracy_min}`);
  }
  if (below(metrics.exclusion_recall, thresholds.exclusion_recall_min)) {
    failures.push(`exclusion recall ${formatMetric(metrics.exclusion_recall)} < ${thresholds.exclusion_recall_min}`);
  }
  if (below(metrics.requirement_recall, thresholds.requirement_recall_min)) {
    failures.push(`requirement/condition recall ${formatMetric(metrics.requirement_recall)} < ${thresholds.requirement_recall_min}`);
  }
  if (below(metrics.form_presence_accuracy, thresholds.form_presence_accuracy_min)) {
    failures.push(`form-presence accuracy ${formatMetric(metrics.form_presence_accuracy)} < ${thresholds.form_presence_accuracy_min}`);
  }
  if (below(metrics.missing_form_recall, thresholds.missing_form_recall_min)) {
    failures.push(`missing-form recall ${formatMetric(metrics.missing_form_recall)} < ${thresholds.missing_form_recall_min}`);
  }
  if (below(metrics.edition_mismatch_recall, thresholds.edition_mismatch_recall_min)) {
    failures.push(`edition-mismatch recall ${formatMetric(metrics.edition_mismatch_recall)} < ${thresholds.edition_mismatch_recall_min}`);
  }
  if (below(metrics.completeness_accuracy, thresholds.completeness_accuracy_min)) {
    failures.push(`completeness accuracy ${formatMetric(metrics.completeness_accuracy)} < ${thresholds.completeness_accuracy_min}`);
  }
  if (below(metrics.citation_document_accuracy, thresholds.citation_document_accuracy_min)) {
    failures.push(`citation-document accuracy ${formatMetric(metrics.citation_document_accuracy)} < ${thresholds.citation_document_accuracy_min}`);
  }
  if (below(metrics.citation_page_accuracy, thresholds.citation_page_accuracy_min)) {
    failures.push(`citation-page accuracy ${formatMetric(metrics.citation_page_accuracy)} < ${thresholds.citation_page_accuracy_min}`);
  }
  if (metrics.unsupported_material_findings > (thresholds.unsupported_material_max ?? 0)) {
    failures.push(`unsupported material findings ${metrics.unsupported_material_findings} exceed max ${thresholds.unsupported_material_max ?? 0}`);
  }
  if (metrics.uncited_material_findings > (thresholds.uncited_material_max ?? 0)) {
    failures.push(`uncited material findings ${metrics.uncited_material_findings} exceed max ${thresholds.uncited_material_max ?? 0}`);
  }
  if (metrics.unsupported_uncited_material_findings > thresholds.unsupported_uncited_max) {
    failures.push(
      `unsupported/uncited findings ${metrics.unsupported_uncited_material_findings} exceed max ${thresholds.unsupported_uncited_max}`
    );
  }
  if (metrics.critical_error_count > thresholds.critical_error_max) {
    failures.push(`critical-error count ${metrics.critical_error_count} exceeds max ${thresholds.critical_error_max}`);
  }
  for (const row of metrics.precision_recall_f1_by_status) {
    const pMin = thresholds.precision_by_status_min[row.status];
    const rMin = thresholds.recall_by_status_min[row.status];
    const fMin = thresholds.f1_by_status_min[row.status];
    if (below(row.precision, pMin)) failures.push(`${row.status} precision ${formatMetric(row.precision)} < ${pMin}`);
    if (below(row.recall, rMin)) failures.push(`${row.status} recall ${formatMetric(row.recall)} < ${rMin}`);
    if (below(row.f1, fMin)) failures.push(`${row.status} F1 ${row.f1?.toFixed(3)} < ${fMin}`);
  }
  return { passed: failures.length === 0, failures };
}

export function evaluateCorpus(
  items: Array<{ fixture: GroundTruthFixture; actuals: ActualRun[] }>,
  thresholds: QualityThresholds,
  meta: { corpus_version: string; analyzer_version: string; analyzer_git_sha: string; report_schema_version?: string }
): CorpusReport {
  const fixtures: FixtureEvaluation[] = [];
  const pairs: Array<{ expected: AnalysisStatus; actual: AnalysisStatus | "missing" }> = [];
  for (const item of items) {
    for (const actual of item.actuals) {
      fixtures.push(evaluateFixture(item.fixture, actual));
      pairs.push(...collectCoveragePairs(item.fixture, actual));
    }
  }
  const metrics = aggregateMetrics(fixtures);
  metrics.precision_recall_f1_by_status = confusionByStatus(pairs);
  const gate = applyReleaseGate(metrics, thresholds, fixtures);
  return {
    corpus_version: meta.corpus_version,
    report_schema_version: meta.report_schema_version || "policy-record-v1",
    analyzer_version: meta.analyzer_version,
    analyzer_git_sha: meta.analyzer_git_sha,
    generated_at: new Date().toISOString(),
    disclaimer:
      "These metrics are measured on synthetic educational fixtures. They are not a claim of production accuracy, carrier-form performance, or claim-payment prediction.",
    thresholds,
    metrics,
    gate,
    fixtures
  };
}
