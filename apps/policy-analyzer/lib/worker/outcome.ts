import { hydratePageDiagnostics } from "@/lib/extraction-quality";
import type { DocumentRecord, PolicyRecord } from "@/lib/types";
import type { JobCompletionOutcome } from "@/lib/persistence/types";

export type TerminalDecision = JobCompletionOutcome | "failed";

function hasUsableText(documents: DocumentRecord[]): boolean {
  return documents.some((document) =>
    document.pages.some((page) => hydratePageDiagnostics(page).quality_status === "GOOD")
  );
}

function materialIncompleteness(report: PolicyRecord): boolean {
  if (report.completeness.status !== "APPEARS COMPLETE") return true;
  if (report.form_inventory.some((form) => form.status === "MISSING")) return true;
  return false;
}

function usablePartialOcr(documents: DocumentRecord[]): boolean {
  return documents.some((document) => document.extraction_status === "partial");
}

function editionMismatch(report: PolicyRecord): boolean {
  return report.form_inventory.some((form) => form.status === "EDITION MISMATCH");
}

function materialConflict(report: PolicyRecord): boolean {
  return report.conflicts.length > 0;
}

function duplicateDocumentIds(documents: DocumentRecord[]): boolean {
  const ids = documents.map((document) => document.document_id);
  return new Set(ids).size !== ids.length;
}

export function decideTerminalState(documents: DocumentRecord[], report: PolicyRecord | null): TerminalDecision {
  if (!documents.length || !hasUsableText(documents) || !report) {
    return "failed";
  }
  if (duplicateDocumentIds(documents)) {
    return "failed";
  }
  if (
    materialIncompleteness(report) ||
    usablePartialOcr(documents) ||
    editionMismatch(report) ||
    materialConflict(report)
  ) {
    return "needs_review";
  }
  return "completed";
}
