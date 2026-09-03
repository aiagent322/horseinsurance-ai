import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { buildFixturePdf } from "../lib/build-fixture";
import { buildScannedPdf, SCANNED_PDF_PHRASE } from "../lib/build-scanned-fixture";
import { buildTextPdf } from "../lib/build-text-pdf";
import { extractPdfPages } from "../lib/extract-pdf";
import { ingestPolicyPackage, UploadRejectedError } from "../lib/ingest";
import { newId } from "../lib/ids";
import { ocrRecognizeCalls, resetOcrTestHooks, setOcrRecognizeForTests } from "../lib/ocr";
import {
  deletePolicyRecord,
  findPolicyDocument,
  isUuid,
  loadPolicyRecord,
  originalFileHeaders,
  resolveOriginalPdf
} from "../lib/original-document";
import { TEST_ACTOR_A, runWithActor } from "../lib/persistence/actor-context";
import { resetMemoryStoreForTests } from "../lib/persistence/factory";
import type { DocumentRecord, PolicyFormRecord } from "../lib/types";
import {
  MAX_FILE_BYTES,
  MAX_PACKAGE_BYTES,
  MAX_PDF_FILES,
  validateUploadPackage
} from "../lib/validate-upload";
import { normalizeFormId } from "../lib/form-schedule";

function tinyPdf(tag: string): Buffer {
  return Buffer.from(`%PDF-1.4\n%\xE2\xE3\xCF\xD3\n${tag}\n%%EOF\n`);
}

function docFromPages(pages: Array<{ page: number; text: string }>, extra: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: extra.original_filename || "test.pdf",
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: extra.file_hash || "hash",
    page_count: pages.length,
    storage_location: extra.storage_location || "memory",
    extraction_status: extra.extraction_status || "extracted",
    analysis_status: "complete",
    classification: extra.classification || "Unknown Document",
    pages
  };
}

async function main() {
  resetOcrTestHooks();
  resetMemoryStoreForTests();
  await runWithActor(TEST_ACTOR_A, runIngestionCases);
}

async function runIngestionCases() {

  const first = await buildTextPdf(["Declarations", "Policy Number: EQ-PACK-1", "Named Insured: Ada Cole"]);
  const second = await buildTextPdf(["Base Policy Form EQ-A-1", "This policy provides Full Mortality coverage."]);
  const pack = await ingestPolicyPackage([
    { filename: "declarations.pdf", bytes: first },
    { filename: "form.pdf", bytes: second }
  ]);
  const saved = await loadPolicyRecord(pack.policy_id);
  assert.ok(saved, "1: policy persisted");
  assert.equal(saved.documents.length, 2, "1: two document records");
  assert.equal(saved.documents[0].original_filename, "declarations.pdf");
  assert.equal(saved.documents[1].original_filename, "form.pdf");
  assert.equal(saved.policy_id, pack.policy_id);
  assert.equal(saved.session_id, pack.session_id);
  assert.equal(saved.documents[0].session_id, saved.documents[1].session_id, "1: one session");
  assert.notEqual(saved.documents[0].document_id, saved.documents[1].document_id, "2: distinct document ids");
  assert.notEqual(saved.documents[0].file_hash, saved.documents[1].file_hash, "2: distinct hashes");
  assert.ok(isUuid(saved.documents[0].document_id) && isUuid(saved.documents[1].document_id));

  const beforeDup = await loadPolicyRecord(pack.policy_id);
  assert.throws(
    () => {
      const err = validateUploadPackage([
        { filename: "a.pdf", bytes: first },
        { filename: "b.pdf", bytes: first }
      ]);
      if (err) throw new UploadRejectedError(err);
    },
    (e: unknown) => e instanceof UploadRejectedError && e.code === "DUPLICATE_FILE",
    "3: duplicates rejected"
  );
  await assert.rejects(
    () => ingestPolicyPackage([
      { filename: "a.pdf", bytes: first },
      { filename: "copy.pdf", bytes: first }
    ]),
    (e: unknown) => e instanceof UploadRejectedError && e.code === "DUPLICATE_FILE",
    "3: ingest rejects duplicates before persist"
  );
  const afterDup = await loadPolicyRecord(pack.policy_id);
  assert.equal(afterDup?.documents.length, beforeDup?.documents.length, "3: original package untouched");

  const tooMany = Array.from({ length: MAX_PDF_FILES + 1 }, (_, i) => ({
    filename: `f${i}.pdf`,
    bytes: tinyPdf(`file-${i}`)
  }));
  const tooManyErr = validateUploadPackage(tooMany);
  assert.equal(tooManyErr?.code, "TOO_MANY_FILES", "4: more than 10 files rejected");

  const oversizedFile = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_FILE_BYTES)]);
  assert.equal(
    validateUploadPackage([{ filename: "big.pdf", bytes: oversizedFile }])?.code,
    "FILE_TOO_LARGE",
    "5: per-file limit"
  );
  const part = (tag: string) => {
    const head = Buffer.from(`%PDF-${tag}\n`);
    return Buffer.concat([head, Buffer.alloc(19 * 1024 * 1024 - head.length)]);
  };
  const packageFiles = ["A", "B", "C", "D"].map((tag) => ({
    filename: `${tag}.pdf`,
    bytes: part(tag)
  }));
  assert.ok(packageFiles.reduce((n, f) => n + f.bytes.length, 0) > MAX_PACKAGE_BYTES);
  assert.ok(packageFiles.every((f) => f.bytes.length <= MAX_FILE_BYTES));
  assert.equal(
    validateUploadPackage(packageFiles)?.code,
    "PACKAGE_TOO_LARGE",
    "5: package limit"
  );

  resetOcrTestHooks();
  const nativePdf = await buildTextPdf([
    "Declarations",
    "This policy provides Full Mortality coverage for the insured horse.",
    "Insured Value / Full Mortality: $12,000"
  ]);
  const nativeExtract = await extractPdfPages(nativePdf);
  assert.equal(nativeExtract.pages[0].extraction_method, "NATIVE_TEXT", "6: native text method");
  assert.equal(nativeExtract.pages[0].quality_status, "GOOD");
  assert.equal(nativeExtract.pages[0].ocr_attempted, false, "8: OCR not attempted on good native page");
  assert.equal(ocrRecognizeCalls, 0, "8: OCR not invoked");

  resetOcrTestHooks();
  const scanned = await buildScannedPdf();
  const scannedExtract = await extractPdfPages(scanned, { ocrTimeoutMs: 45_000 });
  const recovered = scannedExtract.pages.map((p) => p.text).join(" ");
  assert.match(recovered, /EQUINE MEDICAL COVERAGE/i, "7: real OCR recovered known text");
  assert.equal(scannedExtract.pages[0].extraction_method, "OCR", "7: OCR selected for image-only page");
  assert.equal(scannedExtract.pages[0].ocr_attempted, true);
  assert.equal(scannedExtract.pages[0].ocr_succeeded, true);
  assert.ok(ocrRecognizeCalls >= 1, "7: OCR engine invoked");

  resetOcrTestHooks();
  setOcrRecognizeForTests(async () => {
    await new Promise((_, reject) => {
      setTimeout(() => reject(new Error("OCR test delay")), 200);
    });
    return "";
  });
  const timed = await extractPdfPages(scanned, { ocrTimeoutMs: 40 });
  assert.equal(timed.pages[0].ocr_attempted, true, "9: OCR attempted");
  assert.equal(timed.pages[0].ocr_succeeded, false, "9: OCR did not succeed");
  assert.ok(timed.extraction_status === "ocr_required" || timed.extraction_status === "partial", "9: conservative status");
  assert.notEqual(timed.extraction_status, "extracted");
  const timedDoc = docFromPages(timed.pages, { extraction_status: timed.extraction_status });
  const timedReport = analyzeDocuments(newId(), timedDoc.session_id, [timedDoc]);
  assert.equal(timedReport.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE", "9: incomplete package");
  resetOcrTestHooks();

  const noisy =
    "This policy provides Full Mortality coverage for the insured horse. " + "!@#$%^&*()[]{}".repeat(40);
  const lowReport = analyzeDocuments(newId(), newId(), [
    docFromPages([{ page: 1, text: noisy }], { extraction_status: "partial" })
  ]);
  const mort = lowReport.coverages.find((c) => c.coverage_type === "Full Mortality");
  assert.ok(mort);
  assert.notEqual(mort.coverage_status, "COVERED", "10: low-quality text cannot create COVERED");
  assert.notEqual(mort.coverage_status, "COVERED WITH LIMITATIONS");

  const original = await resolveOriginalPdf(pack.policy_id, saved.documents[1].document_id);
  assert.ok(original, "11: belonging document is returned");
  assert.ok(original.bytes.slice(0, 5).toString() === "%PDF-");
  const headers = originalFileHeaders(original.filename);
  assert.equal(headers["Content-Type"], "application/pdf");
  assert.match(headers["Content-Disposition"], /form\.pdf/i);
  assert.equal(headers["Cache-Control"], "private, no-store");
  assert.equal(headers["X-Robots-Tag"], "noindex, nofollow");

  const other = await ingestPolicyPackage([{ filename: "other.pdf", bytes: second }]);
  const otherRec = await loadPolicyRecord(other.policy_id);
  assert.ok(otherRec);
  const wrong = await resolveOriginalPdf(pack.policy_id, otherRec.documents[0].document_id);
  assert.equal(wrong, null, "11: foreign document id is not returned");
  assert.equal(findPolicyDocument(saved, otherRec.documents[0].document_id), undefined);

  const multiline = analyzeDocuments(newId(), newId(), [
    docFromPages([
      {
        page: 1,
        text: [
          "Declarations",
          "Policy Number: EQ-ML-1",
          "Named Insured: Ada Cole",
          "Forms and Endorsements",
          "EQ-MED-200",
          "EQ MED 200",
          "IL 00 17 11 98",
          "CG 00 01",
          "EQ-MORT-100 07 24"
        ].join("\n")
      }
    ])
  ]);
  const printed = multiline.form_inventory.map((f: PolicyFormRecord) => f.printed_identifier);
  assert.ok(printed.some((p) => p === "EQ-MED-200" || p === "EQ MED 200"), "12: multiline schedule parsed");
  assert.ok(printed.some((p) => /IL 00 17 11 98/.test(p)), "12: ISO form with spaces");
  assert.ok(printed.some((p) => p === "CG 00 01"), "12: CG 00 01");
  assert.ok(!printed.some((p) => /EQ-ML-1/.test(p)), "12: policy number is not a form");
  assert.equal(multiline.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE");

  const hyphenSpace = analyzeDocuments(newId(), newId(), [
    docFromPages([
      {
        page: 1,
        text: "Declarations\nPolicy Number: EQ-HS-1\nNamed Insured: Ada Cole\nForms and Endorsements\nEQ MED 200"
      },
      {
        page: 2,
        text: "Major Medical Endorsement EQ-MED-200\nThis endorsement provides Major Medical coverage with a limit of $5,000."
      }
    ])
  ]);
  const med = hyphenSpace.form_inventory.find((f) => normalizeFormId(f.printed_identifier) === "EQMED200");
  assert.ok(med, "13: listed identifier retained");
  assert.equal(med?.printed_identifier, "EQ MED 200", "13: printed form kept as extracted");
  assert.equal(med?.status, "PRESENT", "13: hyphenated and space-delimited identifiers match");
  assert.ok(med?.match_page && med.match_page !== med.listing_page);

  const mismatch = analyzeDocuments(newId(), newId(), [
    docFromPages([
      {
        page: 1,
        text: "Declarations\nPolicy Number: EQ-ED-1\nNamed Insured: Ada Cole\nForms: EQ-MORT-100 Ed. 07 24"
      },
      {
        page: 2,
        text: "Form EQ-MORT-100 Ed. 01 23\nThis policy provides Full Mortality coverage for the insured horse."
      }
    ])
  ]);
  const mortForm = mismatch.form_inventory.find((f) => normalizeFormId(f.printed_identifier) === "EQMORT100");
  assert.equal(mortForm?.status, "EDITION MISMATCH", "14: edition mismatch remains detected");
  assert.equal(mismatch.completeness.status, "DOCUMENT PACKAGE MAY BE INCOMPLETE");

  const fixturePdf = await buildFixturePdf();
  const fixtureExtract = await extractPdfPages(fixturePdf);
  const fixtureDoc = docFromPages(fixtureExtract.pages, {
    original_filename: "fixture.pdf",
    extraction_status: "extracted"
  });
  const fixture = analyzeDocuments(newId(), fixtureDoc.session_id, [fixtureDoc]);
  assert.equal(fixture.identification.policy_number?.value, "EQ-2026-44119", "15: fixture policy");
  assert.equal(fixture.coverages.find((c) => c.coverage_type === "Full Mortality")?.coverage_status, "COVERED");
  assert.equal(fixture.coverages.find((c) => c.coverage_type === "Loss of Use")?.coverage_status, "EXCLUDED");
  const listedOnly = fixture.form_inventory.find((f) => f.printed_identifier === "EQ-MED-200");
  assert.equal(listedOnly?.status, "MISSING", "15: list-only form is not PRESENT");

  await deletePolicyRecord(pack.policy_id);
  await deletePolicyRecord(other.policy_id);

  console.log("INGESTION REGRESSION OK", {
    documents: 2,
    ocr_phrase: SCANNED_PDF_PHRASE,
    form_ids: printed
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { shutdownOcr } = await import("../lib/ocr");
    await shutdownOcr();
  });
