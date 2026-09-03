import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Database-authorization regression for the durable jobs migration.
// Static analysis of the SQL migration verifies grants, revocations,
// tuple validation, storage fail-closed, lease ownership, and constraints.
// Live EXECUTE/RLS behavior requires a Postgres runtime.
// ---------------------------------------------------------------------------

const MIGRATION_DIR = path.resolve(process.cwd(), "../../supabase/migrations");
const JOBS_MIGRATION = path.join(MIGRATION_DIR, "20260903150000_durable_analysis_jobs.sql");

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractFunctionBody(sql: string, fnName: string): string {
  const lower = sql.toLowerCase();
  const needles = [
    `create or replace function ${fnName.toLowerCase()}(`,
    `create function ${fnName.toLowerCase()}(`
  ];
  let start = -1;
  for (const needle of needles) {
    let from = 0;
    while (true) {
      const next = lower.indexOf(needle, from);
      if (next === -1) break;
      start = next;
      from = next + needle.length;
    }
  }
  if (start === -1) return "";
  const dollarStart = sql.indexOf("$$", start);
  if (dollarStart === -1) return "";
  const dollarEnd = sql.indexOf("$$", dollarStart + 2);
  if (dollarEnd === -1) return "";
  return sql.substring(dollarStart + 2, dollarEnd);
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function readAllMigrations(): string {
  return readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(path.join(MIGRATION_DIR, name), "utf8"))
    .join("\n");
}

function parseCreateTableColumns(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const stripped = stripSqlComments(sql);
  const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(stripped))) {
    const table = match[1];
    let depth = 1;
    let i = match.index + match[0].length;
    let body = "";
    while (i < stripped.length && depth > 0) {
      const ch = stripped[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
      body += ch;
      i += 1;
    }
    const cols = tables.get(table) ?? new Set<string>();
    for (const part of body.split(",")) {
      const token = part.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      if (
        !token ||
        ["unique", "check", "primary", "constraint", "foreign", "exclude", "like"].includes(token)
      ) {
        continue;
      }
      cols.add(token.replace(/"/g, ""));
    }
    tables.set(table, cols);
  }
  const alterRe =
    /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;
  while ((match = alterRe.exec(stripped))) {
    const cols = tables.get(match[1]) ?? new Set<string>();
    cols.add(match[2].toLowerCase());
    tables.set(match[1], cols);
  }
  return tables;
}

function parseTriggerFunctions(sql: string): Map<string, Set<string>> {
  const functions = new Map<string, Set<string>>();
  const stripped = stripSqlComments(sql);
  const fnRe =
    /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([^)]*\)\s*returns\s+trigger/gi;
  let match: RegExpExecArray | null;
  while ((match = fnRe.exec(stripped))) {
    const name = match[1].toLowerCase();
    const body = extractFunctionBody(sql, name);
    const cols = new Set<string>();
    const colRe = /\b(?:new|old)\.([a-z_][a-z0-9_]*)/gi;
    let colMatch: RegExpExecArray | null;
    while ((colMatch = colRe.exec(body))) {
      cols.add(colMatch[1].toLowerCase());
    }
    functions.set(name, cols);
  }
  return functions;
}

function parseTriggerAttachments(sql: string): Array<{ table: string; fn: string; name: string }> {
  const attachments: Array<{ table: string; fn: string; name: string }> = [];
  const stripped = stripSqlComments(sql);
  const triggerRe =
    /create\s+trigger\s+([a-z_][a-z0-9_]*)\s+before\s+update\s+on\s+(?:public\.)?([a-z_][a-z0-9_]*)[\s\S]*?execute\s+(?:function|procedure)\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = triggerRe.exec(stripped))) {
    attachments.push({
      name: match[1].toLowerCase(),
      table: match[2].toLowerCase(),
      fn: match[3].toLowerCase()
    });
  }
  const dynamicRe =
    /foreach\s+(\w+)\s+in\s+array\s+array\[([^\]]+)\][\s\S]*?create\s+trigger\s+([a-z_][a-z0-9_]*)[^']*on\s+%I[^']*execute\s+function\s+([a-z_][a-z0-9_]*)\s*\(/gi;
  while ((match = dynamicRe.exec(stripped))) {
    const tables = match[2]
      .split(",")
      .map((item) => item.trim().replace(/^'|'$/g, "").toLowerCase())
      .filter(Boolean);
    for (const table of tables) {
      attachments.push({
        name: match[3].toLowerCase(),
        table,
        fn: match[4].toLowerCase()
      });
    }
  }
  return attachments;
}

function assertTriggerColumnCompatibility(allSql: string) {
  const tables = parseCreateTableColumns(allSql);
  const functions = parseTriggerFunctions(allSql);
  const attachments = parseTriggerAttachments(allSql);
  assert.ok(attachments.length > 0, "At least one UPDATE trigger attachment must exist");

  const byTable = new Map<string, Array<{ fn: string; name: string }>>();
  for (const attachment of attachments) {
    const cols = tables.get(attachment.table);
    assert.ok(cols, `Trigger ${attachment.name} targets unknown table ${attachment.table}`);
    const referenced = functions.get(attachment.fn);
    assert.ok(
      referenced,
      `Trigger ${attachment.name} on ${attachment.table} executes unknown trigger function ${attachment.fn}`
    );
    for (const col of referenced) {
      assert.ok(
        cols!.has(col),
        `Trigger function ${attachment.fn} referenced ${col} which is absent from ${attachment.table}`
      );
    }
    const list = byTable.get(attachment.table) ?? [];
    list.push({ fn: attachment.fn, name: attachment.name });
    byTable.set(attachment.table, list);
  }

  const jobFns = byTable.get("analysis_jobs") ?? [];
  assert.ok(
    jobFns.some((item) => item.fn === "reject_analysis_job_identity_mutation"),
    "analysis_jobs must use reject_analysis_job_identity_mutation"
  );
  assert.equal(
    jobFns.some((item) => item.fn === "reject_ownership_mutation"),
    false,
    "analysis_jobs must not use generic reject_ownership_mutation"
  );

  const reservationFns = byTable.get("upload_reservations") ?? [];
  assert.ok(
    reservationFns.some((item) => item.fn === "reject_upload_reservation_identity_mutation"),
    "upload_reservations must use reject_upload_reservation_identity_mutation"
  );
  assert.equal(
    reservationFns.some((item) => item.fn === "reject_ownership_mutation"),
    false,
    "upload_reservations must not use generic reject_ownership_mutation"
  );

  const fileFns = byTable.get("upload_reservation_files") ?? [];
  assert.equal(
    fileFns.some((item) => item.fn === "reject_ownership_mutation"),
    false,
    "upload_reservation_files must not use generic reject_ownership_mutation"
  );

  const usageFns = byTable.get("account_usage_windows") ?? [];
  assert.ok(
    usageFns.some((item) => item.fn === "reject_usage_account_change"),
    "account_usage_windows must use reject_usage_account_change"
  );
}

function main() {
  const sql = readAllMigrations();
  const normalized = normalizeWhitespace(sql);

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

    assert.equal(insertGrantRe.test(sql), false, `No INSERT grant to authenticated on ${table}`);
    assert.equal(updateGrantRe.test(sql), false, `No UPDATE grant to authenticated on ${table}`);
    assert.equal(deleteGrantRe.test(sql), false, `No DELETE grant to authenticated on ${table}`);
  }

  for (const table of protectedTables) {
    assert.ok(
      normalized.includes(`revoke all on ${table} from authenticated`)
      || normalized.includes(`revoke insert, update, delete on ${table} from authenticated`),
      `Revoke on ${table} for authenticated must exist`
    );
  }

  assert.equal(/create\s+policy\s+\S+\s+on\s+analysis_jobs\s+for\s+insert/i.test(sql), false, "No INSERT RLS policy on analysis_jobs");
  assert.equal(/create\s+policy\s+\S+\s+on\s+analysis_jobs\s+for\s+update/i.test(sql), false, "No UPDATE RLS policy on analysis_jobs");
  assert.equal(/create\s+policy\s+\S+\s+on\s+analysis_jobs\s+for\s+delete/i.test(sql), false, "No DELETE RLS policy on analysis_jobs");

  for (const table of ["account_usage_windows", "analyzer_runtime_config"]) {
    const anyPolicy = new RegExp(`create\\s+policy\\s+\\S+\\s+on\\s+${table}`, "i");
    assert.equal(anyPolicy.test(sql), false, `No RLS policy at all on ${table}`);
  }

  assert.equal(/create\s+policy\s+\S+\s+on\s+upload_reservations/i.test(sql), false, "No RLS policy on upload_reservations");
  assert.equal(/create\s+policy\s+\S+\s+on\s+upload_reservation_files/i.test(sql), false, "No RLS policy on upload_reservation_files");

  for (const table of ["upload_reservations", "upload_reservation_files"]) {
    assert.ok(
      new RegExp(`revoke\\s+all\\s+on\\s+${table}\\s+from\\s+public`, "i").test(sql),
      `Revoke ALL on ${table} from PUBLIC`
    );
    assert.ok(
      new RegExp(`revoke\\s+all\\s+on\\s+${table}\\s+from\\s+anon`, "i").test(sql),
      `Revoke ALL on ${table} from anon`
    );
    assert.ok(
      new RegExp(`revoke\\s+all\\s+on\\s+${table}\\s+from\\s+authenticated`, "i").test(sql),
      `Revoke ALL on ${table} from authenticated`
    );
  }

  const workerFunctions = [
    { name: "claim_analysis_jobs", args: "text, integer" },
    { name: "heartbeat_analysis_job", args: "uuid, text" },
    { name: "update_job_progress", args: "uuid, text, text, integer, integer, integer" },
    { name: "fail_analysis_job", args: "uuid, text, text, text, boolean" },
    { name: "complete_analysis_job", args: "uuid, text, jsonb" },
    { name: "analyzer_ops_snapshot", args: "" },
    { name: "analyzer_schema_version", args: "" }
  ];

  for (const fn of workerFunctions) {
    const grantAuth = new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+${fn.name}[^;]*to\\s+authenticated`,
      "i"
    );
    const grantAnon = new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+${fn.name}[^;]*to\\s+anon`,
      "i"
    );
    const grantPublic = new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+${fn.name}[^;]*to\\s+public`,
      "i"
    );
    assert.equal(grantAuth.test(sql), false, `No EXECUTE grant to authenticated on ${fn.name}`);
    assert.equal(grantAnon.test(sql), false, `No EXECUTE grant to anon on ${fn.name}`);
    assert.equal(grantPublic.test(sql), false, `No EXECUTE grant to PUBLIC on ${fn.name}`);

    assert.ok(
      new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${fn.name}[^;]*from\\s+public`, "i").test(sql),
      `REVOKE ALL from PUBLIC on ${fn.name}`
    );
    assert.ok(
      new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${fn.name}[^;]*from\\s+anon`, "i").test(sql),
      `REVOKE ALL from anon on ${fn.name}`
    );
    assert.ok(
      new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${fn.name}[^;]*from\\s+authenticated`, "i").test(sql),
      `REVOKE ALL from authenticated on ${fn.name}`
    );
    assert.ok(
      new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+${fn.name}\\s*\\(\\s*${fn.args.replace(/, /g, ",\\s*")}\\s*\\)\\s+to\\s+service_role`,
        "i"
      ).test(sql),
      `GRANT EXECUTE to service_role on ${fn.name}`
    );
  }

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

  const reserveBody = extractFunctionBody(sql, "reserve_analyzer_package");
  const generatedIds = [
    "v_reservation_id", "v_upload_id", "v_analysis_id",
    "v_policy_id", "v_session_id", "v_job_id"
  ];
  for (const id of generatedIds) {
    const assignRe = new RegExp(`${id}\\s*:=\\s*gen_random_uuid\\(\\)`, "i");
    assert.ok(assignRe.test(reserveBody), `${id} is generated by gen_random_uuid() in reserve_analyzer_package`);
  }

  assert.ok(
    /from upload_reservations[\s\S]*status = 'pending'[\s\S]*expires_at > now\(\)/i.test(reserveBody)
    || /upload_reservations[\s\S]*pending[\s\S]*expires_at > now\(\)/i.test(reserveBody),
    "reserve_analyzer_package counts unexpired pending reservations in backlog"
  );
  assert.ok(
    /status in \('queued',\s*'processing'\)/i.test(reserveBody),
    "reserve_analyzer_package counts queued and processing jobs in backlog"
  );
  assert.ok(
    /perform 1 from accounts where account_id = v_acc for update/i.test(reserveBody),
    "reserve_analyzer_package serializes quota decisions with an account lock"
  );

  assert.ok(
    /create table upload_reservation_files/i.test(sql),
    "reserved files live in upload_reservation_files"
  );
  assert.ok(
    /unique\s*\(\s*reservation_id\s*,\s*ordinal\s*\)/i.test(sql),
    "reservation files unique on (reservation_id, ordinal)"
  );
  assert.ok(/unique\s*\(\s*file_id\s*\)/i.test(sql), "reservation files unique on file_id");
  assert.ok(/unique\s*\(\s*document_id\s*\)/i.test(sql), "reservation files unique on document_id");
  assert.ok(/unique\s*\(\s*storage_path\s*\)/i.test(sql), "reservation files unique on storage_path");

  const finalizeBody = extractFunctionBody(sql, "finalize_analyzer_package");
  assert.ok(
    /jsonb_array_length\(p_files\)\s*<>\s*v_res\.file_count/i.test(finalizeBody),
    "finalize validates file count matches reservation"
  );
  assert.ok(/reserved_tuple_mismatch/i.test(finalizeBody), "finalize rejects swapped reserved tuples");
  assert.ok(/storage_path_foreign_account/i.test(finalizeBody), "finalize rejects foreign account paths");
  assert.ok(/reserved_file_missing/i.test(finalizeBody), "finalize rejects incomplete file submissions");
  assert.ok(/duplicate_file_ids/i.test(finalizeBody), "finalize rejects duplicate file IDs");
  assert.ok(/duplicate_document_ids/i.test(finalizeBody), "finalize rejects duplicate document IDs");
  assert.ok(/duplicate_storage_paths/i.test(finalizeBody), "finalize rejects duplicate storage paths");
  assert.ok(/invalid_sha256/i.test(finalizeBody), "finalize validates SHA-256 format");
  assert.ok(
    /file_id = v_file_id\s+and\s+document_id = v_doc_id\s+and\s+storage_path = v_path/i.test(finalizeBody),
    "finalize matches the exact reserved (file_id, document_id, storage_path) tuple"
  );
  assert.ok(
    /to_regclass\('storage\.objects'\) is null/i.test(finalizeBody),
    "finalize fails closed when storage.objects is unavailable"
  );
  assert.ok(/storage_unavailable/i.test(finalizeBody), "finalize raises storage_unavailable");
  assert.ok(
    /from storage\.objects\s+where bucket_id = 'policy-files' and name = v_path/i.test(finalizeBody),
    "finalize requires every reserved object in policy-files at its exact path"
  );
  assert.ok(
    !/if to_regclass\('storage\.objects'\) is null then[\s\S]{0,80}null;\s*else/i.test(finalizeBody),
    "finalize must not skip object verification when Storage is missing"
  );

  const claimBody = extractFunctionBody(sql, "claim_analysis_jobs");
  assert.ok(/for\s+update\s+skip\s+locked/i.test(claimBody), "claim_analysis_jobs uses FOR UPDATE SKIP LOCKED");
  assert.ok(/service_role_required/i.test(claimBody), "claim_analysis_jobs rejects non-service_role callers");
  assert.ok(/invalid_claim_limit/i.test(claimBody), "claim_analysis_jobs bounds the batch limit");
  assert.ok(/attempts_exhausted/i.test(claimBody), "claim_analysis_jobs terminalizes exhausted expired jobs");
  assert.ok(
    /attempt_count\s*<\s*j\.max_attempts|attempt_count\s*<\s*max_attempts/i.test(claimBody),
    "claim_analysis_jobs enforces attempt limit for expired lease reclaim"
  );

  const definerFunctions = sql.match(
    /create\s+or\s+replace\s+function\s+(\w+)\([^)]*\)[^;]*?security\s+definer/gi
  ) || [];
  assert.ok(definerFunctions.length > 0, "At least one SECURITY DEFINER function found");

  const functionNames = definerFunctions.map((m) => {
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

  const migration2 = readFileSync(
    path.join(MIGRATION_DIR, "20260705145522_phase_1_rls_policies.sql"),
    "utf8"
  );
  for (const fn of ["app_is_account_member", "app_has_role", "app_is_staff"]) {
    const fnBlock = migration2.substring(
      migration2.toLowerCase().indexOf(`function ${fn}(`),
      migration2.toLowerCase().indexOf(`function ${fn}(`) + 500
    );
    assert.ok(/set\s+search_path\s*=\s*public/i.test(fnBlock), `Pre-existing ${fn} sets search_path = public`);
  }

  const completeBody = extractFunctionBody(sql, "complete_analysis_job");
  assert.ok(/lease_mismatch/i.test(completeBody), "complete_analysis_job verifies active lease");
  assert.ok(/job_cancelled/i.test(completeBody), "complete_analysis_job rejects cancelled jobs");
  assert.ok(/v_job\.status in \('completed',\s*'needs_review'\)/i.test(completeBody), "complete_analysis_job is idempotent for already-completed jobs");
  assert.ok(
    /analyzer_report_binding_error\(v_job\.job_id, v_stored\)/i.test(completeBody),
    "idempotent completion requires the stored report to be bound to the job"
  );
  assert.ok(
    /on conflict \(policy_analysis_id, section_key\)/i.test(completeBody),
    "complete_analysis_job cannot create duplicate analyzer_report_v1 sections"
  );
  assert.ok(
    /v_bind := analyzer_report_binding_error\(p_job_id, p_report\)/i.test(completeBody),
    "complete_analysis_job validates the incoming report inside the locked transaction"
  );
  assert.ok(
    completeBody.toLowerCase().indexOf("v_bind := analyzer_report_binding_error")
      < completeBody.toLowerCase().indexOf("insert into report_sections"),
    "complete rejects mismatched reports before inserting"
  );
  assert.ok(
    /insert into report_sections/i.test(completeBody)
    && /set status = v_outcome/i.test(completeBody)
    && completeBody.toLowerCase().indexOf("insert into report_sections")
      < completeBody.toLowerCase().indexOf("set status = v_outcome"),
    "complete marks the job complete only after the report write in the same function"
  );

  const progressBody = extractFunctionBody(sql, "update_job_progress");
  assert.ok(/downloading/.test(progressBody) && /extracting/.test(progressBody), "progress stages include downloading and extracting");
  assert.ok(/analyzing/.test(progressBody) && /finalizing/.test(progressBody), "progress stages include analyzing and finalizing");
  assert.ok(/least\(document_count/.test(progressBody), "progress cannot exceed document_count");

  const bindBody = extractFunctionBody(sql, "analyzer_report_binding_error");
  assert.ok(/report_policy_mismatch/i.test(bindBody), "binding rejects the wrong policy ID");
  assert.ok(/report_session_mismatch/i.test(bindBody), "binding rejects the wrong session ID");
  assert.ok(/report_foreign_document/i.test(bindBody), "binding rejects foreign document IDs");
  assert.ok(/report_missing_document/i.test(bindBody), "binding rejects missing documents");
  assert.ok(/report_duplicate_document_ids/i.test(bindBody), "binding rejects duplicate document IDs");
  assert.ok(/uploaded_policy_files/i.test(bindBody), "binding compares against uploaded files for the analysis");
  assert.ok(
    /'\{\}'::uuid\[\]/i.test(bindBody),
    "binding empty document arrays are typed uuid[] so EXCEPT cannot mix integer and uuid"
  );
  assert.equal(
    /select\s+1\s+from\s+unnest\(/i.test(bindBody),
    false,
    "binding EXCEPT must compare document UUIDs, not SELECT 1"
  );
  assert.ok(
    /select\s+unnest\(v_report_ids\)\s+except\s+select\s+unnest\(v_file_ids\)/i.test(bindBody),
    "binding EXCEPT compares report document IDs to uploaded file IDs"
  );
  assert.ok(
    /revoke\s+all\s+on\s+function\s+analyzer_report_binding_error[^;]*from\s+authenticated/i.test(sql),
    "report binding helper is not executable by authenticated"
  );

  for (const fn of ["heartbeat_analysis_job", "update_job_progress", "fail_analysis_job", "complete_analysis_job"]) {
    const body = extractFunctionBody(sql, fn);
    assert.ok(/status = 'processing'|status <> 'processing'/i.test(body), `${fn} requires processing status`);
    assert.ok(/lease_owner/i.test(body), `${fn} requires matching lease owner`);
    assert.ok(
      /lease_expires_at is not null|lease_expires_at is null/i.test(body),
      `${fn} requires a non-null lease expiry`
    );
    assert.ok(
      /lease_expires_at > now\(\)|lease_expires_at <= now\(\)/i.test(body),
      `${fn} compares lease expiry to database now()`
    );
  }

  for (const fn of workerFunctions) {
    const body = extractFunctionBody(sql, fn.name);
    assert.ok(/auth\.uid\(\)\s+is\s+not\s+null/i.test(body), `${fn.name} keeps auth.uid() IS NULL as defense in depth`);
    assert.ok(/service_role_required/i.test(body), `${fn.name} raises service_role_required`);
  }

  assert.ok(/reservation_expired/i.test(finalizeBody), "finalize rejects expired reservations");
  assert.ok(/reservation_already_used/i.test(finalizeBody), "finalize rejects already-used reservations");
  assert.ok(/reservation_owner_mismatch/i.test(finalizeBody), "finalize rejects wrong owner");

  assert.ok(
    /revoke\s+all\s+on\s+function\s+app_config[^;]*from\s+authenticated/i.test(sql),
    "app_config revoked from authenticated"
  );

  assert.ok(/unique\s*\(\s*analysis_id\s*\)/i.test(sql), "one durable job per analysis");
  assert.ok(/unique\s*\(\s*policy_id\s*\)/i.test(sql), "one durable job per policy");
  assert.ok(
    /max_attempts\s+integer not null default 3 check \(max_attempts between 1 and 20\)/i.test(sql),
    "max_attempts is positive and bounded"
  );
  assert.ok(/document_count\s+integer not null default 0 check \(document_count >= 0\)/i.test(sql));
  assert.ok(/documents_processed\s+integer not null default 0 check \(documents_processed >= 0\)/i.test(sql));
  assert.ok(/pages_processed\s+integer not null default 0 check \(pages_processed >= 0\)/i.test(sql));
  assert.ok(/file_count\s+integer not null check \(file_count between 1 and 10\)/i.test(sql));
  assert.ok(
    /status = 'processing' and lease_owner is not null and lease_expires_at is not null/i.test(sql),
    "processing jobs must hold a lease"
  );
  assert.ok(
    /create unique index if not exists idx_report_sections_analysis_key/i.test(sql),
    "report_sections unique on (policy_analysis_id, section_key)"
  );

  const statusBody = extractFunctionBody(sql, "get_own_job_status");
  assert.ok(/error_code',\s*'report_unavailable'/i.test(statusBody), "missing job returns report_unavailable");
  assert.ok(/status',\s*'failed'/i.test(statusBody), "missing job returns failed status");
  assert.ok(
    /v_job\.status in \('completed',\s*'needs_review'\)/i.test(statusBody),
    "get_own_job_status gates completed and needs_review on a bound report"
  );
  assert.ok(
    /analyzer_report_binding_error\(v_job\.job_id, v_payload\)/i.test(statusBody),
    "get_own_job_status validates analyzer_report_v1 before returning completed"
  );
  assert.ok(
    /section_key = 'analyzer_report_v1'/i.test(statusBody),
    "get_own_job_status loads the analyzer_report_v1 payload"
  );
  assert.ok(
    !/row\.record|legacy|infer.*completed/i.test(statusBody),
    "status RPC does not infer completion from a report row"
  );

  const storeSource = readFileSync(
    path.resolve(process.cwd(), "lib/persistence/supabase-store.ts"),
    "utf8"
  );
  assert.equal(
    /persist_analyzer_package/.test(storeSource),
    false,
    "SupabasePolicyStore no longer calls persist_analyzer_package"
  );
  const fixtureSource = readFileSync(
    path.resolve(process.cwd(), "app/api/fixture/run/route.ts"),
    "utf8"
  );
  assert.equal(/ingestPdfBuffer|ingestPolicyPackage/.test(fixtureSource), false);
  assert.ok(/enqueuePolicyPackage/.test(fixtureSource));

  const jobIdentityBody = extractFunctionBody(sql, "reject_analysis_job_identity_mutation");
  assert.ok(jobIdentityBody, "reject_analysis_job_identity_mutation must exist");
  for (const col of ["account_id", "owner_user_id", "policy_id", "analysis_id"]) {
    assert.ok(
      new RegExp(`new\\.${col}\\s+is distinct from\\s+old\\.${col}`, "i").test(jobIdentityBody),
      `analysis_jobs identity trigger must reject ${col} changes`
    );
  }
  assert.equal(
    /new\.user_id|old\.user_id/i.test(jobIdentityBody),
    false,
    "analysis_jobs identity trigger must not reference user_id"
  );
  assert.equal(
    /new\.(status|lease_owner|lease_expires_at|stage|error_code)/i.test(jobIdentityBody),
    false,
    "analysis_jobs identity trigger must not freeze status or lease columns"
  );

  const reservationIdentityBody = extractFunctionBody(sql, "reject_upload_reservation_identity_mutation");
  assert.ok(reservationIdentityBody, "reject_upload_reservation_identity_mutation must exist");
  for (const col of ["account_id", "owner_user_id", "upload_id", "analysis_id", "policy_id", "session_id", "job_id"]) {
    assert.ok(
      new RegExp(`new\\.${col}\\s+is distinct from\\s+old\\.${col}`, "i").test(reservationIdentityBody),
      `upload_reservations identity trigger must reject ${col} changes`
    );
  }
  assert.equal(
    /new\.user_id|old\.user_id/i.test(reservationIdentityBody),
    false,
    "upload_reservations identity trigger must not reference user_id"
  );
  assert.equal(
    /new\.(status|expires_at|finalized_at)/i.test(reservationIdentityBody),
    false,
    "upload_reservations identity trigger must not freeze status, expiry, or finalized_at"
  );

  assert.equal(
    /create\s+trigger\s+\S+\s+before\s+update\s+on\s+analysis_jobs[\s\S]{0,120}reject_ownership_mutation/i.test(sql),
    false,
    "analysis_jobs must not attach generic reject_ownership_mutation"
  );
  assert.equal(
    /create\s+trigger\s+\S+\s+before\s+update\s+on\s+upload_reservations[\s\S]{0,120}reject_ownership_mutation/i.test(sql),
    false,
    "upload_reservations must not attach generic reject_ownership_mutation"
  );
  assert.ok(
    /create\s+trigger\s+trg_reject_analysis_job_identity_mutation\s+before\s+update\s+on\s+analysis_jobs/i.test(sql),
    "analysis_jobs must attach trg_reject_analysis_job_identity_mutation"
  );
  assert.ok(
    /create\s+trigger\s+trg_reject_upload_reservation_identity_mutation\s+before\s+update\s+on\s+upload_reservations/i.test(sql),
    "upload_reservations must attach trg_reject_upload_reservation_identity_mutation"
  );

  const allSql = readAllMigrations();
  assertTriggerColumnCompatibility(allSql);

  const genericBody = extractFunctionBody(allSql, "reject_ownership_mutation");
  assert.ok(/new\.user_id is distinct from old\.user_id/i.test(genericBody));
  const genericTables = [
    "uploads", "uploaded_policy_files", "extracted_text_pages", "source_mappings",
    "policy_analyses", "policies", "horses", "clause_objects", "coverage_objects",
    "exclusion_objects", "condition_obligation_objects", "clause_links",
    "coverage_clause_links", "coverage_exclusion_links", "coverage_condition_links",
    "coverage_horse_links", "missing_items", "conflict_records", "conflict_clause_links",
    "confidence_results", "verification_results", "generated_answers", "report_sections",
    "form_inventory_items", "audit_events", "review_queue_entries", "deletion_receipts"
  ];
  const allTables = parseCreateTableColumns(allSql);
  for (const table of genericTables) {
    const cols = allTables.get(table);
    assert.ok(cols, `generic ownership table ${table} must exist`);
    assert.ok(cols!.has("account_id"), `${table} must have account_id`);
    assert.ok(cols!.has("user_id"), `${table} must have user_id for reject_ownership_mutation`);
  }

  console.log("DB-AUTH REGRESSION OK");
  console.log(`  Migration: ${path.basename(JOBS_MIGRATION)}`);
  console.log(`  DEFINER functions verified: ${functionNames.join(", ")}`);
  console.log(`  Worker functions (service_role only): ${workerFunctions.map((fn) => fn.name).join(", ")}`);
  console.log(`  Protected tables: ${protectedTables.join(", ")}`);
  console.log("  LIVE DATABASE VERIFICATION PENDING");
}

main();
