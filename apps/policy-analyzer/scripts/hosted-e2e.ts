/**
 * Hosted Demo V1 E2E against an allowlisted staging web + Railway worker.
 * Refuses loopback, unknown remotes, and production. Secrets are never printed.
 * Live run requires POLICY_ANALYZER_HOSTED_E2E=YES.
 */
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { request as undiciRequest } from "undici";
import { createBrowserClient } from "@supabase/ssr";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { buildCompletePolicyPdf } from "../lib/build-complete-pdf";
import {
  assertHostedE2ETarget,
  evaluateHostedE2ETarget,
  hostedE2EAuthFromEnv
} from "../lib/deploy/hosted-e2e-target";
import { evaluateCleanupScope } from "./live-safety";
import type { PolicyRecord } from "../lib/types";

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

class HostedE2EFailure extends Error {
  constructor(
    readonly stage: string,
    readonly invariant: string,
    readonly likelyCause: string
  ) {
    super(`${invariant}: ${likelyCause}`);
    this.name = "HostedE2EFailure";
  }
}

let currentStage = "setup";

function setStage(stage: string): void {
  currentStage = stage;
}

function safePrint(value: unknown): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, "[redacted-jwt]")
    .replace(/postgresql:\/\/[^\s"']+/gi, "[redacted-db]")
    .replace(/sb_secret_[A-Za-z0-9]+/g, "[redacted-key]");
}

function fail(invariant: string, cause: string): never {
  throw new HostedE2EFailure(currentStage, invariant, cause);
}

function assertNoSecrets(label: string, body: string): void {
  if (SENSITIVE.test(body) || body.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    fail("security.leak", `${label} contained a token, key, or signed URL.`);
  }
}

type Target = { url: string; anonKey: string; serviceRoleKey: string; appOrigin: string };

type UserSession = {
  label: "A" | "B";
  userId: string;
  cookie: string;
  accountId?: string;
};

function loadLiveTarget(): Target | null {
  const decision = evaluateHostedE2ETarget(hostedE2EAuthFromEnv());
  if (decision.reason === "not_requested") {
    originalLog("HOSTED_E2E_NOT_CONFIGURED");
    return null;
  }
  const { hostname, appHost } = assertHostedE2ETarget();
  const supabaseUrl = (
    process.env.POLICY_ANALYZER_HOSTED_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  const service = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const appOrigin = (process.env.POLICY_ANALYZER_STAGING_APP_URL || "").replace(/\/$/, "");
  if (!supabaseUrl || !anon || !service || !appOrigin) {
    fail("setup.credentials", "Hosted E2E is requested but required environment variables are missing.");
  }
  void hostname;
  void appHost;
  return { url: supabaseUrl, anonKey: anon, serviceRoleKey: service, appOrigin };
}

function client(url: string, key: string, accessToken?: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined
  });
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
    fail("setup.session", "Could not materialize Auth cookies for the HTTP client.");
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function createUser(target: Target, admin: SupabaseClient, label: "A" | "B"): Promise<UserSession> {
  const createStage = label === "A" ? "create_user_a" : "create_user_b";
  const signinStage = label === "A" ? "signin_user_a" : "signin_user_b";
  const email = `hosted-e2e-${randomUUID()}-${label.toLowerCase()}@example.test`;
  const password = randomBytes(24).toString("base64url") + `${label}a1`;
  setStage(createStage);
  let created;
  try {
    created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  } catch {
    fail("setup.users", "Could not create an isolated hosted staging user.");
  }
  if (created.error || !created.data.user) {
    fail("setup.users", "Could not create an isolated hosted staging user.");
  }
  setStage(signinStage);
  let signed;
  try {
    signed = await client(target.url, target.anonKey).auth.signInWithPassword({ email, password });
  } catch {
    fail("setup.users", "Could not authenticate an isolated hosted staging user.");
  }
  if (signed.error || !signed.data.session) {
    fail("setup.users", "Could not authenticate an isolated hosted staging user.");
  }
  return {
    label,
    userId: created.data.user.id,
    cookie: await cookieHeader(target, signed.data.session)
  };
}

async function api(
  target: Target,
  cookie: string,
  pathname: string,
  init: RequestInit = {}
): Promise<{ status: number; json: unknown; body: string }> {
  const headers: Record<string, string> = {
    origin: target.appOrigin,
    "sec-fetch-site": "same-origin"
  };
  if (cookie) headers.cookie = cookie;
  const response = await undiciRequest(`${target.appOrigin}${pathname}`, {
    method: (init.method as string) || "GET",
    headers,
    body: init.body as string | Buffer | Uint8Array | undefined,
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
  return { status: response.statusCode, json, body };
}

async function uploadPdf(target: Target, cookie: string, filename: string, bytes: Buffer) {
  const dir = mkdtempSync(path.join(tmpdir(), "hosted-e2e-"));
  const pdfPath = path.join(dir, filename.replace(/[^\w.-]+/g, "_"));
  const cfgPath = path.join(dir, "curl.cfg");
  const bodyPath = path.join(dir, "body");
  writeFileSync(pdfPath, bytes);
  writeFileSync(
    cfgPath,
    [
      `url = "${target.appOrigin}/api/upload"`,
      "request = POST",
      `header = "Origin: ${target.appOrigin}"`,
      'header = "sec-fetch-site: same-origin"',
      `header = "Cookie: ${cookie.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
      `form = "files=@${pdfPath};type=application/pdf;filename=${filename}"`,
      ""
    ].join("\n"),
    { mode: 0o600 }
  );
  try {
    let statusText: string;
    try {
      statusText = execFileSync(
        "curl",
        ["-sS", "-o", bodyPath, "-w", "%{http_code}", "-K", cfgPath],
        { encoding: "utf8", timeout: 60_000 }
      ).trim();
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "ENOENT") {
        fail("happy.upload", "Upload client is not available in the runtime image.");
      }
      fail("happy.upload", "Authenticated upload could not be sent.");
    }
    const body = readFileSync(bodyPath, "utf8");
    assertNoSecrets("/api/upload", body);
    let json: unknown = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    return { status: Number(statusText), json, body };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertCitations(report: PolicyRecord): number {
  const ids = new Set(report.documents.map((document) => document.document_id));
  if (!ids.size) fail("happy.citations", "Completed report had no documents.");
  const pages = new Map(report.documents.map((document) => [document.document_id, document.page_count]));
  const cited = [
    ...report.coverages.filter((item) => item.coverage_status !== "NOT FOUND" && item.source_document_id),
    ...report.exclusions.filter((item) => item.source_document_id),
    ...report.financial_limits.filter((item) => item.source_document_id)
  ];
  if (!cited.length) fail("happy.citations", "Completed report had no cited findings.");
  for (const finding of cited) {
    if (!ids.has(finding.source_document_id)) {
      fail("happy.citations", "A finding cited a document that is not in the published report.");
    }
    const pageCount = pages.get(finding.source_document_id) || 0;
    if (finding.source_page < 1 || finding.source_page > pageCount) {
      fail("happy.citations", "A citation page is outside the uploaded document.");
    }
  }
  return cited.length;
}

async function assertReadiness(target: Target): Promise<void> {
  setStage("readiness");
  const token = (process.env.POLICY_ANALYZER_OPS_TOKEN || "").trim();
  if (!token) fail("readiness", "POLICY_ANALYZER_OPS_TOKEN is required for hosted readiness.");
  const response = await undiciRequest(`${target.appOrigin}/api/ops/ready`, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.body.text();
  assertNoSecrets("/api/ops/ready", body);
  let json: { ready?: boolean; uploads_enabled?: boolean } = {};
  try {
    json = JSON.parse(body) as { ready?: boolean; uploads_enabled?: boolean };
  } catch {
    fail("readiness", "Readiness response was not JSON.");
  }
  if (response.statusCode !== 200 || json.ready !== true) {
    fail("readiness", "Hosted readiness is not healthy.");
  }
  if (json.uploads_enabled !== true) {
    setStage("uploads");
    fail("uploads", "Hosted staging uploads are disabled.");
  }
}

async function resolveAccountId(admin: SupabaseClient, userId: string): Promise<string | undefined> {
  const { data } = await admin.from("account_members").select("account_id").eq("user_id", userId).maybeSingle();
  return data?.account_id;
}

async function cleanup(
  admin: SupabaseClient,
  users: UserSession[]
): Promise<void> {
  const accountIds = users.map((user) => user.accountId).filter((id): id is string => Boolean(id));
  if (accountIds.length) {
    const scope = evaluateCleanupScope(accountIds);
    if (!scope.ok) fail("cleanup.scope", scope.reason);
    for (const accountId of accountIds) {
      const { data: uploads } = await admin.storage.from("policy-files").list(accountId, { limit: 1000 });
      if (uploads) {
        for (const upload of uploads) {
          const prefix = `${accountId}/${upload.name}`;
          const { data: files } = await admin.storage.from("policy-files").list(prefix, { limit: 1000 });
          const paths = (files ?? []).map((file) => `${prefix}/${file.name}`);
          if (paths.length) await admin.storage.from("policy-files").remove(paths);
          await admin.storage.from("policy-files").remove([prefix]);
        }
      }
    }
    await admin.from("report_sections").delete().in("account_id", accountIds);
    await admin.from("analysis_jobs").delete().in("account_id", accountIds);
    await admin.from("uploaded_policy_files").delete().in("account_id", accountIds);
    await admin.from("policy_analyses").delete().in("account_id", accountIds);
    await admin.from("uploads").delete().in("account_id", accountIds);
    const reservations = await admin.from("upload_reservations").select("reservation_id").in("account_id", accountIds);
    const reservationIds = reservations.data?.map((row) => row.reservation_id) ?? [];
    if (reservationIds.length) {
      await admin.from("upload_reservation_files").delete().in("reservation_id", reservationIds);
    }
    await admin.from("upload_reservations").delete().in("account_id", accountIds);
    await admin.from("account_usage_windows").delete().in("account_id", accountIds);
    await admin.from("audit_events").delete().in("account_id", accountIds);
    await admin.from("account_members").delete().in("account_id", accountIds);
    await admin.from("accounts").delete().in("account_id", accountIds);
  }
  for (const user of users) {
    await admin.auth.admin.deleteUser(user.userId);
  }
}

async function runLive(): Promise<void> {
  const target = loadLiveTarget();
  if (!target) return;

  await assertReadiness(target);
  const admin = client(target.url, target.serviceRoleKey);
  const users: UserSession[] = [];
  try {
    const userA = await createUser(target, admin, "A");
    const userB = await createUser(target, admin, "B");
    users.push(userA, userB);

    setStage("prepare_pdf");
    let pdf: Buffer;
    try {
      pdf = await buildCompletePolicyPdf();
    } catch {
      fail("happy.pdf", "Could not build the synthetic complete policy PDF.");
    }
    if (!pdf.length || pdf.subarray(0, 4).toString() !== "%PDF") {
      fail("happy.pdf", "Synthetic complete policy PDF was not readable.");
    }

    setStage("upload");
    const uploaded = await uploadPdf(target, userA.cookie, "hosted-e2e-complete.pdf", pdf);
    if (uploaded.status !== 202) {
      fail("happy.upload", `Authenticated upload did not return 202 queued (${uploaded.status}).`);
    }
    const queued = uploaded.json as { policy_id?: string; job_id?: string; status?: string };
    if (!queued.policy_id || !queued.job_id || queued.status !== "queued") {
      fail("happy.upload", "Upload response omitted the durable job identity.");
    }

    userA.accountId = await resolveAccountId(admin, userA.userId);
    userB.accountId = await resolveAccountId(admin, userB.userId);

    setStage("progress");
    const seen = new Set<string>(["queued"]);
    let last = "queued";
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const statusRes = await api(target, userA.cookie, `/api/policies/${queued.policy_id}/status`);
      last = ((statusRes.json as { status?: string } | null)?.status || last).toLowerCase();
      seen.add(last);
      if (last === "completed") break;
      if (last === "failed" || last === "cancelled") {
        fail("happy.progress", `Job reached ${last} instead of completed.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (last !== "completed") {
      fail("happy.progress", "Hosted worker did not complete the uploaded job in time.");
    }
    if (!seen.has("queued") || !seen.has("completed")) {
      fail("happy.progress", "Job did not progress through queued to completed.");
    }
    if (!seen.has("processing") && seen.size < 2) {
      fail("happy.progress", "Job never left queued.");
    }

    setStage("report");
    const reportRes = await api(target, userA.cookie, `/api/policies/${queued.policy_id}`);
    if (reportRes.status !== 200 || !reportRes.json || typeof reportRes.json !== "object") {
      fail("happy.report", "Owner could not retrieve the published report.");
    }
    const report = reportRes.json as PolicyRecord;
    if (report.policy_id !== queued.policy_id) {
      fail("happy.report", "Published report was bound to a different policy.");
    }
    const citationCount = assertCitations(report);

    setStage("isolation");
    const crossStatus = await api(target, userB.cookie, `/api/policies/${queued.policy_id}/status`);
    const crossReport = await api(target, userB.cookie, `/api/policies/${queued.policy_id}`);
    const crossOriginal = await api(target, userB.cookie, `/api/policies/${queued.policy_id}/original`);
    const crossCancel = await api(target, userB.cookie, `/api/policies/${queued.policy_id}/cancel`, {
      method: "POST"
    });
    if ([crossStatus.status, crossReport.status, crossOriginal.status, crossCancel.status].some((status) => status !== 404)) {
      fail("security.isolation", "User B enumerated or mutated User A's job, report, or original.");
    }

    const ownerAfter = await api(target, userA.cookie, `/api/policies/${queued.policy_id}/status`);
    if (((ownerAfter.json as { status?: string } | null)?.status || "") !== "completed") {
      fail("security.isolation", "User B isolation check disturbed User A's completed job.");
    }

    originalLog("HOSTED E2E: PASS");
    originalLog(`progress=${[...seen].join(",")}`);
    originalLog(`citations=${citationCount}`);
    originalLog("isolation=PASS");
  } finally {
    try {
      setStage("cleanup");
      await cleanup(admin, users);
      originalLog("cleanup=PASS");
    } catch (error) {
      originalError("cleanup=FAIL");
      throw error;
    }
  }
}

async function main(): Promise<void> {
  await runLive();
  if (captured.some((line) => SENSITIVE.test(line))) {
    fail("security.leak", "A secret was printed during hosted E2E.");
  }
}

void main().catch((error) => {
  const stage = error instanceof HostedE2EFailure ? error.stage : currentStage;
  originalError(`stage=${safePrint(stage)}`);
  const message = error instanceof HostedE2EFailure ? error.message : "HOSTED_E2E_FAILED";
  originalError(safePrint(message.includes(":") ? message : "HOSTED_E2E_FAILED"));
  originalError("HOSTED E2E: FAIL");
  process.exitCode = 1;
});
