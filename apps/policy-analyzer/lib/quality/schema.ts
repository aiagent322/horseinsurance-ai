import { z } from "zod";
import type { AnalysisStatus, FormInventoryStatus } from "@/lib/types";

export const CORPUS_VERSION = "quality-corpus-v1";

export const SUPPORTED_COVERAGES = [
  "Full Mortality",
  "Major Medical",
  "Surgical",
  "Colic Surgery",
  "Loss of Use",
  "Stallion Infertility",
  "Theft"
] as const;

export type SupportedCoverage = (typeof SUPPORTED_COVERAGES)[number];

export const ANALYSIS_STATUSES = [
  "COVERED",
  "COVERED WITH LIMITATIONS",
  "LIMITED",
  "EXCLUDED",
  "NOT FOUND",
  "POSSIBLE CONFLICT",
  "DOCUMENT MISSING",
  "NEEDS CLARIFICATION"
] as const satisfies readonly AnalysisStatus[];

export const FORM_STATUSES = ["PRESENT", "MISSING", "EDITION MISMATCH"] as const satisfies readonly FormInventoryStatus[];

export const GRANTING_STATUSES = new Set<AnalysisStatus>([
  "COVERED",
  "COVERED WITH LIMITATIONS",
  "LIMITED"
]);

export const DENYING_STATUSES = new Set<AnalysisStatus>(["EXCLUDED"]);

const citationSchema = z.object({
  document_id: z.string().min(1),
  page: z.number().int().positive()
});

const coverageExpectationSchema = z.object({
  status: z.enum(ANALYSIS_STATUSES),
  limit: z.string().nullable().optional(),
  deductible: z.string().nullable().optional(),
  citation: citationSchema.nullable(),
  acceptable_statuses: z.array(z.enum(ANALYSIS_STATUSES)).optional(),
  acceptable_needs_review: z.boolean().optional()
});

export const groundTruthFixtureSchema = z.object({
  package_id: z.string().min(1),
  title: z.string().min(1),
  scenario: z.string().min(1),
  corpus_version: z.literal(CORPUS_VERSION),
  notes: z.string().min(1),
  evaluation_scope: z.enum(["analysis", "job", "both"]),
  documents: z
    .array(
      z.object({
        document_id: z.string().min(1),
        filename: z.string().min(1),
        extraction_status: z
          .enum(["pending", "extracted", "partial", "ocr_required", "failed"])
          .optional(),
        pages: z
          .array(
            z.object({
              page: z.number().int().positive(),
              text: z.string(),
              extraction_method: z.enum(["NATIVE_TEXT", "OCR"]).optional(),
              quality_status: z.enum(["GOOD", "LOW", "UNREADABLE"]).optional(),
              character_count: z.number().int().optional()
            })
          )
          .min(1)
      })
    )
    .min(1),
  expected: z.object({
    declarations: z.object({
      present: z.boolean(),
      named_insured: z.string().nullable(),
      policy_number: z.string().nullable(),
      carrier_name: z.string().nullable().optional(),
      insured_horse_name: z.string().nullable().optional(),
      insured_value: z.string().nullable().optional()
    }),
    coverages: z.record(z.string(), coverageExpectationSchema),
    limits: z
      .array(
        z.object({
          label_contains: z.string().min(1),
          amount: z.string().min(1),
          citation: citationSchema
        })
      )
      .default([]),
    exclusions: z
      .array(
        z.object({
          condition_contains: z.string().min(1),
          citation: citationSchema
        })
      )
      .default([]),
    requirements: z
      .array(
        z.object({
          requirement_contains: z.string().min(1),
          citation: citationSchema
        })
      )
      .default([]),
    conflicts: z
      .array(
        z.object({
          kind: z.string().min(1),
          description_contains: z.string().optional()
        })
      )
      .default([]),
    forms: z
      .array(
        z.object({
          printed_identifier: z.string().min(1),
          edition: z.string().optional(),
          status: z.enum(FORM_STATUSES)
        })
      )
      .default([]),
    completeness: z.enum(["APPEARS COMPLETE", "DOCUMENT PACKAGE MAY BE INCOMPLETE"]),
    citations: z.object({
      required: z.array(
        z.object({
          subject: z.string().min(1),
          document_id: z.string().min(1),
          page: z.number().int().positive()
        })
      )
    }),
    acceptable_needs_review: z.boolean(),
    critical_errors: z.array(z.string()).default([])
  }),
  job: z.object({
    expected_state: z.enum(["completed", "needs_review", "failed", "cancelled", "processing"]),
    publishable: z.boolean(),
    mode: z.enum(["analyze", "cancelled", "incomplete"]),
    scenarios: z
      .array(
        z.object({
          id: z.string().min(1),
          expected_state: z.enum(["completed", "needs_review", "failed", "cancelled", "processing"]),
          publishable: z.boolean()
        })
      )
      .optional()
  })
});

export type GroundTruthFixture = z.infer<typeof groundTruthFixtureSchema>;
export type CoverageExpectation = z.infer<typeof coverageExpectationSchema>;
export type CitationRef = z.infer<typeof citationSchema>;

export const qualityThresholdsSchema = z.object({
  coverage_status_accuracy_min: z.number().min(0).max(1),
  precision_by_status_min: z.record(z.string(), z.number().min(0).max(1)).default({}),
  recall_by_status_min: z.record(z.string(), z.number().min(0).max(1)).default({}),
  f1_by_status_min: z.record(z.string(), z.number().min(0).max(1)).default({}),
  false_covered_max: z.number().int().min(0),
  false_excluded_max: z.number().int().min(0),
  conflict_detection_recall_min: z.number().min(0).max(1),
  limit_value_accuracy_min: z.number().min(0).max(1),
  exclusion_recall_min: z.number().min(0).max(1),
  form_presence_accuracy_min: z.number().min(0).max(1),
  edition_mismatch_recall_min: z.number().min(0).max(1),
  completeness_accuracy_min: z.number().min(0).max(1),
  citation_document_accuracy_min: z.number().min(0).max(1),
  citation_page_accuracy_min: z.number().min(0).max(1),
  unsupported_uncited_max: z.number().int().min(0),
  critical_error_max: z.number().int().min(0)
});

export type QualityThresholds = z.infer<typeof qualityThresholdsSchema>;

export function assertSupportedCoverages(fixture: GroundTruthFixture): void {
  for (const name of SUPPORTED_COVERAGES) {
    if (!fixture.expected.coverages[name]) {
      throw new Error(`${fixture.package_id}: missing expected coverage ${name}`);
    }
  }
}
