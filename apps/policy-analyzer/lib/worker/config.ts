import { randomUUID } from "node:crypto";
import { ConfigurationError, isProduction, isProtectedDeploy } from "@/lib/persistence/config";
import { usesMemoryStore } from "@/lib/persistence/factory";
import { requireWorkerSupabaseConfig } from "@/lib/persistence/service-client";

export type WorkerConfig = {
  workerId: string;
  concurrency: number;
  claimLimit: number;
  pollMs: number;
  backoffMaxMs: number;
  shutdownMs: number;
  heartbeatMs: number;
  leaseMs: number;
};

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new ConfigurationError(`Invalid ${name}.`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new ConfigurationError(`Invalid ${name}.`);
  }
  return value;
}

export function loadWorkerConfig(): WorkerConfig {
  if ((isProtectedDeploy() || isProduction()) && usesMemoryStore()) {
    throw new ConfigurationError("Memory store is not allowed in staging or production.");
  }
  if (!usesMemoryStore()) {
    requireWorkerSupabaseConfig();
  }

  const leaseMs = intEnv("POLICY_ANALYZER_JOB_LEASE_MS", 120_000, 5_000, 3_600_000);
  const heartbeatMs = intEnv("POLICY_ANALYZER_WORKER_HEARTBEAT_MS", 30_000, 250, 600_000);
  if (heartbeatMs * 2 >= leaseMs) {
    throw new ConfigurationError("Heartbeat interval must be safely shorter than the job lease.");
  }

  const workerId = (process.env.POLICY_ANALYZER_WORKER_ID || "").trim() || `worker-${randomUUID()}`;
  return {
    workerId,
    concurrency: intEnv("POLICY_ANALYZER_WORKER_CONCURRENCY", 1, 1, 8),
    claimLimit: intEnv("POLICY_ANALYZER_WORKER_CLAIM_LIMIT", 1, 1, 20),
    pollMs: intEnv("POLICY_ANALYZER_WORKER_POLL_MS", 1_000, 50, 60_000),
    backoffMaxMs: intEnv("POLICY_ANALYZER_WORKER_BACKOFF_MAX_MS", 15_000, 100, 120_000),
    shutdownMs: intEnv("POLICY_ANALYZER_WORKER_SHUTDOWN_MS", 20_000, 100, 120_000),
    heartbeatMs,
    leaseMs
  };
}
