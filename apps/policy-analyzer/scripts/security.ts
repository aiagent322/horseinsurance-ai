import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { AuthRequiredError } from "../lib/persistence/config";
import { ingestPolicyPackage } from "../lib/ingest";
import { auditContainsSensitive, sanitizeAuditEvent } from "../lib/persistence/audit";
import { MemoryPolicyStore } from "../lib/persistence/memory-store";
import { assertSameOrigin } from "../lib/persistence/same-origin";
import { TEST_ACTOR_A, TEST_ACTOR_B } from "../lib/persistence/actor-context";
import { sampleFiles, sampleReport, tinyPdf } from "./test-fixtures";

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

  console.log("SECURITY OK");
  console.log("LIVE LOCAL RLS: PENDING (no local Supabase runtime verified in this task)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
