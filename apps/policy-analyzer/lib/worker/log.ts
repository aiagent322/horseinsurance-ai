const SAFE_KEYS = new Set([
  "event",
  "worker_id",
  "job_id",
  "analysis_id",
  "policy_id",
  "account_id",
  "attempt",
  "stage",
  "outcome",
  "duration_ms",
  "error_code",
  "retryable",
  "claimed",
  "completed",
  "needs_review",
  "failed",
  "retried",
  "cancelled",
  "exit_code",
  "concurrency",
  "poll_ms",
  "batch",
  "active"
]);

export type OperationalLog = {
  event: string;
  worker_id?: string;
  job_id?: string;
  analysis_id?: string;
  policy_id?: string;
  account_id?: string;
  attempt?: number;
  stage?: string;
  outcome?: string;
  duration_ms?: number;
  error_code?: string;
  retryable?: boolean;
  claimed?: number;
  completed?: number;
  needs_review?: number;
  failed?: number;
  retried?: number;
  cancelled?: number;
  exit_code?: number;
  concurrency?: number;
  poll_ms?: number;
  batch?: number;
  active?: number;
};

export function operationalLog(record: OperationalLog): void {
  const safe: Record<string, unknown> = { ts: new Date().toISOString() };
  for (const [key, value] of Object.entries(record)) {
    if (!SAFE_KEYS.has(key) || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    }
  }
  console.log(JSON.stringify(safe));
}
