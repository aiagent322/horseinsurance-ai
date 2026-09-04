import { ConfigurationError, deployTier } from "@/lib/persistence/config";

const ACCEPTED_FIX5_MIGRATION = "20260903150000_durable_analysis_jobs.sql";
const ACCEPTED_FIX6_MIGRATION = "20260903200000_worker_completion_outcomes.sql";
export const FIX7_MIGRATION = "20260903220000_fix7_staging_ops.sql";
export const FIX7_TRUSTED_OPS_MIGRATION = "20260904010000_fix7_trusted_ops_snapshot.sql";

export const ANALYZER_MIGRATIONS = [
  "20260705022540_phase_1_persistence_schema.sql",
  "20260705145522_phase_1_rls_policies.sql",
  "20260903024500_analyzer_auth_persistence.sql",
  ACCEPTED_FIX5_MIGRATION,
  ACCEPTED_FIX6_MIGRATION,
  FIX7_MIGRATION,
  FIX7_TRUSTED_OPS_MIGRATION
] as const;

export type MigrationTargetDecision =
  | { allowed: true; reason: "disposable_local" | "authorized_staging" | "authorized_production" }
  | {
      allowed: false;
      reason:
        | "production_refused"
        | "staging_refused"
        | "remote_refused"
        | "unknown_database"
        | "missing_input"
        | "malformed_target";
    };

const PROJECT_HOST = /^([a-z0-9]{20})\.supabase\.co$/i;
const DB_PROJECT_HOST = /^db\.([a-z0-9]{20})\.supabase\.co$/i;
const POOLER_PROJECT_HOST = /^db\.([a-z0-9]{20})\.pooler\.supabase\.com$/i;
const PROJECT_REF = /^[a-z0-9]{20}$/i;

export type MigrationAuthInput = {
  databaseUrl?: string;
  disposableMarker?: string;
  allowStagingMigrations?: boolean;
  allowProductionMigrations?: boolean;
  stagingProjectRefs?: string[];
  stagingHosts?: string[];
  productionProjectRefs?: string[];
  productionHosts?: string[];
};

function splitCsv(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function migrationAuthFromEnv(): MigrationAuthInput {
  return {
    allowStagingMigrations: process.env.POLICY_ANALYZER_ALLOW_STAGING_MIGRATIONS === "YES",
    allowProductionMigrations: process.env.POLICY_ANALYZER_ALLOW_PRODUCTION_MIGRATIONS === "YES",
    stagingProjectRefs: splitCsv(process.env.POLICY_ANALYZER_STAGING_PROJECT_REF),
    stagingHosts: splitCsv(process.env.POLICY_ANALYZER_STAGING_DB_HOSTS),
    productionProjectRefs: splitCsv(process.env.POLICY_ANALYZER_PRODUCTION_PROJECT_REF),
    productionHosts: splitCsv(process.env.POLICY_ANALYZER_PRODUCTION_DB_HOSTS)
  };
}

function looksRemoteSupabaseHost(host: string): boolean {
  return host === "supabase.co" || host.endsWith(".supabase.co") || host.includes("pooler.supabase");
}

function extractProjectRef(host: string): string | null {
  const direct = host.match(PROJECT_HOST);
  if (direct) return direct[1].toLowerCase();
  const db = host.match(DB_PROJECT_HOST);
  if (db) return db[1].toLowerCase();
  const pooler = host.match(POOLER_PROJECT_HOST);
  if (pooler) return pooler[1].toLowerCase();
  return null;
}

/**
 * Parse hostname only. Never return userinfo, passwords, or the raw URL.
 */
export function parseDatabaseHostname(databaseUrl: string): string | null {
  const trimmed = databaseUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const host = (parsed.hostname || "").toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function normalizeAllowlist(values: string[] | undefined): Set<string> {
  return new Set((values || []).map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function matchesAllowlist(host: string, refs: Set<string>, hosts: Set<string>): boolean {
  if (hosts.has(host)) return true;
  const extracted = extractProjectRef(host);
  return extracted != null && refs.has(extracted) && PROJECT_REF.test(extracted);
}

export function evaluateMigrationTarget(input: MigrationAuthInput = {}): MigrationTargetDecision {
  const auth = {
    ...migrationAuthFromEnv(),
    ...input,
    stagingProjectRefs: input.stagingProjectRefs ?? migrationAuthFromEnv().stagingProjectRefs,
    stagingHosts: input.stagingHosts ?? migrationAuthFromEnv().stagingHosts,
    productionProjectRefs: input.productionProjectRefs ?? migrationAuthFromEnv().productionProjectRefs,
    productionHosts: input.productionHosts ?? migrationAuthFromEnv().productionHosts
  };
  const url = (auth.databaseUrl || "").trim();
  if (!url) return { allowed: false, reason: "missing_input" };

  const host = parseDatabaseHostname(url);
  if (!host) return { allowed: false, reason: "malformed_target" };

  const stagingRefs = normalizeAllowlist(auth.stagingProjectRefs);
  const stagingHosts = normalizeAllowlist(auth.stagingHosts);
  const productionRefs = normalizeAllowlist(auth.productionProjectRefs);
  const productionHosts = normalizeAllowlist(auth.productionHosts);

  const isLocalDisposable = isLoopbackHost(host) && auth.disposableMarker === "horseinsurance-fix5-live-stack";
  if (isLocalDisposable) {
    if (deployTier() === "production" && auth.allowProductionMigrations !== true) {
      return { allowed: false, reason: "production_refused" };
    }
    return { allowed: true, reason: "disposable_local" };
  }

  const isProductionTarget = matchesAllowlist(host, productionRefs, productionHosts);
  const isStagingTarget = matchesAllowlist(host, stagingRefs, stagingHosts);

  if (isProductionTarget && isStagingTarget) {
    return { allowed: false, reason: "unknown_database" };
  }

  if (isProductionTarget) {
    if (auth.allowProductionMigrations === true) {
      return { allowed: true, reason: "authorized_production" };
    }
    return { allowed: false, reason: "production_refused" };
  }

  if (isStagingTarget) {
    if (auth.allowStagingMigrations === true) {
      return { allowed: true, reason: "authorized_staging" };
    }
    return { allowed: false, reason: "staging_refused" };
  }

  if (looksRemoteSupabaseHost(host)) {
    return { allowed: false, reason: "remote_refused" };
  }

  return { allowed: false, reason: "unknown_database" };
}

export function assertAuthorizedMigrationTarget(input: MigrationAuthInput): void {
  const decision = evaluateMigrationTarget(input);
  if (!decision.allowed) {
    throw new ConfigurationError(`Migration target refused: ${decision.reason}.`);
  }
}

export function acceptedHistoryFiles(): string[] {
  return [ACCEPTED_FIX5_MIGRATION, ACCEPTED_FIX6_MIGRATION];
}
