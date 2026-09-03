import { OcrCancelledError, OcrTimeoutError } from "@/lib/ocr";
import { MalformedClaimError } from "@/lib/persistence/claim";
import { StorageObjectError, WorkerRpcError } from "@/lib/persistence/worker-store";
import type { WorkerErrorCode, WorkerProgressStage } from "@/lib/persistence/types";

export class WorkerJobError extends Error {
  constructor(
    readonly code: WorkerErrorCode,
    readonly retryable: boolean,
    readonly stage: WorkerProgressStage | "processing"
  ) {
    super(code);
    this.name = "WorkerJobError";
  }
}

export class LeaseLostError extends WorkerJobError {
  constructor(stage: WorkerProgressStage | "processing" = "processing") {
    super("lease_lost", false, stage);
    this.name = "LeaseLostError";
  }
}

export class JobCancelledError extends WorkerJobError {
  constructor(stage: WorkerProgressStage | "processing" = "processing") {
    super("cancelled", false, stage);
    this.name = "JobCancelledError";
  }
}

export function classifyWorkerFailure(
  err: unknown,
  stage: WorkerProgressStage | "processing"
): WorkerJobError {
  if (err instanceof WorkerJobError) return err;
  if (err instanceof MalformedClaimError) return new WorkerJobError("malformed_claim", false, stage);
  if (err instanceof WorkerRpcError) return new WorkerJobError("infrastructure_failure", true, stage);
  if (err instanceof StorageObjectError) return new WorkerJobError(err.code, err.retryable, stage);
  if (err instanceof OcrCancelledError || (err instanceof Error && err.name === "OcrCancelledError")) {
    return new LeaseLostError(stage);
  }
  if (err instanceof OcrTimeoutError || (err instanceof Error && err.name === "OcrTimeoutError")) {
    return new WorkerJobError("ocr_timeout", true, "extracting");
  }
  if (err instanceof Error) {
    const name = err.name || "";
    const message = err.message || "";
    if (message === "missing_original") return new WorkerJobError("storage_missing", true, stage);
    if (message === "lease_mismatch") return new LeaseLostError(stage);
    if (message === "cancelled" || (err as { code?: string }).code === "cancelled") {
      return new JobCancelledError(stage);
    }
    if (message.startsWith("report_") || message === "completion_binding_rejected") {
      return new WorkerJobError("completion_binding_rejected", false, "finalizing");
    }
    if (/password|encrypted|invalid pdf|xref|format error|unreachable/i.test(name + message)) {
      return new WorkerJobError("corrupt_pdf", false, "extracting");
    }
  }
  if (stage === "extracting") return new WorkerJobError("corrupt_pdf", false, "extracting");
  return new WorkerJobError("infrastructure_failure", true, stage);
}
