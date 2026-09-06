/**
 * Apply accepted analyzer migrations to an allowlisted hosted staging database only.
 * Refuses disposable loopback and production. Never prints the database URL.
 * Skips versions already recorded in supabase_migrations.schema_migrations.
 * Applies migration SQL and the ledger insert in one transaction.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ANALYZER_MIGRATIONS,
  MOVE_RLS_HELPERS_MIGRATION,
  evaluateHostedMigrationHistory,
  parseAnalyzerMigrationFilename,
  type HostedMigrationHistoryRow
} from "../lib/deploy/migration-target";
import { assertHostedStagingTarget, hostedStagingAuthFromEnv } from "../lib/deploy/hosted-staging-target";

const WORKTREE = path.resolve(process.cwd(), "../..");
const MIGRATION_DIR = path.join(WORKTREE, "supabase/migrations");

function requirePsql(): void {
  if (!existsSync("/usr/bin/psql") && !existsSync("/usr/local/bin/psql")) {
    throw new Error("HOSTED_MIGRATE_PSQL_MISSING");
  }
}

function psql(databaseUrl: string, extraArgs: string[], input?: string): string {
  requirePsql();
  return execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", ...extraArgs], {
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf8",
    input
  });
}

function lookupHistory(databaseUrl: string, version: string, name: string): HostedMigrationHistoryRow[] {
  const sql = [
    "select version::text, coalesce(name, '')",
    "from supabase_migrations.schema_migrations",
    `where version = '${version}' or name = '${name}'`
  ].join(" ");
  const out = psql(databaseUrl, ["-tAc", sql]);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rowVersion, ...rest] = line.split("|");
      return { version: rowVersion, name: rest.join("|") };
    });
}

function applyOne(databaseUrl: string, file: string, version: string, name: string): void {
  const migrationSql = readFileSync(file, "utf8");
  const combined = [
    migrationSql.replace(/\s+$/, ""),
    "",
    "insert into supabase_migrations.schema_migrations (version, name)",
    `values ('${version}', '${name}');`,
    ""
  ].join("\n");
  psql(databaseUrl, ["--single-transaction", "-f", "-"], combined);
}

function assertSafeIdentifier(value: string, pattern: RegExp, filename: string): void {
  if (!pattern.test(value)) {
    throw new Error(`HOSTED_MIGRATE_NAME_INVALID:${filename}`);
  }
}

function main(): void {
  const apply = process.env.POLICY_ANALYZER_MIGRATE_APPLY === "YES";
  const input = hostedStagingAuthFromEnv();
  const { hostname } = assertHostedStagingTarget(input);
  const databaseUrl = (input.databaseUrl || "").trim();
  if (!ANALYZER_MIGRATIONS.includes(MOVE_RLS_HELPERS_MIGRATION)) {
    throw new Error("HOSTED_MIGRATE_MISSING:20260906180000_move_rls_helpers_to_private_schema.sql");
  }
  if (!apply) {
    console.log("HOSTED_MIGRATE_DRY_RUN");
    console.log(`hostname=${hostname}`);
    console.log(`migrations=${ANALYZER_MIGRATIONS.length}`);
    return;
  }
  for (const filename of ANALYZER_MIGRATIONS) {
    const file = path.join(MIGRATION_DIR, filename);
    if (!existsSync(file)) throw new Error(`HOSTED_MIGRATE_MISSING:${filename}`);
    const { version, name } = parseAnalyzerMigrationFilename(filename);
    assertSafeIdentifier(version, /^\d{14}$/, filename);
    assertSafeIdentifier(name, /^[a-z0-9_]+$/, filename);
    const rows = lookupHistory(databaseUrl, version, name);
    if (evaluateHostedMigrationHistory(filename, version, name, rows) === "skip") {
      console.log(`HOSTED_MIGRATE_SKIPPED=${filename}`);
      continue;
    }
    applyOne(databaseUrl, file, version, name);
    console.log(`HOSTED_MIGRATE_APPLIED=${filename}`);
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
