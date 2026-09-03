import assert from "node:assert/strict";
import {
  ACCEPTED_FIX6_SHA,
  DISPOSABLE_STACK_MARKER,
  evaluateCleanupScope,
  evaluateLiveSafety,
  evaluateRepositorySafety,
  evaluateTargetSafety
} from "./live-safety";

const VALID_HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VALID_REMOTES = ["https://github.com/aiagent322/horseinsurance-ai.git"];
const VALID_CONTAINERS = ["fix5-pg", "fix5-rest", "fix5-auth", "fix5-storage"];

function validTarget(overrides: Record<string, unknown> = {}) {
  return {
    remotes: VALID_REMOTES,
    branch: "cursor/policy-analyzer-fix7-staging",
    head: VALID_HEAD,
    descendsFromFix6: true,
    supabaseUrl: "http://127.0.0.1:54321",
    restUrl: "http://127.0.0.1:3000",
    authUrl: "http://127.0.0.1:9999",
    storageUrl: "http://127.0.0.1:54321/storage/v1",
    databaseName: "postgres",
    disposableMarker: DISPOSABLE_STACK_MARKER,
    containerNames: VALID_CONTAINERS,
    ...overrides
  };
}

function main() {
  const okFix7 = evaluateLiveSafety(validTarget());
  assert.equal(okFix7.ok, true, okFix7.reason);
  assert.equal(okFix7.code, "accepted");

  const okDetached = evaluateLiveSafety(
    validTarget({
      branch: "",
      head: ACCEPTED_FIX6_SHA
    })
  );
  assert.equal(okDetached.ok, true, okDetached.reason);

  const rejectMain = evaluateRepositorySafety(validTarget({ branch: "main" }));
  assert.equal(rejectMain.ok, false);
  assert.equal(rejectMain.code, "protected_branch");

  const rejectMaster = evaluateRepositorySafety(validTarget({ branch: "master" }));
  assert.equal(rejectMaster.ok, false);
  assert.equal(rejectMaster.code, "protected_branch");

  const rejectRemote = evaluateRepositorySafety(
    validTarget({ remotes: ["https://github.com/other/repo.git"] })
  );
  assert.equal(rejectRemote.ok, false);
  assert.equal(rejectRemote.code, "wrong_repository");

  const rejectAncestry = evaluateRepositorySafety(validTarget({ descendsFromFix6: false }));
  assert.equal(rejectAncestry.ok, false);
  assert.equal(rejectAncestry.code, "ancestry");

  const rejectUnrelated = evaluateRepositorySafety(
    validTarget({ branch: "cursor/policy-analyzer-unrelated" })
  );
  assert.equal(rejectUnrelated.ok, false);
  assert.equal(rejectUnrelated.code, "unrelated_branch");

  const rejectHosted = evaluateTargetSafety(
    validTarget({ supabaseUrl: "https://abcdefghijklmnop.supabase.co" })
  );
  assert.equal(rejectHosted.ok, false);
  assert.equal(rejectHosted.code, "remote_supabase");

  const rejectRest = evaluateTargetSafety(validTarget({ restUrl: "https://db.internal.example:3000" }));
  assert.equal(rejectRest.ok, false);
  assert.equal(rejectRest.code, "non_loopback");

  const rejectAuth = evaluateTargetSafety(validTarget({ authUrl: "https://10.0.0.8:9999" }));
  assert.equal(rejectAuth.ok, false);
  assert.equal(rejectAuth.code, "non_loopback");

  const rejectDb = evaluateTargetSafety(validTarget({ databaseName: "production" }));
  assert.equal(rejectDb.ok, false);
  assert.equal(rejectDb.code, "unknown_database");

  const rejectMarker = evaluateTargetSafety(validTarget({ disposableMarker: "unknown" }));
  assert.equal(rejectMarker.ok, false);
  assert.equal(rejectMarker.code, "missing_marker");

  const rejectContainers = evaluateTargetSafety(validTarget({ containerNames: ["postgres"] }));
  assert.equal(rejectContainers.ok, false);
  assert.equal(rejectContainers.code, "unknown_stack");

  const rejectMissing = evaluateLiveSafety({
    remotes: VALID_REMOTES,
    branch: "cursor/policy-analyzer-fix7-staging",
    head: VALID_HEAD,
    descendsFromFix6: true
  });
  assert.equal(rejectMissing.ok, false);
  assert.equal(rejectMissing.code, "missing_input");

  const rejectEmptyRemote = evaluateRepositorySafety(validTarget({ remotes: [] }));
  assert.equal(rejectEmptyRemote.ok, false);
  assert.equal(rejectEmptyRemote.code, "missing_input");

  const cleanupOk = evaluateCleanupScope(["11111111-1111-4111-8111-111111111111"]);
  assert.equal(cleanupOk.ok, true);
  assert.equal(evaluateCleanupScope([]).ok, false);
  assert.equal(evaluateCleanupScope(["*"]).ok, false);
  assert.equal(evaluateCleanupScope(null).code, "missing_input");

  console.log("LIVE SAFETY REGRESSION OK");
}

main();
