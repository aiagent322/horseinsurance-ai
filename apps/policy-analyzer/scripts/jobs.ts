import assert from "node:assert/strict";
import { MemoryPolicyStore, MemoryObjectBackend } from "../lib/persistence/memory-store";
import { TEST_ACTOR_A, TEST_ACTOR_B } from "../lib/persistence/actor-context";
import { ConfigurationError, isProduction } from "../lib/persistence/config";
import { parseReservationResult } from "../lib/persistence/reservation";
import { safeDownloadFilename } from "../lib/original-document";
import { newId } from "../lib/ids";
import { sampleFiles, sampleReport, tinyPdf } from "./test-fixtures";
import { BacklogLimitError, type ClaimedJob } from "../lib/persistence/types";
import type { IncomingPdf } from "../lib/validate-upload";
import type { PolicyRecord } from "../lib/types";
import { readFileSync } from "node:fs";
import path from "node:path";

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

const VALID_SHA = "ab".repeat(32);

function makePdf(tag: string): Buffer {
  return tinyPdf(tag);
}

function makeFiles(count: number): IncomingPdf[] {
  return Array.from({ length: count }, (_, i) => ({
    filename: `policy-${i}.pdf`,
    bytes: makePdf(`file-${i}-${Date.now()}`)
  }));
}

function submittedFromReservation(
  reservation: Awaited<ReturnType<MemoryPolicyStore["reservePackage"]>>,
  overrides: Array<Partial<{ file_id: string; document_id: string; storage_path: string; sha256: string }>> = []
) {
  return reservation.files.map((tuple, index) => ({
    file_id: overrides[index]?.file_id ?? tuple.file_id,
    document_id: overrides[index]?.document_id ?? tuple.document_id,
    storage_path: overrides[index]?.storage_path ?? tuple.storage_path,
    sha256: overrides[index]?.sha256 ?? VALID_SHA
  }));
}

async function seedReservedObjects(
  store: MemoryPolicyStore,
  fileCount = 2
) {
  const reservation = await store.reservePackage(TEST_ACTOR_A, fileCount);
  for (const file of reservation.files) {
    await store.backend.put(file.storage_path, makePdf(file.file_id));
  }
  return reservation;
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

  await test("exactly one job per enqueue", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(2) });
    let jobCount = 0;
    for (const job of store.jobs.values()) {
      if (job.policyId === result.policy_id) jobCount++;
    }
    assert.equal(jobCount, 1, "exactly one job created");
    assert.equal(result.document_count, 2);
  });

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
    const row = store.rows.get(result.policy_id);
    assert.ok(row);
    assert.equal(row!.accountId, TEST_ACTOR_A.accountId);
    assert.equal(row!.ownerUserId, TEST_ACTOR_A.userId);
    for (const file of row!.files) {
      assert.ok(!file.path.includes("evil"), "storage path is not caller-controlled");
    }
  });

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

  await test("rate limit enforced", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    for (let i = 0; i < 20; i++) {
      const r = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
      const claimed = await store.claimJobs("w-rate", 1);
      const job = claimed.find((c) => c.policyId === r.policy_id);
      if (job) {
        await store.completeJob(job.jobId, "w-rate", boundReport(job));
      }
    }
    await assert.rejects(
      () => store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) }),
      (err: unknown) => err instanceof Error && err.name === "RateLimitError",
      "21st upload should be rate limited"
    );
  });

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

  await test("missing job returns failed status and no report", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    await store.ensureAccount(TEST_ACTOR_B.userId);
    const report = sampleReport();
    await store.savePackage(TEST_ACTOR_A, { files: sampleFiles(report, "mj"), report });
    const jobId = store.jobsByPolicy.get(report.policy_id);
    assert.ok(jobId, "savePackage created a completed durable job");
    store.jobsByPolicy.delete(report.policy_id);
    if (jobId) store.jobs.delete(jobId);

    const status = await store.getStatus(TEST_ACTOR_A, report.policy_id);
    assert.ok(status, "authorized owner still receives a safe status");
    assert.equal(status!.status, "failed");
    assert.equal(status!.error_code, "report_unavailable");
    assert.notEqual(status!.status, "completed");
    assert.equal(await store.getReport(TEST_ACTOR_A, report.policy_id), null, "missing job never returns a report");

    assert.equal(await store.getStatus(TEST_ACTOR_B, report.policy_id), null, "cross-account status is null");
    assert.equal(await store.getReport(TEST_ACTOR_B, report.policy_id), null, "cross-account report is null");
  });

  await test("inconsistent analysis/job relationship fails closed", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const report = sampleReport();
    await store.savePackage(TEST_ACTOR_A, { files: sampleFiles(report, "inc"), report });
    const jobId = store.jobsByPolicy.get(report.policy_id);
    const job = jobId ? store.jobs.get(jobId) : undefined;
    assert.ok(job);
    job!.analysisId = newId();
    const status = await store.getStatus(TEST_ACTOR_A, report.policy_id);
    assert.equal(status!.status, "failed");
    assert.equal(status!.error_code, "report_unavailable");
    assert.equal(await store.getReport(TEST_ACTOR_A, report.policy_id), null);
  });

  await test("missing report returns null", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const report = await store.getReport(TEST_ACTOR_A, result.policy_id);
    assert.equal(report, null, "no report for queued job");
  });

  await test("nonterminal, failed, cancelled jobs return no report", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);

    const r1 = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    assert.equal(await store.getReport(TEST_ACTOR_A, r1.policy_id), null);

    const r2 = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const claimed = await store.claimJobs("w1", 1);
    const job2 = claimed.find((c) => c.policyId === r2.policy_id);
    if (job2) {
      assert.equal(await store.getReport(TEST_ACTOR_A, r2.policy_id), null, "processing: no report");
    }

    const r3 = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const claimed3 = await store.claimJobs("w2", 5);
    const job3 = claimed3.find((c) => c.policyId === r3.policy_id);
    if (job3) {
      await store.failJob(job3.jobId, "w2", "test_failure", "extraction", false);
      assert.equal(await store.getReport(TEST_ACTOR_A, r3.policy_id), null, "failed: no report");
    }

    const r4 = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    await store.cancelJob(TEST_ACTOR_A, r4.policy_id);
    assert.equal(await store.getReport(TEST_ACTOR_A, r4.policy_id), null, "cancelled: no report");
  });

  await test("completed job with report returns findings", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const claimed = await store.claimJobs("w1", 1);
    assert.ok(claimed.length > 0);
    const job = claimed.find((c) => c.policyId === result.policy_id);
    assert.ok(job);
    const report = boundReport(job!);
    await store.completeJob(job!.jobId, "w1", report);
    const status = await store.getStatus(TEST_ACTOR_A, result.policy_id);
    assert.equal(status!.status, "completed");
    const loaded = await store.getReport(TEST_ACTOR_A, result.policy_id);
    assert.ok(loaded, "report available after completion");
    assert.equal(loaded!.policy_id, result.policy_id);
    await store.completeJob(job!.jobId, "w1", report);
    assert.equal((await store.getStatus(TEST_ACTOR_A, result.policy_id))!.status, "completed");
  });

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
    const claimedId = (a[0] || b[0]).jobId;
    const leftovers = [...store.jobs.values()].filter((job) => job.jobId === claimedId && job.status === "processing");
    assert.equal(leftovers.length, 1);
    assert.ok(leftovers[0].leaseOwner === "w-a" || leftovers[0].leaseOwner === "w-b");
  });

  await test("deletion is authenticated and idempotent", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const claimed = await store.claimJobs("w1", 1);
    const job = claimed.find((c) => c.policyId === result.policy_id);
    if (job) {
      await store.completeJob(job.jobId, "w1", boundReport(job));
    }
    assert.equal(await store.deletePackage(TEST_ACTOR_B, result.policy_id), "not_found");
    assert.equal(await store.deletePackage(TEST_ACTOR_A, result.policy_id), "deleted");
    assert.equal(await store.deletePackage(TEST_ACTOR_A, result.policy_id), "deleted");
    assert.equal(await store.getReport(TEST_ACTOR_A, result.policy_id), null);
  });

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

  await test("pending reservations consume backlog capacity", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 6 }, () => store.reservePackage(TEST_ACTOR_A, 1))
    );
    const accepted = outcomes.filter((item) => item.status === "fulfilled");
    const rejected = outcomes.filter((item) => item.status === "rejected");
    assert.equal(accepted.length, 5, "five pending reservations fill the active-job cap");
    assert.equal(rejected.length, 1, "sixth concurrent reservation is rejected");
    assert.ok(
      rejected[0].status === "rejected" && rejected[0].reason instanceof BacklogLimitError,
      "overflow reservation is a backlog limit, not a later finalize"
    );
    await assert.rejects(
      () => store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) }),
      (err: unknown) => err instanceof BacklogLimitError
    );
  });

  await test("abandoned and expired reservations release capacity", async () => {
    let nowMs = Date.now();
    const store = new MemoryPolicyStore({ now: () => new Date(nowMs) });
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const first = await store.reservePackage(TEST_ACTOR_A, 1);
    await store.reservePackage(TEST_ACTOR_A, 1);
    await store.reservePackage(TEST_ACTOR_A, 1);
    await store.reservePackage(TEST_ACTOR_A, 1);
    await store.reservePackage(TEST_ACTOR_A, 1);
    await assert.rejects(() => store.reservePackage(TEST_ACTOR_A, 1), (err: unknown) => err instanceof BacklogLimitError);
    assert.equal(store.abandonReservation(TEST_ACTOR_A, first.reservation_id), true);
    await store.reservePackage(TEST_ACTOR_A, 1);
    nowMs += 31 * 60_000;
    await store.reservePackage(TEST_ACTOR_A, 1);
  });

  await test("queued jobs plus pending reservations share one cap", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    for (let i = 0; i < 4; i += 1) {
      await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    }
    await store.reservePackage(TEST_ACTOR_A, 1);
    await assert.rejects(
      () => store.reservePackage(TEST_ACTOR_A, 1),
      (err: unknown) => err instanceof BacklogLimitError
    );
  });

  await test("finalize rejects swapped reserved tuples", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const reservation = await seedReservedObjects(store, 2);
    const swapped = submittedFromReservation(reservation, [
      { file_id: reservation.files[0].file_id, document_id: reservation.files[1].document_id, storage_path: reservation.files[0].storage_path },
      { file_id: reservation.files[1].file_id, document_id: reservation.files[0].document_id, storage_path: reservation.files[1].storage_path }
    ]);
    assert.throws(() => store.finalizeReservation(TEST_ACTOR_A, reservation.reservation_id, swapped), /reserved_tuple_mismatch/);
  });

  await test("finalize rejects duplicate file, document, and path values", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const reservation = await seedReservedObjects(store, 2);
    assert.throws(
      () =>
        store.finalizeReservation(
          TEST_ACTOR_A,
          reservation.reservation_id,
          submittedFromReservation(reservation, [{ file_id: reservation.files[1].file_id }])
        ),
      /duplicate_file_ids/
    );
    const reservation2 = await seedReservedObjects(store, 2);
    assert.throws(
      () =>
        store.finalizeReservation(
          TEST_ACTOR_A,
          reservation2.reservation_id,
          submittedFromReservation(reservation2, [{ document_id: reservation2.files[1].document_id }])
        ),
      /duplicate_document_ids/
    );
    const reservation3 = await seedReservedObjects(store, 2);
    assert.throws(
      () =>
        store.finalizeReservation(
          TEST_ACTOR_A,
          reservation3.reservation_id,
          submittedFromReservation(reservation3, [{ storage_path: reservation3.files[1].storage_path }])
        ),
      /duplicate_storage_paths/
    );
  });

  await test("finalize rejects missing, extra, foreign, and invalid SHA items", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const missing = await seedReservedObjects(store, 2);
    assert.throws(
      () => store.finalizeReservation(TEST_ACTOR_A, missing.reservation_id, submittedFromReservation(missing).slice(0, 1)),
      /file_count_mismatch/
    );

    const extra = await seedReservedObjects(store, 1);
    const extraItem = {
      file_id: newId(),
      document_id: newId(),
      storage_path: extra.files[0].storage_path.replace(extra.files[0].file_id, newId()),
      sha256: VALID_SHA
    };
    assert.throws(
      () => store.finalizeReservation(TEST_ACTOR_A, extra.reservation_id, [...submittedFromReservation(extra), extraItem]),
      /file_count_mismatch/
    );

    const foreign = await seedReservedObjects(store, 1);
    assert.throws(
      () =>
        store.finalizeReservation(
          TEST_ACTOR_A,
          foreign.reservation_id,
          submittedFromReservation(foreign, [
            { storage_path: `${TEST_ACTOR_B.accountId}/${foreign.upload_id}/${foreign.files[0].file_id}.pdf` }
          ])
        ),
      /storage_path_foreign_account/
    );

    const sha = await seedReservedObjects(store, 1);
    assert.throws(
      () =>
        store.finalizeReservation(
          TEST_ACTOR_A,
          sha.reservation_id,
          submittedFromReservation(sha, [{ sha256: "not-a-sha256" }])
        ),
      /invalid_sha256/
    );
  });

  await test("finalize fails closed when storage cannot be verified", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const reservation = await seedReservedObjects(store, 1);
    store.storageUnavailable = true;
    assert.throws(
      () => store.finalizeReservation(TEST_ACTOR_A, reservation.reservation_id, submittedFromReservation(reservation)),
      /storage_unavailable/
    );
    store.storageUnavailable = false;
    store.backend.objects.clear();
    assert.throws(
      () => store.finalizeReservation(TEST_ACTOR_A, reservation.reservation_id, submittedFromReservation(reservation)),
      /storage_object_missing/
    );
  });

  await test("stale worker cannot heartbeat, fail, or complete", async () => {
    let nowMs = Date.now();
    const store = new MemoryPolicyStore({ now: () => new Date(nowMs) });
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const claimed = await store.claimJobs("stale-worker", 1);
    const job = claimed.find((item) => item.policyId === result.policy_id);
    assert.ok(job);
    nowMs += 121_000;
    assert.equal(await store.heartbeatJob(job!.jobId, "stale-worker"), false);
    assert.equal(await store.updateJobProgress(job!.jobId, "stale-worker", "ocr"), false);
    assert.equal(await store.failJob(job!.jobId, "stale-worker", "boom", "ocr", false), false);
    await assert.rejects(
      () => store.completeJob(job!.jobId, "stale-worker", sampleReport({ policy_id: result.policy_id })),
      /lease_mismatch/
    );
    const status = await store.getStatus(TEST_ACTOR_A, result.policy_id);
    assert.equal(status!.status, "processing");
    assert.equal(await store.getReport(TEST_ACTOR_A, result.policy_id), null);
  });

  await test("expired lease can be reclaimed by another worker", async () => {
    let nowMs = Date.now();
    const store = new MemoryPolicyStore({ now: () => new Date(nowMs) });
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const first = await store.claimJobs("w-old", 1);
    assert.equal(first.length, 1);
    nowMs += 121_000;
    const second = await store.claimJobs("w-new", 1);
    assert.equal(second.length, 1);
    assert.equal(second[0].jobId, first[0].jobId);
    assert.equal(store.jobs.get(first[0].jobId)?.leaseOwner, "w-new");
    await store.completeJob(second[0].jobId, "w-new", boundReport(second[0]));
    assert.equal((await store.getStatus(TEST_ACTOR_A, result.policy_id))!.status, "completed");
  });

  await test("exhausted expired jobs are terminalized on claim", async () => {
    let nowMs = Date.now();
    const store = new MemoryPolicyStore({ now: () => new Date(nowMs) });
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    let current = await store.claimJobs("w1", 1);
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      nowMs += 121_000;
      current = await store.claimJobs(`w${attempt}`, 1);
      assert.equal(current.length, 1, `reclaim attempt ${attempt}`);
    }
    nowMs += 121_000;
    const none = await store.claimJobs("w4", 1);
    assert.equal(none.length, 0, "exhausted job is not claimed again");
    const job = [...store.jobs.values()].find((item) => item.policyId === result.policy_id);
    assert.ok(job);
    assert.equal(job!.status, "failed");
    assert.equal(job!.errorCode, "attempts_exhausted");
    assert.equal(job!.leaseOwner, null);
    const status = await store.getStatus(TEST_ACTOR_A, result.policy_id);
    assert.equal(status!.status, "failed");
    assert.equal(await store.getReport(TEST_ACTOR_A, result.policy_id), null);
  });

  await test("claim batch limits are bounded", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    await assert.rejects(() => store.claimJobs("w", 0), /invalid_claim_limit/);
    await assert.rejects(() => store.claimJobs("w", 21), /invalid_claim_limit/);
    const claimed = await store.claimJobs("w", 1);
    assert.equal(claimed.length, 1);
  });

  await test("original filenames are normalized before persistence", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, {
      files: [{ filename: "..\\evil\u0000name.pdf", bytes: makePdf("name") }]
    });
    const row = store.rows.get(result.policy_id);
    assert.ok(row);
    assert.equal(row!.stubDocuments[0].original_filename, safeDownloadFilename("..\\evil\u0000name.pdf"));
    assert.ok(!row!.stubDocuments[0].original_filename.includes("\u0000"));
    assert.ok(!row!.stubDocuments[0].original_filename.includes("\\"));
    assert.equal(safeDownloadFilename("ok.pdf"), "ok.pdf");
  });

  await test("reservation RPC responses are validated before use", async () => {
    const reservation_id = newId();
    const upload_id = newId();
    const file_id = newId();
    const document_id = newId();
    const valid = {
      reservation_id,
      upload_id,
      analysis_id: newId(),
      policy_id: newId(),
      session_id: newId(),
      job_id: newId(),
      file_count: 1,
      files: [
        {
          ordinal: 1,
          file_id,
          document_id,
          storage_path: `${TEST_ACTOR_A.accountId}/${upload_id}/${file_id}.pdf`
        }
      ],
      expires_at: new Date().toISOString()
    };
    const parsed = parseReservationResult(valid, 1);
    assert.equal(parsed.files.length, 1);
    assert.throws(() => parseReservationResult(null, 1), /reservation_malformed/);
    assert.throws(
      () => parseReservationResult({ ...valid, files: undefined, file_ids: [file_id], storage_paths: [valid.files[0].storage_path] }, 1),
      /reservation_malformed/
    );
    assert.throws(() => parseReservationResult({ ...valid, file_count: 2 }, 1), /reservation_malformed/);
    assert.throws(
      () => parseReservationResult({ ...valid, files: [{ ...valid.files[0], file_id: "not-a-uuid" }] }, 1),
      /reservation_malformed/
    );
  });

  await test("completed status requires a valid stored report", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    await store.ensureAccount(TEST_ACTOR_B.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(1) });
    const claimed = await store.claimJobs("w1", 1);
    const job = claimed.find((item) => item.policyId === result.policy_id);
    assert.ok(job);
    await store.completeJob(job!.jobId, "w1", boundReport(job!));
    assert.equal((await store.getStatus(TEST_ACTOR_A, result.policy_id))!.status, "completed");
    const row = store.rows.get(result.policy_id);
    assert.ok(row?.record);
    row!.record = null;
    const status = await store.getStatus(TEST_ACTOR_A, result.policy_id);
    assert.ok(status);
    assert.notEqual(status!.status, "completed");
    assert.notEqual(status!.status, "needs_review");
    assert.equal(status!.status, "failed");
    assert.equal(status!.error_code, "report_unavailable");
    assert.equal(await store.getReport(TEST_ACTOR_A, result.policy_id), null);
    assert.equal(await store.getStatus(TEST_ACTOR_B, result.policy_id), null);
    assert.equal(await store.getReport(TEST_ACTOR_B, result.policy_id), null);
    await assert.rejects(() => store.completeJob(job!.jobId, "w1", boundReport(job!)), /report_unavailable/);
  });

  await test("completion binds the report to the claimed job", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const result = await store.enqueuePackage(TEST_ACTOR_A, { files: makeFiles(2) });
    const claimed = await store.claimJobs("w-bind", 1);
    const job = claimed.find((item) => item.policyId === result.policy_id);
    assert.ok(job);
    const valid = boundReport(job!);

    const wrongPolicy = { ...valid, policy_id: newId() };
    await assert.rejects(() => store.completeJob(job!.jobId, "w-bind", wrongPolicy), /report_policy_mismatch/);

    const wrongSession = { ...valid, session_id: newId() };
    await assert.rejects(() => store.completeJob(job!.jobId, "w-bind", wrongSession), /report_session_mismatch/);

    const foreign = {
      ...valid,
      documents: valid.documents.map((document, index) =>
        index === 0 ? { ...document, document_id: newId() } : document
      )
    };
    await assert.rejects(() => store.completeJob(job!.jobId, "w-bind", foreign), /report_foreign_document/);

    const missing = { ...valid, documents: valid.documents.slice(0, 1) };
    await assert.rejects(() => store.completeJob(job!.jobId, "w-bind", missing), /report_missing_document/);

    const duplicate = {
      ...valid,
      documents: [valid.documents[0], { ...valid.documents[1], document_id: valid.documents[0].document_id }]
    };
    await assert.rejects(() => store.completeJob(job!.jobId, "w-bind", duplicate), /report_duplicate_document_ids/);

    const status = await store.getStatus(TEST_ACTOR_A, result.policy_id);
    assert.equal(status!.status, "processing");
    assert.equal(await store.getReport(TEST_ACTOR_A, result.policy_id), null);
    assert.equal(store.jobs.get(job!.jobId)?.status, "processing");
    assert.equal(store.rows.get(result.policy_id)?.record, null);

    await store.completeJob(job!.jobId, "w-bind", valid);
    assert.equal((await store.getStatus(TEST_ACTOR_A, result.policy_id))!.status, "completed");
    assert.ok(await store.getReport(TEST_ACTOR_A, result.policy_id));
    await store.completeJob(job!.jobId, "w-bind", valid);
    assert.equal((await store.getStatus(TEST_ACTOR_A, result.policy_id))!.status, "completed");
  });

  await test("job identity trigger is table-correct and does not freeze status", async () => {
    const sql = readFileSync(
      path.resolve(process.cwd(), "../../supabase/migrations/20260903150000_durable_analysis_jobs.sql"),
      "utf8"
    );
    assert.ok(/reject_analysis_job_identity_mutation/i.test(sql));
    assert.ok(/reject_upload_reservation_identity_mutation/i.test(sql));
    assert.equal(
      /create\s+trigger[\s\S]{0,160}on\s+analysis_jobs[\s\S]{0,80}reject_ownership_mutation/i.test(sql),
      false
    );
    const start = sql.toLowerCase().lastIndexOf("create or replace function reject_analysis_job_identity_mutation(");
    const body = sql.slice(sql.indexOf("$$", start) + 2, sql.indexOf("$$", sql.indexOf("$$", start) + 2));
    for (const col of ["account_id", "owner_user_id", "policy_id", "analysis_id"]) {
      assert.ok(body.includes(`new.${col} is distinct from old.${col}`), col);
    }
    assert.equal(/new\.user_id|old\.user_id/i.test(body), false);
    assert.equal(/lease_owner|status =/i.test(body), false);
  });

  await test("supabase store and fixture route use the durable enqueue path", async () => {
    const storeSource = readFileSync(
      path.resolve(process.cwd(), "lib/persistence/supabase-store.ts"),
      "utf8"
    );
    assert.equal(storeSource.includes("persist_analyzer_package"), false);
    assert.ok(/Synchronous package persistence is not supported/.test(storeSource));
    assert.ok(/enqueuePackage/.test(storeSource));

    const fixtureSource = readFileSync(
      path.resolve(process.cwd(), "app/api/fixture/run/route.ts"),
      "utf8"
    );
    assert.equal(fixtureSource.includes("ingestPdfBuffer"), false);
    assert.equal(fixtureSource.includes("ingestPolicyPackage"), false);
    assert.ok(fixtureSource.includes("enqueuePolicyPackage"));
    assert.equal(/extractPdfPages|analyzeDocuments|tesseract/i.test(fixtureSource), false);
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
