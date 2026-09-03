import type { AnalysisStatus, Confidence, PolicyRecord, Sourced } from "@/lib/types";

export function mapCoverageStatus(status: AnalysisStatus): string {
  switch (status) {
    case "COVERED":
      return "Included";
    case "COVERED WITH LIMITATIONS":
    case "LIMITED":
      return "Limited";
    case "EXCLUDED":
      return "Excluded";
    case "NOT FOUND":
    case "DOCUMENT MISSING":
      return "Not Found";
    default:
      return "Unclear";
  }
}

export function mapConfidence(confidence: Confidence | undefined): string {
  if (confidence === "HIGH") return "Confirmed";
  if (confidence === "MEDIUM") return "Likely";
  return "Unclear";
}

export function toValueWithSource(field?: Sourced<string>) {
  if (!field) {
    return { value: null, source_ref_ids: [], confidence: null, null_reason: "not_found" };
  }
  return {
    value: field.value,
    source_ref_ids: [],
    confidence: mapConfidence(field.confidence_status),
    null_reason: null
  };
}

export type StoredFileMeta = {
  fileId: string;
  documentId: string;
  sha256: string;
  objectStorageKey: string;
  pageCount: number;
  extractionStatus: string;
};

export function toPersistPayload(input: {
  uploadId: string;
  retentionExpiresAt: string;
  report: PolicyRecord;
  files: StoredFileMeta[];
}): Record<string, unknown> {
  const report = input.report;
  return {
    upload_id: input.uploadId,
    retention_expires_at: input.retentionExpiresAt,
    extraction_status: report.documents.every((d) => d.extraction_status === "extracted")
      ? "complete"
      : "partial",
    identification: {
      carrier_name: toValueWithSource(report.identification.carrier_name),
      policy_number: toValueWithSource(report.identification.policy_number),
      policy_effective_date: toValueWithSource(report.identification.policy_effective_date),
      policy_expiration_date: toValueWithSource(report.identification.policy_expiration_date),
      named_insured: toValueWithSource(report.identification.named_insured),
      insured_horse_name: toValueWithSource(report.identification.insured_horse_name),
      breed: toValueWithSource(report.identification.breed),
      age: toValueWithSource(report.identification.age),
      insured_value: toValueWithSource(report.identification.insured_value)
    },
    document_types_present: report.documents.map((d) => d.classification),
    files: input.files.map((file) => {
      const document = report.documents.find((d) => d.document_id === file.documentId);
      return {
        file_id: file.fileId,
        document_id: file.documentId,
        file_sha256: file.sha256,
        object_storage_key: file.objectStorageKey,
        page_count: file.pageCount,
        extraction_status: file.extractionStatus,
        pages: (document?.pages || []).map((page) => ({
          page: page.page,
          text: page.text,
          extraction_method: page.extraction_method,
          quality_status: page.quality_status,
          ocr_attempted: page.ocr_attempted,
          ocr_succeeded: page.ocr_succeeded,
          character_count: page.character_count,
          word_count: page.word_count,
          alphanumeric_ratio: page.alphanumeric_ratio,
          diagnostic_warnings: page.diagnostic_warnings,
          confidence: page.confidence
        }))
      };
    }),
    coverages: report.coverages.map((coverage) => ({
      coverage_id: coverage.coverage_id,
      coverage_category: coverage.coverage_type,
      coverage_status: mapCoverageStatus(coverage.coverage_status),
      analyzer_status: coverage.coverage_status,
      description: coverage.description,
      source_page: coverage.source_page,
      source_document_id: coverage.source_document_id,
      confidence_label: mapConfidence(coverage.confidence_status)
    })),
    exclusions: report.exclusions.map((exclusion) => ({
      exclusion_type: exclusion.exclusion_type,
      description: exclusion.description,
      excerpt: exclusion.exact_source_excerpt,
      source_page: exclusion.source_page,
      source_document_id: exclusion.source_document_id
    })),
    requirements: report.requirements.map((requirement) => ({
      trigger: requirement.trigger,
      requirement: requirement.requirement,
      source_page: requirement.source_page,
      source_document_id: requirement.source_document_id
    })),
    conflicts: report.conflicts.map((conflict) => ({
      title: conflict.title,
      description: conflict.description
    })),
    forms: report.form_inventory.map((form) => ({
      printed_identifier: form.printed_identifier,
      normalized_identifier: form.normalized_identifier,
      edition: form.edition,
      listing_page: form.listing_page,
      inventory_status: form.status,
      match_page: form.match_page
    })),
    missing: report.completeness.warnings.map((description) => ({
      missing_type: "referenced_form_not_uploaded",
      description
    })),
    agent_questions: report.agent_questions.map((question) => ({ question })),
    report
  };
}
