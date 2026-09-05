/**
 * Milestone 4 hosted-staging safety regressions.
 * Live hosted E2E runs only when an allowlisted staging project is explicitly configured.
 * Secrets are never printed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isLocalDisposableAuthUrl } from "../lib/auth/local-disposable";
import { evaluateHostedStagingTarget } from "../lib/deploy/hosted-staging-target";
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
