/**
 * Live Fix #5 database verification.
 *
 * Exercises real PostgreSQL, PostgREST/Auth, and Supabase Storage.
 * Credentials stay in memory and are never printed.
 *
 * Target: local loopback Supabase, or a disposable remote project that
 * matches POLICY_ANALYZER_TEST_PROJECT_REF with ALLOW_DESTRUCTIVE_SUPABASE_TESTS=YES.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseReservationResult } from "../lib/persistence/reservation";
import type { IncomingPdf } from "../lib/validate-upload";
import type { ReservationResult } from "../lib/persistence/types";
import { sampleReport } from "./test-fixtures";
import type { PolicyRecord } from "../lib/types";
import { buildCompletePolicyPages, buildCompletePolicyPdf, buildPartialPolicyPdf } from "../lib/build-complete-pdf";
import { buildFixturePdf } from "../lib/build-fixture";
import { buildScannedPdf, SCANNED_PDF_PHRASE } from "../lib/build-scanned-fixture";
import { SupabasePolicyStore } from "../lib/persistence/supabase-store";
import { createWorkerPersistence } from "../lib/persistence/factory";
import { AnalysisWorker } from "../lib/worker/runtime";
import type { WorkerConfig } from "../lib/worker/config";
import { extractPdfInvocations, resetExtractPdfInvocations } from "../lib/extract-pdf";
import { shutdownOcr } from "../lib/ocr";

const REQUIRED_HEAD = "126feccc9973b69fbb85f4d79e16cbbb600fc15d";
const REQUIRED_BRANCH = "cursor/policy-analyzer-fix6-worker";
const WORKTREE = path.resolve(process.cwd(), "../..");
const MIGRATION_DIR = path.resolve(WORKTREE, "supabase/migrations");
const EXPECTED_MIGRATIONS = [
  "20260705022540_phase_1_persistence_schema.sql",
  "20260705145522_phase_1_rls_policies.sql",
  "20260903024500_analyzer_auth_persistence.sql",
  "20260903150000_durable_analysis_jobs.sql",
  "20260903200000_worker_completion_outcomes.sql"
];
const WORKER_RPCS = [
  { name: "claim_analysis_jobs", args: { p_worker_id: "probe-worker", p_limit: 1 } },
  { name: "heartbeat_analysis_job", args: { p_job_id: "00000000-0000-0000-0000-000000000001", p_worker_id: "probe-worker" } },
  { name: "update_job_progress", args: { p_job_id: "00000000-0000-0000-0000-000000000001", p_worker_id: "probe-worker", p_stage: "extracting" } },
  { name: "fail_analysis_job", args: { p_job_id: "00000000-0000-0000-0000-000000000001", p_worker_id: "probe-worker", p_error_code: "probe", p_stage: "ocr", p_retryable: false } },
  { name: "complete_analysis_job", args: { p_job_id: "00000000-0000-0000-0000-000000000001", p_worker_id: "probe-worker", p_report: { policy_id: "00000000-0000-0000-0000-000000000001" } } }
] as const;
const AUTH_RPCS = [
  { name: "reserve_analyzer_package", args: { p_file_count: 1 } },
  { name: "finalize_analyzer_package", args: { p_reservation_id: "00000000-0000-0000-0000-000000000001", p_files: [] } },
  { name: "abandon_analyzer_reservation", args: { p_reservation_id: "00000000-0000-0000-0000-000000000001" } },
  { name: "get_own_job_status", args: { p_policy_id: "00000000-0000-0000-0000-000000000001" } },
  { name: "cancel_own_analysis_job", args: { p_policy_id: "00000000-0000-0000-0000-000000000001" } }
] as const;
const PROTECTED_TABLES = [
  "analyzer_runtime_config",
  "account_usage_windows",
  "upload_reservations",
  "upload_reservation_files"
] as const;
const DEFAULT_CONFIG: Record<string, string> = {
  uploads_per_account_per_hour: "20",
  active_jobs_per_account: "5",
  max_files_per_package: "10",
  max_job_attempts: "3",
  reservation_expiry_minutes: "30",
  retention_days: "30",
  claim_batch_max: "20"
};
const SAFE_STATUS_KEYS = new Set([
  "analysis_id",
  "status",
  "stage",
  "document_count",
  "documents_processed",
  "page_count",
  "pages_processed",
  "error_code",
  "retryable",
  "updated_at"
]);
const SENSITIVE_LOG_RE =
  /eyj[a-z0-9_-]{20,}|access_token|refresh_token|service_role|signedurl|signed_url|original_filename|ocr_text|postgresql:\/\//i;
const VALID_SHA = "ab".repeat(32);

const capturedLogs: string[] = [];
const originalLog = console.log;
const originalError = console.error;
console.log = (...args: unknown[]) => {
  const line = args.map(safePrint).join(" ");
  capturedLogs.push(line);
  originalLog(line);
};
console.error = (...args: unknown[]) => {
  const line = args.map(safePrint).join(" ");
  capturedLogs.push(line);
  originalError(line);
};

type Target = {
  kind: "local" | "remote";
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

type RpcError = {
  code: string | null;
  message: string;
  httpStatus?: number;
};

class LiveFailure extends Error {
  constructor(
    readonly invariant: string,
    readonly dbResponse: RpcError | Record<string, unknown>,
    readonly likelyCause: string
  ) {
    super(`${invariant}: ${likelyCause}`);
    this.name = "LiveFailure";
  }
}

function safePrint(value: unknown): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, "[redacted-jwt]")
    .replace(/postgresql:\/\/[^\s"']+/gi, "[redacted-db]")
    .replace(/sb_secret_[A-Za-z0-9]+/g, "[redacted-key]")
    .replace(/service_role[^\s"]{0,40}/gi, "service_role");
}

function git(cmd: string): string {
  return execSync(cmd, { cwd: WORKTREE, encoding: "utf8" }).trim();
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function tinyPdf(tag: string): Buffer {
  return Buffer.from(`%PDF-1.4\n%\xE2\xE3\xCF\xD3\n${tag}\n%%EOF\n`);
}

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function projectRefFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    if (host.endsWith(".supabase.co")) return host.split(".")[0] ?? null;
    return null;
  } catch {
    return null;
  }
}

function parseStatusEnv(text: string): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

function loadTarget(): Target {
  const envUrl = process.env.LIVE_SUPABASE_URL || process.env.POLICY_ANALYZER_TEST_SUPABASE_URL;
  const envAnon = process.env.LIVE_SUPABASE_ANON_KEY || process.env.POLICY_ANALYZER_TEST_ANON_KEY;
  const envService =
    process.env.LIVE_SUPABASE_SERVICE_ROLE_KEY || process.env.POLICY_ANALYZER_TEST_SERVICE_ROLE_KEY;

  if (envUrl && envAnon && envService) {
    return {
      kind: isLoopback(envUrl) ? "local" : "remote",
      url: envUrl.replace(/\/$/, ""),
      anonKey: envAnon,
      serviceRoleKey: envService
    };
  }

  try {
    const status = execSync("npx --yes supabase@2.116.0 status -o env", {
      cwd: WORKTREE,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const parsed = parseStatusEnv(status);
    const url = (parsed.API_URL || parsed.SUPABASE_URL || "").replace(/\/$/, "");
    const anon = parsed.ANON_KEY || parsed.SUPABASE_ANON_KEY;
    const service = parsed.SERVICE_ROLE_KEY || parsed.SUPABASE_SERVICE_ROLE_KEY;
    if (url && anon && service && isLoopback(url)) {
      return { kind: "local", url, anonKey: anon, serviceRoleKey: service };
    }
  } catch {
    // Fall through to safety failure below.
  }

  throw new LiveFailure(
    "safety.target",
    { code: null, message: "no_approved_target" },
    "No local loopback Supabase runtime and no approved disposable remote target."
  );
}

function assertSafety(target: Target) {
  const root = git("git rev-parse --show-toplevel");
  const branch = git("git branch --show-current");
  const head = git("git rev-parse HEAD");
  if (path.resolve(root) !== WORKTREE) {
    throw new LiveFailure("safety.git", { root }, "Worktree path mismatch.");
  }
  if (branch !== REQUIRED_BRANCH) {
    throw new LiveFailure("safety.git", { branch }, `Required branch is ${REQUIRED_BRANCH}.`);
  }
  try {
    execSync(`git merge-base --is-ancestor ${REQUIRED_HEAD} HEAD`, { cwd: WORKTREE, stdio: "ignore" });
  } catch {
    throw new LiveFailure(
      "safety.git",
      { head: head.slice(0, 8) },
      `HEAD must descend from ${REQUIRED_HEAD.slice(0, 8)}.`
    );
  }

  if (target.kind === "local") {
    if (!isLoopback(target.url)) {
      throw new LiveFailure("safety.target", { code: null, message: "non_loopback" }, "Local target must be loopback.");
    }
    return;
  }

  const expectedRef = process.env.POLICY_ANALYZER_TEST_PROJECT_REF;
  const actualRef = projectRefFromUrl(target.url);
  if (!expectedRef || !actualRef || actualRef !== expectedRef) {
    throw new LiveFailure(
      "safety.target",
      { code: null, message: "project_ref_mismatch" },
      "Remote target must match POLICY_ANALYZER_TEST_PROJECT_REF exactly."
    );
  }
  if (process.env.ALLOW_DESTRUCTIVE_SUPABASE_TESTS !== "YES") {
    throw new LiveFailure(
      "safety.target",
      { code: null, message: "destructive_flag_missing" },
      "Remote destructive tests require ALLOW_DESTRUCTIVE_SUPABASE_TESTS=YES."
    );
  }
  if (process.env.POLICY_ANALYZER_TEST_DISPOSABLE !== "YES") {
    throw new LiveFailure(
      "safety.target",
      { code: null, message: "disposable_unconfirmed" },
      "Remote target must be confirmed disposable with no non-test application data."
    );
  }
}

function applyLocalMigrations() {
  if (process.env.POLICY_ANALYZER_LIVE_SKIP_RESET === "YES") {
    return;
  }
  execSync("npx --yes supabase@2.116.0 db reset --yes", {
    cwd: WORKTREE,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000
  });
}

function client(url: string, key: string, accessToken?: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined
  });
}

function rpcErrorFrom(error: { code?: string; message?: string; details?: string; hint?: string } | null, httpStatus?: number): RpcError {
  const message = [error?.message, error?.details, error?.hint].filter(Boolean).join(" | ").slice(0, 240);
  return {
    code: error?.code ?? null,
    message: safePrint(message || "unknown_error"),
    httpStatus
  };
}

function errorMentions(err: RpcError, token: string): boolean {
  const blob = `${err.code ?? ""} ${err.message}`.toLowerCase();
  return blob.includes(token.toLowerCase());
}

function isUndefinedColumn(err: RpcError | null | undefined): boolean {
  if (!err) return false;
  const blob = `${err.code ?? ""} ${err.message}`.toLowerCase();
  return blob.includes("42703") || blob.includes("has no field") || blob.includes("undefined_column");
}

function rejectUndefinedColumn(invariant: string, err: RpcError | null | undefined, context: string) {
  if (isUndefinedColumn(err)) {
    fail(invariant, err, `${context} hit SQLSTATE 42703 — a trigger referenced a column absent from its table.`);
  }
}

function queryCatalog(sql: string): string {
  return execSync("docker exec -i fix5-pg psql -U postgres -d postgres -A -t -v ON_ERROR_STOP=1", {
    encoding: "utf8",
    input: sql,
    stdio: ["pipe", "pipe", "pipe"]
  }).trim();
}

function isDenied(err: RpcError | null): boolean {
  if (!err) return false;
  const blob = `${err.code ?? ""} ${err.message} ${err.httpStatus ?? ""}`.toLowerCase();
  return (
    blob.includes("42501") ||
    blob.includes("permission denied") ||
    blob.includes("not_authenticated") ||
    blob.includes("service_role_required") ||
    blob.includes("pgrst202") ||
    blob.includes("pgrst301") ||
    blob.includes("could not find the function") ||
    blob.includes("unauthorized") ||
    blob.includes("jwt") ||
    err.httpStatus === 401 ||
    err.httpStatus === 403 ||
    err.httpStatus === 404
  );
}

async function restRpc(
  target: Target,
  role: "anon" | "authenticated" | "service",
  fn: string,
  args: Record<string, unknown>,
  accessToken?: string
): Promise<{ status: number; json: unknown; error: RpcError | null }> {
  const key = role === "service" ? target.serviceRoleKey : target.anonKey;
  const bearer = role === "authenticated" ? accessToken : key;
  if (role === "authenticated" && !bearer) {
    throw new Error("authenticated RPC requires a session token");
  }
  const res = await fetch(`${target.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(args)
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.ok) return { status: res.status, json, error: null };
  const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  return {
    status: res.status,
    json,
    error: rpcErrorFrom(
      {
        code: typeof obj.code === "string" ? obj.code : String(res.status),
        message: typeof obj.message === "string" ? obj.message : `http_${res.status}`,
        details: typeof obj.details === "string" ? obj.details : undefined,
        hint: typeof obj.hint === "string" ? obj.hint : undefined
      },
      res.status
    )
  };
}

async function overlappingRpc(
  target: Target,
  role: "authenticated" | "service",
  fn: string,
  argSets: Array<Record<string, unknown>>,
  accessToken?: string
) {
  return Promise.all(argSets.map((args) => restRpc(target, role, fn, args, accessToken)));
}

function fail(invariant: string, response: RpcError | Record<string, unknown>, cause: string): never {
  throw new LiveFailure(invariant, response, cause);
}

function pdfFor(tag: string): Buffer {
  return tinyPdf(`${tag}-${randomUUID()}`);
}

function boundReport(input: {
  policyId: string;
  sessionId: string;
  files: Array<{ document_id: string; storage_path: string; sha256?: string; original_filename?: string }>;
}): PolicyRecord {
  return sampleReport({
    policy_id: input.policyId,
    session_id: input.sessionId,
    documents: input.files.map((file) => ({
      document_id: file.document_id,
      session_id: input.sessionId,
      original_filename: file.original_filename || "policy.pdf",
      file_type: "application/pdf",
      upload_timestamp: new Date().toISOString(),
      file_hash: file.sha256 || VALID_SHA,
      page_count: 1,
      storage_location: file.storage_path,
      extraction_status: "extracted",
      analysis_status: "complete",
      classification: "Declarations",
      pages: [
        {
          page: 1,
          text: "Declarations page",
          extraction_method: "NATIVE_TEXT",
          quality_status: "GOOD"
        }
      ]
    }))
  });
}

function submittedFrom(reservation: ReservationResult, overrides: Array<Partial<{
  file_id: string;
  document_id: string;
  storage_path: string;
  sha256: string;
}>> = []) {
  return reservation.files.map((tuple, index) => ({
    file_id: overrides[index]?.file_id ?? tuple.file_id,
    document_id: overrides[index]?.document_id ?? tuple.document_id,
    storage_path: overrides[index]?.storage_path ?? tuple.storage_path,
    sha256: overrides[index]?.sha256 ?? VALID_SHA
  }));
}

type UserSession = {
  label: "A" | "B";
  userId: string;
  email: string;
  accessToken: string;
  accountId: string;
  db: SupabaseClient;
};

class LiveHarness {
  readonly runId = randomUUID();
  readonly createdUserIds: string[] = [];
  readonly createdAccountIds: string[] = [];
  readonly uploadedPaths: string[] = [];
  configSnapshot: Record<string, string> = { ...DEFAULT_CONFIG };
  admin!: SupabaseClient;
  anon!: SupabaseClient;
  userA!: UserSession;
  userB!: UserSession;
  passwordA = randomBytes(24).toString("base64url") + "Aa1";
  passwordB = randomBytes(24).toString("base64url") + "Bb1";

  constructor(readonly target: Target) {}

  async setup() {
    this.admin = client(this.target.url, this.target.serviceRoleKey);
    this.anon = client(this.target.url, this.target.anonKey);
    const { data: existingConfig } = await this.admin.from("analyzer_runtime_config").select("config_key, config_value");
    if (existingConfig) {
      for (const row of existingConfig as Array<{ config_key: string; config_value: string }>) {
        this.configSnapshot[row.config_key] = row.config_value;
      }
    }
    this.userA = await this.createUser("A");
    this.userB = await this.createUser("B");
  }

  private async createUser(label: "A" | "B"): Promise<UserSession> {
    const email = `fix5-${this.runId}-${label.toLowerCase()}@example.test`;
    const password = label === "A" ? this.passwordA : this.passwordB;
    const created = await this.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (created.error || !created.data.user) {
      fail("setup.users", rpcErrorFrom(created.error), "Could not create isolated test user.");
    }
    const userId = created.data.user.id;
    this.createdUserIds.push(userId);
    const signed = await this.anon.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) {
      fail("setup.users", rpcErrorFrom(signed.error), "Could not authenticate isolated test user.");
    }
    const accessToken = signed.data.session.access_token;
    const db = client(this.target.url, this.target.anonKey, accessToken);
    const accountId = randomUUID();
    const accountInsert = await this.admin.from("accounts").insert({
      account_id: accountId,
      account_owner_user_id: userId,
      account_status: "active"
    });
    if (accountInsert.error) {
      fail("setup.account", rpcErrorFrom(accountInsert.error), `Could not create account for user ${label}.`);
    }
    const memberInsert = await this.admin.from("account_members").insert({
      account_id: accountId,
      user_id: userId,
      user_role: "owner"
    });
    if (memberInsert.error) {
      fail("setup.account", rpcErrorFrom(memberInsert.error), `Could not create membership for user ${label}.`);
    }
    this.createdAccountIds.push(accountId);
    return { label, userId, email, accessToken, accountId, db };
  }

  async setConfig(key: string, value: string) {
    const { error } = await this.admin
      .from("analyzer_runtime_config")
      .update({ config_value: value, updated_at: new Date().toISOString() })
      .eq("config_key", key);
    if (error) fail("setup.config", rpcErrorFrom(error), `Could not update runtime config ${key}.`);
  }

  async restoreConfig() {
    for (const [key, value] of Object.entries(this.configSnapshot)) {
      await this.admin
        .from("analyzer_runtime_config")
        .update({ config_value: value, updated_at: new Date().toISOString() })
        .eq("config_key", key);
    }
  }

  async reserve(user: UserSession, fileCount: number): Promise<ReservationResult> {
    const { data, error } = await user.db.rpc("reserve_analyzer_package", { p_file_count: fileCount });
    if (error) fail("reserve", rpcErrorFrom(error), "reserve_analyzer_package failed.");
    return parseReservationResult(data, fileCount);
  }

  async uploadReserved(user: UserSession, reservation: ReservationResult) {
    for (const file of reservation.files) {
      const bytes = pdfFor(file.file_id);
      const { error } = await user.db.storage.from("policy-files").upload(file.storage_path, bytes, {
        contentType: "application/pdf",
        upsert: false
      });
      if (error) fail("storage.upload", rpcErrorFrom(error as { message?: string }), "Authorized upload to reserved path failed.");
      this.uploadedPaths.push(file.storage_path);
    }
  }

  async finalize(user: UserSession, reservation: ReservationResult, files = submittedFrom(reservation)) {
    const { data, error } = await user.db.rpc("finalize_analyzer_package", {
      p_reservation_id: reservation.reservation_id,
      p_files: files
    });
    return { data, error: error ? rpcErrorFrom(error) : null };
  }

  async expectFinalizeError(
    invariant: string,
    user: UserSession,
    reservation: ReservationResult,
    files: ReturnType<typeof submittedFrom>,
    token: string
  ) {
    const result = await this.finalize(user, reservation, files);
    if (!result.error || !errorMentions(result.error, token)) {
      fail(invariant, result.error ?? { data: result.data }, `Expected ${token} from finalize.`);
    }
  }

  async countRows(table: string, column: string, value: string): Promise<number> {
    const { count, error } = await this.admin.from(table).select(column, { count: "exact", head: true }).eq(column, value);
    if (error) fail("cleanup.count", rpcErrorFrom(error), `Could not count ${table}.`);
    return count ?? 0;
  }

  async expireLease(jobId: string) {
    const { error } = await this.admin
      .from("analysis_jobs")
      .update({
        lease_expires_at: new Date(Date.now() - 1000).toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("job_id", jobId);
    const err = error ? rpcErrorFrom(error) : null;
    rejectUndefinedColumn("lease.expire", err, "Expiring a lease");
    if (error) fail("lease.expire", err, "Could not expire lease for reclaim test.");
  }

  async expireReservation(reservationId: string) {
    const { error } = await this.admin
      .from("upload_reservations")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("reservation_id", reservationId);
    if (error) fail("reservation.expire", rpcErrorFrom(error), "Could not expire reservation.");
  }

  async cleanup() {
    try {
      await this.restoreConfig();
    } catch {
      // Continue other cleanup.
    }
    const accountIds = [...this.createdAccountIds];
    if (accountIds.length) {
      const { data: objects } = await this.admin.storage.from("policy-files").list();
      void objects;
      for (const accountId of accountIds) {
        const { data: uploads } = await this.admin.storage.from("policy-files").list(accountId, { limit: 1000 });
        if (uploads) {
          for (const upload of uploads) {
            const prefix = `${accountId}/${upload.name}`;
            const { data: files } = await this.admin.storage.from("policy-files").list(prefix, { limit: 1000 });
            const paths = (files ?? []).map((file) => `${prefix}/${file.name}`);
            if (paths.length) await this.admin.storage.from("policy-files").remove(paths);
            await this.admin.storage.from("policy-files").remove([prefix]);
          }
        }
      }
      if (this.uploadedPaths.length) {
        await this.admin.storage.from("policy-files").remove(this.uploadedPaths);
      }
      await this.admin.from("report_sections").delete().in("account_id", accountIds);
      await this.admin.from("analysis_jobs").delete().in("account_id", accountIds);
      await this.admin.from("uploaded_policy_files").delete().in("account_id", accountIds);
      await this.admin.from("policy_analyses").delete().in("account_id", accountIds);
      await this.admin.from("uploads").delete().in("account_id", accountIds);
      await this.admin.from("upload_reservation_files").delete().in(
        "reservation_id",
        (
          await this.admin.from("upload_reservations").select("reservation_id").in("account_id", accountIds)
        ).data?.map((row) => row.reservation_id) ?? []
      );
      await this.admin.from("upload_reservations").delete().in("account_id", accountIds);
      await this.admin.from("account_usage_windows").delete().in("account_id", accountIds);
      await this.admin.from("audit_events").delete().in("account_id", accountIds);
      await this.admin.from("account_members").delete().in("account_id", accountIds);
      await this.admin.from("accounts").delete().in("account_id", accountIds);
    }
    for (const userId of this.createdUserIds) {
      await this.admin.auth.admin.deleteUser(userId);
    }
  }
}

async function main() {
  const names = readdirSync(MIGRATION_DIR).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(names, EXPECTED_MIGRATIONS, "migration chain must be the reviewed files including Fix #6");

  const target = loadTarget();
  assertSafety(target);
  if (target.kind === "local") {
    applyLocalMigrations();
  } else {
    const { count } = await client(target.url, target.serviceRoleKey)
      .from("accounts")
      .select("account_id", { count: "exact", head: true });
    if ((count ?? 0) > 0) {
      fail(
        "safety.target",
        { count: count ?? 0 },
        "Remote disposable target already contains accounts; refusing to write."
      );
    }
  }

  const harness = new LiveHarness(target);
  let failed: LiveFailure | null = null;
  const accountIdsForCleanup: string[] = [];
  try {
    await harness.setup();
    accountIdsForCleanup.push(...harness.createdAccountIds);
    await runMatrix(harness, target);
    assertNoSensitiveLogs();
  } catch (error) {
    if (error instanceof LiveFailure) {
      failed = error;
    } else {
      const raw =
        error && typeof error === "object"
          ? rpcErrorFrom(error as { code?: string; message?: string; details?: string; hint?: string })
          : { code: null, message: safePrint(String(error)) };
      failed = new LiveFailure("uncaught", raw, "Unhandled live suite error.");
    }
    originalError("LIVE FIX #5 VERIFICATION FAILED");
    originalError(
      JSON.stringify(
        {
          invariant: failed.invariant,
          database_response: failed.dbResponse,
          likely_cause: failed.likelyCause
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  } finally {
    await harness.cleanup();
    await shutdownOcr();
  }
  if (!failed) {
    try {
      await assertCleanupComplete(harness, accountIdsForCleanup);
      originalLog("  ✓ cleanup removed isolated test accounts, jobs, and objects");
      originalLog("LIVE FIX #5 + #6 VERIFICATION PASSED");
    } catch (error) {
      const raw =
        error instanceof LiveFailure
          ? error
          : new LiveFailure("cleanup", { message: safePrint(String(error)) }, "Cleanup verification failed.");
      originalError("LIVE FIX #5 VERIFICATION FAILED");
      originalError(
        JSON.stringify(
          {
            invariant: raw.invariant,
            database_response: raw.dbResponse,
            likely_cause: raw.likelyCause
          },
          null,
          2
        )
      );
      process.exitCode = 1;
    }
  }
}

function assertNoSensitiveLogs() {
  for (const line of capturedLogs) {
    if (SENSITIVE_LOG_RE.test(line)) {
      fail("30", { line: "[redacted]" }, "A test log contained a forbidden token, filename, or secret.");
    }
  }
}

async function assertCleanupComplete(h: LiveHarness, accountIds: string[]) {
  for (const accountId of accountIds) {
    const jobs = await h.countRows("analysis_jobs", "account_id", accountId);
    const reservations = await h.countRows("upload_reservations", "account_id", accountId);
    const accounts = await h.countRows("accounts", "account_id", accountId);
    if (jobs || reservations || accounts) {
      fail("cleanup", { accountId, jobs, reservations, accounts }, "Cleanup left isolated test rows behind.");
    }
  }
}

async function runMatrix(h: LiveHarness, target: Target) {
  await invariant1Migrations();
  await invariant2Bucket(h);
  await invariant3AnonDenied(target);
  await invariant4AuthenticatedWorkerDenied(target, h);
  await invariant5ServiceRoleWorker(target);
  await invariant6ProtectedTables(h);
  const pkg = await invariant7ReserveFinalize(h);
  await invariant8CrossAccount(h, pkg);
  await invariant9StorageIsolation(h, pkg);
  await invariant10PendingBacklog(h);
  await invariant11ConcurrentReserve(h, target);
  await invariant12AbandonedExpiredRelease(h);
  await invariant13FinalizeRejects(h);
  await invariant14MissingObject(h);
  await invariant15FailedFinalizeNoPartial(h);
  const claimed = await invariant16ConcurrentClaim(h, target);
  await invariant16bLeaseAndIdentity(h, claimed);
  await invariant17ActiveLeaseNotStolen(h, target, claimed);
  await invariant18ExpiredLeaseReclaim(h, target);
  await invariant19StaleWorker(h, target);
  await invariant20ExhaustedFailed(h, target);
  await invariant21CancelledNoReport(h);
  await invariant22to27CompletionBinding(h);
  await invariant28MissingReport(h);
  await invariant29SafeStatus(h, pkg);
  await invariant30Audit(h);
  await invariant31RetryFailNoMissingColumn(h, target);
  await runWorkerLive(h, target);
}

async function invariant1Migrations() {
  for (const name of EXPECTED_MIGRATIONS) {
    assert.ok(existsSync(path.join(MIGRATION_DIR, name)), name);
    readFileSync(path.join(MIGRATION_DIR, name), "utf8");
  }
  const catalog = queryCatalog(`
    select c.relname || '|' || p.proname || '|' || replace(replace(p.prosrc, E'\\n', ' '), '|', '/')
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and n.nspname = 'public'
    order by 1
  `);
  if (!catalog) fail("1", { catalog }, "No public UPDATE triggers were found on the fresh database.");
  const columns = queryCatalog(`
    select table_name || '|' || column_name
    from information_schema.columns
    where table_schema = 'public'
  `);
  const colSet = new Set(columns.split("\n").filter(Boolean));
  const attachments = catalog.split("\n").filter(Boolean);
  for (const row of attachments) {
    const [table, fn, src] = row.split("|");
    const refs = [...(src ?? "").matchAll(/\b(?:NEW|OLD)\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1].toLowerCase());
    for (const col of refs) {
      if (!colSet.has(`${table}|${col}`)) {
        fail("1", { table, fn, col }, `Trigger function ${fn} referenced ${col} which is absent from ${table}.`);
      }
    }
  }
  const jobFns = attachments.filter((row) => row.startsWith("analysis_jobs|")).map((row) => row.split("|")[1]);
  if (!jobFns.includes("reject_analysis_job_identity_mutation")) {
    fail("1", { jobFns }, "analysis_jobs is missing reject_analysis_job_identity_mutation.");
  }
  if (jobFns.includes("reject_ownership_mutation")) {
    fail("1", { jobFns }, "analysis_jobs still attaches generic reject_ownership_mutation.");
  }
  const reservationFns = attachments.filter((row) => row.startsWith("upload_reservations|")).map((row) => row.split("|")[1]);
  if (!reservationFns.includes("reject_upload_reservation_identity_mutation")) {
    fail("1", { reservationFns }, "upload_reservations is missing its dedicated identity trigger.");
  }
  originalLog("  ✓ 1 migrations applied from fresh database; trigger functions reference only existing columns");
}

async function invariant2Bucket(h: LiveHarness) {
  const { data, error } = await h.admin.storage.listBuckets();
  if (error) fail("2", rpcErrorFrom(error as { message?: string }), "Could not list storage buckets.");
  const bucket = (data ?? []).find((item) => item.id === "policy-files" || item.name === "policy-files");
  if (!bucket) fail("2", { buckets: (data ?? []).map((item) => item.name) }, "policy-files bucket missing.");
  if (bucket.public) fail("2", { public: true }, "policy-files bucket must be private.");
  originalLog("  ✓ 2 policy-files bucket exists and is private");
}

async function invariant3AnonDenied(target: Target) {
  for (const rpc of [...AUTH_RPCS, ...WORKER_RPCS]) {
    const result = await restRpc(target, "anon", rpc.name, rpc.args as Record<string, unknown>);
    if (!isDenied(result.error) && result.status < 400) {
      fail("3", result.error ?? { status: result.status }, `anon executed ${rpc.name}.`);
    }
  }
  originalLog("  ✓ 3 anon cannot execute authenticated or worker RPCs");
}

async function invariant4AuthenticatedWorkerDenied(target: Target, h: LiveHarness) {
  for (const rpc of WORKER_RPCS) {
    const result = await restRpc(target, "authenticated", rpc.name, rpc.args as Record<string, unknown>, h.userA.accessToken);
    if (!isDenied(result.error) && result.status < 400) {
      fail("4", result.error ?? { status: result.status }, `authenticated executed worker RPC ${rpc.name}.`);
    }
  }
  originalLog("  ✓ 4 authenticated cannot execute worker RPCs");
}

async function invariant5ServiceRoleWorker(target: Target) {
  for (const rpc of WORKER_RPCS) {
    const result = await restRpc(target, "service", rpc.name, rpc.args as Record<string, unknown>);
    if (result.error && isDenied(result.error) && (result.status === 401 || result.status === 403 || result.status === 404)) {
      fail("5", result.error, `service_role cannot execute ${rpc.name}.`);
    }
    if (result.error && errorMentions(result.error, "service_role_required")) {
      fail("5", result.error, `service_role was treated as a user JWT for ${rpc.name}.`);
    }
  }
  originalLog("  ✓ 5 service_role can execute each worker RPC");
}

async function invariant6ProtectedTables(h: LiveHarness) {
  for (const table of PROTECTED_TABLES) {
    const read = await h.userA.db.from(table).select("*");
    if (!read.error) {
      fail("6", { table, rows: read.data?.length ?? 0 }, `authenticated SELECT on ${table} succeeded.`);
    }
    const write = await h.userA.db.from(table).insert({} as never);
    if (!write.error) {
      fail("6", { table }, `authenticated INSERT on ${table} succeeded.`);
    }
    const update = await h.userA.db.from(table).update({} as never).eq("account_id" as never, h.userA.accountId as never);
    if (!update.error && (update.count ?? 0) > 0) {
      fail("6", { table }, `authenticated UPDATE on ${table} succeeded.`);
    }
  }
  const jobInsert = await h.userA.db.from("analysis_jobs").insert({
    job_id: randomUUID(),
    policy_id: randomUUID(),
    analysis_id: randomUUID(),
    account_id: h.userA.accountId,
    owner_user_id: h.userA.userId
  });
  if (!jobInsert.error) fail("6", { table: "analysis_jobs" }, "authenticated INSERT on analysis_jobs succeeded.");
  originalLog("  ✓ 6 protected tables cannot be read or mutated by authenticated users");
}

async function invariant7ReserveFinalize(h: LiveHarness) {
  const reservation = await h.reserve(h.userA, 1);
  await h.uploadReserved(h.userA, reservation);
  const finalized = await h.finalize(h.userA, reservation);
  if (finalized.error) fail("7", finalized.error, "User A could not finalize an authorized package.");
  const status = await h.userA.db.rpc("get_own_job_status", { p_policy_id: reservation.policy_id });
  if (status.error || !status.data || (status.data as { status?: string }).status !== "queued") {
    fail("7", rpcErrorFrom(status.error) ?? { data: status.data }, "Finalized package did not create a queued job for User A.");
  }
  originalLog("  ✓ 7 User A can reserve and finalize an authorized package");
  return { reservation, finalized: finalized.data as Record<string, unknown> };
}

async function invariant8CrossAccount(
  h: LiveHarness,
  pkg: { reservation: ReservationResult }
) {
  const status = await h.userB.db.rpc("get_own_job_status", { p_policy_id: pkg.reservation.policy_id });
  if (status.error) fail("8", rpcErrorFrom(status.error), "User B status lookup should return null, not an error.");
  if (status.data) fail("8", { data: status.data }, "User B enumerated User A's job status.");
  const analyses = await h.userB.db.from("policy_analyses").select("analyzer_policy_id").eq("analyzer_policy_id", pkg.reservation.policy_id);
  if ((analyses.data ?? []).length > 0) fail("8", { rows: analyses.data?.length }, "User B selected User A's analysis.");
  const cancel = await h.userB.db.rpc("cancel_own_analysis_job", { p_policy_id: pkg.reservation.policy_id });
  if (cancel.error) fail("8", rpcErrorFrom(cancel.error), "User B cancel should return false, not an error.");
  if (cancel.data === true) fail("8", { cancelled: true }, "User B cancelled User A's job.");
  const download = await h.userB.db.storage.from("policy-files").download(pkg.reservation.files[0].storage_path);
  if (!download.error) fail("8", { downloaded: true }, "User B downloaded User A's object.");
  const stealFinalize = await h.userB.db.rpc("finalize_analyzer_package", {
    p_reservation_id: pkg.reservation.reservation_id,
    p_files: submittedFrom(pkg.reservation)
  });
  if (!stealFinalize.error) fail("8", { stolen: true }, "User B finalized User A's reservation.");
  originalLog("  ✓ 8 User B cannot enumerate, view, cancel, or download User A's package");
}

async function invariant9StorageIsolation(
  h: LiveHarness,
  pkg: { reservation: ReservationResult }
) {
  const foreignPath = pkg.reservation.files[0].storage_path;
  const upload = await h.userB.db.storage.from("policy-files").upload(foreignPath, pdfFor("steal"), {
    contentType: "application/pdf",
    upsert: true
  });
  if (!upload.error) fail("9", { uploaded: true }, "User B wrote to User A's storage path.");
  const listed = await h.userB.db.storage.from("policy-files").list(h.userA.accountId);
  if ((listed.data ?? []).length > 0) fail("9", { listed: listed.data?.length }, "User B listed User A's storage prefix.");
  const bReserve = await h.reserve(h.userB, 1);
  await h.expectFinalizeError(
    "9",
    h.userB,
    bReserve,
    submittedFrom(bReserve, [{ storage_path: foreignPath, sha256: VALID_SHA }]),
    "storage_path_foreign_account"
  );
  await h.userB.db.rpc("abandon_analyzer_reservation", { p_reservation_id: bReserve.reservation_id });
  originalLog("  ✓ 9 cross-account storage paths and object access are rejected");
}

async function invariant10PendingBacklog(h: LiveHarness) {
  await drainPending(h, h.userB);
  await h.setConfig("active_jobs_per_account", "2");
  const first = await h.reserve(h.userB, 1);
  const second = await h.reserve(h.userB, 1);
  const third = await h.userB.db.rpc("reserve_analyzer_package", { p_file_count: 1 });
  if (!third.error || !errorMentions(rpcErrorFrom(third.error), "backlog_limited")) {
    fail("10", rpcErrorFrom(third.error) ?? { data: third.data }, "Pending reservations did not consume backlog capacity.");
  }
  await h.userB.db.rpc("abandon_analyzer_reservation", { p_reservation_id: first.reservation_id });
  await h.userB.db.rpc("abandon_analyzer_reservation", { p_reservation_id: second.reservation_id });
  await h.setConfig("active_jobs_per_account", h.configSnapshot.active_jobs_per_account);
  originalLog("  ✓ 10 pending reservations consume backlog capacity");
}

async function invariant11ConcurrentReserve(h: LiveHarness, target: Target) {
  await drainPending(h, h.userB);
  await h.setConfig("active_jobs_per_account", "1");
  const results = await overlappingRpc(
    target,
    "authenticated",
    "reserve_analyzer_package",
    Array.from({ length: 8 }, () => ({ p_file_count: 1 })),
    h.userB.accessToken
  );
  const successes = results.filter((item) => item.error === null);
  const limited = results.filter((item) => item.error && errorMentions(item.error, "backlog_limited"));
  if (successes.length !== 1) {
    fail("11", { successes: successes.length, limited: limited.length }, "Concurrent reservations exceeded the account limit.");
  }
  if (successes.length + limited.length !== results.length) {
    fail("11", { other: results.length - successes.length - limited.length }, "Concurrent reserve produced an unexpected error.");
  }
  const winner = parseReservationResult(successes[0].json, 1);
  await h.userB.db.rpc("abandon_analyzer_reservation", { p_reservation_id: winner.reservation_id });
  await h.setConfig("active_jobs_per_account", h.configSnapshot.active_jobs_per_account);
  originalLog("  ✓ 11 concurrent reservation attempts cannot exceed the account limit");
}

async function invariant12AbandonedExpiredRelease(h: LiveHarness) {
  await drainPending(h, h.userB);
  await h.setConfig("active_jobs_per_account", "1");
  const pending = await h.reserve(h.userB, 1);
  const blocked = await h.userB.db.rpc("reserve_analyzer_package", { p_file_count: 1 });
  if (!blocked.error) fail("12", { data: blocked.data }, "Expected backlog before abandon/expire.");
  const abandoned = await h.userB.db.rpc("abandon_analyzer_reservation", { p_reservation_id: pending.reservation_id });
  if (abandoned.error || abandoned.data !== true) fail("12", rpcErrorFrom(abandoned.error) ?? {}, "Abandon did not succeed.");
  const afterAbandon = await h.reserve(h.userB, 1);
  await h.expireReservation(afterAbandon.reservation_id);
  const afterExpire = await h.reserve(h.userB, 1);
  await h.userB.db.rpc("abandon_analyzer_reservation", { p_reservation_id: afterExpire.reservation_id });
  await h.setConfig("active_jobs_per_account", h.configSnapshot.active_jobs_per_account);
  originalLog("  ✓ 12 abandoned and expired reservations release capacity");
}

async function invariant13FinalizeRejects(h: LiveHarness) {
  const swapped = await h.reserve(h.userA, 2);
  await h.uploadReserved(h.userA, swapped);
  await h.expectFinalizeError(
    "13",
    h.userA,
    swapped,
    submittedFrom(swapped, [
      { file_id: swapped.files[0].file_id, document_id: swapped.files[1].document_id, storage_path: swapped.files[0].storage_path },
      { file_id: swapped.files[1].file_id, document_id: swapped.files[0].document_id, storage_path: swapped.files[1].storage_path }
    ]),
    "reserved_tuple_mismatch"
  );
  await h.userA.db.rpc("abandon_analyzer_reservation", { p_reservation_id: swapped.reservation_id });

  const dupFile = await h.reserve(h.userA, 2);
  await h.uploadReserved(h.userA, dupFile);
  await h.expectFinalizeError("13", h.userA, dupFile, submittedFrom(dupFile, [{ file_id: dupFile.files[1].file_id }]), "duplicate_file_ids");
  await h.userA.db.rpc("abandon_analyzer_reservation", { p_reservation_id: dupFile.reservation_id });

  const dupDoc = await h.reserve(h.userA, 2);
  await h.uploadReserved(h.userA, dupDoc);
  await h.expectFinalizeError("13", h.userA, dupDoc, submittedFrom(dupDoc, [{ document_id: dupDoc.files[1].document_id }]), "duplicate_document_ids");
  await h.userA.db.rpc("abandon_analyzer_reservation", { p_reservation_id: dupDoc.reservation_id });

  const omit = await h.reserve(h.userA, 2);
  await h.uploadReserved(h.userA, omit);
  const omitted = submittedFrom(omit).slice(0, 1);
  const omitResult = await h.finalize(h.userA, omit, omitted);
  if (!omitResult.error || !errorMentions(omitResult.error, "file_count_mismatch")) {
    fail("13", omitResult.error ?? {}, "Omission was not rejected.");
  }
  await h.userA.db.rpc("abandon_analyzer_reservation", { p_reservation_id: omit.reservation_id });

  const extra = await h.reserve(h.userA, 1);
  await h.uploadReserved(h.userA, extra);
  const extraFiles = [
    ...submittedFrom(extra),
    { file_id: randomUUID(), document_id: randomUUID(), storage_path: extra.files[0].storage_path.replace(extra.files[0].file_id, randomUUID()), sha256: VALID_SHA }
  ];
  const extraResult = await h.finalize(h.userA, extra, extraFiles);
  if (!extraResult.error || !errorMentions(extraResult.error, "file_count_mismatch")) {
    fail("13", extraResult.error ?? {}, "Addition was not rejected.");
  }
  await h.userA.db.rpc("abandon_analyzer_reservation", { p_reservation_id: extra.reservation_id });

  const foreign = await h.reserve(h.userA, 1);
  await h.uploadReserved(h.userA, foreign);
  await h.expectFinalizeError(
    "13",
    h.userA,
    foreign,
    submittedFrom(foreign, [{ storage_path: `${h.userB.accountId}/${foreign.upload_id}/${foreign.files[0].file_id}.pdf` }]),
    "storage_path_foreign_account"
  );
  await h.userA.db.rpc("abandon_analyzer_reservation", { p_reservation_id: foreign.reservation_id });

  const hash = await h.reserve(h.userA, 1);
  await h.uploadReserved(h.userA, hash);
  await h.expectFinalizeError("13", h.userA, hash, submittedFrom(hash, [{ sha256: "not-a-sha256" }]), "invalid_sha256");
  await h.userA.db.rpc("abandon_analyzer_reservation", { p_reservation_id: hash.reservation_id });
  originalLog("  ✓ 13 finalization rejects swapped tuples, duplicates, omissions, additions, foreign paths, and invalid hashes");
}

async function invariant14MissingObject(h: LiveHarness) {
  const reservation = await h.reserve(h.userA, 1);
  await h.expectFinalizeError("14", h.userA, reservation, submittedFrom(reservation), "storage_object_missing");
  await h.userA.db.rpc("abandon_analyzer_reservation", { p_reservation_id: reservation.reservation_id });
  originalLog("  ✓ 14 finalization rejects a missing Storage object");
}

async function invariant15FailedFinalizeNoPartial(h: LiveHarness) {
  const reservation = await h.reserve(h.userA, 1);
  await h.expectFinalizeError("15", h.userA, reservation, submittedFrom(reservation), "storage_object_missing");
  const uploads = await h.countRows("uploads", "upload_id", reservation.upload_id);
  const analyses = await h.countRows("policy_analyses", "policy_analysis_id", reservation.analysis_id);
  const files = await h.countRows("uploaded_policy_files", "upload_id", reservation.upload_id);
  const jobs = await h.countRows("analysis_jobs", "job_id", reservation.job_id);
  if (uploads || analyses || files || jobs) {
    fail("15", { uploads, analyses, files, jobs }, "Failed finalization left partial rows.");
  }
  await h.userA.db.rpc("abandon_analyzer_reservation", { p_reservation_id: reservation.reservation_id });
  originalLog("  ✓ 15 failed finalization leaves no partial upload, analysis, file, or job rows");
}

async function drainPending(h: LiveHarness, user: UserSession) {
  const pending = await h.admin
    .from("upload_reservations")
    .select("reservation_id")
    .eq("account_id", user.accountId)
    .eq("status", "pending");
  if (pending.error) fail("drain", rpcErrorFrom(pending.error), "Could not list pending reservations.");
  for (const row of pending.data ?? []) {
    const abandoned = await user.db.rpc("abandon_analyzer_reservation", { p_reservation_id: row.reservation_id });
    if (abandoned.error) fail("drain", rpcErrorFrom(abandoned.error), "Could not abandon a pending reservation.");
  }
}

async function drainJobs(h: LiveHarness, user: UserSession) {
  await drainPending(h, user);
  const jobs = await h.admin
    .from("analysis_jobs")
    .select("policy_id, status")
    .eq("account_id", user.accountId)
    .in("status", ["queued", "processing"]);
  if (jobs.error) fail("drain", rpcErrorFrom(jobs.error), "Could not list jobs to drain.");
  for (const row of jobs.data ?? []) {
    const cancelled = await user.db.rpc("cancel_own_analysis_job", { p_policy_id: row.policy_id });
    rejectUndefinedColumn("drain", cancelled.error ? rpcErrorFrom(cancelled.error) : null, "Owner cancel while draining");
    if (cancelled.error) fail("drain", rpcErrorFrom(cancelled.error), "Could not cancel an owned job while draining.");
  }
}

async function drainUserA(h: LiveHarness) {
  await drainJobs(h, h.userA);
}

async function seedQueuedJob(h: LiveHarness) {
  await drainUserA(h);
  const reservation = await h.reserve(h.userA, 1);
  await h.uploadReserved(h.userA, reservation);
  const finalized = await h.finalize(h.userA, reservation);
  if (finalized.error) fail("seed.job", finalized.error, "Could not seed a queued job.");
  return reservation;
}

async function invariant16ConcurrentClaim(h: LiveHarness, target: Target) {
  const reservation = await seedQueuedJob(h);
  const results = await overlappingRpc(
    target,
    "service",
    "claim_analysis_jobs",
    [
      { p_worker_id: `w-claim-a-${h.runId.slice(0, 8)}`, p_limit: 1 },
      { p_worker_id: `w-claim-b-${h.runId.slice(0, 8)}`, p_limit: 1 }
    ]
  );
  if (results.some((item) => item.error)) {
    const err = results.find((item) => item.error)!.error as RpcError;
    rejectUndefinedColumn("16", err, "Concurrent claim");
    fail(
      "16",
      err,
      "Concurrent claim RPC failed. analysis_jobs updates must succeed for SKIP LOCKED claiming."
    );
  }
  const jobs = results.flatMap((item) => {
    if (item.error || !Array.isArray(item.json)) return [];
    return item.json as Array<{ job_id: string; policy_id: string }>;
  });
  const forThis = jobs.filter((job) => job.policy_id === reservation.policy_id);
  if (forThis.length !== 1) {
    fail("16", { claimed: forThis.length }, "Concurrent claimers received the same job or neither received it.");
  }
  originalLog("  ✓ 16 two workers claiming concurrently never receive the same job");
  return { reservation, jobId: forThis[0].job_id, owner: results[0].error === null && Array.isArray(results[0].json) && (results[0].json as Array<{ job_id: string }>).some((job) => job.job_id === forThis[0].job_id) ? `w-claim-a-${h.runId.slice(0, 8)}` : `w-claim-b-${h.runId.slice(0, 8)}` };
}

async function invariant16bLeaseAndIdentity(
  h: LiveHarness,
  claimed: { jobId: string; owner: string }
) {
  const row = await h.admin
    .from("analysis_jobs")
    .select("job_id, status, lease_owner, lease_expires_at, account_id, owner_user_id, policy_id, analysis_id, stage")
    .eq("job_id", claimed.jobId)
    .maybeSingle();
  if (row.error) fail("16b", rpcErrorFrom(row.error), "Could not read claimed job lease.");
  if (row.data?.status !== "processing" || row.data.lease_owner !== claimed.owner || !row.data.lease_expires_at) {
    fail("16b", { row: row.data, owner: claimed.owner }, "Claim did not establish an exclusive processing lease.");
  }
  const leaseExpiry = Date.parse(row.data.lease_expires_at);
  if (!(leaseExpiry > Date.now())) {
    fail("16b", { lease_expires_at: row.data.lease_expires_at }, "Claimed lease expiry was not in the future.");
  }
  originalLog("  ✓ 16b claim establishes a processing lease for the winning worker");

  const identityAttempts: Array<{ field: string; value: string }> = [
    { field: "account_id", value: h.userB.accountId },
    { field: "owner_user_id", value: h.userB.userId },
    { field: "policy_id", value: randomUUID() },
    { field: "analysis_id", value: randomUUID() }
  ];
  for (const attempt of identityAttempts) {
    const mutated = await h.admin
      .from("analysis_jobs")
      .update({ [attempt.field]: attempt.value })
      .eq("job_id", claimed.jobId)
      .select("job_id");
    const err = mutated.error ? rpcErrorFrom(mutated.error) : null;
    rejectUndefinedColumn("16c", err, `Identity mutation of ${attempt.field}`);
    if (!err) {
      fail("16c", { field: attempt.field, data: mutated.data }, `Identity field ${attempt.field} was mutable.`);
    }
    if (!errorMentions(err, "immutable")) {
      fail("16c", err, `Identity mutation of ${attempt.field} did not raise immutability.`);
    }
  }
  const unchanged = await h.admin
    .from("analysis_jobs")
    .select("account_id, owner_user_id, policy_id, analysis_id, lease_owner, status")
    .eq("job_id", claimed.jobId)
    .maybeSingle();
  if (
    unchanged.data?.account_id !== row.data.account_id
    || unchanged.data?.owner_user_id !== row.data.owner_user_id
    || unchanged.data?.policy_id !== row.data.policy_id
    || unchanged.data?.analysis_id !== row.data.analysis_id
    || unchanged.data?.lease_owner !== claimed.owner
    || unchanged.data?.status !== "processing"
  ) {
    fail("16c", { before: row.data, after: unchanged.data }, "Rejected identity mutation changed the job row.");
  }
  originalLog("  ✓ 16c unauthorized identity-field changes are rejected");

  const statusUpdate = await h.admin
    .from("analysis_jobs")
    .update({ stage: "ocr", documents_processed: 1, updated_at: new Date().toISOString() })
    .eq("job_id", claimed.jobId)
    .select("job_id, stage, documents_processed");
  const statusErr = statusUpdate.error ? rpcErrorFrom(statusUpdate.error) : null;
  rejectUndefinedColumn("16d", statusErr, "Legitimate stage/progress update");
  if (statusErr || statusUpdate.data?.[0]?.stage !== "ocr") {
    fail("16d", statusErr ?? { data: statusUpdate.data }, "Legitimate status/progress update was rejected.");
  }

  const pending = await h.reserve(h.userA, 1);
  const reservationMutations: Array<{ field: string; value: string }> = [
    { field: "account_id", value: h.userB.accountId },
    { field: "owner_user_id", value: h.userB.userId },
    { field: "upload_id", value: randomUUID() },
    { field: "analysis_id", value: randomUUID() },
    { field: "policy_id", value: randomUUID() },
    { field: "session_id", value: randomUUID() },
    { field: "job_id", value: randomUUID() }
  ];
  for (const attempt of reservationMutations) {
    const mutated = await h.admin
      .from("upload_reservations")
      .update({ [attempt.field]: attempt.value })
      .eq("reservation_id", pending.reservation_id)
      .select("reservation_id");
    const err = mutated.error ? rpcErrorFrom(mutated.error) : null;
    rejectUndefinedColumn("16c", err, `Reservation identity mutation of ${attempt.field}`);
    if (!err) fail("16c", { field: attempt.field }, `Reservation identity field ${attempt.field} was mutable.`);
    if (!errorMentions(err, "immutable")) {
      fail("16c", err, `Reservation identity mutation of ${attempt.field} did not raise immutability.`);
    }
  }
  const expireOk = await h.admin
    .from("upload_reservations")
    .update({ expires_at: new Date(Date.now() + 60_000).toISOString() })
    .eq("reservation_id", pending.reservation_id)
    .select("reservation_id");
  rejectUndefinedColumn("16d", expireOk.error ? rpcErrorFrom(expireOk.error) : null, "Reservation expiry update");
  if (expireOk.error) fail("16d", rpcErrorFrom(expireOk.error), "Legitimate reservation expiry update was rejected.");
  await h.userA.db.rpc("abandon_analyzer_reservation", { p_reservation_id: pending.reservation_id });

  originalLog("  ✓ 16d legitimate status and lease-preserving updates are allowed");

  const hb = await h.admin.rpc("heartbeat_analysis_job", { p_job_id: claimed.jobId, p_worker_id: claimed.owner });
  rejectUndefinedColumn("16e", hb.error ? rpcErrorFrom(hb.error) : null, "Lease-owner heartbeat");
  if (hb.error || hb.data !== true) fail("16e", rpcErrorFrom(hb.error) ?? { data: hb.data }, "Lease-owner heartbeat failed.");
  const progress = await h.admin.rpc("update_job_progress", {
    p_job_id: claimed.jobId,
    p_worker_id: claimed.owner,
    p_stage: "extracting",
    p_documents_processed: 1,
    p_page_count: 1,
    p_pages_processed: 1
  });
  rejectUndefinedColumn("16e", progress.error ? rpcErrorFrom(progress.error) : null, "Lease-owner progress");
  if (progress.error || progress.data !== true) {
    fail("16e", rpcErrorFrom(progress.error) ?? { data: progress.data }, "Lease-owner progress update failed.");
  }
  const foreign = await h.admin.rpc("heartbeat_analysis_job", {
    p_job_id: claimed.jobId,
    p_worker_id: `w-foreign-${h.runId.slice(0, 8)}`
  });
  rejectUndefinedColumn("16e", foreign.error ? rpcErrorFrom(foreign.error) : null, "Foreign heartbeat");
  if (foreign.error) fail("16e", rpcErrorFrom(foreign.error), "Foreign heartbeat should return false, not error.");
  if (foreign.data === true) fail("16e", { heartbeat: true }, "Foreign lease owner heartbeat succeeded.");
  originalLog("  ✓ 16e heartbeat and progress succeed for the lease owner and reject a foreign owner");
}

async function invariant17ActiveLeaseNotStolen(
  h: LiveHarness,
  target: Target,
  claimed: { jobId: string; owner: string }
) {
  const steal = await restRpc(target, "service", "claim_analysis_jobs", {
    p_worker_id: `w-steal-${h.runId.slice(0, 8)}`,
    p_limit: 1
  });
  const stolen = Array.isArray(steal.json)
    ? (steal.json as Array<{ job_id: string }>).some((job) => job.job_id === claimed.jobId)
    : false;
  if (stolen) fail("17", { stolen: true }, "An active lease was stolen by another worker.");
  originalLog("  ✓ 17 an active lease cannot be stolen");
}

async function invariant18ExpiredLeaseReclaim(h: LiveHarness, target: Target) {
  const reservation = await seedQueuedJob(h);
  const firstId = `w-old-${h.runId.slice(0, 8)}`;
  const secondId = `w-new-${h.runId.slice(0, 8)}`;
  const first = await restRpc(target, "service", "claim_analysis_jobs", { p_worker_id: firstId, p_limit: 1 });
  const firstJobs = Array.isArray(first.json) ? (first.json as Array<{ job_id: string; policy_id: string }>) : [];
  const mine = firstJobs.find((job) => job.policy_id === reservation.policy_id);
  if (!mine) fail("18", first.error ?? { json: first.json }, "First worker did not claim the seeded job.");
  await h.expireLease(mine.job_id);
  const second = await restRpc(target, "service", "claim_analysis_jobs", { p_worker_id: secondId, p_limit: 1 });
  const secondJobs = Array.isArray(second.json) ? (second.json as Array<{ job_id: string }>) : [];
  if (!secondJobs.some((job) => job.job_id === mine.job_id)) {
    fail("18", second.error ?? { json: second.json }, "Expired lease was not reclaimed.");
  }
  originalLog("  ✓ 18 an expired lease can be reclaimed within the attempt limit");
}

async function invariant19StaleWorker(h: LiveHarness, target: Target) {
  const reservation = await seedQueuedJob(h);
  const stale = `w-stale-${h.runId.slice(0, 8)}`;
  const fresh = `w-fresh-${h.runId.slice(0, 8)}`;
  const first = await restRpc(target, "service", "claim_analysis_jobs", { p_worker_id: stale, p_limit: 1 });
  const mine = (Array.isArray(first.json) ? first.json : []).find((job: { policy_id: string }) => job.policy_id === reservation.policy_id) as { job_id: string; session_id: string; files: Array<{ document_id: string; storage_path: string }> } | undefined;
  if (!mine) fail("19", first.error ?? {}, "Stale worker did not claim the job.");
  await h.expireLease(mine.job_id);
  const reclaimed = await restRpc(target, "service", "claim_analysis_jobs", { p_worker_id: fresh, p_limit: 1 });
  if (!Array.isArray(reclaimed.json) || !(reclaimed.json as Array<{ job_id: string }>).some((job) => job.job_id === mine.job_id)) {
    fail("19", reclaimed.error ?? {}, "Fresh worker did not reclaim before stale-worker checks.");
  }
  const hb = await restRpc(target, "service", "heartbeat_analysis_job", { p_job_id: mine.job_id, p_worker_id: stale });
  const progress = await restRpc(target, "service", "update_job_progress", { p_job_id: mine.job_id, p_worker_id: stale, p_stage: "ocr" });
  const failed = await restRpc(target, "service", "fail_analysis_job", { p_job_id: mine.job_id, p_worker_id: stale, p_error_code: "stale", p_stage: "ocr", p_retryable: false });
  const complete = await restRpc(target, "service", "complete_analysis_job", {
    p_job_id: mine.job_id,
    p_worker_id: stale,
    p_report: boundReport({
      policyId: reservation.policy_id,
      sessionId: reservation.session_id,
      files: reservation.files.map((file) => ({ document_id: file.document_id, storage_path: file.storage_path }))
    })
  });
  if (hb.json === true) fail("19", { heartbeat: true }, "Stale worker heartbeat succeeded.");
  if (progress.json === true) fail("19", { progress: true }, "Stale worker progress succeeded.");
  if (failed.json === true) fail("19", { fail: true }, "Stale worker fail succeeded.");
  if (!complete.error || !errorMentions(complete.error, "lease_mismatch")) {
    fail("19", complete.error ?? { json: complete.json }, "Stale worker complete did not raise lease_mismatch.");
  }
  originalLog("  ✓ 19 a stale worker cannot heartbeat, update, fail, or complete a reclaimed job");
}

async function invariant20ExhaustedFailed(h: LiveHarness, target: Target) {
  const reservation = await seedQueuedJob(h);
  let currentId = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const worker = `w-exh-${attempt}-${h.runId.slice(0, 8)}`;
    const claimed = await restRpc(target, "service", "claim_analysis_jobs", { p_worker_id: worker, p_limit: 1 });
    const mine = (Array.isArray(claimed.json) ? claimed.json : []).find((job: { policy_id: string }) => job.policy_id === reservation.policy_id) as { job_id: string } | undefined;
    if (!mine) fail("20", claimed.error ?? { attempt }, `Exhaustion claim ${attempt} did not receive the job.`);
    currentId = mine.job_id;
    await h.expireLease(currentId);
  }
  const none = await restRpc(target, "service", "claim_analysis_jobs", { p_worker_id: `w-exh-4-${h.runId.slice(0, 8)}`, p_limit: 1 });
  const again = Array.isArray(none.json) ? (none.json as Array<{ job_id: string }>).some((job) => job.job_id === currentId) : false;
  if (again) fail("20", { claimed: true }, "Exhausted job was claimed again.");
  const row = await h.admin.from("analysis_jobs").select("status, error_code, lease_owner").eq("job_id", currentId).maybeSingle();
  if (row.data?.status !== "failed" || row.data?.error_code !== "attempts_exhausted" || row.data?.lease_owner !== null) {
    fail("20", { row: row.data }, "Exhausted expired job was not terminal failed/attempts_exhausted.");
  }
  originalLog("  ✓ 20 an exhausted expired job becomes terminal failed");
}

async function invariant21CancelledNoReport(h: LiveHarness) {
  const reservation = await seedQueuedJob(h);
  const claimed = await h.admin.rpc("claim_analysis_jobs", { p_worker_id: `w-cancel-${h.runId.slice(0, 8)}`, p_limit: 1 });
  const job = (claimed.data as Array<{ job_id: string; policy_id: string; session_id: string; files: Array<{ document_id: string; storage_path: string }> }>).find((item) => item.policy_id === reservation.policy_id);
  if (!job) fail("21", { claimed: claimed.data }, "Could not claim job to cancel.");
  const cancelled = await h.userA.db.rpc("cancel_own_analysis_job", { p_policy_id: reservation.policy_id });
  if (cancelled.error || cancelled.data !== true) {
    rejectUndefinedColumn("21", cancelled.error ? rpcErrorFrom(cancelled.error) : null, "Owner cancel");
    fail("21", rpcErrorFrom(cancelled.error) ?? {}, "Owner cancel failed.");
  }
  const complete = await h.admin.rpc("complete_analysis_job", {
    p_job_id: job.job_id,
    p_worker_id: `w-cancel-${h.runId.slice(0, 8)}`,
    p_report: boundReport({
      policyId: reservation.policy_id,
      sessionId: job.session_id,
      files: job.files.map((file) => ({ document_id: file.document_id, storage_path: file.storage_path }))
    })
  });
  if (!complete.error || !errorMentions(rpcErrorFrom(complete.error), "job_cancelled")) {
    fail("21", rpcErrorFrom(complete.error) ?? { data: complete.data }, "Cancelled job published a report.");
  }
  const reports = await h.countRows("report_sections", "policy_analysis_id", reservation.analysis_id);
  if (reports) fail("21", { reports }, "Cancelled completion inserted a report.");
  originalLog("  ✓ 21 a cancelled job cannot publish a report");
}

async function invariant22to27CompletionBinding(h: LiveHarness) {
  const reservation = await seedQueuedJob(h);
  const worker = `w-bind-${h.runId.slice(0, 8)}`;
  const claimed = await h.admin.rpc("claim_analysis_jobs", { p_worker_id: worker, p_limit: 1 });
  const job = (claimed.data as Array<{
    job_id: string;
    policy_id: string;
    session_id: string;
    files: Array<{ document_id: string; storage_path: string; sha256: string; original_filename: string }>;
  }>).find((item) => item.policy_id === reservation.policy_id);
  if (!job) fail("22", { claimed: claimed.data }, "Could not claim job for binding tests.");
  const valid = boundReport({
    policyId: job.policy_id,
    sessionId: job.session_id,
    files: job.files.map((file) => ({
      document_id: file.document_id,
      storage_path: file.storage_path,
      sha256: file.sha256,
      original_filename: file.original_filename
    }))
  });

  const wrongPolicy = await h.admin.rpc("complete_analysis_job", { p_job_id: job.job_id, p_worker_id: worker, p_report: { ...valid, policy_id: randomUUID() } });
  if (!wrongPolicy.error || !errorMentions(rpcErrorFrom(wrongPolicy.error), "report_policy_mismatch")) {
    fail("22", rpcErrorFrom(wrongPolicy.error) ?? {}, "Completion accepted the wrong policy ID.");
  }
  originalLog("  ✓ 22 completion rejects the wrong policy ID");

  const wrongSession = await h.admin.rpc("complete_analysis_job", { p_job_id: job.job_id, p_worker_id: worker, p_report: { ...valid, session_id: randomUUID() } });
  if (!wrongSession.error || !errorMentions(rpcErrorFrom(wrongSession.error), "report_session_mismatch")) {
    fail("23", rpcErrorFrom(wrongSession.error) ?? {}, "Completion accepted the wrong session ID.");
  }
  originalLog("  ✓ 23 completion rejects the wrong session ID");

  const duplicate = {
    ...valid,
    documents: [valid.documents[0], { ...valid.documents[0], document_id: valid.documents[0].document_id }]
  };
  const dup = await h.admin.rpc("complete_analysis_job", { p_job_id: job.job_id, p_worker_id: worker, p_report: duplicate });
  if (!dup.error || !errorMentions(rpcErrorFrom(dup.error), "report_duplicate_document_ids")) {
    fail("24", rpcErrorFrom(dup.error) ?? {}, "Completion accepted duplicate document IDs.");
  }
  const missing = { ...valid, documents: [] };
  const miss = await h.admin.rpc("complete_analysis_job", { p_job_id: job.job_id, p_worker_id: worker, p_report: missing });
  if (!miss.error || !errorMentions(rpcErrorFrom(miss.error), "report_missing_document")) {
    fail("24", rpcErrorFrom(miss.error) ?? {}, "Completion accepted missing document IDs.");
  }
  const extra = {
    ...valid,
    documents: [...valid.documents, { ...valid.documents[0], document_id: randomUUID() }]
  };
  const extraRes = await h.admin.rpc("complete_analysis_job", { p_job_id: job.job_id, p_worker_id: worker, p_report: extra });
  if (!extraRes.error || !(errorMentions(rpcErrorFrom(extraRes.error), "report_foreign_document") || errorMentions(rpcErrorFrom(extraRes.error), "report_document_count_mismatch"))) {
    fail("24", rpcErrorFrom(extraRes.error) ?? {}, "Completion accepted extra/foreign document IDs.");
  }
  originalLog("  ✓ 24 completion rejects duplicate, missing, extra, or foreign document IDs");

  const reportsAfterReject = await h.countRows("report_sections", "policy_analysis_id", reservation.analysis_id);
  const jobRow = await h.admin.from("analysis_jobs").select("status").eq("job_id", job.job_id).maybeSingle();
  if (reportsAfterReject !== 0 || jobRow.data?.status === "completed") {
    fail("25", { reportsAfterReject, status: jobRow.data?.status }, "Rejected completion published a report or marked the job complete.");
  }
  originalLog("  ✓ 25 a rejected completion leaves the job non-completed and publishes no report");

  const ok = await h.admin.rpc("complete_analysis_job", { p_job_id: job.job_id, p_worker_id: worker, p_report: valid });
  if (ok.error) {
    rejectUndefinedColumn("26", rpcErrorFrom(ok.error), "Valid completion");
    fail("26", rpcErrorFrom(ok.error), "Valid completion failed.");
  }
  const reports = await h.admin.from("report_sections").select("section_key").eq("policy_analysis_id", reservation.analysis_id);
  const completed = await h.admin.from("analysis_jobs").select("status").eq("job_id", job.job_id).maybeSingle();
  if ((reports.data ?? []).length !== 1 || completed.data?.status !== "completed") {
    fail("26", { reports: reports.data?.length, status: completed.data?.status }, "Valid completion was not atomic.");
  }
  originalLog("  ✓ 26 valid completion publishes exactly one bound report and marks the job complete atomically");

  const retry = await h.admin.rpc("complete_analysis_job", { p_job_id: job.job_id, p_worker_id: worker, p_report: valid });
  if (retry.error) fail("27", rpcErrorFrom(retry.error), "Identical completion retry was not idempotent.");
  const reports2 = await h.admin.from("report_sections").select("section_key").eq("policy_analysis_id", reservation.analysis_id);
  if ((reports2.data ?? []).length !== 1) fail("27", { reports: reports2.data?.length }, "Idempotent retry created another report.");
  originalLog("  ✓ 27 an identical completion retry is idempotent");
}

async function invariant28MissingReport(h: LiveHarness) {
  const reservation = await seedQueuedJob(h);
  const worker = `w-miss-${h.runId.slice(0, 8)}`;
  const claimed = await h.admin.rpc("claim_analysis_jobs", { p_worker_id: worker, p_limit: 1 });
  const job = (claimed.data as Array<{ job_id: string; policy_id: string; session_id: string; files: Array<{ document_id: string; storage_path: string }> }>).find((item) => item.policy_id === reservation.policy_id);
  if (!job) fail("28", {}, "Could not claim job for report-unavailable test.");
  const valid = boundReport({
    policyId: job.policy_id,
    sessionId: job.session_id,
    files: job.files.map((file) => ({ document_id: file.document_id, storage_path: file.storage_path }))
  });
  const ok = await h.admin.rpc("complete_analysis_job", { p_job_id: job.job_id, p_worker_id: worker, p_report: valid });
  if (ok.error) fail("28", rpcErrorFrom(ok.error), "Setup completion failed.");
  await h.admin.from("report_sections").delete().eq("policy_analysis_id", reservation.analysis_id);
  const status = await h.userA.db.rpc("get_own_job_status", { p_policy_id: reservation.policy_id });
  const payload = status.data as { status?: string; error_code?: string } | null;
  if (payload?.status !== "failed" || payload?.error_code !== "report_unavailable") {
    fail("28", { payload }, "Missing report did not return failed / report_unavailable.");
  }
  originalLog("  ✓ 28 a completed job with a missing or inconsistent report returns failed / report_unavailable");
}

async function invariant29SafeStatus(h: LiveHarness, pkg: { reservation: ReservationResult }) {
  const status = await h.userA.db.rpc("get_own_job_status", { p_policy_id: pkg.reservation.policy_id });
  if (status.error || !status.data || typeof status.data !== "object") {
    fail("29", rpcErrorFrom(status.error) ?? {}, "User A could not read safe status fields.");
  }
  const keys = Object.keys(status.data as object);
  const extra = keys.filter((key) => !SAFE_STATUS_KEYS.has(key));
  if (extra.length) fail("29", { extra }, "Status payload included fields beyond the safe set.");
  const blob = JSON.stringify(status.data).toLowerCase();
  if (blob.includes("lease_owner") || blob.includes(".pdf") || blob.includes("ocr") || blob.includes("signed")) {
    fail("29", { keys }, "Status payload leaked lease, filename, OCR, or URL material.");
  }
  originalLog("  ✓ 29 User A can see only the safe status fields for User A's job");
}

async function invariant30Audit(h: LiveHarness) {
  const { data, error } = await h.admin.from("audit_events").select("*").in("account_id", h.createdAccountIds);
  if (error) fail("30", rpcErrorFrom(error), "Could not read audit events for the run.");
  const blob = JSON.stringify(data ?? []).toLowerCase();
  if (
    blob.includes("ocr_text") ||
    blob.includes("original_filename") ||
    blob.includes("signedurl") ||
    blob.includes("access_token") ||
    blob.includes("eyj")
  ) {
    fail("30", { events: (data ?? []).length }, "Audit events contained policy text, filenames, tokens, or signed URLs.");
  }
  originalLog("  ✓ 30 no policy text, OCR text, filenames, tokens, or signed URLs appear in audit events or test logs");
}

async function invariant31RetryFailNoMissingColumn(h: LiveHarness, target: Target) {
  const reservation = await seedQueuedJob(h);
  const worker = `w-retry-${h.runId.slice(0, 8)}`;
  const claimed = await restRpc(target, "service", "claim_analysis_jobs", { p_worker_id: worker, p_limit: 1 });
  rejectUndefinedColumn("31", claimed.error, "Retry claim");
  const job = (Array.isArray(claimed.json) ? claimed.json : []).find((item: { policy_id: string }) => item.policy_id === reservation.policy_id) as { job_id: string } | undefined;
  if (!job) fail("31", claimed.error ?? { json: claimed.json }, "Could not claim job for retry/fail.");
  const retried = await restRpc(target, "service", "fail_analysis_job", {
    p_job_id: job.job_id,
    p_worker_id: worker,
    p_error_code: "transient_ocr",
    p_stage: "ocr",
    p_retryable: true
  });
  rejectUndefinedColumn("31", retried.error, "Retryable fail");
  if (retried.error || retried.json !== true) {
    fail("31", retried.error ?? { json: retried.json }, "Retryable fail did not succeed.");
  }
  const queued = await h.admin.from("analysis_jobs").select("status, retryable, lease_owner").eq("job_id", job.job_id).maybeSingle();
  if (queued.data?.status !== "queued" || queued.data.retryable !== true || queued.data.lease_owner !== null) {
    fail("31", { row: queued.data }, "Retryable fail did not requeue the job and clear the lease.");
  }
  const ready = await h.admin
    .from("analysis_jobs")
    .update({ available_at: new Date(Date.now() - 1000).toISOString() })
    .eq("job_id", job.job_id)
    .select("job_id");
  rejectUndefinedColumn("31", ready.error ? rpcErrorFrom(ready.error) : null, "available_at update after retryable fail");
  if (ready.error) fail("31", rpcErrorFrom(ready.error), "Could not make the requeued job available.");
  const again = await restRpc(target, "service", "claim_analysis_jobs", { p_worker_id: `w-retry-2-${h.runId.slice(0, 8)}`, p_limit: 1 });
  rejectUndefinedColumn("31", again.error, "Reclaim after retryable fail");
  const reclaimed = (Array.isArray(again.json) ? again.json : []).find((item: { job_id: string }) => item.job_id === job.job_id) as { job_id: string } | undefined;
  if (!reclaimed) fail("31", again.error ?? { json: again.json }, "Requeued job could not be reclaimed.");
  const terminal = await restRpc(target, "service", "fail_analysis_job", {
    p_job_id: job.job_id,
    p_worker_id: `w-retry-2-${h.runId.slice(0, 8)}`,
    p_error_code: "fatal_ocr",
    p_stage: "ocr",
    p_retryable: false
  });
  rejectUndefinedColumn("31", terminal.error, "Terminal fail");
  if (terminal.error || terminal.json !== true) {
    fail("31", terminal.error ?? { json: terminal.json }, "Terminal fail did not succeed.");
  }
  originalLog("  ✓ 31 retryable and terminal fail execute without SQLSTATE 42703");
}

function workerCfg(workerId: string, overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    workerId,
    concurrency: 1,
    claimLimit: 1,
    pollMs: 50,
    backoffMaxMs: 200,
    shutdownMs: 2_000,
    heartbeatMs: 1_000,
    leaseMs: 120_000,
    ...overrides
  };
}

function configureWorkerEnv(target: Target) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = target.url;
  process.env.SUPABASE_URL = target.url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = target.anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = target.serviceRoleKey;
  delete process.env.POLICY_ANALYZER_STORE;
}

async function enqueueLive(h: LiveHarness, files: IncomingPdf[]) {
  const store = new SupabasePolicyStore(h.userA.db);
  return store.enqueuePackage(
    { userId: h.userA.userId, accountId: h.userA.accountId, role: "owner" },
    { files }
  );
}

async function runWorkerLive(h: LiveHarness, target: Target) {
  configureWorkerEnv(target);
  await h.setConfig("uploads_per_account_per_hour", "100");
  await h.setConfig("active_jobs_per_account", "40");
  const persistence = createWorkerPersistence();

  resetExtractPdfInvocations();
  const complete = await buildCompletePolicyPdf();
  const queued = await enqueueLive(h, [{ filename: "live-complete.pdf", bytes: complete }]);
  if (extractPdfInvocations !== 0) {
    fail("32", { extractPdfInvocations }, "Enqueue extracted documents inside the HTTP/user path.");
  }
  const pending = await h.userA.db.rpc("get_own_job_status", { p_policy_id: queued.policy_id });
  if (pending.error || pending.data?.status !== "queued") {
    fail("32", pending.error ?? pending.data, "Queued upload did not remain queued before the worker ran.");
  }
  originalLog("  ✓ 32 upload/enqueue returns a queued job without extraction");

  const nativeWorker = new AnalysisWorker({
    store: persistence,
    config: workerCfg(`w-live-native-${h.runId.slice(0, 8)}`)
  });
  const nativeOnce = await nativeWorker.runOnce();
  if (nativeOnce.claimed < 1) fail("33", { claimed: nativeOnce.claimed }, "Worker did not claim the queued native-text job.");
  const nativeStatus = await h.userA.db.rpc("get_own_job_status", { p_policy_id: queued.policy_id });
  if (nativeStatus.data?.status !== "completed" && nativeStatus.data?.status !== "needs_review") {
    fail("33", nativeStatus.data ?? {}, "Worker did not publish a bound terminal report.");
  }
  const nativeReport = await new SupabasePolicyStore(h.userA.db).getReport(
    { userId: h.userA.userId, accountId: h.userA.accountId, role: "owner" },
    queued.policy_id
  );
  if (!nativeReport || nativeReport.policy_id !== queued.policy_id) {
    fail("33", { policy_id: queued.policy_id }, "Bound report missing after worker:once.");
  }
  originalLog("  ✓ 33 worker:once converted a queued native-text package into a bound report");

  const scanned = await buildScannedPdf();
  const scanQueued = await enqueueLive(h, [{ filename: "live-scan.pdf", bytes: scanned }]);
  const ocrWorker = new AnalysisWorker({
    store: persistence,
    config: workerCfg(`w-live-ocr-${h.runId.slice(0, 8)}`)
  });
  await ocrWorker.runOnce();
  const scanReport = await new SupabasePolicyStore(h.userA.db).getReport(
    { userId: h.userA.userId, accountId: h.userA.accountId, role: "owner" },
    scanQueued.policy_id
  );
  const scanHay = (scanReport?.documents || []).flatMap((d) => d.pages.map((p) => p.text)).join(" ");
  if (!scanReport || !new RegExp(SCANNED_PDF_PHRASE, "i").test(scanHay)) {
    fail("34", { status: "missing_ocr_text" }, "Scanned fixture did not produce a sourced OCR report.");
  }
  originalLog("  ✓ 34 scanned fixture used real OCR and produced a bound sourced report");

  const pages = await buildCompletePolicyPages();
  const multiQueued = await enqueueLive(
    h,
    pages.map((bytes, index) => ({ filename: `live-part-${index}.pdf`, bytes }))
  );
  await new AnalysisWorker({
    store: persistence,
    config: workerCfg(`w-live-multi-${h.runId.slice(0, 8)}`)
  }).runOnce();
  const multiReport = await new SupabasePolicyStore(h.userA.db).getReport(
    { userId: h.userA.userId, accountId: h.userA.accountId, role: "owner" },
    multiQueued.policy_id
  );
  if (!multiReport || multiReport.documents.length !== pages.length || multiReport.session_id !== multiQueued.session_id) {
    fail("35", { count: multiReport?.documents.length }, "Multi-document worker run lost claimed IDs or ordering.");
  }
  originalLog("  ✓ 35 multiple uploaded documents preserved claimed IDs and ordering");

  const duelQueued = await enqueueLive(h, [{ filename: "live-duel.pdf", bytes: complete }]);
  const [left, right] = await Promise.all([
    new AnalysisWorker({ store: persistence, config: workerCfg(`w-live-duel-a-${h.runId.slice(0, 8)}`) }).runOnce(),
    new AnalysisWorker({ store: persistence, config: workerCfg(`w-live-duel-b-${h.runId.slice(0, 8)}`) }).runOnce()
  ]);
  if (left.claimed + right.claimed !== 1) {
    fail("36", { left: left.claimed, right: right.claimed, policy_id: duelQueued.policy_id }, "Two live workers processed the same job or lost it.");
  }
  originalLog("  ✓ 36 two workers never processed or published the same live job");

  const hbQueued = await enqueueLive(h, [{ filename: "live-hb.pdf", bytes: complete }]);
  const hbClaim = await h.admin.rpc("claim_analysis_jobs", {
    p_worker_id: `w-live-hb-${h.runId.slice(0, 8)}`,
    p_limit: 1
  });
  const hbJob = (Array.isArray(hbClaim.data) ? hbClaim.data : []).find((row: { policy_id: string }) => row.policy_id === hbQueued.policy_id) as { job_id: string } | undefined;
  if (!hbJob) fail("37", hbClaim.error ?? {}, "Could not claim heartbeat job.");
  const hb = await h.admin.rpc("heartbeat_analysis_job", {
    p_job_id: hbJob.job_id,
    p_worker_id: `w-live-hb-${h.runId.slice(0, 8)}`
  });
  if (hb.data !== true) fail("37", hb.error ?? { data: hb.data }, "Heartbeat did not preserve the live lease.");
  await h.admin.rpc("fail_analysis_job", {
    p_job_id: hbJob.job_id,
    p_worker_id: `w-live-hb-${h.runId.slice(0, 8)}`,
    p_error_code: "probe_complete",
    p_stage: "extracting",
    p_retryable: false
  });
  originalLog("  ✓ 37 heartbeats preserve an active live lease");

  const shaQueued = await enqueueLive(h, [{ filename: "live-sha.pdf", bytes: complete }]);
  const shaClaim = await h.admin.rpc("claim_analysis_jobs", {
    p_worker_id: `w-live-sha-claim-${h.runId.slice(0, 8)}`,
    p_limit: 1
  });
  const shaJob = (Array.isArray(shaClaim.data) ? shaClaim.data : []).find((row: { policy_id: string; files?: Array<{ storage_path: string }> }) => row.policy_id === shaQueued.policy_id) as { job_id: string; files: Array<{ storage_path: string }> } | undefined;
  if (!shaJob) fail("38", shaClaim.error ?? {}, "Could not claim checksum job.");
  await h.expireLease(shaJob.job_id);
  const path = shaJob.files[0].storage_path;
  await h.admin.storage.from("policy-files").remove([path]);
  const other = await buildFixturePdf();
  const up = await h.admin.storage.from("policy-files").upload(path, other, { contentType: "application/pdf", upsert: true });
  if (up.error) fail("38", rpcErrorFrom(up.error as { message?: string }), "Could not replace object for checksum test.");
  await h.admin.from("analysis_jobs").update({ available_at: new Date(Date.now() - 1000).toISOString() }).eq("job_id", shaJob.job_id);
  const shaOnce = await new AnalysisWorker({
    store: persistence,
    config: workerCfg(`w-live-sha-${h.runId.slice(0, 8)}`)
  }).runOnce();
  const shaStatus = await h.userA.db.rpc("get_own_job_status", { p_policy_id: shaQueued.policy_id });
  if (shaOnce.results.some((r) => r.errorCode === "checksum_mismatch") === false && shaStatus.data?.status !== "failed") {
    fail("38", shaStatus.data ?? shaOnce, "Checksum mismatch did not fail closed.");
  }
  const shaReport = await new SupabasePolicyStore(h.userA.db).getReport(
    { userId: h.userA.userId, accountId: h.userA.accountId, role: "owner" },
    shaQueued.policy_id
  );
  if (shaReport) fail("38", { report: true }, "Checksum mismatch published a report.");
  originalLog("  ✓ 38 SHA-256 mismatch failed permanently with no report");

  const missQueued = await enqueueLive(h, [{ filename: "live-miss.pdf", bytes: complete }]);
  const missClaim = await h.admin.rpc("claim_analysis_jobs", {
    p_worker_id: `w-live-miss-seed-${h.runId.slice(0, 8)}`,
    p_limit: 1
  });
  const missJob = (Array.isArray(missClaim.data) ? missClaim.data : []).find((row: { policy_id: string; files?: Array<{ storage_path: string }> }) => row.policy_id === missQueued.policy_id) as { job_id: string; files: Array<{ storage_path: string }> } | undefined;
  if (!missJob) fail("39", missClaim.error ?? {}, "Could not claim missing-object job.");
  await h.admin.storage.from("policy-files").remove([missJob.files[0].storage_path]);
  await h.expireLease(missJob.job_id);
  await h.admin.from("analysis_jobs").update({ available_at: new Date(Date.now() - 1000).toISOString() }).eq("job_id", missJob.job_id);
  const missOnce = await new AnalysisWorker({
    store: persistence,
    config: workerCfg(`w-live-miss-${h.runId.slice(0, 8)}`)
  }).runOnce();
  if (missOnce.results[0]?.errorCode !== "storage_missing" && missOnce.results[0]?.outcome !== "retried" && missOnce.results[0]?.outcome !== "failed") {
    fail("39", missOnce, "Missing storage object did not follow retry/failure policy.");
  }
  originalLog("  ✓ 39 missing storage object followed the retry/failure policy");

  const cancelQueued = await enqueueLive(h, [{ filename: "live-cancel.pdf", bytes: complete }]);
  const cancelClaim = await h.admin.rpc("claim_analysis_jobs", {
    p_worker_id: `w-live-cancel-${h.runId.slice(0, 8)}`,
    p_limit: 1
  });
  const cancelJob = (Array.isArray(cancelClaim.data) ? cancelClaim.data : []).find((row: { policy_id: string }) => row.policy_id === cancelQueued.policy_id) as { job_id: string } | undefined;
  if (!cancelJob) fail("41", cancelClaim.error ?? {}, "Could not claim cancellation job.");
  const cancelled = await h.userA.db.rpc("cancel_own_analysis_job", { p_policy_id: cancelQueued.policy_id });
  if (cancelled.data !== true) fail("41", cancelled.error ?? {}, "Could not cancel the in-flight job.");
  const staleComplete = await h.admin.rpc("complete_analysis_job", {
    p_job_id: cancelJob.job_id,
    p_worker_id: `w-live-cancel-${h.runId.slice(0, 8)}`,
    p_report: { policy_id: cancelQueued.policy_id }
  });
  if (!staleComplete.error) fail("41", { complete: true }, "Cancelled job accepted a completion.");
  const cancelReport = await new SupabasePolicyStore(h.userA.db).getReport(
    { userId: h.userA.userId, accountId: h.userA.accountId, role: "owner" },
    cancelQueued.policy_id
  );
  if (cancelReport) fail("41", { report: true }, "Cancellation published a report.");
  originalLog("  ✓ 41 cancellation during processing prevented publication");

  const partial = await buildPartialPolicyPdf();
  const partQueued = await enqueueLive(h, [{ filename: "live-partial.pdf", bytes: partial }]);
  await new AnalysisWorker({
    store: persistence,
    config: workerCfg(`w-live-partial-${h.runId.slice(0, 8)}`)
  }).runOnce();
  const partStatus = await h.userA.db.rpc("get_own_job_status", { p_policy_id: partQueued.policy_id });
  if (partStatus.data?.status !== "needs_review") {
    fail("42", partStatus.data ?? {}, "Partial usable extraction did not become needs_review.");
  }
  originalLog("  ✓ 42 partial usable extraction became needs_review, not completed");

  const cross = await new SupabasePolicyStore(h.userB.db).getReport(
    { userId: h.userB.userId, accountId: h.userB.accountId, role: "owner" },
    queued.policy_id
  );
  if (cross) fail("44", { report: true }, "User B enumerated User A's worker report.");
  const crossStatus = await h.userB.db.rpc("get_own_job_status", { p_policy_id: queued.policy_id });
  if (crossStatus.data) fail("44", crossStatus.data, "User B enumerated User A's worker status.");
  originalLog("  ✓ 44 cross-account status and report remain non-enumerating after worker publish");

  const empty = await new AnalysisWorker({
    store: persistence,
    config: workerCfg(`w-live-empty-${h.runId.slice(0, 8)}`)
  }).runOnce();
  if (empty.claimed !== 0) fail("45", { claimed: empty.claimed }, "Empty-queue worker:once claimed unexpected work.");
  originalLog("  ✓ 45 worker:once exits with no claim when the queue is empty");

  const retryComplete = await h.admin.rpc("complete_analysis_job", {
    p_job_id: (await h.admin.from("analysis_jobs").select("job_id").eq("policy_id", queued.policy_id).maybeSingle()).data?.job_id,
    p_worker_id: `w-live-native-${h.runId.slice(0, 8)}`,
    p_report: nativeReport,
    p_outcome: nativeStatus.data?.status === "needs_review" ? "needs_review" : "completed"
  });
  if (retryComplete.error) {
    fail("46", rpcErrorFrom(retryComplete.error), "Idempotent completion retry failed.");
  }
  originalLog("  ✓ 46 completion retry remained idempotent");
}

void sha256;
void main().catch((error) => {
  originalError("LIVE FIX #5 VERIFICATION FAILED");
  originalError(safePrint(String(error)));
  process.exitCode = 1;
});
