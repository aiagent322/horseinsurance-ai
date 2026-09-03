import { newId, sha256 as computeSha256 } from "@/lib/ids";
import { sanitizeAuditEvent, type AuditEvent } from "./audit";
import { MAX_PURGE_BATCH } from "./constants";
import { ConfigurationError, isFixtureAnalysisEnabled, retentionExpiresAt } from "./config";
import { objectStoragePath } from "./object-paths";
import { safeDownloadFilename } from "@/lib/original-document";
import type {
  Actor,
  ClaimedJob,
  EnqueuePackageInput,
  EnqueuePackageResult,
  ObjectBackend,
  PolicyStore,
  ReservationResult,
  ReservedFileTuple,
  SafeStatusPayload,
  SavePackageInput,
  SavePackageResult
} from "./types";
import { RateLimitError, BacklogLimitError } from "./types";
import { assertAnalyzerReportBound, reportIsBoundToJob } from "./report-binding";
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
  sessionId: string;
  retentionExpiresAt: Date;
  deletedAt: string | null;
  files: Array<{
    documentId: string;
    fileId: string;
    path: string;
    sha256: string;
    original_filename?: string;
  }>;
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
    workerBatchSize: 5,
    claimBatchMax: 20
  };
}

type MemoryReservation = {
  reservationId: string;
  accountId: string;
  ownerUserId: string;
  uploadId: string;
  analysisId: string;
  policyId: string;
  sessionId: string;
  jobId: string;
  fileCount: number;
  files: ReservedFileTuple[];
  status: "pending" | "finalized" | "abandoned" | "expired";
  expiresAt: Date;
};

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
  readonly reservations = new Map<string, MemoryReservation>();
  readonly usageWindows = new Map<string, number>();
  readonly auditEvents: AuditEvent[] = [];
  lastSubmittedOwnership: unknown = null;
  failNextPersist = false;
  failAfterObjectUpload = false;
  persistPartialThenFail = false;
  storageUnavailable = false;
  private claimChain: Promise<void> = Promise.resolve();
  private quotaChain: Promise<void> = Promise.resolve();
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
        sessionId: input.report.session_id,
        retentionExpiresAt: expires,
        deletedAt: null,
        files: uploaded.map((u) => ({ ...u, sha256: "" }))
      });
      const completedJob: JobRow = {
        jobId: newId(),
        policyId: input.report.policy_id,
        analysisId,
        accountId: actor.accountId,
        ownerUserId: actor.userId,
        status: "completed",
        attemptCount: 1,
        maxAttempts: jobLimits().maxAttempts,
        createdAt: this.now(),
        availableAt: this.now(),
        startedAt: this.now(),
        completedAt: this.now(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastHeartbeat: null,
        errorCode: null,
        failureStage: null,
        cancelledAt: null,
        recovery: {},
        stage: "completed",
        documentCount: input.report.documents.length,
        documentsProcessed: input.report.documents.length,
        pageCount: input.report.documents.reduce((n, d) => n + d.page_count, 0),
        pagesProcessed: input.report.documents.reduce((n, d) => n + d.page_count, 0),
        retryable: false,
        updatedAt: this.now()
      };
      this.jobs.set(completedJob.jobId, completedJob);
      this.jobsByPolicy.set(input.report.policy_id, completedJob.jobId);
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

    const job = this.jobForRow(policyId, row);
    if (!job || (job.status !== "completed" && job.status !== "needs_review")) {
      return null;
    }
    if (!reportIsBoundToJob(row.record, this.bindingContext(job, row))) {
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

  private jobForRow(policyId: string, row: Row): JobRow | undefined {
    const jobId = this.jobsByPolicy.get(policyId);
    const job = jobId ? this.jobs.get(jobId) : undefined;
    if (!job || job.policyId !== policyId || job.analysisId !== row.analysisId) {
      return undefined;
    }
    return job;
  }

  private bindingContext(job: JobRow, row: Row) {
    return {
      policyId: job.policyId,
      sessionId: row.sessionId,
      documentCount: job.documentCount,
      documentIds: row.files.map((file) => file.documentId)
    };
  }

  private reportUnavailableStatus(row: Row, job?: JobRow): SafeStatusPayload {
    return {
      analysis_id: job?.analysisId ?? row.analysisId,
      status: "failed",
      stage: "failed",
      document_count: job?.documentCount ?? row.stubDocuments.length,
      documents_processed: 0,
      page_count: null,
      pages_processed: 0,
      error_code: "report_unavailable",
      retryable: false,
      updated_at: this.now().toISOString()
    };
  }

  private async withQuotaLock<T>(fn: () => Promise<T> | T): Promise<T> {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.quotaChain;
    this.quotaChain = prev.then(() => gate);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private expireStaleReservations(accountId: string): void {
    for (const reservation of this.reservations.values()) {
      if (
        reservation.accountId === accountId &&
        reservation.status === "pending" &&
        reservation.expiresAt.getTime() <= this.now().getTime()
      ) {
        reservation.status = "expired";
      }
    }
  }

  private backlogCount(accountId: string): number {
    this.expireStaleReservations(accountId);
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.accountId === accountId && (job.status === "queued" || job.status === "processing")) {
        count += 1;
      }
    }
    for (const reservation of this.reservations.values()) {
      if (
        reservation.accountId === accountId &&
        reservation.status === "pending" &&
        reservation.expiresAt.getTime() > this.now().getTime()
      ) {
        count += 1;
      }
    }
    return count;
  }

  async reservePackage(actor: Actor, fileCount: number): Promise<ReservationResult> {
    return this.withQuotaLock(() => this.reservePackageLocked(actor, fileCount));
  }

  private reservePackageLocked(actor: Actor, fileCount: number): ReservationResult {
    const limits = jobLimits();
    if (fileCount < 1 || fileCount > limits.maxFilesPerPackage) {
      throw new Error("invalid_file_count");
    }
    this.expireStaleReservations(actor.accountId);
    const windowKey = `${actor.accountId}:${Math.floor(this.now().getTime() / 3600000)}`;
    const windowCount = this.usageWindows.get(windowKey) || 0;
    if (windowCount >= limits.uploadsPerHour) {
      throw new RateLimitError("Too many analysis requests.", 60);
    }
    if (this.backlogCount(actor.accountId) >= limits.activeJobsPerAccount) {
      throw new BacklogLimitError("Analysis backlog is full.", 30);
    }
    this.usageWindows.set(windowKey, windowCount + 1);

    const reservationId = newId();
    const uploadId = newId();
    const files: ReservedFileTuple[] = [];
    for (let i = 1; i <= fileCount; i += 1) {
      const fileId = newId();
      files.push({
        ordinal: i,
        file_id: fileId,
        document_id: newId(),
        storage_path: objectStoragePath(actor.accountId, uploadId, fileId)
      });
    }
    const reservation: MemoryReservation = {
      reservationId,
      accountId: actor.accountId,
      ownerUserId: actor.userId,
      uploadId,
      analysisId: newId(),
      policyId: newId(),
      sessionId: newId(),
      jobId: newId(),
      fileCount,
      files,
      status: "pending",
      expiresAt: new Date(this.now().getTime() + limits.reservationExpiryMinutes * 60_000)
    };
    this.reservations.set(reservationId, reservation);
    return {
      reservation_id: reservation.reservationId,
      upload_id: reservation.uploadId,
      analysis_id: reservation.analysisId,
      policy_id: reservation.policyId,
      session_id: reservation.sessionId,
      job_id: reservation.jobId,
      file_count: reservation.fileCount,
      files: reservation.files,
      expires_at: reservation.expiresAt.toISOString()
    };
  }

  abandonReservation(actor: Actor, reservationId: string): boolean {
    const reservation = this.reservations.get(reservationId);
    if (!reservation || reservation.ownerUserId !== actor.userId || reservation.status !== "pending") {
      return false;
    }
    reservation.status = "abandoned";
    return true;
  }

  finalizeReservation(
    actor: Actor,
    reservationId: string,
    submitted: Array<{ file_id: string; document_id: string; storage_path: string; sha256: string; original_filename?: string }>
  ): EnqueuePackageResult {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new Error("reservation_not_found");
    if (reservation.ownerUserId !== actor.userId) throw new Error("reservation_owner_mismatch");
    if (reservation.status !== "pending") throw new Error("reservation_already_used");
    if (reservation.expiresAt.getTime() <= this.now().getTime()) {
      reservation.status = "expired";
      throw new Error("reservation_expired");
    }
    if (this.storageUnavailable) throw new Error("storage_unavailable");
    if (submitted.length !== reservation.fileCount) throw new Error("file_count_mismatch");

    const fileIds = submitted.map((item) => item.file_id);
    const documentIds = submitted.map((item) => item.document_id);
    const paths = submitted.map((item) => item.storage_path);
    if (new Set(fileIds).size !== fileIds.length) throw new Error("duplicate_file_ids");
    if (new Set(documentIds).size !== documentIds.length) throw new Error("duplicate_document_ids");
    if (new Set(paths).size !== paths.length) throw new Error("duplicate_storage_paths");

    for (const item of submitted) {
      if (!/^[0-9a-f]{64}$/.test(item.sha256)) throw new Error("invalid_sha256");
      if (!item.storage_path.startsWith(`${reservation.accountId}/`)) {
        throw new Error("storage_path_foreign_account");
      }
      const match = reservation.files.find(
        (tuple) =>
          tuple.file_id === item.file_id &&
          tuple.document_id === item.document_id &&
          tuple.storage_path === item.storage_path
      );
      if (!match) throw new Error("reserved_tuple_mismatch");
      if (!this.backend.objects.has(item.storage_path)) {
        throw new Error("storage_object_missing");
      }
    }

    if (this.failNextPersist) {
      this.failNextPersist = false;
      throw new Error("database_persist_failed");
    }

    const uploaded = reservation.files.map((tuple) => {
      const item = submitted.find(
        (entry) =>
          entry.file_id === tuple.file_id &&
          entry.document_id === tuple.document_id &&
          entry.storage_path === tuple.storage_path
      );
      if (!item) throw new Error("reserved_file_missing");
      return {
        documentId: tuple.document_id,
        fileId: tuple.file_id,
        path: tuple.storage_path,
        sha256: item.sha256,
        original_filename: item.original_filename
      };
    });
    const expires = new Date(retentionExpiresAt(this.now()));
    this.rows.set(reservation.policyId, {
      record: null,
      stubDocuments: uploaded.map((file) => ({
        document_id: file.documentId,
        session_id: reservation.sessionId,
        original_filename: safeDownloadFilename(file.original_filename || `${file.fileId}.pdf`),
        file_type: "application/pdf",
        upload_timestamp: this.now().toISOString(),
        file_hash: file.sha256,
        page_count: 0,
        storage_location: file.path,
        extraction_status: "pending" as const,
        analysis_status: "pending" as const,
        classification: "Unknown Document" as const,
        pages: []
      })),
      accountId: reservation.accountId,
      ownerUserId: reservation.ownerUserId,
      uploadId: reservation.uploadId,
      analysisId: reservation.analysisId,
      sessionId: reservation.sessionId,
      retentionExpiresAt: expires,
      deletedAt: null,
      files: uploaded
    });

    const job: JobRow = {
      jobId: reservation.jobId,
      policyId: reservation.policyId,
      analysisId: reservation.analysisId,
      accountId: reservation.accountId,
      ownerUserId: reservation.ownerUserId,
      status: "queued",
      attemptCount: 0,
      maxAttempts: jobLimits().maxAttempts,
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
      documentCount: reservation.fileCount,
      documentsProcessed: 0,
      pageCount: null,
      pagesProcessed: 0,
      retryable: false,
      updatedAt: this.now()
    };
    this.jobs.set(job.jobId, job);
    this.jobsByPolicy.set(reservation.policyId, job.jobId);
    reservation.status = "finalized";
    return {
      policy_id: reservation.policyId,
      session_id: reservation.sessionId,
      upload_id: reservation.uploadId,
      analysis_id: reservation.analysisId,
      job_id: reservation.jobId,
      document_count: reservation.fileCount,
      page_count: null
    };
  }

  async enqueuePackage(actor: Actor, input: EnqueuePackageInput): Promise<EnqueuePackageResult> {
    void input.submittedUserId;
    void input.submittedAccountId;
    void input.submittedPolicyId;
    void input.submittedStoragePath;

    if (input.source === "fixture" && !isFixtureAnalysisEnabled()) {
      throw new ConfigurationError("Fixture analysis is disabled.");
    }

    const reservation = await this.reservePackage(actor, input.files.length);
    const uploadedPaths: string[] = [];
    try {
      for (let i = 0; i < input.files.length; i += 1) {
        const path = reservation.files[i].storage_path;
        await this.backend.put(path, input.files[i].bytes);
        uploadedPaths.push(path);
      }
      this.writeAudit("upload_initiated", { actorRole: actor.role, objectId: reservation.policy_id, outcome: "ok" });
      return this.finalizeReservation(
        actor,
        reservation.reservation_id,
        input.files.map((file, index) => ({
          file_id: reservation.files[index].file_id,
          document_id: reservation.files[index].document_id,
          storage_path: reservation.files[index].storage_path,
          sha256: computeSha256(file.bytes),
          original_filename: file.filename
        }))
      );
    } catch (error) {
      await Promise.all(uploadedPaths.map((path) => this.backend.remove(path).catch(() => undefined)));
      this.abandonReservation(actor, reservation.reservation_id);
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
    const job = this.jobForRow(policyId, row);
    if (!job) {
      return this.reportUnavailableStatus(row);
    }
    if (
      (job.status === "completed" || job.status === "needs_review") &&
      !reportIsBoundToJob(row.record, this.bindingContext(job, row))
    ) {
      return this.reportUnavailableStatus(row, job);
    }
    return {
      analysis_id: job.analysisId,
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
    job.leaseOwner = null;
    job.leaseExpiresAt = null;
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

  private leaseIsActive(job: JobRow, workerId: string): boolean {
    return (
      job.status === "processing" &&
      job.leaseOwner === workerId &&
      job.leaseExpiresAt !== null &&
      job.leaseExpiresAt.getTime() > this.now().getTime()
    );
  }

  async claimJobs(workerId: string, limit: number): Promise<ClaimedJob[]> {
    const max = jobLimits().claimBatchMax;
    if (!Number.isInteger(limit) || limit < 1 || limit > max) {
      throw new Error("invalid_claim_limit");
    }
    return this.withClaimLock(() => this.claimJobsLocked(workerId, limit));
  }

  private claimJobsLocked(workerId: string, limit: number): ClaimedJob[] {
    const limits = jobLimits();
    const batch = Math.min(limit, limits.workerBatchSize);
    const now = this.now();
    for (const job of this.jobs.values()) {
      if (
        job.status === "processing" &&
        job.cancelledAt === null &&
        job.leaseExpiresAt &&
        job.leaseExpiresAt.getTime() <= now.getTime() &&
        job.attemptCount >= job.maxAttempts
      ) {
        job.status = "failed";
        job.errorCode = "attempts_exhausted";
        job.failureStage = "lease";
        job.retryable = false;
        job.leaseOwner = null;
        job.leaseExpiresAt = null;
        job.completedAt = now;
        job.stage = "failed";
        job.updatedAt = now;
      }
    }
    const claimed: ClaimedJob[] = [];
    for (const job of [...this.jobs.values()]) {
      if (claimed.length >= batch) break;
      if (job.cancelledAt) continue;
      const canClaim =
        (job.status === "queued" && job.availableAt <= now) ||
        (job.status === "processing" &&
          job.leaseExpiresAt !== null &&
          job.leaseExpiresAt.getTime() <= now.getTime() &&
          job.attemptCount < job.maxAttempts);
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
        sessionId: row.sessionId
      });
    }
    return claimed;
  }

  async heartbeatJob(jobId: string, workerId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || !this.leaseIsActive(job, workerId)) return false;
    job.lastHeartbeat = this.now();
    job.leaseExpiresAt = new Date(this.now().getTime() + jobLimits().leaseMs);
    job.updatedAt = this.now();
    return true;
  }

  async updateJobProgress(jobId: string, workerId: string, stage: string, progress?: { documentsProcessed?: number; pageCount?: number; pagesProcessed?: number }): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || !this.leaseIsActive(job, workerId)) return false;
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
    if (!job || !this.leaseIsActive(job, workerId)) return false;
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
    if (!job) throw new Error("lease_mismatch");
    const row = this.rows.get(job.policyId);
    if (!row) throw new Error("missing_row");
    if (job.status === "completed") {
      if (!reportIsBoundToJob(row.record, this.bindingContext(job, row))) {
        throw new Error("report_unavailable");
      }
      return;
    }
    if (job.cancelledAt) throw Object.assign(new Error("cancelled"), { code: "cancelled" });
    if (!this.leaseIsActive(job, workerId)) throw new Error("lease_mismatch");
    assertAnalyzerReportBound(report, this.bindingContext(job, row));
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
