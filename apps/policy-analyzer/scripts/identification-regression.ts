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
    /Chartis|\bAIG\b|American Home Assurance Company|Insurance Company of the State of Pennsylvania|77660|78150/
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
