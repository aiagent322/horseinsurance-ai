export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type AnalysisStatus =
  | "COVERED"
  | "COVERED WITH LIMITATIONS"
  | "LIMITED"
  | "EXCLUDED"
  | "NOT FOUND"
  | "POSSIBLE CONFLICT"
  | "DOCUMENT MISSING"
  | "NEEDS CLARIFICATION";

export type DocumentClass =
  | "Declarations"
  | "Base Policy Form"
  | "Mortality Endorsement"
  | "Major Medical Endorsement"
  | "Surgical Endorsement"
  | "Exclusion Endorsement"
  | "Loss-of-Use Endorsement"
  | "Theft Coverage"
  | "Liability Coverage"
  | "Care/Custody/Control"
  | "Commercial Equine Liability"
  | "Trainer/Instructor Liability"
  | "Renewal"
  | "Amendment"
  | "Schedule"
  | "Notice"
  | "Unknown Document";

export type Sourced<T> = {
  value: T;
  source_document_id: string;
  source_page: number;
  source_text: string;
  confidence_status: Confidence;
};

export type PageText = {
  page: number;
  text: string;
};

export type DocumentRecord = {
  document_id: string;
  session_id: string;
  original_filename: string;
  file_type: string;
  upload_timestamp: string;
  file_hash: string;
  page_count: number;
  storage_location: string;
  extraction_status: "pending" | "extracted" | "failed";
  analysis_status: "pending" | "complete" | "failed";
  classification: DocumentClass;
  pages: PageText[];
};

export type CoverageRecord = {
  coverage_id: string;
  policy_id: string;
  coverage_type: string;
  coverage_status: AnalysisStatus;
  coverage_limit?: Sourced<string>;
  deductible?: Sourced<string>;
  coinsurance?: Sourced<string>;
  reimbursement_percentage?: Sourced<string>;
  annual_limit?: Sourced<string>;
  occurrence_limit?: Sourced<string>;
  sublimit?: Sourced<string>;
  description: string;
  conditions?: string;
  source_document_id: string;
  source_page: number;
  source_text: string;
  confidence_status: Confidence;
};

export type ExclusionRecord = {
  exclusion_id: string;
  policy_id: string;
  horse_id?: string;
  exclusion_type: string;
  anatomical_area?: string;
  condition?: string;
  description: string;
  source_document_id: string;
  source_page: number;
  exact_source_excerpt: string;
  confidence_status: Confidence;
};

export type FinancialLimit = {
  id: string;
  label: string;
  amount: string;
  source_document_id: string;
  source_page: number;
  source_text: string;
};

export type RequirementRecord = {
  id: string;
  trigger: string;
  requirement: string;
  source_document_id: string;
  source_page: number;
  source_text: string;
};

export type EndorsementEffect = {
  id: string;
  original_provision: string;
  modifying_endorsement: string;
  resulting_status: AnalysisStatus | string;
  source_document_id: string;
  source_page: number;
  source_text: string;
};

export type ConflictRecord = {
  id: string;
  title: string;
  description: string;
  left: { label: string; value: string; source_page: number; source_text: string };
  right: { label: string; value: string; source_page: number; source_text: string };
};

export type CompletenessResult = {
  status: "APPEARS COMPLETE" | "DOCUMENT PACKAGE MAY BE INCOMPLETE";
  warnings: string[];
};

export type FormInventoryStatus = "PRESENT" | "MISSING" | "EDITION MISMATCH";

export type PolicyFormRecord = {
  id: string;
  printed_identifier: string;
  normalized_identifier: string;
  form_title?: string;
  edition?: string;
  listing_document_id: string;
  listing_page: number;
  listing_source_text: string;
  status: FormInventoryStatus;
  match_document_id?: string;
  match_page?: number;
  match_source_text?: string;
  match_edition?: string;
};

export type PolicyIdentification = {
  carrier_name?: Sourced<string>;
  agency_name?: Sourced<string>;
  agent_name?: Sourced<string>;
  policy_number?: Sourced<string>;
  named_insured?: Sourced<string>;
  policy_effective_date?: Sourced<string>;
  policy_expiration_date?: Sourced<string>;
  policy_type?: Sourced<string>;
  insured_horse_name?: Sourced<string>;
  registered_name?: Sourced<string>;
  breed?: Sourced<string>;
  age?: Sourced<string>;
  sex?: Sourced<string>;
  registration_number?: Sourced<string>;
  stated_use?: Sourced<string>;
  insured_value?: Sourced<string>;
  currency?: Sourced<string>;
};

export type PolicyRecord = {
  policy_id: string;
  session_id: string;
  created_at: string;
  updated_at: string;
  completeness_status: CompletenessResult["status"];
  analysis_status: "pending" | "complete" | "failed";
  identification: PolicyIdentification;
  documents: DocumentRecord[];
  coverages: CoverageRecord[];
  exclusions: ExclusionRecord[];
  financial_limits: FinancialLimit[];
  requirements: RequirementRecord[];
  endorsements: EndorsementEffect[];
  conflicts: ConflictRecord[];
  form_inventory: PolicyFormRecord[];
  completeness: CompletenessResult;
  agent_questions: string[];
  coverage_gaps: string[];
  educational_notes: string[];
};
