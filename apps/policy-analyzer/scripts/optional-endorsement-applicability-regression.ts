import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { isEndorsementOrOptionalRole, segmentLogicalForms } from "../lib/form-segmentation";
import { buildSourceReferenceIndex, hasIssuedCoverageSelection, textHasIssuedApplicabilityGate } from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";
import { CONTROL2_MULTI_FORM_PACKAGE_PAGES } from "./fixtures/control2-multi-form-package-pages";
import { NATIVE_POLICY_REPORT_PAGES } from "./fixtures/native-policy-report-pages";

const here = dirname(fileURLToPath(import.meta.url));

function docFromPages(pages: Array<{ page: number; text: string }>, filename: string): DocumentRecord {
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

function analyzePages(pages: Array<{ page: number; text: string }>, filename: string) {
  const doc = docFromPages(pages, filename);
  return { doc, report: analyzeDocuments(newId(), doc.session_id, [doc]) };
}

function coverage(report: ReturnType<typeof analyzeDocuments>, type: string) {
  const rec = report.coverages.find((item) => item.coverage_type === type);
  assert.ok(rec, `missing coverage ${type}`);
  return rec;
}

function formPresent(report: ReturnType<typeof analyzeDocuments>, id: string) {
  const want = id.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return report.form_inventory.some(
    (form) =>
      form.normalized_identifier === want ||
      form.printed_identifier.replace(/[^A-Za-z0-9]/g, "").toUpperCase().startsWith(want)
  );
}

function main() {
  const productionSources = [
    readFileSync(join(here, "../lib/coverage-applicability.ts"), "utf8"),
    readFileSync(join(here, "../lib/analyze.ts"), "utf8"),
    readFileSync(join(here, "../lib/policy-semantics.ts"), "utf8"),
    readFileSync(join(here, "../lib/form-segmentation.ts"), "utf8")
  ].join("\n");
  assert.doesNotMatch(
    productionSources,
    /Chartis|\bAIG\b|77668|97006|77669|77663|77672|77678|77679|77675/
  );

  assert.equal(
    textHasIssuedApplicabilityGate(
      "This coverage ONLY applies to those horses for which a specific premium charge for Major Medical Coverage is indicated in the Declarations, Item 3."
    ),
    true
  );
  assert.equal(
    textHasIssuedApplicabilityGate("This policy provides Major Medical coverage with a limit of $12,000 per policy period."),
    false
  );
  assert.equal(
    hasIssuedCoverageSelection("ITEM 3. SCHEDULE OF COVERED HORSES\nHorse: Thunder\nMajor Medical: $12,000\nPremium: $450", [
      "major medical"
    ]),
    true
  );
  assert.equal(
    hasIssuedCoverageSelection(
      "ITEM 3. SCHEDULE OF COVERED HORSES\nHorse\nNo.\nName of Horse/Breed\nCoverage Description\nLimit of Insurance Rate\nPremium /",
      ["major medical", "colic", "loss of use"]
    ),
    false
  );

  const blankOptional = analyzePages(
    [
      {
        page: 1,
        text: `Page 1 of 1
10021 (1/20)
EQUINE MORTALITY INSURANCE POLICY
DECLARATIONS PAGE
POLICY NUMBER:
ITEM 1. NAMED INSURED & MAILING ADDRESS:
ITEM 3. SCHEDULE OF COVERED HORSES
Horse No. Name of Horse Coverage Description Limit Premium`
      },
      {
        page: 2,
        text: `10022 (1/20) Page 1 of 1
EQUINE MORTALITY INSURANCE POLICY
I. COVERAGES
We shall indemnify you in the event of the death of any horse.
B. THEFT OR UNLAWFUL REMOVAL
We shall indemnify you in the event of theft of any horse.
A. COVERAGE TERRITORY
Territorial limits: the United States of America and Canada. Covered only while the insured horse is within those limits.
DEFINITIONS
CONDITIONS
EXCLUSIONS`
      },
      {
        page: 3,
        text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
10023 (1/20) Page 1 of 1
MAJOR MEDICAL AND SURGICAL COVERAGE ENDORSEMENT
This coverage ONLY applies to those horses for which a specific premium charge for Major Medical Coverage is indicated in the Declarations, Item 3. SCHEDULE OF COVERED HORSES.
In consideration of the premium paid, we agree to reimburse you for medical treatment expenses for a covered horse.
This coverage is subject to a deductible of $325.`
      },
      {
        page: 4,
        text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
10024 (1/20) Page 1 of 1
EMERGENCY COLIC SURGERY ENDORSEMENT
We will pay reasonable and customary fees for emergency colic surgery for each horse shown in the DECLARATIONS, ITEM 3. SCHEDULE OF COVERED HORSES.
The most we will pay is the lesser of 50% of the Equine Mortality Limit or $3,000. Third party emergency transportation is limited to $300.
Treatment must be performed at an equine surgical clinic.`
      },
      {
        page: 5,
        text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
10025 (1/20) Page 1 of 1
SURGICAL PROCEDURE EXPENSES ENDORSEMENT
This coverage ONLY applies to those horses for which a specific premium charge for Surgical Procedure Expenses Coverage is indicated in the Declarations, Item 3. SCHEDULE OF COVERED HORSES.
In consideration of the premium paid, we agree to reimburse you for surgical procedure expenses of a covered horse.
This coverage is subject to a deductible of $100.`
      },
      {
        page: 6,
        text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
10026 (1/20) Page 1 of 1
LOSS OF USE ENDORSEMENT
This coverage ONLY applies to those horses for which a specific premium charge for Loss of Use is indicated in the Declarations, Item 3. SCHEDULE OF COVERED HORSES.
In the event that a covered horse manifests a condition during the policy period that renders the horse permanently incapable of the use stated in the schedule, indemnity may be payable.`
      },
      {
        page: 7,
        text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
10027 (1/20) Page 1 of 1
STALLION AVAILABILITY ENDORSEMENT
This coverage ONLY applies to those horses for which a specific premium charge for Stallion Availability is indicated in the Declarations, Item 3. SCHEDULE OF COVERED HORSES.
We shall indemnify you if the covered stallion fails to complete two services of the nominated mare.`
      },
      {
        page: 8,
        text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
10028 (1/20) Page 1 of 1
STALLION PERMANENT DISABILITY COVERAGE ENDORSEMENT
This coverage ONLY applies to those horses for which a specific premium charge for Stallion Permanent Disability is indicated in the Declarations, Item 3. SCHEDULE OF COVERED HORSES.
We shall indemnify you in the event that the stallion becomes totally and permanently infertile or incapable of servicing mares.`
      },
      {
        page: 9,
        text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
10029 (1/20) Page 1 of 1
AGREED VALUE ENDORSEMENT
This coverage ONLY applies to those horses for which Agreed Value is specifically indicated in the Declarations, Item 3. SCHEDULE OF COVERED HORSES.
Provided that we have agreed to and accepted a valuation, the Limit of Insurance shall be accepted as the agreed value.`
      },
      {
        page: 10,
        text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
10030 (1/20) Page 1 of 1
WORLDWIDE COVERAGE ENDORSEMENT
This coverage ONLY applies to those horses for which a specific premium charge for Worldwide Coverage is indicated in the Declarations, Item 3. SCHEDULE OF COVERED HORSES.
Section V. Conditions, A. Coverage Territory is deleted in its entirety and replaced with the following:
A. COVERAGE TERRITORY
This policy applies worldwide. The territorial limits are amended to worldwide.`
      }
    ],
    "blank-optional-endorsements.pdf"
  );

  const blankMedical = coverage(blankOptional.report, "Major Medical");
  assert.equal(blankMedical.coverage_status, "NEEDS CLARIFICATION", "1: gated major medical is not COVERED");
  assert.notEqual(blankMedical.coverage_status, "NOT FOUND");
  assert.notEqual(blankMedical.coverage_status, "COVERED");
  assert.match(blankMedical.description, /form is present|do not establish/i);
  assert.equal(blankMedical.deductible, undefined, "7: form deductible is not an issued policy fact");
  assert.equal(
    blankOptional.report.financial_limits.some((item) => /deductible/i.test(item.label) && item.amount.includes("325")),
    false,
    "7: $325 is not recorded as an issued deductible"
  );

  const blankColic = coverage(blankOptional.report, "Colic Surgery");
  assert.equal(blankColic.coverage_status, "NEEDS CLARIFICATION", "2: gated colic is not COVERED");
  assert.notEqual(blankColic.coverage_status, "NOT FOUND");
  assert.notEqual(blankColic.coverage_status, "COVERED");

  const blankSurgical = coverage(blankOptional.report, "Surgical");
  assert.equal(blankSurgical.coverage_status, "NEEDS CLARIFICATION", "3: gated surgical is not COVERED");
  assert.notEqual(blankSurgical.coverage_status, "NOT FOUND");
  assert.notEqual(blankSurgical.coverage_status, "COVERED");
  assert.equal(blankSurgical.source_page, 5, "3: surgical cites the surgical procedure form");
  assert.match(blankSurgical.source_text, /surgical procedure expenses/i);
  assert.doesNotMatch(blankSurgical.source_text, /equine surgical clinic/i);
  assert.equal(blankSurgical.coverage_limit, undefined);
  assert.equal(
    blankOptional.report.financial_limits.some((item) => item.amount.includes("100") && /deductible|surgical/i.test(item.label)),
    false,
    "7: $100 form deductible is not an issued surgical fact"
  );

  const blankLou = coverage(blankOptional.report, "Loss of Use");
  assert.equal(blankLou.coverage_status, "NEEDS CLARIFICATION", "4: gated loss of use is not COVERED");
  assert.notEqual(blankLou.coverage_status, "NOT FOUND");
  assert.notEqual(blankLou.coverage_status, "COVERED");

  const blankStallion = coverage(blankOptional.report, "Stallion Infertility");
  assert.notEqual(blankStallion.coverage_status, "NOT FOUND", "5: stallion forms present must not be NOT FOUND");
  assert.equal(blankStallion.coverage_status, "NEEDS CLARIFICATION");
  assert.notEqual(blankStallion.coverage_status, "COVERED");
  assert.ok(formPresent(blankOptional.report, "10027"), "5: stallion availability form present");
  assert.ok(formPresent(blankOptional.report, "10028"), "5: stallion disability form present");

  assert.ok(formPresent(blankOptional.report, "10029"), "agreed value form present");
  assert.ok(formPresent(blankOptional.report, "10030"), "6: worldwide form present");
  const blankRefs = buildSourceReferenceIndex(blankOptional.report);
  const territorial = blankRefs.find((item) => /territorial/i.test(item.label));
  assert.ok(territorial, "6: base territorial limits remain identifiable");
  assert.ok(territorial.pages.includes(2), "6: base territory page is retained");
  assert.equal(territorial.pages.includes(10), false, "6: unresolved worldwide form does not replace base territory");
  assert.equal(coverage(blankOptional.report, "Full Mortality").coverage_status, "COVERED");
  assert.equal(coverage(blankOptional.report, "Theft").coverage_status, "COVERED");

  const issuedOptional = analyzePages(
    [
      {
        page: 1,
        text: `Declarations
Issued by: Educational Equine Specialty Insurance Company
Policy Number: EQ-POS-0001
Named Insured: Jordan Rivers
Insured Horse Name: Thunder
ITEM 3. SCHEDULE OF COVERED HORSES
Name of Horse: Thunder
Coverage Description: Major Medical
Limit of Insurance: $12,000
Premium: $450
Major Medical: $12,000
Forms:
EQ-A-1 Ed. 01/2024
EQ-MM-1 Ed. 01/2024`
      },
      {
        page: 2,
        text: `Base Policy Form EQ-A-1 Ed. 01/2024
This policy provides Full Mortality coverage for the insured horse.`
      },
      {
        page: 3,
        text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
EQ-MM-1 (01/2024) Page 1 of 1
MAJOR MEDICAL COVERAGE ENDORSEMENT
This coverage ONLY applies to those horses for which a specific premium charge for Major Medical Coverage is indicated in the Declarations, Item 3. SCHEDULE OF COVERED HORSES.
In consideration of the premium paid, we agree to reimburse you for medical treatment expenses for a covered horse.
This policy provides Major Medical coverage with a limit of $12,000 per policy period.
This coverage is subject to a deductible of $325.`
      }
    ],
    "issued-optional-endorsement.pdf"
  );
  const issuedMedical = coverage(issuedOptional.report, "Major Medical");
  assert.equal(issuedMedical.coverage_status, "COVERED", "8: selected optional endorsement remains COVERED");
  assert.ok(issuedMedical.deductible?.value.includes("325") || issuedMedical.coverage_limit?.value.includes("12,000"));

  const ungated = analyzePages(
    [
      {
        page: 1,
        text: `Declarations
Policy Number: EQ-UNGATED-1
Named Insured: Jordan Rivers
Forms:
EQ-A-1 Ed. 01/2024
EQ-B-1 Ed. 01/2024`
      },
      {
        page: 2,
        text: `Base Policy Form EQ-A-1 Ed. 01/2024
This policy provides Full Mortality coverage for the insured horse.
This policy provides Major Medical coverage with a limit of $12,000 per policy period.`
      },
      {
        page: 3,
        text: `Endorsement EQ-B-1 Ed. 01/2024
Surgical coverage is added with a $8,000 occurrence limit.`
      }
    ],
    "ungated-endorsement.pdf"
  );
  assert.equal(coverage(ungated.report, "Major Medical").coverage_status, "COVERED", "8: ungated medical grant stays COVERED");
  assert.equal(coverage(ungated.report, "Surgical").coverage_status, "COVERED", "8: ungated surgical endorsement stays COVERED");

  const control = analyzePages(CONTROL2_MULTI_FORM_PACKAGE_PAGES, "contractual-specimen-package.pdf");
  assert.equal(control.report.documents.length, 1);
  assert.equal(control.report.form_inventory.length, 14, "10: Control #2 logical forms remain 14");
  assert.equal(segmentLogicalForms(CONTROL2_MULTI_FORM_PACKAGE_PAGES).length, 14);
  assert.equal(control.doc.classification, "Base Policy Form");

  const controlMedical = coverage(control.report, "Major Medical");
  assert.equal(controlMedical.coverage_status, "NEEDS CLARIFICATION", "Control #2 Major Medical");
  assert.notEqual(controlMedical.coverage_status, "COVERED");
  assert.notEqual(controlMedical.coverage_status, "NOT FOUND");
  assert.equal(controlMedical.deductible, undefined);
  assert.equal(
    control.report.financial_limits.some((item) => /major medical deductible/i.test(item.label)),
    false
  );

  const controlColic = coverage(control.report, "Colic Surgery");
  assert.equal(controlColic.coverage_status, "NEEDS CLARIFICATION", "Control #2 Emergency Colic");
  assert.notEqual(controlColic.coverage_status, "COVERED");
  assert.notEqual(controlColic.coverage_status, "NOT FOUND");

  const controlSurgical = coverage(control.report, "Surgical");
  assert.equal(controlSurgical.coverage_status, "NEEDS CLARIFICATION", "Control #2 Surgical Procedure Expenses");
  assert.notEqual(controlSurgical.coverage_status, "COVERED");
  assert.notEqual(controlSurgical.coverage_status, "NOT FOUND");
  assert.ok(controlSurgical.source_page === 34 || controlSurgical.source_page === 35);
  assert.match(controlSurgical.source_text, /surgical procedure/i);
  assert.doesNotMatch(controlSurgical.source_text, /equine surgical clinic/i);

  const controlLou = coverage(control.report, "Loss of Use");
  assert.equal(controlLou.coverage_status, "NEEDS CLARIFICATION", "Control #2 Loss of Use");
  assert.notEqual(controlLou.coverage_status, "NOT FOUND");
  assert.notEqual(controlLou.coverage_status, "COVERED");

  assert.ok(formPresent(control.report, "77672"), "Agreed Value form present");
  assert.notEqual(coverage(control.report, "Full Mortality").coverage_status, "NOT FOUND");
  const controlStallion = coverage(control.report, "Stallion Infertility");
  assert.notEqual(controlStallion.coverage_status, "NOT FOUND", "Control #2 stallion forms present");
  assert.equal(controlStallion.coverage_status, "NEEDS CLARIFICATION");
  assert.ok(formPresent(control.report, "77678"));
  assert.ok(formPresent(control.report, "77679"));
  assert.ok(formPresent(control.report, "77675"), "Worldwide form present");
  const controlRefs = buildSourceReferenceIndex(control.report);
  const controlTerritory = controlRefs.find((item) => /territorial/i.test(item.label));
  if (controlTerritory) {
    assert.ok(!controlTerritory.pages.every((page) => page === 36), "worldwide page must not replace base territory");
  }
  assert.ok(
    control.report.form_inventory.filter((form) => isEndorsementOrOptionalRole(form.form_role)).length >= 11
  );
  assert.equal(coverage(control.report, "Full Mortality").coverage_status, "COVERED");
  assert.equal(coverage(control.report, "Theft").coverage_status, "COVERED");

  const diamond = analyzePages(NATIVE_POLICY_REPORT_PAGES, "native-policy.pdf");
  assert.equal(diamond.report.form_inventory.length, 0, "9: Diamond State form_inventory remains empty");
  assert.equal(coverage(diamond.report, "Full Mortality").coverage_status, "LIMITED");
  assert.equal(coverage(diamond.report, "Theft").coverage_status, "LIMITED");
  assert.equal(coverage(diamond.report, "Major Medical").coverage_status, "NEEDS CLARIFICATION");
  assert.equal(coverage(diamond.report, "Surgical").coverage_status, "NEEDS CLARIFICATION");
  assert.equal(coverage(diamond.report, "Colic Surgery").coverage_status, "NOT FOUND");
  assert.equal(coverage(diamond.report, "Loss of Use").coverage_status, "NOT FOUND");
  assert.equal(coverage(diamond.report, "Stallion Infertility").coverage_status, "NOT FOUND");

  console.log("optional-endorsement-applicability-regression: PASS");
}

main();
