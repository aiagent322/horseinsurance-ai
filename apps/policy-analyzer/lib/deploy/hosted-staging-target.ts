import {
  evaluateMigrationTarget,
  migrationAuthFromEnv,
  parseDatabaseHostname,
  type MigrationAuthInput
} from "./migration-target";

export type HostedStagingReason =
  | "authorized_hosted_staging"
  | "missing_input"
  | "malformed_target"
  | "production_flag_set"
  | "production_refused"
  | "disposable_refused"
  | "staging_refused"
  | "remote_refused"
  | "ambiguous_target"
  | "wrong_tier";

export type HostedStagingDecision =
  | { allowed: true; reason: "authorized_hosted_staging"; hostname: string }
  | { allowed: false; reason: Exclude<HostedStagingReason, "authorized_hosted_staging"> };

export type HostedStagingInput = MigrationAuthInput & {
  supabaseUrl?: string;
  deployTier?: string;
};

function productionFlagSet(input: HostedStagingInput): boolean {
  if (input.allowProductionMigrations === true) return true;
  return process.env.POLICY_ANALYZER_ALLOW_PRODUCTION_MIGRATIONS === "YES";
}

/**
 * Hosted staging migrate/apply gate.
 * Disposable loopback and production are refused. Ambiguous identity fails closed.
 * Decisions never include the raw URL (it may contain userinfo).
 */
export function evaluateHostedStagingTarget(input: HostedStagingInput = {}): HostedStagingDecision {
  if (productionFlagSet(input)) {
    return { allowed: false, reason: "production_flag_set" };
  }

  const tier = (input.deployTier || process.env.POLICY_ANALYZER_ENV || "").trim().toLowerCase();
  if (tier === "production") {
    return { allowed: false, reason: "wrong_tier" };
  }

  const databaseUrl = (input.databaseUrl || "").trim();
  if (!databaseUrl) return { allowed: false, reason: "missing_input" };

  const host = parseDatabaseHostname(databaseUrl);
  if (!host) return { allowed: false, reason: "malformed_target" };

  const decision = evaluateMigrationTarget({
    ...input,
    allowProductionMigrations: false
  });

  if (decision.allowed && decision.reason === "disposable_local") {
    return { allowed: false, reason: "disposable_refused" };
  }
  if (decision.allowed && decision.reason === "authorized_production") {
    return { allowed: false, reason: "production_refused" };
  }
  if (decision.allowed && decision.reason === "authorized_staging") {
    return { allowed: true, reason: "authorized_hosted_staging", hostname: host };
  }
  if (!decision.allowed) {
    if (decision.reason === "unknown_database") {
      return { allowed: false, reason: "ambiguous_target" };
    }
    if (
      decision.reason === "production_refused" ||
      decision.reason === "staging_refused" ||
      decision.reason === "remote_refused" ||
      decision.reason === "missing_input" ||
      decision.reason === "malformed_target"
    ) {
      return { allowed: false, reason: decision.reason };
    }
    return { allowed: false, reason: "ambiguous_target" };
  }
  return { allowed: false, reason: "ambiguous_target" };
}

export function hostedStagingAuthFromEnv(): HostedStagingInput {
  return {
    ...migrationAuthFromEnv(),
    databaseUrl: process.env.POLICY_ANALYZER_MIGRATE_DATABASE_URL,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    deployTier: process.env.POLICY_ANALYZER_ENV
  };
}

export function assertHostedStagingTarget(input: HostedStagingInput = hostedStagingAuthFromEnv()): {
  hostname: string;
} {
  const decision = evaluateHostedStagingTarget(input);
  if (!decision.allowed) {
    throw new Error(`HOSTED_STAGING_TARGET_REFUSED:${decision.reason}`);
  }
  return { hostname: decision.hostname };
}
