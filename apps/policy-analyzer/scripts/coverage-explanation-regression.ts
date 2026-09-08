import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { segmentLogicalForms } from "../lib/form-segmentation";
import {
  explainCoverage,
  looksLikeDeclarationsPage,
  resolveDeclarationsScheduleEvidence
} from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";
import { CONTROL2_MULTI_FORM_PACKAGE_PAGES } from "./fixtures/control2-multi-form-package-pages";
import { NATIVE_POLICY_REPORT_PAGES } from "./fixtures/native-policy-report-pages";

const here = dirname(fileURLToPath(import.meta.url));

function docFromPages(pages: Array<{ page: number; text: string }>, filename = "coverage-explanation.pdf"): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: filename,
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: filename,
    page_count: pages.length,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: classifyPackage(pages),
    pages
  };
}

function analyzePages(pages: Array<{ page: number; text: string }>, filename = "coverage-explanation.pdf") {
  const doc = docFromPages(pages, filename);
  return analyzeDocuments(newId(), doc.session_id, [doc]);
}

function coverage(report: ReturnType<typeof analyzeDocuments>, type: string) {
  const rec = report.coverages.find((item) => item.coverage_type === type);
  assert.ok(rec, `missing coverage ${type}`);
  return rec;
}

function assertCleanExplanation(text: string, label: string) {
  assert.doesNotMatch(text, /\bEDULE\b|EDULE;/i, `${label}: malformed fragment`);
  assert.doesNotMatch(text, /hereinafter called/i, `${label}: legal alias dump`);
  assert.doesNotMatch(text, /No insured value found/i, `${label}: missing-limit lead`);
  assert.doesNotMatch(text, /^[“"]?[A-Z]{0,3};/, `${label}: chopped heading`);
  assert.ok(!/will indemnify[\s\S]{120,}/i.test(text), `${label}: long grant dump`);
}

function falselyDescribesDeclarationsAsAbsent(text: string): boolean {
  return (
    /does not include (the )?(Declarations|Schedule)/i.test(text) ||
    /package does not include/i.test(text) ||
    /(Declarations|Schedule) (are|is) missing/i.test(text) ||
    /Declarations\/Schedule are missing/i.test(text)
  );
}

function main() {
  const productionSources = [
    readFileSync(join(here, "../lib/analyze.ts"), "utf8"),
    readFileSync(join(here, "../lib/policy-semantics.ts"), "utf8")
  ].join("\n");
  assert.doesNotMatch(productionSources, /Chartis|\bAIG\b|77660|78150|Diamond State/);

  const limited = explainCoverage({
    coverageType: "Full Mortality",
    status: "LIMITED",
    grantClause: "The Company will indemnify the Insured upon the death of an insured horse resulting from accident or injury or illness or disease.",
    missingDeclarationsOrSchedule: true
  });
  assert.match(limited, /provides mortality coverage/i, "TEST A: grant stated");
  assert.match(limited, /does not include the Declarations\/Schedule/i, "TEST A: absent document");
  assert.doesNotMatch(limited, /specimen forms with blank/i, "TEST A: absent is not specimen-blank");
  assert.doesNotMatch(limited, /NOT FOUND/i, "TEST A: not NOT FOUND");
  assertCleanExplanation(limited, "TEST A");

  const blankSpecimen = explainCoverage({
    coverageType: "Full Mortality",
    status: "LIMITED",
    grantClause: "We shall indemnify you in the event of the death of any horse.",
    missingDeclarationsOrSchedule: true,
    declarationsScheduleEvidence: "present_blank"
  });
  assert.match(blankSpecimen, /provides mortality coverage/i);
  assert.match(blankSpecimen, /specimen forms with blank issued-policy fields/i);
  assert.equal(falselyDescribesDeclarationsAsAbsent(blankSpecimen), false, "present-but-blank must not say Declarations/Schedule are missing");
  assertCleanExplanation(blankSpecimen, "present-blank unit");

  const populated = explainCoverage({
    coverageType: "Full Mortality",
    status: "COVERED",
    grantClause: "We shall indemnify you in the event of the death of any horse.",
    declarationsScheduleEvidence: "present_populated"
  });
  assert.match(populated, /provides mortality coverage/i);
  assert.doesNotMatch(populated, /Declarations\/Schedule/i, "populated Declarations do not add a missing-facts sentence");
  assert.equal(falselyDescribesDeclarationsAsAbsent(populated), false);

  const optional = analyzePages([
    {
      page: 3,
      text: "Additional coverages such as Major Medical may be provided by Schedule or endorsement."
    }
  ]);
  const medical = coverage(optional, "Major Medical");
  assert.equal(medical.coverage_status, "NEEDS CLARIFICATION", "TEST B status");
  assert.match(medical.description, /possible additional coverage/i, "TEST B optional mention");
  assert.match(medical.description, /do not establish/i, "TEST B not in force");
  assert.match(medical.description, /Schedule or an endorsement/i, "TEST B missing schedule/endorsement");

  const silent = analyzePages([{ page: 1, text: "Named Insured: Pat Rivers. Policy Number: EQ-TEST-1." }]);
  const lou = coverage(silent, "Loss of Use");
  assert.equal(lou.coverage_status, "NOT FOUND", "TEST C status");
  assert.match(lou.description, /do not establish Loss of Use coverage/i, "TEST C wording");
  assert.doesNotMatch(lou.description, /excluded/i, "TEST C must not say excluded");

  const excluded = analyzePages([
    {
      page: 2,
      text: "This policy does not provide Loss of Use coverage, except as specifically endorsed."
    }
  ]);
  const louEx = coverage(excluded, "Loss of Use");
  assert.equal(louEx.coverage_status, "EXCLUDED", "TEST D status");
  assert.match(louEx.description, /exclud/i, "TEST D exclusion explained");
  assert.match(louEx.description, /exception/i, "TEST D exception preserved");
  assert.doesNotMatch(louEx.description, /do not establish/i, "TEST D distinguishable from NOT FOUND");
  assert.doesNotMatch(lou.description, /exclud/i, "TEST C/D: NOT FOUND must not use excluded wording");
  assert.notEqual(lou.description, louEx.description, "TEST D: EXCLUDED wording != NOT FOUND wording");
  assertCleanExplanation(louEx.description, "TEST D");

  const leakPages = [
    {
      page: 1,
      text: `SCHEDULE: As stated in Item J of the Declarations, hereinafter called the Schedule.
PART II. COVERAGE
The Company will indemnify the Insured upon the death of an insured horse resulting from accident or injury occurring during the Policy Period, or illness or disease first manifesting during the Policy Period, subject to immediate notice, the insured horse being listed in the Schedule, the limit in the Schedule, and the deductible; provided however, and subject nevertheless, to the remaining terms.`
    }
  ];
  const leak = analyzePages(leakPages);
  const mortLeak = coverage(leak, "Full Mortality");
  assertCleanExplanation(mortLeak.description, "TEST E");
  assert.doesNotMatch(mortLeak.description, /provided however|subject nevertheless|Item J/i, "TEST E: no raw legal dump");

  const adjacent = analyzePages([
    {
      page: 1,
      text: `The Company will indemnify the Insured upon the death of an insured horse resulting from accident or illness.
The Company will indemnify the Insured for theft of an insured horse and death directly resulting from theft, subject to the Schedule.`
    }
  ]);
  const mortAdj = coverage(adjacent, "Full Mortality");
  const theftAdj = coverage(adjacent, "Theft");
  assert.doesNotMatch(mortAdj.description, /\btheft\b/i, "TEST F: mortality has no theft wording");
  assert.doesNotMatch(theftAdj.description, /\billness\b/i, "TEST F: theft has no mortality-only wording");

  const malformed = explainCoverage({
    coverageType: "Full Mortality",
    status: "LIMITED",
    grantClause: "EDULE; As stated in Item J of the Declarations, hereinafter called the Schedule. The Company will indemnify the Insured upon the death of an insured horse.",
    missingDeclarationsOrSchedule: true
  });
  assert.doesNotMatch(malformed, /\bEDULE\b|EDULE;/i, "TEST G");
  assert.doesNotMatch(malformed, /Item J/i, "TEST G");
  assert.match(malformed, /provides mortality coverage/i, "TEST G still analyzes the grant");

  const legal = explainCoverage({
    coverageType: "Theft",
    status: "LIMITED",
    grantClause:
      "The Company will indemnify the Insured for theft of an insured horse, hereinafter called the Animal, provided however, and subject nevertheless, to reporting.",
    missingDeclarationsOrSchedule: true,
    hasRelatedCoverageLimitation: true
  });
  assert.doesNotMatch(legal, /hereinafter called|provided however|subject nevertheless/i, "TEST H");
  assert.match(legal, /theft/i, "TEST H preserves theft grant");
  assert.match(legal, /reporting|non-recovery|conditions/i, "TEST H preserves qualification");

  const absentPages = [
    {
      page: 1,
      text: `EQUINE MORTALITY INSURANCE POLICY
I. COVERAGES
A. DEATH OR HUMANE DESTRUCTION
We shall indemnify you in the event of the death of any horse during the policy period, subject to the limit in the Schedule.
B. THEFT OR UNLAWFUL REMOVAL
We shall indemnify you in the event of theft of any horse, subject to the Schedule.
C. NAMED SYNDROME COVERAGE
1. We shall indemnify you if a covered horse is diagnosed with the named syndrome, up to the Limit of Insurance shown in the Schedule.`
    }
  ];
  const absent = analyzePages(absentPages, "absent-declarations.pdf");
  assert.equal(resolveDeclarationsScheduleEvidence(absentPages, absent.identification), "absent");
  assert.equal(absentPages.some((page) => looksLikeDeclarationsPage(page.text)), false);
  assert.equal(coverage(absent, "Full Mortality").coverage_status, "LIMITED");
  assert.match(coverage(absent, "Full Mortality").description, /does not include the Declarations\/Schedule/i);
  assert.match(coverage(absent, "Theft").description, /does not include the Declarations\/Schedule/i);
  const absentWobbler = absent.coverages.find((row) => /syndrome/i.test(row.coverage_type));
  assert.ok(absentWobbler);
  assert.match(absentWobbler.description, /does not include the Declarations\/Schedule/i);

  const populatedPages = [
    {
      page: 1,
      text: `Declarations
Policy Number: EQ-POP-0001
Named Insured: Jordan Rivers
Insured Horse Name: Thunder
Policy Effective Date: January 1, 2026
ITEM 3. SCHEDULE OF COVERED HORSES
Name of Horse: Thunder
Coverage Description: Full Mortality
Limit of Insurance: $40,000
Premium: $900
Insured Value / Full Mortality: $40,000`
    },
    {
      page: 2,
      text: `Base Policy Form EQ-A-1 Ed. 01/2024
I. COVERAGES
A. DEATH OR HUMANE DESTRUCTION
We shall indemnify you in the event of the death of any horse during the policy period.
B. THEFT OR UNLAWFUL REMOVAL
We shall indemnify you in the event of theft of any horse.`
    }
  ];
  const populatedReport = analyzePages(populatedPages, "populated-declarations.pdf");
  assert.equal(resolveDeclarationsScheduleEvidence(populatedPages, populatedReport.identification), "present_populated");
  assert.equal(coverage(populatedReport, "Full Mortality").coverage_status, "COVERED");
  assert.equal(coverage(populatedReport, "Theft").coverage_status, "COVERED");
  assert.doesNotMatch(coverage(populatedReport, "Full Mortality").description, /Declarations\/Schedule/i);
  assert.doesNotMatch(coverage(populatedReport, "Theft").description, /Declarations\/Schedule/i);
  assert.equal(falselyDescribesDeclarationsAsAbsent(coverage(populatedReport, "Full Mortality").description), false);

  const control = analyzePages(CONTROL2_MULTI_FORM_PACKAGE_PAGES, "contractual-specimen-package.pdf");
  assert.ok(
    CONTROL2_MULTI_FORM_PACKAGE_PAGES.some((page) => looksLikeDeclarationsPage(page.text)),
    "Control #2 Declarations/Schedule pages are present"
  );
  assert.equal(resolveDeclarationsScheduleEvidence(CONTROL2_MULTI_FORM_PACKAGE_PAGES, control.identification), "present_blank");
  assert.equal(control.form_inventory.length, 14);
  assert.equal(segmentLogicalForms(CONTROL2_MULTI_FORM_PACKAGE_PAGES).length, 14);
  assert.equal(coverage(control, "Full Mortality").coverage_status, "LIMITED");
  assert.equal(coverage(control, "Theft").coverage_status, "LIMITED");
  const controlWobbler = control.coverages.find((row) => /syndrome/i.test(row.coverage_type));
  assert.ok(controlWobbler);
  assert.equal(controlWobbler.coverage_status, "LIMITED");
  assert.equal(coverage(control, "Major Medical").coverage_status, "NEEDS CLARIFICATION");
  for (const row of [coverage(control, "Full Mortality"), coverage(control, "Theft"), controlWobbler]) {
    assert.equal(
      falselyDescribesDeclarationsAsAbsent(row.description),
      false,
      `${row.coverage_type} must not say Declarations/Schedule are missing`
    );
    assert.match(row.description, /specimen forms with blank issued-policy fields/i, `${row.coverage_type} present-but-blank`);
  }
  assert.equal(control.exclusions.length, 13);
  assert.equal(control.requirements.length, 11);
  assert.equal(control.identification.named_insured, undefined);
  assert.equal(control.completeness.status, "COMPLETE CONTRACTUAL SPECIMEN FORM SET");

  const diamond = analyzePages(NATIVE_POLICY_REPORT_PAGES, "native-policy.pdf");
  assert.equal(resolveDeclarationsScheduleEvidence(NATIVE_POLICY_REPORT_PAGES, diamond.identification), "absent");
  assert.match(coverage(diamond, "Full Mortality").description, /does not include the Declarations\/Schedule/i);
  assert.match(coverage(diamond, "Theft").description, /does not include the Declarations\/Schedule/i);
  assert.equal(coverage(diamond, "Full Mortality").coverage_status, "LIMITED");
  assert.equal(coverage(diamond, "Theft").coverage_status, "LIMITED");
  assert.equal(coverage(diamond, "Major Medical").coverage_status, "NEEDS CLARIFICATION");
  assert.equal(coverage(diamond, "Surgical").coverage_status, "NEEDS CLARIFICATION");
  assert.equal(coverage(diamond, "Colic Surgery").coverage_status, "NOT FOUND");
  assert.equal(coverage(diamond, "Loss of Use").coverage_status, "NOT FOUND");
  assert.equal(coverage(diamond, "Stallion Infertility").coverage_status, "NOT FOUND");
  assert.equal(diamond.exclusions.length, 12);
  assert.equal(diamond.requirements.length, 10);
  assert.equal(diamond.coverage_gaps.length, 2);
  assert.equal(diamond.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE");

  console.log("COVERAGE EXPLANATION REGRESSION OK", {
    A: "limited synthesis",
    B: "optional mention",
    C: "not found",
    D: "excluded with exception",
    E: "no raw leak",
    F: "no cross-coverage mix",
    G: "malformed source ignored",
    H: "legal source synthesized"
  });
}

main();
