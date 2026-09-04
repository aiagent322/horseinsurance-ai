import { CORPUS_VERSION, REPORT_SCHEMA_VERSION } from "./schema";
import { evaluateCorpus, type CorpusReport } from "./evaluate";
import { analyzerPackageVersion, gitSha } from "./git-meta";
import { loadCorpus, loadThresholds } from "./load-corpus";
import { runFixture } from "./run-analyzer";
import { formatHumanReport, writeJsonReport } from "./report";

export async function runQualityCorpus(): Promise<CorpusReport> {
  const fixtures = loadCorpus();
  const thresholds = loadThresholds();
  const items = [];
  for (const fixture of fixtures) {
    items.push({ fixture, actuals: await runFixture(fixture) });
  }
  return evaluateCorpus(items, thresholds, {
    corpus_version: CORPUS_VERSION,
    analyzer_version: analyzerPackageVersion(),
    analyzer_git_sha: gitSha(),
    report_schema_version: REPORT_SCHEMA_VERSION
  });
}

export async function runQualityEvaluation(): Promise<{ harnessOk: boolean; report: CorpusReport; jsonPath: string }> {
  const { runQualityHarness } = await import("./harness");
  runQualityHarness();
  const report = await runQualityCorpus();
  const jsonPath = writeJsonReport(report);
  console.log("");
  console.log(formatHumanReport(report));
  console.log("");
  console.log(`JSON report: ${jsonPath}`);
  return { harnessOk: true, report, jsonPath };
}
