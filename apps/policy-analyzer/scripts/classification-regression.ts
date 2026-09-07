import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { looksLikeDeclarationsPage } from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";
import {
  GENUINE_DECLARATIONS_PAGES,
  POLICY_FORM_REFERENCING_DECLARATIONS_PAGES
} from "./fixtures/classification-regression-pages";
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
    file_hash: "classification-fixture",
    page_count: pages.length,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: classifyPackage(pages),
    pages
  };
}

function main() {
  const formClass = classifyPackage(POLICY_FORM_REFERENCING_DECLARATIONS_PAGES);
  assert.notEqual(formClass, "Declarations", "policy form that references Declarations is not the Declarations document");
  assert.equal(formClass, "Base Policy Form");
  assert.equal(
    POLICY_FORM_REFERENCING_DECLARATIONS_PAGES.some((page) => looksLikeDeclarationsPage(page.text)),
    false,
    "no page of a referencing policy form is a declarations page"
  );

  const formDoc = docFromPages(POLICY_FORM_REFERENCING_DECLARATIONS_PAGES, "policy-form.pdf");
  const formReport = analyzeDocuments(newId(), formDoc.session_id, [formDoc]);
  assert.equal(formDoc.classification, "Base Policy Form");
  assert.equal(formReport.documents[0].classification, "Base Policy Form");
  assert.equal(formReport.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE");
  assert.ok(
    formReport.completeness.warnings.some((warning) => /no page was classified as declarations/i.test(warning)),
    "package warning must say declarations are missing"
  );

  const jacketClass = classifyPackage(EQUINE_MORTALITY_JACKET_PAGES);
  assert.notEqual(jacketClass, "Declarations");
  assert.equal(jacketClass, "Base Policy Form");
  const jacketDoc = docFromPages(EQUINE_MORTALITY_JACKET_PAGES, "Mortality_Policy_Jacket.pdf");
  const jacketReport = analyzeDocuments(newId(), jacketDoc.session_id, [jacketDoc]);
  assert.equal(jacketReport.documents[0].classification, "Base Policy Form");
  assert.equal(jacketReport.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE");
  assert.ok(jacketReport.completeness.warnings.some((warning) => /no page was classified as declarations/i.test(warning)));

  const decClass = classifyPackage(GENUINE_DECLARATIONS_PAGES);
  assert.equal(decClass, "Declarations");
  assert.equal(looksLikeDeclarationsPage(GENUINE_DECLARATIONS_PAGES[0].text), true);
  const decDoc = docFromPages(GENUINE_DECLARATIONS_PAGES, "declarations.pdf");
  const decReport = analyzeDocuments(newId(), decDoc.session_id, [decDoc]);
  assert.equal(decReport.documents[0].classification, "Declarations");
  assert.ok(
    !decReport.completeness.warnings.some((warning) => /no page was classified as declarations/i.test(warning)),
    "genuine declarations must not produce a missing-declarations warning"
  );

  console.log("CLASSIFICATION REGRESSION OK", {
    policy_form: formClass,
    jacket: jacketClass,
    genuine_declarations: decClass,
    form_completeness: formReport.completeness.status,
    jacket_completeness: jacketReport.completeness.status
  });
}

main();
