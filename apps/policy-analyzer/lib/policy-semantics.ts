import type { PolicyIdentification, PolicyRecord, Sourced } from "./types";

export function isExternalReferenceValue(value: string): boolean {
  const v = value.replace(/\s+/g, " ").trim();
  if (!v) return true;
  const lower = v.toLowerCase();
  if (/^as (?:stated|shown|set forth|described|listed|specified|itemized) in\b/.test(lower)) return true;
  if (/\bas (?:stated|shown|set forth|described|listed) in\b/.test(lower) && /\b(declarations|schedule|endorsement|item [a-z])\b/.test(lower)) {
    return true;
  }
  if (/\bitem [a-z] of\b/.test(lower)) return true;
  if (/^see (?:the )?(?:declarations|schedule|endorsement)\b/.test(lower)) return true;
  if (/^(?:the )?(?:individual|person|partnership|corporation|entity)\b/.test(lower)) return true;
  return false;
}

function firstContentLines(text: string, count = 8): string {
  return String(text || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, count)
    .join("\n");
}

export function isDeclarationsHeading(text: string): boolean {
  const head = firstContentLines(text, 8);
  for (const line of head.split("\n")) {
    if (/^declarations\s*:/i.test(line)) continue;
    if (/^declarations\b/i.test(line)) return true;
    if (/^(?:equine\s+)?(?:mortality\s+)?policy\s+declarations\b/i.test(line) && !/\bform\b/i.test(line)) return true;
    if (/^renewal declarations\b/i.test(line)) return true;
  }
  return false;
}

export function isFilledPolicySpecificValue(value: string): boolean {
  const v = value.replace(/\s+/g, " ").trim();
  if (!v) return false;
  if (isExternalReferenceValue(v)) return false;
  const lower = v.toLowerCase();
  if (/\bdeclarations form\b/.test(lower)) return false;
  if (/\bform\s+[A-Z0-9]/i.test(v) && /\bdeclarations\b/i.test(v)) return false;
  if (/^(?:the )?(?:declarations|schedule|policy|endorsement)\b/.test(lower)) return false;
  return /[A-Za-z0-9]{2,}/.test(v);
}

const DECLARATIONS_FIELD_PATTERNS: RegExp[] = [
  /policy\s+(?:number|no\.?|#)\s*[:.–—]\s*([^\n]+)/i,
  /named insured\s*[:.–—]\s*([^\n]+)/i,
  /(?:mailing\s+)?address\s*[:.–—]\s*([^\n]+)/i,
  /(?:policy\s+)?effective date\s*[:.–—]\s*([^\n]+)/i,
  /(?:policy\s+)?expiration date\s*[:.–—]\s*([^\n]+)/i,
  /premium\s*[:.–—]\s*([^\n]+)/i,
  /deductible\s*[:.–—]\s*([^\n]+)/i,
  /insured horse(?: name)?\s*[:.–—]\s*([^\n]+)/i,
  /insured value[^\n]{0,40}[:.–—]\s*([^\n]+)/i,
  /(?:agent|producer)\s*[:.–—]\s*([^\n]+)/i,
  /(?:issued|underwritten)\s+by\s*[:.–—]\s*([^\n]+)/i
];

export function filledDeclarationsFieldCount(text: string): number {
  let n = 0;
  for (const pattern of DECLARATIONS_FIELD_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1] && isFilledPolicySpecificValue(match[1])) n += 1;
  }
  if (/(?:^|\n)\s*forms\s*:\s*\n?\s*[A-Z0-9]/i.test(text)) n += 1;
  return n;
}

export function policyFormSignalCount(text: string): number {
  const hay = String(text || "");
  let n = 0;
  if (/\bdefinitions\b/i.test(hay)) n += 1;
  if (/\binsuring agreement\b/i.test(hay) || /\b(?:the company )?will indemnify\b/i.test(hay) || /\bagrees to indemnify\b/i.test(hay)) {
    n += 1;
  }
  if (/(?:^|\n)\s*(?:part\s+[ivxl]+\.?\s*)?(?:general\s+)?conditions\b/im.test(hay)) n += 1;
  if (/(?:^|\n)\s*(?:part\s+[ivxl]+\.?\s*)?exclusions\b/im.test(hay) || /\bthis insurance does not cover\b/i.test(hay)) {
    n += 1;
  }
  if (/\barbitration\b/i.test(hay)) n += 1;
  if (/\bas (?:stated|shown|set forth|listed|specified) in (?:item [a-z] of )?the declarations\b/i.test(hay)) n += 1;
  if (/\bitem [a-z] of the declarations\b/i.test(hay)) n += 1;
  if (/\bbase policy form\b/i.test(hay) || /\bthis policy provides\b/i.test(hay)) n += 1;
  if (/\bpolicy form\b/i.test(hay) && /\bform\s+[A-Z]{2,8}\s+\d{2,4}/i.test(hay)) n += 1;
  return n;
}

export function hasStrongPolicyFormStructure(text: string): boolean {
  return policyFormSignalCount(text) >= 3;
}

export function looksLikeDeclarationsPage(text: string): boolean {
  const filled = filledDeclarationsFieldCount(text);
  if (hasStrongPolicyFormStructure(text) && filled === 0) return false;
  if (hasStrongPolicyFormStructure(text) && !isDeclarationsHeading(text) && filled < 2) return false;
  if (isDeclarationsHeading(text) && filled > 0) return true;
  if (isDeclarationsHeading(text) && /(?:^|\n)\s*forms\s*:/i.test(text)) return true;
  if (/\bdeclarations\b/i.test(text) && filled >= 2 && !hasStrongPolicyFormStructure(text)) return true;
  return false;
}

export function isCoverageGrantLanguage(clause: string): boolean {
  return (
    /\bprovides\b/i.test(clause) ||
    /\bis provided\b/i.test(clause) ||
    /\bis added\b/i.test(clause) ||
    /\bis covered\b/i.test(clause) ||
    /coverage with a limit/i.test(clause) ||
    /limit of\s*\$/i.test(clause) ||
    /amended to\s*\$/i.test(clause) ||
    /\bwill indemnify\b/i.test(clause) ||
    /\bagrees to indemnify\b/i.test(clause) ||
    /\bindemnify(?:\s+the\s+insured)?\b/i.test(clause) ||
    /\bwill pay\b/i.test(clause) ||
    /\bthis insurance covers\b/i.test(clause) ||
    /\bcoverage is afforded\b/i.test(clause) ||
    /\bcoverage is provided\b/i.test(clause)
  );
}

export function isOptionalCoverageMention(clause: string): boolean {
  return (
    /\badditional coverages such as\b/i.test(clause) ||
    /\bcoverages? such as\b/i.test(clause) ||
    /\bmay be (?:fully earned|available|added|purchased|included)\b/i.test(clause) ||
    /\bif (?:endorsed|attached|purchased)\b/i.test(clause) ||
    /\bif shown in the schedule\b/i.test(clause) ||
    /\bas stated in the schedule or endorsements\b/i.test(clause)
  );
}

export function isScheduleDependentGrant(clause: string): boolean {
  const pointsOutside = /\b(schedule|declarations)\b/i.test(clause);
  if (!pointsOutside) return false;
  return (
    /\b(?:listed|stated|shown|set forth|subject to)\b/i.test(clause) ||
    /\blimit(?:s)?\b/i.test(clause) ||
    /\bdeductible\b/i.test(clause)
  );
}

export function personalizedFactsMissing(identification: PolicyIdentification): boolean {
  return !identification.insured_horse_name && !identification.insured_value && !identification.policy_effective_date;
}

export function clauseConcernsMortality(clause: string): boolean {
  const lower = clause.toLowerCase();
  if (/\bfull mortality\b/.test(lower) || /\bmortality coverage\b/.test(lower) || /\bequine mortality\b/.test(lower)) {
    return true;
  }
  const death = /\b(death|die|dies|died|deceased|mortality)\b/i.test(clause);
  const horse = /\b(horse|equine|animal)\b/i.test(clause);
  return death && horse && isCoverageGrantLanguage(clause);
}

export function clauseConcernsTheft(clause: string): boolean {
  const lower = clause.toLowerCase();
  if (/\btheft coverage\b/.test(lower) || /\bcoverage for theft\b/.test(lower)) return true;
  return isCoverageGrantLanguage(clause) && /\btheft\b/i.test(clause) && /\b(horse|equine|animal)\b/i.test(clause);
}

export function clauseConcernsSurgicalCoverage(clause: string): boolean {
  const lower = clause.toLowerCase();
  if (/\bsurgical coverage\b/.test(lower)) return true;
  if (/\bequine (?:zero deductible )?surgical\b/.test(lower)) return true;
  if (/\bmajor medical and surgical\b/.test(lower)) return true;
  return false;
}

export function isExclusionSectionHeading(text: string): boolean {
  return /part\s+[ivxl]+\.?\s*exclusions\b/i.test(text) || /(?:^|\n)\s*exclusions\s*(?:$|\n)/i.test(text);
}

export function isStandaloneExclusionClause(clause: string): boolean {
  return (
    /\bthis insurance does not cover\b/i.test(clause) ||
    /\bno coverage is afforded\b/i.test(clause) ||
    /\bno liability arises\b/i.test(clause) ||
    /\bthis endorsement excludes coverage for\b/i.test(clause) ||
    /\bthis policy does not cover\b/i.test(clause)
  );
}

export function exclusionCategory(clause: string): string {
  const t = clause.toLowerCase();
  if (/intentional destruction|humane destruction/.test(t)) return "Intentional destruction";
  if (/contagious|communicable disease/.test(t)) return "Contagious or communicable disease";
  if (/surgical operation/.test(t)) return "Surgical operations";
  if (/medication|narcotic|\bdrug\b|substance/.test(t)) return "Medication or substance";
  if (/malicious|willful|intentional act/.test(t)) return "Malicious or intentional acts";
  if (/failure to provide proper care|proper care and attention/.test(t)) return "Failure to provide proper care";
  if (/nuclear/.test(t)) return "Nuclear risk";
  if (/confiscation/.test(t)) return "Confiscation";
  if (/\bwar\b|civil war|military force/.test(t)) return "War or military force";
  if (/mysterious disappearance|\bescape\b/.test(t)) return "Mysterious disappearance or escape";
  if (/voluntary parting/.test(t)) return "Fraudulent voluntary parting";
  if (/consequential loss/.test(t)) return "Consequential loss";
  return "Stated exclusion";
}

export type DutyRule = { trigger: string; pattern: RegExp };

export const CLAIM_DUTY_RULES: DutyRule[] = [
  { trigger: "illness or injury", pattern: /licensed veterinary|immediate(?:ly)? .{0,60}veterinar|veterinary (?:care|treatment)/i },
  { trigger: "death", pattern: /\b(postmortem|necropsy)\b/i },
  { trigger: "claim notice", pattern: /immediate(?:ly)? .{0,50}(?:telephone )?notice|\bnotify\b.{0,40}(?:company|insurer|carrier)|telephone notice/i },
  { trigger: "theft", pattern: /theft.{0,80}(?:notice|report)|disappearance.{0,50}notice/i },
  { trigger: "theft", pattern: /\bpolice\b|law.?enforcement/i },
  { trigger: "theft", pattern: /\bransom\b/i },
  { trigger: "proof of loss", pattern: /proof of loss/i }
];

export function extractPolicyFormValue(text: string): string | undefined {
  const match =
    text.match(/\bpolicy form\s+([A-Z]{2,8}\s+\d{2,4}(?:\s*\(\d{1,2}\/\d{2,4}\))?)/i) ||
    text.match(/\bform\s+([A-Z]{2,8}\s+\d{2,4}\s*\(\d{1,2}\/\d{2,4}\))/i);
  const value = match?.[1]?.replace(/\s+/g, " ").trim();
  return value || undefined;
}

export type SourceReference = {
  label: string;
  page: number;
  text: string;
};

function pushRef(out: SourceReference[], seen: Set<string>, label: string, page: number, text: string): void {
  const excerpt = String(text || "").replace(/\s+/g, " ").trim();
  if (!excerpt || !page || page <= 0) return;
  const key = `${label}|${page}|${excerpt.slice(0, 80).toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ label, page, text: excerpt });
}

function sourcedRef(out: SourceReference[], seen: Set<string>, label: string, field?: Sourced<string>): void {
  if (!field) return;
  pushRef(out, seen, label, field.source_page, field.source_text || field.value);
}

export function collectSourceReferences(record: PolicyRecord): SourceReference[] {
  const out: SourceReference[] = [];
  const seen = new Set<string>();
  const id = record.identification;
  sourcedRef(out, seen, "Carrier", id.carrier_name);
  sourcedRef(out, seen, "Policy form", id.policy_form);
  sourcedRef(out, seen, "Policy number", id.policy_number);
  sourcedRef(out, seen, "Named insured", id.named_insured);
  sourcedRef(out, seen, "Horse", id.insured_horse_name);
  sourcedRef(out, seen, "Effective date", id.policy_effective_date);
  sourcedRef(out, seen, "Expiration", id.policy_expiration_date);
  sourcedRef(out, seen, "Deductible", id.deductible);
  sourcedRef(out, seen, "Insured value", id.insured_value);
  for (const coverage of record.coverages) {
    if (coverage.coverage_status === "NOT FOUND") continue;
    pushRef(out, seen, coverage.coverage_type, coverage.source_page, coverage.source_text);
  }
  for (const limit of record.financial_limits) {
    pushRef(out, seen, limit.label, limit.source_page, limit.source_text);
  }
  for (const exclusion of record.exclusions) {
    pushRef(out, seen, `Exclusion: ${exclusion.exclusion_type}`, exclusion.source_page, exclusion.exact_source_excerpt);
  }
  for (const requirement of record.requirements) {
    pushRef(out, seen, requirement.trigger || "Requirement", requirement.source_page, requirement.source_text);
  }
  return out;
}
