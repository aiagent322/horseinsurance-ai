import assert from "node:assert/strict";
import { GET as liveGet } from "../app/api/health/live/route";
import { GET as readyGet } from "../app/api/ops/ready/route";
import { GET as alertsGet } from "../app/api/ops/alerts/route";
import { setOpsFetcherForTests } from "../lib/deploy/ops-probes";
import { parseOpsSnapshot, type AnalyzerOpsSnapshot } from "../lib/deploy/ops-snapshot";
import { evaluateTrustedAlerts, evaluateWebReadiness, EXPECTED_SCHEMA_VERSION } from "../lib/deploy/readiness";

function validSnapshot(overrides: Partial<AnalyzerOpsSnapshot> = {}): AnalyzerOpsSnapshot {
  return {
    schema_version: EXPECTED_SCHEMA_VERSION,
    queued_count: 0,
    oldest_queued_age_seconds: 0,
    processing_count: 1,
    expired_lease_count: 0,
    failed_count: 0,
    last_worker_heartbeat_age_seconds: 12,
    bucket_exists: true,
    bucket_private: true,
    ...overrides
  };
}

async function main(): Promise<void> {
  process.env.POLICY_ANALYZER_STORE = "memory";
  process.env.POLICY_ANALYZER_ENV = "development";
  process.env.POLICY_ANALYZER_OPS_TOKEN = "ops-test-token";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  setOpsFetcherForTests(null);

  const live = await liveGet();
  assert.equal(live.status, 200);
  assert.equal(((await live.json()) as { status: string }).status, "live");

  const denied = await readyGet(new Request("http://127.0.0.1:43147/api/ops/ready"));
  assert.equal(denied.status, 404);

  const deniedAlerts = await alertsGet(new Request("http://127.0.0.1:43147/api/ops/alerts"));
  assert.equal(deniedAlerts.status, 404);

  const unprobed = await readyGet(
    new Request("http://127.0.0.1:43147/api/ops/ready", {
      headers: { authorization: "Bearer ops-test-token" }
    })
  );
  assert.equal(unprobed.status, 503);
  const unprobedBody = (await unprobed.json()) as { ready?: boolean; checks?: Array<{ name: string; ok: boolean; code: string }> };
  assert.equal(unprobedBody.ready, false);
  assert.ok(unprobedBody.checks?.some((check) => check.name === "database" && check.ok === false));

  const queryIgnoredUnavailable = await alertsGet(
    new Request(
      "http://127.0.0.1:43147/api/ops/alerts?queued_count=99&failed_count=12&worker_idle_ms=1&ocr_timeouts=3",
      { headers: { authorization: "Bearer ops-test-token" } }
    )
  );
  assert.equal(queryIgnoredUnavailable.status, 503);
  assert.deepEqual(await queryIgnoredUnavailable.json(), { error: "ops_unavailable" });

  const healthy = validSnapshot();
  assert.ok(parseOpsSnapshot(healthy));
  assert.equal(parseOpsSnapshot({ ...healthy, schema_version: "nope" }), null);
  assert.equal(parseOpsSnapshot({ ...healthy, queued_count: -1 }), null);
  assert.equal(parseOpsSnapshot({ ...healthy, bucket_private: "yes" }), null);
  assert.equal(parseOpsSnapshot({ schema_version: EXPECTED_SCHEMA_VERSION }), null);
  assert.equal(parseOpsSnapshot("not-json"), null);
  assert.equal(parseOpsSnapshot(null), null);

  const ready = evaluateWebReadiness({ snapshot: healthy, fetchError: null });
  assert.equal(ready.ready, true);
  assert.equal(ready.schema_version_expected, EXPECTED_SCHEMA_VERSION);

  const omitted = evaluateWebReadiness({ snapshot: null, fetchError: "unavailable" });
  assert.equal(omitted.ready, false);
  assert.ok(omitted.checks.every((check) => check.name === "configuration" || check.name === "uploads" || !check.ok));
  assert.ok(omitted.checks.some((check) => check.name === "schema_version" && check.ok === false));
  assert.ok(omitted.checks.some((check) => check.name === "private_bucket" && check.ok === false));
  assert.ok(omitted.checks.some((check) => check.name === "worker_heartbeat" && check.ok === false));

  const timeout = evaluateWebReadiness({ snapshot: null, fetchError: "timeout" });
  assert.equal(timeout.ready, false);
  assert.ok(timeout.checks.some((check) => check.code === "probe_timeout"));

  const malformed = evaluateWebReadiness({ snapshot: null, fetchError: "malformed" });
  assert.ok(malformed.checks.some((check) => check.code === "probe_malformed"));

  const mismatch = evaluateWebReadiness({
    snapshot: validSnapshot({ schema_version: "20260903220000" }),
    fetchError: null
  });
  assert.equal(mismatch.ready, false);
  assert.ok(mismatch.checks.some((check) => check.code === "migration_mismatch"));

  const publicBucket = evaluateWebReadiness({
    snapshot: validSnapshot({ bucket_private: false }),
    fetchError: null
  });
  assert.equal(publicBucket.ready, false);
  assert.ok(publicBucket.checks.some((check) => check.code === "bucket_not_private"));

  const missingBucket = evaluateWebReadiness({
    snapshot: validSnapshot({ bucket_exists: false, bucket_private: false }),
    fetchError: null
  });
  assert.ok(missingBucket.checks.some((check) => check.code === "bucket_missing"));

  const missingHeartbeat = evaluateWebReadiness({
    snapshot: validSnapshot({ last_worker_heartbeat_age_seconds: null }),
    fetchError: null
  });
  assert.equal(missingHeartbeat.ready, false);
  assert.ok(missingHeartbeat.checks.some((check) => check.code === "worker_heartbeat_missing"));

  const staleHeartbeat = evaluateWebReadiness({
    snapshot: validSnapshot({ last_worker_heartbeat_age_seconds: 10_000 }),
    fetchError: null
  });
  assert.ok(staleHeartbeat.checks.some((check) => check.code === "worker_heartbeat_stale"));

  const firing = evaluateTrustedAlerts(
    {
      snapshot: validSnapshot({
        queued_count: 8,
        oldest_queued_age_seconds: 900,
        expired_lease_count: 2,
        failed_count: 3,
        last_worker_heartbeat_age_seconds: null
      }),
      fetchError: null
    },
    { ...ready, ready: false }
  );
  assert.ok(firing);
  assert.ok(firing.every((item) => item.fired));

  const quiet = evaluateTrustedAlerts({ snapshot: healthy, fetchError: null }, ready);
  assert.ok(quiet);
  assert.ok(quiet.every((item) => item.code === "readiness_failure" || !item.fired));

  setOpsFetcherForTests(async () => ({ ok: true, snapshot: healthy }));
  const liveReady = await readyGet(
    new Request("http://127.0.0.1:43147/api/ops/ready?schema_version=old&database=down", {
      headers: { authorization: "Bearer ops-test-token" }
    })
  );
  assert.equal(liveReady.status, 200);
  const liveReadyBody = (await liveReady.json()) as { ready: boolean; checks: Array<{ code: string }> };
  assert.equal(liveReadyBody.ready, true);
  assert.ok(!liveReadyBody.checks.some((check) => check.code === "migration_mismatch"));

  const adversarialAlerts = await alertsGet(
    new Request(
      "http://127.0.0.1:43147/api/ops/alerts?failed_count=99&queued_count=99&queue_age_ms=999999&worker_idle_ms=999999",
      { headers: { authorization: "Bearer ops-test-token" } }
    )
  );
  assert.equal(adversarialAlerts.status, 200);
  const adversarialBody = (await adversarialAlerts.json()) as { alerts: Array<{ code: string; fired: boolean }> };
  assert.ok(adversarialBody.alerts.some((item) => item.code === "queued_backlog" && !item.fired));
  assert.ok(adversarialBody.alerts.some((item) => item.code === "terminal_failures" && !item.fired));
  assert.ok(!JSON.stringify(adversarialBody).includes("policy"));
  assert.ok(!JSON.stringify(adversarialBody).includes("filename"));

  setOpsFetcherForTests(async () => ({ ok: false, error: "malformed" }));
  const malformedAlerts = await alertsGet(
    new Request("http://127.0.0.1:43147/api/ops/alerts", {
      headers: { authorization: "Bearer ops-test-token" }
    })
  );
  assert.equal(malformedAlerts.status, 503);
  assert.deepEqual(await malformedAlerts.json(), { error: "ops_unavailable" });

  setOpsFetcherForTests(null);
  console.log("OPS READINESS OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
