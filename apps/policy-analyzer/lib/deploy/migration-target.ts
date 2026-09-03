import { ConfigurationError, deployTier } from "@/lib/persistence/config";

const ACCEPTED_FIX5_MIGRATION = "20260903150000_durable_analysis_jobs.sql";
const ACCEPTED_FIX6_MIGRATION = "20260903200000_worker_completion_outcomes.sql";
export const FIX7_MIGRATION = "20260903220000_fix7_staging_ops.sql";

export const ANALYZER_MIGRATIONS = [
  "20260705022540_phase_1_persistence_schema.sql",
  "20260705145522_phase_1_rls_policies.sql",
  "20260903024500_analyzer_auth_persistence.sql",
  ACCEPTED_FIX5_MIGRATION,
  ACCEPTED_FIX6_MIGRATION,
  FIX7_MIGRATION
] as const;

export type MigrationTargetDecision =
  | { allowed: true; reason: "disposable_local" | "authorized_staging" }
  | { allowed: false; reason: "production_refused" | "remote_refused" | "unknown_database" | "missing_input" };

function isLoopbackUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return /(?:^|[/@])(?:127\.0\.0\.1|localhost)[:/]/.test(value);
  }
}

export function evaluateMigrationTarget(input: {
  databaseUrl?: string;
  disposableMarker?: string;
  allowProductionMigrations?: boolean;
  projectRef?: string;
}): MigrationTargetDecision {
  const url = (input.databaseUrl || "").trim();
  if (!url) return { allowed: false, reason: "missing_input" };
  const tier = deployTier();
  const remoteSupabase = /supabase\.co/i.test(url) || /pooler\.supabase/i.test(url);
  if (tier === "production" && input.allowProductionMigrations !== true) {
    return { allowed: false, reason: "production_refused" };
  }
  if (remoteSupabase && input.allowProductionMigrations !== true) {
    return { allowed: false, reason: "remote_refused" };
  }
  if (isLoopbackUrl(url) && input.disposableMarker === "horseinsurance-fix5-live-stack") {
    return { allowed: true, reason: "disposable_local" };
  }
  if (tier === "staging" && input.projectRef && input.disposableMarker === "isolated-staging") {
    return { allowed: true, reason: "authorized_staging" };
  }
  return { allowed: false, reason: "unknown_database" };
}

export function assertAuthorizedMigrationTarget(input: Parameters<typeof evaluateMigrationTarget>[0]): void {
  const decision = evaluateMigrationTarget(input);
  if (!decision.allowed) {
    throw new ConfigurationError(`Migration target refused: ${decision.reason}.`);
  }
}

export function acceptedHistoryFiles(): string[] {
  return [ACCEPTED_FIX5_MIGRATION, ACCEPTED_FIX6_MIGRATION];
}
