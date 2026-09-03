import assert from "node:assert/strict";
import { loadWebEnv, loadWorkerEnv } from "../lib/deploy/env-contract";
import { evaluateMigrationTarget } from "../lib/deploy/migration-target";
import { analyzerUploadsEnabled, ConfigurationError } from "../lib/persistence/config";
import { createWorkerPersistence } from "../lib/persistence/worker-factory";
import { loadWorkerConfig } from "../lib/worker/config";

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

function main(): void {
  withEnv(
    {
      POLICY_ANALYZER_ENV: "development",
      POLICY_ANALYZER_STORE: "memory",
      NODE_ENV: "test"
    },
    () => {
      assert.equal(loadWebEnv().role, "web");
      assert.equal(loadWorkerEnv().role, "worker");
    }
  );

  withEnv(
    {
      POLICY_ANALYZER_ENV: "staging",
      POLICY_ANALYZER_STORE: "memory",
      NODE_ENV: "production",
      POLICY_RETENTION_DAYS: "30"
    },
    () => {
      assert.throws(() => loadWebEnv(), ConfigurationError);
      assert.throws(() => loadWorkerEnv(), ConfigurationError);
      assert.throws(() => loadWorkerConfig(), ConfigurationError);
      assert.throws(() => createWorkerPersistence(), ConfigurationError);
    }
  );

  withEnv(
    {
      POLICY_ANALYZER_ENV: "staging",
      POLICY_ANALYZER_STORE: "supabase",
      NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      POLICY_RETENTION_DAYS: "30"
    },
    () => {
      assert.throws(() => loadWebEnv(), /Invalid NEXT_PUBLIC_SUPABASE_URL/);
    }
  );

  withEnv(
    {
      POLICY_ANALYZER_ENV: "staging",
      POLICY_ANALYZER_STORE: "supabase",
      SUPABASE_URL: "https://example.invalid",
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid"
    },
    () => {
      assert.throws(() => loadWorkerEnv(), ConfigurationError);
    }
  );

  withEnv(
    {
      POLICY_ANALYZER_ENV: "staging",
      NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "leaked"
    },
    () => {
      assert.throws(() => loadWebEnv(), /NEXT_PUBLIC_/);
    }
  );

  withEnv(
    {
      POLICY_ANALYZER_ENV: "staging",
      POLICY_ANALYZER_UPLOADS_ENABLED: undefined,
      POLICY_ANALYZER_STORE: "memory",
      NODE_ENV: "test"
    },
    () => {
      assert.equal(analyzerUploadsEnabled(), false);
    }
  );

  withEnv(
    {
      POLICY_ANALYZER_ENV: "development",
      POLICY_ANALYZER_UPLOADS_ENABLED: undefined,
      NODE_ENV: "test"
    },
    () => {
      assert.equal(analyzerUploadsEnabled(), true);
    }
  );

  assert.equal(
    evaluateMigrationTarget({
      databaseUrl: "postgres://postgres@127.0.0.1:5432/postgres",
      disposableMarker: "horseinsurance-fix5-live-stack"
    }).allowed,
    true
  );
  assert.equal(
    evaluateMigrationTarget({
      databaseUrl: "postgres://postgres@db.xxx.supabase.co:5432/postgres"
    }).reason,
    "remote_refused"
  );
  withEnv({ POLICY_ANALYZER_ENV: "production" }, () => {
    assert.equal(
      evaluateMigrationTarget({
        databaseUrl: "postgres://postgres@127.0.0.1:5432/postgres",
        disposableMarker: "horseinsurance-fix5-live-stack"
      }).reason,
      "production_refused"
    );
  });
  assert.equal(evaluateMigrationTarget({}).reason, "missing_input");

  console.log("ENV CONTRACT OK");
}

main();
