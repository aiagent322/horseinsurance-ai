import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { POST as uploadPost } from "../app/api/upload/route";
import { GET as statusGet } from "../app/api/policies/[id]/status/route";
import { GET as reportGet, DELETE as reportDelete } from "../app/api/policies/[id]/route";
import { GET as originalGet } from "../app/api/policies/[id]/original/route";
import { AnonymousSignInError, ensureAnonymousBrowserSession } from "../lib/auth/anonymous-start";
import { AuthRequiredError, demoAnonymousAuthEnabled } from "../lib/persistence/config";
import { ingestPolicyPackage } from "../lib/ingest";
import { auditContainsSensitive, sanitizeAuditEvent } from "../lib/persistence/audit";
import { MemoryPolicyStore } from "../lib/persistence/memory-store";
import { assertSameOrigin } from "../lib/persistence/same-origin";
import { TEST_ACTOR_A, TEST_ACTOR_B, runWithActor } from "../lib/persistence/actor-context";
import { resetMemoryStoreForTests } from "../lib/persistence/factory";
import { sampleFiles, sampleReport, tinyPdf } from "./test-fixtures";
import type { PolicyRecord } from "../lib/types";
import type { Actor, ClaimedJob } from "../lib/persistence/types";

function scanClientFiles(): string[] {
  const roots = [path.join(process.cwd(), "components"), path.join(process.cwd(), "app")];
  const hits: string[] = [];
  const stack = [...roots];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
      const source = readFileSync(full, "utf8");
      const isClient = source.includes('"use client"') || source.includes("'use client'");
      if (!isClient) continue;
      if (/SERVICE_ROLE|createAdminClient|serviceRoleKey/.test(source)) {
        hits.push(full);
      }
    }
  }
  return hits;
}

function boundReport(claimed: ClaimedJob): PolicyRecord {
  return sampleReport({
    policy_id: claimed.policyId,
    session_id: claimed.sessionId,
    documents: claimed.files.map((file) => ({
      document_id: file.documentId,
      session_id: claimed.sessionId,
      original_filename: file.filename,
      file_type: "application/pdf",
      upload_timestamp: new Date().toISOString(),
      file_hash: file.sha256 || "abc",
      page_count: 1,
      storage_location: file.path,
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

async function readStatus(
  actor: typeof TEST_ACTOR_A | typeof TEST_ACTOR_B | Actor | null,
  policyId: string
): Promise<Response> {
  const req = new Request(`http://127.0.0.1:43147/api/policies/${policyId}/status`);
  const call = () => statusGet(req, { params: Promise.resolve({ id: policyId }) });
  return actor ? runWithActor(actor, call) : call();
}

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

function assertDemoAnonymousAuthFlag(): void {
  withEnv(
    {
      POLICY_ANALYZER_DEMO_ANONYMOUS_AUTH: undefined,
      POLICY_ANALYZER_ENV: "staging",
      NODE_ENV: "production"
    },
    () => {
      assert.equal(demoAnonymousAuthEnabled(), false, "demo auth fails closed when the flag is unset");
    }
  );
  withEnv(
    {
      POLICY_ANALYZER_DEMO_ANONYMOUS_AUTH: "true",
      POLICY_ANALYZER_ENV: "staging",
      NODE_ENV: "production"
    },
    () => {
      assert.equal(demoAnonymousAuthEnabled(), false, "demo auth fails closed unless the flag is exactly YES");
    }
  );
  withEnv(
    {
      POLICY_ANALYZER_DEMO_ANONYMOUS_AUTH: "YES",
      POLICY_ANALYZER_ENV: "production",
      NODE_ENV: "production"
    },
    () => {
      assert.equal(demoAnonymousAuthEnabled(), false, "production never enables anonymous demo entry");
    }
  );
  withEnv(
    {
      POLICY_ANALYZER_DEMO_ANONYMOUS_AUTH: "YES",
      POLICY_ANALYZER_ENV: "staging",
      NODE_ENV: "production"
    },
    () => {
      assert.equal(demoAnonymousAuthEnabled(), true, "staging Demo V1 enables anonymous entry");
    }
  );
}

async function assertAnonymousSessionHelper(): Promise<void> {
  const existing = await ensureAnonymousBrowserSession({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "existing-user" } } } }),
      signInAnonymously: async () => {
        throw new Error("signInAnonymously must not run when a session exists");
      }
    }
  });
  assert.equal(existing.userId, "existing-user");
  assert.equal(existing.created, false);

  let signInCalls = 0;
  const created = await ensureAnonymousBrowserSession({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      signInAnonymously: async () => {
        signInCalls += 1;
        return { data: { session: { user: { id: "anon-user-a" } } }, error: null };
      }
    }
  });
  assert.equal(signInCalls, 1);
  assert.equal(created.userId, "anon-user-a");
  assert.equal(created.created, true);

  await assert.rejects(
    () =>
      ensureAnonymousBrowserSession({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          signInAnonymously: async () => ({ data: { session: null }, error: { message: "disabled" } })
        }
      }),
    (error: unknown) => error instanceof AnonymousSignInError
  );

  const userA = await ensureAnonymousBrowserSession({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      signInAnonymously: async () => ({ data: { session: { user: { id: "anon-a" } } }, error: null })
    }
  });
  const userB = await ensureAnonymousBrowserSession({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      signInAnonymously: async () => ({ data: { session: { user: { id: "anon-b" } } }, error: null })
    }
  });
  assert.notEqual(userA.userId, userB.userId, "each anonymous sign-in receives its own user id");
}

async function assertAnonymousUserIsolation(): Promise<void> {
  const store = resetMemoryStoreForTests();
  const accountA = await store.ensureAccount("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
  const accountB = await store.ensureAccount("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb");
  assert.ok(accountA.accountId);
  assert.ok(accountB.accountId);
  assert.notEqual(accountA.accountId, accountB.accountId, "anonymous users receive isolated account context");
  assert.notEqual(accountA.userId, accountB.userId);

  const actorA: Actor = { userId: accountA.userId, accountId: accountA.accountId, role: "owner" };
  const actorB: Actor = { userId: accountB.userId, accountId: accountB.accountId, role: "owner" };
  assert.equal(actorA.email, undefined);
  assert.equal(actorB.email, undefined);

  const form = new FormData();
  form.append("files", new File([tinyPdf("anon-isolation")], "anon-a-policy.pdf", { type: "application/pdf" }));
  const uploadReq = new Request("http://127.0.0.1:43147/api/upload", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:43147", "sec-fetch-site": "same-origin" },
    body: form
  });
  const uploaded = await runWithActor(actorA, () => uploadPost(uploadReq));
  assert.equal(uploaded.status, 202, "anonymous User A can upload");
  const queued = (await uploaded.json()) as { policy_id?: string; job_id?: string };
  assert.ok(queued.policy_id);
  const policyId = queued.policy_id;

  const ownerStatus = await readStatus(actorA, policyId);
  assert.equal(ownerStatus.status, 200, "anonymous User A can read own job status");

  const crossStatus = await readStatus(actorB, policyId);
  assert.equal(crossStatus.status, 404, "anonymous User B cannot read User A status");
  const anonStatus = await readStatus(null, policyId);
  assert.equal(anonStatus.status, 404, "unauthenticated callers cannot read status");
  const unknownStatus = await readStatus(actorA, "00000000-0000-4000-8000-000000000000");
  assert.equal(unknownStatus.status, 404, "unknown policy ids fail closed");

  const claimed = await store.claimJobs("w-anon-isolation", 1);
  const job = claimed.find((item) => item.policyId === policyId);
  assert.ok(job);
  await store.completeJob(job.jobId, "w-anon-isolation", boundReport(job));

  const ownerReport = await runWithActor(actorA, () =>
    reportGet(new Request(`http://127.0.0.1:43147/api/policies/${policyId}`), {
      params: Promise.resolve({ id: policyId })
    })
  );
  assert.equal(ownerReport.status, 200, "anonymous User A can read own report");

  const crossReport = await runWithActor(actorB, () =>
    reportGet(new Request(`http://127.0.0.1:43147/api/policies/${policyId}`), {
      params: Promise.resolve({ id: policyId })
    })
  );
  assert.equal(crossReport.status, 404, "anonymous User B cannot read User A report");
  const anonReport = await reportGet(new Request(`http://127.0.0.1:43147/api/policies/${policyId}`), {
    params: Promise.resolve({ id: policyId })
  });
  assert.equal(anonReport.status, 404, "unauthenticated callers cannot read reports");

  const ownerOriginal = await runWithActor(actorA, () =>
    originalGet(new Request(`http://127.0.0.1:43147/api/policies/${policyId}/original`), {
      params: Promise.resolve({ id: policyId })
    })
  );
  assert.equal(ownerOriginal.status, 200, "anonymous User A can access own original file");

  const crossOriginal = await runWithActor(actorB, () =>
    originalGet(new Request(`http://127.0.0.1:43147/api/policies/${policyId}/original`), {
      params: Promise.resolve({ id: policyId })
    })
  );
  assert.equal(crossOriginal.status, 404, "anonymous User B cannot access User A file");
  const anonOriginal = await originalGet(new Request(`http://127.0.0.1:43147/api/policies/${policyId}/original`), {
    params: Promise.resolve({ id: policyId })
  });
  assert.equal(anonOriginal.status, 404, "unauthenticated callers cannot access original files");

  const crossDelete = await runWithActor(actorB, () =>
    reportDelete(
      new Request(`http://127.0.0.1:43147/api/policies/${policyId}`, {
        method: "DELETE",
        headers: { origin: "http://127.0.0.1:43147", "sec-fetch-site": "same-origin" }
      }),
      { params: Promise.resolve({ id: policyId }) }
    )
  );
  assert.equal(crossDelete.status, 404, "anonymous User B cannot delete User A data");
  const anonDelete = await reportDelete(
    new Request(`http://127.0.0.1:43147/api/policies/${policyId}`, {
      method: "DELETE",
      headers: { origin: "http://127.0.0.1:43147", "sec-fetch-site": "same-origin" }
    }),
    { params: Promise.resolve({ id: policyId }) }
  );
  assert.equal(anonDelete.status, 404, "unauthenticated callers cannot delete analyses");

  const ownerDelete = await runWithActor(actorA, () =>
    reportDelete(
      new Request(`http://127.0.0.1:43147/api/policies/${policyId}`, {
        method: "DELETE",
        headers: { origin: "http://127.0.0.1:43147", "sec-fetch-site": "same-origin" }
      }),
      { params: Promise.resolve({ id: policyId }) }
    )
  );
  assert.equal(ownerDelete.status, 200, "anonymous User A can delete own analysis");
}

function assertAnonymousAuthSource(): void {
  const startDemo = readFileSync(path.join(process.cwd(), "components/start-demo-button.tsx"), "utf8");
  assert.match(startDemo, /ensureAnonymousBrowserSession/);
  assert.match(startDemo, /createBrowserSupabase/);
  assert.doesNotMatch(startDemo, /SERVICE_ROLE|createAdminClient|serviceRoleKey/);
  const helper = readFileSync(path.join(process.cwd(), "lib/auth/anonymous-start.ts"), "utf8");
  assert.match(helper, /signInAnonymously/);
  assert.match(helper, /getSession/);
  assert.doesNotMatch(helper, /SERVICE_ROLE|createAdminClient|serviceRoleKey/);
  const browser = readFileSync(path.join(process.cwd(), "lib/auth/browser.ts"), "utf8");
  assert.match(browser, /NEXT_PUBLIC_SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(browser, /SERVICE_ROLE/);
  const landing = readFileSync(path.join(process.cwd(), "app/page.tsx"), "utf8");
  assert.match(landing, /demoAnonymousAuthEnabled/);
  assert.match(landing, /Start Policy Analyzer/);
  const signIn = readFileSync(path.join(process.cwd(), "app/sign-in/page.tsx"), "utf8");
  assert.match(signIn, /demoAnonymousAuthEnabled/);
  assert.match(signIn, /SignInForm/);
  assert.match(signIn, /Start Demo/);
  const accountBar = readFileSync(path.join(process.cwd(), "components/account-bar.tsx"), "utf8");
  assert.match(accountBar, /if \(!actor\)/);
  assert.doesNotMatch(accountBar, /actor\?\.email/);
}

async function assertUploadStatusIdentifierContract(): Promise<void> {
  const store = resetMemoryStoreForTests();
  await store.ensureAccount(TEST_ACTOR_A.userId);
  await store.ensureAccount(TEST_ACTOR_B.userId);

  const form = new FormData();
  form.append("files", new File([tinyPdf("status-contract")], "hosted-e2e-complete.pdf", { type: "application/pdf" }));
  const uploadReq = new Request("http://127.0.0.1:43147/api/upload", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:43147", "sec-fetch-site": "same-origin" },
    body: form
  });
  const uploaded = await runWithActor(TEST_ACTOR_A, () => uploadPost(uploadReq));
  assert.equal(uploaded.status, 202, "upload returns 202 queued");
  const queued = (await uploaded.json()) as { policy_id?: string; job_id?: string; status?: string };
  assert.equal(queued.status, "queued");
  assert.ok(queued.policy_id, "upload returns policy_id");
  assert.ok(queued.job_id, "upload returns job_id");
  assert.notEqual(queued.policy_id, queued.job_id);

  const pending = await readStatus(TEST_ACTOR_A, queued.policy_id);
  assert.equal(pending.status, 200, "owner can poll status with the upload policy_id");
  const pendingBody = (await pending.json()) as { status?: string };
  assert.equal(pendingBody.status, "queued");

  const claimed = await store.claimJobs("w-status-contract", 1);
  const job = claimed.find((item) => item.policyId === queued.policy_id);
  assert.ok(job, "claimed job is keyed by the upload policy_id");
  await store.completeJob(job.jobId, "w-status-contract", boundReport(job));

  const done = await readStatus(TEST_ACTOR_A, queued.policy_id);
  assert.equal(done.status, 200, "owner receives HTTP 200 for a completed job");
  const doneBody = (await done.json()) as { status?: string; analysis_id?: string };
  assert.equal(doneBody.status, "completed");
  assert.ok(doneBody.analysis_id);

  const cross = await readStatus(TEST_ACTOR_B, queued.policy_id);
  assert.equal(cross.status, 404, "User B cannot read User A status");
  const anon = await readStatus(null, queued.policy_id);
  assert.equal(anon.status, 404, "unauthenticated callers cannot read status");

  const unknownId = "00000000-0000-4000-8000-000000000000";
  const unknown = await readStatus(TEST_ACTOR_A, unknownId);
  assert.equal(unknown.status, 404, "unknown IDs fail closed");
  const malformed = await readStatus(TEST_ACTOR_A, "not-a-uuid");
  assert.equal(malformed.status, 404, "malformed IDs fail closed");
}

async function assertHostedPostUploadRedirectIsRelative(): Promise<void> {
  const store = resetMemoryStoreForTests();
  await store.ensureAccount(TEST_ACTOR_A.userId);

  const form = new FormData();
  form.append("files", new File([tinyPdf("hosted-redirect")], "hosted-redirect.pdf", { type: "application/pdf" }));
  form.append("redirect", "1");
  const uploadReq = new Request("http://0.0.0.0:43147/api/upload", {
    method: "POST",
    headers: {
      origin: "https://public-analyzer.example",
      "sec-fetch-site": "same-origin",
      host: "public-analyzer.example",
      "x-forwarded-host": "public-analyzer.example",
      "x-forwarded-proto": "https"
    },
    body: form
  });
  const uploaded = await runWithActor(TEST_ACTOR_A, () => uploadPost(uploadReq));
  assert.equal(uploaded.status, 303, "browser upload form returns HTTP 303");
  const location = uploaded.headers.get("location") || "";
  assert.equal(location.startsWith("/analysis/"), true, "Location is a relative application path");
  assert.match(location, /^\/analysis\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.doesNotMatch(location, /0\.0\.0\.0/i);
  assert.doesNotMatch(location, /localhost/i);
  assert.doesNotMatch(location, /127\.0\.0\.1/);
  const policyId = location.slice("/analysis/".length);
  const pending = await readStatus(TEST_ACTOR_A, policyId);
  assert.equal(pending.status, 200, "redirect Location policy_id is the created analysis");
  const claimed = await store.claimJobs("w-hosted-redirect", 20);
  const matching = claimed.filter((item) => item.policyId === policyId);
  assert.equal(matching.length, 1, "successful redirect upload creates the policy exactly once");
}

async function main() {
  process.env.POLICY_ANALYZER_STORE = "memory";
  const store = new MemoryPolicyStore();
  const report = sampleReport();
  await store.savePackage(TEST_ACTOR_A, { files: sampleFiles(report, "sec"), report });

  assert.equal(await store.getReport(null, report.policy_id), null, "5: unauthenticated cannot retrieve");
  assert.equal(await store.getOriginal(null, report.policy_id, report.documents[0].document_id), null);
  assert.equal(await store.deletePackage(null, report.policy_id), "not_found");
  await assert.rejects(
    () => ingestPolicyPackage([{ filename: "x.pdf", bytes: tinyPdf("x") }]),
    (error: unknown) => error instanceof AuthRequiredError,
    "5: unauthenticated cannot upload"
  );

  assert.equal(await store.getReport(TEST_ACTOR_B, report.policy_id), null);
  assert.equal(await store.deletePackage(TEST_ACTOR_B, report.policy_id), "not_found");

  const first = await store.deletePackage(TEST_ACTOR_A, report.policy_id);
  const second = await store.deletePackage(TEST_ACTOR_A, report.policy_id);
  assert.equal(first, "deleted", "13: deletion is authenticated and complete");
  assert.equal(second, "deleted", "13: deletion is idempotent");
  assert.equal(await store.getReport(TEST_ACTOR_A, report.policy_id), null);

  const dirty = sanitizeAuditEvent({
    eventName: "report_viewed",
    filename: "secret-policy.pdf",
    text: "policy language",
    ocr: "ocr text",
    token: "abc",
    signedUrl: "https://example/signed",
    objectId: report.policy_id,
    outcome: "ok"
  });
  assert.equal("filename" in dirty, false, "16: filenames are not in audit events");
  assert.equal("text" in dirty, false);
  assert.equal("ocr" in dirty, false);
  assert.equal("token" in dirty, false);
  assert.equal("signedUrl" in dirty, false);
  assert.equal(auditContainsSensitive(dirty), false);
  await store.recordAudit(TEST_ACTOR_A, {
    eventName: "access_denied",
    filename: "nope.pdf",
    text: "hidden",
    objectId: report.policy_id,
    outcome: "denied"
  } as never);
  const logged = store.listAuditForTests();
  assert.ok(logged.every((event) => !("filename" in event) && !("text" in event)));

  assert.throws(() => store.tryUpdateAudit(), /audit_append_only/, "17: audit is append-only");
  assert.throws(() => store.tryDeleteAudit(), /audit_append_only/);

  const prevFixture = process.env.ENABLE_FIXTURE_ANALYSIS;
  process.env.ENABLE_FIXTURE_ANALYSIS = "false";
  const fixtureStore = new MemoryPolicyStore();
  const fixtureReport = sampleReport();
  await assert.rejects(
    () =>
      fixtureStore.savePackage(TEST_ACTOR_A, {
        files: sampleFiles(fixtureReport, "fixture"),
        report: fixtureReport,
        source: "fixture"
      }),
    "18: fixture analysis is disabled unless explicitly enabled"
  );
  if (prevFixture === undefined) delete process.env.ENABLE_FIXTURE_ANALYSIS;
  else process.env.ENABLE_FIXTURE_ANALYSIS = prevFixture;

  const evil = new Request("http://127.0.0.1:43147/api/upload", {
    method: "POST",
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" }
  });
  assert.equal(assertSameOrigin(evil), false, "19: invalid origin is rejected");
  const ok = new Request("http://127.0.0.1:43147/api/upload", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:43147", "sec-fetch-site": "same-origin" }
  });
  assert.equal(assertSameOrigin(ok), true);

  const clientHits = scanClientFiles();
  assert.deepEqual(clientHits, [], "20: no service-role key or admin client in client components");

  await assertUploadStatusIdentifierContract();
  await assertHostedPostUploadRedirectIsRelative();
  assertDemoAnonymousAuthFlag();
  await assertAnonymousSessionHelper();
  await assertAnonymousUserIsolation();
  assertAnonymousAuthSource();

  console.log("SECURITY OK");
  console.log("LIVE LOCAL RLS: PENDING (no local Supabase runtime verified in this task)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
