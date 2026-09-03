import assert from "node:assert/strict";
import { MAX_PURGE_BATCH } from "../lib/persistence/constants";
import { MemoryPolicyStore } from "../lib/persistence/memory-store";
import { purgeExpiredAnalyses } from "../lib/persistence/purge";
import { TEST_ACTOR_A } from "../lib/persistence/actor-context";
import { sampleFiles, sampleReport } from "./test-fixtures";

async function main() {
  process.env.POLICY_ANALYZER_STORE = "memory";
  process.env.POLICY_RETENTION_DAYS = "30";

  let current = new Date("2026-01-01T00:00:00Z");
  const store = new MemoryPolicyStore({ now: () => current });
  const created: Array<{ policyId: string; documentId: string }> = [];
  for (let i = 0; i < 5; i += 1) {
    const report = sampleReport();
    await store.savePackage(TEST_ACTOR_A, { files: sampleFiles(report, `ret-${i}`), report });
    created.push({ policyId: report.policy_id, documentId: report.documents[0].document_id });
  }
  assert.ok(await store.getReport(TEST_ACTOR_A, created[0].policyId), "created analyses are visible before expiry");

  current = new Date("2026-03-01T00:00:00Z");
  assert.equal(await store.getReport(TEST_ACTOR_A, created[0].policyId), null, "14: expired analyses are unavailable");
  assert.equal(await store.getOriginal(TEST_ACTOR_A, created[0].policyId, created[0].documentId), null);

  const firstBatch = await store.purgeExpired(2);
  assert.equal(firstBatch.purged, 2, "15: retention batches are bounded by the requested limit");
  const secondBatch = await store.purgeExpired(999);
  assert.ok(secondBatch.purged <= MAX_PURGE_BATCH, "15: purge never exceeds the hard batch cap");
  assert.equal(secondBatch.purged, 3);

  const viaService = await purgeExpiredAnalyses(50);
  assert.equal(viaService.purged, 0, "later purge finds nothing remaining");

  console.log("RETENTION OK", { batchCap: MAX_PURGE_BATCH });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
