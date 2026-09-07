import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { collectSourceReferences } from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";
import { EQUINE_MORTALITY_JACKET_PAGES } from "./fixtures/equine-mortality-jacket";

function docFromPages(pages: Array<{ page: number; text: string }>, filename = "policy-form.pdf"): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: filename,
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "fixture-text",
    page_count: pages.length,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: classifyPackage(pages),
    pages
  };
}

function coverage(report: ReturnType<typeof analyzeDocuments>, type: string) {
  const rec = report.coverages.find((item) => item.coverage_type === type);
  assert.ok(rec, `missing coverage row ${type}`);
  return rec;
}

function main() {
  const doc = docFromPages(EQUINE_MORTALITY_JACKET_PAGES);
  const report = analyzeDocuments(newId(), doc.session_id, [doc]);
  const refs = collectSourceReferences(report);

  assert.notEqual(doc.classification, "Declarations");
  assert.equal(doc.classification, "Base Policy Form");
  assert.equal(report.documents[0].classification, "Base Policy Form");
  assert.ok(report.completeness.warnings.some((warning) => /no page was classified as declarations/i.test(warning)));

  assert.match(report.identification.carrier_name?.value || "", /Diamond State Insurance Company/i);
  assert.match(report.identification.policy_form?.value || "", /AEM 200\s*\(08\/07\)/i);
  assert.equal(report.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE");
  assert.equal(report.identification.named_insured, undefined);
  assert.equal(report.identification.policy_number, undefined);
  assert.equal(report.identification.insured_horse_name, undefined);
  assert.equal(report.identification.policy_effective_date, undefined);
  assert.equal(report.identification.policy_expiration_date, undefined);
  assert.equal(report.identification.deductible, undefined);
  assert.equal(report.identification.insured_value, undefined);

  const mortality = coverage(report, "Full Mortality");
  assert.notEqual(mortality.coverage_status, "NOT FOUND");
  assert.ok(
    mortality.coverage_status === "LIMITED" ||
      mortality.coverage_status === "COVERED WITH LIMITATIONS" ||
      mortality.coverage_status === "COVERED",
    `mortality status ${mortality.coverage_status}`
  );
  assert.equal(mortality.source_page, 1);
  assert.match(mortality.source_text, /indemnify|death/i);

  const theft = coverage(report, "Theft");
  assert.notEqual(theft.coverage_status, "NOT FOUND");
  assert.ok(
    theft.coverage_status === "LIMITED" ||
      theft.coverage_status === "COVERED WITH LIMITATIONS" ||
      theft.coverage_status === "COVERED",
    `theft status ${theft.coverage_status}`
  );
  assert.equal(theft.source_page, 1);
  assert.match(theft.source_text, /theft/i);

  const medical = coverage(report, "Major Medical");
  assert.notEqual(medical.coverage_status, "COVERED");
  assert.ok(
    medical.coverage_status === "NEEDS CLARIFICATION" || medical.coverage_status === "NOT FOUND",
    `major medical ${medical.coverage_status}`
  );
  assert.match(medical.description, /possible additional coverage|NOT FOUND IN DOCUMENTS PROVIDED/i);
  assert.doesNotMatch(medical.description, /additional coverages such as equine$/i);

  const surgical = coverage(report, "Surgical");
  assert.notEqual(surgical.coverage_status, "COVERED");
  assert.ok(
    surgical.coverage_status === "NEEDS CLARIFICATION" || surgical.coverage_status === "NOT FOUND",
    `surgical ${surgical.coverage_status}`
  );

  assert.equal(coverage(report, "Colic Surgery").coverage_status, "NOT FOUND");
  assert.equal(coverage(report, "Loss of Use").coverage_status, "NOT FOUND");
  assert.match(report.coverage_gaps.join(" "), /not established/i);
  assert.doesNotMatch(report.coverage_gaps.join(" "), /should necessarily|ask the agent whether a separate endorsement is available or intended/i);

  assert.ok(report.exclusions.length > 0, "exclusions must be present");
  const exclusionBlob = report.exclusions.map((item) => `${item.exclusion_type} ${item.description}`).join(" ").toLowerCase();
  for (const needle of [
    "intentional destruction",
    "contagious",
    "surgical",
    "medication",
    "malicious",
    "proper care",
    "nuclear",
    "confiscation",
    "war",
    "mysterious disappearance",
    "voluntary parting",
    "consequential loss"
  ]) {
    assert.ok(exclusionBlob.includes(needle), `missing exclusion category ${needle}`);
  }
  assert.ok(
    report.exclusions.some((item) => item.source_page === 3 || item.source_page === 4),
    "exclusion citation must include page 3 or 4"
  );

  assert.ok(report.requirements.length > 0, "claim duties must be present");
  const reqBlob = report.requirements.map((item) => item.requirement).join(" ").toLowerCase();
  for (const needle of [
    "veterinary",
    "necropsy",
    "notice",
    "theft",
    "police",
    "ransom",
    "proof of loss"
  ]) {
    assert.ok(reqBlob.includes(needle), `missing duty ${needle}`);
  }

  assert.ok(refs.length > 0, "source references must be nonempty");
  assert.ok(refs.some((item) => item.label === "Full Mortality" && item.page === 1));
  assert.ok(refs.some((item) => item.label === "Theft" && item.page === 1));

  console.log("REAL POLICY SEMANTIC REGRESSION OK", {
    carrier: report.identification.carrier_name?.value,
    form: report.identification.policy_form?.value,
    completeness: report.completeness.status,
    mortality: mortality.coverage_status,
    theft: theft.coverage_status,
    medical: medical.coverage_status,
    surgical: surgical.coverage_status,
    exclusions: report.exclusions.length,
    requirements: report.requirements.length,
    source_references: refs.length
  });
}

main();
