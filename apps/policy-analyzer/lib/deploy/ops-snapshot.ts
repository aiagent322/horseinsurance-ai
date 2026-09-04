export const EXPECTED_SCHEMA_VERSION = "20260904010000";

export type OpsFetchError = "timeout" | "rpc_error" | "malformed" | "unavailable";

export type AnalyzerOpsSnapshot = {
  schema_version: string;
  queued_count: number;
  oldest_queued_age_seconds: number;
  processing_count: number;
  expired_lease_count: number;
  failed_count: number;
  last_worker_heartbeat_age_seconds: number | null;
  bucket_exists: boolean;
  bucket_private: boolean;
};

const REQUIRED_KEYS = [
  "schema_version",
  "queued_count",
  "oldest_queued_age_seconds",
  "processing_count",
  "expired_lease_count",
  "failed_count",
  "last_worker_heartbeat_age_seconds",
  "bucket_exists",
  "bucket_private"
] as const;

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value >= 0;
}

/**
 * Strict parser. Unknown extra keys are ignored. Missing or wrong types fail.
 * Never returns raw SQL text or nested objects from the database.
 */
export function parseOpsSnapshot(raw: unknown): AnalyzerOpsSnapshot | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    if (!(key in record)) return null;
  }

  const schema = record.schema_version;
  if (typeof schema !== "string" || !/^\d{14}$/.test(schema)) return null;

  if (!isFiniteInteger(record.queued_count)) return null;
  if (!isFiniteInteger(record.oldest_queued_age_seconds)) return null;
  if (!isFiniteInteger(record.processing_count)) return null;
  if (!isFiniteInteger(record.expired_lease_count)) return null;
  if (!isFiniteInteger(record.failed_count)) return null;
  const queued = record.queued_count;
  const oldest = record.oldest_queued_age_seconds;
  const processing = record.processing_count;
  const expired = record.expired_lease_count;
  const failed = record.failed_count;

  const heartbeat = record.last_worker_heartbeat_age_seconds;
  if (heartbeat !== null && !isFiniteInteger(heartbeat)) return null;

  if (typeof record.bucket_exists !== "boolean") return null;
  if (typeof record.bucket_private !== "boolean") return null;

  return {
    schema_version: schema,
    queued_count: queued,
    oldest_queued_age_seconds: oldest,
    processing_count: processing,
    expired_lease_count: expired,
    failed_count: failed,
    last_worker_heartbeat_age_seconds: heartbeat,
    bucket_exists: record.bucket_exists,
    bucket_private: record.bucket_private
  };
}

export type AlertCondition = { code: string; fired: boolean };

export function workerHeartbeatMaxAgeSeconds(): number {
  const raw = process.env.POLICY_ANALYZER_WORKER_READY_MAX_AGE_MS;
  if (raw && /^\d+$/.test(raw)) return Math.max(1, Math.floor(Number(raw) / 1000));
  return 180;
}

export function queueAgeThresholdSeconds(): number {
  const raw = process.env.POLICY_ANALYZER_QUEUE_AGE_THRESHOLD_MS;
  if (raw && /^\d+$/.test(raw)) return Math.max(1, Math.floor(Number(raw) / 1000));
  return 300;
}

export function alertsFromSnapshot(
  snapshot: AnalyzerOpsSnapshot,
  options: { ready: boolean; queueAgeThresholdSeconds: number; heartbeatStaleSeconds: number; backlogThreshold: number }
): AlertCondition[] {
  const heartbeat = snapshot.last_worker_heartbeat_age_seconds;
  return [
    { code: "readiness_failure", fired: !options.ready },
    { code: "queued_backlog", fired: snapshot.queued_count >= options.backlogThreshold },
    {
      code: "oldest_queued_job_age",
      fired: snapshot.queued_count > 0 && snapshot.oldest_queued_age_seconds > options.queueAgeThresholdSeconds
    },
    { code: "expired_leases", fired: snapshot.expired_lease_count >= 1 },
    { code: "terminal_failures", fired: snapshot.failed_count >= 1 },
    {
      code: "stale_worker_heartbeat",
      fired: heartbeat == null || heartbeat > options.heartbeatStaleSeconds
    }
  ];
}
