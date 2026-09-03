import {
  ConfigurationError,
  analyzerUploadsEnabled,
  deployTier,
  isProtectedDeploy,
  requireSupabaseConfig,
  serviceRoleKey,
  supabaseUrl
} from "@/lib/persistence/config";
import { usesMemoryStore } from "@/lib/persistence/factory";

export type ProcessRole = "web" | "worker";

const PUBLIC_PREFIX = "NEXT_PUBLIC_";

function requireNonEmpty(name: string, value: string | undefined): string {
  const trimmed = (value || "").trim();
  if (!trimmed) throw new ConfigurationError(`${name} is required.`);
  return trimmed;
}

function parseInteger(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new ConfigurationError(`Invalid ${name}.`);
  const value = Number(raw);
  if (value < min || value > max) throw new ConfigurationError(`Invalid ${name}.`);
  return value;
}

function assertHttpUrl(name: string, value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError(`Invalid ${name}.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigurationError(`Invalid ${name}.`);
  }
}

function rejectPublicServiceRole(): void {
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(PUBLIC_PREFIX)) continue;
    if (/SERVICE_ROLE/i.test(key)) {
      throw new ConfigurationError("Service-role credentials must not be exposed through NEXT_PUBLIC_ variables.");
    }
    const service = serviceRoleKey();
    if (service && value && value === service) {
      throw new ConfigurationError("Service-role credentials must not be assigned to public variables.");
    }
  }
}

export function assertMemoryStoreAllowed(): void {
  if (usesMemoryStore() && isProtectedDeploy()) {
    throw new ConfigurationError("Memory store is not allowed in staging or production.");
  }
}

export type WebEnv = {
  role: "web";
  tier: ReturnType<typeof deployTier>;
  supabaseUrl: string;
  uploadsEnabled: boolean;
  retentionDays: number;
  opsTokenConfigured: boolean;
};

export type WorkerEnv = {
  role: "worker";
  tier: ReturnType<typeof deployTier>;
  supabaseUrl: string;
  workerId: string;
  concurrency: number;
  claimLimit: number;
  shutdownMs: number;
  ocrTimeoutMs: number;
};

export function loadWebEnv(): WebEnv {
  rejectPublicServiceRole();
  assertMemoryStoreAllowed();
  if (usesMemoryStore() && !isProtectedDeploy()) {
    return {
      role: "web",
      tier: deployTier(),
      supabaseUrl: "memory",
      uploadsEnabled: analyzerUploadsEnabled(),
      retentionDays: Number(process.env.POLICY_RETENTION_DAYS || 30),
      opsTokenConfigured: Boolean((process.env.POLICY_ANALYZER_OPS_TOKEN || "").trim())
    };
  }
  const { url } = requireSupabaseConfig();
  assertHttpUrl("NEXT_PUBLIC_SUPABASE_URL", url);
  if (isProtectedDeploy()) {
    requireNonEmpty("POLICY_RETENTION_DAYS", process.env.POLICY_RETENTION_DAYS);
  }
  return {
    role: "web",
    tier: deployTier(),
    supabaseUrl: url,
    uploadsEnabled: analyzerUploadsEnabled(),
    retentionDays: Number(process.env.POLICY_RETENTION_DAYS || 30),
    opsTokenConfigured: Boolean((process.env.POLICY_ANALYZER_OPS_TOKEN || "").trim())
  };
}

export function loadWorkerEnv(): WorkerEnv {
  rejectPublicServiceRole();
  assertMemoryStoreAllowed();
  if (usesMemoryStore()) {
    if (isProtectedDeploy()) {
      throw new ConfigurationError("Memory store is not allowed in staging or production.");
    }
  } else {
    const url = requireNonEmpty("SUPABASE_URL", supabaseUrl());
    assertHttpUrl("SUPABASE_URL", url);
    requireNonEmpty("SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey());
  }
  return {
    role: "worker",
    tier: deployTier(),
    supabaseUrl: supabaseUrl() || "memory",
    workerId: (process.env.POLICY_ANALYZER_WORKER_ID || "worker").trim(),
    concurrency: parseInteger("POLICY_ANALYZER_WORKER_CONCURRENCY", process.env.POLICY_ANALYZER_WORKER_CONCURRENCY, 1, 1, 8),
    claimLimit: parseInteger("POLICY_ANALYZER_WORKER_CLAIM_LIMIT", process.env.POLICY_ANALYZER_WORKER_CLAIM_LIMIT, 1, 1, 20),
    shutdownMs: parseInteger("POLICY_ANALYZER_WORKER_SHUTDOWN_MS", process.env.POLICY_ANALYZER_WORKER_SHUTDOWN_MS, 20_000, 100, 120_000),
    ocrTimeoutMs: parseInteger("POLICY_ANALYZER_OCR_TIMEOUT_MS", process.env.POLICY_ANALYZER_OCR_TIMEOUT_MS, 60_000, 1_000, 600_000)
  };
}

export function loadProcessEnv(role: ProcessRole): WebEnv | WorkerEnv {
  return role === "worker" ? loadWorkerEnv() : loadWebEnv();
}
