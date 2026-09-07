/**
 * Completed-report chrome: document and analysis actions only.
 * Session controls belong in the global AccountBar, not in the report header.
 *
 * GET /api/policies/:id/original always returns the first package file
 * (documents[0]). A top "View original PDF" shortcut is therefore accurate
 * only for a single-document package. Multi-document packages keep per-file
 * "Original file" links in Policy Document Inventory.
 */

export const ORIGINAL_PDF_ACTION_LABEL = "View original PDF";
export const DELETE_ANALYSIS_ACTION_LABEL = "Delete analysis";

export type ReportActionControls = {
  showOriginalPdfShortcut: boolean;
  originalPdfHref: string | null;
  originalPdfAccessibleName: string | null;
  showDeleteAnalysis: boolean;
  deleteAnalysisLabel: string;
  showReportSignOut: boolean;
};

export function describeReportActionControls(input: {
  policyId: string;
  documentCount: number;
}): ReportActionControls {
  const documentCount = Number.isFinite(input.documentCount) ? Math.max(0, input.documentCount) : 0;
  const showOriginalPdfShortcut = documentCount === 1;
  return {
    showOriginalPdfShortcut,
    originalPdfHref: showOriginalPdfShortcut ? `/api/policies/${input.policyId}/original` : null,
    originalPdfAccessibleName: showOriginalPdfShortcut ? ORIGINAL_PDF_ACTION_LABEL : null,
    showDeleteAnalysis: true,
    deleteAnalysisLabel: DELETE_ANALYSIS_ACTION_LABEL,
    showReportSignOut: false
  };
}

export function visibleReportActionLabels(controls: ReportActionControls): string[] {
  const labels: string[] = [];
  if (controls.showOriginalPdfShortcut && controls.originalPdfAccessibleName) {
    labels.push(controls.originalPdfAccessibleName);
  }
  if (controls.showDeleteAnalysis) {
    labels.push(controls.deleteAnalysisLabel);
  }
  return labels;
}
