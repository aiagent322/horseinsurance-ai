import {
  collectFormsScheduleText,
  extractFormIdsFromText,
  normalizeEdition,
  normalizeFormId,
  type ListedForm
} from "./form-schedule";
import {
  isDeclarationsHeading,
  looksLikeDeclarationsPage,
  policyFormSignalCount
} from "./policy-semantics";
import type { LogicalFormRole, PageText } from "./types";

export type LogicalFormSegment = {
  printed_identifier: string;
  normalized_identifier: string;
  edition?: string;
  title?: string;
  role: LogicalFormRole;
  page_start: number;
  page_end: number;
  start_text: string;
};

type PageIdentity = {
  printed: string;
  edition?: string;
  normalized: string;
};

const NUMERIC_EDITION_RE =
  /\b(\d{4,6})\s*[\(\[]\s*(?:ed(?:ition)?\.?\s*)?(\d{1,2}\s*[\/.-]\s*\d{2,4})\s*[\)\]]/gi;

const PAGE_OF_RE = /\bpage\s+(\d+)\s+of\s+(\d+)\b/i;

function textOf(page: PageText | { text?: string }): string {
  return String(page.text || "");
}

function stripFormsSchedule(text: string): string {
  const block = collectFormsScheduleText(text);
  if (!block) return text;
  return text.replace(block, " ");
}

function mentionWindow(hay: string, printed: string, pad = 80): string {
  const idx = hay.toLowerCase().indexOf(printed.toLowerCase());
  if (idx < 0) return hay.toLowerCase();
  return hay.slice(Math.max(0, idx - pad), idx + printed.length + pad).toLowerCase();
}

function isReferentialFormMention(hay: string, printed: string): boolean {
  const window = mentionWindow(hay, printed);
  return (
    /\bas (?:stated|shown|set forth|listed|specified) in\b/.test(window) ||
    /\bdeclarations form\b/.test(window) ||
    /\bhereinafter called the declarations\b/.test(window)
  );
}

function isLabeledNonFormIdentifier(hay: string, printed: string): boolean {
  const escaped = printed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const labeled = new RegExp(
    `\\b(?:registration number|registered name|policy number|policy no\\.?|named insured|insured horse)\\s*[:.#–—]?\\s*${escaped}\\b`,
    "i"
  );
  return labeled.test(hay);
}

function hasFormIdentityContext(hay: string, printed: string): boolean {
  const window = mentionWindow(hay, printed, 48);
  return (
    /\b(form|endorsement|policy form)\b/.test(window) ||
    /\bed(?:ition)?\.?\s/.test(window) ||
    PAGE_OF_RE.test(window)
  );
}

function collectNumericEditionIds(text: string): ListedForm[] {
  const out: ListedForm[] = [];
  const seen = new Set<string>();
  const copy = new RegExp(NUMERIC_EDITION_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = copy.exec(text))) {
    const printed = match[1];
    const edition = normalizeEdition(match[2]);
    const normalized = normalizeFormId(printed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({
      printed,
      edition,
      source_line: match[0].replace(/\s+/g, " ").trim()
    });
  }
  return out;
}

function scoreIdentity(text: string, item: ListedForm, numeric: boolean): number {
  const hay = text;
  const printed = item.printed;
  const idx = hay.toLowerCase().indexOf(printed.toLowerCase());
  const headerLen = Math.min(1200, hay.length);
  const footerStart = Math.max(0, hay.length - 1200);
  let score = numeric ? 6 : 2;
  if (item.edition) score += 2;
  if (idx >= 0 && idx < headerLen) score += 1;
  if (idx >= footerStart) score += 2;
  const around = idx >= 0 ? hay.slice(Math.max(0, idx - 40), idx + printed.length + 40) : "";
  if (PAGE_OF_RE.test(around) || PAGE_OF_RE.test(hay.slice(0, 200))) score += 2;
  if (isReferentialFormMention(hay, printed)) score -= 8;
  return score;
}

export function extractPageFormIdentity(text: string): PageIdentity | undefined {
  const stripped = stripFormsSchedule(text || "");
  if (!stripped.trim()) return undefined;

  const header = stripped.slice(0, 1200);
  const footer = stripped.length > 1400 ? stripped.slice(-1200) : "";
  const zones = [footer, header, stripped].filter(Boolean);

  const candidates: Array<{ item: ListedForm; score: number; numeric: boolean }> = [];
  for (const zone of zones) {
    for (const item of collectNumericEditionIds(zone)) {
      if (isLabeledNonFormIdentifier(stripped, item.printed)) continue;
      candidates.push({ item, numeric: true, score: scoreIdentity(stripped, item, true) });
    }
    for (const item of extractFormIdsFromText(zone)) {
      if (isLabeledNonFormIdentifier(stripped, item.printed)) continue;
      if (!hasFormIdentityContext(stripped, item.printed)) continue;
      candidates.push({ item, numeric: false, score: scoreIdentity(stripped, item, false) });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates.find((c) => c.score > 0);
  if (!best) return undefined;
  return {
    printed: best.item.printed,
    edition: best.item.edition,
    normalized: normalizeFormId(best.item.printed)
  };
}

function pageIndexHint(text: string): { page: number; of: number } | undefined {
  const match = String(text || "").match(PAGE_OF_RE);
  if (!match) return undefined;
  const page = Number(match[1]);
  const of = Number(match[2]);
  if (!Number.isInteger(page) || !Number.isInteger(of) || page < 1 || of < 1) return undefined;
  return { page, of };
}

function looksLikeNewFormTitlePage(text: string): boolean {
  const head = String(text || "").slice(0, 900);
  if (/this endorsement (?:changes|modifies|amends|alters) the policy/i.test(head)) return true;
  const hint = pageIndexHint(head);
  return Boolean(hint && hint.page === 1);
}

function extractLogicalFormTitle(text: string): string | undefined {
  const lines = String(text || "")
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 18);
  const skip = (line: string) =>
    /^page\s+\d+\s+of\s+\d+/i.test(line) ||
    /^\d{4,6}\s*[\(\[]\s*\d{1,2}\s*[\/.-]\s*\d{2,4}\s*[\)\]]/.test(line) ||
    /^this endorsement changes the policy/i.test(line) ||
    /^this endorsement,?\s*effective/i.test(line) ||
    /^policy no\.?/i.test(line) ||
    /^issued to:/i.test(line) ||
    /^by:\s*$/i.test(line) ||
    /^\(?a capital stock company\)?$/i.test(line);

  const titled = lines.find((line) => {
    if (skip(line)) return false;
    return /\b(endorsement|declarations page|insurance policy|schedule of covered horses)\b/i.test(line);
  });
  if (titled) return titled.slice(0, 140);
  const fallback = lines.find((line) => !skip(line) && line.length >= 8 && line.length <= 90);
  return fallback?.slice(0, 140);
}

export function classifyLogicalFormRole(startText: string): LogicalFormRole {
  const text = String(startText || "");
  const head = text.slice(0, 1200);
  const title = extractLogicalFormTitle(text) || "";
  if (
    /this endorsement (?:changes|modifies|amends|alters) the policy/i.test(head) ||
    /(?:^|\n)\s*endorsement\s*$/im.test(head) ||
    /\b(?:coverage\s+)?endorsement\b/i.test(title)
  ) {
    return "Endorsement / Optional Coverage Form";
  }
  const dedicatedDeclarationsHeading =
    isDeclarationsHeading(text) || /\bdeclarations page\b/i.test(head) || /(?:^|\n)\s*declarations\s*$/im.test(head);
  if (dedicatedDeclarationsHeading && !/\bbase policy form\b/i.test(head)) {
    return "Specimen Declarations / Schedule";
  }
  if (
    /\bbase policy form\b/i.test(head) ||
    policyFormSignalCount(text) >= 2 ||
    (/\binsurance policy\b/i.test(head) && !/\bdeclarations page\b/i.test(head))
  ) {
    return "Base Policy Form";
  }
  if (looksLikeDeclarationsPage(text) || dedicatedDeclarationsHeading) {
    return "Specimen Declarations / Schedule";
  }
  if (policyFormSignalCount(text) >= 1) return "Base Policy Form";
  return "Other Form";
}

function sameIdentity(current: PageIdentity | undefined, next: PageIdentity | undefined): boolean {
  if (!current || !next) return false;
  return current.normalized === next.normalized;
}

export function segmentLogicalForms(pages: PageText[]): LogicalFormSegment[] {
  const ordered = [...pages].sort((a, b) => a.page - b.page);
  type Open = {
    identity: PageIdentity;
    page_start: number;
    page_end: number;
    start_text: string;
  };
  const closed: Open[] = [];
  let current: Open | undefined;

  for (const page of ordered) {
    const text = textOf(page);
    const identity = extractPageFormIdentity(text);
    const newTitle = looksLikeNewFormTitlePage(text);

    if (identity) {
      if (current && sameIdentity(current.identity, identity) && !(newTitle && identity.normalized !== current.identity.normalized)) {
        current.page_end = page.page;
        if (!current.identity.edition && identity.edition) current.identity.edition = identity.edition;
      } else {
        if (current) closed.push(current);
        current = {
          identity,
          page_start: page.page,
          page_end: page.page,
          start_text: text
        };
      }
      continue;
    }

    if (current && !newTitle) {
      current.page_end = page.page;
      continue;
    }

    if (current && newTitle) {
      closed.push(current);
      current = undefined;
    }
  }
  if (current) closed.push(current);

  return closed.map((seg) => ({
    printed_identifier: seg.identity.printed,
    normalized_identifier: seg.identity.normalized,
    edition: seg.identity.edition,
    title: extractLogicalFormTitle(seg.start_text),
    role: classifyLogicalFormRole(seg.start_text),
    page_start: seg.page_start,
    page_end: seg.page_end,
    start_text: seg.start_text
  }));
}

export function distinctLogicalFormCount(pages: PageText[]): number {
  return new Set(segmentLogicalForms(pages).map((seg) => seg.normalized_identifier)).size;
}

export function isDeclarationsOrScheduleRole(role: LogicalFormRole | string | undefined): boolean {
  return /declarations|schedule/i.test(String(role || ""));
}

export function isEndorsementOrOptionalRole(role: LogicalFormRole | string | undefined): boolean {
  return /endorsement|optional coverage/i.test(String(role || ""));
}
