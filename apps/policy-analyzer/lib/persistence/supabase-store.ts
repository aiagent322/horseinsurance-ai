import type { SupabaseClient } from "@supabase/supabase-js";
import type { PolicyRecord } from "@/lib/types";
import { AUDIT_ALLOWLIST, sanitizeAuditEvent, type AuditEvent } from "./audit";
import { ConfigurationError, isFixtureAnalysisEnabled, retentionExpiresAt } from "./config";
import { newId } from "@/lib/ids";
import { POLICY_FILES_BUCKET, objectStoragePath } from "./object-paths";
import { toPersistPayload } from "./schema-map";
import { MAX_PURGE_BATCH } from "./constants";
import type { Actor, PolicyStore, SavePackageInput, SavePackageResult } from "./types";

type AnalysisRow = {
  policy_analysis_id: string;
  upload_id: string;
  analyzer_policy_id: string | null;
  session_id: string | null;
  account_id: string;
  user_id: string;
  deleted_at: string | null;
  deletion_status: string | null;
  retention_expires_at: string | null;
};

export class SupabasePolicyStore implements PolicyStore {
  readonly kind = "supabase" as const;

  constructor(private readonly client: SupabaseClient) {}

  async ensureAccount(userId: string): Promise<{ accountId: string; userId: string }> {
    const { data: membership } = await this.client
      .from("account_members")
      .select("account_id, user_role")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (membership?.account_id) {
      return { accountId: membership.account_id, userId };
    }
    const accountId = newId();
    const { error: accountError } = await this.client.from("accounts").insert({
      account_id: accountId,
      account_owner_user_id: userId,
      account_status: "active"
    });
    if (accountError) throw new Error("account_create_failed");
    const { error: memberError } = await this.client.from("account_members").insert({
      account_id: accountId,
      user_id: userId,
      user_role: "owner"
    });
    if (memberError) throw new Error("membership_create_failed");
    return { accountId, userId };
  }

  async savePackage(actor: Actor, input: SavePackageInput): Promise<SavePackageResult> {
    void input.submittedUserId;
    void input.submittedAccountId;
    void input.submittedPolicyId;
    void input.submittedStoragePath;
    if (input.source === "fixture" && !isFixtureAnalysisEnabled()) {
      throw new ConfigurationError("Fixture analysis is disabled.");
    }
    await this.recordAudit(actor, {
      eventName: "upload_initiated",
      actorRole: actor.role,
      outcome: "ok"
    });

    const uploadId = newId();
    const uploaded: Array<{ documentId: string; fileId: string; path: string; sha256: string }> = [];

    try {
      for (const [index, document] of input.report.documents.entries()) {
        const fileId = newId();
        const path = objectStoragePath(actor.accountId, uploadId, fileId);
        const bytes = input.files[index]?.bytes;
        if (!bytes) throw new Error("missing_bytes");
        const { error } = await this.client.storage.from(POLICY_FILES_BUCKET).upload(path, bytes, {
          contentType: "application/pdf",
          upsert: false
        });
        if (error) throw new Error("storage_upload_failed");
        document.storage_location = path;
        uploaded.push({ documentId: document.document_id, fileId, path, sha256: document.file_hash });
        await this.recordAudit(actor, {
          eventName: "document_stored",
          actorRole: actor.role,
          documentId: document.document_id,
          outcome: "ok"
        });
      }

      const payload = toPersistPayload({
        uploadId,
        retentionExpiresAt: retentionExpiresAt(),
        report: input.report,
        files: uploaded.map((file, index) => ({
          fileId: file.fileId,
          documentId: file.documentId,
          sha256: file.sha256,
          objectStorageKey: file.path,
          pageCount: input.report.documents[index].page_count,
          extractionStatus: input.report.documents[index].extraction_status
        }))
      });

      const { data, error } = await this.client.rpc("persist_analyzer_package", { payload });
      if (error || !data) throw new Error("database_persist_failed");
      const persisted = data as {
        policy_analysis_id: string;
        upload_id: string;
        analyzer_policy_id: string;
        session_id: string;
      };
      await this.recordAudit(actor, {
        eventName: "analysis_persisted",
        actorRole: actor.role,
        objectId: input.report.policy_id,
        analysisId: persisted.policy_analysis_id,
        outcome: "ok"
      });
      return {
        policy_id: persisted.analyzer_policy_id || input.report.policy_id,
        session_id: persisted.session_id || input.report.session_id,
        upload_id: persisted.upload_id || uploadId,
        analysis_id: persisted.policy_analysis_id,
        document_count: input.report.documents.length,
        page_count: input.report.documents.reduce((n, d) => n + d.page_count, 0)
      };
    } catch (error) {
      await Promise.all(
        uploaded.map((item) =>
          this.client.storage.from(POLICY_FILES_BUCKET).remove([item.path]).catch(() => undefined)
        )
      );
      throw error;
    }
  }

  private async lookupVisible(actor: Actor | null, policyId: string): Promise<AnalysisRow | null> {
    if (!actor) return null;
    const { data } = await this.client
      .from("policy_analyses")
      .select(
        "policy_analysis_id, upload_id, analyzer_policy_id, session_id, account_id, user_id, deleted_at, deletion_status, retention_expires_at"
      )
      .eq("analyzer_policy_id", policyId)
      .maybeSingle();
    return (data as AnalysisRow | null) ?? null;
  }

  async getReport(actor: Actor | null, policyId: string): Promise<PolicyRecord | null> {
    if (!actor) {
      await this.recordAudit(null, { eventName: "access_denied", objectId: policyId, outcome: "denied" });
      return null;
    }
    const analysis = await this.lookupVisible(actor, policyId);
    if (!analysis) {
      await this.recordAudit(actor, {
        eventName: "access_denied",
        actorRole: actor.role,
        objectId: policyId,
        outcome: "denied"
      });
      return null;
    }
    const { data } = await this.client
      .from("report_sections")
      .select("section_payload")
      .eq("policy_analysis_id", analysis.policy_analysis_id)
      .eq("section_key", "analyzer_report_v1")
      .maybeSingle();
    const record = data?.section_payload as PolicyRecord | undefined;
    if (!record) return null;
    await this.recordAudit(actor, {
      eventName: "report_viewed",
      actorRole: actor.role,
      objectId: policyId,
      analysisId: analysis.policy_analysis_id,
      outcome: "ok"
    });
    return record;
  }

  async getOriginal(
    actor: Actor | null,
    policyId: string,
    documentId: string
  ): Promise<{ bytes: Buffer; filename: string } | null> {
    if (!actor) {
      await this.recordAudit(null, {
        eventName: "access_denied",
        objectId: policyId,
        documentId,
        outcome: "denied"
      });
      return null;
    }
    const analysis = await this.lookupVisible(actor, policyId);
    if (!analysis) {
      await this.recordAudit(actor, {
        eventName: "access_denied",
        actorRole: actor.role,
        objectId: policyId,
        documentId,
        outcome: "denied"
      });
      return null;
    }
    const { data: file } = await this.client
      .from("uploaded_policy_files")
      .select("file_id, object_storage_key, document_id, upload_id")
      .eq("upload_id", analysis.upload_id)
      .eq("document_id", documentId)
      .maybeSingle();
    if (!file) {
      await this.recordAudit(actor, {
        eventName: "access_denied",
        actorRole: actor.role,
        objectId: policyId,
        documentId,
        outcome: "denied"
      });
      return null;
    }
    const expected = objectStoragePath(analysis.account_id, analysis.upload_id, file.file_id);
    if (file.object_storage_key !== expected) {
      await this.recordAudit(actor, {
        eventName: "access_denied",
        actorRole: actor.role,
        objectId: policyId,
        documentId,
        outcome: "denied"
      });
      return null;
    }
    const { data: blob, error } = await this.client.storage.from(POLICY_FILES_BUCKET).download(file.object_storage_key);
    if (error || !blob) return null;
    const record = await this.getReportWithoutAudit(analysis.policy_analysis_id);
    const document = record?.documents.find((item) => item.document_id === documentId);
    await this.recordAudit(actor, {
      eventName: "original_downloaded",
      actorRole: actor.role,
      objectId: policyId,
      documentId,
      outcome: "ok"
    });
    return {
      bytes: Buffer.from(await blob.arrayBuffer()),
      filename: document?.original_filename || "policy.pdf"
    };
  }

  private async getReportWithoutAudit(analysisId: string): Promise<PolicyRecord | null> {
    const { data } = await this.client
      .from("report_sections")
      .select("section_payload")
      .eq("policy_analysis_id", analysisId)
      .eq("section_key", "analyzer_report_v1")
      .maybeSingle();
    return (data?.section_payload as PolicyRecord | undefined) ?? null;
  }

  async deletePackage(actor: Actor | null, policyId: string): Promise<"deleted" | "not_found"> {
    if (!actor) {
      await this.recordAudit(null, { eventName: "access_denied", objectId: policyId, outcome: "denied" });
      return "not_found";
    }
    const { data: receipt } = await this.client
      .from("deletion_receipts")
      .select("analyzer_policy_id")
      .eq("analyzer_policy_id", policyId)
      .maybeSingle();
    if (receipt) {
      await this.recordAudit(actor, {
        eventName: "deletion_completed",
        actorRole: actor.role,
        objectId: policyId,
        outcome: "ok"
      });
      return "deleted";
    }
    const { data: analysis } = await this.client
      .from("policy_analyses")
      .select("policy_analysis_id, upload_id, account_id, user_id, deleted_at, deletion_status")
      .eq("analyzer_policy_id", policyId)
      .maybeSingle();
    if (!analysis || analysis.account_id !== actor.accountId || analysis.user_id !== actor.userId) {
      await this.recordAudit(actor, {
        eventName: "access_denied",
        actorRole: actor.role,
        objectId: policyId,
        outcome: "denied"
      });
      return "not_found";
    }
    await this.recordAudit(actor, {
      eventName: "deletion_requested",
      actorRole: actor.role,
      objectId: policyId,
      outcome: "ok"
    });
    if (analysis.deleted_at || analysis.deletion_status === "deleted") {
      await this.recordAudit(actor, {
        eventName: "deletion_completed",
        actorRole: actor.role,
        objectId: policyId,
        outcome: "ok"
      });
      return "deleted";
    }
    try {
      const { data: files } = await this.client
        .from("uploaded_policy_files")
        .select("object_storage_key")
        .eq("upload_id", analysis.upload_id);
      const paths = (files || []).map((file) => file.object_storage_key).filter(Boolean);
      if (paths.length) {
        await this.client.storage.from(POLICY_FILES_BUCKET).remove(paths);
      }
      await this.client.from("uploads").delete().eq("upload_id", analysis.upload_id);
      await this.client.from("deletion_receipts").insert({
        analyzer_policy_id: policyId,
        account_id: actor.accountId,
        user_id: actor.userId
      });
      await this.recordAudit(actor, {
        eventName: "deletion_completed",
        actorRole: actor.role,
        objectId: policyId,
        outcome: "ok"
      });
      return "deleted";
    } catch {
      await this.recordAudit(actor, {
        eventName: "deletion_failed",
        actorRole: actor.role,
        objectId: policyId,
        outcome: "error"
      });
      throw new Error("deletion_failed");
    }
  }

  async recordAudit(actor: Actor | null, event: AuditEvent): Promise<void> {
    const clean = sanitizeAuditEvent(event as unknown as Record<string, unknown>);
    if (!actor) return;
    const row: Record<string, unknown> = {
      account_id: actor.accountId,
      user_id: actor.userId,
      actor_role: clean.actorRole || actor.role,
      event_name: clean.eventName,
      outcome: clean.outcome,
      input_object_id: clean.objectId || null,
      output_object_id: clean.documentId || clean.analysisId || null,
      policy_analysis_id: null,
      event_timestamp: clean.timestamp
    };
    for (const key of Object.keys(row)) {
      if (![...AUDIT_ALLOWLIST, "account_id", "user_id", "event_name", "input_object_id", "output_object_id", "policy_analysis_id", "event_timestamp"].includes(key)) {
        delete row[key];
      }
    }
    await this.client.from("audit_events").insert(row);
  }

  listAuditForTests(): AuditEvent[] {
    return [];
  }

  async purgeExpired(limit: number): Promise<{ purged: number }> {
    const batchSize = Math.max(1, Math.min(limit, MAX_PURGE_BATCH));
    const { createAdminClient } = await import("./admin-client");
    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from("policy_analyses")
      .select("policy_analysis_id, upload_id, analyzer_policy_id, account_id, user_id")
      .eq("deletion_status", "active")
      .lte("retention_expires_at", new Date().toISOString())
      .limit(batchSize);
    if (error) {
      await this.recordAudit(null, { eventName: "retention_purge_failed", outcome: "error" });
      throw new Error("purge_failed");
    }
    let purged = 0;
    try {
      for (const row of rows || []) {
        const { data: files } = await admin
          .from("uploaded_policy_files")
          .select("object_storage_key")
          .eq("upload_id", row.upload_id);
        const paths = (files || []).map((file) => file.object_storage_key).filter(Boolean);
        if (paths.length) await admin.storage.from(POLICY_FILES_BUCKET).remove(paths);
        await admin.from("uploads").delete().eq("upload_id", row.upload_id);
        purged += 1;
      }
      if (rows?.[0]) {
        await admin.from("audit_events").insert({
          account_id: rows[0].account_id,
          user_id: rows[0].user_id,
          event_name: "retention_purge_completed",
          outcome: "ok",
          actor_role: "admin"
        });
      }
      return { purged };
    } catch {
      throw new Error("purge_failed");
    }
  }
}
