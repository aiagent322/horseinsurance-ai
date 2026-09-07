import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { collectSourceReferences, walkPolicyClauses } from "../lib/policy-semantics";
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
  assert.equal(report.identification.carrier_name?.value, "Diamond State Insurance Company");
  assert.doesNotMatch(report.identification.carrier_name?.value || "", /hereinafter/i);
  assert.equal(report.identification.carrier_name?.source_page, 1);
  assert.match(report.identification.policy_form?.value || "", /AEM 200\s*\(08\/07\)/i);
  assert.doesNotMatch(report.identification.policy_form?.value || "", /hereinafter/i);
  assert.equal(report.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE");
  assert.equal(report.identification.named_insured, undefined);
  assert.equal(report.identification.policy_number, undefined);
  assert.equal(report.identification.insured_horse_name, undefined);
  assert.equal(report.identification.policy_effective_date, undefined);
  assert.equal(report.identification.policy_expiration_date, undefined);
  assert.equal(report.identification.deductible, undefined);
  assert.equal(report.identification.insured_value, undefined);
  assert.equal(report.identification.agency_name, undefined);
  assert.equal(report.identification.agent_name, undefined);
  assert.equal(report.identification.registered_name, undefined);
  assert.equal(report.identification.stated_use, undefined);
  assert.equal(report.identification.breed, undefined);
  const identificationValues = [
    report.identification.carrier_name?.value,
    report.identification.policy_form?.value,
    report.identification.named_insured?.value,
    report.identification.policy_number?.value,
    report.identification.insured_horse_name?.value,
    report.identification.policy_effective_date?.value,
    report.identification.policy_expiration_date?.value,
    report.identification.deductible?.value,
    report.identification.insured_value?.value,
    report.identification.agency_name?.value,
    report.identification.agent_name?.value,
    report.identification.registered_name?.value,
    report.identification.stated_use?.value,
    report.identification.breed?.value
  ]
    .filter(Boolean)
    .join(" | ");
  assert.doesNotMatch(identificationValues, /hereinafter/i);

  const mortality = coverage(report, "Full Mortality");
  assert.equal(mortality.coverage_status, "LIMITED");
  assert.equal(mortality.source_page, 1);
  assert.match(mortality.description, /provides mortality coverage/i);
  assert.match(mortality.description, /Declarations\/Schedule|missing Declarations/i);
  assert.match(mortality.description, /insured horse|liability limit|deductible/i);
  assert.doesNotMatch(mortality.description, /hereinafter|EDULE;|No insured value found/i);
  assert.doesNotMatch(mortality.description, /\btheft\b/i);
  assert.ok(!/will indemnify[\s\S]{80,}/i.test(mortality.description), "mortality explanation must not dump the grant clause");

  const theft = coverage(report, "Theft");
  assert.equal(theft.coverage_status, "LIMITED");
  assert.equal(theft.source_page, 1);
  assert.match(theft.description, /theft/i);
  assert.match(theft.description, /Declarations\/Schedule|missing Declarations/i);
  assert.match(theft.description, /reporting|non-recovery|conditions/i);
  assert.doesNotMatch(theft.description, /\bexclusion\b/i);
  assert.doesNotMatch(theft.description, /illness or disease|hereinafter|EDULE;/i);

  const medical = coverage(report, "Major Medical");
  assert.equal(medical.coverage_status, "NEEDS CLARIFICATION");
  assert.equal(medical.source_page, 3);
  assert.match(medical.description, /possible additional coverage/i);
  assert.match(medical.description, /Schedule or an endorsement/i);
  assert.match(medical.description, /do not establish/i);
  assert.doesNotMatch(medical.description, /additional coverages such as equine$/i);

  const surgical = coverage(report, "Surgical");
  assert.equal(surgical.coverage_status, "NEEDS CLARIFICATION");
  assert.equal(surgical.source_page, 3);
  assert.match(surgical.description, /possible additional coverage|do not establish/i);
  assert.doesNotMatch(surgical.description, /surgical operations/i);

  const lou = coverage(report, "Loss of Use");
  assert.equal(lou.coverage_status, "NOT FOUND");
  assert.match(lou.description, /do not establish Loss of Use coverage/i);
  assert.doesNotMatch(lou.description, /excluded|should have been purchased/i);

  assert.equal(coverage(report, "Colic Surgery").coverage_status, "NOT FOUND");
  assert.match(report.coverage_gaps.join(" "), /not established/i);
  assert.doesNotMatch(report.coverage_gaps.join(" "), /should necessarily|ask the agent whether a separate endorsement is available or intended/i);

  const walked = walkPolicyClauses(EQUINE_MORTALITY_JACKET_PAGES);
  const theftWaiting = walked.find((item) => /no liability arises[\s\S]*theft/i.test(item.clause));
  const embryoLimit = walked.find((item) => /embryo or foal/i.test(item.clause));
  assert.ok(theftWaiting, "30-day theft provision must be walked");
  assert.ok(embryoLimit, "embryo/foal provision must be walked");
  assert.equal(theftWaiting.section, "conditions");
  assert.equal(embryoLimit.section, "conditions");
  assert.ok(
    theftWaiting.kind === "limitation" || theftWaiting.kind === "condition",
    `30-day theft kind ${theftWaiting.kind}`
  );
  assert.ok(
    embryoLimit.kind === "limitation" || embryoLimit.kind === "condition",
    `embryo/foal kind ${embryoLimit.kind}`
  );
  assert.notEqual(theftWaiting.kind, "exclusion");
  assert.notEqual(embryoLimit.kind, "exclusion");
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
  assert.ok(
    report.exclusions.every((item) => item.source_page === 3 || item.source_page === 4),
    "true exclusions should be cited from the exclusion section pages"
  );
  assert.equal(
    report.exclusions.filter((item) => /thirty|30\s+days|not been recovered/i.test(item.description)).length,
    0,
    "30-day theft waiting/non-recovery condition must not appear as an exclusion"
  );
  assert.equal(
    report.exclusions.filter((item) => /embryo|foal/i.test(item.description)).length,
    0,
    "embryo/foal limitation must not appear as a Part IV exclusion"
  );
  assert.doesNotMatch(
    report.agent_questions.join("\n"),
    /exclusion language[\s\S]{0,400}(thirty|30\s+days|theft until)|((thirty|30\s+days)[\s\S]{0,400}exclusion language)/i
  );
  const exclusionRefs = refs.filter((item) => /^Exclusion:/i.test(item.label));
  assert.ok(exclusionRefs.length > 0, "exclusion source references must exist");
  assert.ok(
    exclusionRefs.every((item) => item.page === 3 || item.page === 4),
    "exclusion citations must remain on the exclusion-section pages"
  );
  assert.equal(
    exclusionRefs.filter((item) => /thirty|30\s+days|embryo|foal/i.test(item.text)).length,
    0,
    "source references must not cite the theft waiting condition or embryo limitation as exclusions"
  );

  assert.ok(report.requirements.length > 0, "Emergency / Claim Requirements must be present");
  const reqBlob = report.requirements.map((item) => `${item.trigger} ${item.requirement}`).join(" ").toLowerCase();
  for (const needle of [
    "veterinar",
    "necropsy",
    "telephone notice",
    "theft",
    "police",
    "ransom",
    "proof of loss",
    "60 days",
    "examination under oath",
    "records"
  ]) {
    assert.ok(reqBlob.includes(needle), `missing duty ${needle}`);
  }
  assert.match(reqBlob, /law.?enforcement|police/);
  assert.doesNotMatch(reqBlob, /will indemnify/);
  assert.doesNotMatch(reqBlob, /actual cash value/);
  assert.doesNotMatch(reqBlob, /sound health/);
  assert.doesNotMatch(reqBlob, /sole owner/);
  assert.doesNotMatch(reqBlob, /territorial limits/);
  assert.doesNotMatch(reqBlob, /declared use/);
  assert.doesNotMatch(reqBlob, /not been recovered/);
  assert.doesNotMatch(reqBlob, /this insurance does not cover/);
  assert.doesNotMatch(reqBlob, /no liability arises/);
  assert.ok(
    report.requirements.every((item) => item.source_page === 2 || item.source_page === 3),
    "requirement citations must be on the duty pages"
  );
  const reqBy = (needle: RegExp) => report.requirements.find((item) => needle.test(`${item.trigger} ${item.requirement}`));
  assert.equal(reqBy(/veterinar/i)?.source_page, 2);
  assert.equal(reqBy(/necropsy/i)?.source_page, 2);
  assert.equal(reqBy(/telephone notice/i)?.source_page, 2);
  assert.equal(reqBy(/theft or disappearance/i)?.source_page, 2);
  assert.equal(reqBy(/police|law.?enforcement/i)?.source_page, 2);
  assert.equal(reqBy(/ransom/i)?.source_page, 2);
  assert.ok(reqBy(/proof of loss/i)?.source_page === 2 || reqBy(/proof of loss/i)?.source_page === 3);
  assert.ok(reqBy(/examination under oath/i)?.source_page === 2 || reqBy(/examination under oath/i)?.source_page === 3);
  assert.equal(reqBy(/records|documents|receipts/i)?.source_page, 3);
  assert.ok(
    report.agent_questions.some((question) => /item g of the declarations/i.test(question) && /missing declarations/i.test(question)),
    "missing Declarations notice-contact question must be accurate"
  );
  assert.ok(!report.agent_questions.some((question) => /mortality coverage language/i.test(question)));

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
