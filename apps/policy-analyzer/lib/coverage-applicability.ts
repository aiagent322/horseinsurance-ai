import {
  isDeclarationsOrScheduleRole,
  isEndorsementOrOptionalRole,
  segmentLogicalForms,
  type LogicalFormSegment
} from "./form-segmentation";
import {
  coverageSelectionTerms,
  hasIssuedCoverageSelection,
  looksLikeDeclarationsPage,
  textHasIssuedApplicabilityGate
} from "./policy-semantics";
import type { PageText } from "./types";

export type ApplicabilityPage = {
  page: number;
  text: string;
  document_id: string;
};

function uniqueDocumentPages(pages: ApplicabilityPage[]): ApplicabilityPage[] {
  const seen = new Set<string>();
  const out: ApplicabilityPage[] = [];
  for (const page of pages) {
    const key = `${page.document_id}:${page.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(page);
  }
  return out.sort((a, b) => {
    const byDoc = a.document_id.localeCompare(b.document_id);
    if (byDoc !== 0) return byDoc;
    return a.page - b.page;
  });
}

function pagesByDocument(pages: ApplicabilityPage[]): Map<string, ApplicabilityPage[]> {
  const grouped = new Map<string, ApplicabilityPage[]>();
  for (const page of uniqueDocumentPages(pages)) {
    const list = grouped.get(page.document_id) || [];
    list.push(page);
    grouped.set(page.document_id, list);
  }
  return grouped;
}

function asPageText(pages: ApplicabilityPage[]): PageText[] {
  return pages.map((page) => ({ page: page.page, text: page.text }));
}

function formContainingPage(
  segments: LogicalFormSegment[],
  pageNumber: number
): LogicalFormSegment | undefined {
  return segments.find(
    (segment) => pageNumber >= segment.page_start && pageNumber <= segment.page_end
  );
}

function formCorpus(pages: ApplicabilityPage[], segment: LogicalFormSegment): string {
  return pages
    .filter((page) => page.page >= segment.page_start && page.page <= segment.page_end)
    .map((page) => page.text)
    .join("\n");
}

export function collectDeclarationsScheduleText(pages: ApplicabilityPage[]): string {
  const grouped = pagesByDocument(pages);
  const chunks: string[] = [];
  for (const [, docPages] of grouped) {
    const segments = segmentLogicalForms(asPageText(docPages));
    for (const page of docPages) {
      const form = formContainingPage(segments, page.page);
      if (form && isEndorsementOrOptionalRole(form.role)) continue;
      if (form && isDeclarationsOrScheduleRole(form.role)) {
        chunks.push(page.text);
        continue;
      }
      const head = page.text.slice(0, 600);
      if (/\bdeclarations page\b/i.test(head) || /(?:^|\n)\s*declarations\s*$/im.test(head)) {
        chunks.push(page.text);
        continue;
      }
      if (looksLikeDeclarationsPage(page.text)) chunks.push(page.text);
    }
  }
  return chunks.join("\n");
}

export function optionalFormApplicabilityUnresolved(
  grantPage: ApplicabilityPage,
  pages: ApplicabilityPage[],
  coverageNames: string[]
): boolean {
  const docPages = uniqueDocumentPages(pages).filter((page) => page.document_id === grantPage.document_id);
  const segments = segmentLogicalForms(asPageText(docPages));
  const form = formContainingPage(segments, grantPage.page);
  const formText = form ? formCorpus(docPages, form) : grantPage.text;
  const optionalForm = form
    ? isEndorsementOrOptionalRole(form.role)
    : /\bthis endorsement\b/i.test(formText) || /(?:^|\n)\s*endorsement\b/i.test(formText);
  if (!optionalForm) return false;
  if (!textHasIssuedApplicabilityGate(formText)) return false;
  const terms = coverageSelectionTerms(coverageNames, form?.title);
  const gated = formText.match(/premium charge for\s+(.+?)\s+is indicated/i);
  if (gated?.[1]) terms.push(...coverageSelectionTerms([gated[1]]));
  const indicated = formText.match(/for which\s+(.+?)\s+is specifically indicated/i);
  if (indicated?.[1]) terms.push(...coverageSelectionTerms([indicated[1]]));
  const decls = collectDeclarationsScheduleText(pages);
  if (hasIssuedCoverageSelection(decls, terms)) return false;
  return true;
}
