import type { PolicyRecord } from "@/lib/types";
import { POLICY_FILES_BUCKET } from "./object-paths";
import { inspectClaimBatch } from "./claim";
import { createServiceRoleClient } from "./service-client";
import { terminalizeRecoverableMalformedClaims } from "../worker/malformed-claim";
import type {
  ClaimedJob,
  JobCompletionOutcome,
  JobProgressUpdate,
  WorkerPersistence,
  WorkerProgressStage
} from "./types";
import { isWorkerProgressStage } from "./types";

export class WorkerRpcError extends Error {
  readonly code = "infrastructure_failure" as const;
  constructor() {
    super("infrastructure_failure");
    this.name = "WorkerRpcError";
  }
}

export class StorageObjectError extends Error {
  constructor(
    readonly code: "storage_missing" | "storage_unavailable",
    readonly retryable: boolean
  ) {
    super(code);
    this.name = "StorageObjectError";
  }
}

function rpcFailed(error: { message?: string } | null): boolean {
  return Boolean(error);
}

export class SupabaseWorkerStore implements WorkerPersistence {
  readonly kind = "supabase" as const;
  private readonly client = createServiceRoleClient();

  async claimJobs(workerId: string, limit: number): Promise<ClaimedJob[]> {
    const { data, error } = await this.client.rpc("claim_analysis_jobs", {
      p_worker_id: workerId,
      p_limit: limit
    });
    if (rpcFailed(error)) throw new WorkerRpcError();
    const inspected = inspectClaimBatch(data, workerId);
    await terminalizeRecoverableMalformedClaims(this, inspected.recoverable);
    return inspected.jobs;
  }

  async heartbeatJob(jobId: string, workerId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("heartbeat_analysis_job", {
      p_job_id: jobId,
      p_worker_id: workerId
    });
    if (rpcFailed(error)) throw new WorkerRpcError();
    return data === true;
  }

  async updateJobProgress(
    jobId: string,
    workerId: string,
    stage: WorkerProgressStage | string,
    progress?: JobProgressUpdate
  ): Promise<boolean> {
    if (!isWorkerProgressStage(stage)) return false;
    const { data, error } = await this.client.rpc("update_job_progress", {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_stage: stage,
      p_documents_processed: progress?.documentsProcessed ?? null,
      p_page_count: progress?.pageCount ?? null,
      p_pages_processed: progress?.pagesProcessed ?? null
    });
    if (rpcFailed(error)) throw new WorkerRpcError();
    return data === true;
  }

  async failJob(
    jobId: string,
    workerId: string,
    errorCode: string,
    stage: string,
    retryable: boolean
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc("fail_analysis_job", {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_error_code: errorCode,
      p_stage: stage,
      p_retryable: retryable
    });
    if (rpcFailed(error)) throw new WorkerRpcError();
    return data === true;
  }

  async completeJob(
    jobId: string,
    workerId: string,
    report: PolicyRecord,
    outcome: JobCompletionOutcome = "completed"
  ): Promise<void> {
    const { error } = await this.client.rpc("complete_analysis_job", {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_report: report,
      p_outcome: outcome
    });
    if (!error) return;
    const message = error.message || "";
    if (message.includes("lease_mismatch")) throw new Error("lease_mismatch");
    if (message.includes("job_cancelled")) throw Object.assign(new Error("cancelled"), { code: "cancelled" });
    if (message.includes("invalid_completion_outcome")) throw new Error("completion_binding_rejected");
    if (
      message.includes("report_") ||
      message.includes("binding")
    ) {
      throw new Error(message.includes("report_") ? message.split(/\s+/)[0] || "completion_binding_rejected" : "completion_binding_rejected");
    }
    throw new WorkerRpcError();
  }

  async loadJobOriginals(
    claimed: ClaimedJob
  ): Promise<Array<{ documentId: string; filename: string; bytes: Buffer }>> {
    const results: Array<{ documentId: string; filename: string; bytes: Buffer }> = [];
    for (const file of claimed.files) {
      const { data, error } = await this.client.storage.from(POLICY_FILES_BUCKET).download(file.path);
      if (error || !data) {
        const blob = `${error?.message || ""} ${error?.name || ""}`.toLowerCase();
        if (blob.includes("not found") || blob.includes("404") || blob.includes("object not found")) {
          throw new StorageObjectError("storage_missing", true);
        }
        throw new StorageObjectError("storage_unavailable", true);
      }
      results.push({
        documentId: file.documentId,
        filename: file.filename,
        bytes: Buffer.from(await data.arrayBuffer())
      });
    }
    return results;
  }
}
