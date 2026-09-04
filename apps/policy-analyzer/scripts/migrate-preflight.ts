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
    disposableMarker: process.env.POLICY_ANALYZER_LIVE_STACK_MARKER
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
  assert.match(out, /20260904010000/);
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
  const local = evaluateMigrationTarget({
    databaseUrl: "postgres://postgres@127.0.0.1:5432/postgres",
    disposableMarker: "horseinsurance-fix5-live-stack",
    allowStagingMigrations: true,
    stagingProjectRefs: ["stagingsupabaseproj1"]
  });
  assert.equal(local.allowed, true);
  assert.equal(local.reason, "disposable_local");

  const stagingRef = "stagingsupabaseproj1";
  const productionRef = "productionsupabasepr";
  const authorizedStaging = evaluateMigrationTarget({
    databaseUrl: `https://${stagingRef}.supabase.co`,
    allowStagingMigrations: true,
    stagingProjectRefs: [stagingRef],
    productionProjectRefs: [productionRef]
  });
  assert.equal(authorizedStaging.allowed, true);
  assert.equal(authorizedStaging.reason, "authorized_staging");

  const wrongProject = evaluateMigrationTarget({
    databaseUrl: "https://wrongprojectref0001.supabase.co",
    allowStagingMigrations: true,
    stagingProjectRefs: [stagingRef]
  });
  assert.equal(wrongProject.allowed, false);
  assert.equal(wrongProject.reason, "remote_refused");

  const productionWithStagingAuth = evaluateMigrationTarget({
    databaseUrl: `https://${productionRef}.supabase.co`,
    allowStagingMigrations: true,
    allowProductionMigrations: false,
    stagingProjectRefs: [stagingRef],
    productionProjectRefs: [productionRef]
  });
  assert.equal(productionWithStagingAuth.allowed, false);
  assert.equal(productionWithStagingAuth.reason, "production_refused");

  const stagingWithoutAuth = evaluateMigrationTarget({
    databaseUrl: `https://${stagingRef}.supabase.co`,
    allowStagingMigrations: false,
    allowProductionMigrations: true,
    stagingProjectRefs: [stagingRef],
    productionProjectRefs: [productionRef]
  });
  assert.equal(stagingWithoutAuth.allowed, false);
  assert.equal(stagingWithoutAuth.reason, "staging_refused");

  const unknownRemote = evaluateMigrationTarget({
    databaseUrl: "https://unknownprojectref001.supabase.co",
    allowStagingMigrations: true,
    allowProductionMigrations: true,
    stagingProjectRefs: [stagingRef],
    productionProjectRefs: [productionRef]
  });
  assert.equal(unknownRemote.allowed, false);
  assert.equal(unknownRemote.reason, "remote_refused");

  const lookalikes = [
    `https://${stagingRef}.supabase.co.evil.com`,
    `https://evil-${stagingRef}.supabase.co`,
    `https://notgithub.com/${stagingRef}.supabase.co`,
    `postgres://user@${stagingRef}.supabase.co.attacker:5432/postgres`
  ];
  for (const databaseUrl of lookalikes) {
    const decision = evaluateMigrationTarget({
      databaseUrl,
      allowStagingMigrations: true,
      stagingProjectRefs: [stagingRef],
      stagingHosts: [`${stagingRef}.supabase.co`]
    });
    assert.equal(decision.allowed, false, databaseUrl);
  }

  const malformed = evaluateMigrationTarget({
    databaseUrl: "not a url",
    allowStagingMigrations: true,
    stagingProjectRefs: [stagingRef]
  });
  assert.equal(malformed.reason, "malformed_target");

  const overlapping = evaluateMigrationTarget({
    databaseUrl: `https://${stagingRef}.supabase.co`,
    allowStagingMigrations: true,
    allowProductionMigrations: true,
    stagingProjectRefs: [stagingRef],
    productionProjectRefs: [stagingRef]
  });
  assert.equal(overlapping.allowed, false);
  assert.equal(overlapping.reason, "unknown_database");
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
