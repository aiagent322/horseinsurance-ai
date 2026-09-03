import { newId } from "@/lib/ids";
import { sanitizeAuditEvent, type AuditEvent } from "./audit";
import { MAX_PURGE_BATCH } from "./constants";
import { ConfigurationError, isFixtureAnalysisEnabled, retentionExpiresAt } from "./config";
import { objectStoragePath } from "./object-paths";
import type {
  Actor,
  ObjectBackend,
  PolicyStore,
  SavePackageInput,
  SavePackageResult
} from "./types";
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
  record: PolicyRecord;
  accountId: string;
  ownerUserId: string;
  uploadId: string;
  analysisId: string;
  retentionExpiresAt: Date;
  deletedAt: string | null;
  files: Array<{ documentId: string; fileId: string; path: string }>;
};

function audit(eventName: AuditEvent["eventName"], extra: Partial<AuditEvent> = {}): AuditEvent {
  return sanitizeAuditEvent({ eventName, timestamp: new Date().toISOString(), ...extra });
}

export class MemoryPolicyStore implements PolicyStore {
  readonly kind = "memory" as const;
  readonly backend: MemoryObjectBackend;
  readonly accounts = new Map<string, string>();
  readonly rows = new Map<string, Row>();
  readonly auditEvents: AuditEvent[] = [];
  lastSubmittedOwnership: unknown = null;
  failNextPersist = false;
  failAfterObjectUpload = false;
  persistPartialThenFail = false;
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
        accountId: actor.accountId,
        ownerUserId: actor.userId,
        uploadId,
        analysisId,
        retentionExpiresAt: expires,
        deletedAt: null,
        files: uploaded
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
    const document = row.record.documents.find((item) => item.document_id === documentId);
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
