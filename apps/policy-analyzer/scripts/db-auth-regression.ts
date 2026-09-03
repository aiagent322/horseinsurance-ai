import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Database-authorization regression for the durable jobs migration.
// Runs as a static analysis of the SQL migration file, verifying security
// properties that must hold regardless of which Postgres runtime is used.
// ---------------------------------------------------------------------------

const MIGRATION_DIR = path.resolve(process.cwd(), "../../supabase/migrations");
const JOBS_MIGRATION = path.join(MIGRATION_DIR, "20260903150000_durable_analysis_jobs.sql");

function readMigration(): string {
  return readFileSync(JOBS_MIGRATION, "utf8");
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function main() {
  const sql = readMigration();
  const normalized = normalizeWhitespace(sql);

  // ---- 1. No authenticated mutation grants on jobs, counters, or config ----
  const protectedTables = [
    "analysis_jobs",
    "account_usage_windows",
    "analyzer_runtime_config"
  ];

  for (const table of protectedTables) {
    const insertGrantRe = new RegExp(
      `grant\\s+insert\\s+on\\s+(table\\s+)?${table}\\s+to\\s+authenticated`,
      "i"
    );
    const updateGrantRe = new RegExp(
      `grant\\s+update\\s+on\\s+(table\\s+)?${table}\\s+to\\s+authenticated`,
      "i"
    );
    const deleteGrantRe = new RegExp(
      `grant\\s+delete\\s+on\\s+(table\\s+)?${table}\\s+to\\s+authenticated`,
      "i"
    );

    assert.equal(insertGrantRe.test(sql), false,
      `No INSERT grant to authenticated on ${table}`);
    assert.equal(updateGrantRe.test(sql), false,
      `No UPDATE grant to authenticated on ${table}`);
    assert.equal(deleteGrantRe.test(sql), false,
      `No DELETE grant to authenticated on ${table}`);
  }

  // Also check that revoke statements exist for these tables.
  for (const table of protectedTables) {
    assert.ok(
      normalized.includes(`revoke all on ${table} from authenticated`)
      || normalized.includes(`revoke insert, update, delete on ${table} from authenticated`),
      `Revoke on ${table} for authenticated must exist`
    );
  }

  // No RLS INSERT/UPDATE/DELETE policy for authenticated on analysis_jobs.
  const jobsInsertPolicy = /create\s+policy\s+\S+\s+on\s+analysis_jobs\s+for\s+insert/i;
  const jobsUpdatePolicy = /create\s+policy\s+\S+\s+on\s+analysis_jobs\s+for\s+update/i;
  const jobsDeletePolicy = /create\s+policy\s+\S+\s+on\s+analysis_jobs\s+for\s+delete/i;
  assert.equal(jobsInsertPolicy.test(sql), false, "No INSERT RLS policy on analysis_jobs");
  assert.equal(jobsUpdatePolicy.test(sql), false, "No UPDATE RLS policy on analysis_jobs");
  assert.equal(jobsDeletePolicy.test(sql), false, "No DELETE RLS policy on analysis_jobs");

  // No INSERT/UPDATE/DELETE policies on counters or config.
  for (const table of ["account_usage_windows", "analyzer_runtime_config"]) {
    const anyPolicy = new RegExp(`create\\s+policy\\s+\\S+\\s+on\\s+${table}`, "i");
    assert.equal(anyPolicy.test(sql), false, `No RLS policy at all on ${table}`);
  }

  // No policy on upload_reservations (all access via DEFINER functions).
  assert.equal(
    /create\s+policy\s+\S+\s+on\s+upload_reservations/i.test(sql),
    false,
    "No RLS policy on upload_reservations"
  );

  // ---- 2. Authenticated users cannot execute worker functions ----
  const workerFunctions = [
    "claim_analysis_jobs",
    "heartbeat_analysis_job",
    "update_job_progress",
    "fail_analysis_job",
    "complete_analysis_job"
  ];

  for (const fn of workerFunctions) {
    const grantAuth = new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+${fn}[^;]*to\\s+authenticated`,
      "i"
    );
    assert.equal(grantAuth.test(sql), false,
      `No EXECUTE grant to authenticated on ${fn}`);

    const revokeAuth = new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+${fn}[^;]*from\\s+authenticated`,
      "i"
    );
    assert.ok(revokeAuth.test(sql),
      `REVOKE ALL from authenticated on ${fn}`);
  }

  // ---- 3. No RPC accepts caller-controlled security limits ----
  // reserve_analyzer_package takes only p_file_count (an integer).
  // It must not accept rate limits, attempt counts, etc.
  const reserveSig = sql.match(
    /create\s+or\s+replace\s+function\s+reserve_analyzer_package\(([^)]*)\)/i
  );
  assert.ok(reserveSig, "reserve_analyzer_package signature found");
  const reserveParams = reserveSig![1].toLowerCase();
  assert.ok(
    reserveParams.includes("p_file_count") && reserveParams.includes("integer"),
    "reserve_analyzer_package accepts only p_file_count integer"
  );
  for (const forbidden of ["rate_limit", "max_attempts", "retention", "active_limit", "expiry"]) {
    assert.ok(
      !reserveParams.includes(forbidden),
      `reserve_analyzer_package must not accept ${forbidden} parameter`
    );
  }

  // finalize_analyzer_package takes reservation_id + files array only.
  const finalizeSig = sql.match(
    /create\s+or\s+replace\s+function\s+finalize_analyzer_package\(([^)]*)\)/i
  );
  assert.ok(finalizeSig, "finalize_analyzer_package signature found");
  const finalizeParams = finalizeSig![1].toLowerCase();
  for (const forbidden of ["rate_limit", "max_attempts", "retention", "active_limit"]) {
    assert.ok(
      !finalizeParams.includes(forbidden),
      `finalize_analyzer_package must not accept ${forbidden} parameter`
    );
  }

  // ---- 4. Authoritative IDs are database-generated ----
  // reserve_analyzer_package must generate IDs with gen_random_uuid().
  const reserveBody = extractFunctionBody(sql, "reserve_analyzer_package");
  const generatedIds = [
    "v_reservation_id", "v_upload_id", "v_analysis_id",
    "v_policy_id", "v_session_id", "v_job_id"
  ];
  for (const id of generatedIds) {
    const assignRe = new RegExp(`${id}\\s*:=\\s*gen_random_uuid\\(\\)`, "i");
    assert.ok(assignRe.test(reserveBody),
      `${id} is generated by gen_random_uuid() in reserve_analyzer_package`);
  }

  // ---- 5. Reservation file counts and exact paths enforced ----
  const finalizeBody = extractFunctionBody(sql, "finalize_analyzer_package");
  assert.ok(
    /jsonb_array_length\(p_files\)\s*<>\s*v_res\.file_count/i.test(finalizeBody),
    "finalize validates file count matches reservation"
  );
  assert.ok(
    /file_id_not_reserved/i.test(finalizeBody),
    "finalize rejects unreserved file IDs"
  );
  assert.ok(
    /storage_path_mismatch/i.test(finalizeBody),
    "finalize rejects mismatched storage paths"
  );
  assert.ok(
    /storage_path_foreign_account/i.test(finalizeBody),
    "finalize rejects foreign account paths"
  );
  assert.ok(
    /reserved_file_missing/i.test(finalizeBody),
    "finalize rejects incomplete file submissions"
  );
  assert.ok(
    /duplicate_file_ids/i.test(finalizeBody),
    "finalize rejects duplicate file IDs"
  );
  assert.ok(
    /invalid_sha256/i.test(finalizeBody),
    "finalize validates SHA-256 format"
  );
  assert.ok(
    /document_id_not_reserved/i.test(finalizeBody),
    "finalize validates document IDs against reservation"
  );

  // ---- 6. Worker claiming uses FOR UPDATE SKIP LOCKED ----
  const claimBody = extractFunctionBody(sql, "claim_analysis_jobs");
  assert.ok(
    /for\s+update\s+skip\s+locked/i.test(claimBody),
    "claim_analysis_jobs uses FOR UPDATE SKIP LOCKED"
  );

  // Claim also checks service_role (auth.uid() is not null => reject).
  assert.ok(
    /service_role_required/i.test(claimBody),
    "claim_analysis_jobs rejects non-service_role callers"
  );

  // Expired leases: reclaim only within attempt limit.
  assert.ok(
    /attempt_count\s*<\s*j\.max_attempts|attempt_count\s*<\s*max_attempts/i.test(claimBody),
    "claim_analysis_jobs enforces attempt limit for expired lease reclaim"
  );

  // ---- 7. All SECURITY DEFINER functions fix their search_path ----
  const definerFunctions = sql.match(
    /create\s+or\s+replace\s+function\s+(\w+)\([^)]*\)[^;]*?security\s+definer/gi
  ) || [];
  assert.ok(definerFunctions.length > 0, "At least one SECURITY DEFINER function found");

  const functionNames = definerFunctions.map(m => {
    const match = m.match(/function\s+(\w+)\(/i);
    return match ? match[1] : "";
  }).filter(Boolean);

  for (const fn of functionNames) {
    const body = extractFunctionBody(sql, fn);
    assert.ok(
      /set\s+search_path\s*=\s*public/i.test(
        sql.substring(
          sql.toLowerCase().indexOf(`function ${fn.toLowerCase()}(`),
          sql.toLowerCase().indexOf(`function ${fn.toLowerCase()}(`) + body.length + 500
        )
      ),
      `${fn} sets search_path = public`
    );
  }

  // Also verify the pre-existing helper functions from migration 2 set search_path.
  const migration2 = readFileSync(
    path.join(MIGRATION_DIR, "20260705145522_phase_1_rls_policies.sql"),
    "utf8"
  );
  for (const fn of ["app_is_account_member", "app_has_role", "app_is_staff"]) {
    const fnBlock = migration2.substring(
      migration2.toLowerCase().indexOf(`function ${fn}(`),
      migration2.toLowerCase().indexOf(`function ${fn}(`) + 500
    );
    assert.ok(
      /set\s+search_path\s*=\s*public/i.test(fnBlock),
      `Pre-existing ${fn} sets search_path = public`
    );
  }

  // ---- 8. Complete job verifies lease, rejects cancelled, idempotent ----
  const completeBody = extractFunctionBody(sql, "complete_analysis_job");
  assert.ok(
    /lease_mismatch/i.test(completeBody),
    "complete_analysis_job verifies active lease"
  );
  assert.ok(
    /job_cancelled/i.test(completeBody),
    "complete_analysis_job rejects cancelled jobs"
  );
  assert.ok(
    /v_job\.status\s*=\s*'completed'/i.test(completeBody),
    "complete_analysis_job is idempotent for already-completed jobs"
  );

  // ---- 9. Worker functions check service_role ----
  for (const fn of workerFunctions) {
    const body = extractFunctionBody(sql, fn);
    assert.ok(
      /auth\.uid\(\)\s+is\s+not\s+null/i.test(body),
      `${fn} checks auth.uid() is not null to verify service_role`
    );
    assert.ok(
      /service_role_required/i.test(body),
      `${fn} raises service_role_required`
    );
  }

  // ---- 10. Reservation expiry enforced in finalize ----
  assert.ok(
    /reservation_expired/i.test(finalizeBody),
    "finalize rejects expired reservations"
  );
  assert.ok(
    /reservation_already_used/i.test(finalizeBody),
    "finalize rejects already-used reservations"
  );
  assert.ok(
    /reservation_owner_mismatch/i.test(finalizeBody),
    "finalize rejects wrong owner"
  );

  // ---- 11. app_config not executable by authenticated ----
  assert.ok(
    /revoke\s+all\s+on\s+function\s+app_config[^;]*from\s+authenticated/i.test(sql),
    "app_config revoked from authenticated"
  );

  console.log("DB-AUTH REGRESSION OK");
  console.log(`  Migration: ${path.basename(JOBS_MIGRATION)}`);
  console.log(`  DEFINER functions verified: ${functionNames.join(", ")}`);
  console.log(`  Worker functions (service_role only): ${workerFunctions.join(", ")}`);
  console.log(`  Protected tables: ${protectedTables.join(", ")}`);
}

function extractFunctionBody(sql: string, fnName: string): string {
  const lower = sql.toLowerCase();
  const start = lower.indexOf(`function ${fnName.toLowerCase()}(`);
  if (start === -1) return "";
  const dollarStart = sql.indexOf("$$", start);
  if (dollarStart === -1) return "";
  const dollarEnd = sql.indexOf("$$", dollarStart + 2);
  if (dollarEnd === -1) return "";
  return sql.substring(dollarStart + 2, dollarEnd);
}

main();
