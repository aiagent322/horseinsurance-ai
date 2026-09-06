/**
 * Milestone 4 hosted-staging safety regressions.
 * Live hosted E2E runs only when an allowlisted staging project is explicitly configured.
 * Secrets are never printed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isLocalDisposableAuthUrl } from "../lib/auth/local-disposable";
import { evaluateHostedE2ETarget } from "../lib/deploy/hosted-e2e-target";
import { evaluateHostedStagingTarget } from "../lib/deploy/hosted-staging-target";
import {
  ANALYZER_MIGRATIONS,
  AUTHORITATIVE_STAGING_MIGRATION_HISTORY,
  MOVE_RLS_HELPERS_MIGRATION,
  WORKER_PROCESS_HEARTBEAT_MIGRATION,
  evaluateHostedMigrationHistory,
  parseAnalyzerMigrationFilename
} from "../lib/deploy/migration-target";
import { analyzerUploadsEnabled } from "../lib/persistence/config";

const STAGING_REF = "stagingsupabaseproj1";
const PRODUCTION_REF = "productionsupabasepr";
const APP_ROOT = process.cwd();

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function authorized(overrides: Record<string, unknown> = {}) {
  return {
    databaseUrl: `https://${STAGING_REF}.supabase.co`,
    allowStagingMigrations: true,
    allowProductionMigrations: false,
    stagingProjectRefs: [STAGING_REF],
    productionProjectRefs: [PRODUCTION_REF],
    deployTier: "staging",
    ...overrides
  };
}

function main(): void {
  const accepted = evaluateHostedStagingTarget(authorized());
  assert.equal(accepted.allowed, true);
  assert.equal(accepted.reason, "authorized_hosted_staging");
  assert.equal(accepted.allowed && accepted.hostname, `${STAGING_REF}.supabase.co`);

  const loopback = evaluateHostedStagingTarget(
    authorized({
      databaseUrl: "postgres://postgres:postgres@127.0.0.1:5432/postgres",
      disposableMarker: "horseinsurance-fix5-live-stack"
    })
  );
  assert.equal(loopback.allowed, false);
  assert.equal(loopback.reason, "disposable_refused");

  const example = evaluateHostedStagingTarget(authorized({ databaseUrl: "https://example.com" }));
  assert.equal(example.allowed, false);
  assert.ok(example.reason === "remote_refused" || example.reason === "ambiguous_target");

  const hostedUnknown = evaluateHostedStagingTarget(
    authorized({ databaseUrl: "https://abcdefghijklmnopxx.supabase.co" })
  );
  assert.equal(hostedUnknown.allowed, false);
  assert.equal(hostedUnknown.reason, "remote_refused");

  const production = evaluateHostedStagingTarget(
    authorized({ databaseUrl: `https://${PRODUCTION_REF}.supabase.co` })
  );
  assert.equal(production.allowed, false);
  assert.equal(production.reason, "production_refused");

  const productionFlag = evaluateHostedStagingTarget(
    authorized({ allowProductionMigrations: true })
  );
  assert.equal(productionFlag.allowed, false);
  assert.equal(productionFlag.reason, "production_flag_set");

  withEnv({ POLICY_ANALYZER_ALLOW_PRODUCTION_MIGRATIONS: "YES" }, () => {
    const fromEnv = evaluateHostedStagingTarget(authorized({ allowProductionMigrations: false }));
    assert.equal(fromEnv.allowed, false);
    assert.equal(fromEnv.reason, "production_flag_set");
  });

  const productionTier = evaluateHostedStagingTarget(authorized({ deployTier: "production" }));
  assert.equal(productionTier.allowed, false);
  assert.equal(productionTier.reason, "wrong_tier");

  const overlapping = evaluateHostedStagingTarget(
    authorized({
      stagingProjectRefs: [STAGING_REF],
      productionProjectRefs: [STAGING_REF]
    })
  );
  assert.equal(overlapping.allowed, false);
  assert.equal(overlapping.reason, "ambiguous_target");

  const missing = evaluateHostedStagingTarget({ allowStagingMigrations: true, stagingProjectRefs: [STAGING_REF] });
  assert.equal(missing.allowed, false);
  assert.equal(missing.reason, "missing_input");

  const malformed = evaluateHostedStagingTarget(authorized({ databaseUrl: "not a url" }));
  assert.equal(malformed.allowed, false);
  assert.equal(malformed.reason, "malformed_target");

  const userinfo = evaluateHostedStagingTarget(
    authorized({ databaseUrl: `postgres://user:leaked-secret@db.${STAGING_REF}.supabase.co:5432/postgres` })
  );
  assert.equal(userinfo.allowed, true);
  assert.ok(!JSON.stringify(userinfo).includes("leaked-secret"));

  assert.equal(isLocalDisposableAuthUrl("http://127.0.0.1:54321"), true);
  assert.equal(isLocalDisposableAuthUrl("http://localhost:54321"), true);
  assert.equal(isLocalDisposableAuthUrl("http://[::1]:54321"), true);
  assert.equal(isLocalDisposableAuthUrl(`https://${STAGING_REF}.supabase.co`), false);
  assert.equal(isLocalDisposableAuthUrl(`https://${PRODUCTION_REF}.supabase.co`), false);
  assert.equal(isLocalDisposableAuthUrl("https://example.com"), false);
  assert.equal(isLocalDisposableAuthUrl("not-a-url"), false);

  const entrypoint = readFileSync(path.join(APP_ROOT, "deploy/entrypoint.mjs"), "utf8");
  assert.match(
    entrypoint,
    /process\.env\.POLICY_ANALYZER_PROCESS \|\| process\.argv\[2\] \|\| "web"/
  );
  assert.doesNotMatch(
    entrypoint,
    /process\.argv\[2\] \|\| process\.env\.POLICY_ANALYZER_PROCESS \|\| "web"/
  );
  function resolveEntrypointRole(envProcess: string | undefined, argvRole: string | undefined): string {
    return (envProcess || argvRole || "web").trim();
  }
  assert.equal(resolveEntrypointRole("worker", "web"), "worker");

  const hostedMigrate = readFileSync(path.join(APP_ROOT, "scripts/hosted-migrate.ts"), "utf8");
  assert.match(hostedMigrate, /--single-transaction/);
  assert.match(hostedMigrate, /ON_ERROR_STOP=1/);
  assert.match(hostedMigrate, /supabase_migrations\.schema_migrations/);
  assert.match(hostedMigrate, /lookupHistory\(/);
  assert.match(hostedMigrate, /evaluateHostedMigrationHistory\(/);
  assert.match(hostedMigrate, /HOSTED_MIGRATE_SKIPPED=/);
  assert.match(hostedMigrate, /insert into supabase_migrations\.schema_migrations/);
  const historyLib = readFileSync(path.join(APP_ROOT, "lib/deploy/migration-target.ts"), "utf8");
  assert.match(historyLib, /HOSTED_MIGRATE_HISTORY_CONFLICT/);
  assert.match(historyLib, /evaluateHostedMigrationHistory/);
  assert.match(hostedMigrate, /MOVE_RLS_HELPERS_MIGRATION/);
  const mainAt = hostedMigrate.indexOf("function main");
  assert.ok(mainAt >= 0);
  const lookupAt = hostedMigrate.indexOf("lookupHistory(", mainAt);
  const applyAt = hostedMigrate.indexOf("applyOne(", mainAt);
  assert.ok(lookupAt >= 0 && applyAt > lookupAt);

  const sample = "20260906180000_move_rls_helpers_to_private_schema.sql";
  assert.equal(
    evaluateHostedMigrationHistory(sample, "20260906180000", "move_rls_helpers_to_private_schema", [
      { version: "20260906180000", name: "move_rls_helpers_to_private_schema" }
    ]),
    "skip"
  );
  assert.equal(
    evaluateHostedMigrationHistory(sample, "20260906180000", "move_rls_helpers_to_private_schema", []),
    "apply"
  );
  assert.throws(
    () =>
      evaluateHostedMigrationHistory(sample, "20260906180000", "move_rls_helpers_to_private_schema", [
        { version: "20260906180000", name: "other_name" }
      ]),
    /HOSTED_MIGRATE_HISTORY_CONFLICT/
  );
  assert.throws(
    () =>
      evaluateHostedMigrationHistory(sample, "20260906180000", "move_rls_helpers_to_private_schema", [
        { version: "19990101000000", name: "move_rls_helpers_to_private_schema" }
      ]),
    /HOSTED_MIGRATE_HISTORY_CONFLICT/
  );

  const helperMove = readFileSync(
    path.resolve(APP_ROOT, "../..", "supabase/migrations", MOVE_RLS_HELPERS_MIGRATION),
    "utf8"
  );
  assert.match(helperMove, /create schema if not exists private/);
  assert.match(helperMove, /alter function public\.app_is_account_member\(uuid\) set schema private/);
  assert.match(helperMove, /alter function public\.app_has_role\(uuid, text\) set schema private/);
  assert.match(helperMove, /alter function public\.app_is_staff\(text\) set schema private/);
  assert.doesNotMatch(helperMove, /create (or replace )?function public\.app_is_account_member/);
  assert.doesNotMatch(helperMove, /create (or replace )?function public\.app_has_role/);
  assert.doesNotMatch(helperMove, /create (or replace )?function public\.app_is_staff/);
  assert.doesNotMatch(helperMove, /create (or replace )?function public\.reserve_analyzer_package/);
  assert.doesNotMatch(helperMove, /create (or replace )?function public\.finalize_analyzer_package/);
  assert.doesNotMatch(helperMove, /create (or replace )?function public\.abandon_analyzer_reservation/);
  assert.doesNotMatch(helperMove, /create (or replace )?function public\.get_own_job_status/);
  assert.doesNotMatch(helperMove, /create (or replace )?function public\.cancel_own_analysis_job/);

  const workerHeartbeat = readFileSync(
    path.resolve(APP_ROOT, "../..", "supabase/migrations", WORKER_PROCESS_HEARTBEAT_MIGRATION),
    "utf8"
  );
  assert.match(workerHeartbeat, /create table if not exists analyzer_worker_heartbeats/);
  assert.match(workerHeartbeat, /create or replace function heartbeat_analyzer_worker\(p_worker_id text\)/);
  assert.match(workerHeartbeat, /revoke all on function heartbeat_analyzer_worker\(text\) from anon/);
  assert.match(workerHeartbeat, /revoke all on function heartbeat_analyzer_worker\(text\) from authenticated/);
  assert.match(workerHeartbeat, /grant execute on function heartbeat_analyzer_worker\(text\) to service_role/);
  assert.match(workerHeartbeat, /from analyzer_worker_heartbeats/);
  assert.doesNotMatch(
    workerHeartbeat,
    /last_worker_heartbeat_age_seconds[\s\S]*from analysis_jobs[\s\S]*last_heartbeat/
  );

  assert.equal(AUTHORITATIVE_STAGING_MIGRATION_HISTORY.length, ANALYZER_MIGRATIONS.length);
  for (const [index, filename] of ANALYZER_MIGRATIONS.entries()) {
    const parsed = parseAnalyzerMigrationFilename(filename);
    const expected = AUTHORITATIVE_STAGING_MIGRATION_HISTORY[index];
    assert.equal(parsed.version, expected.version, filename);
    assert.equal(parsed.name, expected.name, filename);
  }
  assert.equal(
    AUTHORITATIVE_STAGING_MIGRATION_HISTORY[AUTHORITATIVE_STAGING_MIGRATION_HISTORY.length - 1].name,
    "worker_process_heartbeat"
  );

  const signIn = readFileSync(path.join(APP_ROOT, "components/sign-in-form.tsx"), "utf8");
  assert.match(signIn, /isLocalDisposableAuthUrl/);
  assert.doesNotMatch(signIn, /window\.location\.hostname/);
  assert.doesNotMatch(signIn, /headers\.get\(["']host["']\)/i);

  withEnv(
    {
      POLICY_ANALYZER_ENV: "staging",
      POLICY_ANALYZER_UPLOADS_ENABLED: undefined,
      NODE_ENV: "production"
    },
    () => {
      assert.equal(analyzerUploadsEnabled(), false);
    }
  );

  const e2eAuthorized = {
    hostedE2E: true,
    appUrl: "https://analyzer-staging.example",
    supabaseUrl: `https://${STAGING_REF}.supabase.co`,
    deployTier: "staging",
    stagingProjectRefs: [STAGING_REF],
    productionProjectRefs: [PRODUCTION_REF]
  };
  const e2eAccepted = evaluateHostedE2ETarget(e2eAuthorized);
  assert.equal(e2eAccepted.allowed, true);
  assert.equal(e2eAccepted.allowed && e2eAccepted.reason, "authorized_hosted_e2e");
  assert.equal(e2eAccepted.allowed && e2eAccepted.appHost, "analyzer-staging.example");
  assert.ok(!JSON.stringify(e2eAccepted).includes("leaked-secret"));

  assert.equal(evaluateHostedE2ETarget({ ...e2eAuthorized, hostedE2E: false }).reason, "not_requested");
  assert.equal(
    evaluateHostedE2ETarget({ ...e2eAuthorized, appUrl: "http://127.0.0.1:43147" }).reason,
    "disposable_refused"
  );
  assert.equal(
    evaluateHostedE2ETarget({ ...e2eAuthorized, supabaseUrl: "http://127.0.0.1:54321" }).reason,
    "disposable_refused"
  );
  assert.equal(
    evaluateHostedE2ETarget({ ...e2eAuthorized, supabaseUrl: "https://abcdefghijklmnopxx.supabase.co" }).reason,
    "remote_refused"
  );
  assert.equal(
    evaluateHostedE2ETarget({ ...e2eAuthorized, supabaseUrl: `https://${PRODUCTION_REF}.supabase.co` }).reason,
    "production_refused"
  );
  assert.equal(evaluateHostedE2ETarget({ ...e2eAuthorized, appUrl: undefined }).reason, "missing_app");

  const hostedE2E = readFileSync(path.join(APP_ROOT, "scripts/hosted-e2e.ts"), "utf8");
  assert.match(hostedE2E, /evaluateHostedE2ETarget/);
  assert.match(hostedE2E, /HOSTED_E2E_NOT_CONFIGURED/);
  assert.match(hostedE2E, /buildCompletePolicyPdf/);
  assert.match(hostedE2E, /\/api\/upload/);
  assert.match(hostedE2E, /setStage\("prepare_pdf"\)/);
  assert.match(hostedE2E, /create_user_a/);
  assert.match(hostedE2E, /signin_user_a/);
  assert.match(hostedE2E, /setStage\("upload"\)/);
  assert.match(hostedE2E, /User B enumerated/);
  assert.doesNotMatch(hostedE2E, /new AnalysisWorker/);
  assert.doesNotMatch(hostedE2E, /runWorkerOnce/);
  const stagingIntegration = readFileSync(path.join(APP_ROOT, "scripts/staging-integration.ts"), "utf8");
  assert.match(stagingIntegration, /Remote Supabase URLs are rejected/);
  assert.match(stagingIntegration, /disposable loopback stack only/);

  const liveRequested = process.env.POLICY_ANALYZER_HOSTED_STAGING_LIVE === "YES";
  if (liveRequested) {
    const live = evaluateHostedStagingTarget();
    if (!live.allowed) {
      throw new Error(`HOSTED_LIVE_REFUSED:${live.reason}`);
    }
    console.log("HOSTED_LIVE_TARGET_OK");
  } else {
    console.log("HOSTED_LIVE_NOT_CONFIGURED");
  }

  console.log("HOSTED STAGING REGRESSION OK");
}

main();
