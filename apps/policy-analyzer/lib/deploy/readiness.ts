import { analyzerUploadsEnabled, deployTier, isProtectedDeploy } from "@/lib/persistence/config";
import { loadWebEnv } from "./env-contract";
import {
  EXPECTED_SCHEMA_VERSION,
  alertsFromSnapshot,
  queueAgeThresholdSeconds,
  workerHeartbeatMaxAgeSeconds,
  type AlertCondition,
  type AnalyzerOpsSnapshot,
  type OpsFetchError
} from "./ops-snapshot";

export { EXPECTED_SCHEMA_VERSION } from "./ops-snapshot";

export type ReadinessCheck = {
  name: string;
  ok: boolean;
  code: string;
};

export type ReadinessReport = {
  ready: boolean;
  tier: string;
  uploads_enabled: boolean;
  schema_version_expected: string;
  checks: ReadinessCheck[];
};

export type LiveReadinessProbes = {
  snapshot: AnalyzerOpsSnapshot | null;
  fetchError: OpsFetchError | null;
};

function fetchFailureCode(error: OpsFetchError | null, fallback: string): string {
  if (error === "timeout") return "probe_timeout";
  if (error === "rpc_error") return "probe_rpc_error";
  if (error === "malformed") return "probe_malformed";
  if (error === "unavailable") return "probe_unavailable";
  return fallback;
}

export function evaluateWebReadiness(probes: LiveReadinessProbes): ReadinessReport {
  const env = loadWebEnv();
  const expected = EXPECTED_SCHEMA_VERSION;
  const heartbeatLimit = workerHeartbeatMaxAgeSeconds();
  const snapshot = probes.snapshot;
  const fetchError = probes.fetchError;

  const configurationOk =
    env.supabaseUrl.length > 0 && (!isProtectedDeploy() || env.opsTokenConfigured);

  const databaseOk = snapshot != null;
  const schemaOk = snapshot?.schema_version === expected;
  const bucketOk = snapshot?.bucket_exists === true;
  const privateOk = snapshot?.bucket_exists === true && snapshot.bucket_private === true;
  const heartbeatAge = snapshot?.last_worker_heartbeat_age_seconds;
  const heartbeatOk = heartbeatAge != null && heartbeatAge <= heartbeatLimit;
  const uploadsEnabled = env.uploadsEnabled;
  const uploadsOk = !uploadsEnabled || (databaseOk && privateOk);

  const checks: ReadinessCheck[] = [
    {
      name: "configuration",
      ok: configurationOk,
      code: configurationOk ? "configuration_ok" : "configuration_incomplete"
    },
    {
      name: "database",
      ok: databaseOk,
      code: databaseOk ? "database_connected" : fetchFailureCode(fetchError, "database_unavailable")
    },
    {
      name: "schema_version",
      ok: schemaOk,
      code: !snapshot
        ? fetchFailureCode(fetchError, "schema_unavailable")
        : schemaOk
          ? "schema_version_ok"
          : "migration_mismatch"
    },
    {
      name: "private_bucket",
      ok: privateOk,
      code: !snapshot
        ? fetchFailureCode(fetchError, "bucket_unavailable")
        : !bucketOk
          ? "bucket_missing"
          : privateOk
            ? "bucket_private"
            : "bucket_not_private"
    },
    {
      name: "worker_heartbeat",
      ok: heartbeatOk,
      code: !snapshot
        ? fetchFailureCode(fetchError, "heartbeat_unavailable")
        : heartbeatAge == null
          ? "worker_heartbeat_missing"
          : heartbeatOk
            ? "worker_heartbeat_fresh"
            : "worker_heartbeat_stale"
    },
    {
      name: "uploads",
      ok: uploadsOk,
      code: uploadsEnabled ? (uploadsOk ? "uploads_enabled" : "uploads_unsafe") : "uploads_disabled"
    }
  ];

  return {
    ready: checks.every((check) => check.ok),
    tier: deployTier(),
    uploads_enabled: analyzerUploadsEnabled(),
    schema_version_expected: expected,
    checks
  };
}

export function evaluateTrustedAlerts(
  probes: LiveReadinessProbes,
  readiness: ReadinessReport
): AlertCondition[] | null {
  if (!probes.snapshot) return null;
  return alertsFromSnapshot(probes.snapshot, {
    ready: readiness.ready,
    queueAgeThresholdSeconds: queueAgeThresholdSeconds(),
    heartbeatStaleSeconds: workerHeartbeatMaxAgeSeconds(),
    backlogThreshold: 5
  });
}
