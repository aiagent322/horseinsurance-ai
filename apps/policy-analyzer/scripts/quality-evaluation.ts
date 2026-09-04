import { runQualityEvaluation } from "../lib/quality/run-corpus";

async function main() {
  const { report } = await runQualityEvaluation();
  if (!report.gate.passed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
