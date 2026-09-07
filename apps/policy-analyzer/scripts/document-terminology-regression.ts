import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import {
  describeFormsAndEndorsements,
  formsSectionContradictsPackageWarning,
  inspectDocumentPackageState
} from "../lib/document-terminology";
import { newId } from "../lib/store";
import type { DocumentRecord, PolicyRecord } from "../lib/types";
import {
  POLICY_FORM_REFERENCING_DECLARATIONS_PAGES
} from "./fixtures/classification-regression-pages";
import { EQUINE_MORTALITY_JACKET_PAGES } from "./fixtures/equine-mortality-jacket";
import { NATIVE_POLICY_REPORT_PAGES } from "./fixtures/native-policy-report-pages";

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

function analyzeOne(pages: Array<{ page: number; text: string }>, filename: string): PolicyRecord {
  const doc = docFromPages(pages, filename);
  return analyzeDocuments(newId(), doc.session_id, [doc]);
}

function analyzeMany(docs: DocumentRecord[]): PolicyRecord {
  const sessionId = docs[0]?.session_id || newId();
  return analyzeDocuments(newId(), sessionId, docs.map((doc) => ({ ...doc, session_id: sessionId })));
}

function facing(report: PolicyRecord): string {
  const forms = describeFormsAndEndorsements(report);
  return [
    report.completeness.status,
    ...report.completeness.warnings,
    ...report.documents.map((doc) => `Classified as ${doc.classification}`),
    forms.heading,
    forms.summary,
    ...report.form_inventory.map((form) => `${form.printed_identifier} ${form.status}`),
    ...report.form_inventory.filter((form) => form.status === "MISSING").map(() => forms.listedMissingNote),
    ...report.agent_questions
  ].join("\n");
}

function main() {
  const testA = analyzeOne(POLICY_FORM_REFERENCING_DECLARATIONS_PAGES, "policy-form.pdf");
  const formsA = describeFormsAndEndorsements(testA);
  const stateA = inspectDocumentPackageState(testA);
  assert.equal(testA.documents[0].classification, "Base Policy Form");
  assert.equal(stateA.declarationsPresent, false);
  assert.equal(formsA.heading, "Forms & Endorsements");
  assert.match(formsA.summary, /declarations\/schedule/i);
  assert.doesNotMatch(facing(testA), /forms listed on the declarations/i);
  assert.doesNotMatch(formsA.summary, /no forms or endorsements schedule was identified/i);
  assert.doesNotMatch(formsA.summary, /number appears on the declarations/i);
  console.log("TEST A OK");

  const declarationsOnly = [
    {
      page: 1,
      text: `Declarations
Issued by: Educational Specialty Livestock Insurance Company
Policy Number: ABC123
Named Insured: Example Owner
Mailing Address: 100 Example Road, Example City, ST 00000
Policy Effective Date: January 1, 2026
Policy Expiration Date: January 1, 2027
Horse: Example Horse
Insured Value: $25,000
Deductible: $500
Premium: $1,200
Agent: Example Producer`
    }
  ];
  const testB = analyzeOne(declarationsOnly, "declarations.pdf");
  const formsB = describeFormsAndEndorsements(testB);
  assert.equal(testB.documents[0].classification, "Declarations");
  assert.equal(inspectDocumentPackageState(testB).declarationsPresent, true);
  assert.equal(testB.form_inventory.length, 0);
  assert.equal(formsB.heading, "Forms & Endorsements");
  assert.match(formsB.summary, /no forms or endorsements were identified on the uploaded declarations/i);
  assert.doesNotMatch(testB.completeness.warnings.join("\n"), /no page was classified as declarations/i);
  assert.doesNotMatch(formsB.summary, /declarations\/schedule were not provided|does not include the declarations/i);
  console.log("TEST B OK");

  const listedThree = [
    {
      page: 1,
      text: `Declarations
Policy Number: EQ-LIST-3
Named Insured: Ada Cole
Forms:
EQ-A-1 Ed. 01/2024
EQ-B-1 Ed. 01/2024
EQ-C-1 Ed. 01/2024`
    }
  ];
  const testC = analyzeOne(listedThree, "declarations-with-forms.pdf");
  const formsC = describeFormsAndEndorsements(testC);
  assert.equal(testC.documents[0].classification, "Declarations");
  assert.ok(testC.form_inventory.length >= 3, `listed forms: ${testC.form_inventory.map((form) => form.printed_identifier).join(" | ")}`);
  assert.match(formsC.heading, /forms \/ endorsements listed on the declarations/i);
  assert.doesNotMatch(formsC.heading, /^forms listed on the declarations$/i);
  for (const form of testC.form_inventory) {
    assert.equal(form.status, "MISSING", `${form.printed_identifier} must not be treated as uploaded from the list alone`);
  }
  console.log("TEST C OK");

  const listedMissing = analyzeMany([
    docFromPages(
      [
        {
          page: 1,
          text: `Declarations
Policy Number: EQ-MISS-1
Named Insured: Ada Cole
Forms:
END-123 Ed. 01/2024
EQ-A-1 Ed. 01/2024`
        }
      ],
      "declarations-listed-missing.pdf"
    ),
    docFromPages(
      [
        {
          page: 1,
          text: "Base Policy Form EQ-A-1 Ed. 01/2024\nThis policy provides Full Mortality coverage for the insured horse."
        }
      ],
      "base-form.pdf"
    )
  ]);
  const formsD = describeFormsAndEndorsements(listedMissing);
  const end123 = listedMissing.form_inventory.find((form) => /END-123/i.test(form.printed_identifier));
  const eqA1 = listedMissing.form_inventory.find((form) => /EQ-A-1/i.test(form.printed_identifier));
  assert.ok(end123, "listed endorsement END-123");
  assert.equal(end123.status, "MISSING");
  assert.ok(eqA1);
  assert.equal(eqA1.status, "PRESENT");
  assert.match(formsD.listedMissingNote, /not proof the form was uploaded/i);
  assert.match(facing(listedMissing), /END-123 MISSING/);
  console.log("TEST D OK");

  const testE = analyzeMany([
    docFromPages(POLICY_FORM_REFERENCING_DECLARATIONS_PAGES, "base-policy.pdf"),
    docFromPages(
      [
        {
          page: 1,
          text: "Exclusion Endorsement EQ-B-1\nThis endorsement excludes coverage for the left front fetlock."
        }
      ],
      "exclusion-endorsement.pdf"
    )
  ]);
  const formsE = describeFormsAndEndorsements(testE);
  const stateE = inspectDocumentPackageState(testE);
  assert.equal(stateE.declarationsPresent, false);
  assert.ok(stateE.uploadedEndorsementDocuments.length >= 1);
  assert.equal(formsE.heading, "Forms & Endorsements");
  assert.match(formsE.summary, /endorsement was uploaded/i);
  assert.doesNotMatch(formsE.summary, /no endorsements were uploaded|endorsements are missing|no endorsements exist/i);
  assert.doesNotMatch(facing(testE), /forms listed on the declarations/i);
  console.log("TEST E OK");

  const testF = analyzeOne(POLICY_FORM_REFERENCING_DECLARATIONS_PAGES, "definitions-reference.pdf");
  const formsF = describeFormsAndEndorsements(testF);
  assert.equal(testF.form_inventory.length, 0, "definitional Declarations/Schedule references are not a forms schedule");
  assert.equal(formsF.heading, "Forms & Endorsements");
  assert.doesNotMatch(formsF.summary, /the uploaded declarations list/i);
  assert.doesNotMatch(facing(testF), /xyz 100|item j/i);
  console.log("TEST F OK");

  const testG = analyzeOne(EQUINE_MORTALITY_JACKET_PAGES, "Mortality_Policy_Jacket.pdf");
  const formsG = describeFormsAndEndorsements(testG);
  assert.ok(testG.completeness.warnings.some((warning) => /no page was classified as declarations/i.test(warning)));
  assert.equal(formsSectionContradictsPackageWarning(testG.completeness, formsG), false);
  assert.equal(formsG.heading, "Forms & Endorsements");
  assert.doesNotMatch(facing(testG), /forms listed on the declarations/i);
  assert.doesNotMatch(formsG.summary, /identified on the uploaded declarations/i);
  console.log("TEST G OK");

  const control = analyzeOne(NATIVE_POLICY_REPORT_PAGES, "native-extracted-policy.pdf");
  const controlForms = describeFormsAndEndorsements(control);
  const controlFacing = facing(control);
  assert.equal(control.documents[0].classification, "Base Policy Form");
  assert.equal(inspectDocumentPackageState(control).declarationsPresent, false);
  assert.equal(controlForms.heading, "Forms & Endorsements");
  assert.match(controlForms.summary, /declarations\/schedule/i);
  assert.doesNotMatch(controlFacing, /forms listed on the declarations/i);
  assert.equal(control.form_inventory.length, 0);
  assert.doesNotMatch(controlForms.summary, /endorsements are missing/i);
  assert.ok(control.completeness.status === "DOCUMENT PACKAGE MAY BE INCOMPLETE");
  assert.ok(control.agent_questions.some((question) => /complete issued policy package/i.test(question)));
  assert.equal(formsSectionContradictsPackageWarning(control.completeness, controlForms), false);

  console.log("DOCUMENT TERMINOLOGY REGRESSION OK", {
    A: "no Declarations",
    B: "real Declarations",
    C: "Declarations with form list",
    D: "listed-but-missing form",
    E: "endorsement without Declarations",
    F: "external reference not form list",
    G: "package-warning parity",
    control_heading: controlForms.heading
  });
}

main();
