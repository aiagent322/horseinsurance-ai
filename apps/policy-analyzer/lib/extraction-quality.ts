import type { Confidence, ExtractionMethod, PageQualityStatus, PageText } from "./types";

/**
 * Central extraction-quality thresholds.
 *
 * Keep every numeric cutoff here. Callers must not invent local magic numbers
 * for “is this page readable policy language?”
 *
 * LOW-text title or signature pages may be real, but they are not reliable
 * enough to establish coverage. Policy conclusions use GOOD pages only.
 */
export const EXTRACTION_QUALITY = {
  /** Below this character count a page is UNREADABLE. */
  UNREADABLE_MAX_CHARS: 20,
  /** Below this alphanumeric ratio a page cannot be treated as language. */
  UNREADABLE_MAX_ALPHANUMERIC_RATIO: 0.15,
  /** GOOD pages must meet all three floors. */
  GOOD_MIN_CHARS: 24,
  GOOD_MIN_WORDS: 4,
  GOOD_MIN_ALPHANUMERIC_RATIO: 0.5,
  /** OCR may run when native text is not GOOD. */
  OCR_MIN_IMPROVEMENT_CHARS: 8,
  /** Per-document OCR wall clock. */
  OCR_DOCUMENT_TIMEOUT_MS: 60_000,
  /** Global OCR worker concurrency. */
  OCR_MAX_CONCURRENCY: 1,
  /** Render scale for OCR screenshots. */
  OCR_RENDER_SCALE: 2
} as const;

export type TextQuality = {
  character_count: number;
  word_count: number;
  alphanumeric_ratio: number;
  quality_status: PageQualityStatus;
  confidence: Confidence;
  warnings: string[];
};

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function alphanumericRatio(text: string): number {
  if (!text.length) return 0;
  const alnum = (text.match(/[A-Za-z0-9]/g) || []).length;
  return alnum / text.length;
}

export function assessTextQuality(text: string): TextQuality {
  const character_count = text.length;
  const word_count = countWords(text);
  const alphanumeric_ratio = alphanumericRatio(text);
  const warnings: string[] = [];

  let quality_status: PageQualityStatus;
  if (
    character_count < EXTRACTION_QUALITY.UNREADABLE_MAX_CHARS ||
    (character_count > 0 && alphanumeric_ratio < EXTRACTION_QUALITY.UNREADABLE_MAX_ALPHANUMERIC_RATIO)
  ) {
    quality_status = "UNREADABLE";
    warnings.push("Page text is too short or too noisy to treat as policy language.");
  } else if (
    character_count >= EXTRACTION_QUALITY.GOOD_MIN_CHARS &&
    word_count >= EXTRACTION_QUALITY.GOOD_MIN_WORDS &&
    alphanumeric_ratio >= EXTRACTION_QUALITY.GOOD_MIN_ALPHANUMERIC_RATIO
  ) {
    quality_status = "GOOD";
  } else {
    quality_status = "LOW";
    warnings.push("Page text is below the GOOD extraction threshold.");
  }

  const confidence: Confidence =
    quality_status === "GOOD" ? "HIGH" : quality_status === "LOW" ? "LOW" : "LOW";

  return {
    character_count,
    word_count,
    alphanumeric_ratio: Number(alphanumeric_ratio.toFixed(4)),
    quality_status,
    confidence,
    warnings
  };
}

export function qualityRank(status: PageQualityStatus): number {
  if (status === "GOOD") return 2;
  if (status === "LOW") return 1;
  return 0;
}

export function scoreExtraction(text: string, status: PageQualityStatus): number {
  return qualityRank(status) * 10_000 + text.trim().length;
}

export function selectBetterExtraction(
  nativeText: string,
  ocrText: string
): { text: string; method: ExtractionMethod; native: TextQuality; ocr: TextQuality } {
  const native = assessTextQuality(nativeText);
  const ocr = assessTextQuality(ocrText);
  if (scoreExtraction(ocrText, ocr.quality_status) > scoreExtraction(nativeText, native.quality_status)) {
    return { text: ocrText, method: "OCR", native, ocr };
  }
  return { text: nativeText, method: "NATIVE_TEXT", native, ocr };
}

export function hydratePageDiagnostics(page: PageText): PageText {
  if (page.quality_status && page.character_count !== undefined) return page;
  const q = assessTextQuality(page.text || "");
  return {
    ...page,
    text: page.text || "",
    extraction_method: page.extraction_method || "NATIVE_TEXT",
    character_count: q.character_count,
    word_count: q.word_count,
    alphanumeric_ratio: q.alphanumeric_ratio,
    quality_status: q.quality_status,
    ocr_attempted: page.ocr_attempted ?? false,
    ocr_succeeded: page.ocr_succeeded ?? false,
    diagnostic_warnings: page.diagnostic_warnings || q.warnings,
    confidence: page.confidence || q.confidence
  };
}

export function isReliablePolicyPage(page: PageText): boolean {
  return hydratePageDiagnostics(page).quality_status === "GOOD";
}

export function documentExtractionStatus(
  pages: PageText[],
  flags: { ocrTimedOut?: boolean } = {}
): "extracted" | "partial" | "ocr_required" | "failed" {
  if (!pages.length) return "failed";
  const hydrated = pages.map(hydratePageDiagnostics);
  const good = hydrated.filter((p) => p.quality_status === "GOOD").length;
  const ocrFailed = hydrated.some((p) => p.ocr_attempted && !p.ocr_succeeded);
  const stillWeak = hydrated.filter((p) => p.quality_status !== "GOOD");

  if (good === hydrated.length) return "extracted";
  if (good === 0) {
    if (flags.ocrTimedOut || ocrFailed || stillWeak.some((p) => !p.ocr_succeeded)) return "ocr_required";
    return "failed";
  }
  return "partial";
}

export function pageMethodCounts(pages: PageText[]): {
  native: number;
  ocr: number;
  low_or_unreadable: number;
} {
  let native = 0;
  let ocr = 0;
  let low_or_unreadable = 0;
  for (const raw of pages) {
    const p = hydratePageDiagnostics(raw);
    if (p.extraction_method === "OCR") ocr += 1;
    else native += 1;
    if (p.quality_status !== "GOOD") low_or_unreadable += 1;
  }
  return { native, ocr, low_or_unreadable };
}
