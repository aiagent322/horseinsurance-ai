import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocuments } from "../lib/analyze";
import { looksLikeQuotedPolicyLanguage } from "../lib/agent-questions";
import { classifyPackage } from "../lib/classify";
import {
  buildSourceReferenceIndex,
  collectSourceReferences,
  formatCustomerSourceReference,
  formatPageLocator,
  looksLikeRawClaimDutySummary,
  looksLikeRawExclusionExplanation,
  looksLikeRawPolicyFragment
} from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord, PolicyRecord } from "../lib/types";
import { NATIVE_POLICY_REPORT_PAGES } from "./fixtures/native-policy-report-pages";

const REQUIRED_EXCLUSIONS = [
  { needle: /intentional destruction/i, label: "Intentional Destruction" },
  { needle: /contagious|communicable disease/i, label: "Contagious / Communicable Disease" },
  { needle: /surgical operation/i, label: "Surgical Operations" },
  { needle: /medication|substance/i, label: "Medication / Substance" },
  { needle: /malicious|willful|intentional act/i, label: "Malicious / Willful / Intentional Acts" },
  { needle: /proper care/i, label: "Failure to Provide Proper Care" },
  { needle: /nuclear/i, label: "Nuclear Risk" },
  { needle: /confiscation/i, label: "Confiscation" },
  { needle: /war|military force/i, label: "War / Military Force" },
  { needle: /mysterious disappearance|escape/i, label: "Mysterious Disappearance / Escape" },
  { needle: /fraudulent|voluntary parting/i, label: "Fraudulent Voluntary Parting" },
  { needle: /consequential loss/i, label: "Consequential Loss" }
];

function docFromPages(pages: Array<{ page: number; text: string }>): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: "native-extracted-policy.pdf",
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "native-report-parity",
    page_count: pages.length,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: classifyPackage(pages),
    pages
  };
}

function coverage(report: PolicyRecord, type: string) {
  const rec = report.coverages.find((item) => item.coverage_type === type);
  assert.ok(rec, `missing coverage ${type}`);
  return rec;
}

function cite(field?: { value: string }): string {
  return field?.value || "NOT FOUND IN DOCUMENTS PROVIDED";
}

function attachedBlob(report: PolicyRecord, needle: RegExp, kind?: string): string {
  const row = report.exclusions.find((item) => needle.test(`${item.exclusion_type} ${item.description}`));
  return (row?.attachments || [])
    .filter((item) => (kind ? item.kind === kind : true))
    .map((item) => `${item.kind} ${item.explanation}`)
    .join("\n");
}

/**
 * Assembles the exact customer-visible strings consumed by components/report-view.tsx.
 * Intentionally omits raw excerpts, evidence source_text, finding_key, and document_id.
 */
function assembleCustomerFacingReport(report: PolicyRecord): string {
  const id = report.identification;
  const index = buildSourceReferenceIndex(report);
  const sections: string[] = [
    "Policy report",
    report.completeness.status,
    ...report.completeness.warnings,
    `Classified as ${report.documents[0].classification}`,
    "Policy Identification",
    `Carrier ${cite(id.carrier_name)}`,
    `Policy form ${cite(id.policy_form)}`,
    `Policy number ${cite(id.policy_number)}`,
    `Named insured ${cite(id.named_insured)}`,
    `Horse ${cite(id.insured_horse_name)}`,
    `Effective ${cite(id.policy_effective_date)}`,
    `Expiration ${cite(id.policy_expiration_date)}`,
    `Deductible ${cite(id.deductible)}`,
    `Insured value ${cite(id.insured_value)}`,
    "Coverage Snapshot"
  ];
  for (const item of report.coverages) {
    sections.push(`${item.coverage_type} ${item.coverage_status} ${item.description}`);
  }
  sections.push("Exclusions");
  for (const exclusion of report.exclusions) {
    const pages = exclusion.source_pages?.length ? exclusion.source_pages : [exclusion.source_page];
    sections.push(`EXCLUDED ${exclusion.exclusion_type}`);
    sections.push(exclusion.description);
    for (const item of exclusion.attachments || []) {
      if (item.kind === "exception" || item.kind === "qualification") sections.push(item.explanation);
    }
    if (pages.filter((page) => page > 0).length) sections.push(`Source: ${formatPageLocator(pages)}`);
  }
  sections.push("Emergency / Claim Requirements");
  for (const row of report.requirements) {
    sections.push(`${row.trigger}. ${row.requirement}`);
  }
  sections.push("Potential Coverage Gaps");
  sections.push(...report.coverage_gaps);
  sections.push("Questions for Your Agent");
  sections.push(...report.agent_questions);
  sections.push("Source References");
  for (const ref of index) {
    sections.push(`${ref.label} ${ref.page_label}`);
  }
  sections.push(...report.educational_notes);
  return sections.join("\n");
}

function renderCustomerMarkup(report: PolicyRecord): string {
  const facing = assembleCustomerFacingReport(report);
  const escaped = facing
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<article class="policy-report"><pre>${escaped}</pre></article>`;
}

function assertReportViewConsumesAnalysisFields(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "../components/report-view.tsx"), "utf8");
  assert.match(source, /e\.description/, "Exclusions UI must render synthesized description");
  assert.match(source, /formatPageLocator/, "Exclusions UI must render page locators");
  assert.match(source, /agent_questions/, "Questions UI must consume agent_questions");
  assert.match(source, /r\.trigger/, "Duties UI must render requirement triggers");
  assert.match(source, /r\.requirement/, "Duties UI must render requirement text");
  assert.match(source, /ref\.label/, "Source References UI must render labels");
  assert.match(source, /ref\.page_label/, "Source References UI must render page locators");
  assert.doesNotMatch(source, /e\.exact_source_excerpt/, "Exclusions UI must not quote raw excerpts");
  assert.doesNotMatch(source, /evidence\.source_text/, "Source References UI must not display raw evidence as primary text");
}

function main() {
  assertReportViewConsumesAnalysisFields();

  const doc = docFromPages(NATIVE_POLICY_REPORT_PAGES);
  const report = analyzeDocuments(newId(), doc.session_id, [doc]);
  const facing = assembleCustomerFacingReport(report);
  const markup = renderCustomerMarkup(report);
  const index = buildSourceReferenceIndex(report);
  const evidence = collectSourceReferences(report);

  assert.notEqual(doc.classification, "Declarations");
  assert.equal(doc.classification, "Base Policy Form");
  assert.equal(report.documents[0].classification, "Base Policy Form");
  assert.equal(report.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE");
  assert.ok(report.completeness.warnings.some((warning) => /no page was classified as declarations/i.test(warning)));
  assert.doesNotMatch(report.completeness.status, /appears complete/i);
  assert.equal(report.form_inventory.length, 0, "no Declarations forms schedule should be invented");

  const id = report.identification;
  assert.equal(id.carrier_name?.value, "Diamond State Insurance Company");
  assert.match(id.policy_form?.value || "", /AEM 200\s*\(08\/07\)/i);
  assert.equal(id.policy_number, undefined);
  assert.equal(id.named_insured, undefined);
  assert.equal(id.insured_horse_name, undefined);
  assert.equal(id.policy_effective_date, undefined);
  assert.equal(id.policy_expiration_date, undefined);
  assert.equal(id.deductible, undefined);
  assert.equal(id.insured_value, undefined);
  const idFacing = [
    cite(id.carrier_name),
    cite(id.policy_form),
    cite(id.policy_number),
    cite(id.named_insured),
    cite(id.insured_horse_name)
  ].join(" | ");
  assert.doesNotMatch(idFacing, /hereinafter/i);
  assert.match(facing, /Policy number NOT FOUND IN DOCUMENTS PROVIDED/);
  assert.match(facing, /Horse NOT FOUND IN DOCUMENTS PROVIDED/);

  const mortality = coverage(report, "Full Mortality");
  const theft = coverage(report, "Theft");
  const medical = coverage(report, "Major Medical");
  const surgical = coverage(report, "Surgical");
  const colic = coverage(report, "Colic Surgery");
  const lou = coverage(report, "Loss of Use");
  const stallion = coverage(report, "Stallion Infertility");
  assert.equal(mortality.coverage_status, "LIMITED");
  assert.equal(theft.coverage_status, "LIMITED");
  assert.equal(medical.coverage_status, "NEEDS CLARIFICATION");
  assert.equal(surgical.coverage_status, "NEEDS CLARIFICATION");
  assert.equal(colic.coverage_status, "NOT FOUND");
  assert.equal(lou.coverage_status, "NOT FOUND");
  assert.equal(stallion.coverage_status, "NOT FOUND");
  for (const item of [mortality, theft, medical, surgical, colic, lou, stallion]) {
    assert.doesNotMatch(item.description, /hereinafter|EDULE;/i);
    assert.ok(!/will indemnify[\s\S]{80,}/i.test(item.description));
    assert.doesNotMatch(item.description, /this insurance does not cover/i);
    assert.ok(item.description.length < 450, `${item.coverage_type} explanation too long`);
  }
  assert.match(mortality.description, /provides mortality coverage/i);
  assert.match(theft.description, /theft/i);
  assert.match(medical.description, /possible additional coverage|do not establish/i);
  assert.match(lou.description, /do not establish/i);

  const reqFacing = report.requirements.map((row) => `${row.trigger} ${row.requirement}`).join("\n");
  const dutyNeedles = [
    { needle: /veterinar/i, label: "veterinary" },
    { needle: /necropsy|postmortem|post-mortem/i, label: "necropsy" },
    { needle: /telephone notice|immediate notice/i, label: "illness/injury/death notice" },
    { needle: /theft \/ disappearance notice|theft or disappearance/i, label: "theft notice" },
    { needle: /police|law.?enforcement reporting/i, label: "police" },
    { needle: /recommend/i, label: "follow recommendations" },
    { needle: /ransom/i, label: "no ransom" },
    { needle: /proof of loss/i, label: "proof of loss" },
    { needle: /examination under oath/i, label: "EUO" },
    { needle: /record production|produce for examination|records, receipts/i, label: "records" }
  ];
  for (const item of dutyNeedles) {
    assert.ok(report.requirements.some((row) => item.needle.test(`${row.trigger} ${row.requirement}`)), `missing duty ${item.label}`);
    assert.match(facing, item.needle, `rendered report missing duty ${item.label}`);
  }
  assert.doesNotMatch(reqFacing, /will indemnify|territorial limits|sole owner|not been recovered|this insurance does not cover|no liability arises/i);
  assert.equal(report.requirements.filter((row) => /proper care and attention/i.test(row.requirement)).length, 0);
  assert.ok(report.requirements.length >= 10, `expected 10 duty concepts, got ${report.requirements.length}`);
  for (const row of report.requirements) {
    assert.equal(looksLikeRawClaimDutySummary(row.requirement, row.source_text), false, row.requirement);
    assert.ok(row.requirement.length < 240, `${row.trigger} too long: ${row.requirement}`);
    assert.ok(row.source_page === 2 || row.source_page === 3, `${row.trigger} page ${row.source_page}`);
    assert.ok(row.source_text && row.source_text.length >= 12);
    assert.doesNotMatch(row.trigger, /^claim duty$/i);
  }
  const emergency = facing.slice(
    facing.indexOf("Emergency / Claim Requirements"),
    facing.indexOf("Potential Coverage Gaps")
  );
  assert.doesNotMatch(
    emergency,
    /at all times provide proper care[\s\S]{10,}necropsy[\s\S]{10,}telephone notice/i
  );
  const theftVisible = report.requirements
    .filter((row) => /theft \/ disappearance|police \/ law|follow law-enforcement|no ransom/i.test(row.trigger))
    .map((row) => row.requirement);
  assert.equal(new Set(theftVisible).size, theftVisible.length, "theft bullets must not repeat the same summary");
  assert.ok(theftVisible.every((text) => !/follow their recommendations and the insured shall not pay/i.test(text)));
  assert.doesNotMatch(emergency, /claim duty/i);

  for (const category of REQUIRED_EXCLUSIONS) {
    assert.ok(
      report.exclusions.some((row) => category.needle.test(`${row.exclusion_type} ${row.description}`)),
      `missing exclusion ${category.label}`
    );
    assert.match(facing, category.needle, `rendered report missing exclusion ${category.label}`);
  }
  assert.equal(report.exclusions.filter((row) => /^stated exclusion$/i.test(row.exclusion_type)).length, 0);
  assert.doesNotMatch(facing, /stated exclusion/i);
  assert.ok(
    report.exclusions.every((row) => !looksLikeRawExclusionExplanation(row.description, row.condition || row.exact_source_excerpt))
  );
  const intentional = report.exclusions.filter((row) => /intentional destruction/i.test(row.exclusion_type));
  assert.equal(intentional.length, 1);
  assert.ok(/exception|approved|humane/i.test(`${intentional[0].description} ${attachedBlob(report, /intentional destruction/i, "exception")}`));
  assert.ok(/necropsy|post-?mortem/i.test(`${intentional[0].description} ${attachedBlob(report, /intentional destruction/i)}`));
  assert.equal(report.exclusions.filter((row) => /necropsy|post-?mortem/i.test(row.exclusion_type)).length, 0);
  const medication = report.exclusions.filter((row) => /medication|substance/i.test(row.exclusion_type) && !/malicious/i.test(row.exclusion_type));
  assert.equal(medication.length, 1);
  assert.ok(/supplement/i.test(`${medication[0].description} ${attachedBlob(report, /medication|substance/i, "exception")}`));
  const contagious = report.exclusions.find((row) => /contagious|communicable disease/i.test(row.exclusion_type));
  assert.ok(contagious);
  assert.doesNotMatch(
    `${contagious.description} ${attachedBlob(report, /contagious|communicable disease/i)}`,
    /surgical operation|nutritional supplement|chemical substance|licensed veterinarian/i
  );
  const surgicalExclusion = report.exclusions.find((row) => /surgical operation/i.test(row.exclusion_type));
  assert.ok(surgicalExclusion);
  assert.ok(/veterinar|stated exception/i.test(`${surgicalExclusion.description} ${attachedBlob(report, /surgical operation/i)}`));
  assert.doesNotMatch(`${surgicalExclusion.description} ${attachedBlob(report, /surgical operation/i)}`, /nutritional supplement/i);
  assert.doesNotMatch(
    `${medication[0].description} ${attachedBlob(report, /medication|substance/i)}`,
    /surgical operations performed/i
  );
  for (const row of report.exclusions) {
    if (/medication|substance/i.test(row.exclusion_type) && !/malicious/i.test(row.exclusion_type)) continue;
    assert.doesNotMatch(
      `${row.description} ${(row.attachments || []).map((item) => `${item.explanation} ${item.source_text}`).join(" ")}`,
      /nutritional supplement/i,
      `${row.exclusion_type} inherited the supplement exception`
    );
  }
  const consequential = report.exclusions.find((row) => /consequential loss/i.test(row.exclusion_type));
  assert.ok(consequential);
  assert.ok(/theft/i.test(`${consequential.description} ${attachedBlob(report, /consequential loss/i, "exception")}`));
  assert.ok(report.exclusions.some((row) => /nuclear/i.test(row.exclusion_type)));
  assert.ok(report.exclusions.some((row) => /confiscation/i.test(row.exclusion_type)));
  assert.ok(report.exclusions.some((row) => /war/i.test(row.exclusion_type)));
  assert.ok(report.exclusions.every((row) => row.source_page > 0));
  assert.doesNotMatch(facing, /this insurance does not cover[\s\S]{80,}/i);

  const questions = report.agent_questions;
  assert.ok(questions.length >= 3 && questions.length <= 5, `question count ${questions.length}: ${questions.join(" | ")}`);
  assert.ok(questions.some((question) => /declarations/i.test(question) && /schedule/i.test(question)));
  assert.ok(questions.some((question) => /policy number/i.test(question) && /insured horse/i.test(question)));
  assert.ok(questions.some((question) => /notice/i.test(question) && /contact|declarations/i.test(question)));
  assert.ok(questions.some((question) => /major medical/i.test(question) && /surgical/i.test(question)));
  const questionBlob = questions.join("\n");
  assert.doesNotMatch(questionBlob, /intentional destruction|please confirm the exclusion language/i);
  assert.doesNotMatch(questionBlob, /thirty|30\s+days|not been recovered/i);
  assert.doesNotMatch(questionBlob, /confirm that mortality|mortality coverage language/i);
  assert.doesNotMatch(questionBlob, /confirm that theft|theft coverage exists/i);
  assert.doesNotMatch(questionBlob, /proof of loss/i);
  assert.ok(questions.every((question) => !looksLikeQuotedPolicyLanguage(question)));
  assert.ok(questions.every((question) => facing.includes(question)));

  assert.ok(!questions.some((question) => /mortality/i.test(question) && /confirm/i.test(question)));
  assert.ok(!questions.some((question) => /theft coverage/i.test(question) && /confirm/i.test(question)));

  const byLabel = (needle: RegExp) => {
    const hit = index.find((item) => needle.test(item.label));
    assert.ok(hit, `missing source reference ${needle}. have: ${index.map((item) => `${item.label} ${item.page_label}`).join(" | ")}`);
    return hit;
  };
  byLabel(/policy identification/i);
  byLabel(/missing declarations/i);
  byLabel(/mortality coverage/i);
  byLabel(/theft coverage/i);
  byLabel(/territorial/i);
  const vetRef = byLabel(/veterinar|necropsy/i);
  const noticeRef = byLabel(/notice requirements/i);
  const theftPoliceRef = byLabel(/theft \/ police/i);
  const proofRef = byLabel(/proof of loss/i);
  const euoRef = byLabel(/examination under oath|record production/i);
  byLabel(/other insurance/i);
  byLabel(/major medical|surgical/i);
  const exclusionsRef = byLabel(/^exclusions$/i);
  assert.ok(vetRef.pages.includes(2), "veterinary/necropsy page 2");
  assert.ok(noticeRef.pages.includes(2), "notice page 2");
  assert.ok(theftPoliceRef.pages.includes(2), "theft/police page 2");
  assert.ok(proofRef.pages.includes(2) || proofRef.pages.includes(3), "proof of loss page 2 or 3");
  assert.ok(euoRef.pages.includes(3), "EUO/records page 3");
  assert.equal(exclusionsRef.page_label, "Pages 3-4");
  assert.ok(index.every((item) => !looksLikeRawPolicyFragment(item.label)));
  assert.ok(index.every((item) => item.evidence.some((ev) => ev.source_text.trim().length > 0)));
  for (const ref of index) {
    const visible = formatCustomerSourceReference(ref);
    assert.doesNotMatch(visible, /the company will indemnify|the insured shall|this insurance does not cover/i);
    assert.match(facing, new RegExp(ref.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.ok(evidence.length > 0);

  assert.doesNotMatch(facing, /EDULE;|\bEDULE\b/);
  assert.doesNotMatch(facing, /hereinafter called/i);
  assert.doesNotMatch(facing, /\bsource_text\b|\bfinding_key\b|\bdocument_id\b/);
  assert.doesNotMatch(facing, /\{"policy_id"/);
  assert.doesNotMatch(markup, /hereinafter called|source_text|finding_key|document_id|EDULE;/);
  assert.match(markup, /<article class="policy-report">/);

  assert.match(report.coverage_gaps.join(" "), /not established/i);
  assert.doesNotMatch(report.coverage_gaps.join(" "), /should necessarily|match the horse/i);
  assert.ok(report.coverage_gaps.some((gap) => /named exclusions/i.test(gap)));

  console.log("NATIVE REPORT PARITY OK", {
    classification: doc.classification,
    completeness: report.completeness.status,
    mortality: mortality.coverage_status,
    theft: theft.coverage_status,
    medical: medical.coverage_status,
    surgical: surgical.coverage_status,
    exclusions: report.exclusions.map((row) => row.exclusion_type),
    duties: report.requirements.map((row) => row.trigger),
    questions: report.agent_questions,
    source_references: index.map((item) => `${item.label} ${item.page_label}`)
  });
}

main();
