export const AUDIT_ALLOWLIST = [
  "eventName",
  "objectId",
  "analysisId",
  "documentId",
  "outcome",
  "actorRole",
  "timestamp"
] as const;

export type AuditEventName =
  | "upload_initiated"
  | "document_stored"
  | "analysis_persisted"
  | "report_viewed"
  | "original_downloaded"
  | "access_denied"
  | "deletion_requested"
  | "deletion_completed"
  | "deletion_failed"
  | "retention_purge_completed"
  | "retention_purge_failed"
  | "job_queued"
  | "job_cancelled"
  | "job_completed";

export type AuditEvent = {
  eventName: AuditEventName;
  objectId?: string;
  analysisId?: string;
  documentId?: string;
  outcome?: string;
  actorRole?: string;
  timestamp?: string;
};

const FORBIDDEN_KEYS = [
  "text",
  "ocr",
  "filename",
  "file_name",
  "original_filename",
  "token",
  "cookie",
  "signed",
  "url",
  "password",
  "content",
  "bytes",
  "snippet",
  "page_text"
];

export function sanitizeAuditEvent(input: Record<string, unknown>): AuditEvent {
  const out: Record<string, unknown> = {};
  for (const key of AUDIT_ALLOWLIST) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  for (const key of Object.keys(input)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_KEYS.some((f) => lower.includes(f))) {
      delete out[key];
    }
  }
  if (!out.timestamp) out.timestamp = new Date().toISOString();
  return out as AuditEvent;
}

export function auditContainsSensitive(event: object): boolean {
  const raw = JSON.stringify(event).toLowerCase();
  return (
    /"text"\s*:/.test(raw) && !/"timestamp"/.test(raw) ||
    raw.includes("signedurl") ||
    raw.includes("access_token") ||
    raw.includes("original_filename") ||
    raw.includes("ocr_text")
  );
}
