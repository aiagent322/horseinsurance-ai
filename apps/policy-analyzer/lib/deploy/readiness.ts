import { analyzerUploadsEnabled, deployTier, supabaseConfigured, supabaseUrl } from "@/lib/persistence/config";
import { loadWebEnv } from "./env-contract";

export const EXPECTED_SCHEMA_VERSION = "20260903220000";

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

function loopbackOrConfigured(url: string | undefined): ReadinessCheck {
  if (!url) {
    return { name: "database", ok: false, code: "database_unconfigured" };
  }
  try {
    const parsed = new URL(url);
    const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    return {
      name: "database",
      ok: parsed.protocol === "http:" || parsed.protocol === "https:",
      code: local ? "database_local" : "database_configured"
    };
  } catch {
    return { name: "database", ok: false, code: "database_invalid_url" };
  }
}

export function evaluateWebReadiness(input: {
  supabaseReachable?: boolean;
  storageReachable?: boolean;
  schemaVersion?: string | null;
  bucketPrivate?: boolean | null;
  workerConfigured?: boolean;
}): ReadinessReport {
  const env = loadWebEnv();
  const checks: ReadinessCheck[] = [
    loopbackOrConfigured(supabaseUrl() || (env.supabaseUrl === "memory" ? undefined : env.supabaseUrl)),
    {
      name: "auth",
      ok: supabaseConfigured() || env.supabaseUrl === "memory",
      code: supabaseConfigured() || env.supabaseUrl === "memory" ? "auth_configured" : "auth_unconfigured"
    },
    {
      name: "storage",
      ok: input.storageReachable !== false && (supabaseConfigured() || env.supabaseUrl === "memory"),
      code: input.storageReachable === false ? "storage_unavailable" : "storage_configured"
    },
    {
      name: "schema_version",
      ok: !input.schemaVersion || input.schemaVersion === EXPECTED_SCHEMA_VERSION,
      code:
        input.schemaVersion && input.schemaVersion !== EXPECTED_SCHEMA_VERSION
          ? "migration_mismatch"
          : "schema_version_ok"
    },
    {
      name: "private_bucket",
      ok: input.bucketPrivate !== false,
      code: input.bucketPrivate === false ? "bucket_not_private" : "bucket_private"
    },
    {
      name: "uploads",
      ok: !env.uploadsEnabled || (input.supabaseReachable !== false && input.storageReachable !== false),
      code: analyzerUploadsEnabled() ? "uploads_enabled" : "uploads_disabled"
    }
  ];
  if (input.supabaseReachable === false) {
    checks[0] = { name: "database", ok: false, code: "database_unavailable" };
    checks[1] = { name: "auth", ok: false, code: "auth_unavailable" };
  }
  return {
    ready: checks.every((check) => check.ok),
    tier: deployTier(),
    uploads_enabled: env.uploadsEnabled,
    schema_version_expected: EXPECTED_SCHEMA_VERSION,
    checks
  };
}

export function evaluateAlertConditions(input: {
  ready: boolean;
  workerLastSuccessAgeMs?: number;
  oldestQueuedAgeMs?: number;
  queueAgeThresholdMs: number;
  ocrTimeouts: number;
  storageFailures: number;
  attemptsExhausted: number;
  needsReview: number;
  completed: number;
  migrationMismatch: boolean;
  retentionFailure: boolean;
}): Array<{ code: string; fired: boolean }> {
  const completed = Math.max(input.completed, 0);
  const reviewRate = completed + input.needsReview === 0 ? 0 : input.needsReview / (completed + input.needsReview);
  return [
    { code: "readiness_failure", fired: !input.ready },
    {
      code: "worker_not_processing",
      fired: input.workerLastSuccessAgeMs != null && input.workerLastSuccessAgeMs > input.queueAgeThresholdMs
    },
    {
      code: "queue_age_above_threshold",
      fired: input.oldestQueuedAgeMs != null && input.oldestQueuedAgeMs > input.queueAgeThresholdMs
    },
    { code: "repeated_ocr_timeouts", fired: input.ocrTimeouts >= 3 },
    { code: "repeated_storage_failures", fired: input.storageFailures >= 3 },
    { code: "attempts_exhausted", fired: input.attemptsExhausted >= 1 },
    { code: "abnormal_needs_review_rate", fired: completed + input.needsReview >= 5 && reviewRate > 0.8 },
    { code: "migration_mismatch", fired: input.migrationMismatch },
    { code: "retention_cleanup_failure", fired: input.retentionFailure }
  ];
}
