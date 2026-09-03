import { PDFParse } from "pdf-parse";
import {
  assessTextQuality,
  documentExtractionStatus,
  EXTRACTION_QUALITY,
  selectBetterExtraction,
  type TextQuality
} from "./extraction-quality";
import { OcrCancelledError, OcrTimeoutError, recognizePageImageWithTimeout, remainingOcrBudget } from "./ocr";
import type { PageText } from "./types";

export type ExtractPdfOptions = {
  enableOcr?: boolean;
  ocrTimeoutMs?: number;
  signal?: AbortSignal;
};

export type ExtractedPdf = {
  page_count: number;
  pages: PageText[];
  full_text: string;
  extraction_status: "extracted" | "partial" | "ocr_required" | "failed";
  ocr_timed_out: boolean;
};

export let extractPdfInvocations = 0;

export function resetExtractPdfInvocations(): void {
  extractPdfInvocations = 0;
}

function nativePage(num: number, text: string): PageText {
  const cleaned = (text || "").replace(/\u0000/g, "").trim();
  const q = assessTextQuality(cleaned);
  return diagnostics(num, cleaned, "NATIVE_TEXT", q, {
    ocr_attempted: false,
    ocr_succeeded: false,
    extraWarnings: []
  });
}

function diagnostics(
  page: number,
  text: string,
  method: PageText["extraction_method"],
  q: TextQuality,
  flags: { ocr_attempted: boolean; ocr_succeeded: boolean; extraWarnings: string[] }
): PageText {
  const confidence =
    q.quality_status === "GOOD" ? (method === "OCR" ? "MEDIUM" : "HIGH") : "LOW";
  return {
    page,
    text,
    extraction_method: method || "NATIVE_TEXT",
    character_count: q.character_count,
    word_count: q.word_count,
    alphanumeric_ratio: q.alphanumeric_ratio,
    quality_status: q.quality_status,
    ocr_attempted: flags.ocr_attempted,
    ocr_succeeded: flags.ocr_succeeded,
    diagnostic_warnings: [...q.warnings, ...flags.extraWarnings],
    confidence
  };
}

async function screenshotPage(parser: PDFParse, pageNumber: number): Promise<Buffer | null> {
  const shots = await parser.getScreenshot({
    partial: [pageNumber],
    imageBuffer: true,
    imageDataUrl: false,
    scale: EXTRACTION_QUALITY.OCR_RENDER_SCALE
  });
  const shot = shots.pages[0];
  if (!shot?.data?.length) return null;
  return Buffer.from(shot.data);
}

export async function extractPdfPages(
  buf: Buffer,
  options: ExtractPdfOptions = {}
): Promise<ExtractedPdf> {
  extractPdfInvocations += 1;
  const enableOcr = options.enableOcr !== false;
  const ocrTimeoutMs = options.ocrTimeoutMs ?? EXTRACTION_QUALITY.OCR_DOCUMENT_TIMEOUT_MS;
  const signal = options.signal;
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const started = Date.now();
  let ocrTimedOut = false;
  try {
    if (signal?.aborted) throw new OcrCancelledError();
    const result = await parser.getText({ cellSeparator: "\t" });
    const pages: PageText[] = result.pages.map((p) => nativePage(p.num, p.text || ""));

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (page.quality_status === "GOOD") continue;
      if (!enableOcr) continue;
      if (signal?.aborted) throw new OcrCancelledError();
      if (ocrTimedOut) {
        pages[i] = {
          ...page,
          ocr_attempted: true,
          ocr_succeeded: false,
          diagnostic_warnings: [
            ...(page.diagnostic_warnings || []),
            "OCR was not run because the document OCR budget was exhausted."
          ]
        };
        continue;
      }

      const budget = remainingOcrBudget(started, ocrTimeoutMs);
      try {
        const image = await screenshotPage(parser, page.page);
        if (!image) {
          pages[i] = {
            ...page,
            ocr_attempted: true,
            ocr_succeeded: false,
            diagnostic_warnings: [
              ...(page.diagnostic_warnings || []),
              "OCR could not render this page."
            ]
          };
          continue;
        }
        const ocrText = await recognizePageImageWithTimeout(image, budget, signal);
        const chosen = selectBetterExtraction(page.text, ocrText);
        const q = chosen.method === "OCR" ? chosen.ocr : chosen.native;
        pages[i] = diagnostics(page.page, chosen.text, chosen.method, q, {
          ocr_attempted: true,
          ocr_succeeded: true,
          extraWarnings:
            chosen.method === "OCR"
              ? ["OCR text was selected because it scored higher than native text."]
              : ["OCR ran but native text was retained."]
        });
      } catch (err) {
        if (err instanceof OcrCancelledError || (err instanceof Error && err.name === "OcrCancelledError")) {
          throw err;
        }
        const timedOut = err instanceof OcrTimeoutError || (err instanceof Error && err.name === "OcrTimeoutError");
        if (timedOut) ocrTimedOut = true;
        pages[i] = {
          ...page,
          ocr_attempted: true,
          ocr_succeeded: false,
          diagnostic_warnings: [
            ...(page.diagnostic_warnings || []),
            timedOut ? "OCR timed out for this page." : "OCR failed for this page."
          ]
        };
      }
    }

    const extraction_status = documentExtractionStatus(pages, { ocrTimedOut });
    return {
      page_count: result.total || pages.length,
      pages,
      full_text: pages.map((p) => p.text).join("\n\n"),
      extraction_status,
      ocr_timed_out: ocrTimedOut
    };
  } finally {
    await parser.destroy();
  }
}
