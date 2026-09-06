import { evaluateHostedStagingTarget } from "./hosted-staging-target";
import { parseDatabaseHostname } from "./migration-target";

export type HostedE2EReason =
  | "authorized_hosted_e2e"
  | "not_requested"
  | "missing_app"
  | "malformed_app"
  | "disposable_refused"
  | "missing_input"
  | "malformed_target"
  | "production_flag_set"
  | "production_refused"
  | "staging_refused"
  | "remote_refused"
  | "ambiguous_target"
  | "wrong_tier";

export type HostedE2EDecision =
  | { allowed: true; reason: "authorized_hosted_e2e"; hostname: string; appHost: string }
  | { allowed: false; reason: Exclude<HostedE2EReason, "authorized_hosted_e2e"> };

export type HostedE2EInput = {
  hostedE2E?: boolean;
  appUrl?: string;
  supabaseUrl?: string;
  deployTier?: string;
  stagingProjectRefs?: string[];
  productionProjectRefs?: string[];
  allowProductionMigrations?: boolean;
};

function splitCsv(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function hostedE2EAuthFromEnv(): HostedE2EInput {
  return {
    hostedE2E: process.env.POLICY_ANALYZER_HOSTED_E2E === "YES",
    appUrl: process.env.POLICY_ANALYZER_STAGING_APP_URL,
    supabaseUrl:
      process.env.POLICY_ANALYZER_HOSTED_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL,
    deployTier: process.env.POLICY_ANALYZER_ENV,
    stagingProjectRefs: splitCsv(process.env.POLICY_ANALYZER_STAGING_PROJECT_REF),
    productionProjectRefs: splitCsv(process.env.POLICY_ANALYZER_PRODUCTION_PROJECT_REF),
    allowProductionMigrations: process.env.POLICY_ANALYZER_ALLOW_PRODUCTION_MIGRATIONS === "YES"
  };
}

/**
 * Hosted Demo V1 E2E gate. Loopback, production, and unknown remotes fail closed.
 * Decisions never include raw URLs, tokens, or userinfo.
 */
export function evaluateHostedE2ETarget(input: HostedE2EInput = hostedE2EAuthFromEnv()): HostedE2EDecision {
  if (input.allowProductionMigrations === true || process.env.POLICY_ANALYZER_ALLOW_PRODUCTION_MIGRATIONS === "YES") {
    return { allowed: false, reason: "production_flag_set" };
  }
  const tier = (input.deployTier || process.env.POLICY_ANALYZER_ENV || "").trim().toLowerCase();
  if (tier === "production") {
    return { allowed: false, reason: "wrong_tier" };
  }
  if (input.hostedE2E !== true) {
    return { allowed: false, reason: "not_requested" };
  }

  const appUrl = (input.appUrl || "").trim();
  if (!appUrl) return { allowed: false, reason: "missing_app" };
  let appHost: string;
  try {
    const parsed = new URL(appUrl);
    appHost = (parsed.hostname || "").toLowerCase();
    if (!appHost || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
      return { allowed: false, reason: "malformed_app" };
    }
  } catch {
    return { allowed: false, reason: "malformed_app" };
  }
  if (isLoopbackHost(appHost)) {
    return { allowed: false, reason: "disposable_refused" };
  }

  const supabaseUrl = (input.supabaseUrl || "").trim();
  if (!supabaseUrl) return { allowed: false, reason: "missing_input" };
  const supabaseHost = parseDatabaseHostname(supabaseUrl);
  if (!supabaseHost) return { allowed: false, reason: "malformed_target" };
  if (isLoopbackHost(supabaseHost)) {
    return { allowed: false, reason: "disposable_refused" };
  }

  const staging = evaluateHostedStagingTarget({
    databaseUrl: supabaseUrl,
    allowStagingMigrations: true,
    allowProductionMigrations: false,
    stagingProjectRefs: input.stagingProjectRefs,
    productionProjectRefs: input.productionProjectRefs,
    deployTier: input.deployTier || "staging"
  });
  if (!staging.allowed) {
    return { allowed: false, reason: staging.reason };
  }
  return {
    allowed: true,
    reason: "authorized_hosted_e2e",
    hostname: staging.hostname,
    appHost
  };
}

export function assertHostedE2ETarget(input: HostedE2EInput = hostedE2EAuthFromEnv()): {
  hostname: string;
  appHost: string;
} {
  const decision = evaluateHostedE2ETarget(input);
  if (!decision.allowed) {
    throw new Error(`HOSTED_E2E_TARGET_REFUSED:${decision.reason}`);
  }
  return { hostname: decision.hostname, appHost: decision.appHost };
}
