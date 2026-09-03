import path from "node:path";
import type { DocumentRecord, PolicyRecord } from "./types";
import { loadPolicy, readOriginal } from "./store";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function safeDownloadFilename(original: string): string {
  const base = path.basename(original || "policy.pdf").replace(/[/\\]/g, "");
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
    "X-Robots-Tag": "noindex"
  };
}

export async function resolveOriginalPdf(
  policyId: string,
  documentId: string
): Promise<{ bytes: Buffer; filename: string } | null> {
  if (!isUuid(policyId) || !isUuid(documentId)) return null;
  const rec = await loadPolicy(policyId);
  if (!rec) return null;
  const doc = findPolicyDocument(rec, documentId);
  if (!doc) return null;
  const bytes = await readOriginal(policyId, documentId);
  if (!bytes) return null;
  return { bytes, filename: doc.original_filename };
}
