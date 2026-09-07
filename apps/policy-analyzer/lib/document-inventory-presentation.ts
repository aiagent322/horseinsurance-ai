import { hydratePageDiagnostics } from "./extraction-quality";
import { formatPageLocator } from "./policy-semantics";
import type { DocumentClass, DocumentRecord, PageQualityStatus, PageText } from "./types";

/**
 * Customer-facing Policy Document Inventory copy.
 * Internal extraction diagnostics (native vs OCR counts, SHA-256, parser status)
 * stay on the document record and are not returned here.
 */

export const ORIGINAL_FILE_ACTION_LABEL = "Original file";
export const UNKNOWN_DOCUMENT_LABEL = "Document type could not be determined";
export const ALL_PAGES_READABLE_MESSAGE = "All pages were readable.";
export const SCANNED_PAGES_RECOVERED_MESSAGE = "Text was recovered from scanned pages.";
export const MIXED_SCANNED_PAGES_MESSAGE = "Some pages required image-based text recognition.";
export const DOCUMENT_UNREADABLE_MESSAGE = "This document could not be analyzed reliably.";

export type InventoryReadabilityKind = "READABLE" | "PARTIALLY_READABLE" | "UNREADABLE";

export type DocumentInventoryPresentation = {
  filename: string;
  displayClassification: string;
  pageLabel: string;
  classificationAndPages: string;
  readabilityKind: InventoryReadabilityKind;
  readabilityMessage: string;
  showReadabilityMessage: boolean;
  originalFileLabel: string;
};

type InventoryDocument = Pick<
  DocumentRecord,
  "original_filename" | "classification" | "page_count" | "pages" | "extraction_status"
>;

export function formatInventoryPageCount(count: number): string {
  return count === 1 ? "1 page" : `${Math.max(0, count)} pages`;
}

export function displayDocumentClassification(classification: DocumentClass | string): string {
  if (!classification || classification === "Unknown Document") return UNKNOWN_DOCUMENT_LABEL;
  return classification;
}

function declaredPageCount(doc: InventoryDocument): number {
  const numbered = (doc.pages || []).map((page) => page.page).filter((page) => Number.isInteger(page) && page > 0);
  const maxPage = numbered.length ? Math.max(...numbered) : 0;
  return Math.max(doc.page_count || 0, maxPage, (doc.pages || []).length);
}

function pageByNumber(pages: PageText[]): Map<number, PageText> {
  const map = new Map<number, PageText>();
  for (const page of pages || []) {
    if (Number.isInteger(page.page) && page.page > 0) map.set(page.page, hydratePageDiagnostics(page));
  }
  return map;
}

function locatorForCustomer(pages: number[]): string {
  return formatPageLocator(pages);
}

function limitedQualityMessage(unreliablePages: number[]): string {
  if (unreliablePages.length <= 1) return "Text quality was limited.";
  const lower = locatorForCustomer(unreliablePages).replace(/^Pages /, "pages ").replace(/^Page /, "page ");
  return `Text quality was limited on ${lower}.`;
}

function allListedHaveStatus(pages: Map<number, PageText>, pageNumbers: number[], status: PageQualityStatus): boolean {
  return pageNumbers.length > 0 && pageNumbers.every((page) => pages.get(page)?.quality_status === status);
}

function partialReadabilityMessage(
  readableCount: number,
  total: number,
  unreliablePages: number[],
  pages: Map<number, PageText>
): string {
  const prefix = `${readableCount} of ${total} pages were readable. `;
  if (allListedHaveStatus(pages, unreliablePages, "LOW")) {
    const lower = locatorForCustomer(unreliablePages).replace(/^Pages /, "pages ").replace(/^Page /, "page ");
    return `${prefix}Text quality was limited on ${lower}.`;
  }
  return `${prefix}${locatorForCustomer(unreliablePages)} could not be analyzed reliably.`;
}

export function describeDocumentInventory(doc: InventoryDocument): DocumentInventoryPresentation {
  const filename = doc.original_filename || "Uploaded document";
  const displayClassification = displayDocumentClassification(doc.classification);
  const total = declaredPageCount(doc);
  const pageLabel = formatInventoryPageCount(total);
  const pages = pageByNumber(doc.pages || []);
  const pageNumbers = total > 0 ? Array.from({ length: total }, (_, i) => i + 1) : [];
  const unreliablePages = pageNumbers.filter((page) => pages.get(page)?.quality_status !== "GOOD");
  const readableCount = total - unreliablePages.length;
  const ocrRecovered = pageNumbers.filter((page) => {
    const rec = pages.get(page);
    return rec?.quality_status === "GOOD" && rec.extraction_method === "OCR";
  }).length;

  let readabilityKind: InventoryReadabilityKind;
  let readabilityMessage: string;
  if (total === 0 || readableCount === 0) {
    readabilityKind = "UNREADABLE";
    readabilityMessage = allListedHaveStatus(pages, pageNumbers, "LOW")
      ? limitedQualityMessage(pageNumbers)
      : DOCUMENT_UNREADABLE_MESSAGE;
  } else if (unreliablePages.length === 0) {
    readabilityKind = "READABLE";
    if (ocrRecovered === total && total > 0) readabilityMessage = SCANNED_PAGES_RECOVERED_MESSAGE;
    else if (ocrRecovered > 0) readabilityMessage = MIXED_SCANNED_PAGES_MESSAGE;
    else readabilityMessage = ALL_PAGES_READABLE_MESSAGE;
  } else {
    readabilityKind = "PARTIALLY_READABLE";
    readabilityMessage = partialReadabilityMessage(readableCount, total, unreliablePages, pages);
  }

  return {
    filename,
    displayClassification,
    pageLabel,
    classificationAndPages: `${displayClassification} · ${pageLabel}`,
    readabilityKind,
    readabilityMessage,
    showReadabilityMessage: true,
    originalFileLabel: ORIGINAL_FILE_ACTION_LABEL
  };
}

export function customerDocumentInventoryLines(doc: InventoryDocument): string[] {
  const item = describeDocumentInventory(doc);
  const lines = [item.filename, item.classificationAndPages];
  if (item.showReadabilityMessage) lines.push(item.readabilityMessage);
  lines.push(item.originalFileLabel);
  return lines;
}

export function customerDocumentInventoryText(doc: InventoryDocument): string {
  return customerDocumentInventoryLines(doc).join("\n");
}
