/**
 * Real-policy validation harness. Separate from the frozen synthetic quality corpus.
 * Does not load quality/fixtures and does not treat analyzer output as ground truth.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REAL_POLICY_CATALOG_VERSION } from "../lib/validation/real-policy-schema";
import {
  assertAllowedSourcePath,
  compareRealPolicy,
  loadRealPolicyRecord,
  runRealPolicyHarness
} from "../lib/validation/real-policy-harness";

const VALIDATION_ROOT = path.resolve(process.cwd(), "validation/real-policies");

function sampleRecord(overrides: Record<string, unknown> = {}) {
  return {
    validation_id: "rp-harness-01",
    catalog_version: REAL_POLICY_CATALOG_VERSION,
    rights: "carrier_specimen",
    carrier: "Educational Specimen Carrier",
    policy_type: "equine mortality and medical",
    form_type: "specimen declarations + base form",
    document_count: 2,
    page_count: 6,
    pdf_kind: "native",
    ocr_quality: "not_applicable",
    source_path: "validation/real-policies/specimens/rp-harness-01.pdf",
    human_reviewed: true,
    human_reviewer: "Western Media Network reviewer",
    human_reviewed_result: {
      named_insured: "Specimen Farm",
      policy_number: "SPEC-001",
      declarations_present: true,
      coverage_grants: [{ coverage: "Full Mortality", status: "COVERED", citation: { document_id: "dec", page: 1 } }],
      exclusions: [],
      endorsements: [],
      limits: [{ label: "Mortality insured value", amount: "$10,000", citation: { document_id: "dec", page: 1 } }],
      deductibles: [],
      scheduled_forms: [{ identifier: "EQ-BASE-100", edition: "01 24", status: "PRESENT" }],
      missing_forms: [],
      conflicts: [],
      required_citations: [{ document_id: "dec", page: 1 }],
      notes: "Hand-authored specimen review."
    },
    analyzer_result: {
      job_status: "completed",
      published: true,
      coverages: [{ coverage: "Full Mortality", status: "COVERED" }],
      findings_cited: 1
    },
    discrepancy_type: "none",
    severity: "none",
    reviewer_notes: "Harness self-test record. Not a customer policy.",
    ...overrides
  };
}

function main(): void {
  assert.throws(() => assertAllowedSourcePath("quality/fixtures/01-clear-affirmative.json"), /FORBIDDEN/);
  assert.throws(() => assertAllowedSourcePath("../quality/fixtures/x"), /TRAVERSAL|FORBIDDEN/);
  assert.throws(() => assertAllowedSourcePath("uploads/customer/policy.pdf"), /FORBIDDEN/);
  assertAllowedSourcePath("validation/real-policies/specimens/example.pdf");

  const catalog = runRealPolicyHarness(VALIDATION_ROOT);
  assert.equal(catalog.ok, true, catalog.errors.join("; "));
  assert.equal(catalog.records, 0, "The live catalog must start empty. Do not add customer policies.");

  const dir = mkdtempSync(path.join(tmpdir(), "real-policy-"));
  const recordsDir = path.join(dir, "records");
  mkdirSync(recordsDir, { recursive: true });
  writeFileSync(
    path.join(dir, "catalog.json"),
    JSON.stringify({
      catalog_version: REAL_POLICY_CATALOG_VERSION,
      description: "temporary harness",
      records: ["rp-harness-01"]
    })
  );
  const okFile = path.join(recordsDir, "rp-harness-01.json");
  writeFileSync(okFile, JSON.stringify(sampleRecord(), null, 2));
  const ok = runRealPolicyHarness(dir);
  assert.equal(ok.ok, true, ok.errors.join("; "));
  assert.equal(ok.humanReviewed, 1);

  writeFileSync(
    okFile,
    JSON.stringify(
      sampleRecord({
        analyzer_result: { job_status: "cancelled", published: true, coverages: [], findings_cited: 0 },
        discrepancy_type: "job_outcome",
        severity: "critical"
      }),
      null,
      2
    )
  );
  const published = compareRealPolicy(loadRealPolicyRecord(okFile));
  assert.ok(published.some((item) => item.includes("published")));

  writeFileSync(
    okFile,
    JSON.stringify(sampleRecord({ source_path: "quality/fixtures/01-clear-affirmative.json" }), null, 2)
  );
  assert.throws(() => loadRealPolicyRecord(okFile), /FORBIDDEN/);

  writeFileSync(
    okFile,
    JSON.stringify(sampleRecord({ human_reviewed: false, human_reviewer: "pending" }), null, 2)
  );
  assert.throws(() => loadRealPolicyRecord(okFile), /NOT_HUMAN_REVIEWED/);

  writeFileSync(
    okFile,
    JSON.stringify(sampleRecord({ human_reviewer: "copied from analyzer" }), null, 2)
  );
  assert.throws(() => loadRealPolicyRecord(okFile), /ANALYZER_CANNOT_AUTHOR_TRUTH/);

  rmSync(dir, { recursive: true, force: true });
  console.log("REAL POLICY VALIDATION OK");
  console.log(`catalog_records=${catalog.records}`);
}

main();
