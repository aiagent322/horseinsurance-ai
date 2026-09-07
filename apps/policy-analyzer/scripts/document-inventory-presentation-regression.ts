import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import {
  ALL_PAGES_READABLE_MESSAGE,
  DOCUMENT_UNREADABLE_MESSAGE,
  ORIGINAL_FILE_ACTION_LABEL,
  SCANNED_PAGES_RECOVERED_MESSAGE,
  customerDocumentInventoryText,
  describeDocumentInventory
} from "../lib/document-inventory-presentation";
import { describeReportActionControls } from "../lib/report-actions";
import { newId } from "../lib/store";
import type { DocumentClass, DocumentRecord, ExtractionMethod, PageQualityStatus, PageText } from "../lib/types";
import { EQUINE_MORTALITY_JACKET_PAGES } from "./fixtures/equine-mortality-jacket";

const INTERNAL_INVENTORY = /extraction extracted|native text|OCR selected|SHA-256|no low-quality pages|low-quality or unreadable pages/i;

const here = dirname(fileURLToPath(import.meta.url));
const reportViewSource = readFileSync(join(here, "../components/report-view.tsx"), "utf8");
const helperSource = readFileSync(join(here, "../lib/document-inventory-presentation.ts"), "utf8");

function page(opts: {
  page: number;
  method?: ExtractionMethod;
  quality?: PageQualityStatus;
  text?: string;
}): PageText {
  const quality = opts.quality || "GOOD";
  const text =
    opts.text ??
    (quality === "GOOD"
      ? "The Company will indemnify the Insured upon the death of an insured horse resulting from accident or injury."
      : quality === "LOW"
        ? "abc def"
        : "");
  return {
    page: opts.page,
    text,
    extraction_method: opts.method || "NATIVE_TEXT",
    quality_status: quality,
    character_count: text.length
  };
}

function doc(opts: {
  filename: string;
  classification?: DocumentClass;
  pageCount: number;
  pages: PageText[];
  hash?: string;
  extractionStatus?: DocumentRecord["extraction_status"];
}): DocumentRecord {
  const pages = opts.pages;
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: opts.filename,
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: opts.hash || "0b3dc4935f68deadbeefcafebabe",
    page_count: opts.pageCount,
    storage_location: "memory",
    extraction_status: opts.extractionStatus || "extracted",
    analysis_status: "complete",
    classification: opts.classification || "Base Policy Form",
    pages
  };
}

function assertHidesInternals(text: string, record?: DocumentRecord): void {
  assert.doesNotMatch(text, INTERNAL_INVENTORY);
  assert.doesNotMatch(text, /\bOCR\b/);
  assert.doesNotMatch(text, /extraction (extracted|failed|partial|pending|ocr_required)/i);
  if (record?.file_hash) {
    assert.ok(!text.includes(record.file_hash));
    assert.ok(!text.includes(record.file_hash.slice(0, 12)));
  }
}

function main() {
  const native = doc({
    filename: "policy.pdf",
    pageCount: 4,
    pages: [1, 2, 3, 4].map((n) => page({ page: n, method: "NATIVE_TEXT", quality: "GOOD" }))
  });
  const nativeView = describeDocumentInventory(native);
  const nativeText = customerDocumentInventoryText(native);
  assert.equal(nativeView.displayClassification, "Base Policy Form");
  assert.equal(nativeView.pageLabel, "4 pages");
  assert.equal(nativeView.classificationAndPages, "Base Policy Form · 4 pages");
  assert.equal(nativeView.readabilityKind, "READABLE");
  assert.equal(nativeView.readabilityMessage, ALL_PAGES_READABLE_MESSAGE);
  assert.equal(nativeView.originalFileLabel, ORIGINAL_FILE_ACTION_LABEL);
  assert.match(nativeText, /Base Policy Form/);
  assert.match(nativeText, /4 pages/);
  assert.match(nativeText, /All pages were readable/);
  assertHidesInternals(nativeText, native);
  assert.equal(native.file_hash, "0b3dc4935f68deadbeefcafebabe");
  assert.equal(native.pages.filter((item) => item.extraction_method === "NATIVE_TEXT").length, 4);
  console.log("TEST A OK — native digital PDF");

  const scanned = doc({
    filename: "scanned.pdf",
    pageCount: 3,
    extractionStatus: "extracted",
    pages: [1, 2, 3].map((n) => page({ page: n, method: "OCR", quality: "GOOD" }))
  });
  const scannedView = describeDocumentInventory(scanned);
  const scannedText = customerDocumentInventoryText(scanned);
  assert.equal(scannedView.pageLabel, "3 pages");
  assert.equal(scannedView.readabilityKind, "READABLE");
  assert.equal(scannedView.readabilityMessage, SCANNED_PAGES_RECOVERED_MESSAGE);
  assert.doesNotMatch(scannedText, /OCR selected/);
  assertHidesInternals(scannedText, scanned);
  assert.equal(scanned.pages.filter((item) => item.extraction_method === "OCR").length, 3);
  console.log("TEST B OK — scanned PDF");

  const partial = doc({
    filename: "partial.pdf",
    pageCount: 5,
    extractionStatus: "partial",
    pages: [
      ...[1, 2, 3, 4].map((n) => page({ page: n, quality: "GOOD" })),
      page({ page: 5, quality: "UNREADABLE" })
    ]
  });
  const partialView = describeDocumentInventory(partial);
  const partialText = customerDocumentInventoryText(partial);
  assert.equal(partialView.pageLabel, "5 pages");
  assert.equal(partialView.readabilityKind, "PARTIALLY_READABLE");
  assert.match(partialView.readabilityMessage, /4 of 5 pages were readable/);
  assert.match(partialView.readabilityMessage, /Page 5 could not be analyzed reliably/);
  assertHidesInternals(partialText, partial);
  console.log("TEST C OK — partial readability");

  const failed = doc({
    filename: "unreadable.pdf",
    pageCount: 2,
    extractionStatus: "failed",
    pages: [1, 2].map((n) => page({ page: n, quality: "UNREADABLE" }))
  });
  const failedView = describeDocumentInventory(failed);
  const failedText = customerDocumentInventoryText(failed);
  assert.equal(failedView.readabilityKind, "UNREADABLE");
  assert.equal(failedView.readabilityMessage, DOCUMENT_UNREADABLE_MESSAGE);
  assert.equal(failedView.originalFileLabel, "Original file");
  assertHidesInternals(failedText, failed);
  console.log("TEST D OK — complete failure");

  const hashed = doc({
    filename: "hashed.pdf",
    pageCount: 1,
    hash: "0b3dc4935f68aabbccddeeff00112233",
    pages: [page({ page: 1, quality: "GOOD" })]
  });
  const hashedText = customerDocumentInventoryText(hashed);
  assert.equal(hashed.file_hash, "0b3dc4935f68aabbccddeeff00112233");
  assert.doesNotMatch(hashedText, /SHA-256/i);
  assert.ok(!hashedText.includes("0b3dc4935f68"));
  assert.ok(!hashedText.includes(hashed.file_hash));
  assertHidesInternals(hashedText, hashed);
  console.log("TEST E OK — hash retained internally, hidden customer-facing");

  const pack = [
    doc({ filename: "policy.pdf", classification: "Base Policy Form", pageCount: 12, pages: [page({ page: 1 })] }),
    doc({ filename: "declarations.pdf", classification: "Declarations", pageCount: 2, pages: [page({ page: 1 })] }),
    doc({
      filename: "endorsement-1.pdf",
      classification: "Mortality Endorsement",
      pageCount: 1,
      pages: [page({ page: 1, quality: "LOW" })]
    })
  ];
  pack[0].pages = Array.from({ length: 12 }, (_, i) => page({ page: i + 1 }));
  pack[1].pages = [page({ page: 1 }), page({ page: 2 })];
  const packViews = pack.map((item) => describeDocumentInventory(item));
  assert.equal(packViews.length, 3);
  assert.deepEqual(
    packViews.map((item) => item.filename),
    ["policy.pdf", "declarations.pdf", "endorsement-1.pdf"]
  );
  assert.equal(packViews[0].classificationAndPages, "Base Policy Form · 12 pages");
  assert.equal(packViews[1].classificationAndPages, "Declarations · 2 pages");
  assert.equal(packViews[2].classificationAndPages, "Mortality Endorsement · 1 page");
  assert.equal(packViews[0].readabilityMessage, ALL_PAGES_READABLE_MESSAGE);
  assert.equal(packViews[1].readabilityMessage, ALL_PAGES_READABLE_MESSAGE);
  assert.equal(packViews[2].readabilityKind, "UNREADABLE");
  assert.equal(packViews[2].readabilityMessage, "Text quality was limited.");
  assert.ok(packViews.every((item) => item.originalFileLabel === "Original file"));
  const actions = describeReportActionControls({ policyId: newId(), documentCount: pack.length });
  assert.equal(actions.showOriginalPdfShortcut, false);
  assert.match(
    reportViewSource,
    /\/api\/policies\/\$\{record\.policy_id\}\/documents\/\$\{d\.document_id\}\/original/
  );
  console.log("TEST F OK — multi-document package");

  const unknown = describeDocumentInventory(
    doc({ filename: "mystery.pdf", classification: "Unknown Document", pageCount: 1, pages: [page({ page: 1 })] })
  );
  assert.equal(unknown.displayClassification, "Document type could not be determined");

  const jacketPages = EQUINE_MORTALITY_JACKET_PAGES.map((item) => ({ ...item }));
  const jacketDoc: DocumentRecord = {
    document_id: newId(),
    session_id: newId(),
    original_filename: "Mortality_Policy_Jacket.pdf",
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "0b3dc4935f68controlhash",
    page_count: jacketPages.length,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: classifyPackage(jacketPages),
    pages: jacketPages.map((item) => ({ ...item, extraction_method: "NATIVE_TEXT" as const }))
  };
  const analyzed = analyzeDocuments(newId(), jacketDoc.session_id, [jacketDoc]);
  const control = describeDocumentInventory(analyzed.documents[0]);
  const controlText = customerDocumentInventoryText(analyzed.documents[0]);
  assert.equal(analyzed.documents[0].classification, "Base Policy Form");
  assert.equal(control.filename, "Mortality_Policy_Jacket.pdf");
  assert.equal(control.displayClassification, "Base Policy Form");
  assert.equal(control.pageLabel, "4 pages");
  assert.equal(control.readabilityMessage, ALL_PAGES_READABLE_MESSAGE);
  assert.equal(control.originalFileLabel, "Original file");
  assertHidesInternals(controlText, analyzed.documents[0]);
  assert.ok(analyzed.documents[0].file_hash);
  console.log("CONTROL OK — Mortality_Policy_Jacket.pdf inventory");

  assert.match(reportViewSource, /describeDocumentInventory/);
  assert.doesNotMatch(reportViewSource, INTERNAL_INVENTORY);
  assert.doesNotMatch(reportViewSource, /file_hash/);
  assert.doesNotMatch(helperSource, /Mortality_Policy_Jacket|Diamond State|AEM 200/);
  assert.doesNotMatch(reportViewSource, /First original PDF/);
  assert.doesNotMatch(reportViewSource, /\/auth\/sign-out/);

  console.log("DOCUMENT INVENTORY PRESENTATION REGRESSION OK");
}

main();
