import { runQualityHarness } from "../lib/quality/harness";

try {
  runQualityHarness();
} catch (err) {
  console.error(err);
  process.exit(1);
}
