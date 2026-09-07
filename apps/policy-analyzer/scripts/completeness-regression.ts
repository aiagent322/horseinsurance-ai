import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocuments } from "../lib/analyze";
import { buildFixturePdf } from "../lib/build-fixture";
import { classifyPackage } from "../lib/classify";
import { inspectDocumentPackageState } from "../lib/document-terminology";
import { extractPdfPages } from "../lib/extract-pdf";
import { segmentLogicalForms } from "../lib/form-segmentation";
import {
  COMPLETE_ISSUED_PACKAGE_STATUS,
  INCOMPLETE_PACKAGE_STATUS,
  ISSUED_POLICY_FACTS_NOT_ESTABLISHED,
  SPECIMEN_FORM_SET_STATUS,
  resolvePackageCompleteness
} from "../lib/package-completeness";
import { newId } from "../lib/store";
import type { DocumentRecord, PolicyFormRecord, PolicyRecord } from "../lib/types";
import { CONTROL2_MULTI_FORM_PACKAGE_PAGES } from "./fixtures/control2-multi-form-package-pages";
import { NATIVE_POLICY_REPORT_PAGES } from "./fixtures/native-policy-report-pages";

const here = dirname(fileURLToPath(import.meta.url));

function docFromPages(pages: Array<{ page: number; text: string }>, filename = "completeness.pdf"): DocumentRecord {
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

function analyzePages(pages: Array<{ page: number; text: string }>, filename?: string): PolicyRecord {
  const doc = docFromPages(pages, filename);
  return analyzeDocuments(newId(), doc.session_id, [doc]);
}

function coverage(report: PolicyRecord, type: string) {
  const rec = report.coverages.find((item) => item.coverage_type === type);
  assert.ok(rec, `missing coverage ${type}`);
  return rec;
}

function warningBlob(report: PolicyRecord): string {
  return report.completeness.warnings.join("\n");
}

function questionBlob(report: PolicyRecord): string {
  return report.agent_questions.join("\n");
}

async function main() {
  const productionSources = [
    readFileSync(join(here, "../lib/package-completeness.ts"), "utf8"),
    readFileSync(join(here, "../lib/analyze.ts"), "utf8"),
    readFileSync(join(here, "../lib/agent-questions.ts"), "utf8"),
    readFileSync(join(here, "../lib/unresolved-coverage.ts"), "utf8"),
    readFileSync(join(here, "../components/report-view.tsx"), "utf8")
  ].join("\n");
  assert.doesNotMatch(productionSources, /Chartis|\bAIG\b|77660|78150|77659/);

  const threeStates = {
    documentAbsence: resolvePackageCompleteness({
      documentWarnings: ["No page was classified as Declarations."],
      issuedFactWarnings: ["Policy number was not found."],
      declarationPagesPresent: false,
      formsAccountedFor: false,
      specimenFormSet: false
    }),
    specimen: resolvePackageCompleteness({
      documentWarnings: [],
      issuedFactWarnings: ["Policy number was not found.", "Named insured was not found."],
      declarationPagesPresent: true,
      formsAccountedFor: true,
      specimenFormSet: true
    }),
    issuedComplete: resolvePackageCompleteness({
      documentWarnings: [],
      issuedFactWarnings: [],
      declarationPagesPresent: true,
      formsAccountedFor: true,
      specimenFormSet: false
    })
  };
  assert.equal(threeStates.documentAbsence.status, INCOMPLETE_PACKAGE_STATUS);
  assert.equal(threeStates.specimen.status, SPECIMEN_FORM_SET_STATUS);
  assert.deepEqual(threeStates.specimen.warnings, [ISSUED_POLICY_FACTS_NOT_ESTABLISHED]);
  assert.equal(threeStates.issuedComplete.status, COMPLETE_ISSUED_PACKAGE_STATUS);

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
  assert.equal(
    fixture.coverages.find((c) => c.coverage_type === "Major Medical")?.coverage_status,
    "COVERED WITH LIMITATIONS",
    "case 10: later medical endorsement controls"
  );
  assert.equal(fixture.conflicts.length, 0, "case 10: superseding endorsement is not an unresolved conflict");
  const med200 = fixture.form_inventory.find((f) => f.printed_identifier === "EQ-MED-200");
  assert.equal(med200?.status, "MISSING", "case 10: list-only form is not PRESENT");
  assert.equal(fixture.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE");

  const genericSpecimen = analyzePages(
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
We shall indemnify you in the event of either the death or humane destruction of any horse, provided that the death occurs during the policy period.`
      }
    ],
    "generic-specimen-form-set.pdf"
  );
  assert.equal(genericSpecimen.completeness.status, SPECIMEN_FORM_SET_STATUS, "generic specimen form set");
  assert.ok(genericSpecimen.form_inventory.some((form) => /base policy/i.test(form.form_role || "")));
  assert.ok(genericSpecimen.form_inventory.every((form) => form.status === "PRESENT"));
  assert.doesNotMatch(warningBlob(genericSpecimen), /forms or endorsements schedule/i);
  assert.doesNotMatch(warningBlob(genericSpecimen), /DOCUMENT PACKAGE MAY BE INCOMPLETE/i);
  assert.match(warningBlob(genericSpecimen), /issued policy facts are not established/i);
  assert.equal(genericSpecimen.identification.policy_number, undefined);
  assert.equal(genericSpecimen.identification.named_insured, undefined);
  assert.equal(inspectDocumentPackageState(genericSpecimen).packageIncomplete, false);

  const issuedWithoutFormsList = analyzePages(
    [
      {
        page: 1,
        text: `Page 1 of 1
10041 (1/20)
EQUINE MORTALITY INSURANCE POLICY
DECLARATIONS PAGE
Policy Number: EQ-ISS-9001
Named Insured: Pat Rider
Policy Effective Date: January 1, 2026
Policy Expiration Date: January 1, 2027
Insured Horse Name: Storm
Insured Value / Full Mortality: $25,000`
      },
      {
        page: 2,
        text: `10042 (1/20) Page 1 of 1
Base Policy Form
This policy provides Full Mortality coverage for the insured horse.`
      }
    ],
    "complete-issued-no-forms-list.pdf"
  );
  assert.equal(
    issuedWithoutFormsList.completeness.status,
    COMPLETE_ISSUED_PACKAGE_STATUS,
    "populated issued package with discovered forms remains complete"
  );
  assert.ok(issuedWithoutFormsList.form_inventory.some((form) => form.inventory_source === "DISCOVERED_IN_DOCUMENT"));
  assert.doesNotMatch(warningBlob(issuedWithoutFormsList), /forms or endorsements schedule/i);

  const control = analyzePages(CONTROL2_MULTI_FORM_PACKAGE_PAGES, "contractual-specimen-package.pdf");
  assert.equal(control.completeness.status, SPECIMEN_FORM_SET_STATUS, "Control #2 specimen form set");
  assert.notEqual(control.completeness.status, INCOMPLETE_PACKAGE_STATUS);
  assert.equal(inspectDocumentPackageState(control).packageIncomplete, false);
  assert.equal(control.form_inventory.length, 14);
  assert.equal(segmentLogicalForms(CONTROL2_MULTI_FORM_PACKAGE_PAGES).length, 14);
  assert.ok(control.form_inventory.every((form) => form.status === "PRESENT"));
  assert.ok(control.form_inventory.every((form) => form.inventory_source === "DISCOVERED_IN_DOCUMENT"));
  assert.doesNotMatch(warningBlob(control), /forms or endorsements schedule/i);
  assert.doesNotMatch(warningBlob(control), /endorsements may be missing/i);
  assert.doesNotMatch(warningBlob(control), /issued declarations \/ schedule information may be missing from the upload/i);
  assert.match(warningBlob(control), /issued policy facts are not established/i);
  assert.doesNotMatch(questionBlob(control), /are endorsements missing/i);
  assert.doesNotMatch(
    questionBlob(control),
    /schedules or endorsements that form part of the issued policy but are missing/i
  );
  assert.ok(
    control.agent_questions.some((question) => /actual issued declarations\/schedule/i.test(question)),
    "Control #2 asks for issued Declarations/Schedule"
  );
  assert.ok(
    control.agent_questions.some((question) => /horse\(s\), values, limits, and policy period/i.test(question)),
    "Control #2 asks for issued schedule facts"
  );
  assert.ok(
    control.agent_questions.some((question) => /optional endorsements were actually selected or issued/i.test(question)),
    "Control #2 asks which optional endorsements were issued"
  );
  assert.equal(control.identification.policy_number, undefined);
  assert.equal(control.identification.named_insured, undefined);
  assert.equal(control.identification.policy_effective_date, undefined);
  assert.equal(control.identification.policy_expiration_date, undefined);
  assert.equal(control.identification.insured_horse_name, undefined);
  assert.equal(control.identification.insured_value, undefined);
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
  assert.equal(diamond.completeness.status, INCOMPLETE_PACKAGE_STATUS);
  assert.ok(diamond.completeness.warnings.some((warning) => /no page was classified as declarations/i.test(warning)));
  assert.equal(diamond.coverage_gaps.length, 2);
  assert.match(diamond.coverage_gaps[0] || "", /Missing Package Information/i);
  assert.match(diamond.coverage_gaps[1] || "", /Needs Clarification/i);
  assert.equal(coverage(diamond, "Full Mortality").coverage_status, "LIMITED");
  assert.equal(coverage(diamond, "Theft").coverage_status, "LIMITED");
  assert.equal(coverage(diamond, "Major Medical").coverage_status, "NEEDS CLARIFICATION");
  assert.equal(coverage(diamond, "Surgical").coverage_status, "NEEDS CLARIFICATION");
  assert.equal(coverage(diamond, "Colic Surgery").coverage_status, "NOT FOUND");
  assert.equal(coverage(diamond, "Loss of Use").coverage_status, "NOT FOUND");
  assert.equal(coverage(diamond, "Stallion Infertility").coverage_status, "NOT FOUND");
  assert.equal(diamond.exclusions.length, 12);
  assert.equal(diamond.requirements.length, 10);

  console.log("COMPLETENESS REGRESSION OK", {
    case1_missing: "EQ-C-1",
    case3: complete.completeness.status,
    generic_specimen: genericSpecimen.completeness.status,
    issued_no_forms_list: issuedWithoutFormsList.completeness.status,
    control2: control.completeness.status,
    control2_forms: control.form_inventory.length,
    diamond: diamond.completeness.status,
    diamond_gaps: diamond.coverage_gaps.length,
    fixture_forms: fixture.form_inventory.map((f) => f.printed_identifier + ":" + f.status)
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
