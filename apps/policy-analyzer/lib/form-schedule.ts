const EDITION_CORE = "[A-Za-z]{3,9}\\s+\\d{4}|\\d{1,2}/\\d{1,2}/\\d{2,4}|\\d{1,2}/\\d{4}|\\d{1,2}\\s+\\d{2}|\\d{4}";
export const EDITION_RE = new RegExp(
  `(?:ed(?:ition)?\\.?|rev(?:ision)?\\.?)\\s*[:.]?\\s*(${EDITION_CORE})`,
  "i"
);

const ISO_FORM_RE = /\b([A-Z]{2}(?:[ -]\d{2}){1,5})\b/g;
const HYPHEN_FORM_RE = /\b([A-Z]{2,6}(?:-[A-Z0-9]{1,8}){1,4})\b/g;
const SPACE_FORM_RE = /\b([A-Z]{2,6}(?:\s+[A-Z]{2,8}){1,2}\s+\d{1,4})\b/g;

const STOP_HEADING_RE =
  /^(limits?|deductibles?|coverages?|exclusions?|named insured|policy number|insured value|premium|notice to|schedule of hazards|full mortality|major medical limit)\b/i;

export type ListedForm = {
  printed: string;
  edition?: string;
  source_line: string;
};

export function normalizeFormId(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeEdition(ed: string): string {
  return ed.toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

export function isFormsScheduleHeading(line: string): boolean {
  const t = line.replace(/\s+/g, " ").trim();
  return (
    /^(forms|forms attached|forms and endorsements|schedule of forms|endorsements attached)\b/i.test(t) ||
    /\bforms\s*:/i.test(t) ||
    /\bschedule of forms\b/i.test(t)
  );
}

export function isLikelyFormIdentifier(raw: string): boolean {
  const printed = raw.replace(/\s+/g, " ").trim();
  if (printed.length < 4 || printed.length > 36) return false;
  if (/\$/.test(printed)) return false;
  if (/^\d/.test(printed)) return false;
  if (/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(printed)) return false;
  if (/^\d{1,2}[/-]\d{4}$/.test(printed)) return false;

  const parts = printed.split(/[-\s]+/).filter(Boolean);
  if (parts.length < 2) return false;
  if (!/^[A-Z]{1,6}$/i.test(parts[0])) return false;

  const compact = normalizeFormId(printed);
  if (/^[A-Z]{1,4}(19|20)\d{2}\d{4,}$/.test(compact)) return false;
  if (/^(19|20)\d{2}$/.test(parts[1]) && parts.slice(2).every((p) => /^\d{3,}$/.test(p))) return false;

  if (/^[A-Z]{2}(?:[ -]\d{2}){1,5}$/i.test(printed)) return true;

  const hasDigit = /\d/.test(compact);
  const letterSegments = parts.filter((p) => /[A-Z]/i.test(p) && !/^\d+$/.test(p));
  if (!hasDigit && letterSegments.length < 3) return false;
  return true;
}

export function extractFormIdsFromText(text: string): ListedForm[] {
  const out: ListedForm[] = [];
  const seen = new Set<string>();
  const matches: Array<{ printed: string; index: number; length: number }> = [];
  for (const re of [ISO_FORM_RE, HYPHEN_FORM_RE, SPACE_FORM_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const copy = new RegExp(re.source, "gi");
    while ((m = copy.exec(text))) {
      matches.push({ printed: m[1].replace(/\s+/g, " ").trim(), index: m.index, length: m[0].length });
    }
  }
  matches.sort((a, b) => a.index - b.index || b.length - a.length);
  const used: Array<{ start: number; end: number }> = [];
  for (const match of matches) {
    const start = match.index;
    const end = match.index + match.length;
    if (used.some((u) => start < u.end && end > u.start)) continue;
    if (!isLikelyFormIdentifier(match.printed)) continue;
    const normalized = normalizeFormId(match.printed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    used.push({ start, end });
    const rest = text.slice(end, end + 48);
    const ed = rest.match(EDITION_RE)?.[1] || nearbyBareEdition(rest);
    out.push({
      printed: match.printed,
      edition: ed ? normalizeEdition(ed) : undefined,
      source_line: text.replace(/\s+/g, " ").trim()
    });
  }
  return out;
}

function nearbyBareEdition(rest: string): string | undefined {
  const m = rest.match(/^\s+(\d{1,2}\/\d{2,4}|\d{1,2}\s+\d{2})\b/);
  return m?.[1];
}

export function collectFormsScheduleText(pageText: string): string | undefined {
  const lines = pageText.split(/\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isFormsScheduleHeading(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return undefined;
  const collected = [lines[start]];
  let blankRun = 0;
  for (let i = start + 1; i < lines.length && i <= start + 40; i++) {
    const compact = lines[i].replace(/\s+/g, " ").trim();
    if (!compact) {
      blankRun += 1;
      if (blankRun >= 2) break;
      collected.push("");
      continue;
    }
    blankRun = 0;
    if (STOP_HEADING_RE.test(compact) && !isFormsScheduleHeading(compact)) break;
    collected.push(lines[i]);
  }
  return collected.join("\n");
}

export function parseListedForms(schedule: string): ListedForm[] {
  const lines = schedule.split(/\n/);
  const out: ListedForm[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i]
      .split(/\t|\s*\|\s*|\s{2,}/)
      .map((s) => s.trim())
      .filter(Boolean);
    const haystacks = cells.length ? cells : [lines[i]];
    for (const cell of haystacks) {
      const found = extractFormIdsFromText(cell);
      for (const item of found) {
        const normalized = normalizeFormId(item.printed);
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        let edition = item.edition;
        if (!edition && i + 1 < lines.length) {
          const next = lines[i + 1].replace(/\s+/g, " ").trim();
          const onlyEd =
            next.match(new RegExp(`^(?:ed(?:ition)?\\.?|rev(?:ision)?\\.?)\\s*[:.]?\\s*(${EDITION_CORE})$`, "i")) ||
            next.match(new RegExp(`^(${EDITION_CORE})$`, "i"));
          if (onlyEd?.[1] && !extractFormIdsFromText(next).length) {
            edition = normalizeEdition(onlyEd[1]);
          }
        }
        out.push({ ...item, edition, source_line: lines[i].replace(/\s+/g, " ").trim() });
      }
    }
  }
  return out;
}

export function lineHasFormId(line: string, printedId: string): boolean {
  const want = normalizeFormId(printedId);
  return extractFormIdsFromText(line).some((item) => normalizeFormId(item.printed) === want);
}

export function lineIsInScheduleBlock(pageText: string, line: string): boolean {
  const block = collectFormsScheduleText(pageText);
  if (!block) return false;
  const target = line.replace(/\s+/g, " ").trim();
  if (!target) return false;
  return block
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .includes(target);
}

export function isIndependentFormEvidence(line: string, printedId: string, pageText: string): boolean {
  if (isFormsScheduleHeading(line)) return false;
  if (lineIsInScheduleBlock(pageText, line)) return false;
  if (!lineHasFormId(line, printedId)) return false;
  return /\b(base policy form|policy form|exclusion endorsement|major medical endorsement|endorsement|form)\b/i.test(
    line
  );
}

export function extractEdition(text: string): string | undefined {
  const m = text.match(EDITION_RE);
  return m?.[1] ? normalizeEdition(m[1]) : undefined;
}
