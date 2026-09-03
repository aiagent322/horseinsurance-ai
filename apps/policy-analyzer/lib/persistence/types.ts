import type { PolicyRecord } from "@/lib/types";
import type { IncomingPdf } from "@/lib/validate-upload";
import type { AuditEvent } from "./audit";

export type Actor = {
  userId: string;
  accountId: string;
  role: "owner" | "reviewer" | "admin";
  email?: string;
};

export type SavePackageInput = {
  files: IncomingPdf[];
  report: PolicyRecord;
  source?: "upload" | "fixture";
  submittedUserId?: string;
  submittedAccountId?: string;
  submittedPolicyId?: string;
  submittedStoragePath?: string;
};

export type SavePackageResult = {
  policy_id: string;
  session_id: string;
  upload_id: string;
  analysis_id: string;
  document_count: number;
  page_count: number;
};

export type JobStatusName =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "needs_review"
  | "cancelled";

export type SafeStatusPayload = {
  analysis_id: string;
  status: JobStatusName;
  stage: string;
  document_count: number;
  documents_processed: number;
  page_count: number | null;
  pages_processed: number;
  error_code: string | null;
  retryable: boolean;
  updated_at?: string;
};

export type ReservationResult = {
  reservation_id: string;
  upload_id: string;
  analysis_id: string;
  policy_id: string;
  session_id: string;
  job_id: string;
  file_ids: string[];
  document_ids: string[];
  storage_paths: string[];
  expires_at: string;
};

export type EnqueuePackageInput = {
  files: IncomingPdf[];
  source?: "upload" | "fixture";
  submittedUserId?: string;
  submittedAccountId?: string;
  submittedPolicyId?: string;
  submittedStoragePath?: string;
};

export type EnqueuePackageResult = {
  policy_id: string;
  session_id: string;
  upload_id: string;
  analysis_id: string;
  job_id: string;
  document_count: number;
  page_count: number | null;
};

export type ClaimedJob = {
  jobId: string;
  policyId: string;
  analysisId: string;
  accountId: string;
  ownerUserId: string;
  attemptCount: number;
  files: Array<{ documentId: string; fileId: string; path: string; sha256: string; filename: string }>;
  sessionId: string;
};

export type ObjectBackend = {
  put(path: string, bytes: Buffer): Promise<void>;
  get(path: string): Promise<Buffer | null>;
  remove(path: string): Promise<void>;
};

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message = "Too many analysis requests.", retryAfterSeconds = 60) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class BacklogLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message = "Analysis backlog is full.", retryAfterSeconds = 30) {
    super(message);
    this.name = "BacklogLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface PolicyStore {
  readonly kind: "memory" | "supabase";
  ensureAccount(userId: string): Promise<{ accountId: string; userId: string }>;
  savePackage(actor: Actor, input: SavePackageInput): Promise<SavePackageResult>;
  enqueuePackage(actor: Actor, input: EnqueuePackageInput): Promise<EnqueuePackageResult>;
  getStatus(actor: Actor | null, policyId: string): Promise<SafeStatusPayload | null>;
  getReport(actor: Actor | null, policyId: string): Promise<PolicyRecord | null>;
  getOriginal(
    actor: Actor | null,
    policyId: string,
    documentId: string
  ): Promise<{ bytes: Buffer; filename: string } | null>;
  cancelJob(actor: Actor | null, policyId: string): Promise<boolean>;
  deletePackage(actor: Actor | null, policyId: string): Promise<"deleted" | "not_found">;
  recordAudit(actor: Actor | null, event: AuditEvent): Promise<void>;
  listAuditForTests(): AuditEvent[];
  purgeExpired(limit: number): Promise<{ purged: number }>;

  claimJobs(workerId: string, limit: number): Promise<ClaimedJob[]>;
  heartbeatJob(jobId: string, workerId: string): Promise<boolean>;
  updateJobProgress(jobId: string, workerId: string, stage: string, progress?: { documentsProcessed?: number; pageCount?: number; pagesProcessed?: number }): Promise<boolean>;
  failJob(jobId: string, workerId: string, errorCode: string, stage: string, retryable: boolean): Promise<boolean>;
  completeJob(jobId: string, workerId: string, report: PolicyRecord): Promise<void>;
  loadJobOriginals(claimed: ClaimedJob): Promise<Array<{ documentId: string; filename: string; bytes: Buffer }>>;
}
