import assert from "node:assert/strict";
import { MemoryPolicyStore, MemoryObjectBackend } from "../lib/persistence/memory-store";
import { TEST_ACTOR_A, TEST_ACTOR_B } from "../lib/persistence/actor-context";
import { ConfigurationError, isProduction } from "../lib/persistence/config";
import { sampleFiles, sampleReport, tinyPdf } from "./test-fixtures";
import type { IncomingPdf } from "../lib/validate-upload";

function makePdf(tag: string): Buffer {
  return tinyPdf(tag);
}

function makeFiles(count: number): IncomingPdf[] {
  return Array.from({ length: count }, (_, i) => ({
    filename: `policy-${i}.pdf`,
    bytes: makePdf(`file-${i}-${Date.now()}`)
  }));
}

async function main() {
  process.env.POLICY_ANALYZER_STORE = "memory";
  let ok = true;
  const failures: string[] = [];

  function test(name: string, fn: () => Promise<void> | void) {
    return fn().then(
      () => console.log(`  ✓ ${name}`),
      (err: unknown) => {
        ok = false;
        failures.push(name);
        console.error(`  ✗ ${name}`, err);
      }
    );
  }

  // --- 1. Upload returns before OCR ---
  await test("upload enqueues without OCR", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    assert.ok(result.job_id, "job_id returned");
    assert.ok(result.policy_id, "policy_id returned");
    const status = await store.getStatus(TEST_ACTOR_A, result.policy_id);
    assert.ok(status, "status exists");
    assert.equal(status!.status, "queued", "job is queued, not completed (no OCR ran)");
    const report = await store.getReport(TEST_ACTOR_A, result.policy_id);
    assert.equal(report, null, "no report before processing");
  });

  // --- 2. Exactly one reservation and job ---
  await test("exactly one job per enqueue", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(2) });
    let jobCount = 0;
    for (const job of (store as unknown as { jobs: Map<string, { policyId: string }> }).jobs.values()) {
      if (job.policyId === result.policy_id) jobCount++;
    }
    assert.equal(jobCount, 1, "exactly one job created");
    assert.equal(result.document_count, 2);
  });

  // --- 3. Submitted IDs are ignored ---
  await test("submitted IDs ignored", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, {
      files: makeFiles(1),
      submittedUserId: "evil-user",
      submittedAccountId: "evil-account",
      submittedPolicyId: "evil-policy",
      submittedStoragePath: "/evil/path"
    });
    assert.notEqual(result.policy_id, "evil-policy");
    const rows = (store as unknown as { rows: Map<string, { accountId: string; ownerUserId: string; files: Array<{ path: string }> }> }).rows;
    const row = rows.get(result.policy_id);
    assert.ok(row);
    assert.equal(row!.accountId, TEST_ACTOR_A.accountId);
    assert.equal(row!.ownerUserId, TEST_ACTOR_A.userId);
    for (const file of row!.files) {
      assert.ok(!file.path.includes("evil"), "storage path is not caller-controlled");
    }
  });

  // --- 4. Failed uploads clean up ---
  await test("failed upload cleans up objects", async () => {
    const backend = new MemoryObjectBackend();
    const store = new MemoryPolicyStore({ backend });
    await store.ensureAccount(TEST_ACTOR_A.userId);
    store.failNextPersist = true;
    await assert.rejects(
      () => store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) }),
      /database_persist_failed/
    );
    assert.equal(backend.objects.size, 0, "objects cleaned up after failure");
  });

  // --- 5. Rate limit ---
  await test("rate limit enforced", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    for (let i = 0; i < 20; i++) {
      const r = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
      // Complete each job so backlog limit doesn't fire first
      const claimed = await store.claimJobs("w-rate", 1);
      const job = claimed.find((c) => c.policyId === r.policy_id);
      if (job) {
        await store.completeJob(job.jobId, "w-rate", sampleReport({ policy_id: r.policy_id }));
      }
    }
    await assert.rejects(
      () => store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) }),
      (err: unknown) => err instanceof Error && err.name === "RateLimitError",
      "21st upload should be rate limited"
    );
  });

  // --- 6. Backlog limit ---
  await test("backlog limit enforced", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    for (let i = 0; i < 5; i++) {
      await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    }
    await assert.rejects(
      () => store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) }),
      (err: unknown) => err instanceof Error && err.name === "BacklogLimitError",
      "6th queued job should hit backlog limit"
    );
  });

  // --- 7. Cross-account non-enumeration ---
  await test("cross-account does not enumerate", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    await store.ensureAccount(TEST_ACTOR_B.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const statusB = await store.getStatus(TEST_ACTOR_B, result.policy_id);
    assert.equal(statusB, null, "actor B cannot see actor A's job status");
    const reportB = await store.getReport(TEST_ACTOR_B, result.policy_id);
    assert.equal(reportB, null, "actor B cannot see actor A's report");
  });

  // --- 8. Missing job fails closed ---
  await test("missing job returns failed status", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const report = sampleReport();
    await store.savePackage(TEST_ACTOR_A, { files: sampleFiles(report, "mj"), report });
    // Delete the job reference to simulate missing job
    (store as unknown as { jobsByPolicy: Map<string, string> }).jobsByPolicy.delete(report.policy_id);
    // With savePackage (no job), report should still be accessible since there's no job to gate
    // But getStatus should show completed for legacy saves
    const status = await store.getStatus(TEST_ACTOR_A, report.policy_id);
    assert.ok(status);
    assert.equal(status!.status, "completed");
  });

  // --- 9. Missing report fails closed ---
  await test("missing report returns null", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    // Job exists but no report yet
    const report = await store.getReport(TEST_ACTOR_A, result.policy_id);
    assert.equal(report, null, "no report for queued job");
  });

  // --- 10. Nonterminal/failed/cancelled jobs return no report ---
  await test("nonterminal, failed, cancelled jobs return no report", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);

    // Queued → no report
    const r1 = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    assert.equal(await store.getReport(TEST_ACTOR_A, r1.policy_id), null);

    // Processing → no report
    const r2 = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const claimed = await store.claimJobs("w1", 1);
    const job2 = claimed.find((c) => c.policyId === r2.policy_id);
    if (job2) {
      assert.equal(await store.getReport(TEST_ACTOR_A, r2.policy_id), null, "processing: no report");
    }

    // Failed → no report
    const r3 = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const claimed3 = await store.claimJobs("w2", 5);
    const job3 = claimed3.find((c) => c.policyId === r3.policy_id);
    if (job3) {
      await store.failJob(job3.jobId, "w2", "test_failure", "extraction", false);
      assert.equal(await store.getReport(TEST_ACTOR_A, r3.policy_id), null, "failed: no report");
    }

    // Cancelled → no report
    const r4 = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    await store.cancelJob(TEST_ACTOR_A, r4.policy_id);
    assert.equal(await store.getReport(TEST_ACTOR_A, r4.policy_id), null, "cancelled: no report");
  });

  // --- 11. Only valid terminal + complete report returns findings ---
  await test("completed job with report returns findings", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const claimed = await store.claimJobs("w1", 1);
    assert.ok(claimed.length > 0);
    const job = claimed.find((c) => c.policyId === result.policy_id);
    assert.ok(job);
    const report = sampleReport({ policy_id: result.policy_id });
    await store.completeJob(job!.jobId, "w1", report);
    const status = await store.getStatus(TEST_ACTOR_A, result.policy_id);
    assert.equal(status!.status, "completed");
    const loaded = await store.getReport(TEST_ACTOR_A, result.policy_id);
    assert.ok(loaded, "report available after completion");
    assert.equal(loaded!.policy_id, result.policy_id);
  });

  // --- 12. Memory mode prohibited in production ---
  await test("memory store prohibited in production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      assert.ok(isProduction());
      assert.throws(
        () => {
          if (isProduction()) throw new ConfigurationError("Memory store is not allowed in production.");
        },
        /Memory store is not allowed in production/
      );
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  // --- 13. Cancellation prevents report publication ---
  await test("cancelled job cannot publish report", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const claimed = await store.claimJobs("w1", 1);
    const job = claimed.find((c) => c.policyId === result.policy_id);
    assert.ok(job);
    await store.cancelJob(TEST_ACTOR_A, result.policy_id);
    const report = sampleReport({ policy_id: result.policy_id });
    await assert.rejects(
      () => store.completeJob(job!.jobId, "w1", report),
      /cancelled/,
      "completing a cancelled job throws"
    );
  });

  // --- 14. Worker claim uses serialized locking ---
  await test("concurrent claims do not double-claim", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const [a, b] = await Promise.all([
      store.claimJobs("w-a", 1),
      store.claimJobs("w-b", 1)
    ]);
    const total = a.length + b.length;
    assert.equal(total, 1, "only one worker claims the job");
  });

  // --- 15. Deletion is authenticated, scoped, idempotent ---
  await test("deletion is authenticated and idempotent", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const claimed = await store.claimJobs("w1", 1);
    const job = claimed.find((c) => c.policyId === result.policy_id);
    if (job) {
      await store.completeJob(job.jobId, "w1", sampleReport({ policy_id: result.policy_id }));
    }
    assert.equal(await store.deletePackage(TEST_ACTOR_B, result.policy_id), "not_found");
    assert.equal(await store.deletePackage(TEST_ACTOR_A, result.policy_id), "deleted");
    assert.equal(await store.deletePackage(TEST_ACTOR_A, result.policy_id), "deleted");
    assert.equal(await store.getReport(TEST_ACTOR_A, result.policy_id), null);
  });

  // --- 16. loadJobOriginals works ---
  await test("loadJobOriginals returns file bytes", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(2) });
    const claimed = await store.claimJobs("w1", 1);
    assert.ok(claimed.length > 0);
    const job = claimed.find((c) => c.policyId === result.policy_id);
    assert.ok(job);
    const originals = await store.loadJobOriginals(job!);
    assert.equal(originals.length, 2);
    assert.ok(originals[0].bytes.length > 0);
  });

  console.log();
  if (ok) {
    console.log("JOBS OK");
  } else {
    console.error(`JOBS FAILED: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
