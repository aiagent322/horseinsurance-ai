import { z } from "zod";

export const REAL_POLICY_CATALOG_VERSION = "real-policy-validation-v1";
export const QUALITY_CORPUS_DIR = "quality/fixtures";

export const DISCREPANCY_TYPES = [
  "none",
  "coverage_status",
  "citation",
  "limit",
  "deductible",
  "exclusion",
  "form_inventory",
  "conflict",
  "identity",
  "completeness",
  "job_outcome",
  "other"
] as const;

export const SEVERITIES = ["none", "low", "medium", "high", "critical"] as const;

export const PDF_KINDS = ["native", "scanned", "mixed"] as const;
export const OCR_QUALITY = ["good", "noisy", "poor", "unreadable", "not_applicable"] as const;

const citationSchema = z.object({
  document_id: z.string().min(1),
  page: z.number().int().positive()
});

export const realPolicyHumanReviewSchema = z.object({
  named_insured: z.string().nullable(),
  policy_number: z.string().nullable(),
  declarations_present: z.boolean(),
  coverage_grants: z.array(
    z.object({
      coverage: z.string().min(1),
      status: z.string().min(1),
      citation: citationSchema.nullable()
    })
  ),
  exclusions: z.array(z.string()),
  endorsements: z.array(z.string()),
  limits: z.array(z.object({ label: z.string(), amount: z.string(), citation: citationSchema.nullable() })),
  deductibles: z.array(z.object({ label: z.string(), amount: z.string(), citation: citationSchema.nullable() })),
  scheduled_forms: z.array(z.object({ identifier: z.string(), edition: z.string().nullable(), status: z.string() })),
  missing_forms: z.array(z.string()),
  conflicts: z.array(z.object({ kind: z.string(), description: z.string() })),
  required_citations: z.array(citationSchema),
  notes: z.string()
});

export const realPolicyAnalyzerResultSchema = z.object({
  job_status: z.enum(["completed", "needs_review", "failed", "cancelled", "queued", "processing"]),
  published: z.boolean(),
  coverages: z.array(z.object({ coverage: z.string(), status: z.string() })),
  findings_cited: z.number().int().nonnegative(),
  notes: z.string().optional()
});

export const realPolicyRecordSchema = z.object({
  validation_id: z.string().min(1),
  catalog_version: z.literal(REAL_POLICY_CATALOG_VERSION),
  rights: z.enum(["carrier_specimen", "owned_by_wmn", "permissioned_sample", "deliberately_redacted"]),
  carrier: z.string().min(1),
  policy_type: z.string().min(1),
  form_type: z.string().min(1),
  document_count: z.number().int().positive(),
  page_count: z.number().int().positive(),
  pdf_kind: z.enum(PDF_KINDS),
  ocr_quality: z.enum(OCR_QUALITY),
  source_path: z.string().min(1),
  human_reviewed: z.boolean(),
  human_reviewer: z.string().min(1),
  human_reviewed_result: realPolicyHumanReviewSchema,
  analyzer_result: realPolicyAnalyzerResultSchema.nullable(),
  discrepancy_type: z.enum(DISCREPANCY_TYPES),
  severity: z.enum(SEVERITIES),
  reviewer_notes: z.string()
});

export const realPolicyCatalogSchema = z.object({
  catalog_version: z.literal(REAL_POLICY_CATALOG_VERSION),
  description: z.string().min(1),
  records: z.array(z.string().min(1))
});

export type RealPolicyRecord = z.infer<typeof realPolicyRecordSchema>;
export type RealPolicyCatalog = z.infer<typeof realPolicyCatalogSchema>;
