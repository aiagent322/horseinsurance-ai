import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";

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

function main() {
  const alias = analyzePages([
    { page: 1, text: "COMPANY: Example Equine Insurance Company, hereinafter called the Company." }
  ]);
  assert.equal(alias.identification.carrier_name?.value, "Example Equine Insurance Company");
  assert.doesNotMatch(alias.identification.carrier_name?.value || "", /hereinafter/i);
  assert.equal(alias.identification.carrier_name?.source_page, 1);

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

  console.log("IDENTIFICATION REGRESSION OK", {
    carrier: alias.identification.carrier_name?.value,
    deductible: external.identification.deductible,
    named_insured: generic.identification.named_insured,
    declarations_named_insured: precedence.identification.named_insured?.value,
    punctuated: punctuated.identification.carrier_name?.value,
    policy_form: form.identification.policy_form?.value
  });
}

main();
