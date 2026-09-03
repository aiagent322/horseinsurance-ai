import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";

function docFromPages(pages: Array<{ page: number; text: string }>): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: "semantic.pdf",
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "semantic",
    page_count: pages.length,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: "Unknown Document",
    pages
  };
}

function analyzeText(text: string, page = 3) {
  const doc = docFromPages([{ page, text }]);
  return analyzeDocuments(newId(), doc.session_id, [doc]);
}

function coverage(report: ReturnType<typeof analyzeDocuments>, type: string) {
  const rec = report.coverages.find((c) => c.coverage_type === type);
  assert.ok(rec, `missing coverage row ${type}`);
  return rec;
}

function main() {
  const denials: Array<[string, string, string]> = [
    ["Full Mortality", "Full Mortality coverage is not provided.", "1"],
    ["Major Medical", "Major Medical coverage is excluded.", "2"],
    ["Theft", "No theft coverage applies.", "3"],
    ["Loss of Use", "This policy does not provide Loss of Use coverage.", "4"],
    ["Surgical", "The horse is not insured for Surgical coverage.", "5"]
  ];

  for (const [type, sentence, caseNo] of denials) {
    const report = analyzeText(sentence, 3);
    const rec = coverage(report, type);
    assert.equal(rec.coverage_status, "EXCLUDED", `case ${caseNo}: ${type}`);
    assert.equal(rec.source_page, 3, `case 9/${caseNo}: page`);
    assert.ok(rec.source_text.length > 0, `case 9/${caseNo}: excerpt`);
    assert.match(rec.source_text, new RegExp(sentence.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }

  const mort = analyzeText(
    "This policy provides Full Mortality coverage for the insured horse.\nInsured Value / Full Mortality: $45,000",
    1
  );
  const mortRec = coverage(mort, "Full Mortality");
  assert.equal(mortRec.coverage_status, "COVERED", "case 6: affirmative mortality");
  assert.ok(mortRec.coverage_limit?.value.includes("45,000"));

  const med = analyzeText(
    "This policy provides Major Medical coverage with a limit of $15,000 per policy period.",
    1
  );
  const medRec = coverage(med, "Major Medical");
  assert.ok(
    medRec.coverage_status === "COVERED" || medRec.coverage_status === "COVERED WITH LIMITATIONS",
    `case 7: got ${medRec.coverage_status}`
  );

  const silent = analyzeText("Named Insured: Pat Rivers. Policy Number: EQ-TEST-1.", 1);
  assert.equal(coverage(silent, "Theft").coverage_status, "NOT FOUND", "case 8: never mentioned");
  assert.equal(coverage(silent, "Surgical").coverage_status, "NOT FOUND");

  for (const [type, sentence] of denials) {
    const status: string = coverage(analyzeText(sentence, 3), type).coverage_status;
    assert.ok(status !== "COVERED" && status !== "COVERED WITH LIMITATIONS", `case 10: ${type}`);
  }

  console.log("SEMANTIC REGRESSION OK", {
    denials: denials.map(([type]) => type + ":EXCLUDED"),
    mortality: mortRec.coverage_status,
    medical: medRec.coverage_status,
    unspoken: "Theft:NOT FOUND"
  });
}

main();
