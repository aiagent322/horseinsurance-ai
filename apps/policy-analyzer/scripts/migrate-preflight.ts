import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  ANALYZER_MIGRATIONS,
  acceptedHistoryFiles,
  assertAuthorizedMigrationTarget,
  evaluateMigrationTarget
} from "../lib/deploy/migration-target";

const WORKTREE = path.resolve(process.cwd(), "../..");
const MIGRATION_DIR = path.join(WORKTREE, "supabase/migrations");
const ACCEPTED_FIX6 = "60d3de8d952cdd059c26d333876f8557dbf6cb4d";

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function historyUnchanged(): void {
  for (const name of acceptedHistoryFiles()) {
    const current = path.join(MIGRATION_DIR, name);
    const fromFix6 = execFileSync("git", ["show", `${ACCEPTED_FIX6}:supabase/migrations/${name}`], {
      cwd: WORKTREE,
      encoding: "utf8"
    });
    assert.equal(readFileSync(current, "utf8"), fromFix6, `${name} must not rewrite accepted history`);
  }
}

function applyIfRequested(): void {
  const apply = process.env.POLICY_ANALYZER_MIGRATE_APPLY === "YES";
  if (!apply) return;
  const databaseUrl = process.env.POLICY_ANALYZER_MIGRATE_DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/postgres";
  assertAuthorizedMigrationTarget({
    databaseUrl,
    disposableMarker: process.env.POLICY_ANALYZER_LIVE_STACK_MARKER,
    allowProductionMigrations: process.env.POLICY_ANALYZER_ALLOW_PRODUCTION_MIGRATIONS === "YES",
    projectRef: process.env.POLICY_ANALYZER_STAGING_PROJECT_REF
  });
  if (!existsSync("/usr/bin/docker") && !existsSync("/usr/local/bin/docker")) {
    throw new Error("docker is required to apply migrations to the disposable stack");
  }
  const file = path.join(MIGRATION_DIR, ANALYZER_MIGRATIONS[ANALYZER_MIGRATIONS.length - 1]);
  execFileSync("docker", ["exec", "-i", "fix5-pg", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: readFileSync(file),
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function verifyDisposableSchema(): void {
  if (process.env.POLICY_ANALYZER_MIGRATE_VERIFY !== "YES") return;
  const sql = `
    select to_regclass('public.analysis_jobs') is not null
      and to_regclass('public.analyzer_runtime_config') is not null as tables_ok;
    select config_value from analyzer_runtime_config where config_key = 'schema_version';
    select public from storage.buckets where id = 'policy-files';
    select has_function_privilege('service_role', 'analyzer_ops_snapshot()', 'execute') as service_ops;
    select has_function_privilege('authenticated', 'analyzer_ops_snapshot()', 'execute') as auth_ops;
    select has_function_privilege('authenticated', 'claim_analysis_jobs(text,integer)', 'execute') as auth_claim;
  `;
  const out = execFileSync(
    "docker",
    ["exec", "-i", "fix5-pg", "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql],
    { encoding: "utf8" }
  );
  assert.match(out, /t/);
  assert.match(out, /20260903220000/);
  assert.match(out, /f/);
}

function main(): void {
  const present = readdirSync(MIGRATION_DIR).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(present, [...ANALYZER_MIGRATIONS]);
  historyUnchanged();
  for (const name of ANALYZER_MIGRATIONS) {
    assert.ok(existsSync(path.join(MIGRATION_DIR, name)));
    sha256(path.join(MIGRATION_DIR, name));
  }
  const remote = evaluateMigrationTarget({
    databaseUrl: "https://abc.supabase.co",
    disposableMarker: "isolated-staging"
  });
  assert.equal(remote.allowed, false);
  applyIfRequested();
  verifyDisposableSchema();
  for (const doc of [
    "deploy/STAGING.md",
    "deploy/secrets-checklist.md",
    "deploy/backup-rollback.md"
  ]) {
    assert.ok(existsSync(path.join(process.cwd(), doc)), doc);
  }
  const rollback = readFileSync(path.join(process.cwd(), "deploy/backup-rollback.md"), "utf8");
  assert.match(rollback, /60d3de8d952cdd059c26d333876f8557dbf6cb4d/);
  assert.match(rollback, /drop function if exists analyzer_ops_snapshot/);
  console.log("MIGRATE PREFLIGHT OK");
}

main();
