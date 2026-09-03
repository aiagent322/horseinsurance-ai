import type { PolicyRecord } from "@/lib/types";

export type ReportBindingContext = {
  policyId: string;
  sessionId: string;
  documentCount: number;
  documentIds: string[];
};

export function analyzerReportBindingError(
  report: unknown,
  expected: ReportBindingContext
): string | null {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return "report_unavailable";
  }
  const record = report as Partial<PolicyRecord> & { documents?: unknown };
  if (record.policy_id !== expected.policyId) {
    return "report_policy_mismatch";
  }
  if (record.session_id !== expected.sessionId) {
    return "report_session_mismatch";
  }
  if (!Array.isArray(record.documents)) {
    return "report_documents_invalid";
  }
  const ids = record.documents.map((document) =>
    document && typeof document === "object" ? String((document as { document_id?: unknown }).document_id || "") : ""
  );
  if (new Set(ids).size !== ids.length) {
    return "report_duplicate_document_ids";
  }
  const expectedIds = new Set(expected.documentIds);
  if (ids.some((id) => !expectedIds.has(id))) {
    return "report_foreign_document";
  }
  if (expected.documentIds.some((id) => !ids.includes(id))) {
    return "report_missing_document";
  }
  if (ids.length !== expected.documentCount || expected.documentIds.length !== expected.documentCount) {
    return "report_document_count_mismatch";
  }
  return null;
}

export function assertAnalyzerReportBound(
  report: unknown,
  expected: ReportBindingContext
): asserts report is PolicyRecord {
  const error = analyzerReportBindingError(report, expected);
  if (error) throw new Error(error);
}

export function reportIsBoundToJob(report: unknown, expected: ReportBindingContext): report is PolicyRecord {
  return analyzerReportBindingError(report, expected) === null;
}
