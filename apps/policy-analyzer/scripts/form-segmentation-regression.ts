import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { describeFormsAndEndorsements, inspectDocumentPackageState } from "../lib/document-terminology";
import {
  isDeclarationsOrScheduleRole,
  isEndorsementOrOptionalRole,
  segmentLogicalForms
} from "../lib/form-segmentation";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";
import {
  GENUINE_DECLARATIONS_PAGES,
  POLICY_FORM_REFERENCING_DECLARATIONS_PAGES
} from "./fixtures/classification-regression-pages";
import { CONTROL2_MULTI_FORM_PACKAGE_PAGES } from "./fixtures/control2-multi-form-package-pages";
import { EQUINE_MORTALITY_JACKET_PAGES } from "./fixtures/equine-mortality-jacket";
import { NATIVE_POLICY_REPORT_PAGES } from "./fixtures/native-policy-report-pages";

const here = dirname(fileURLToPath(import.meta.url));

const EXPECTED_CONTROL2_FORMS: Array<{
  id: string;
  edition: string;
  start: number;
  end: number;
  role: "decls" | "base" | "endorsement";
}> = [
  { id: "77660", edition: "8/06", start: 1, end: 2, role: "decls" },
  { id: "78150", edition: "8/06", start: 3, end: 4, role: "decls" },
  { id: "77659", edition: "1/07", start: 5, end: 13, role: "base" },
  { id: "97006", edition: "1/08", start: 14, end: 15, role: "endorsement" },
  { id: "77661", edition: "1/07", start: 16, end: 18, role: "endorsement" },
  { id: "77662", edition: "1/07", start: 19, end: 21, role: "endorsement" },
  { id: "77672", edition: "1/07", start: 22, end: 23, role: "endorsement" },
  { id: "77663", edition: "1/07", start: 24, end: 25, role: "endorsement" },
  { id: "91368", edition: "1/07", start: 26, end: 26, role: "endorsement" },
  { id: "77668", edition: "1/08", start: 27, end: 29, role: "endorsement" },
  { id: "77678", edition: "1/07", start: 30, end: 31, role: "endorsement" },
  { id: "77679", edition: "1/07", start: 32, end: 33, role: "endorsement" },
  { id: "77669", edition: "1/07", start: 34, end: 35, role: "endorsement" },
  { id: "77675", edition: "1/07", start: 36, end: 36, role: "endorsement" }
];

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
    file_hash: filename,
    page_count: pages.length,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: classifyPackage(pages),
    pages
  };
}

function findForm(report: ReturnType<typeof analyzeDocuments>, id: string) {
  const want = id.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return report.form_inventory.find(
    (form) =>
      form.normalized_identifier === want ||
      form.printed_identifier.replace(/[^A-Za-z0-9]/g, "").toUpperCase().startsWith(want)
  );
}

function main() {
  const productionSources = [
    readFileSync(join(here, "../lib/form-segmentation.ts"), "utf8"),
    readFileSync(join(here, "../lib/classify.ts"), "utf8"),
    readFileSync(join(here, "../lib/analyze.ts"), "utf8")
  ].join("\n");
  assert.doesNotMatch(productionSources, /Chartis|\bAIG\b|77659|77668|97006|77660|78150/);

  const genericPages = [
    {
      page: 1,
      text: `Page 1 of 2
10011 (1/20)
EQUINE MORTALITY INSURANCE POLICY
DECLARATIONS PAGE
POLICY NUMBER: RENEWAL OF NUMBER:
ITEM 1. NAMED INSURED & MAILING ADDRESS:
ITEM 3. SCHEDULE OF COVERED HORSES
ITEM 5. FORMS AND ENDORSEMENTS ATTACHED TO THE POLICY:`
    },
    {
      page: 2,
      text: `Page 2 of 2
10011 (1/20)
EQUINE MORTALITY INSURANCE POLICY
DECLARATIONS PAGE (Continued)
ITEM 3. SCHEDULE OF COVERED HORSES`
    },
    {
      page: 3,
      text: `10012 (1/20) Page 1 of 2
EQUINE MORTALITY INSURANCE POLICY
Various provisions in this policy restrict coverage.
I. COVERAGES
The Company will indemnify the Insured upon the death of an insured horse.
DEFINITIONS
Words in bold face have special meaning.
CONDITIONS
EXCLUSIONS
This insurance does not cover mysterious disappearance.`
    },
    {
      page: 4,
      text: `10012 (1/20) Page 2 of 2
PART III. CONDITIONS
The Insured shall provide proper care and attention.
Arbitration of disputes may be required under these general conditions.`
    },
    {
      page: 5,
      text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
10013 (1/20) Page 1 of 1
OPTIONAL SURGICAL COVERAGE ENDORSEMENT
This endorsement modifies insurance provided under the following:
EQUINE MORTALITY INSURANCE POLICY`
    }
  ];
  const genericDoc = docFromPages(genericPages, "multi-form-specimen.pdf");
  const genericReport = analyzeDocuments(newId(), genericDoc.session_id, [genericDoc]);
  assert.equal(genericReport.documents.length, 1, "generic: one physical upload");
  assert.notEqual(genericDoc.classification, "Declarations");
  assert.equal(genericDoc.classification, "Base Policy Form");
  assert.equal(genericReport.form_inventory.length, 3);
  const gDecls = findForm(genericReport, "10011");
  const gBase = findForm(genericReport, "10012");
  const gEnd = findForm(genericReport, "10013");
  assert.ok(gDecls && isDeclarationsOrScheduleRole(gDecls.form_role));
  assert.equal(gDecls?.page_start, 1);
  assert.equal(gDecls?.page_end, 2);
  assert.ok(gBase && gBase.form_role === "Base Policy Form");
  assert.equal(gBase?.page_start, 3);
  assert.equal(gBase?.page_end, 4);
  assert.ok(gEnd && isEndorsementOrOptionalRole(gEnd.form_role));
  assert.equal(gEnd?.page_start, 5);
  assert.equal(gEnd?.page_end, 5);

  const controlDoc = docFromPages(CONTROL2_MULTI_FORM_PACKAGE_PAGES, "contractual-specimen-package.pdf");
  const controlReport = analyzeDocuments(newId(), controlDoc.session_id, [controlDoc]);
  const segments = segmentLogicalForms(CONTROL2_MULTI_FORM_PACKAGE_PAGES);

  assert.equal(controlReport.documents.length, 1, "A: physical uploaded document count remains 1");
  assert.equal(controlDoc.page_count, 36);
  assert.equal(controlReport.form_inventory.length, 14, "B/H: logical form inventory count = 14");
  assert.equal(segments.length, 14);
  assert.notEqual(controlDoc.classification, "Declarations", "J: whole PDF is not classified as Declarations");
  assert.equal(controlDoc.classification, "Base Policy Form");
  assert.equal(controlReport.documents[0].classification, "Base Policy Form");

  for (const expected of EXPECTED_CONTROL2_FORMS) {
    const form = findForm(controlReport, expected.id);
    assert.ok(form, `C: missing form ${expected.id}`);
    assert.match(form.edition || "", new RegExp(expected.edition.replace("/", "\\/")));
    assert.equal(form.page_start, expected.start, `${expected.id} start page`);
    assert.equal(form.page_end, expected.end, `${expected.id} end page`);
    assert.equal(form.status, "PRESENT");
    assert.equal(form.inventory_source, "DISCOVERED_IN_DOCUMENT");
    if (expected.role === "decls") {
      assert.ok(isDeclarationsOrScheduleRole(form.form_role), `${expected.id} should be specimen Declarations/Schedule`);
    } else if (expected.role === "base") {
      assert.equal(form.form_role, "Base Policy Form", "D: base policy form role");
    } else {
      assert.ok(isEndorsementOrOptionalRole(form.form_role), `F: ${expected.id} endorsement/optional role`);
    }
  }

  const base = findForm(controlReport, "77659");
  assert.ok(base);
  assert.equal(base.form_role, "Base Policy Form");
  assert.equal(base.page_start, 5);
  assert.equal(base.page_end, 13);

  const firstDecls = findForm(controlReport, "77660");
  const secondDecls = findForm(controlReport, "78150");
  assert.ok(firstDecls && secondDecls);
  assert.ok(isDeclarationsOrScheduleRole(firstDecls.form_role));
  assert.ok(isDeclarationsOrScheduleRole(secondDecls.form_role));
  assert.equal(firstDecls.page_end, 2);
  assert.equal(secondDecls.page_start, 3);
  assert.equal(secondDecls.page_end, 4);
  assert.ok((base.page_start || 0) > (secondDecls.page_end || 0), "E: Declarations/Schedules isolated to pages 1-4");

  const endorsementForms = controlReport.form_inventory.filter((form) => isEndorsementOrOptionalRole(form.form_role));
  assert.equal(endorsementForms.length, 11, "I: endorsement inventory populated");
  assert.ok(endorsementForms.length > 0);

  const forms = describeFormsAndEndorsements(controlReport);
  const state = inspectDocumentPackageState(controlReport);
  assert.equal(state.listedForms.length, 14);
  assert.match(forms.summary, /14 distinct contractual forms/i);
  assert.match(forms.summary, /endorsement/i);
  assert.doesNotMatch(forms.heading, /listed on the declarations/i);
  assert.ok(state.declarationsPresent, "specimen declarations pages remain visible as declarations evidence");

  const jacketDoc = docFromPages(EQUINE_MORTALITY_JACKET_PAGES, "Mortality_Policy_Jacket.pdf");
  const jacketReport = analyzeDocuments(newId(), jacketDoc.session_id, [jacketDoc]);
  assert.equal(jacketDoc.classification, "Base Policy Form");
  assert.equal(jacketReport.form_inventory.length, 0, "K: Diamond State inventory stays empty");
  assert.ok(jacketReport.completeness.warnings.some((warning) => /no page was classified as declarations/i.test(warning)));
  assert.equal(inspectDocumentPackageState(jacketReport).declarationsPresent, false);

  const nativeDoc = docFromPages(NATIVE_POLICY_REPORT_PAGES, "native-extracted-policy.pdf");
  const nativeReport = analyzeDocuments(newId(), nativeDoc.session_id, [nativeDoc]);
  assert.equal(nativeDoc.classification, "Base Policy Form");
  assert.equal(nativeReport.form_inventory.length, 0, "K: frozen native Control #1 inventory stays empty");

  const singleFormDoc = docFromPages(POLICY_FORM_REFERENCING_DECLARATIONS_PAGES, "policy-form.pdf");
  const singleFormReport = analyzeDocuments(newId(), singleFormDoc.session_id, [singleFormDoc]);
  assert.equal(singleFormDoc.classification, "Base Policy Form");
  assert.equal(singleFormReport.form_inventory.length, 0, "L: single-form PDFs remain unaffected");

  const declsDoc = docFromPages(GENUINE_DECLARATIONS_PAGES, "declarations.pdf");
  const declsReport = analyzeDocuments(newId(), declsDoc.session_id, [declsDoc]);
  assert.equal(declsDoc.classification, "Declarations", "L: declarations-only PDF stays Declarations");
  assert.ok(declsReport.form_inventory.every((form) => form.inventory_source !== "DISCOVERED_IN_DOCUMENT"));

  const ocrLetterInsert = segmentLogicalForms([
    {
      page: 1,
      text: `CRQ 2044 (Ed. 07 09)
EQUINE MORTALITY - BROAD FORM
Page 1 of 2
We will provide the insurance coverage described in this policy.`
    },
    {
      page: 2,
      text: `CRFQ 2044 (Ed. 07 09)
Page 2 of 2
EXCLUSIONS
This insurance does not cover mysterious disappearance.`
    }
  ]);
  assert.ok(ocrLetterInsert.some((seg) => seg.normalized_identifier === "CRQ2044"));
  assert.equal(
    ocrLetterInsert.filter((seg) => seg.normalized_identifier === "CRFQ2044").length,
    0,
    "one extra OCR letter in a form prefix is not a second form"
  );

  console.log("FORM SEGMENTATION REGRESSION OK", {
    physical_documents: controlReport.documents.length,
    logical_forms: controlReport.form_inventory.length,
    classification: controlDoc.classification,
    base_77659: base.form_role,
    endorsement_forms: endorsementForms.length
  });
}

main();
