import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { extractPdfPages } from "../lib/extract-pdf";
import { looksLikeDeclarationsPage } from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";

const here = dirname(fileURLToPath(import.meta.url));
const CONTROL3_PDF = join(
  here,
  "../public/controls/us-control-3-great-american-amp-e269955.pdf"
);

function coverage(report: ReturnType<typeof analyzeDocuments>, type: string) {
  const rec = report.coverages.find((item) => item.coverage_type === type);
  assert.ok(rec, `missing coverage ${type}`);
  return rec;
}

function formPresent(report: ReturnType<typeof analyzeDocuments>, id: string) {
  const want = id.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return report.form_inventory.some(
    (form) =>
      form.normalized_identifier === want ||
      form.printed_identifier.replace(/[^A-Za-z0-9]/g, "").toUpperCase().includes(want)
  );
}

async function main() {
  const productionSources = [
    readFileSync(join(here, "../lib/analyze.ts"), "utf8"),
    readFileSync(join(here, "../lib/policy-semantics.ts"), "utf8"),
    readFileSync(join(here, "../lib/form-segmentation.ts"), "utf8"),
    readFileSync(join(here, "../lib/package-completeness.ts"), "utf8"),
    readFileSync(join(here, "../lib/coverage-applicability.ts"), "utf8")
  ].join("\n");
  assert.doesNotMatch(productionSources, /Great American|AMP E269955|EQU 1012|Julie Greenbank|AWESOME AT THIS/);

  const buf = readFileSync(CONTROL3_PDF);
  const extracted = await extractPdfPages(buf, { enableOcr: false });
  assert.equal(extracted.page_count, 28, "Control #3 is the 28-page issued package");
  assert.ok(
    extracted.pages.some((page) => looksLikeDeclarationsPage(page.text)),
    "issued declarations page must be recognized despite PACER stamps"
  );

  const doc: DocumentRecord = {
    document_id: newId(),
    session_id: newId(),
    original_filename: "us-control-3.pdf",
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "control-3",
    page_count: extracted.page_count,
    storage_location: "memory",
    extraction_status: extracted.extraction_status,
    analysis_status: "complete",
    classification: classifyPackage(extracted.pages),
    pages: extracted.pages
  };
  const report = analyzeDocuments(newId(), doc.session_id, [doc]);

  assert.match(report.identification.policy_number?.value || "", /AMP\s*E269955/i);
  assert.match(report.identification.named_insured?.value || "", /Julie Greenbank/i);
  assert.match(report.identification.insured_horse_name?.value || "", /AWESOME AT THIS/i);
  assert.match(report.identification.policy_effective_date?.value || "", /09\/28\/2017/);
  assert.match(report.identification.policy_expiration_date?.value || "", /09\/28\/2018/);
  assert.match(report.identification.carrier_name?.value || "", /Great American Assurance Company/i);
  assert.match(report.identification.insured_value?.value || "", /500,000/);
  assert.notEqual(report.identification.age?.value, "HE");

  assert.equal(coverage(report, "Full Mortality").coverage_status, "COVERED");
  assert.equal(coverage(report, "Theft").coverage_status, "COVERED");
  assert.equal(coverage(report, "Major Medical").coverage_status, "COVERED");
  assert.equal(coverage(report, "Colic Surgery").coverage_status, "COVERED");
  assert.equal(coverage(report, "Surgical").coverage_status, "NOT FOUND");
  assert.equal(coverage(report, "Loss of Use").coverage_status, "NOT FOUND");
  assert.equal(coverage(report, "Stallion Infertility").coverage_status, "NOT FOUND");
  const wobbler = report.coverages.find((row) => /wobbler/i.test(row.coverage_type));
  assert.ok(wobbler, "Wobbler Syndrome is a covered cause of loss on the issued form");
  assert.equal(wobbler.coverage_status, "COVERED");

  assert.notEqual(report.completeness.status, "COMPLETE CONTRACTUAL SPECIMEN FORM SET");
  assert.equal(report.completeness.status, "APPEARS COMPLETE");
  assert.ok(formPresent(report, "EQU1012") || formPresent(report, "EQU 1012"));
  assert.ok(formPresent(report, "EQU1013"));
  assert.ok(
    !report.form_inventory.some((form) => /EFQU/i.test(form.printed_identifier)),
    "OCR-inserted letters in form prefixes must not become extra forms"
  );
  assert.ok(
    !report.coverages.some(
      (row) => /liability/i.test(row.coverage_type) && row.coverage_status === "COVERED"
    ),
    "must not invent liability coverages from lettered headings"
  );
  assert.ok(report.exclusions.length >= 4, `exclusions ${report.exclusions.length}`);
  assert.ok(report.requirements.length >= 3, `duties ${report.requirements.length}`);
  assert.doesNotMatch(coverage(report, "Major Medical").description, /blank specimen/i);
  assert.doesNotMatch(coverage(report, "Full Mortality").description, /blank specimen/i);

  console.log("CONTROL 3 ISSUED PACKAGE REGRESSION OK", {
    policy_number: report.identification.policy_number?.value,
    named_insured: report.identification.named_insured?.value,
    horse: report.identification.insured_horse_name?.value,
    completeness: report.completeness.status,
    mortality: coverage(report, "Full Mortality").coverage_status,
    theft: coverage(report, "Theft").coverage_status,
    medical: coverage(report, "Major Medical").coverage_status,
    colic: coverage(report, "Colic Surgery").coverage_status,
    wobbler: wobbler.coverage_status,
    forms: report.form_inventory.map((form) => form.printed_identifier),
    exclusions: report.exclusions.length,
    duties: report.requirements.length
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
