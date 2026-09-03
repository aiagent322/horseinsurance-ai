import { newId, sha256 as computeSha256 } from "@/lib/ids";
import { sanitizeAuditEvent, type AuditEvent } from "./audit";
import { MAX_PURGE_BATCH } from "./constants";
import { ConfigurationError, isFixtureAnalysisEnabled, retentionExpiresAt } from "./config";
import { objectStoragePath } from "./object-paths";
import type {
  Actor,
  ClaimedJob,
  EnqueuePackageInput,
  EnqueuePackageResult,
  ObjectBackend,
  PolicyStore,
  SafeStatusPayload,
  SavePackageInput,
  SavePackageResult
} from "./types";
import { RateLimitError, BacklogLimitError } from "./types";
import type { PolicyRecord } from "@/lib/types";

export class MemoryObjectBackend implements ObjectBackend {
  readonly objects = new Map<string, Buffer>();
  failNextUpload = false;
  failNextDelete = false;

  async put(path: string, bytes: Buffer): Promise<void> {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      throw new Error("storage_upload_failed");
    }
    this.objects.set(path, Buffer.from(bytes));
  }

  async get(path: string): Promise<Buffer | null> {
    const value = this.objects.get(path);
    return value ? Buffer.from(value) : null;
  }

  async remove(path: string): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("storage_delete_failed");
    }
    this.objects.delete(path);
  }
}

type Row = {
  record: PolicyRecord | null;
  stubDocuments: PolicyRecord["documents"];
  accountId: string;
  ownerUserId: string;
  uploadId: string;
  analysisId: string;
  retentionExpiresAt: Date;
  deletedAt: string | null;
  files: Array<{ documentId: string; fileId: string; path: string; sha256: string }>;
};

type JobRow = {
  jobId: string;
  policyId: string;
  analysisId: string;
  accountId: string;
  ownerUserId: string;
  status: SafeStatusPayload["status"];
  attemptCount: number;
  maxAttempts: number;
  createdAt: Date;
  availableAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  lastHeartbeat: Date | null;
  errorCode: string | null;
  failureStage: string | null;
  cancelledAt: Date | null;
  recovery: Record<string, string | number | boolean>;
  stage: string;
  documentCount: number;
  documentsProcessed: number;
  pageCount: number | null;
  pagesProcessed: number;
  retryable: boolean;
  updatedAt: Date;
};

function jobLimits() {
  return {
    uploadsPerHour: 20,
    activeJobsPerAccount: 5,
    maxFilesPerPackage: 10,
    maxAttempts: 3,
    leaseMs: 120_000,
    reservationExpiryMinutes: 30,
    retentionDays: 30,
    workerBatchSize: 5
  };
}

function audit(eventName: AuditEvent["eventName"], extra: Partial<AuditEvent> = {}): AuditEvent {
  return sanitizeAuditEvent({ eventName, timestamp: new Date().toISOString(), ...extra });
}

export class MemoryPolicyStore implements PolicyStore {
  readonly kind = "memory" as const;
  readonly backend: MemoryObjectBackend;
  readonly accounts = new Map<string, string>();
  readonly rows = new Map<string, Row>();
  readonly jobs = new Map<string, JobRow>();
  readonly jobsByPolicy = new Map<string, string>();
  readonly usageWindows = new Map<string, number>();
  readonly auditEvents: AuditEvent[] = [];
  lastSubmittedOwnership: unknown = null;
  failNextPersist = false;
  failAfterObjectUpload = false;
  persistPartialThenFail = false;
  private claimChain: Promise<void> = Promise.resolve();
  readonly now: () => Date;

  constructor(options?: { backend?: MemoryObjectBackend; now?: () => Date }) {
    this.backend = options?.backend ?? new MemoryObjectBackend();
    this.now = options?.now ?? (() => new Date());
  }

  private writeAudit(eventName: AuditEvent["eventName"], extra: Partial<AuditEvent> = {}): void {
    this.auditEvents.push(audit(eventName, extra));
  }

  private visible(row: Row, actor: Actor): boolean {
    if (row.deletedAt) return false;
    if (row.accountId !== actor.accountId || row.ownerUserId !== actor.userId) return false;
    if (row.retentionExpiresAt.getTime() <= this.now().getTime()) return false;
    return true;
  }

  async ensureAccount(userId: string): Promise<{ accountId: string; userId: string }> {
    const existing = this.accounts.get(userId);
    if (existing) return { accountId: existing, userId };
    const accountId = newId();
    this.accounts.set(userId, accountId);
    return { accountId, userId };
  }

  async savePackage(actor: Actor, input: SavePackageInput): Promise<SavePackageResult> {
    this.lastSubmittedOwnership = {
      submittedUserId: input.submittedUserId,
      submittedAccountId: input.submittedAccountId,
      submittedPolicyId: input.submittedPolicyId,
      submittedStoragePath: input.submittedStoragePath
    };
    if (input.source === "fixture" && !isFixtureAnalysisEnabled()) {
      throw new ConfigurationError("Fixture analysis is disabled.");
    }
    this.writeAudit("upload_initiated", { actorRole: actor.role, outcome: "ok" });

    const uploadId = newId();
    const analysisId = newId();
    const uploaded: Array<{ documentId: string; fileId: string; path: string }> = [];

    try {
      for (const [index, document] of input.report.documents.entries()) {
        const fileId = newId();
        const path = objectStoragePath(actor.accountId, uploadId, fileId);
        const bytes = input.files[index]?.bytes;
        if (!bytes) throw new Error("missing_bytes");
        await this.backend.put(path, bytes);
        uploaded.push({ documentId: document.document_id, fileId, path });
        document.storage_location = path;
        this.writeAudit("document_stored", {
          actorRole: actor.role,
          documentId: document.document_id,
          outcome: "ok"
        });
      }

      if (this.failAfterObjectUpload || this.failNextPersist || this.persistPartialThenFail) {
        this.failAfterObjectUpload = false;
        this.failNextPersist = false;
        this.persistPartialThenFail = false;
        throw new Error("database_persist_failed");
      }

      const expires = new Date(retentionExpiresAt(this.now()));
      this.rows.set(input.report.policy_id, {
        record: input.report,
        stubDocuments: input.report.documents,
        accountId: actor.accountId,
        ownerUserId: actor.userId,
        uploadId,
        analysisId,
        retentionExpiresAt: expires,
        deletedAt: null,
        files: uploaded.map((u) => ({ ...u, sha256: "" }))
      });
      this.writeAudit("analysis_persisted", {
        actorRole: actor.role,
        objectId: input.report.policy_id,
        analysisId,
        outcome: "ok"
      });
      return {
        policy_id: input.report.policy_id,
        session_id: input.report.session_id,
        upload_id: uploadId,
        analysis_id: analysisId,
        document_count: input.report.documents.length,
        page_count: input.report.documents.reduce((n, d) => n + d.page_count, 0)
      };
    } catch (error) {
      await Promise.all(uploaded.map((item) => this.backend.remove(item.path).catch(() => undefined)));
      throw error;
    }
  }

  async getReport(actor: Actor | null, policyId: string): Promise<PolicyRecord | null> {
    if (!actor) {
      this.writeAudit("access_denied", { objectId: policyId, outcome: "denied" });
      return null;
    }
    const row = this.rows.get(policyId);
    if (!row || !this.visible(row, actor)) {
      this.writeAudit("access_denied", {
        actorRole: actor.role,
        objectId: policyId,
        outcome: "denied"
      });
      return null;
    }
    if (!row.record) return null;

    const jobId = this.jobsByPolicy.get(policyId);
    const job = jobId ? this.jobs.get(jobId) : undefined;
    if (job && job.status !== "completed" && job.status !== "needs_review") {
      return null;
    }

    this.writeAudit("report_viewed", {
      actorRole: actor.role,
      objectId: policyId,
      analysisId: row.analysisId,
      outcome: "ok"
    });
    return row.record;
  }

  async getOriginal(
    actor: Actor | null,
    policyId: string,
    documentId: string
  ): Promise<{ bytes: Buffer; filename: string } | null> {
    if (!actor) {
      this.writeAudit("access_denied", { objectId: policyId, documentId, outcome: "denied" });
      return null;
    }
    const row = this.rows.get(policyId);
    if (!row || !this.visible(row, actor)) {
      this.writeAudit("access_denied", {
        actorRole: actor.role,
        objectId: policyId,
        documentId,
        outcome: "denied"
      });
      return null;
    }
    const file = row.files.find((item) => item.documentId === documentId);
    const allDocs = row.record?.documents ?? row.stubDocuments;
    const document = allDocs.find((item) => item.document_id === documentId);
    if (!file || !document) {
      this.writeAudit("access_denied", {
        actorRole: actor.role,
        objectId: policyId,
        documentId,
        outcome: "denied"
      });
      return null;
    }
    const expected = objectStoragePath(row.accountId, row.uploadId, file.fileId);
    if (file.path !== expected) {
      this.writeAudit("access_denied", {
        actorRole: actor.role,
        objectId: policyId,
        documentId,
        outcome: "denied"
      });
      return null;
    }
    const bytes = await this.backend.get(file.path);
    if (!bytes) return null;
    this.writeAudit("original_downloaded", {
      actorRole: actor.role,
      objectId: policyId,
      documentId,
      outcome: "ok"
    });
    return { bytes, filename: document.original_filename };
  }

  async deletePackage(actor: Actor | null, policyId: string): Promise<"deleted" | "not_found"> {
    if (!actor) {
      this.writeAudit("access_denied", { objectId: policyId, outcome: "denied" });
      return "not_found";
    }
    const row = this.rows.get(policyId);
    if (!row || row.accountId !== actor.accountId || row.ownerUserId !== actor.userId) {
      this.writeAudit("access_denied", {
        actorRole: actor.role,
        objectId: policyId,
        outcome: "denied"
      });
      return "not_found";
    }
    this.writeAudit("deletion_requested", {
      actorRole: actor.role,
      objectId: policyId,
      outcome: "ok"
    });
    if (row.deletedAt) {
      this.writeAudit("deletion_completed", {
        actorRole: actor.role,
        objectId: policyId,
        outcome: "ok"
      });
      return "deleted";
    }
    try {
      for (const file of row.files) {
        await this.backend.remove(file.path);
      }
      row.deletedAt = this.now().toISOString();
      this.writeAudit("deletion_completed", {
        actorRole: actor.role,
        objectId: policyId,
        outcome: "ok"
      });
      return "deleted";
    } catch {
      this.writeAudit("deletion_failed", {
        actorRole: actor.role,
        objectId: policyId,
        outcome: "error"
      });
      throw new Error("deletion_failed");
    }
  }

  async recordAudit(_actor: Actor | null, event: AuditEvent): Promise<void> {
    this.auditEvents.push(sanitizeAuditEvent(event as unknown as Record<string, unknown>));
  }

  listAuditForTests(): AuditEvent[] {
    return [...this.auditEvents];
  }

  tryUpdateAudit(): never {
    throw new Error("audit_append_only");
  }

  tryDeleteAudit(): never {
    throw new Error("audit_append_only");
  }

  async enqueuePackage(actor: Actor, input: EnqueuePackageInput): Promise<EnqueuePackageResult> {
    void input.submittedUserId;
    void input.submittedAccountId;
    void input.submittedPolicyId;
    void input.submittedStoragePath;

    if (input.source === "fixture" && !isFixtureAnalysisEnabled()) {
      throw new ConfigurationError("Fixture analysis is disabled.");
    }

    const limits = jobLimits();

    const windowKey = `${actor.accountId}:${Math.floor(this.now().getTime() / 3600000)}`;
    const windowCount = this.usageWindows.get(windowKey) || 0;
    if (windowCount >= limits.uploadsPerHour) {
      throw new RateLimitError("Too many analysis requests.", 60);
    }

    let activeCount = 0;
    for (const job of this.jobs.values()) {
      if (job.accountId === actor.accountId && (job.status === "queued" || job.status === "processing")) {
        activeCount++;
      }
    }
    if (activeCount >= limits.activeJobsPerAccount) {
      throw new BacklogLimitError("Analysis backlog is full.", 30);
    }

    this.usageWindows.set(windowKey, windowCount + 1);

    const policyId = newId();
    const sessionId = newId();
    const uploadId = newId();
    const analysisId = newId();
    const jobId = newId();

    const uploaded: Row["files"] = [];
    try {
      for (const file of input.files) {
        const fileId = newId();
        const documentId = newId();
        const path = objectStoragePath(actor.accountId, uploadId, fileId);
        await this.backend.put(path, file.bytes);
        uploaded.push({ documentId, fileId, path, sha256: computeSha256(file.bytes) });
      }

      if (this.failNextPersist) {
        this.failNextPersist = false;
        throw new Error("database_persist_failed");
      }

      const expires = new Date(retentionExpiresAt(this.now()));
      this.rows.set(policyId, {
        record: null,
        stubDocuments: uploaded.map((u, i) => ({
          document_id: u.documentId,
          session_id: sessionId,
          original_filename: input.files[i].filename,
          file_type: "application/pdf",
          upload_timestamp: this.now().toISOString(),
          file_hash: u.sha256,
          page_count: 0,
          storage_location: u.path,
          extraction_status: "pending" as const,
          analysis_status: "pending" as const,
          classification: "Unknown Document" as const,
          pages: []
        })),
        accountId: actor.accountId,
        ownerUserId: actor.userId,
        uploadId,
        analysisId,
        retentionExpiresAt: expires,
        deletedAt: null,
        files: uploaded
      });

      const job: JobRow = {
        jobId,
        policyId,
        analysisId,
        accountId: actor.accountId,
        ownerUserId: actor.userId,
        status: "queued",
        attemptCount: 0,
        maxAttempts: limits.maxAttempts,
        createdAt: this.now(),
        availableAt: this.now(),
        startedAt: null,
        completedAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastHeartbeat: null,
        errorCode: null,
        failureStage: null,
        cancelledAt: null,
        recovery: {},
        stage: "queued",
        documentCount: input.files.length,
        documentsProcessed: 0,
        pageCount: null,
        pagesProcessed: 0,
        retryable: false,
        updatedAt: this.now()
      };
      this.jobs.set(jobId, job);
      this.jobsByPolicy.set(policyId, jobId);

      this.writeAudit("upload_initiated", { actorRole: actor.role, objectId: policyId, outcome: "ok" });

      return {
        policy_id: policyId,
        session_id: sessionId,
        upload_id: uploadId,
        analysis_id: analysisId,
        job_id: jobId,
        document_count: input.files.length,
        page_count: null
      };
    } catch (error) {
      await Promise.all(uploaded.map((item) => this.backend.remove(item.path).catch(() => undefined)));
      throw error;
    }
  }

  async getStatus(actor: Actor | null, policyId: string): Promise<SafeStatusPayload | null> {
    if (!actor) {
      this.writeAudit("access_denied", { objectId: policyId, outcome: "denied" });
      return null;
    }
    const row = this.rows.get(policyId);
    if (!row || !this.visible(row, actor)) {
      this.writeAudit("access_denied", { actorRole: actor.role, objectId: policyId, outcome: "denied" });
      return null;
    }
    const jobId = this.jobsByPolicy.get(policyId);
    const job = jobId ? this.jobs.get(jobId) : undefined;
    if (!job) {
      if (row.record) {
        return {
          analysis_id: policyId,
          status: "completed",
          stage: "completed",
          document_count: row.record.documents.length,
          documents_processed: row.record.documents.length,
          page_count: row.record.documents.reduce((n, d) => n + d.page_count, 0),
          pages_processed: row.record.documents.reduce((n, d) => n + d.page_count, 0),
          error_code: null,
          retryable: false,
          updated_at: this.now().toISOString()
        };
      }
      return {
        analysis_id: policyId,
        status: "failed",
        stage: "failed",
        document_count: row.stubDocuments.length,
        documents_processed: 0,
        page_count: null,
        pages_processed: 0,
        error_code: "report_unavailable",
        retryable: false,
        updated_at: this.now().toISOString()
      };
    }
    return {
      analysis_id: job.policyId,
      status: job.status,
      stage: job.stage,
      document_count: job.documentCount,
      documents_processed: job.documentsProcessed,
      page_count: job.pageCount,
      pages_processed: job.pagesProcessed,
      error_code: job.errorCode,
      retryable: job.retryable,
      updated_at: job.updatedAt.toISOString()
    };
  }

  async cancelJob(actor: Actor | null, policyId: string): Promise<boolean> {
    if (!actor) return false;
    const row = this.rows.get(policyId);
    if (!row || row.accountId !== actor.accountId || row.ownerUserId !== actor.userId) return false;
    const jobId = this.jobsByPolicy.get(policyId);
    const job = jobId ? this.jobs.get(jobId) : undefined;
    if (!job || (job.status !== "queued" && job.status !== "processing")) return false;
    job.status = "cancelled";
    job.cancelledAt = this.now();
    job.errorCode = "cancelled";
    job.retryable = false;
    job.updatedAt = this.now();
    this.writeAudit("job_cancelled", { actorRole: actor.role, objectId: policyId, outcome: "ok" });
    return true;
  }

  private async withClaimLock<T>(fn: () => Promise<T> | T): Promise<T> {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const prev = this.claimChain;
    this.claimChain = prev.then(() => gate);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async claimJobs(workerId: string, limit: number): Promise<ClaimedJob[]> {
    return this.withClaimLock(() => this.claimJobsLocked(workerId, limit));
  }

  private claimJobsLocked(workerId: string, limit: number): ClaimedJob[] {
    const limits = jobLimits();
    const batch = Math.max(1, Math.min(limit, limits.workerBatchSize));
    const now = this.now();
    const claimed: ClaimedJob[] = [];
    for (const job of [...this.jobs.values()]) {
      if (claimed.length >= batch) break;
      if (job.cancelledAt) continue;
      const canClaim =
        (job.status === "queued" && job.availableAt <= now) ||
        (job.status === "processing" && job.leaseExpiresAt && job.leaseExpiresAt < now && job.attemptCount < job.maxAttempts);
      if (!canClaim) continue;
      const row = this.rows.get(job.policyId);
      if (!row) continue;
      job.status = "processing";
      job.leaseOwner = workerId;
      job.leaseExpiresAt = new Date(now.getTime() + limits.leaseMs);
      job.lastHeartbeat = now;
      job.startedAt = job.startedAt || now;
      job.attemptCount += 1;
      job.stage = "processing";
      job.updatedAt = now;
      claimed.push({
        jobId: job.jobId,
        policyId: job.policyId,
        analysisId: job.analysisId,
        accountId: job.accountId,
        ownerUserId: job.ownerUserId,
        attemptCount: job.attemptCount,
        files: row.files.map((f, i) => ({
          documentId: f.documentId,
          fileId: f.fileId,
          path: f.path,
          sha256: f.sha256,
          filename: row.stubDocuments[i]?.original_filename || `${f.fileId}.pdf`
        })),
        sessionId: row.record?.session_id || newId()
      });
    }
    return claimed;
  }

  async heartbeatJob(jobId: string, workerId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.leaseOwner !== workerId || job.status !== "processing") return false;
    job.lastHeartbeat = this.now();
    job.leaseExpiresAt = new Date(this.now().getTime() + jobLimits().leaseMs);
    job.updatedAt = this.now();
    return true;
  }

  async updateJobProgress(jobId: string, workerId: string, stage: string, progress?: { documentsProcessed?: number; pageCount?: number; pagesProcessed?: number }): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.leaseOwner !== workerId || job.status !== "processing") return false;
    job.stage = stage;
    if (progress?.documentsProcessed !== undefined) job.documentsProcessed = progress.documentsProcessed;
    if (progress?.pageCount !== undefined) job.pageCount = progress.pageCount;
    if (progress?.pagesProcessed !== undefined) job.pagesProcessed = progress.pagesProcessed;
    job.lastHeartbeat = this.now();
    job.leaseExpiresAt = new Date(this.now().getTime() + jobLimits().leaseMs);
    job.updatedAt = this.now();
    return true;
  }

  async failJob(jobId: string, workerId: string, errorCode: string, stage: string, retryable: boolean): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.leaseOwner !== workerId) return false;
    if (retryable && job.attemptCount < job.maxAttempts) {
      job.status = "queued";
      job.errorCode = errorCode;
      job.failureStage = stage;
      job.retryable = true;
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.availableAt = new Date(this.now().getTime() + Math.pow(2, job.attemptCount) * 1000);
      job.stage = "queued";
    } else {
      job.status = "failed";
      job.errorCode = errorCode;
      job.failureStage = stage;
      job.retryable = false;
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.completedAt = this.now();
      job.stage = "failed";
    }
    job.updatedAt = this.now();
    return true;
  }

  async completeJob(jobId: string, workerId: string, report: PolicyRecord): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.leaseOwner !== workerId) throw new Error("lease_mismatch");
    if (job.cancelledAt) throw Object.assign(new Error("cancelled"), { code: "cancelled" });
    if (job.status === "completed" && this.rows.get(job.policyId)?.record) return;
    const row = this.rows.get(job.policyId);
    if (!row) throw new Error("missing_row");
    row.record = report;
    job.status = "completed";
    job.stage = "completed";
    job.completedAt = this.now();
    job.leaseOwner = null;
    job.leaseExpiresAt = null;
    job.documentsProcessed = report.documents.length;
    job.pageCount = report.documents.reduce((n, d) => n + d.page_count, 0);
    job.pagesProcessed = job.pageCount;
    job.retryable = false;
    job.errorCode = null;
    job.updatedAt = this.now();
    this.writeAudit("analysis_persisted", { objectId: job.policyId, analysisId: job.analysisId, outcome: "ok" });
  }

  async loadJobOriginals(claimed: ClaimedJob): Promise<Array<{ documentId: string; filename: string; bytes: Buffer }>> {
    const results: Array<{ documentId: string; filename: string; bytes: Buffer }> = [];
    for (const file of claimed.files) {
      const bytes = await this.backend.get(file.path);
      if (!bytes) throw new Error("missing_original");
      results.push({ documentId: file.documentId, filename: file.filename, bytes });
    }
    return results;
  }

  async purgeExpired(limit: number): Promise<{ purged: number }> {
    const batchSize = Math.max(1, Math.min(limit, MAX_PURGE_BATCH));
    const now = this.now().getTime();
    const candidates = [...this.rows.values()]
      .filter((row) => !row.deletedAt && row.retentionExpiresAt.getTime() <= now)
      .slice(0, batchSize);
    try {
      for (const row of candidates) {
        for (const file of row.files) {
          await this.backend.remove(file.path);
        }
        row.deletedAt = this.now().toISOString();
      }
      this.writeAudit("retention_purge_completed", {
        outcome: "ok",
        objectId: String(candidates.length)
      });
      return { purged: candidates.length };
    } catch {
      this.writeAudit("retention_purge_failed", { outcome: "error" });
      throw new Error("purge_failed");
    }
  }

  objectPathFor(policyId: string, documentId: string): string | null {
    const row = this.rows.get(policyId);
    const file = row?.files.find((item) => item.documentId === documentId);
    return file?.path ?? null;
  }
}

export { MAX_PURGE_BATCH };
