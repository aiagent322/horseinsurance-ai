import assert from "node:assert/strict";
import { POST as uploadPost } from "../app/api/upload/route";
import { buildCompletePolicyPages, buildCompletePolicyPdf, buildPartialPolicyPdf } from "../lib/build-complete-pdf";
import { buildFixturePdf } from "../lib/build-fixture";
import { buildScannedPdf, SCANNED_PDF_PHRASE } from "../lib/build-scanned-fixture";
import { extractPdfInvocations, resetExtractPdfInvocations, type ExtractedPdf } from "../lib/extract-pdf";
import { TEST_ACTOR_A, TEST_ACTOR_B, runWithActor } from "../lib/persistence/actor-context";
import { loadWorkerConfig, type WorkerConfig } from "../lib/worker/config";
import { ConfigurationError } from "../lib/persistence/config";
import { createWorkerPersistence, resetMemoryStoreForTests } from "../lib/persistence/factory";
import { MemoryPolicyStore } from "../lib/persistence/memory-store";
import { parseClaimedJob } from "../lib/persistence/claim";
import { ocrRecognizeCalls, resetOcrTestHooks, shutdownOcr } from "../lib/ocr";
import { AnalysisWorker, runWorkerOnce } from "../lib/worker/runtime";
import { processClaimedJob } from "../lib/worker/process-job";
import { decideTerminalState } from "../lib/worker/outcome";
import { operationalLog } from "../lib/worker/log";
import type { IncomingPdf } from "../lib/validate-upload";
import { sampleReport } from "./test-fixtures";

process.env.POLICY_ANALYZER_STORE = "memory";

function cfg(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    workerId: "w-test",
    concurrency: 1,
    claimLimit: 1,
    pollMs: 40,
    backoffMaxMs: 200,
    shutdownMs: 250,
    heartbeatMs: 40,
    leaseMs: 5_000,
    ...overrides
  };
}

function capturedLogs(fn: () => Promise<void> | void): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" "));
  };
  return Promise.resolve(fn()).then(
    () => {
      console.log = original;
      return lines;
    },
    (err) => {
      console.log = original;
      throw err;
    }
  );
}

const FORBIDDEN_LOG = /policy number|equine medical|named insured|storage\/v1|signedurl|service_role|eyj[a-z0-9_-]{20,}|\/[0-9a-f-]{36}\//i;

async function enqueue(store: MemoryPolicyStore, files: IncomingPdf[], actor = TEST_ACTOR_A) {
  await store.ensureAccount(actor.userId);
  return store.enqueuePackage(actor, { files });
}

async function main() {
  let ok = true;
  const failures: string[] = [];
  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      ok = false;
      failures.push(name);
      console.error(`  ✗ ${name}`, err);
    }
  }

  await test("upload returns 202 without extraction", async () => {
    resetMemoryStoreForTests();
    resetExtractPdfInvocations();
    resetOcrTestHooks();
    const pdf = await buildCompletePolicyPdf();
    const form = new FormData();
    form.append("file", new File([pdf], "policy.pdf", { type: "application/pdf" }));
    const req = new Request("http://127.0.0.1:43147/api/upload", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:43147", "sec-fetch-site": "same-origin" },
      body: form
    });
    const res = await runWithActor(TEST_ACTOR_A, () => uploadPost(req));
    assert.equal(res.status, 202);
    const body = (await res.json()) as { status?: string; job_id?: string };
    assert.equal(body.status, "queued");
    assert.ok(body.job_id);
    assert.equal(extractPdfInvocations, 0);
    assert.equal(ocrRecognizeCalls, 0);
  });

  await test("worker:once converts a native-text fixture into a bound report", async () => {
    const store = resetMemoryStoreForTests();
    const pdf = await buildFixturePdf();
    const queued = await enqueue(store, [{ filename: "fixture.pdf", bytes: pdf }]);
    const worker = new AnalysisWorker({ store, config: cfg({ workerId: "w-native" }) });
    const once = await worker.runOnce();
    assert.equal(once.claimed, 1);
    const status = await store.getStatus(TEST_ACTOR_A, queued.policy_id);
    assert.ok(status);
    assert.ok(status.status === "completed" || status.status === "needs_review");
    const report = await store.getReport(TEST_ACTOR_A, queued.policy_id);
    assert.ok(report);
    assert.equal(report.policy_id, queued.policy_id);
    assert.equal(report.session_id, queued.session_id);
    assert.equal(report.documents.length, 1);
    assert.equal(report.documents[0].document_id, store.rows.get(queued.policy_id)?.files[0].documentId);
  });

  await test("scanned fixture uses real OCR and produces a bound sourced report", async () => {
    const store = resetMemoryStoreForTests();
    resetOcrTestHooks();
    const pdf = await buildScannedPdf();
    const queued = await enqueue(store, [{ filename: "scan.pdf", bytes: pdf }]);
    const before = ocrRecognizeCalls;
    const worker = new AnalysisWorker({ store, config: cfg({ workerId: "w-ocr" }) });
    await worker.runOnce();
    assert.ok(ocrRecognizeCalls > before, "real OCR ran");
    const report = await store.getReport(TEST_ACTOR_A, queued.policy_id);
    assert.ok(report);
    const hay = report.documents.flatMap((d) => d.pages.map((p) => p.text)).join(" ");
    assert.match(hay, new RegExp(SCANNED_PDF_PHRASE, "i"));
    assert.ok(report.documents.some((d) => d.pages.some((p) => p.extraction_method === "OCR")));
  });

  await test("multiple documents preserve claimed IDs, ordering, and citations", async () => {
    const store = resetMemoryStoreForTests();
    const pages = await buildCompletePolicyPages();
    const files = pages.map((bytes, i) => ({ filename: `part-${i}.pdf`, bytes }));
    const queued = await enqueue(store, files);
    const worker = new AnalysisWorker({ store, config: cfg({ workerId: "w-multi" }) });
    await worker.runOnce();
    const report = await store.getReport(TEST_ACTOR_A, queued.policy_id);
    assert.ok(report);
    const claimedIds = store.rows.get(queued.policy_id)!.files.map((f) => f.documentId);
    assert.deepEqual(report.documents.map((d) => d.document_id), claimedIds);
    assert.equal(report.session_id, queued.session_id);
    assert.equal(report.policy_id, queued.policy_id);
    const sourced = [
      ...report.coverages.map((c) => c.source_document_id),
      ...report.exclusions.map((e) => e.source_document_id)
    ].filter(Boolean);
    for (const id of sourced) assert.ok(claimedIds.includes(id));
  });

  await test("two workers never process or publish the same job", async () => {
    const store = resetMemoryStoreForTests();
    const pdf = await buildCompletePolicyPdf();
    await enqueue(store, [{ filename: "one.pdf", bytes: pdf }]);
    const a = new AnalysisWorker({ store, config: cfg({ workerId: "w-a" }) });
    const b = new AnalysisWorker({ store, config: cfg({ workerId: "w-b" }) });
    const [left, right] = await Promise.all([a.runOnce(), b.runOnce()]);
    assert.equal(left.claimed + right.claimed, 1);
    const statuses = [...store.jobs.values()].map((j) => j.status);
    assert.equal(statuses.filter((s) => s === "completed" || s === "needs_review").length, 1);
  });

  await test("heartbeats preserve an active lease", async () => {
    const store = new MemoryPolicyStore();
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const pdf = await buildCompletePolicyPdf();
    await store.enqueuePackage(TEST_ACTOR_A, { files: [{ filename: "one.pdf", bytes: pdf }] });
    const claimed = await store.claimJobs("w-hb", 1);
    assert.equal(claimed.length, 1);
    const firstExpiry = store.jobs.get(claimed[0].jobId)!.leaseExpiresAt!.getTime();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(await store.heartbeatJob(claimed[0].jobId, "w-hb"), true);
    const secondExpiry = store.jobs.get(claimed[0].jobId)!.leaseExpiresAt!.getTime();
    assert.ok(secondExpiry >= firstExpiry);
    const steal = await store.claimJobs("w-other", 1);
    assert.equal(steal.length, 0);
  });

  await test("lost, expired, and reclaimed leases prevent stale completion", async () => {
    let nowMs = Date.now();
    const store = new MemoryPolicyStore({ now: () => new Date(nowMs) });
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const pdf = await buildCompletePolicyPdf();
    const queued = await store.enqueuePackage(TEST_ACTOR_A, { files: [{ filename: "one.pdf", bytes: pdf }] });
    const stale = await store.claimJobs("w-stale", 1);
    nowMs += 130_000;
    const fresh = await store.claimJobs("w-fresh", 1);
    assert.equal(fresh[0].jobId, stale[0].jobId);
    const report = sampleReport({
      policy_id: queued.policy_id,
      session_id: queued.session_id,
      documents: stale[0].files.map((file) => ({
        document_id: file.documentId,
        session_id: queued.session_id,
        original_filename: "one.pdf",
        file_type: "application/pdf",
        upload_timestamp: new Date().toISOString(),
        file_hash: file.sha256,
        page_count: 1,
        storage_location: "",
        extraction_status: "extracted",
        analysis_status: "complete",
        classification: "Declarations",
        pages: [{ page: 1, text: "Declarations Policy Number: EQ-COMP-1 Named Insured: Ada Cole", quality_status: "GOOD" }]
      }))
    });
    await assert.rejects(() => store.completeJob(stale[0].jobId, "w-stale", report), /lease_mismatch/);
    assert.equal(await store.getReport(TEST_ACTOR_A, queued.policy_id), null);
    await store.completeJob(fresh[0].jobId, "w-fresh", report, "needs_review");
    assert.ok(await store.getReport(TEST_ACTOR_A, queued.policy_id));
  });

  await test("cancellation during processing prevents publication", async () => {
    const store = resetMemoryStoreForTests();
    const pdf = await buildCompletePolicyPdf();
    const queued = await enqueue(store, [{ filename: "one.pdf", bytes: pdf }]);
    const claimed = await store.claimJobs("w-cancel", 1);
    assert.equal(await store.cancelJob(TEST_ACTOR_A, queued.policy_id), true);
    const result = await processClaimedJob(store, claimed[0], "w-cancel", { heartbeatMs: 40 });
    assert.ok(result.outcome === "lease_lost" || result.outcome === "cancelled");
    assert.equal(await store.getReport(TEST_ACTOR_A, queued.policy_id), null);
    assert.equal((await store.getStatus(TEST_ACTOR_A, queued.policy_id))?.status, "cancelled");
  });

  await test("SHA-256 mismatch fails permanently with no report", async () => {
    const store = resetMemoryStoreForTests();
    const pdf = await buildCompletePolicyPdf();
    const queued = await enqueue(store, [{ filename: "one.pdf", bytes: pdf }]);
    const row = store.rows.get(queued.policy_id)!;
    await store.backend.put(row.files[0].path, await buildFixturePdf());
    const worker = new AnalysisWorker({ store, config: cfg({ workerId: "w-sha" }) });
    const once = await worker.runOnce();
    assert.equal(once.results[0]?.errorCode, "checksum_mismatch");
    assert.equal(once.results[0]?.outcome, "failed");
    assert.equal(await store.getReport(TEST_ACTOR_A, queued.policy_id), null);
    assert.equal(store.jobs.get(queued.job_id)?.status, "failed");
    assert.equal(store.jobs.get(queued.job_id)?.retryable, false);
  });

  await test("missing storage object is retryable then exhausted", async () => {
    const store = resetMemoryStoreForTests();
    const pdf = await buildCompletePolicyPdf();
    const queued = await enqueue(store, [{ filename: "one.pdf", bytes: pdf }]);
    const row = store.rows.get(queued.policy_id)!;
    await store.backend.remove(row.files[0].path);
    const first = new AnalysisWorker({ store, config: cfg({ workerId: "w-miss-1" }) });
    const r1 = await first.runOnce();
    assert.equal(r1.results[0]?.errorCode, "storage_missing");
    assert.equal(r1.results[0]?.outcome, "retried");
    for (const workerId of ["w-miss-2", "w-miss-3"]) {
      store.jobs.get(queued.job_id)!.availableAt = new Date(0);
      await new AnalysisWorker({ store, config: cfg({ workerId }) }).runOnce();
    }
    const job = store.jobs.get(queued.job_id)!;
    assert.equal(job.status, "failed");
    assert.equal(job.retryable, false);
    assert.equal(await store.getReport(TEST_ACTOR_A, queued.policy_id), null);
  });

  await test("corrupt PDFs fail closed", async () => {
    const store = resetMemoryStoreForTests();
    const full = await buildCompletePolicyPdf();
    const corrupt = Buffer.concat([Buffer.from("%PDF-1.4\n"), full.subarray(0, 64)]);
    const queued = await enqueue(store, [{ filename: "one.pdf", bytes: corrupt }]);
    const worker = new AnalysisWorker({ store, config: cfg({ workerId: "w-corrupt" }) });
    const once = await worker.runOnce();
    assert.ok(["corrupt_pdf", "unsupported_pdf", "extraction_failed"].includes(once.results[0]?.errorCode || ""), once.results[0]?.errorCode);
    assert.equal(once.results[0]?.outcome, "failed");
    assert.equal(await store.getReport(TEST_ACTOR_A, queued.policy_id), null);
  });

  await test("transient failure retries within the attempt ceiling", async () => {
    const store = resetMemoryStoreForTests();
    const pdf = await buildCompletePolicyPdf();
    await enqueue(store, [{ filename: "one.pdf", bytes: pdf }]);
    let downloads = 0;
    const originalLoad = store.loadJobOriginals.bind(store);
    store.loadJobOriginals = async (claimed) => {
      downloads += 1;
      if (downloads === 1) throw new Error("missing_original");
      return originalLoad(claimed);
    };
    const worker = new AnalysisWorker({
      store,
      config: cfg({ workerId: "w-retry" })
    });
    const first = await worker.runOnce();
    assert.equal(first.results[0]?.outcome, "retried");
    store.jobs.forEach((job) => {
      job.availableAt = new Date(0);
    });
    const second = new AnalysisWorker({ store, config: cfg({ workerId: "w-retry-2" }) });
    const again = await second.runOnce();
    assert.equal(again.claimed, 1);
    assert.ok(again.results[0]?.outcome === "completed" || again.results[0]?.outcome === "needs_review");
  });

  await test("worker crash followed by lease expiry permits recovery", async () => {
    let nowMs = Date.now();
    const store = new MemoryPolicyStore({ now: () => new Date(nowMs) });
    await store.ensureAccount(TEST_ACTOR_A.userId);
    const pdf = await buildCompletePolicyPdf();
    const queued = await store.enqueuePackage(TEST_ACTOR_A, { files: [{ filename: "one.pdf", bytes: pdf }] });
    await store.claimJobs("w-crash", 1);
    nowMs += 130_000;
    const worker = new AnalysisWorker({ store, config: cfg({ workerId: "w-recover" }) });
    const once = await worker.runOnce();
    assert.equal(once.claimed, 1);
    assert.ok(await store.getReport(TEST_ACTOR_A, queued.policy_id));
  });

  await test("completion retry remains idempotent", async () => {
    const store = resetMemoryStoreForTests();
    const pdf = await buildCompletePolicyPdf();
    const queued = await enqueue(store, [{ filename: "one.pdf", bytes: pdf }]);
    const worker = new AnalysisWorker({ store, config: cfg({ workerId: "w-idemp" }) });
    await worker.runOnce();
    const first = await store.getReport(TEST_ACTOR_A, queued.policy_id);
    assert.ok(first);
    const job = [...store.jobs.values()][0];
    await store.completeJob(job.jobId, "w-idemp", first, "needs_review");
    const second = await store.getReport(TEST_ACTOR_A, queued.policy_id);
    assert.equal(second?.policy_id, first.policy_id);
    assert.notEqual((await store.getStatus(TEST_ACTOR_A, queued.policy_id))?.status, "failed");
  });

  await test("partial usable extraction becomes needs_review, not completed", async () => {
    const store = resetMemoryStoreForTests();
    const pdf = await buildPartialPolicyPdf();
    const queued = await enqueue(store, [{ filename: "partial.pdf", bytes: pdf }]);
    const worker = new AnalysisWorker({ store, config: cfg({ workerId: "w-partial" }) });
    await worker.runOnce();
    const status = await store.getStatus(TEST_ACTOR_A, queued.policy_id);
    assert.equal(status?.status, "needs_review");
    assert.ok(await store.getReport(TEST_ACTOR_A, queued.policy_id));
  });

  await test("total extraction failure creates no report", async () => {
    const store = resetMemoryStoreForTests();
    const pdf = await buildCompletePolicyPdf();
    const queued = await enqueue(store, [{ filename: "one.pdf", bytes: pdf }]);
    const empty: ExtractedPdf = {
      page_count: 1,
      pages: [{ page: 1, text: "", quality_status: "UNREADABLE", extraction_method: "NATIVE_TEXT" }],
      full_text: "",
      extraction_status: "failed",
      ocr_timed_out: false
    };
    const worker = new AnalysisWorker({
      store,
      config: cfg({ workerId: "w-total" }),
      deps: { extract: async () => empty }
    });
    const once = await worker.runOnce();
    assert.equal(once.results[0]?.outcome, "failed");
    assert.equal(once.results[0]?.errorCode, "extraction_failed");
    assert.equal(await store.getReport(TEST_ACTOR_A, queued.policy_id), null);
  });

  await test("cross-account status, report, and originals remain non-enumerating", async () => {
    const store = resetMemoryStoreForTests();
    await store.ensureAccount(TEST_ACTOR_B.userId);
    const pdf = await buildCompletePolicyPdf();
    const queued = await enqueue(store, [{ filename: "one.pdf", bytes: pdf }]);
    await new AnalysisWorker({ store, config: cfg({ workerId: "w-iso" }) }).runOnce();
    assert.equal(await store.getStatus(TEST_ACTOR_B, queued.policy_id), null);
    assert.equal(await store.getReport(TEST_ACTOR_B, queued.policy_id), null);
    const docId = store.rows.get(queued.policy_id)!.files[0].documentId;
    assert.equal(await store.getOriginal(TEST_ACTOR_B, queued.policy_id, docId), null);
    assert.ok(await store.getReport(TEST_ACTOR_A, queued.policy_id));
  });

  await test("production memory mode is rejected", async () => {
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.POLICY_ANALYZER_STORE = "memory";
    try {
      assert.throws(() => loadWorkerConfig(), ConfigurationError);
      assert.throws(() => createWorkerPersistence(), ConfigurationError);
    } finally {
      process.env.NODE_ENV = prior;
      process.env.POLICY_ANALYZER_STORE = "memory";
    }
  });

  await test("logs contain no policy text, OCR text, filenames, paths, or tokens", async () => {
    const store = resetMemoryStoreForTests();
    const pdf = await buildCompletePolicyPdf();
    await enqueue(store, [{ filename: "secret-policy-name.pdf", bytes: pdf }]);
    const lines = await capturedLogs(async () => {
      operationalLog({
        event: "job_claimed",
        worker_id: "w-log",
        job_id: "11111111-1111-4111-8111-111111111111",
        attempt: 1,
        stage: "extracting"
      });
      await new AnalysisWorker({ store, config: cfg({ workerId: "w-log" }) }).runOnce();
    });
    const blob = lines.join("\n");
    assert.equal(FORBIDDEN_LOG.test(blob), false);
    assert.equal(/secret-policy-name|EQUINE MEDICAL|Ada Cole/i.test(blob), false);
  });

  await test("SIGTERM stops new claims and exits within the shutdown bound", async () => {
    const store = resetMemoryStoreForTests();
    const pdf = await buildCompletePolicyPdf();
    await enqueue(store, [{ filename: "a.pdf", bytes: pdf }]);
    await enqueue(store, [{ filename: "b.pdf", bytes: await buildFixturePdf() }]);
    let started = 0;
    const worker = new AnalysisWorker({
      store,
      config: cfg({ workerId: "w-term", claimLimit: 1, concurrency: 1, shutdownMs: 200 }),
      processJob: async () => {
        started += 1;
        await new Promise((r) => setTimeout(r, 80));
        return { outcome: "completed" as const, durationMs: 80 };
      }
    });
    const running = worker.runLoop();
    await new Promise((r) => setTimeout(r, 30));
    const t0 = Date.now();
    worker.requestStop();
    await running;
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 800, `shutdown took ${elapsed}ms`);
    assert.ok(started >= 1);
    assert.ok(started <= 2);
  });

  await test("multi-job two-worker synthetic run has no duplicates or lost jobs", async () => {
    const store = resetMemoryStoreForTests();
    const pdf = await buildCompletePolicyPdf();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const queued = await enqueue(store, [{ filename: `job-${i}.pdf`, bytes: pdf }]);
      ids.push(queued.job_id);
    }
    const processed = new Set<string>();
    const make = (id: string) =>
      new AnalysisWorker({
        store,
        config: cfg({ workerId: id, claimLimit: 2, concurrency: 2 }),
        processJob: async (_s, job) => {
          if (processed.has(job.jobId)) throw new Error("duplicate_processing");
          processed.add(job.jobId);
          return processClaimedJob(store, job, id, { heartbeatMs: 40 });
        }
      });
    await Promise.all([make("w-syn-a").runOnce(), make("w-syn-b").runOnce()]);
    await Promise.all([make("w-syn-a2").runOnce(), make("w-syn-b2").runOnce()]);
    await Promise.all([make("w-syn-a3").runOnce(), make("w-syn-b3").runOnce()]);
    assert.equal(processed.size, 4);
    for (const jobId of ids) {
      const job = store.jobs.get(jobId)!;
      assert.ok(job.status === "completed" || job.status === "needs_review", job.status);
    }
  });

  await test("malformed claimed payloads are rejected", async () => {
    assert.throws(() => parseClaimedJob({ job_id: "nope" }), /malformed_claim/);
    assert.throws(
      () =>
        parseClaimedJob({
          job_id: "11111111-1111-4111-8111-111111111111",
          policy_id: "11111111-1111-4111-8111-111111111111",
          analysis_id: "11111111-1111-4111-8111-111111111111",
          account_id: "11111111-1111-4111-8111-111111111111",
          owner_user_id: "11111111-1111-4111-8111-111111111111",
          session_id: "11111111-1111-4111-8111-111111111111",
          attempt_count: 1,
          files: [{ document_id: "11111111-1111-4111-8111-111111111111", file_id: "11111111-1111-4111-8111-111111111111", storage_path: "https://evil.example/x", sha256: "ab".repeat(32) }]
        }),
      /malformed_claim/
    );
  });

  await test("missing worker credentials fail at startup", async () => {
    const prior = process.env.POLICY_ANALYZER_STORE;
    delete process.env.POLICY_ANALYZER_STORE;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      assert.throws(() => loadWorkerConfig(), ConfigurationError);
    } finally {
      process.env.POLICY_ANALYZER_STORE = prior || "memory";
    }
  });

  await test("worker:once exits zero when the queue is empty", async () => {
    const result = await runWorkerOnce({
      store: resetMemoryStoreForTests(),
      config: cfg({ workerId: "w-empty" })
    });
    assert.equal(result.claimed, 0);
  });

  await test("decideTerminalState never promotes total failure to needs_review", async () => {
    const failedDoc = {
      document_id: "11111111-1111-4111-8111-111111111111",
      session_id: "11111111-1111-4111-8111-111111111111",
      original_filename: "x.pdf",
      file_type: "application/pdf",
      upload_timestamp: new Date().toISOString(),
      file_hash: "ab".repeat(32),
      page_count: 1,
      storage_location: "",
      extraction_status: "failed" as const,
      analysis_status: "failed" as const,
      classification: "Unknown Document" as const,
      pages: [{ page: 1, text: "", quality_status: "UNREADABLE" as const }]
    };
    assert.equal(decideTerminalState([failedDoc], null), "failed");
  });

  console.log();
  if (ok) {
    console.log("WORKER OK");
  } else {
    console.error(`WORKER FAILED: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
  await shutdownOcr();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
