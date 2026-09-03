import { analyzeDocuments } from "@/lib/analyze";
import { classifyPackage } from "@/lib/classify";
import { extractPdfPages, type ExtractedPdf } from "@/lib/extract-pdf";
import { sha256 } from "@/lib/ids";
import { hydratePageDiagnostics } from "@/lib/extraction-quality";
import type { DocumentClass, DocumentRecord, PageText, PolicyRecord } from "@/lib/types";
import type { ClaimedJob, WorkerPersistence, WorkerProgressStage } from "@/lib/persistence/types";
import { JobCancelledError, LeaseLostError, WorkerJobError, classifyWorkerFailure } from "./errors";
import { operationalLog } from "./log";
import { decideTerminalState } from "./outcome";

export type ProcessJobDeps = {
  extract?: (bytes: Buffer, signal?: AbortSignal) => Promise<ExtractedPdf>;
  classify?: (pages: PageText[]) => DocumentClass;
  analyze?: (policyId: string, sessionId: string, documents: DocumentRecord[]) => PolicyRecord;
  now?: () => number;
};

export type ProcessJobResult = {
  outcome: "completed" | "needs_review" | "failed" | "cancelled" | "lease_lost" | "retried";
  errorCode?: string;
  durationMs: number;
};

async function assertLease(
  store: WorkerPersistence,
  job: ClaimedJob,
  workerId: string,
  stage: WorkerProgressStage
): Promise<void> {
  const ok = await store.heartbeatJob(job.jobId, workerId);
  if (ok) return;
  throw new LeaseLostError(stage);
}

async function recordProgress(
  store: WorkerPersistence,
  job: ClaimedJob,
  workerId: string,
  stage: WorkerProgressStage,
  progress?: { documentsProcessed?: number; pageCount?: number; pagesProcessed?: number }
): Promise<void> {
  const ok = await store.updateJobProgress(job.jobId, workerId, stage, progress);
  if (!ok) throw new LeaseLostError(stage);
}

function startHeartbeat(
  store: WorkerPersistence,
  job: ClaimedJob,
  workerId: string,
  heartbeatMs: number
): () => void {
  const timer = setInterval(() => {
    void store.heartbeatJob(job.jobId, workerId).then((ok) => {
      if (!ok) {
        /* next stage check observes lease loss */
      }
    });
  }, heartbeatMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function failClosed(
  store: WorkerPersistence,
  job: ClaimedJob,
  workerId: string,
  failure: WorkerJobError
): Promise<ProcessJobResult["outcome"]> {
  if (failure instanceof LeaseLostError) return "lease_lost";
  if (failure instanceof JobCancelledError) return "cancelled";
  const recorded = await store.failJob(job.jobId, workerId, failure.code, failure.stage, failure.retryable);
  if (!recorded) return "lease_lost";
  return failure.retryable ? "retried" : "failed";
}

export async function processClaimedJob(
  store: WorkerPersistence,
  job: ClaimedJob,
  workerId: string,
  options: {
    heartbeatMs: number;
    signal?: AbortSignal;
    deps?: ProcessJobDeps;
  }
): Promise<ProcessJobResult> {
  const started = (options.deps?.now ?? Date.now)();
  const extract =
    options.deps?.extract ??
    ((bytes: Buffer, signal?: AbortSignal) => extractPdfPages(bytes, { signal }));
  const classify = options.deps?.classify ?? classifyPackage;
  const analyze = options.deps?.analyze ?? analyzeDocuments;
  let stage: WorkerProgressStage = "downloading";
  const stopHeartbeat = startHeartbeat(store, job, workerId, options.heartbeatMs);

  const finished = (result: ProcessJobResult): ProcessJobResult => {
    stopHeartbeat();
    operationalLog({
      event: "job_finished",
      worker_id: workerId,
      job_id: job.jobId,
      analysis_id: job.analysisId,
      attempt: job.attemptCount,
      stage,
      outcome: result.outcome,
      error_code: result.errorCode,
      duration_ms: result.durationMs
    });
    return result;
  };

  try {
    if (options.signal?.aborted) throw new LeaseLostError(stage);
    await recordProgress(store, job, workerId, "downloading");
    await assertLease(store, job, workerId, stage);

    const originals = await store.loadJobOriginals(job);
    if (originals.length !== job.files.length) {
      throw new WorkerJobError("malformed_claim", false, "downloading");
    }

    stage = "extracting";
    await recordProgress(store, job, workerId, "extracting");

    const documents: DocumentRecord[] = [];
    let pageTotal = 0;
    let pagesProcessed = 0;
    let ocrTimedOut = false;

    for (let index = 0; index < job.files.length; index += 1) {
      if (options.signal?.aborted) throw new LeaseLostError(stage);
      const claimedFile = job.files[index];
      const original = originals[index];
      if (original.documentId !== claimedFile.documentId) {
        throw new WorkerJobError("malformed_claim", false, "extracting");
      }
      const digest = sha256(original.bytes);
      if (digest !== claimedFile.sha256.toLowerCase()) {
        throw new WorkerJobError("checksum_mismatch", false, "extracting");
      }

      let extracted: ExtractedPdf;
      try {
        extracted = await extract(original.bytes, options.signal);
      } catch (err) {
        throw classifyWorkerFailure(err, "extracting");
      }
      if (extracted.ocr_timed_out) ocrTimedOut = true;
      pageTotal += extracted.page_count;
      pagesProcessed += extracted.pages.length;
      documents.push({
        document_id: claimedFile.documentId,
        session_id: job.sessionId,
        original_filename: claimedFile.filename,
        file_type: "application/pdf",
        upload_timestamp: new Date().toISOString(),
        file_hash: claimedFile.sha256,
        page_count: extracted.page_count,
        storage_location: "",
        extraction_status: extracted.extraction_status,
        analysis_status: "pending",
        classification: "Unknown Document",
        pages: extracted.pages
      });
      await recordProgress(store, job, workerId, "extracting", {
        documentsProcessed: index + 1,
        pageCount: pageTotal,
        pagesProcessed
      });
    }

    const usable = documents.some((document) =>
      document.pages.some((page) => hydratePageDiagnostics(page).quality_status === "GOOD")
    );
    if (!usable) {
      if (ocrTimedOut) throw new WorkerJobError("ocr_timeout", true, "extracting");
      throw new WorkerJobError("extraction_failed", false, "extracting");
    }

    if (options.signal?.aborted) throw new LeaseLostError(stage);
    await assertLease(store, job, workerId, "extracting");
    for (const document of documents) {
      document.classification = classify(document.pages);
      document.analysis_status = document.extraction_status === "failed" ? "failed" : "complete";
    }

    stage = "analyzing";
    await recordProgress(store, job, workerId, "analyzing", {
      documentsProcessed: documents.length,
      pageCount: pageTotal,
      pagesProcessed
    });
    await assertLease(store, job, workerId, stage);
    if (options.signal?.aborted) throw new LeaseLostError(stage);
    const report = analyze(job.policyId, job.sessionId, documents);
    const decision = decideTerminalState(documents, report);
    if (decision === "failed") {
      throw new WorkerJobError("extraction_failed", false, "analyzing");
    }

    stage = "finalizing";
    await recordProgress(store, job, workerId, "finalizing", {
      documentsProcessed: documents.length,
      pageCount: pageTotal,
      pagesProcessed
    });
    await assertLease(store, job, workerId, stage);
    if (options.signal?.aborted) throw new LeaseLostError(stage);
    await store.completeJob(job.jobId, workerId, report, decision);
    return finished({
      outcome: decision,
      durationMs: (options.deps?.now ?? Date.now)() - started
    });
  } catch (err) {
    const failure = classifyWorkerFailure(err, stage);
    const outcome = await failClosed(store, job, workerId, failure);
    return finished({
      outcome,
      errorCode: failure.code,
      durationMs: (options.deps?.now ?? Date.now)() - started
    });
  }
}
