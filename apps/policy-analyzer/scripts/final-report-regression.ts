import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import {
  buildSourceReferenceIndex,
  collectSourceReferences,
  formatCustomerSourceReference,
  looksLikeRawPolicyFragment,
  walkPolicyClauses
} from "../lib/policy-semantics";
import { looksLikeQuotedPolicyLanguage } from "../lib/agent-questions";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";
import { EQUINE_MORTALITY_JACKET_PAGES } from "./fixtures/equine-mortality-jacket";

function docFromPages(
  pages: Array<{ page: number; text: string }>,
  filename: string
): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: filename,
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "final-report-fixture",
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
  assert.ok(rec, `missing coverage ${type}`);
  return rec;
}

function customerFacingText(report: ReturnType<typeof analyzeDocuments>): string {
  const id = report.identification;
  const display = (value?: { value: string }) => value?.value || "NOT FOUND IN DOCUMENTS PROVIDED";
  const index = buildSourceReferenceIndex(report);
  return [
    report.documents.map((doc) => `${doc.original_filename} ${doc.classification}`).join("\n"),
    report.completeness.status,
    ...report.completeness.warnings,
    display(id.carrier_name),
    display(id.policy_form),
    display(id.policy_number),
    display(id.named_insured),
    display(id.insured_horse_name),
    ...report.coverages.map((item) => `${item.coverage_type} ${item.coverage_status} ${item.description}`),
    ...report.requirements.map((item) => `${item.trigger} ${item.requirement}`),
    ...report.coverage_gaps,
    ...report.agent_questions,
    ...report.educational_notes,
    ...index.map((ref) => formatCustomerSourceReference(ref))
  ].join("\n");
}

function main() {
  const doc = docFromPages(EQUINE_MORTALITY_JACKET_PAGES, "Mortality_Policy_Jacket.pdf");
  const report = analyzeDocuments(newId(), doc.session_id, [doc]);
  const facing = customerFacingText(report);
  const index = buildSourceReferenceIndex(report);
  const evidence = collectSourceReferences(report);
  const walked = walkPolicyClauses(EQUINE_MORTALITY_JACKET_PAGES);

  assert.notEqual(doc.classification, "Declarations");
  assert.equal(doc.classification, "Base Policy Form");
  assert.equal(report.documents[0].classification, "Base Policy Form");
  assert.equal(report.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE");
  assert.ok(report.completeness.warnings.some((warning) => /no page was classified as declarations/i.test(warning)));
  assert.doesNotMatch(report.completeness.status, /appears complete/i);

  const id = report.identification;
  assert.equal(id.carrier_name?.value, "Diamond State Insurance Company");
  assert.doesNotMatch(id.carrier_name?.value || "", /hereinafter called/i);
  assert.match(id.policy_form?.value || "", /AEM 200\s*\(08\/07\)/i);
  assert.equal(id.named_insured, undefined);
  assert.equal(id.policy_number, undefined);
  assert.equal(id.insured_horse_name, undefined);
  assert.equal(id.registered_name, undefined);
  assert.equal(id.policy_effective_date, undefined);
  assert.equal(id.policy_expiration_date, undefined);
  assert.equal(id.deductible, undefined);
  assert.equal(id.insured_value, undefined);
  assert.equal(id.agency_name, undefined);
  assert.equal(id.agent_name, undefined);
  assert.equal(id.stated_use, undefined);
  const identificationValues = [
    id.carrier_name?.value,
    id.policy_form?.value,
    id.named_insured?.value,
    id.policy_number?.value,
    id.insured_horse_name?.value
  ]
    .filter(Boolean)
    .join(" | ");
  assert.doesNotMatch(identificationValues, /hereinafter|the individual, partnership|as stated in item/i);

  const mortality = coverage(report, "Full Mortality");
  const theft = coverage(report, "Theft");
  const medical = coverage(report, "Major Medical");
  const surgical = coverage(report, "Surgical");
  assert.equal(mortality.coverage_status, "LIMITED");
  assert.equal(theft.coverage_status, "LIMITED");
  assert.equal(medical.coverage_status, "NEEDS CLARIFICATION");
  assert.equal(surgical.coverage_status, "NEEDS CLARIFICATION");
  assert.equal(coverage(report, "Colic Surgery").coverage_status, "NOT FOUND");
  assert.equal(coverage(report, "Loss of Use").coverage_status, "NOT FOUND");
  assert.equal(coverage(report, "Stallion Infertility").coverage_status, "NOT FOUND");
  assert.match(mortality.description, /provides mortality coverage/i);
  assert.match(mortality.description, /Declarations\/Schedule|missing Declarations/i);
  assert.doesNotMatch(mortality.description, /will indemnify[\s\S]{80,}|hereinafter|EDULE;|\btheft\b/i);
  assert.equal(mortality.source_page, 1);
  assert.match(theft.description, /theft/i);
  assert.match(theft.description, /reporting|non-recovery|conditions/i);
  assert.doesNotMatch(theft.description, /\bexclusion\b/i);
  assert.equal(theft.source_page, 1);
  assert.match(medical.description, /possible additional coverage/i);
  assert.match(medical.description, /do not establish/i);
  assert.equal(medical.source_page, 3);
  assert.notEqual(medical.coverage_status, "COVERED");
  assert.match(surgical.description, /possible additional coverage|do not establish/i);
  assert.equal(surgical.source_page, 3);
  assert.match(coverage(report, "Loss of Use").description, /do not establish/i);

  const theftWaiting = walked.find((item) => /no liability arises[\s\S]*theft/i.test(item.clause));
  const embryoLimit = walked.find((item) => /embryo or foal/i.test(item.clause));
  assert.ok(theftWaiting);
  assert.ok(embryoLimit);
  assert.ok(theftWaiting.kind === "limitation" || theftWaiting.kind === "condition");
  assert.ok(embryoLimit.kind === "limitation" || embryoLimit.kind === "condition");
  assert.notEqual(theftWaiting.kind, "exclusion");
  assert.equal(report.exclusions.length, 12);
  assert.ok(report.exclusions.every((item) => item.source_page === 3 || item.source_page === 4));
  assert.equal(report.exclusions.filter((item) => /thirty|30\s+days|not been recovered/i.test(item.description)).length, 0);
  assert.equal(report.exclusions.filter((item) => /embryo|foal/i.test(item.description)).length, 0);

  assert.ok(report.requirements.length > 0);
  const reqBlob = report.requirements.map((item) => `${item.trigger} ${item.requirement}`).join(" ");
  for (const needle of ["veterinar", "necropsy", "telephone notice", "theft", "police", "ransom", "proof of loss", "examination under oath", "records"]) {
    assert.ok(reqBlob.toLowerCase().includes(needle), `missing duty ${needle}`);
  }
  assert.doesNotMatch(reqBlob, /will indemnify|actual cash value|sound health|sole owner|territorial limits|declared use|not been recovered|this insurance does not cover|no liability arises/i);
  assert.ok(report.requirements.every((item) => item.source_page === 2 || item.source_page === 3));

  assert.ok(index.length > 0, "source references present");
  assert.ok(index.some((item) => /policy identification/i.test(item.label)));
  assert.ok(index.some((item) => /mortality coverage/i.test(item.label) && item.pages.includes(1)));
  assert.ok(index.some((item) => /theft coverage/i.test(item.label) && item.pages.includes(1)));
  assert.ok(index.some((item) => /major medical|surgical/i.test(item.label) && item.pages.includes(3)));
  assert.ok(index.some((item) => /^exclusions$/i.test(item.label) && item.page_label === "Pages 3-4"));
  assert.ok(index.every((item) => !looksLikeRawPolicyFragment(item.label)));
  assert.ok(index.every((item) => item.evidence.some((ev) => ev.source_text.trim().length > 0)));
  assert.ok(evidence.length > 0);

  assert.match(report.coverage_gaps.join(" "), /not established/i);
  assert.doesNotMatch(report.coverage_gaps.join(" "), /coverage gap|match the horse/i);
  assert.doesNotMatch(
    report.agent_questions.join("\n"),
    /exclusion language[\s\S]{0,400}(thirty|30\s+days)|((thirty|30\s+days)[\s\S]{0,400}exclusion language)/i
  );
  assert.ok(report.agent_questions.some((question) => /missing declarations/i.test(question)));
  assert.ok(report.agent_questions.length >= 3 && report.agent_questions.length <= 5);
  assert.ok(!report.agent_questions.some((question) => /intentional destruction|please confirm the exclusion language/i.test(question)));
  assert.ok(report.agent_questions.every((question) => !looksLikeQuotedPolicyLanguage(question)));

  const excluded = analyzeDocuments(newId(), doc.session_id, [
    docFromPages(
      [{ page: 2, text: "This policy does not provide Loss of Use coverage, except as specifically endorsed." }],
      "excluded-coverage.pdf"
    )
  ]);
  const excludedLou = coverage(excluded, "Loss of Use");
  const missingLou = coverage(report, "Loss of Use");
  assert.equal(excludedLou.coverage_status, "EXCLUDED");
  assert.match(excludedLou.description, /exclud/i);
  assert.doesNotMatch(excludedLou.description, /^The uploaded documents do not establish/i);
  assert.match(missingLou.description, /do not establish/i);
  assert.doesNotMatch(missingLou.description, /exclud/i);

  assert.doesNotMatch(facing, /EDULE;|\bEDULE\b/);
  assert.doesNotMatch(facing, /hereinafter called/i);
  assert.doesNotMatch(facing, /\bsource_text\b|\bfinding_key\b|\bdocument_id\b/);
  assert.doesNotMatch(facing, /\{"policy_id"/);

  console.log("FINAL REPORT REGRESSION OK", {
    classification: doc.classification,
    completeness: report.completeness.status,
    mortality: mortality.coverage_status,
    theft: theft.coverage_status,
    medical: medical.coverage_status,
    surgical: surgical.coverage_status,
    exclusions: report.exclusions.length,
    requirements: report.requirements.length,
    source_references: index.length
  });
}

main();
