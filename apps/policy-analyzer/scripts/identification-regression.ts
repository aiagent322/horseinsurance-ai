import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { segmentLogicalForms } from "../lib/form-segmentation";
import {
  collectIssuingCompanyNames,
  extractInsuranceCompanyNameFromText,
  isIdentityFieldLabel,
  isPolicyProductTitle,
  takePopulatedIdentityValue
} from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";
import { CONTROL2_MULTI_FORM_PACKAGE_PAGES } from "./fixtures/control2-multi-form-package-pages";
import { NATIVE_POLICY_REPORT_PAGES } from "./fixtures/native-policy-report-pages";

const here = dirname(fileURLToPath(import.meta.url));

function docFromPages(pages: Array<{ page: number; text: string }>, filename = "id.pdf"): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: filename,
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "identification-fixture",
    page_count: pages.length,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: classifyPackage(pages),
    pages
  };
}

function analyzePages(pages: Array<{ page: number; text: string }>, filename?: string) {
  const doc = docFromPages(pages, filename);
  return analyzeDocuments(newId(), doc.session_id, [doc]);
}

function coverage(report: ReturnType<typeof analyzeDocuments>, type: string) {
  const rec = report.coverages.find((item) => item.coverage_type === type);
  assert.ok(rec, `missing coverage ${type}`);
  return rec;
}

function main() {
  const productionSources = [
    readFileSync(join(here, "../lib/analyze.ts"), "utf8"),
    readFileSync(join(here, "../lib/policy-semantics.ts"), "utf8")
  ].join("\n");
  assert.doesNotMatch(
    productionSources,
    /Chartis|\bAIG\b|American Home Assurance Company|Insurance Company of the State of Pennsylvania|77660|78150|Great American|AMP E269955|EQU 1012/
  );

  assert.equal(isPolicyProductTitle("EQUINE MORTALITY INSURANCE POLICY"), true);
  assert.equal(isIdentityFieldLabel("RENEWAL OF NUMBER"), true);
  assert.equal(isIdentityFieldLabel("POLICY NUMBER"), true);
  assert.equal(takePopulatedIdentityValue("RENEWAL OF NUMBER:"), undefined);
  assert.equal(takePopulatedIdentityValue("EQ-POS-0001 RENEWAL OF NUMBER: RN-9"), "EQ-POS-0001");
  assert.equal(extractInsuranceCompanyNameFromText("EQUINE MORTALITY INSURANCE POLICY"), undefined);
  assert.match(
    extractInsuranceCompanyNameFromText("NORTHWOODS SPECIALTY INSURANCE COMPANY") || "",
    /northwoods specialty insurance company/i
  );

  const alias = analyzePages([
    { page: 1, text: "COMPANY: Example Equine Insurance Company, hereinafter called the Company." }
  ]);
  assert.equal(alias.identification.carrier_name?.value, "Example Equine Insurance Company");
  assert.doesNotMatch(alias.identification.carrier_name?.value || "", /hereinafter/i);
  assert.equal(alias.identification.carrier_name?.source_page, 1);

  const titleIsNotCarrier = analyzePages([
    {
      page: 1,
      text: `Page 1 of 1
EQUINE MORTALITY INSURANCE POLICY
DECLARATIONS PAGE
POLICY NUMBER:
NAMED INSURED:`
    }
  ]);
  assert.notEqual(titleIsNotCarrier.identification.carrier_name?.value, "EQUINE MORTALITY INSURANCE POLICY");
  assert.doesNotMatch(titleIsNotCarrier.identification.carrier_name?.value || "", /equine mortality insurance policy/i);
  assert.equal(titleIsNotCarrier.identification.policy_number, undefined);

  const explicitCarrier = analyzePages([
    {
      page: 1,
      text: `Declarations
Issued by: Northwoods Specialty Insurance Company
Policy Number: EQ-POS-0001
Named Insured: Jordan Rivers`
    }
  ]);
  assert.equal(explicitCarrier.identification.carrier_name?.value, "Northwoods Specialty Insurance Company");
  assert.equal(explicitCarrier.identification.policy_number?.value, "EQ-POS-0001");

  const populatedNumber = analyzePages([
    {
      page: 1,
      text: "Declarations\nPOLICY NUMBER: EQ-2026-44119\nRENEWAL OF NUMBER:\nNamed Insured: Jordan Hale"
    }
  ]);
  assert.equal(populatedNumber.identification.policy_number?.value, "EQ-2026-44119");
  assert.notEqual(populatedNumber.identification.policy_number?.value, "RENEWAL OF NUMBER");

  const adjacentLabels = analyzePages([
    {
      page: 1,
      text: "DECLARATIONS PAGE\nPOLICY NUMBER: \tRENEWAL OF NUMBER:\nITEM 1. NAMED INSURED & MAILING ADDRESS:"
    }
  ]);
  assert.equal(adjacentLabels.identification.policy_number, undefined);
  assert.notEqual(adjacentLabels.identification.policy_number?.value, "RENEWAL OF NUMBER");
  assert.equal(adjacentLabels.identification.named_insured, undefined);

  const blankNumber = analyzePages([
    {
      page: 1,
      text: "POLICY NUMBER:\nITEM 1. NAMED INSURED:"
    }
  ]);
  assert.equal(blankNumber.identification.policy_number, undefined);

  const alternativeSpecimen = analyzePages(
    [
      {
        page: 1,
        text: `DECLARATIONS PAGE
LAKESIDE ASSURANCE COMPANY
(a capital stock company)
EQUINE MORTALITY INSURANCE POLICY
POLICY NUMBER: \tRENEWAL OF NUMBER:
ITEM 1. NAMED INSURED & MAILING ADDRESS:
ITEM 2. POLICY PERIOD: \tFrom: \tTo:
ITEM 3. SCHEDULE OF COVERED HORSES`
      },
      {
        page: 2,
        text: `DECLARATIONS PAGE
THE INSURANCE COMPANY OF THE NORTHERN VALLEY
(a capital stock company)
EQUINE MORTALITY INSURANCE POLICY
POLICY NUMBER: \tRENEWAL OF NUMBER:
ITEM 1. NAMED INSURED & MAILING ADDRESS:
ITEM 3. SCHEDULE OF COVERED HORSES`
      }
    ],
    "specimen-alternative-decls.pdf"
  );
  const specimenCompanies = collectIssuingCompanyNames(alternativeSpecimen.documents[0].pages);
  assert.equal(specimenCompanies.length, 2, "two specimen issuing companies are identified");
  assert.ok(specimenCompanies.some((name) => /lakeside assurance company/i.test(name)));
  assert.ok(specimenCompanies.some((name) => /insurance company of the northern valley/i.test(name)));
  assert.equal(alternativeSpecimen.identification.carrier_name, undefined, "do not pick one specimen issuer");
  assert.notEqual(alternativeSpecimen.identification.carrier_name?.value, "EQUINE MORTALITY INSURANCE POLICY");
  assert.equal(alternativeSpecimen.identification.policy_number, undefined);

  const external = analyzePages([
    {
      page: 1,
      text: "DEDUCTIBLE: As stated in Item F of the Declarations, hereinafter called the Deductible."
    }
  ]);
  assert.equal(external.identification.deductible, undefined);

  const generic = analyzePages([
    {
      page: 1,
      text: "NAMED INSURED: The individual, partnership, corporation, or entity as stated in Item B of the Declarations."
    }
  ]);
  assert.equal(generic.identification.named_insured, undefined);

  const base = docFromPages(
    [{ page: 1, text: "NAMED INSURED: as stated in Item B of the Declarations." }],
    "base-form.pdf"
  );
  const declarations = docFromPages(
    [
      {
        page: 1,
        text: "Declarations\nNamed Insured: Jane Smith\nPolicy Number: ABC123\nIssued by: Example Equine Insurance Company"
      }
    ],
    "declarations.pdf"
  );
  const precedence = analyzeDocuments(newId(), base.session_id, [
    { ...base, session_id: base.session_id },
    { ...declarations, session_id: base.session_id }
  ]);
  assert.equal(precedence.identification.named_insured?.value, "Jane Smith");
  assert.equal(precedence.identification.named_insured?.source_document_id, declarations.document_id);

  const punctuated = analyzePages([
    {
      page: 1,
      text: "COMPANY: Smith, Jones & Brown Insurance Company, hereinafter called the Company."
    }
  ]);
  assert.equal(punctuated.identification.carrier_name?.value, "Smith, Jones & Brown Insurance Company");
  assert.doesNotMatch(punctuated.identification.carrier_name?.value || "", /hereinafter/i);

  const form = analyzePages([
    {
      page: 1,
      text: "POLICY: Equine Mortality Policy Form XYZ 200 (01/26), hereinafter called the Policy."
    }
  ]);
  assert.match(form.identification.policy_form?.value || "", /XYZ 200\s*\(01\/26\)/i);
  assert.doesNotMatch(form.identification.policy_form?.value || "", /hereinafter/i);

  const control = analyzePages(CONTROL2_MULTI_FORM_PACKAGE_PAGES, "contractual-specimen-package.pdf");
  assert.doesNotMatch(control.identification.carrier_name?.value || "", /equine mortality insurance policy/i);
  const controlCompanies = collectIssuingCompanyNames(CONTROL2_MULTI_FORM_PACKAGE_PAGES);
  assert.ok(
    controlCompanies.some((name) => /assurance company/i.test(name)),
    "specimen masthead company evidence is recognized"
  );
  assert.ok(
    controlCompanies.some((name) => /insurance company of the state of/i.test(name)),
    "second specimen issuing-company identity is recognized"
  );
  assert.ok(controlCompanies.length >= 2, "both specimen issuing companies are identified");
  assert.equal(control.identification.carrier_name, undefined, "do not assert a single issued carrier");
  assert.equal(control.identification.policy_number, undefined);
  assert.notEqual(control.identification.policy_number?.value, "RENEWAL OF NUMBER");
  assert.equal(control.identification.named_insured, undefined);
  assert.equal(control.identification.policy_effective_date, undefined);
  assert.equal(control.identification.policy_expiration_date, undefined);
  assert.equal(control.identification.insured_horse_name, undefined);
  assert.equal(control.identification.insured_value, undefined);
  assert.equal(control.documents.length, 1);
  assert.equal(control.form_inventory.length, 14);
  assert.equal(segmentLogicalForms(CONTROL2_MULTI_FORM_PACKAGE_PAGES).length, 14);
  assert.equal(coverage(control, "Full Mortality").coverage_status, "LIMITED");
  assert.equal(coverage(control, "Theft").coverage_status, "LIMITED");
  const wobbler = control.coverages.find((row) => /syndrome/i.test(row.coverage_type));
  assert.ok(wobbler);
  assert.equal(wobbler.coverage_status, "LIMITED");
  assert.equal(coverage(control, "Major Medical").coverage_status, "NEEDS CLARIFICATION");
  assert.equal(coverage(control, "Surgical").coverage_status, "NEEDS CLARIFICATION");
  assert.equal(control.exclusions.length, 13);
  assert.equal(control.requirements.length, 11);

  const issuedOcrPackage = analyzePages(
    [
      {
        page: 1,
        text: `*D/B* 111222333 444555
Page 24 of 54 PageID # 90
IMPORTANT NOTICE
This notice is for information only and does not become a part or condition of the attached document.
SDM-811 (Ed. 11/08)`
      },
      {
        page: 2,
        text: `*D/B* 111222333 444555
Page 27 of 54 PageID # 96
CRQ 2012 (Ed. 07 09)
Policy No. CR 440018 00 00
Renewal Of
EQUINE MORTALITY BROAD FORM
DECLARATIONS PART B
NAMED INSURED AND ADDRESS POLICY PERIOD:
Morgan Hale
12 River Road 12:01 A.M. Standard Time
From 01/15/2024 To 01/15/2025
Amount $ 80,000 AGENT'S NAME AND ADDRESS:
Rate % 2.50 Cedar Ridge Agency
Premium $ 2,000.00
Insurance is afforded by the Company named below, a Capital Stock Corporation:
Cedar Ridge Assurance Company
SCHEDULE
Limit of Liability and Description of Horse
Item Specified Amount of
No. Name Breed Age Sex Use Rate Insurance
001 SILVER CURRENT TB 2018 G SH 2.50% 80,000
Major Medical $400.00 10,000
Free Colic Surgery - Specified Animal
FORMS AND ENDORSEMENTS applicable to all Coverage Parts are listed on the attached Forms and Endorsements Schedule CRQ 88 01 (07/09).
CRQ 2012 (Ed. 07/09) (Page 1 of 1)`
      },
      {
        page: 3,
        text: `CRQ 2013 (Ed. 07 09)
EQUINE MORTALITY - BROAD FORM
I. INSURING AGREEMENT
We will provide the insurance coverage described in this policy.
II. COVERED CAUSES OF LOSS
Subject to all of the terms of this policy, we will insure your "ownership interest" in each "horse" specified in the Declarations against the following Covered Causes of Loss:
A. Mortality
The death or "authorized humane destruction" of a "horse" occurring during the "policy period."
B. Theft
The "theft" of a "horse" during the "policy period" or the death of a "horse" resulting directly from the "theft" of that "horse."
C. Named Syndrome
A diagnosis that a "horse" which is twelve (12) years old or younger has "Named Syndrome," such diagnosis having first been made during the "policy period."
IV. EXCLUSIONS
A. Regardless of any other cause, this insurance does not cover any loss of a "horse" that is caused by any of the following:
1. Any accident, injury, or disease that occurred to the "horse" before the beginning of the "policy period."
2. Any dishonest, fraudulent, criminal, intentional, or malicious act.
3. The intentional destruction, slaughter, or killing of a "horse."
4. Mysterious disappearance or escape.
F. Your Duties In The Event Of Accident, Injury, Illness, Or Physical Disability
It is a condition precedent of any liability by us under this policy that you do each of the following:
1. Immediately employ a "qualified veterinarian" to provide medical care to the "horse."
2. Give immediate notice to us of the accident, injury, illness, or physical disability.
3. Arrange for a "qualified veterinarian" to conduct a "necropsy" at no expense to the Company.
CRQ 2013 (Ed. 07/09) (Page 3 of 12)`
      },
      {
        page: 4,
        text: `THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
CRQ 1138 (Ed. 10 12)
FREE COLIC SURGERY ENDORSEMENT
This endorsement modifies the insurance provided under your EQUINE MORTALITY - BROAD FORM policy.
ADDITIONAL COVERAGE - FREE COLIC SURGERY
we will pay you "reasonable and customary veterinary fees" incurred for "colic surgery" provided to your "horse" by a "qualified veterinarian."
The maximum we will pay under this endorsement is $3,500 in the aggregate.
CRQ 1138 (Ed. 10/12) (Page 1 of 3)`
      },
      {
        page: 5,
        text: `THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
CRQ 1034 (Ed. 05 14)
$10,000 MAJOR MEDICAL ENDORSEMENT
This endorsement modifies the insurance provided under your EQUINE MORTALITY - BROAD FORM policy.
ADDITIONAL COVERAGE - MAJOR MEDICAL
we will pay you "reasonable and customary veterinary fees" incurred for "surgical or medical treatment" provided to your "horse."
The maximum we will pay under this endorsement is $10,000 in the aggregate.
Each payment we make pursuant to this endorsement is also subject to a deductible of $500.
This coverage is also subject to a co-payment (20) percent.
CRQ 1034 (Ed. 05/14) (Page 1 of 4)`
      },
      {
        page: 6,
        text: `CRQ 88 01 (Ed. 07 09)
FORMS AND ENDORSEMENTS SCHEDULE
It is hereby understood and agreed the following forms and endorsements are attached to and are a part of this policy:
1. CRQ 2012 07-09 Equine Mortality Broad Form Declarations Part B
2. CRQ 2013 07-09 Equine Mortality - Broad Form
3. CRQ 1138 10-12 Free Colic Surgery Endorsement
4. CRQ 1034 05-14 $10,000 Major Medical Endorsement
CRQ 88 01 (Ed. 07/09) (Page 1 of 1)`
      }
    ],
    "issued-ocr-decls.pdf"
  );
  assert.equal(issuedOcrPackage.identification.policy_number?.value, "CR 440018 00 00");
  assert.equal(issuedOcrPackage.identification.named_insured?.value, "Morgan Hale");
  assert.equal(issuedOcrPackage.identification.insured_horse_name?.value, "SILVER CURRENT");
  assert.equal(issuedOcrPackage.identification.policy_effective_date?.value, "01/15/2024");
  assert.equal(issuedOcrPackage.identification.policy_expiration_date?.value, "01/15/2025");
  assert.match(issuedOcrPackage.identification.carrier_name?.value || "", /cedar ridge assurance company/i);
  assert.match(issuedOcrPackage.identification.insured_value?.value || "", /80,000/);
  assert.notEqual(issuedOcrPackage.identification.age?.value, "HE");
  assert.equal(coverage(issuedOcrPackage, "Full Mortality").coverage_status, "COVERED");
  assert.equal(coverage(issuedOcrPackage, "Theft").coverage_status, "COVERED");
  assert.equal(coverage(issuedOcrPackage, "Major Medical").coverage_status, "COVERED");
  assert.equal(coverage(issuedOcrPackage, "Colic Surgery").coverage_status, "COVERED");
  assert.equal(coverage(issuedOcrPackage, "Surgical").coverage_status, "NOT FOUND");
  assert.equal(coverage(issuedOcrPackage, "Loss of Use").coverage_status, "NOT FOUND");
  assert.equal(coverage(issuedOcrPackage, "Stallion Infertility").coverage_status, "NOT FOUND");
  const issuedSyndrome = issuedOcrPackage.coverages.find((row) => /syndrome/i.test(row.coverage_type));
  assert.ok(issuedSyndrome);
  assert.equal(issuedSyndrome.coverage_status, "COVERED");
  assert.equal(
    issuedOcrPackage.completeness.status,
    "APPEARS COMPLETE",
    `${issuedOcrPackage.completeness.warnings.join(" | ")} :: ${issuedOcrPackage.form_inventory
      .map((form) => `${form.printed_identifier}:${form.status}:${form.inventory_source}`)
      .join(", ")}`
  );
  assert.notEqual(issuedOcrPackage.completeness.status, "COMPLETE CONTRACTUAL SPECIMEN FORM SET");
  assert.ok(
    issuedOcrPackage.form_inventory.some((form) =>
      /CRQ2012/i.test(`${form.printed_identifier}${form.normalized_identifier}`)
    ),
    issuedOcrPackage.form_inventory.map((form) => form.printed_identifier).join(", ")
  );
  assert.ok(issuedOcrPackage.exclusions.length >= 1);
  assert.ok(issuedOcrPackage.requirements.length >= 1);

  const diamond = analyzePages(NATIVE_POLICY_REPORT_PAGES, "native-policy.pdf");
  assert.equal(diamond.identification.carrier_name?.value, "Diamond State Insurance Company");
  assert.match(diamond.identification.policy_form?.value || "", /AEM 200\s*\(08\/07\)/i);
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

  console.log("IDENTIFICATION REGRESSION OK", {
    carrier: alias.identification.carrier_name?.value,
    control_carrier: control.identification.carrier_name?.value,
    control_policy_number: control.identification.policy_number?.value,
    control_companies: controlCompanies,
    diamond: diamond.identification.carrier_name?.value,
    policy_form: form.identification.policy_form?.value
  });
}

main();
