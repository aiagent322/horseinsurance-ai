import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CorpusReport } from "./evaluate";
import { reportsDir } from "./git-meta";

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatHumanReport(report: CorpusReport): string {
  const lines: string[] = [];
  lines.push("POLICY ANALYZER QUALITY EVALUATION");
  lines.push("==================================");
  lines.push(report.disclaimer);
  lines.push("");
  lines.push(`Corpus version:    ${report.corpus_version}`);
  lines.push(`Analyzer version:  ${report.analyzer_version}`);
  lines.push(`Analyzer Git SHA:  ${report.analyzer_git_sha}`);
  lines.push(`Generated at:      ${report.generated_at}`);
  lines.push(`Release gate:      ${report.gate.passed ? "PASS" : "FAIL"}`);
  lines.push("");
  lines.push("Aggregate metrics");
  lines.push("-----------------");
  const m = report.metrics;
  lines.push(`coverage-status accuracy:     ${pct(m.coverage_status_accuracy)}`);
  lines.push(`false-COVERED findings:       ${m.false_covered_findings}`);
  lines.push(`false-EXCLUDED findings:      ${m.false_excluded_findings}`);
  lines.push(`conflict-detection recall:    ${pct(m.conflict_detection_recall)}`);
  lines.push(`limit-value accuracy:         ${pct(m.limit_value_accuracy)}`);
  lines.push(`exclusion recall:             ${pct(m.exclusion_recall)}`);
  lines.push(`form-presence accuracy:       ${pct(m.form_presence_accuracy)}`);
  lines.push(`edition-mismatch recall:      ${pct(m.edition_mismatch_recall)}`);
  lines.push(`completeness accuracy:        ${pct(m.completeness_accuracy)}`);
  lines.push(`citation-document accuracy:   ${pct(m.citation_document_accuracy)}`);
  lines.push(`citation-page accuracy:       ${pct(m.citation_page_accuracy)}`);
  lines.push(`unsupported/uncited findings: ${m.unsupported_uncited_material_findings}`);
  lines.push(`NEEDS REVIEW frequency:       ${pct(m.needs_review_frequency)}`);
  lines.push(`critical-error count:         ${m.critical_error_count}`);
  lines.push("");
  lines.push("Precision / recall / F1 by coverage status");
  for (const row of m.precision_recall_f1_by_status) {
    if (row.true_positives + row.false_positives + row.false_negatives === 0) continue;
    lines.push(
      `  ${row.status}: P=${pct(row.precision)} R=${pct(row.recall)} F1=${pct(row.f1)} (tp=${row.true_positives} fp=${row.false_positives} fn=${row.false_negatives})`
    );
  }
  if (!report.gate.passed) {
    lines.push("");
    lines.push("Release-gate failures");
    for (const failure of report.gate.failures) lines.push(`  - ${failure}`);
  }
  lines.push("");
  lines.push("Fixture details");
  lines.push("---------------");
  for (const fx of report.fixtures) {
    const critical = fx.errors.filter((e) => e.critical).length;
    const mark = fx.errors.some((e) => e.critical) ? "CRITICAL" : fx.errors.length ? "DIFF" : "OK";
    lines.push(
      `[${mark}] ${fx.package_id} (${fx.scenario_id}) ${fx.title} — job ${fx.job_state_actual}, errors ${fx.errors.length} (${critical} critical)`
    );
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
