import { newId } from "../lib/ids";
import type { PolicyRecord } from "../lib/types";
import type { IncomingPdf } from "../lib/validate-upload";

export function tinyPdf(tag: string): Buffer {
  return Buffer.from(`%PDF-1.4\n%\xE2\xE3\xCF\xD3\n${tag}\n%%EOF\n`);
}

export function sampleReport(overrides: Partial<PolicyRecord> = {}): PolicyRecord {
  const policyId = overrides.policy_id || newId();
  const sessionId = overrides.session_id || newId();
  const documentId = overrides.documents?.[0]?.document_id || newId();
  return {
    policy_id: policyId,
    session_id: sessionId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completeness_status: "APPEARS COMPLETE",
    analysis_status: "complete",
    identification: {},
    documents: [
      {
        document_id: documentId,
        session_id: sessionId,
        original_filename: "policy.pdf",
        file_type: "application/pdf",
        upload_timestamp: new Date().toISOString(),
        file_hash: "abc",
        page_count: 1,
        storage_location: "",
        extraction_status: "extracted",
        analysis_status: "complete",
        classification: "Declarations",
        pages: [
          {
            page: 1,
            text: "Declarations page",
            extraction_method: "NATIVE_TEXT",
            quality_status: "GOOD"
          }
        ]
      }
    ],
    coverages: [],
    exclusions: [],
    financial_limits: [],
    requirements: [],
    endorsements: [],
    conflicts: [],
    form_inventory: [],
    completeness: { status: "APPEARS COMPLETE", warnings: [] },
    agent_questions: [],
    coverage_gaps: [],
    educational_notes: [],
    ...overrides
  };
}

export function sampleFiles(report: PolicyRecord, tag = "one"): IncomingPdf[] {
  return report.documents.map((doc, index) => ({
    filename: doc.original_filename,
    bytes: tinyPdf(`${tag}-${index}`)
  }));
}
