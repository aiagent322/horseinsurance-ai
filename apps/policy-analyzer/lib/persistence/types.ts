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

export type ObjectBackend = {
  put(path: string, bytes: Buffer): Promise<void>;
  get(path: string): Promise<Buffer | null>;
  remove(path: string): Promise<void>;
};

export interface PolicyStore {
  readonly kind: "memory" | "supabase";
  ensureAccount(userId: string): Promise<{ accountId: string; userId: string }>;
  savePackage(actor: Actor, input: SavePackageInput): Promise<SavePackageResult>;
  getReport(actor: Actor | null, policyId: string): Promise<PolicyRecord | null>;
  getOriginal(
    actor: Actor | null,
    policyId: string,
    documentId: string
  ): Promise<{ bytes: Buffer; filename: string } | null>;
  deletePackage(actor: Actor | null, policyId: string): Promise<"deleted" | "not_found">;
  recordAudit(actor: Actor | null, event: AuditEvent): Promise<void>;
  listAuditForTests(): AuditEvent[];
  purgeExpired(limit: number): Promise<{ purged: number }>;
}
