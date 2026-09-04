import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CorpusReport, Fraction } from "./evaluate";
import { reportsDir } from "./git-meta";

function formatFraction(value: Fraction | null | undefined): string {
  if (!value) return "n/a";
  if (value.denominator === 0) return `0/0 (n/a)`;
  return `${value.numerator}/${value.denominator} (${(value.value! * 100).toFixed(1)}%)`;
}

export function formatHumanReport(report: CorpusReport): string {
  const lines: string[] = [];
  lines.push("POLICY ANALYZER QUALITY EVALUATION");
  lines.push("==================================");
  lines.push(report.disclaimer);
  lines.push("");
  lines.push(`Corpus version:         ${report.corpus_version}`);
  lines.push(`Report schema version:  ${report.report_schema_version}`);
  lines.push(`Analyzer version:       ${report.analyzer_version}`);
  lines.push(`Analyzer Git SHA:       ${report.analyzer_git_sha}`);
  lines.push(`Generated at:           ${report.generated_at}`);
  lines.push(`Release gate:           ${report.gate.passed ? "PASS" : "FAIL"}`);
  lines.push("");
  const m = report.metrics;
  lines.push("Aggregate metrics (numerator/denominator)");
  lines.push("-----------------------------------------");
  lines.push(`total fixtures:                 ${m.total_fixtures}`);
  lines.push(`total evaluated findings:       ${m.total_evaluated_findings}`);
  lines.push(`coverage-status accuracy:       ${formatFraction(m.coverage_status_accuracy)}`);
  lines.push(`false-COVERED findings:         ${m.false_covered_findings}`);
  lines.push(`false-EXCLUDED findings:        ${m.false_excluded_findings}`);
  lines.push(`invented coverage findings:     ${m.invented_coverage_findings}`);
  lines.push(`conflict-detection recall:      ${formatFraction(m.conflict_detection_recall)}`);
  lines.push(`limit-value accuracy:           ${formatFraction(m.limit_value_accuracy)}`);
  lines.push(`deductible-value accuracy:      ${formatFraction(m.deductible_value_accuracy)}`);
  lines.push(`exclusion recall:               ${formatFraction(m.exclusion_recall)}`);
  lines.push(`requirement/condition recall:   ${formatFraction(m.requirement_recall)}`);
  lines.push(`form-presence accuracy:         ${formatFraction(m.form_presence_accuracy)}`);
  lines.push(`missing-form recall:            ${formatFraction(m.missing_form_recall)}`);
  lines.push(`edition-mismatch recall:        ${formatFraction(m.edition_mismatch_recall)}`);
  lines.push(`completeness accuracy:          ${formatFraction(m.completeness_accuracy)}`);
  lines.push(`citation-document accuracy:     ${formatFraction(m.citation_document_accuracy)}`);
  lines.push(`citation-page accuracy:         ${formatFraction(m.citation_page_accuracy)}`);
  lines.push(`unsupported material findings:  ${m.unsupported_material_findings}`);
  lines.push(`uncited material findings:      ${m.uncited_material_findings}`);
  lines.push(`NEEDS REVIEW frequency:         ${formatFraction(m.needs_review_frequency)}`);
  lines.push(`critical-error count:           ${m.critical_error_count}`);
  lines.push("");
  lines.push("Precision / recall / F1 by coverage status");
  for (const row of m.precision_recall_f1_by_status) {
    if (row.true_positives + row.false_positives + row.false_negatives === 0) continue;
    lines.push(
      `  ${row.status}: P=${formatFraction(row.precision)} R=${formatFraction(row.recall)} F1=${row.f1 === null ? "n/a" : (row.f1 * 100).toFixed(1) + "%"} (tp=${row.true_positives} fp=${row.false_positives} fn=${row.false_negatives})`
    );
  }
  if (!report.gate.passed) {
    lines.push("");
    lines.push("Release-gate failures");
    for (const failure of report.gate.failures) lines.push(`  - ${failure}`);
  }
  lines.push("");
  lines.push("Fixture-level PASS/FAIL");
  lines.push("-----------------------");
  for (const fx of report.fixtures) {
    lines.push(`[${fx.result}] ${fx.package_id} (${fx.scenario_id}) ${fx.title}`);
    lines.push(`    job expected ${fx.job_state_expected}, actual ${fx.job_state_actual}; published=${fx.published} bound=${fx.bound}`);
    for (const diff of fx.expected_versus_actual) {
      lines.push(`    expected ${diff.subject}=${diff.expected}; actual ${diff.actual}`);
    }
    for (const err of fx.errors) {
      lines.push(`    ${err.critical ? "CRIT" : "info"} ${err.code}: ${err.message}`);
    }
  }
  return lines.join("\n");
}

export function writeJsonReport(report: CorpusReport, filePath?: string): string {
  mkdirSync(reportsDir(), { recursive: true });
  const out = filePath || path.join(reportsDir(), "latest.json");
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  return out;
}
