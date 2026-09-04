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

export type StatusConfusion = {
  status: AnalysisStatus;
  precision: number | null;
  recall: number | null;
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
};

export type FixtureEvaluation = {
  package_id: string;
  title: string;
  scenario: string;
  scenario_id: string;
  job_state_actual: string;
  job_state_expected: string;
  published: boolean;
  bound: boolean;
  errors: FixtureError[];
  coverage_comparisons: number;
  coverage_matches: number;
  false_covered: number;
  false_excluded: number;
  conflicts_expected: number;
  conflicts_detected: number;
  limits_expected: number;
  limits_matched: number;
  exclusions_expected: number;
  exclusions_found: number;
  forms_expected: number;
  forms_matched: number;
  edition_mismatch_expected: number;
  edition_mismatch_found: number;
  completeness_match: boolean | null;
  citation_document_checked: number;
  citation_document_matched: number;
  citation_page_checked: number;
  citation_page_matched: number;
  unsupported_uncited: number;
  needs_review: boolean;
};

export type AggregateMetrics = {
  coverage_status_accuracy: number | null;
  precision_recall_f1_by_status: StatusConfusion[];
  false_covered_findings: number;
  false_excluded_findings: number;
  conflict_detection_recall: number | null;
  limit_value_accuracy: number | null;
  exclusion_recall: number | null;
  form_presence_accuracy: number | null;
  edition_mismatch_recall: number | null;
  completeness_accuracy: number | null;
  citation_document_accuracy: number | null;
  citation_page_accuracy: number | null;
  unsupported_uncited_material_findings: number;
  needs_review_frequency: number;
  critical_error_count: number;
};

export type GateResult = {
  passed: boolean;
  failures: string[];
};

export type CorpusReport = {
  corpus_version: string;
  analyzer_version: string;
  analyzer_git_sha: string;
  generated_at: string;
  disclaimer: string;
  thresholds: QualityThresholds;
  metrics: AggregateMetrics;
  gate: GateResult;
  fixtures: FixtureEvaluation[];
};

function ratio(num: number, den: number): number | null {
  if (den === 0) return null;
  return num / den;
}

function f1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null) return null;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
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

function statusMatches(expected: GroundTruthFixture["expected"]["coverages"][string], actual: AnalysisStatus | undefined): boolean {
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

export function evaluateFixture(fixture: GroundTruthFixture, actual: ActualRun): FixtureEvaluation {
  const errors: FixtureError[] = [];
  const jobExpected = fixture.job.scenarios?.find((s) => s.id === actual.scenario_id)?.expected_state || fixture.job.expected_state;
  const publishable =
    fixture.job.scenarios?.find((s) => s.id === actual.scenario_id)?.publishable ?? fixture.job.publishable;

  const evaln: FixtureEvaluation = {
    package_id: fixture.package_id,
    title: fixture.title,
    scenario: fixture.scenario,
    scenario_id: actual.scenario_id,
    job_state_actual: actual.job_state,
    job_state_expected: jobExpected,
    published: actual.published,
    bound: actual.bound,
    errors,
    coverage_comparisons: 0,
    coverage_matches: 0,
    false_covered: 0,
    false_excluded: 0,
    conflicts_expected: 0,
    conflicts_detected: 0,
    limits_expected: 0,
    limits_matched: 0,
    exclusions_expected: 0,
    exclusions_found: 0,
    forms_expected: 0,
    forms_matched: 0,
    edition_mismatch_expected: 0,
    edition_mismatch_found: 0,
    completeness_match: null,
    citation_document_checked: 0,
    citation_document_matched: 0,
    citation_page_checked: 0,
    citation_page_matched: 0,
    unsupported_uncited: 0,
    needs_review:
      actual.job_state === "needs_review" ||
      (actual.report?.coverages.some((c) => c.coverage_status === "NEEDS CLARIFICATION") ?? false)
  };

  if (actual.published && (!validJobForPublish(actual.job_state) || !actual.bound)) {
    errors.push({
      code: "PUBLISHED_WITHOUT_BOUND_JOB",
      critical: true,
      message: `Report published with job_state=${actual.job_state} bound=${actual.bound}`
    });
  }
  if (actual.published !== publishable) {
    errors.push({
      code: "PUBLISHABLE_MISMATCH",
      critical: actual.published && !publishable,
      message: `publishable expected ${publishable}, actual published=${actual.published}`
    });
  }
  if (actual.job_state !== jobExpected) {
    errors.push({
      code: "JOB_STATE_MISMATCH",
      critical: false,
      message: `job state expected ${jobExpected}, actual ${actual.job_state}`
    });
  }

  if (fixture.evaluation_scope === "job") {
    return evaln;
  }

  const report = actual.report;
  if (!report) {
    errors.push({
      code: "REPORT_MISSING",
      critical: fixture.evaluation_scope === "analysis",
      message: "No analyzer report was produced for an analysis-scoped fixture."
    });
    return evaln;
  }

  for (const type of SUPPORTED_COVERAGES) {
    const expected = fixture.expected.coverages[type];
    const rec = coverageOf(report, type);
    const actualStatus = rec?.coverage_status;
    evaln.coverage_comparisons += 1;
    if (statusMatches(expected, actualStatus)) evaln.coverage_matches += 1;
    else {
      errors.push({
        code: "COVERAGE_STATUS_MISMATCH",
        critical: false,
        subject: type,
        message: `${type}: expected ${expected.status}, actual ${actualStatus || "missing"}`
      });
    }
    if (DENYING_STATUSES.has(expected.status) && actualStatus && GRANTING_STATUSES.has(actualStatus)) {
      evaln.false_covered += 1;
      errors.push({
        code: "FALSE_COVERED",
        critical: true,
        subject: type,
        message: `${type} is ${expected.status} in ground truth but reported ${actualStatus}`
      });
    }
    if (GRANTING_STATUSES.has(expected.status) && actualStatus === "EXCLUDED") {
      evaln.false_excluded += 1;
      errors.push({
        code: "FALSE_EXCLUDED",
        critical: false,
        subject: type,
        message: `${type} is ${expected.status} in ground truth but reported EXCLUDED`
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
          errors.push({
            code: rec?.source_document_id ? "WRONG_DOCUMENT_CITATION" : "MISSING_REQUIRED_CITATION",
            critical: true,
            subject: type,
            message: `${type} citation document expected ${required.document_id}, actual ${rec?.source_document_id || "(empty)"}`
          });
        }
        if (pageOk) evaln.citation_page_matched += 1;
        else {
          errors.push({
            code: rec?.source_page && rec.source_page > 0 ? "WRONG_PAGE_CITATION" : "MISSING_REQUIRED_CITATION",
            critical: !rec?.source_page || rec.source_page <= 0,
            subject: type,
            message: `${type} citation page expected ${required.page}, actual ${rec?.source_page ?? 0}`
          });
        }
      }
      const uncited =
        !rec ||
        !rec.source_document_id ||
        rec.source_page <= 0 ||
        !rec.source_text ||
        rec.source_text.trim().length === 0;
      if (uncited) {
        evaln.unsupported_uncited += 1;
        errors.push({
          code: "UNSUPPORTED_UNCITED_MATERIAL",
          critical: true,
          subject: type,
          message: `${type} is ${actualStatus || "missing"} without a usable source citation`
        });
      }
    }

    if (expected.limit) {
      evaln.limits_expected += 1;
      const actualLimit = rec?.coverage_limit?.value || rec?.occurrence_limit?.value;
      if (normalizeMoney(actualLimit) === normalizeMoney(expected.limit)) evaln.limits_matched += 1;
      else {
        errors.push({
          code: "LIMIT_MISMATCH",
          critical: false,
          subject: type,
          message: `${type} limit expected ${expected.limit}, actual ${actualLimit || "(none)"}`
        });
      }
    }
    if (expected.deductible) {
      evaln.limits_expected += 1;
      if (normalizeMoney(rec?.deductible?.value) === normalizeMoney(expected.deductible)) evaln.limits_matched += 1;
      else {
        errors.push({
          code: "DEDUCTIBLE_MISMATCH",
          critical: false,
          subject: type,
          message: `${type} deductible expected ${expected.deductible}, actual ${rec?.deductible?.value || "(none)"}`
        });
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
      errors.push({
        code: "LIMIT_MISMATCH",
        critical: false,
        message: `limit ${limit.label_contains}=${limit.amount} not found`
      });
    }
  }

  evaln.conflicts_expected = fixture.expected.conflicts.length;
  if (evaln.conflicts_expected) {
    const found = fixture.expected.conflicts.filter((c) => {
      const hasConflictRow = report.conflicts.length > 0;
      const hasPossible = report.coverages.some((cov) => cov.coverage_status === "POSSIBLE CONFLICT");
      if (!hasConflictRow && !hasPossible) return false;
      if (!c.description_contains) return true;
      const needle = c.description_contains.toLowerCase();
      if (report.conflicts.some((row) => `${row.title} ${row.description}`.toLowerCase().includes(needle))) {
        return true;
      }
      return report.coverages.some(
        (cov) =>
          cov.coverage_status === "POSSIBLE CONFLICT" &&
          (cov.coverage_type.toLowerCase().includes(needle) || needle.includes(cov.coverage_type.toLowerCase()))
      );
    });
    evaln.conflicts_detected = found.length;
    if (found.length < fixture.expected.conflicts.length) {
      errors.push({
        code: "CONFLICT_MISS",
        critical: false,
        message: `detected ${found.length} of ${fixture.expected.conflicts.length} expected conflicts`
      });
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
      errors.push({
        code: "EXCLUSION_MISS",
        critical: false,
        message: `exclusion containing "${excl.condition_contains}" not found`
      });
    }
  }

  for (const req of fixture.expected.requirements) {
    const hit = report.requirements.find((row) =>
      row.requirement.toLowerCase().includes(req.requirement_contains.toLowerCase())
    );
    if (!hit) {
      errors.push({
        code: "REQUIREMENT_MISS",
        critical: false,
        message: `requirement containing "${req.requirement_contains}" not found`
      });
    }
  }

  evaln.forms_expected = fixture.expected.forms.length;
  for (const form of fixture.expected.forms) {
    const rec = formOf(report, form.printed_identifier);
    if (rec?.status === form.status) evaln.forms_matched += 1;
    else {
      errors.push({
        code: "FORM_STATUS_MISMATCH",
        critical: false,
        subject: form.printed_identifier,
        message: `${form.printed_identifier}: expected ${form.status}, actual ${rec?.status || "missing"}`
      });
    }
    if (form.status === "MISSING" && rec?.status === "PRESENT") {
      errors.push({
        code: "ABSENT_FORM_REPORTED_PRESENT",
        critical: true,
        subject: form.printed_identifier,
        message: `Listed form ${form.printed_identifier} is absent but reported PRESENT`
      });
    }
    if (form.status === "EDITION MISMATCH") {
      evaln.edition_mismatch_expected += 1;
      if (rec?.status === "EDITION MISMATCH") evaln.edition_mismatch_found += 1;
      if (rec?.status === "PRESENT") {
        errors.push({
          code: "EDITION_MISMATCH_REPORTED_PRESENT",
          critical: true,
          subject: form.printed_identifier,
          message: `Edition mismatch for ${form.printed_identifier} was reported PRESENT`
        });
      }
    }
  }

  evaln.completeness_match = report.completeness.status === fixture.expected.completeness;
  if (!evaln.completeness_match) {
    errors.push({
      code: "COMPLETENESS_MISMATCH",
      critical: false,
      message: `completeness expected ${fixture.expected.completeness}, actual ${report.completeness.status}`
    });
  }

  const named = report.identification.named_insured?.value || null;
  const policyNo = report.identification.policy_number?.value || null;
  if ((fixture.expected.declarations.named_insured || null) !== (named || null) && fixture.expected.declarations.named_insured !== undefined) {
    if (Boolean(fixture.expected.declarations.named_insured) !== Boolean(named)) {
      errors.push({
        code: "DECLARATIONS_FIELD_MISMATCH",
        critical: false,
        message: `named insured expected ${fixture.expected.declarations.named_insured}, actual ${named}`
      });
    }
  }
  if (Boolean(fixture.expected.declarations.policy_number) !== Boolean(policyNo)) {
    errors.push({
      code: "DECLARATIONS_FIELD_MISMATCH",
      critical: false,
      message: `policy number expected ${fixture.expected.declarations.policy_number}, actual ${policyNo}`
    });
  }

  for (const cite of fixture.expected.citations.required) {
    if (SUPPORTED_COVERAGES.includes(cite.subject as (typeof SUPPORTED_COVERAGES)[number])) continue;
    const rec = report.exclusions.find(
      (row) =>
        cite.subject.toLowerCase().startsWith("exclusion") &&
        `${row.condition || ""} ${row.description}`.toLowerCase().includes(cite.subject.replace(/^exclusion:?\s*/i, "").toLowerCase())
    );
    const docId = rec && "source_document_id" in rec ? rec.source_document_id : undefined;
    const page = rec && "source_page" in rec ? rec.source_page : undefined;
    evaln.citation_document_checked += 1;
    evaln.citation_page_checked += 1;
    if (docId === cite.document_id) evaln.citation_document_matched += 1;
    else {
      errors.push({
        code: docId ? "WRONG_DOCUMENT_CITATION" : "MISSING_REQUIRED_CITATION",
        critical: true,
        subject: cite.subject,
        message: `required citation ${cite.subject} document expected ${cite.document_id}, actual ${docId || "(empty)"}`
      });
    }
    if (page === cite.page) evaln.citation_page_matched += 1;
    else {
      errors.push({
        code: page && page > 0 ? "WRONG_PAGE_CITATION" : "MISSING_REQUIRED_CITATION",
        critical: !page || page <= 0,
        subject: cite.subject,
        message: `required citation ${cite.subject} page expected ${cite.page}, actual ${page ?? 0}`
      });
    }
  }

  return evaln;
}

export function aggregateMetrics(fixtures: FixtureEvaluation[]): AggregateMetrics {
  const sum = (pick: (f: FixtureEvaluation) => number) => fixtures.reduce((n, f) => n + pick(f), 0);
  const completenessCompared = fixtures.filter((f) => f.completeness_match !== null);
  const critical = fixtures.reduce((n, f) => n + f.errors.filter((e) => e.critical).length, 0);
  const needs = fixtures.filter((f) => f.needs_review).length;
  return {
    coverage_status_accuracy: ratio(sum((f) => f.coverage_matches), sum((f) => f.coverage_comparisons)),
    precision_recall_f1_by_status: [],
    false_covered_findings: sum((f) => f.false_covered),
    false_excluded_findings: sum((f) => f.false_excluded),
    conflict_detection_recall: ratio(sum((f) => f.conflicts_detected), sum((f) => f.conflicts_expected)),
    limit_value_accuracy: ratio(sum((f) => f.limits_matched), sum((f) => f.limits_expected)),
    exclusion_recall: ratio(sum((f) => f.exclusions_found), sum((f) => f.exclusions_expected)),
    form_presence_accuracy: ratio(sum((f) => f.forms_matched), sum((f) => f.forms_expected)),
    edition_mismatch_recall: ratio(sum((f) => f.edition_mismatch_found), sum((f) => f.edition_mismatch_expected)),
    completeness_accuracy: ratio(
      completenessCompared.filter((f) => f.completeness_match).length,
      completenessCompared.length
    ),
    citation_document_accuracy: ratio(sum((f) => f.citation_document_matched), sum((f) => f.citation_document_checked)),
    citation_page_accuracy: ratio(sum((f) => f.citation_page_matched), sum((f) => f.citation_page_checked)),
    unsupported_uncited_material_findings: sum((f) => f.unsupported_uncited),
    needs_review_frequency: fixtures.length ? needs / fixtures.length : 0,
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
    const precision = ratio(true_positives, true_positives + false_positives);
    const recall = ratio(true_positives, true_positives + false_negatives);
    return {
      status,
      precision,
      recall,
      f1: f1(precision, recall),
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

function below(metric: number | null, min: number | undefined): boolean {
  if (min === undefined) return false;
  if (metric === null) return false;
  return metric < min;
}

export function applyReleaseGate(metrics: AggregateMetrics, thresholds: QualityThresholds, fixtures: FixtureEvaluation[]): GateResult {
  const failures: string[] = [];
  const criticalCodes = new Set(
    fixtures.flatMap((f) => f.errors.filter((e) => e.critical).map((e) => e.code))
  );
  if (metrics.false_covered_findings > thresholds.false_covered_max) {
    failures.push(
      `false-COVERED findings ${metrics.false_covered_findings} exceed max ${thresholds.false_covered_max}`
    );
  }
  if (criticalCodes.has("PUBLISHED_WITHOUT_BOUND_JOB")) {
    failures.push("a report was published without a valid completed/needs-review job and bound report");
  }
  if (criticalCodes.has("MISSING_REQUIRED_CITATION")) {
    failures.push("a required source citation is missing");
  }
  if (criticalCodes.has("WRONG_DOCUMENT_CITATION")) {
    failures.push("a citation points to the wrong document");
  }
  if (criticalCodes.has("ABSENT_FORM_REPORTED_PRESENT")) {
    failures.push("a listed but absent form was reported PRESENT");
  }
  if (criticalCodes.has("EDITION_MISMATCH_REPORTED_PRESENT")) {
    failures.push("an edition mismatch was reported PRESENT");
  }
  if (below(metrics.coverage_status_accuracy, thresholds.coverage_status_accuracy_min)) {
    failures.push(
      `coverage-status accuracy ${metrics.coverage_status_accuracy?.toFixed(3)} < ${thresholds.coverage_status_accuracy_min}`
    );
  }
  if (metrics.false_excluded_findings > thresholds.false_excluded_max) {
    failures.push(`false-EXCLUDED findings ${metrics.false_excluded_findings} exceed max ${thresholds.false_excluded_max}`);
  }
  if (below(metrics.conflict_detection_recall, thresholds.conflict_detection_recall_min)) {
    failures.push(`conflict-detection recall ${metrics.conflict_detection_recall?.toFixed(3)} < ${thresholds.conflict_detection_recall_min}`);
  }
  if (below(metrics.limit_value_accuracy, thresholds.limit_value_accuracy_min)) {
    failures.push(`limit-value accuracy ${metrics.limit_value_accuracy?.toFixed(3)} < ${thresholds.limit_value_accuracy_min}`);
  }
  if (below(metrics.exclusion_recall, thresholds.exclusion_recall_min)) {
    failures.push(`exclusion recall ${metrics.exclusion_recall?.toFixed(3)} < ${thresholds.exclusion_recall_min}`);
  }
  if (below(metrics.form_presence_accuracy, thresholds.form_presence_accuracy_min)) {
    failures.push(`form-presence accuracy ${metrics.form_presence_accuracy?.toFixed(3)} < ${thresholds.form_presence_accuracy_min}`);
  }
  if (below(metrics.edition_mismatch_recall, thresholds.edition_mismatch_recall_min)) {
    failures.push(`edition-mismatch recall ${metrics.edition_mismatch_recall?.toFixed(3)} < ${thresholds.edition_mismatch_recall_min}`);
  }
  if (below(metrics.completeness_accuracy, thresholds.completeness_accuracy_min)) {
    failures.push(`completeness accuracy ${metrics.completeness_accuracy?.toFixed(3)} < ${thresholds.completeness_accuracy_min}`);
  }
  if (below(metrics.citation_document_accuracy, thresholds.citation_document_accuracy_min)) {
    failures.push(`citation-document accuracy ${metrics.citation_document_accuracy?.toFixed(3)} < ${thresholds.citation_document_accuracy_min}`);
  }
  if (below(metrics.citation_page_accuracy, thresholds.citation_page_accuracy_min)) {
    failures.push(`citation-page accuracy ${metrics.citation_page_accuracy?.toFixed(3)} < ${thresholds.citation_page_accuracy_min}`);
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
    if (below(row.precision, pMin)) failures.push(`${row.status} precision ${row.precision?.toFixed(3)} < ${pMin}`);
    if (below(row.recall, rMin)) failures.push(`${row.status} recall ${row.recall?.toFixed(3)} < ${rMin}`);
    if (below(row.f1, fMin)) failures.push(`${row.status} F1 ${row.f1?.toFixed(3)} < ${fMin}`);
  }
  return { passed: failures.length === 0, failures };
}

export function evaluateCorpus(
  items: Array<{ fixture: GroundTruthFixture; actuals: ActualRun[] }>,
  thresholds: QualityThresholds,
  meta: { corpus_version: string; analyzer_version: string; analyzer_git_sha: string }
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
