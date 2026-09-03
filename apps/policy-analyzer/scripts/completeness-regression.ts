import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { buildFixturePdf } from "../lib/build-fixture";
import { classifyPackage } from "../lib/classify";
import { extractPdfPages } from "../lib/extract-pdf";
import { newId } from "../lib/store";
import type { DocumentRecord, PolicyFormRecord, PolicyRecord } from "../lib/types";

function docFromPages(pages: Array<{ page: number; text: string }>): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: "completeness.pdf",
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "completeness",
    page_count: pages.length,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: classifyPackage(pages),
    pages
  };
}

function analyzePages(pages: Array<{ page: number; text: string }>): PolicyRecord {
  const doc = docFromPages(pages);
  return analyzeDocuments(newId(), doc.session_id, [doc]);
}

async function main() {
  const header = [
    "Declarations",
    "Policy Number: EQ-COMP-1",
    "Named Insured: Ada Cole"
  ].join("\n");

  const twoOfThree = analyzePages([
    {
      page: 1,
      text: `${header}\nForms: EQ-A-1, EQ-B-1, EQ-C-1`
    },
    {
      page: 2,
      text: "Base Policy Form EQ-A-1\nThis policy provides Full Mortality coverage for the insured horse."
    },
    {
      page: 3,
      text: "Exclusion Endorsement EQ-B-1\nThis endorsement excludes coverage for the left front fetlock."
    }
  ]);
  assert.equal(twoOfThree.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE", "case 1");
  assert.ok(
    twoOfThree.completeness.warnings.some((w: string) => /EQ-C-1/.test(w)),
    "case 1: missing identifier named"
  );
  const c1c = twoOfThree.form_inventory.find((f: PolicyFormRecord) => f.printed_identifier === "EQ-C-1");
  assert.equal(c1c?.status, "MISSING");

  const listOnly = analyzePages([
    { page: 1, text: `${header}\nForms: EQ-A-1, EQ-B-1` }
  ]);
  assert.ok(listOnly.form_inventory.length >= 2, "case 2: listed forms");
  for (const f of listOnly.form_inventory) {
    assert.equal(f.status, "MISSING", `case 2: ${f.printed_identifier} must be MISSING`);
  }
  assert.equal(listOnly.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE");

  const complete = analyzePages([
    { page: 1, text: `${header}\nForms: EQ-A-1, EQ-B-1, EQ-C-1` },
    {
      page: 2,
      text: "Base Policy Form EQ-A-1\nThis policy provides Full Mortality coverage for the insured horse."
    },
    {
      page: 3,
      text: "Exclusion Endorsement EQ-B-1\nThis endorsement excludes coverage for the left front fetlock."
    },
    {
      page: 4,
      text: "Endorsement EQ-C-1\nThis endorsement modifies and replaces the Major Medical limit stated on the Declarations."
    }
  ]);
  assert.equal(complete.completeness.status, "APPEARS COMPLETE", "case 3");
  assert.ok(complete.form_inventory.every((f: PolicyFormRecord) => f.status === "PRESENT"), "case 3: all present");
  for (const f of complete.form_inventory as PolicyFormRecord[]) {
    assert.ok(f.match_page && f.match_page !== f.listing_page, "case 9: separate match page");
    assert.ok(f.match_source_text, "case 9: match excerpt");
    assert.ok(!/^forms\s*:/i.test(f.match_source_text || ""), "case 9: match is not the schedule");
  }

  const mismatch = analyzePages([
    { page: 1, text: `${header}\nForms: EQ-A-1 Ed. 01/2024` },
    {
      page: 2,
      text: "Form EQ-A-1 Ed. 01/2026\nThis policy provides Full Mortality coverage for the insured horse."
    }
  ]);
  const mm = mismatch.form_inventory.find((f: PolicyFormRecord) => f.printed_identifier === "EQ-A-1");
  assert.equal(mm?.status, "EDITION MISMATCH", "case 4");
  assert.equal(mismatch.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE");

  const noDec = analyzePages([
    {
      page: 1,
      text: "Policy Number: EQ-COMP-1\nNamed Insured: Ada Cole\nThis policy provides Full Mortality coverage."
    }
  ]);
  assert.equal(noDec.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE", "case 5");
  assert.ok(noDec.completeness.warnings.some((w: string) => /declarations/i.test(w)));

  const noSched = analyzePages([
    { page: 1, text: `${header}\nInsured Value / Full Mortality: $10,000` }
  ]);
  assert.equal(noSched.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE", "case 6");
  assert.ok(noSched.completeness.warnings.some((w: string) => /forms or endorsements schedule/i.test(w)));

  const unread = analyzePages([
    { page: 1, text: `${header}\nForms: EQ-A-1` },
    { page: 2, text: "Base Policy Form EQ-A-1\nThis policy provides Full Mortality coverage for the insured horse." },
    { page: 3, text: "short" }
  ]);
  assert.equal(unread.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE", "case 7");
  assert.ok(unread.completeness.warnings.some((w: string) => /little or no readable text/i.test(w)));

  for (const pack of [twoOfThree, listOnly, complete, mismatch]) {
    for (const f of pack.form_inventory) {
      assert.ok(f.listing_page > 0, "case 8: listing page");
      assert.ok(f.listing_source_text.length > 0, "case 8: listing excerpt");
      assert.match(f.listing_source_text, new RegExp(f.printed_identifier.replace(/-/g, "\\-"), "i"));
    }
  }

  const extracted = await extractPdfPages(await buildFixturePdf());
  const fixtureDoc: DocumentRecord = {
    document_id: newId(),
    session_id: newId(),
    original_filename: "fixture.pdf",
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "fixture",
    page_count: extracted.page_count,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: classifyPackage(extracted.pages),
    pages: extracted.pages
  };
  const fixture = analyzeDocuments(newId(), fixtureDoc.session_id, [fixtureDoc]);
  assert.equal(fixture.identification.policy_number?.value, "EQ-2026-44119", "case 10: policy");
  assert.equal(fixture.identification.insured_horse_name?.value, "Lucky Penny", "case 10: horse");
  assert.equal(fixture.coverages.find((c) => c.coverage_type === "Full Mortality")?.coverage_status, "COVERED");
  assert.equal(fixture.coverages.find((c) => c.coverage_type === "Loss of Use")?.coverage_status, "EXCLUDED");
  assert.ok(fixture.conflicts.length >= 1, "case 10: medical conflict");
  const med200 = fixture.form_inventory.find((f) => f.printed_identifier === "EQ-MED-200");
  assert.equal(med200?.status, "MISSING", "case 10: list-only form is not PRESENT");
  assert.equal(fixture.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE");

  console.log("COMPLETENESS REGRESSION OK", {
    case1_missing: "EQ-C-1",
    case3: complete.completeness.status,
    fixture_forms: fixture.form_inventory.map((f) => f.printed_identifier + ":" + f.status)
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
