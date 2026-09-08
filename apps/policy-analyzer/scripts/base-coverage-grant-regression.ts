import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { segmentLogicalForms } from "../lib/form-segmentation";
import {
  additionalCoverageHeadingName,
  additionalCoverageTitleFromClause,
  isCoverageConditionNotGrant,
  isUnfilledDeclarationsTemplate
} from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord, PolicyRecord } from "../lib/types";
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
  return analyzeDocuments(newId(), doc.session_id, [doc]);
}

function coverage(report: PolicyRecord, type: string) {
  const rec = report.coverages.find((item) => item.coverage_type === type);
  assert.ok(rec, `missing coverage ${type}`);
  return rec;
}

function additionalNamed(report: PolicyRecord) {
  return report.coverages.find((row) => /syndrome/i.test(row.coverage_type) || /^[A-Z][a-z].+/.test(row.coverage_type) && !["Full Mortality", "Major Medical", "Surgical", "Colic Surgery", "Loss of Use", "Stallion Infertility", "Theft"].includes(row.coverage_type));
}

function main() {
  const productionSources = [
    readFileSync(join(here, "../lib/analyze.ts"), "utf8"),
    readFileSync(join(here, "../lib/policy-semantics.ts"), "utf8")
  ].join("\n");
  assert.doesNotMatch(productionSources, /Chartis|\bAIG\b|77659/);

  assert.equal(
    isCoverageConditionNotGrant(
      "You notify us immediately if theft occurs. Our obligation to indemnify you for theft of the horse shall begin ninety (90) days from the date you advise us."
    ),
    true
  );
  assert.equal(
    isUnfilledDeclarationsTemplate(
      "EQUINE MORTALITY INSURANCE POLICY\nDECLARATIONS PAGE\nPOLICY NUMBER:\nITEM 1. NAMED INSURED & MAILING ADDRESS:\nITEM 3. SCHEDULE OF COVERED HORSES"
    ),
    true
  );
  assert.equal(
    additionalCoverageTitleFromClause(
      "C. NAMED SYNDROME COVERAGE 1. We shall indemnify you if a covered horse is diagnosed with the named syndrome."
    ),
    "Named Syndrome"
  );
  assert.equal(additionalCoverageHeadingName("C. NAMED SYNDROME COVERAGE"), "Named Syndrome");
  assert.equal(additionalCoverageHeadingName("C. Named Syndrome"), "Named Syndrome");
  assert.equal(
    additionalCoverageHeadingName(
      "C. Named Syndrome A diagnosis that a horse which is twelve (12) years old or younger has Named Syndrome."
    ),
    "Named Syndrome"
  );
  assert.equal(additionalCoverageHeadingName("A. DEATH OR HUMANE DESTRUCTION"), null);
  assert.equal(additionalCoverageHeadingName("A. Trainer / Instructor Liability"), null);
  assert.equal(additionalCoverageHeadingName("A. Death or Humane Destruction"), null);

  const specimen = analyzePages(
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
A. DEATH OR HUMANE DESTRUCTION
We shall indemnify you in the event of either the death or humane destruction of any horse, provided that the death occurs during the policy period.
B. THEFT OR UNLAWFUL REMOVAL
We shall indemnify you in the event of any of the following:
1. Theft of any horse;
2. Death or humane destruction as a result of the theft of the horse.
C. NAMED SYNDROME COVERAGE
1. We shall indemnify you, up to but not exceeding our Limit of Insurance, in the event that any covered horse is diagnosed with the named syndrome.
CONDITIONS
Coverage B. Theft or Unlawful Removal shall apply provided that:
2. You notify us immediately if theft or unlawful removal occurs. Our obligation to indemnify you for theft or unlawful removal of the horse shall begin ninety (90) days from the date you advise us.`
      }
    ],
    "specimen-base-grants.pdf"
  );
  assert.equal(coverage(specimen, "Full Mortality").coverage_status, "LIMITED", "specimen mortality");
  assert.equal(coverage(specimen, "Theft").coverage_status, "LIMITED", "specimen theft");
  const specimenTheft = coverage(specimen, "Theft");
  assert.equal(specimenTheft.source_page, 2);
  assert.match(specimenTheft.source_text || "", /theft of any horse/i);
  assert.doesNotMatch(specimenTheft.source_text || "", /ninety \(90\) days|obligation to indemnify/i);
  const specimenExtra = specimen.coverages.find((row) => /named syndrome/i.test(row.coverage_type));
  assert.ok(specimenExtra, "base-form additional coverage grant is detected");
  assert.equal(specimenExtra.coverage_status, "LIMITED");
  assert.notEqual(specimenExtra.coverage_status, "NOT FOUND");
  assert.notEqual(specimenExtra.coverage_status, "NEEDS CLARIFICATION");
  assert.match(specimenExtra.source_text || "", /indemnify/i);

  const issued = analyzePages(
    [
      {
        page: 1,
        text: `Declarations
Issued by: Educational Equine Specialty Insurance Company
Policy Number: EQ-POS-0001
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
    ],
    "issued-base-grants.pdf"
  );
  assert.equal(coverage(issued, "Full Mortality").coverage_status, "COVERED", "issued base-policy grant remains COVERED");
  assert.equal(coverage(issued, "Theft").coverage_status, "COVERED", "issued theft grant remains COVERED");

  const negative = analyzePages(
    [
      {
        page: 1,
        text: `CONDITIONS
Coverage B. Theft or Unlawful Removal shall apply provided that the theft is reported to police.
Our obligation to indemnify you for theft of the horse shall begin ninety (90) days after notice.
EXCLUSIONS
This insurance does not cover mysterious disappearance.
DUTIES
You must notify us immediately if theft occurs.`
      }
    ],
    "theft-condition-only.pdf"
  );
  const negativeTheft = coverage(negative, "Theft");
  assert.notEqual(negativeTheft.coverage_status, "COVERED", "condition/duty is not a theft grant");
  assert.notEqual(negativeTheft.coverage_status, "LIMITED", "condition/duty is not a theft grant");

  const control = analyzePages(CONTROL2_MULTI_FORM_PACKAGE_PAGES, "contractual-specimen-package.pdf");
  assert.equal(control.documents.length, 1);
  assert.equal(control.form_inventory.length, 14);
  assert.equal(segmentLogicalForms(CONTROL2_MULTI_FORM_PACKAGE_PAGES).length, 14);
  assert.equal(control.exclusions.length, 13);
  assert.equal(control.requirements.length, 11);

  const mortality = coverage(control, "Full Mortality");
  assert.equal(mortality.coverage_status, "LIMITED");
  assert.equal(mortality.source_page, 5);
  assert.match(mortality.source_text || "", /death or humane destruction|shall indemnify/i);

  const theft = coverage(control, "Theft");
  assert.equal(theft.coverage_status, "LIMITED");
  assert.equal(theft.source_page, 5, "theft grant must cite the coverage section, not a later condition");
  assert.match(theft.source_text || "", /theft of any horse|unlawful removal/i);
  assert.doesNotMatch(theft.source_text || "", /ninety \(90\) days|twenty-four \(24\) hours|ransom/i);

  const wobbler = control.coverages.find((row) => /syndrome/i.test(row.coverage_type));
  assert.ok(wobbler, "Control #2 base-form additional coverage grant must be detected");
  assert.equal(wobbler.coverage_status, "LIMITED");
  assert.notEqual(wobbler.coverage_status, "NOT FOUND");
  assert.notEqual(wobbler.coverage_status, "NEEDS CLARIFICATION", "not an optional endorsement coverage");
  assert.ok(wobbler.source_page === 5 || wobbler.source_page === 6, `wobbler source page ${wobbler.source_page}`);
  assert.match(wobbler.source_text || "", /indemnify/i);
  assert.doesNotMatch(wobbler.source_text || "", /twelve month extension|77661|77662/i);

  assert.equal(coverage(control, "Major Medical").coverage_status, "NEEDS CLARIFICATION");
  assert.equal(coverage(control, "Surgical").coverage_status, "NEEDS CLARIFICATION");

  const diamond = analyzePages(NATIVE_POLICY_REPORT_PAGES, "native-policy.pdf");
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
  assert.equal(
    diamond.coverages.filter((row) => /syndrome/i.test(row.coverage_type)).length,
    0,
    "Diamond State must not gain an extra named-syndrome coverage"
  );

  console.log("BASE COVERAGE GRANT REGRESSION OK", {
    control2: {
      mortality: mortality.coverage_status,
      theft: theft.coverage_status,
      theft_page: theft.source_page,
      additional: wobbler.coverage_type,
      additional_status: wobbler.coverage_status,
      additional_page: wobbler.source_page
    },
    extra: additionalNamed(specimen)?.coverage_type
  });
}

main();
