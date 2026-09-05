/**
 * Apply accepted analyzer migrations to an allowlisted hosted staging database only.
 * Refuses disposable loopback and production. Never prints the database URL.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { ANALYZER_MIGRATIONS } from "../lib/deploy/migration-target";
import { assertHostedStagingTarget, hostedStagingAuthFromEnv } from "../lib/deploy/hosted-staging-target";

const WORKTREE = path.resolve(process.cwd(), "../..");
const MIGRATION_DIR = path.join(WORKTREE, "supabase/migrations");

function applyOne(databaseUrl: string, file: string): void {
  if (!existsSync("/usr/bin/psql") && !existsSync("/usr/local/bin/psql")) {
    throw new Error("HOSTED_MIGRATE_PSQL_MISSING");
  }
  execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", file], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8"
  });
}

function main(): void {
  const apply = process.env.POLICY_ANALYZER_MIGRATE_APPLY === "YES";
  const input = hostedStagingAuthFromEnv();
  const { hostname } = assertHostedStagingTarget(input);
  const databaseUrl = (input.databaseUrl || "").trim();
  if (!apply) {
    console.log("HOSTED_MIGRATE_DRY_RUN");
    console.log(`hostname=${hostname}`);
    console.log(`migrations=${ANALYZER_MIGRATIONS.length}`);
    return;
  }
  for (const name of ANALYZER_MIGRATIONS) {
    const file = path.join(MIGRATION_DIR, name);
    if (!existsSync(file)) throw new Error(`HOSTED_MIGRATE_MISSING:${name}`);
    applyOne(databaseUrl, file);
    console.log(`HOSTED_MIGRATE_APPLIED=${name}`);
  }
  console.log("HOSTED_MIGRATE_OK");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "HOSTED_MIGRATE_FAILED";
  const safe = message.replace(/postgres(ql)?:\/\/\S+/gi, "[redacted-db]").replace(/eyJ[A-Za-z0-9._-]{20,}/g, "[redacted]");
  console.error(safe.startsWith("HOSTED_") ? safe : "HOSTED_MIGRATE_FAILED");
  process.exit(1);
}
