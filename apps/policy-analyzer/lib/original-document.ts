import path from "node:path";
import { getUserStore } from "@/lib/auth/session";
import type { DocumentRecord, PolicyRecord } from "./types";
import type { SafeStatusPayload } from "@/lib/persistence/types";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function safeDownloadFilename(original: string): string {
  const stripped = String(original || "policy.pdf").replace(/[\u0000-\u001f\u007f]/g, "");
  const base = path.basename(stripped).replace(/[/\\]/g, "");
  const cleaned =
    base
      .replace(/[^\w.\- ()[\]]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[.]+/, "")
      .trim()
      .slice(0, 120) || "policy.pdf";
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function findPolicyDocument(
  record: PolicyRecord,
  documentId: string
): DocumentRecord | undefined {
  return record.documents.find((d) => d.document_id === documentId);
}

export function originalFileHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": contentDisposition(safeDownloadFilename(filename)),
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow"
  };
}

export async function resolveOriginalPdf(
  policyId: string,
  documentId: string
): Promise<{ bytes: Buffer; filename: string } | null> {
  if (!isUuid(policyId) || !isUuid(documentId)) return null;
  const { actor, store } = await getUserStore();
  return store.getOriginal(actor, policyId, documentId);
}

export async function loadPolicyStatus(policyId: string): Promise<SafeStatusPayload | null> {
  if (!isUuid(policyId)) return null;
  const { actor, store } = await getUserStore();
  return store.getStatus(actor, policyId);
}

export async function loadPolicyRecord(policyId: string): Promise<PolicyRecord | null> {
  if (!isUuid(policyId)) return null;
  const { actor, store } = await getUserStore();
  return store.getReport(actor, policyId);
}

export async function deletePolicyRecord(policyId: string): Promise<"deleted" | "not_found"> {
  if (!isUuid(policyId)) return "not_found";
  const { actor, store } = await getUserStore();
  return store.deletePackage(actor, policyId);
}
