import assert from "node:assert/strict";
import { GET as liveGet } from "../app/api/health/live/route";
import { GET as readyGet } from "../app/api/ops/ready/route";
import { GET as alertsGet } from "../app/api/ops/alerts/route";
import { evaluateAlertConditions, evaluateWebReadiness, EXPECTED_SCHEMA_VERSION } from "../lib/deploy/readiness";

async function main(): Promise<void> {
  process.env.POLICY_ANALYZER_STORE = "memory";
  process.env.POLICY_ANALYZER_ENV = "development";
  process.env.POLICY_ANALYZER_OPS_TOKEN = "ops-test-token";

  const live = await liveGet();
  assert.equal(live.status, 200);
  assert.equal(((await live.json()) as { status: string }).status, "live");

  const denied = await readyGet(new Request("http://127.0.0.1:43147/api/ops/ready"));
  assert.equal(denied.status, 404);

  const ready = await readyGet(
    new Request("http://127.0.0.1:43147/api/ops/ready", {
      headers: { authorization: "Bearer ops-test-token" }
    })
  );
  assert.ok(ready.status === 200 || ready.status === 503);
  const body = (await ready.json()) as { schema_version_expected?: string };
  assert.equal(body.schema_version_expected, EXPECTED_SCHEMA_VERSION);

  const mismatch = evaluateWebReadiness({ schemaVersion: "old" });
  assert.equal(mismatch.ready, false);
  assert.ok(mismatch.checks.some((check) => check.code === "migration_mismatch"));

  const down = evaluateWebReadiness({ supabaseReachable: false, storageReachable: false });
  assert.equal(down.ready, false);

  const alerts = evaluateAlertConditions({
    ready: false,
    workerLastSuccessAgeMs: 600_000,
    oldestQueuedAgeMs: 600_000,
    queueAgeThresholdMs: 300_000,
    ocrTimeouts: 3,
    storageFailures: 3,
    attemptsExhausted: 1,
    needsReview: 5,
    completed: 0,
    migrationMismatch: true,
    retentionFailure: true
  });
  assert.ok(alerts.every((item) => item.fired));

  const observed = await alertsGet(
    new Request(
      "http://127.0.0.1:43147/api/ops/alerts?database=down&ocr_timeouts=3&attempts_exhausted=1&queue_age_ms=600000&queue_threshold_ms=300000",
      { headers: { authorization: "Bearer ops-test-token" } }
    )
  );
  assert.equal(observed.status, 200);
  const observedBody = (await observed.json()) as { alerts: Array<{ code: string; fired: boolean }> };
  assert.ok(observedBody.alerts.some((item) => item.code === "readiness_failure" && item.fired));
  assert.ok(observedBody.alerts.some((item) => item.code === "repeated_ocr_timeouts" && item.fired));

  console.log("OPS READINESS OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
