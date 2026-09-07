import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { newId } from "../lib/store";
import type { DocumentRecord, PolicyRecord } from "../lib/types";
import {
  UNRESOLVED_COVERAGE_SECTION_TITLE,
  unresolvedCoverageItemsFromReport
} from "../lib/unresolved-coverage";
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

function coverage(report: PolicyRecord, type: string) {
  const rec = report.coverages.find((item) => item.coverage_type === type);
  assert.ok(rec, `missing coverage ${type}`);
  return rec;
}

function gapBlob(report: PolicyRecord): string {
  return report.coverage_gaps.join("\n");
}

function items(report: PolicyRecord) {
  return unresolvedCoverageItemsFromReport(report);
}

function main() {
  const testA = analyzeOne(
    [
      {
        page: 1,
        text: `Base Policy Form
The Company will indemnify the Insured upon the death of an insured horse resulting from accident or injury or illness or disease.`
      }
    ],
    "no-lou.pdf"
  );
  assert.equal(coverage(testA, "Loss of Use").coverage_status, "NOT FOUND");
  assert.doesNotMatch(gapBlob(testA), /loss of use/i);
  console.log("TEST A OK");

  const testB = analyzeOne(
    [
      {
        page: 1,
        text: `Base Policy Form
The Company will indemnify the Insured upon the death of an insured horse resulting from accident or injury.
Additional coverages such as Equine Major Medical may be fully earned as stated in the Schedule or endorsements to the Policy.`
      }
    ],
    "optional-medical.pdf"
  );
  assert.equal(coverage(testB, "Major Medical").coverage_status, "NEEDS CLARIFICATION");
  assert.match(gapBlob(testB), /major medical/i);
  assert.match(gapBlob(testB), /not established/i);
  assert.doesNotMatch(gapBlob(testB), /missing coverage|you do not have major medical/i);
  console.log("TEST B OK");

  const testC = analyzeOne(EQUINE_MORTALITY_JACKET_PAGES, "missing-declarations.pdf");
  assert.equal(coverage(testC, "Full Mortality").coverage_status, "LIMITED");
  assert.equal(coverage(testC, "Theft").coverage_status, "LIMITED");
  const packageItems = items(testC).filter((item) => item.category === "Missing Package Information");
  assert.equal(packageItems.length, 1, "TEST C: one package-completeness item");
  assert.doesNotMatch(gapBlob(testC), /mortality coverage gap|theft coverage gap|mortality is missing|theft is missing/i);
  console.log("TEST C OK");

  const testD = analyzeOne(
    [
      {
        page: 1,
        text: `EXCLUSIONS
This insurance does not cover war, civil war, or military force.
The Company will indemnify the Insured upon the death of an insured horse resulting from accident or injury.`
      }
    ],
    "war-exclusion.pdf"
  );
  assert.ok(testD.exclusions.some((row) => /war/i.test(row.exclusion_type)));
  assert.doesNotMatch(gapBlob(testD), /\bwar\b/i);
  console.log("TEST D OK");

  const testE = analyzeOne(EQUINE_MORTALITY_JACKET_PAGES, "theft-limitation.pdf");
  assert.doesNotMatch(gapBlob(testE), /thirty|30\s+days|not been recovered|embryo|foal/i);
  console.log("TEST E OK");

  const testF = analyzeMany([
    docFromPages(
      [
        {
          page: 1,
          text: `APPLICATION
The insured has requested Major Medical coverage.`
        }
      ],
      "application.pdf"
    ),
    docFromPages(
      [
        {
          page: 1,
          text: `Declarations
Policy Number: EQ-GAP-1
Named Insured: Example Owner
This policy does not provide Major Medical coverage.`
        }
      ],
      "declarations-no-medical.pdf"
    )
  ]);
  assert.match(gapBlob(testF), /major medical/i);
  assert.ok(
    items(testF).some((item) => item.category === "Documented Gap" && /major medical/i.test(item.explanation)),
    `TEST F items: ${gapBlob(testF)}`
  );
  assert.doesNotMatch(gapBlob(testF), /you should add|consider purchasing/i);
  console.log("TEST F OK");

  const testG = analyzeOne(
    [
      {
        page: 1,
        text: `Base Policy Form
The Company will indemnify the Insured upon the death of an insured horse resulting from accident or injury.
Surgical coverage is provided by Endorsement END-XYZ-1.`
      }
    ],
    "missing-endorsement.pdf"
  );
  assert.match(gapBlob(testG), /END-XYZ-1/i);
  assert.match(gapBlob(testG), /not established/i);
  assert.doesNotMatch(gapBlob(testG), /definitely absent|missing coverage/i);
  console.log("TEST G OK");

  const testH = analyzeOne(NATIVE_POLICY_REPORT_PAGES, "native-control.pdf");
  const unresolved = items(testH);
  assert.equal(
    unresolved.filter((item) => item.category === "Missing Package Information").length,
    1,
    "TEST H: one missing-package item"
  );
  assert.doesNotMatch(gapBlob(testH), /named insured was not found|policy number was not found/i);
  assert.doesNotMatch(gapBlob(testH), /mortality is missing|theft is missing/i);
  console.log("TEST H OK");

  const control = testH;
  assert.equal(UNRESOLVED_COVERAGE_SECTION_TITLE, "Unresolved Coverage Items");
  assert.ok(control.coverage_gaps.length >= 2 && control.coverage_gaps.length <= 3, `count ${control.coverage_gaps.length}: ${gapBlob(control)}`);
  assert.match(gapBlob(control), /declarations\/schedule/i);
  assert.match(gapBlob(control), /major medical/i);
  assert.match(gapBlob(control), /surgical/i);
  assert.doesNotMatch(gapBlob(control), /loss of use/i);
  assert.doesNotMatch(gapBlob(control), /colic surgery/i);
  assert.doesNotMatch(gapBlob(control), /stallion infertility/i);
  assert.doesNotMatch(gapBlob(control), /named exclusions appear/i);
  assert.doesNotMatch(gapBlob(control), /thirty|30\s+days/i);
  assert.equal(coverage(control, "Full Mortality").coverage_status, "LIMITED");
  assert.equal(coverage(control, "Theft").coverage_status, "LIMITED");
  assert.equal(coverage(control, "Major Medical").coverage_status, "NEEDS CLARIFICATION");
  assert.equal(coverage(control, "Surgical").coverage_status, "NEEDS CLARIFICATION");
  assert.equal(coverage(control, "Loss of Use").coverage_status, "NOT FOUND");

  console.log("COVERAGE GAP PRESENTATION REGRESSION OK", {
    heading: UNRESOLVED_COVERAGE_SECTION_TITLE,
    control_count: control.coverage_gaps.length,
    control_items: unresolved.map((item) => `${item.category}: ${item.explanation.slice(0, 80)}`)
  });
}

main();
