/**
 * Milestone 3 staging integration.
 *
 * Exercises the HTTP upload → durable job → worker → cited report path
 * against the disposable loopback stack only. Remote Supabase is rejected.
 * Secrets are never printed.
 */
import assert from "node:assert/strict";
import { execFileSync, execSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { request as undiciRequest } from "undici";
import { createBrowserClient } from "@supabase/ssr";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { buildCompletePolicyPdf } from "../lib/build-complete-pdf";
import { createWorkerPersistence } from "../lib/persistence/worker-factory";
import { AnalysisWorker } from "../lib/worker/runtime";
import type { WorkerConfig } from "../lib/worker/config";
import type { PolicyRecord } from "../lib/types";
import {
  ACCEPTED_FIX6_SHA,
  REQUIRED_STACK_CONTAINERS,
  evaluateLiveSafety,
  type LiveSafetyInput
} from "./live-safety";

const WORKTREE = path.resolve(process.cwd(), "../..");
const APP_ROOT = process.cwd();
const PORT = Number(process.env.POLICY_ANALYZER_STAGING_PORT || 43163);
const APP_ORIGIN = process.env.STAGING_APP_URL || `http://127.0.0.1:${PORT}`;
const LIVE_ENV_FILE = "/tmp/fix5-live-stack/env";
const SENSITIVE =
  /eyj[a-z0-9_-]{20,}|access_token|refresh_token|service_role|signedurl|signed_url|postgresql:\/\/|sb_secret_/i;

const captured: string[] = [];
const originalLog = console.log;
const originalError = console.error;
console.log = (...args: unknown[]) => {
  const line = args.map(safePrint).join(" ");
  captured.push(line);
  originalLog(line);
};
console.error = (...args: unknown[]) => {
  const line = args.map(safePrint).join(" ");
  captured.push(line);
  originalError(line);
};

type Target = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

class StagingFailure extends Error {
  constructor(
    readonly invariant: string,
    readonly detail: Record<string, unknown>,
    readonly likelyCause: string
  ) {
    super(`${invariant}: ${likelyCause}`);
    this.name = "StagingFailure";
  }
}

function safePrint(value: unknown): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, "[redacted-jwt]")
    .replace(/postgresql:\/\/[^\s"']+/gi, "[redacted-db]")
    .replace(/sb_secret_[A-Za-z0-9]+/g, "[redacted-key]");
}

function fail(invariant: string, detail: Record<string, unknown>, cause: string): never {
  throw new StagingFailure(invariant, detail, cause);
}

function git(cmd: string): string {
  return execSync(cmd, { cwd: WORKTREE, encoding: "utf8" }).trim();
}

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function loadDotEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

function loadTarget(): Target {
  const file = loadDotEnv(LIVE_ENV_FILE);
  const url = (process.env.LIVE_SUPABASE_URL || file.LIVE_SUPABASE_URL || "").replace(/\/$/, "");
  const anon = process.env.LIVE_SUPABASE_ANON_KEY || file.LIVE_SUPABASE_ANON_KEY || "";
  const service = process.env.LIVE_SUPABASE_SERVICE_ROLE_KEY || file.LIVE_SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !anon || !service) {
    fail("safety.target", { configured: false }, "Disposable live-stack credentials are not available.");
  }
  if (!isLoopback(url)) {
    fail("safety.target", { kind: "remote" }, "Remote Supabase URLs are rejected.");
  }
  process.env.LIVE_SUPABASE_URL = url;
  process.env.LIVE_SUPABASE_ANON_KEY = anon;
  process.env.LIVE_SUPABASE_SERVICE_ROLE_KEY = service;
  process.env.POLICY_ANALYZER_LIVE_STACK_MARKER =
    process.env.POLICY_ANALYZER_LIVE_STACK_MARKER || file.POLICY_ANALYZER_LIVE_STACK_MARKER;
  process.env.LIVE_POSTGREST_URL = process.env.LIVE_POSTGREST_URL || file.LIVE_POSTGREST_URL;
  process.env.LIVE_AUTH_URL = process.env.LIVE_AUTH_URL || file.LIVE_AUTH_URL;
  process.env.LIVE_STORAGE_URL = process.env.LIVE_STORAGE_URL || file.LIVE_STORAGE_URL;
  return { url, anonKey: anon, serviceRoleKey: service };
}

function collectLiveSafetyInput(target: Target): LiveSafetyInput {
  const remotes = git("git remote -v")
    .split("\n")
    .map((line) => line.split(/\s+/)[1])
    .filter(Boolean);
  const branch = git("git branch --show-current");
  const head = git("git rev-parse HEAD");
  let descendsFromFix6 = false;
  try {
    execSync(`git merge-base --is-ancestor ${ACCEPTED_FIX6_SHA} HEAD`, { cwd: WORKTREE, stdio: "ignore" });
    descendsFromFix6 = true;
  } catch {
    descendsFromFix6 = false;
  }
  let databaseName: string | null = null;
  let disposableMarker: string | null = process.env.POLICY_ANALYZER_LIVE_STACK_MARKER || null;
  try {
    databaseName = execSync(
      "docker exec fix5-pg psql -U postgres -d postgres -tAc 'select current_database()'",
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
  } catch {
    databaseName = null;
  }
  try {
    const marker = execSync(
      "docker exec fix5-pg psql -U postgres -d postgres -tAc \"select config_value from analyzer_runtime_config where config_key = 'disposable_test_stack'\"",
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    if (marker) disposableMarker = marker;
  } catch {
    /* keep env marker */
  }
  let containerNames: string[] | null = null;
  try {
    containerNames = execSync("docker ps --format '{{.Names}}'", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    })
      .split("\n")
      .map((name) => name.trim())
      .filter((name) => (REQUIRED_STACK_CONTAINERS as readonly string[]).includes(name));
  } catch {
    containerNames = null;
  }
  return {
    remotes,
    branch,
    head,
    descendsFromFix6,
    supabaseUrl: target.url,
    restUrl: process.env.LIVE_POSTGREST_URL || "http://127.0.0.1:3000",
    authUrl: process.env.LIVE_AUTH_URL || "http://127.0.0.1:9999",
    storageUrl: process.env.LIVE_STORAGE_URL || `${target.url}/storage/v1`,
    databaseName,
    disposableMarker,
    containerNames
  };
}

function assertSafety(target: Target) {
  const decision = evaluateLiveSafety(collectLiveSafetyInput(target));
  if (!decision.ok) {
    fail("safety.gate", { code: decision.code }, decision.reason);
  }
}

function client(url: string, key: string, accessToken?: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined
  });
}

function assertNoSecrets(label: string, body: string) {
  if (SENSITIVE.test(body)) {
    fail("security.leak", { label }, "HTTP body contained a token, service-role marker, or signed URL.");
  }
  if (body.includes("SUPABASE_SERVICE_ROLE_KEY") || /NEXT_PUBLIC_[A-Z0-9_]*SERVICE_ROLE/.test(body)) {
    fail("security.leak", { label }, "HTTP body mentioned a service-role variable.");
  }
}

async function cookieHeader(target: Target, session: Session): Promise<string> {
  const jar = new Map<string, string>();
  const browser = createBrowserClient(target.url, target.anonKey, {
    isSingleton: false,
    cookies: {
      getAll() {
        return [...jar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const item of cookiesToSet) jar.set(item.name, item.value);
      }
    }
  });
  const { error } = await browser.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token
  });
  if (error || jar.size === 0) {
    fail("auth.cookies", { cookies: jar.size }, "Could not materialize Auth cookies for the HTTP client.");
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

type UserSession = {
  label: "A" | "B";
  userId: string;
  email: string;
  cookie: string;
  accessToken: string;
  accountId?: string;
};

async function createUser(target: Target, admin: SupabaseClient, label: "A" | "B"): Promise<UserSession> {
  const email = `m3-${randomUUID()}-${label.toLowerCase()}@example.test`;
  const password = randomBytes(24).toString("base64url") + `${label}a1`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    fail("setup.users", {}, "Could not create an isolated staging user.");
  }
  const anon = client(target.url, target.anonKey);
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) {
    fail("setup.users", {}, "Could not authenticate an isolated staging user.");
  }
  return {
    label,
    userId: created.data.user.id,
    email,
    accessToken: signed.data.session.access_token,
    cookie: await cookieHeader(target, signed.data.session)
  };
}

async function api(
  cookie: string,
  pathname: string,
  init: RequestInit = {}
): Promise<{ status: number; body: string; json: unknown; headers: Headers }> {
  const headers: Record<string, string> = {
    origin: APP_ORIGIN,
    "sec-fetch-site": "same-origin"
  };
  if (cookie) headers.cookie = cookie;
  if (init.headers) {
    const extra = new Headers(init.headers);
    extra.forEach((value, key) => {
      headers[key] = value;
    });
  }
  const response = await undiciRequest(`${APP_ORIGIN}${pathname}`, {
    method: (init.method as string) || "GET",
    headers,
    body: init.body as string | Buffer | Uint8Array | FormData | undefined,
    maxRedirections: 0
  });
  const body = await response.body.text();
  assertNoSecrets(pathname, body);
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  const headerBag = new Headers();
  for (const [key, value] of Object.entries(response.headers)) {
    if (typeof value === "string") headerBag.set(key, value);
    else if (Array.isArray(value) && value[0]) headerBag.set(key, value[0]);
  }
  return { status: response.statusCode, body, json, headers: headerBag };
}

async function uploadPdf(
  cookie: string,
  filename: string,
  bytes: Buffer,
  extras: Record<string, string> = {},
  redirect = false
) {
  const dir = mkdtempSync(path.join(tmpdir(), "m3-upload-"));
  const pdfPath = path.join(dir, filename.replace(/[^\w.-]+/g, "_"));
  const cfgPath = path.join(dir, "curl.cfg");
  const bodyPath = path.join(dir, "body");
  const headerPath = path.join(dir, "headers");
  writeFileSync(pdfPath, bytes);
  const lines = [
    `url = "${APP_ORIGIN}/api/upload"`,
    "request = POST",
    `header = "Origin: ${APP_ORIGIN}"`,
    'header = "sec-fetch-site: same-origin"',
    `header = "Cookie: ${cookie.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
    `form = "files=@${pdfPath};type=application/pdf;filename=${filename}"`
  ];
  if (redirect) lines.push('form = "redirect=1"');
  for (const [key, value] of Object.entries(extras)) {
    lines.push(`form = "${key}=${value.replace(/"/g, '\\"')}"`);
  }
  writeFileSync(cfgPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  try {
    const statusText = execFileSync(
      "curl",
      ["-sS", "-D", headerPath, "-o", bodyPath, "-w", "%{http_code}", "-K", cfgPath],
      { encoding: "utf8", timeout: 30_000 }
    ).trim();
    const body = readFileSync(bodyPath, "utf8");
    assertNoSecrets("/api/upload", body);
    let json: unknown = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    const headerBag = new Headers();
    for (const line of readFileSync(headerPath, "utf8").split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) headerBag.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
    }
    return { status: Number(statusText), body, json, headers: headerBag };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function workerCfg(workerId: string): WorkerConfig {
  return {
    workerId,
    concurrency: 1,
    claimLimit: 1,
    pollMs: 50,
    backoffMaxMs: 200,
    shutdownMs: 2_000,
    heartbeatMs: 1_000,
    leaseMs: 120_000
  };
}

function configureWorkerEnv(target: Target) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = target.url;
  process.env.SUPABASE_URL = target.url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = target.anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = target.serviceRoleKey;
  process.env.POLICY_ANALYZER_ENV = "staging";
  process.env.POLICY_RETENTION_DAYS = "30";
  process.env.POLICY_ANALYZER_UPLOADS_ENABLED = "true";
  delete process.env.POLICY_ANALYZER_STORE;
}

function webEnv(target: Target): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: target.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: target.anonKey,
    SUPABASE_URL: target.url,
    SUPABASE_ANON_KEY: target.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: target.serviceRoleKey,
    POLICY_ANALYZER_ENV: "staging",
    POLICY_ANALYZER_UPLOADS_ENABLED: "true",
    POLICY_RETENTION_DAYS: "30",
    POLICY_ANALYZER_OPS_TOKEN: randomBytes(16).toString("hex"),
    ENABLE_FIXTURE_ANALYSIS: "false",
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1"
  };
}

async function waitForApp(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${APP_ORIGIN}/api/health/live`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail("app.ready", { origin: APP_ORIGIN }, "Staging web process did not become live.");
}

async function startApp(target: Target): Promise<ChildProcess | null> {
  if (process.env.STAGING_APP_URL) {
    await waitForApp();
    return null;
  }
  try {
    execSync(`fuser -k ${PORT}/tcp`, { stdio: "ignore" });
  } catch {
    /* port was free */
  }
  if (!existsSync(path.join(APP_ROOT, ".next"))) {
    fail("app.build", {}, "next start requires a production build. Run npm run build first.");
  }
  const child = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: APP_ROOT,
    env: webEnv(target),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    captured.push(safePrint(chunk.toString()));
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    captured.push(safePrint(chunk.toString()));
  });
  try {
    await waitForApp();
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
  return child;
}

function assertCitations(report: PolicyRecord) {
  const ids = new Set(report.documents.map((document) => document.document_id));
  if (ids.size !== report.documents.length) {
    fail("happy.citations", { documents: report.documents.length }, "Published report reused document IDs.");
  }
  const pages = new Map(report.documents.map((document) => [document.document_id, document.page_count]));
  const cited = [
    ...report.coverages.filter((item) => item.coverage_status !== "NOT FOUND" && item.source_document_id),
    ...report.exclusions.filter((item) => item.source_document_id),
    ...report.financial_limits.filter((item) => item.source_document_id)
  ].map((item) => ({
    source_document_id: item.source_document_id,
    source_page: item.source_page
  }));
  if (!cited.length) {
    fail("happy.citations", { cited: 0 }, "Completed report had no cited findings.");
  }
  for (const finding of cited) {
    if (!ids.has(finding.source_document_id)) {
      fail("happy.citations", {}, "A finding cited a document that is not in the published report.");
    }
    const pageCount = pages.get(finding.source_document_id) || 0;
    if (finding.source_page < 1 || finding.source_page > pageCount) {
      fail("happy.citations", { page: finding.source_page, pageCount }, "A citation page is outside the uploaded document.");
    }
  }
}

async function main() {
  const target = loadTarget();
  assertSafety(target);
  configureWorkerEnv(target);
  const admin = client(target.url, target.serviceRoleKey);
  await admin.from("analyzer_runtime_config").update({ config_value: "100" }).eq("config_key", "uploads_per_account_per_hour");
  await admin.from("analyzer_runtime_config").update({ config_value: "40" }).eq("config_key", "active_jobs_per_account");

  const userA = await createUser(target, admin, "A");
  const userB = await createUser(target, admin, "B");
  const createdUserIds = [userA.userId, userB.userId];
  const app = await startApp(target);
  const persistence = createWorkerPersistence();

  try {
    const complete = await buildCompletePolicyPdf();
    const spoofedPolicy = "99999999-9999-4999-8999-999999999999";
    const uploaded = await uploadPdf(
      userA.cookie,
      "m3-complete.pdf",
      complete,
      {
        user_id: userB.userId,
        account_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        policy_id: spoofedPolicy,
        storage_path: `${userB.userId}/stolen/file.pdf`
      }
    );
    if (uploaded.status !== 202) {
      const err = uploaded.json && typeof uploaded.json === "object" ? uploaded.json as { error?: string; code?: string } : {};
      fail(
        "happy.upload",
        { status: uploaded.status, error: err.error || "", code: err.code || "" },
        `Authenticated upload did not return 202 queued (${uploaded.status} ${err.code || err.error || "no_body"}).`
      );
    }
    const queued = uploaded.json as { policy_id?: string; job_id?: string; status?: string };
    if (!queued.policy_id || !queued.job_id || queued.status !== "queued") {
      fail("happy.upload", {}, "Upload response omitted the durable job identity.");
    }
    if (queued.policy_id === spoofedPolicy) {
      fail("happy.ownership", {}, "Client-submitted policy ID was accepted as ownership.");
    }
    originalLog("  ✓ happy-path upload returned 202 and ignored client-submitted ownership");

    const pending = await api(userA.cookie, `/api/policies/${queued.policy_id}/status`);
    const pendingJson = pending.json as { status?: string };
    if (pending.status !== 200 || pendingJson.status !== "queued") {
      fail("happy.status", { status: pending.status }, "Owner status was not queued after upload.");
    }
    const earlyReport = await api(userA.cookie, `/api/policies/${queued.policy_id}`);
    if (earlyReport.status !== 404) {
      fail("happy.unpublished", { status: earlyReport.status }, "Queued job published a report before the worker ran.");
    }

    let claimedOurs = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const pendingNow = await api(userA.cookie, `/api/policies/${queued.policy_id}/status`);
      const pendingStatus = (pendingNow.json as { status?: string }).status;
      if (pendingStatus && pendingStatus !== "queued" && pendingStatus !== "processing") break;
      const once = await new AnalysisWorker({
        store: persistence,
        config: workerCfg(`m3-happy-${randomUUID().slice(0, 8)}`)
      }).runOnce();
      claimedOurs += once.claimed;
      if (once.claimed === 0) break;
    }
    if (claimedOurs < 1) {
      fail("happy.worker", { claimed: claimedOurs }, "Worker did not claim the uploaded job.");
    }

    const done = await api(userA.cookie, `/api/policies/${queued.policy_id}/status`);
    const doneJson = done.json as { status?: string };
    if (doneJson.status !== "completed" && doneJson.status !== "needs_review") {
      fail("happy.complete", { status: doneJson.status }, "Worker did not reach a published terminal state.");
    }
    const reportRes = await api(userA.cookie, `/api/policies/${queued.policy_id}`);
    if (reportRes.status !== 200 || !reportRes.json || typeof reportRes.json !== "object") {
      fail("happy.report", { status: reportRes.status }, "Owner could not retrieve the published report.");
    }
    const report = reportRes.json as PolicyRecord;
    if (report.policy_id !== queued.policy_id) {
      fail("happy.report", {}, "Published report was bound to a different policy.");
    }
    if (JSON.stringify(report).includes("storage_location") && report.documents.some((d) => d.storage_location)) {
      fail("happy.report", {}, "HTTP report leaked object storage paths.");
    }
    assertCitations(report);
    if (!/EQ-COMP-1|Ada Cole|Full Mortality/i.test(JSON.stringify(report))) {
      fail("happy.report", {}, "Cited report did not reflect the uploaded complete policy.");
    }
    originalLog("  ✓ happy-path queued → processing → completed → cited report retrieved");

    const redirectUpload = await uploadPdf(userA.cookie, "m3-redirect.pdf", complete, {}, true);
    if (redirectUpload.status !== 303) {
      fail("happy.redirect", { status: redirectUpload.status }, "Browser upload form did not redirect to the analysis page.");
    }
    const location = redirectUpload.headers.get("location") || "";
    const redirectedId = location.match(/\/analysis\/([0-9a-f-]{36})/i)?.[1];
    if (!redirectedId) {
      fail("happy.redirect", {}, "Redirect target was not the owner analysis page.");
    }
    const redirectedCancel = await api(userA.cookie, `/api/policies/${redirectedId}/cancel`, { method: "POST" });
    if (redirectedCancel.status !== 200) {
      fail("happy.redirect", { status: redirectedCancel.status }, "Could not drain the redirect-path job.");
    }
    originalLog("  ✓ browser upload form redirects to the in-flight analysis page");

    const crossStatus = await api(userB.cookie, `/api/policies/${queued.policy_id}/status`);
    const crossReport = await api(userB.cookie, `/api/policies/${queued.policy_id}`);
    const crossOriginal = await api(userB.cookie, `/api/policies/${queued.policy_id}/original`);
    const crossCancel = await api(userB.cookie, `/api/policies/${queued.policy_id}/cancel`, { method: "POST" });
    const anonStatus = await api("", `/api/policies/${queued.policy_id}/status`);
    if ([crossStatus.status, crossReport.status, crossOriginal.status, crossCancel.status, anonStatus.status].some((status) => status !== 404)) {
      fail(
        "security.isolation",
        {
          crossStatus: crossStatus.status,
          crossReport: crossReport.status,
          crossOriginal: crossOriginal.status,
          crossCancel: crossCancel.status,
          anonStatus: anonStatus.status
        },
        "User B or an anonymous client enumerated User A's upload, job, or report."
      );
    }
    const claim = await userBAccessDenied(target, userB.accessToken);
    if (!claim) {
      fail("security.worker", {}, "An ordinary user executed a worker-only claim.");
    }
    const accountRow = await admin
      .from("policy_analyses")
      .select("account_id")
      .eq("analyzer_policy_id", queued.policy_id)
      .maybeSingle();
    const guessed = `${accountRow.data?.account_id || userA.userId}/${queued.policy_id}/${queued.job_id}.pdf`;
    const stolen = await client(target.url, target.anonKey, userB.accessToken)
      .storage.from("policy-files")
      .download(guessed);
    if (!stolen.error) {
      fail("security.storage", {}, "User B downloaded User A's object by guessing the storage path.");
    }
    originalLog("  ✓ User B cannot read User A's upload, job, report, or guessed storage path");

    const failUpload = await uploadPdf(userA.cookie, "m3-fail.pdf", complete);
    const failQueued = failUpload.json as { policy_id?: string };
    const failAnalysis = await admin
      .from("policy_analyses")
      .select("upload_id")
      .eq("analyzer_policy_id", failQueued.policy_id)
      .maybeSingle();
    const failFiles = await admin
      .from("uploaded_policy_files")
      .select("object_storage_key")
      .eq("upload_id", failAnalysis.data?.upload_id)
      .limit(1);
    const failPath = failFiles.data?.[0]?.object_storage_key as string | undefined;
    if (!failPath) fail("failure.setup", {}, "Could not locate the uploaded object for the failure path.");
    await admin.storage.from("policy-files").remove([failPath]);
    await admin.storage.from("policy-files").upload(failPath, Buffer.from("%PDF-1.4\nnot-the-reserved-bytes\n%%EOF\n"), {
      contentType: "application/pdf",
      upsert: true
    });
    let failedOnce = { results: [] as Array<{ outcome?: string }> };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await api(userA.cookie, `/api/policies/${failQueued.policy_id}/status`);
      const currentStatus = (current.json as { status?: string }).status;
      if (currentStatus && currentStatus !== "queued" && currentStatus !== "processing") break;
      failedOnce = await new AnalysisWorker({
        store: persistence,
        config: workerCfg(`m3-fail-${randomUUID().slice(0, 8)}`)
      }).runOnce();
      if (failedOnce.claimed === 0) break;
    }
    const failStatus = await api(userA.cookie, `/api/policies/${failQueued.policy_id}/status`);
    const failStatusJson = failStatus.json as { status?: string };
    const failReport = await api(userA.cookie, `/api/policies/${failQueued.policy_id}`);
    if (failStatusJson.status !== "failed" && !failedOnce.results.some((result) => result.outcome === "failed")) {
      fail("failure.state", { status: failStatusJson.status }, "Malformed document did not fail closed.");
    }
    if (failReport.status !== 404) {
      fail("failure.publish", { status: failReport.status }, "Failed job published a valid report.");
    }
    originalLog("  ✓ malformed document failed closed with no published report");

    const cancelUpload = await uploadPdf(userA.cookie, "m3-cancel.pdf", complete);
    const cancelQueued = cancelUpload.json as { policy_id?: string };
    const cancelWorker = `m3-cancel-${randomUUID().slice(0, 8)}`;
    const claimed = await admin.rpc("claim_analysis_jobs", {
      p_worker_id: cancelWorker,
      p_limit: 1
    });
    const cancelJob = (Array.isArray(claimed.data) ? claimed.data : []).find(
      (row: { policy_id?: string }) => row.policy_id === cancelQueued.policy_id
    ) as { job_id?: string } | undefined;
    if (!cancelJob?.job_id) {
      fail("cancel.claim", {}, "Could not claim the job for the cancellation path.");
    }
    const cancelled = await api(userA.cookie, `/api/policies/${cancelQueued.policy_id}/cancel`, { method: "POST" });
    if (cancelled.status !== 200) {
      fail("cancel.owner", { status: cancelled.status }, "Owner cancel was not authorized.");
    }
    const stale = await admin.rpc("complete_analysis_job", {
      p_job_id: cancelJob.job_id,
      p_worker_id: cancelWorker,
      p_report: { policy_id: cancelQueued.policy_id }
    });
    if (!stale.error) {
      fail("cancel.publish", {}, "Cancelled job later published as completed.");
    }
    const cancelReport = await api(userA.cookie, `/api/policies/${cancelQueued.policy_id}`);
    const cancelStatus = await api(userA.cookie, `/api/policies/${cancelQueued.policy_id}/status`);
    if (cancelReport.status !== 404 || (cancelStatus.json as { status?: string }).status === "completed") {
      fail("cancel.final", { report: cancelReport.status }, "Cancelled job exposed a completed report.");
    }
    originalLog("  ✓ cancelled job cannot later publish as completed");

    const duelUpload = await uploadPdf(userA.cookie, "m3-duel.pdf", complete);
    const [left, right] = await Promise.all([
      new AnalysisWorker({ store: persistence, config: workerCfg(`m3-duel-a-${randomUUID().slice(0, 8)}`) }).runOnce(),
      new AnalysisWorker({ store: persistence, config: workerCfg(`m3-duel-b-${randomUUID().slice(0, 8)}`) }).runOnce()
    ]);
    if (left.claimed + right.claimed !== 1) {
      fail("duel.winner", { left: left.claimed, right: right.claimed }, "Two workers completed or dropped the same job.");
    }
    const duelQueued = duelUpload.json as { policy_id?: string };
    const reports = await admin
      .from("report_sections")
      .select("section_key")
      .eq(
        "policy_analysis_id",
        (
          await admin
            .from("policy_analyses")
            .select("policy_analysis_id")
            .eq("analyzer_policy_id", duelQueued.policy_id)
            .maybeSingle()
        ).data?.policy_analysis_id
      );
    if ((reports.data || []).length !== 1) {
      fail("duel.report", { count: reports.data?.length }, "Duplicate processing published conflicting reports.");
    }
    originalLog("  ✓ only one valid completion can win");

    originalLog("M3 STAGING INTEGRATION OK");
  } finally {
    if (app?.pid) {
      try {
        process.kill(-app.pid, "SIGTERM");
      } catch {
        app.kill("SIGKILL");
      }
      app.stdout?.destroy();
      app.stderr?.destroy();
    }
    for (const userId of createdUserIds) {
      const memberships = await admin.from("account_members").select("account_id").eq("user_id", userId);
      for (const row of memberships.data || []) {
        await admin.from("accounts").delete().eq("account_id", row.account_id);
      }
      await admin.auth.admin.deleteUser(userId);
    }
  }

  void createdUserIds;
}

async function userBAccessDenied(target: Target, accessToken: string): Promise<boolean> {
  const res = await fetch(`${target.url}/rest/v1/rpc/claim_analysis_jobs`, {
    method: "POST",
    headers: {
      apikey: target.anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ p_worker_id: "user-b", p_limit: 1 })
  });
  return res.status === 401 || res.status === 403 || res.status === 404 || !res.ok;
}

void assert;
void main().catch((error) => {
  originalError("M3 STAGING INTEGRATION FAILED");
  originalError(safePrint(String(error)));
  process.exit(1);
});
