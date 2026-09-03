import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { buildFixturePdf } from "../lib/build-fixture";
import { classifyPackage } from "../lib/classify";
import { extractPdfPages } from "../lib/extract-pdf";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";

async function main() {
  const pdf = await buildFixturePdf();
  assert.ok(pdf.slice(0, 5).toString() === "%PDF-");
  const extracted = await extractPdfPages(pdf);
  assert.equal(extracted.page_count, 4, "fixture must be 4 pages");
  assert.ok(extracted.pages.every((p) => p.text.length > 40), "each page must have text");

  const doc: DocumentRecord = {
    document_id: newId(),
    session_id: newId(),
    original_filename: "fixture.pdf",
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "test",
    page_count: extracted.page_count,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: classifyPackage(extracted.pages),
    pages: extracted.pages
  };

  const policyId = newId();
  const report = analyzeDocuments(policyId, doc.session_id, [doc]);

  assert.equal(report.identification.policy_number?.value, "EQ-2026-44119");
  assert.equal(report.identification.named_insured?.value, "Jordan Hale");
  assert.equal(report.identification.insured_horse_name?.value, "Lucky Penny");
  assert.ok(report.identification.policy_number?.source_page === 1);

  const mort = report.coverages.find((c) => c.coverage_type === "Full Mortality");
  assert.ok(mort);
  assert.equal(mort.coverage_status, "COVERED");
  assert.ok(mort.coverage_limit?.value.includes("45,000"));

  const med = report.coverages.find((c) => c.coverage_type === "Major Medical");
  assert.ok(med);
  assert.ok(med.coverage_status !== "NOT FOUND");

  const medicalAmounts = report.financial_limits
    .filter((f) => f.label === "Major Medical limit")
    .map((f) => f.amount);
  assert.ok(medicalAmounts.includes("$15,000"), "declarations medical limit");
  assert.ok(medicalAmounts.includes("$10,000"), "endorsement medical limit");
  assert.ok(!medicalAmounts.includes("$45,000"), "must not treat mortality value as a medical limit");
  assert.ok(!medicalAmounts.includes("$500"), "must not treat deductible as a medical limit");

  assert.ok(report.exclusions.some((e) => /this endorsement excludes coverage for the left front fetlock/i.test(e.description)));
  assert.ok(report.exclusions.some((e) => /pre-existing condition/i.test(e.description)));
  assert.ok(report.exclusions.length <= 4, "must not duplicate the same exclusion for every line");
  assert.ok(report.exclusions.every((e) => e.source_page > 0 && e.exact_source_excerpt));

  assert.ok(report.conflicts.length >= 1, "15k vs 10k medical must conflict");
  const conflictText = report.conflicts.map((c) => c.left.value + c.right.value).join(" ");
  assert.ok(conflictText.includes("15,000") && conflictText.includes("10,000"));
  assert.match(report.identification.carrier_name?.value || "", /great plains/i);
  assert.ok(report.endorsements.length >= 1);

  const invented = report.coverages.find(
    (c) => c.coverage_type === "Trainer/Instructor Liability" && c.coverage_status === "COVERED"
  );
  assert.ok(!invented, "must not invent trainer liability");

  const lou = report.coverages.find((c) => c.coverage_type === "Loss of Use");
  assert.ok(lou);
  assert.equal(lou.coverage_status, "NOT FOUND");

  assert.ok(report.requirements.length >= 1);
  assert.ok(report.agent_questions.length >= 1);
  assert.ok(report.endorsements.length >= 1);

  console.log("ACCEPTANCE OK", {
    pages: extracted.page_count,
    policy: report.identification.policy_number?.value,
    coverages: report.coverages.map((c) => c.coverage_type + ":" + c.coverage_status),
    exclusions: report.exclusions.length,
    conflicts: report.conflicts.length,
    limits: report.financial_limits.map((f) => f.label + "=" + f.amount),
    requirements: report.requirements.length
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
