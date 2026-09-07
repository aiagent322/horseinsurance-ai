import type {
  AnalysisStatus,
  CoverageRecord,
  DocumentRecord,
  PolicyIdentification,
  PolicyRecord,
  Sourced
} from "./types";

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

const LEGAL_ALIAS_SUFFIX =
  /[,;]?\s*(?:hereinafter\s+(?:called|referred to as)|referred to herein as|herein(?:after)?\s+called)\b.*$/i;

export function stripLegalAliasSuffix(value: string): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(LEGAL_ALIAS_SUFFIX, "")
    .replace(/[.,;:\s]+$/g, "")
    .trim();
}

export function normalizeIdentificationValue(value: string): string | undefined {
  const cleaned = stripLegalAliasSuffix(value);
  if (!cleaned) return undefined;
  if (isExternalReferenceValue(cleaned)) return undefined;
  if (!isFilledPolicySpecificValue(cleaned)) return undefined;
  return cleaned;
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

export type PolicySection =
  | "coverage"
  | "conditions"
  | "duties"
  | "limitations"
  | "exclusions"
  | "definitions"
  | "arbitration"
  | "other";

export type PolicyTermKind = "grant" | "limitation" | "condition" | "duty" | "exclusion";

const STRONG_HEADING_PATTERN =
  /^(?:(?:part|article|section)\s+[ivxlcdm0-9]+\.?\s+)?(what we do not cover|losses not insured|exclusions|duties after (?:a )?loss|claim conditions|duties of the insured|emergency requirements|claim requirements|general conditions|conditions|limitations|insuring agreement|arbitration(?: clause)?)\s*[:.]?\s*(.*)$/i;

const WEAK_HEADING_PATTERN =
  /^(?:(?:part|article|section)\s+[ivxlcdm0-9]+\.?\s+)?(definitions?|coverage|agreement)\s*[:.]?\s*$/i;

function sectionFromHeadingName(name: string): PolicySection | null {
  const n = name.replace(/\s+/g, " ").trim().toLowerCase();
  if (n === "what we do not cover" || n === "losses not insured" || n === "exclusions") return "exclusions";
  if (n === "duties after loss" || n === "duties after a loss" || n === "claim conditions" || n === "duties of the insured") {
    return "duties";
  }
  if (n === "emergency requirements" || n === "claim requirements") return "duties";
  if (n === "general conditions" || n === "conditions") return "conditions";
  if (n === "limitations") return "limitations";
  if (n === "insuring agreement" || n === "coverage" || n === "agreement") return "coverage";
  if (n === "definition" || n === "definitions") return "definitions";
  if (n === "arbitration" || n === "arbitration clause") return "arbitration";
  return null;
}

export function parseSectionHeadingLine(line: string): { section: PolicySection; rest: string } | null {
  const raw = String(line || "").replace(/\s+/g, " ").trim();
  if (!raw || /^page\s+\d+$/i.test(raw)) return null;
  const strong = raw.match(STRONG_HEADING_PATTERN);
  if (strong?.[1]) {
    const section = sectionFromHeadingName(strong[1]);
    if (section) return { section, rest: (strong[2] || "").trim() };
  }
  const weak = raw.match(WEAK_HEADING_PATTERN);
  if (weak?.[1]) {
    const section = sectionFromHeadingName(weak[1]);
    if (section) return { section, rest: "" };
  }
  return null;
}

export function detectSectionHeading(line: string): PolicySection | null {
  return parseSectionHeadingLine(line)?.section || null;
}

export function isExclusionSectionHeading(text: string): boolean {
  return String(text || "")
    .split(/\n/)
    .some((line) => parseSectionHeadingLine(line)?.section === "exclusions");
}

export function isExclusionOperativeLanguage(clause: string): boolean {
  return (
    /\bthis insurance does not cover\b/i.test(clause) ||
    /\bthis policy does not cover\b/i.test(clause) ||
    /\bthis endorsement excludes coverage for\b/i.test(clause) ||
    /\bno coverage is afforded\b/i.test(clause) ||
    /\bno liability arises\b/i.test(clause) ||
    /\bwe will not pay for\b/i.test(clause) ||
    /\bwill not pay for (?:any )?loss\b/i.test(clause) ||
    /\bexcluded loss\b/i.test(clause)
  );
}

export function isStandaloneExclusionClause(clause: string): boolean {
  return classifyPolicyTerm(clause, null) === "exclusion";
}

export function looksLikeCauseOfLossExclusion(clause: string): boolean {
  if (/\bthis endorsement excludes coverage for\b/i.test(clause)) return true;
  if (/\b(?:this insurance|this policy) does not cover\b/i.test(clause)) return true;
  if (/\bexcluded loss\b/i.test(clause)) return true;
  return /\b(?:we will not pay|will not pay) for (?:any )?(?:loss|damage)\b/i.test(clause) && /\bcaused\b/i.test(clause);
}

export function isCoverageLimitationLanguage(clause: string): boolean {
  return (
    /\buntil at least\b/i.test(clause) ||
    /\bdoes not arise until\b/i.test(clause) ||
    /\bdoes not become payable until\b/i.test(clause) ||
    /\bthen only in the event\b/i.test(clause) ||
    /\bunless separately (?:insured|scheduled|endorsed|listed)\b/i.test(clause) ||
    /\bunless (?:endorsed|scheduled|attached)\b/i.test(clause) ||
    /\bcoverage applies only\b/i.test(clause) ||
    /\bpayment will not be made until\b/i.test(clause) ||
    /\bterritorial limits?\b/i.test(clause) ||
    /\bonly for the declared use\b/i.test(clause) ||
    /\blimit.{0,40}reduc/i.test(clause) ||
    (/\bno liability arises\b/i.test(clause) && /\buntil\b/i.test(clause)) ||
    (/\bno coverage is afforded\b/i.test(clause) && /\bunless\b/i.test(clause))
  );
}

export function isPolicyConditionLanguage(clause: string): boolean {
  return (
    /\bcondition precedent\b/i.test(clause) ||
    /\bthe (?:insured|horse) shall\b/i.test(clause) ||
    /\bthe insured must\b/i.test(clause)
  );
}

function hasDutyAction(clause: string): boolean {
  return (
    /\b(?:notify|notice|report|file|submit|produce|obtain|employ|arrange|preserve|cooperat)\b/i.test(clause) ||
    /\bexamination under oath\b/i.test(clause) ||
    /\bproof of loss\b/i.test(clause) ||
    /\bransom\b/i.test(clause) ||
    /\bqualified professional\b/i.test(clause) ||
    /\bprofessional (?:assistance|treatment)\b/i.test(clause) ||
    /\bpostmortem\b/i.test(clause) ||
    /\bnecropsy\b/i.test(clause) ||
    /\bfollow .{0,60}recommend/i.test(clause)
  );
}

function hasEventOrClaimCue(clause: string): boolean {
  return (
    /\bin the event of\b/i.test(clause) ||
    /\bupon (?:request|the request|illness|injury|death|theft|loss|damage|disappearance|accident)\b/i.test(clause) ||
    /\bfollowing (?:death|loss|theft|injury)\b/i.test(clause) ||
    /\bafter (?:an |the )?(?:insured )?loss\b/i.test(clause) ||
    /\bimmediate(?:ly)?\b/i.test(clause) ||
    /\bwithin \d+\s*(?:hours?|days?)\b/i.test(clause) ||
    /\b(?:if|when|as) requested\b/i.test(clause) ||
    /\bupon request\b/i.test(clause) ||
    /\bproof of loss\b/i.test(clause) ||
    /\bexamination under oath\b/i.test(clause) ||
    /\bproduce .{0,40}(?:records|documents|receipts)\b/i.test(clause) ||
    /\bransom\b/i.test(clause) ||
    /\b(?:police|law.?enforcement)\b/i.test(clause) ||
    /\bpostmortem\b/i.test(clause) ||
    /\bnecropsy\b/i.test(clause)
  );
}

function hasDutyObligation(clause: string): boolean {
  if (/\b(shall|must|required to)\b/i.test(clause)) return true;
  return /^(?:[-•]\s*)?(?:immediately\s+)?(?:notify|report|file|submit|produce|obtain|employ|arrange|preserve)\b/i.test(
    clause.trim()
  );
}

export function isClaimDutyLanguage(clause: string): boolean {
  if (isCoverageGrantLanguage(clause)) return false;
  if (isCoverageLimitationLanguage(clause)) return false;
  if (!hasDutyAction(clause) || !hasDutyObligation(clause)) return false;
  return hasEventOrClaimCue(clause);
}

export function classifyPolicyTerm(clause: string, section: PolicySection | null): PolicyTermKind | null {
  const text = String(clause || "").replace(/\s+/g, " ").trim();
  if (text.length < 12) return null;
  if (isOptionalCoverageMention(text)) return null;
  if (isCoverageGrantLanguage(text) && !isExclusionOperativeLanguage(text)) return "grant";

  const duty = isClaimDutyLanguage(text);
  const limitation = isCoverageLimitationLanguage(text);
  const condition = isPolicyConditionLanguage(text);
  const exclusionWording = isExclusionOperativeLanguage(text) || looksLikeCauseOfLossExclusion(text);

  if (section === "exclusions") {
    if (isCoverageGrantLanguage(text)) return "grant";
    return "exclusion";
  }
  if (section === "duties") {
    if (duty) return "duty";
    if (limitation || exclusionWording) return "limitation";
    if (condition) return "condition";
    return null;
  }
  if (section === "conditions" || section === "limitations" || section === "coverage") {
    if (duty && !limitation && !exclusionWording) return "duty";
    if (limitation || exclusionWording) return "limitation";
    if (condition) return "condition";
    if (duty) return "duty";
    return null;
  }
  if (looksLikeCauseOfLossExclusion(text) || (exclusionWording && !limitation && !condition && !duty)) {
    return "exclusion";
  }
  if (limitation) return "limitation";
  if (duty) return "duty";
  if (condition) return "condition";
  return null;
}

const CLAUSE_ABBREVIATION_END =
  /\b(?:Ed|Inc|Ltd|No|Mr|Mrs|Ms|Dr|Rev|vs|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.$/i;

export function splitPolicyClauses(text: string): string[] {
  const flattened = String(text || "").replace(/-\s*\n\s*/g, "").replace(/\n+/g, " ");
  const parts = flattened
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
  const out: string[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (prev && CLAUSE_ABBREVIATION_END.test(prev)) {
      out[out.length - 1] = `${prev} ${part}`;
    } else {
      out.push(part);
    }
  }
  return out;
}

export type WalkedPolicyClause = {
  clause: string;
  page: number;
  document_id?: string;
  section: PolicySection | null;
  kind: PolicyTermKind | null;
};

export function walkPolicyClauses(
  pages: Array<{ page: number; text: string; document_id?: string }>
): WalkedPolicyClause[] {
  let section: PolicySection | null = null;
  let lastDocumentId: string | undefined;
  const out: WalkedPolicyClause[] = [];

  const emit = (chunk: string, page: number, document_id: string | undefined, active: PolicySection | null) => {
    for (const clause of splitPolicyClauses(chunk)) {
      if (clause.length < 12) continue;
      out.push({
        clause,
        page,
        document_id,
        section: active,
        kind: classifyPolicyTerm(clause, active)
      });
    }
  };

  for (const page of pages) {
    if (page.document_id !== undefined && lastDocumentId !== undefined && page.document_id !== lastDocumentId) {
      section = null;
    }
    if (page.document_id !== undefined) lastDocumentId = page.document_id;

    let buffer = "";
    const flush = () => {
      if (buffer.trim()) emit(buffer, page.page, page.document_id, section);
      buffer = "";
    };

    for (const rawLine of String(page.text || "").split(/\n/)) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (!line) continue;
      const parsed = parseSectionHeadingLine(line);
      if (parsed) {
        flush();
        section = parsed.section;
        if (parsed.rest) buffer = parsed.rest;
        continue;
      }
      buffer = buffer ? `${buffer} ${line}` : line;
    }
    flush();
  }

  return out;
}

export function exclusionCategory(clause: string): string {
  const t = clause.toLowerCase();
  if (/intentional destruction|humane destruction/.test(t)) return "Intentional destruction";
  if (/contagious|communicable disease/.test(t)) return "Contagious or communicable disease";
  if (/surgical operation/.test(t)) return "Surgical operations";
  if (/medication|narcotic|\bdrug\b|substance/.test(t)) return "Medication or substance";
  if (/malicious|willful|intentional act/.test(t)) return "Malicious or intentional acts";
  if (/failure to provide proper care/.test(t)) return "Failure to provide proper care";
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
  { trigger: "proof of loss", pattern: /proof of loss/i },
  { trigger: "claim cooperation", pattern: /examination under oath|produce .{0,40}(?:records|documents|receipts)/i }
];

export type ClaimDutyDescription = {
  family: string;
  trigger: string;
  summary: string;
  declarationsItem?: string;
};

export function dutyFamily(clause: string): string {
  const t = clause.toLowerCase();
  if (/\bransom\b/.test(t)) return "ransom";
  if (/examination under oath/.test(t)) return "examination_under_oath";
  if (/proof of loss/.test(t)) return "proof_of_loss";
  if (/produce/.test(t) && /records|documents|receipts/.test(t)) return "records";
  if (/(?:police|law.?enforcement)/.test(t) && /recommend/.test(t)) return "follow_law_enforcement";
  if (/(?:police|law.?enforcement)/.test(t)) return "police";
  if (/postmortem|necropsy/.test(t)) return "necropsy";
  if (/qualified professional|professional (?:assistance|treatment)|veterinar/.test(t)) return "professional_treatment";
  if (/(?:theft|disappearance)/.test(t) && /notice|notify|report/.test(t)) return "theft_notice";
  if (/notify|notice|report/.test(t)) return "notice";
  if (/cooperat/.test(t)) return "cooperation";
  return "claim_duty";
}

export function describeClaimDuty(clause: string): ClaimDutyDescription {
  const summary = String(clause || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-•]\s*/, "");
  const family = dutyFamily(summary);
  const trigger = CLAIM_DUTY_RULES.find((rule) => rule.pattern.test(summary))?.trigger || family.replace(/_/g, " ");
  const item = summary.match(/\bitem\s+([a-z0-9]+)\s+of\s+(?:the\s+)?declarations\b/i)?.[1];
  return {
    family,
    trigger,
    summary,
    declarationsItem: item ? item.toUpperCase() : undefined
  };
}

export type CoverageExplanationFacts = {
  coverageType: string;
  status: AnalysisStatus;
  grantClause?: string;
  denialClause?: string;
  optionalMention?: boolean;
  missingDeclarationsOrSchedule?: boolean;
  hasRelatedCoverageLimitation?: boolean;
};

function joinCauseList(causes: string[]): string {
  if (causes.length === 1) return causes[0];
  if (causes.length === 2) return `${causes[0]} or ${causes[1]}`;
  return `${causes.slice(0, -1).join(", ")}, or ${causes[causes.length - 1]}`;
}

function grantAnalysis(coverageType: string, grantClause?: string): string {
  const clause = grantClause || "";
  if (coverageType === "Full Mortality") {
    const causes: string[] = [];
    if (/\baccident\b/i.test(clause)) causes.push("accident");
    if (/\binjury\b/i.test(clause)) causes.push("injury");
    if (/\billness\b/i.test(clause)) causes.push("illness");
    if (/\bdisease\b/i.test(clause)) causes.push("disease");
    if (causes.length >= 2) {
      return `The policy form provides mortality coverage for death resulting from covered ${joinCauseList(causes)}.`;
    }
    return "The policy form provides mortality coverage.";
  }
  if (coverageType === "Theft") {
    if (/\bdeath\b/i.test(clause) && /\btheft\b/i.test(clause)) {
      return "The policy form provides coverage for theft of an insured horse and for death directly resulting from theft.";
    }
    return "The policy form provides coverage for theft of an insured horse.";
  }
  return `The policy form provides ${coverageType} coverage.`;
}

function missingDeclarationsAnalysis(): string {
  return "The uploaded package does not include the Declarations/Schedule needed to identify the insured horse, policy period, liability limit, or deductible.";
}

export function explainCoverage(facts: CoverageExplanationFacts): string {
  const type = facts.coverageType;
  const status = facts.status;

  if (status === "NOT FOUND") {
    return `The uploaded documents do not establish ${type} coverage.`;
  }
  if (status === "EXCLUDED") {
    const exception = facts.denialClause && /\bexcept\b/i.test(facts.denialClause);
    return exception
      ? `The uploaded documents state that ${type} is not provided, subject to a stated exception in the same provision.`
      : `The uploaded documents state that ${type} is not provided.`;
  }
  if (status === "POSSIBLE CONFLICT") {
    return `${type} is granted in one provision and excluded in another. The analyzer does not choose which provision controls.`;
  }
  if (status === "NEEDS CLARIFICATION") {
    if (facts.optionalMention) {
      return `${type} is mentioned only as a possible additional coverage that may appear in the Schedule or an endorsement. The uploaded documents do not establish that ${type} coverage is in force.`;
    }
    return `${type} is mentioned in the uploaded documents, but those documents do not establish that this coverage is in force.`;
  }
  if (status === "LIMITED" || status === "COVERED WITH LIMITATIONS") {
    const parts = [grantAnalysis(type, facts.grantClause)];
    if (facts.missingDeclarationsOrSchedule) {
      parts.push(missingDeclarationsAnalysis());
    } else if (status === "COVERED WITH LIMITATIONS") {
      parts.push("The coverage is stated subject to a limit or modifying endorsement in the uploaded documents.");
    }
    if (type === "Theft" && facts.hasRelatedCoverageLimitation) {
      parts.push("Theft coverage is also subject to policy conditions, including reporting and non-recovery requirements.");
    }
    return parts.join(" ");
  }
  const parts = [grantAnalysis(type, facts.grantClause)];
  if (facts.missingDeclarationsOrSchedule) parts.push(missingDeclarationsAnalysis());
  return parts.join(" ");
}

export function extractPolicyFormValue(text: string): string | undefined {
  const match =
    text.match(/\bpolicy form\s+([A-Z]{2,8}\s+\d{2,4}(?:\s*\(\d{1,2}\/\d{2,4}\))?)/i) ||
    text.match(/\bform\s+([A-Z]{2,8}\s+\d{2,4}\s*\(\d{1,2}\/\d{2,4}\))/i);
  const value = stripLegalAliasSuffix(match?.[1] || "");
  return value || undefined;
}

export type SourceReference = {
  label: string;
  page: number;
  text: string;
  document_id?: string;
};

export type SourceReferenceFindingType =
  | "identification"
  | "coverage"
  | "limit"
  | "duty"
  | "condition"
  | "exclusion"
  | "other";

export type SourceEvidenceLink = {
  document_id: string;
  page: number;
  finding_type: SourceReferenceFindingType;
  finding_key: string;
  source_text: string;
  section?: PolicySection | null;
};

export type CustomerSourceReference = {
  id: string;
  label: string;
  document_id: string;
  document_label: string;
  pages: number[];
  page_label: string;
  section_label?: string;
  finding_type: SourceReferenceFindingType;
  evidence: SourceEvidenceLink[];
};

function pushRef(
  out: SourceReference[],
  seen: Set<string>,
  label: string,
  page: number,
  text: string,
  document_id?: string
): void {
  const excerpt = String(text || "").replace(/\s+/g, " ").trim();
  if (!excerpt || !page || page <= 0) return;
  const key = `${document_id || ""}|${label}|${page}|${excerpt.slice(0, 80).toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ label, page, text: excerpt, document_id });
}

function sourcedRef(out: SourceReference[], seen: Set<string>, label: string, field?: Sourced<string>): void {
  if (!field) return;
  pushRef(out, seen, label, field.source_page, field.source_text || field.value, field.source_document_id);
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
    pushRef(out, seen, coverage.coverage_type, coverage.source_page, coverage.source_text, coverage.source_document_id);
  }
  for (const limit of record.financial_limits) {
    pushRef(out, seen, limit.label, limit.source_page, limit.source_text, limit.source_document_id);
  }
  for (const exclusion of record.exclusions) {
    pushRef(
      out,
      seen,
      `Exclusion: ${exclusion.exclusion_type}`,
      exclusion.source_page,
      exclusion.exact_source_excerpt,
      exclusion.source_document_id
    );
  }
  for (const requirement of record.requirements) {
    pushRef(
      out,
      seen,
      requirement.trigger || "Requirement",
      requirement.source_page,
      requirement.source_text,
      requirement.source_document_id
    );
  }
  return out;
}

export function formatPageLocator(pages: number[]): string {
  const unique = [...new Set(pages.filter((page) => Number.isInteger(page) && page > 0))].sort((a, b) => a - b);
  if (unique.length === 0) return "";
  const parts: string[] = [];
  let i = 0;
  while (i < unique.length) {
    let j = i;
    while (j + 1 < unique.length && unique[j + 1] === unique[j] + 1) j += 1;
    if (i === j) parts.push(String(unique[i]));
    else parts.push(`${unique[i]}-${unique[j]}`);
    i = j + 1;
  }
  const joined = parts.join(", ");
  return unique.length === 1 ? `Page ${joined}` : `Pages ${joined}`;
}

export function formatCustomerSourceReference(
  ref: Pick<CustomerSourceReference, "label" | "page_label" | "section_label" | "document_label">,
  options?: { includeDocument?: boolean }
): string {
  const locator = [
    options?.includeDocument ? ref.document_label : undefined,
    ref.page_label,
    ref.section_label
  ].filter(Boolean);
  return [ref.label, ...locator].join(" — ");
}

export function sourceDocumentLabel(doc: DocumentRecord | undefined): string {
  if (!doc) return "Policy Document";
  if (doc.classification && doc.classification !== "Unknown Document") return doc.classification;
  const filename = String(doc.original_filename || "")
    .replace(/\.[^.]+$/, "")
    .trim();
  return filename || "Policy Document";
}

function sectionDisplayLabel(section: PolicySection | null | undefined): string | undefined {
  switch (section) {
    case "coverage":
      return "Coverage";
    case "conditions":
      return "Conditions";
    case "duties":
      return "Duties After Loss";
    case "exclusions":
      return "Exclusions";
    case "limitations":
      return "Limitations";
    case "definitions":
      return "Definitions";
    case "arbitration":
      return "Arbitration";
    default:
      return undefined;
  }
}

function foundIdentification(field?: Sourced<string>): field is Sourced<string> {
  if (!field) return false;
  return Boolean(normalizeIdentificationValue(field.value));
}

function isTerritorialScopeLanguage(text: string): boolean {
  if (isOptionalCoverageMention(text)) return false;
  if (/\bterritorial limits?\b/i.test(text) && !/\bincluding transit\b/i.test(text)) return true;
  return (
    /\b(united states|canada|continental usa|puerto rico)\b/i.test(text) &&
    /\b(covered only while|only while|while the insured horse is within|unless endorsed)\b/i.test(text)
  );
}

function isOtherInsuranceLanguage(text: string): boolean {
  if (isOptionalCoverageMention(text)) return false;
  return /\bother insurance\b/i.test(text);
}

function dutyIndexGroup(family: string): string | null {
  switch (family) {
    case "professional_treatment":
    case "necropsy":
      return "vet_necropsy";
    case "notice":
      return "notice";
    case "theft_notice":
    case "police":
    case "follow_law_enforcement":
    case "ransom":
      return "theft_police";
    case "proof_of_loss":
    case "cooperation":
      return "proof";
    case "examination_under_oath":
    case "records":
      return "euo_records";
    default:
      return null;
  }
}

function coverageIndexLabel(type: string, status: AnalysisStatus): string {
  const normalized = String(type || "").replace(/\s+/g, " ").trim();
  if (/full mortality|^mortality$/i.test(normalized)) return "Mortality Coverage";
  if (/^theft$/i.test(normalized)) return "Theft Coverage";
  if (/major medical/i.test(normalized)) {
    return status === "NEEDS CLARIFICATION" ? "Optional Major Medical Reference" : "Major Medical Coverage";
  }
  if (/^surgical$/i.test(normalized)) {
    return status === "NEEDS CLARIFICATION" ? "Optional Surgical Reference" : "Surgical Coverage";
  }
  if (status === "EXCLUDED") return `${normalized} Exclusion`;
  if (status === "NEEDS CLARIFICATION") return `Optional ${normalized} Reference`;
  return `${normalized} Coverage`;
}

function dutyGroupLabel(group: string, families: Set<string>): string {
  if (group === "vet_necropsy") {
    const vet = families.has("professional_treatment");
    const necropsy = families.has("necropsy");
    if (vet && necropsy) return "Veterinary / Necropsy Requirements";
    if (necropsy) return "Necropsy Requirements";
    return "Veterinary Requirements";
  }
  if (group === "notice") return "Notice Requirements";
  if (group === "theft_police") return "Theft / Police Requirements";
  if (group === "proof") {
    return families.has("cooperation") ? "Proof of Loss / Claim Cooperation" : "Proof of Loss";
  }
  if (group === "euo_records") {
    const euo = families.has("examination_under_oath");
    const records = families.has("records");
    if (euo && records) return "Examination Under Oath / Record Production";
    if (records) return "Record Production";
    return "Examination Under Oath";
  }
  return "Claim Requirements";
}

function coverageSortRank(type: string, status: AnalysisStatus): number {
  if (/full mortality|^mortality$/i.test(type)) return 20;
  if (/^theft$/i.test(type)) return 30;
  if (status === "NEEDS CLARIFICATION" && /major medical|^surgical$/i.test(type)) return 120;
  if (status === "NEEDS CLARIFICATION") return 130;
  return 40;
}

type IndexBucket = {
  key: string;
  label: string;
  finding_type: SourceReferenceFindingType;
  sort_rank: number;
  document_id: string;
  families: Set<string>;
  evidence: SourceEvidenceLink[];
};

function walkedPagesForRecord(record: PolicyRecord): WalkedPolicyClause[] {
  const pages = record.documents.flatMap((doc) =>
    doc.pages.map((page) => ({
      page: page.page,
      text: page.text,
      document_id: doc.document_id
    }))
  );
  return walkPolicyClauses(pages);
}

function documentById(record: PolicyRecord, documentId: string): DocumentRecord | undefined {
  return record.documents.find((doc) => doc.document_id === documentId);
}

function pushEvidence(bucket: IndexBucket, evidence: SourceEvidenceLink): void {
  const key = `${evidence.document_id}|${evidence.page}|${evidence.finding_key}|${evidence.source_text.slice(0, 80).toLowerCase()}`;
  if (bucket.evidence.some((item) => `${item.document_id}|${item.page}|${item.finding_key}|${item.source_text.slice(0, 80).toLowerCase()}` === key)) {
    return;
  }
  bucket.evidence.push(evidence);
}

function looksLikeIdentityExternalReference(text: string): boolean {
  const hay = String(text || "");
  if (!/\bdeclarations\b/i.test(hay)) return false;
  if (!/\b(named insured|policy period|policy number|deductible|premium|insured horse|insured value)\b/i.test(hay)) {
    return false;
  }
  return (
    /\bas (?:stated|shown|set forth|described|listed|specified) in\b/i.test(hay) ||
    /\bitem [a-z] of (?:the )?(?:missing )?declarations\b/i.test(hay)
  );
}

function packageHasDeclarations(record: PolicyRecord): boolean {
  return record.documents.some(
    (doc) => doc.classification === "Declarations" || doc.pages.some((page) => looksLikeDeclarationsPage(page.text))
  );
}

export function buildSourceReferenceIndex(record: PolicyRecord): CustomerSourceReference[] {
  const buckets = new Map<string, IndexBucket>();
  const walked = walkedPagesForRecord(record);

  const ensure = (
    key: string,
    init: Omit<IndexBucket, "key" | "families" | "evidence"> & { families?: string[] }
  ): IndexBucket => {
    const existing = buckets.get(key);
    if (existing) return existing;
    const created: IndexBucket = {
      key,
      label: init.label,
      finding_type: init.finding_type,
      sort_rank: init.sort_rank,
      document_id: init.document_id,
      families: new Set(init.families || []),
      evidence: []
    };
    buckets.set(key, created);
    return created;
  };

  const identificationFields: Array<{ field?: Sourced<string>; key: string }> = [
    { field: record.identification.carrier_name, key: "carrier" },
    { field: record.identification.policy_form, key: "policy_form" },
    { field: record.identification.policy_number, key: "policy_number" },
    { field: record.identification.agency_name, key: "agency" },
    { field: record.identification.agent_name, key: "agent" },
    { field: record.identification.named_insured, key: "named_insured" },
    { field: record.identification.insured_horse_name, key: "insured_horse" },
    { field: record.identification.policy_effective_date, key: "effective_date" },
    { field: record.identification.policy_expiration_date, key: "expiration_date" },
    { field: record.identification.deductible, key: "deductible" },
    { field: record.identification.insured_value, key: "insured_value" }
  ];
  for (const item of identificationFields) {
    if (!foundIdentification(item.field)) continue;
    const bucket = ensure(`identification:${item.field.source_document_id}`, {
      label: "Policy Identification",
      finding_type: "identification",
      sort_rank: 10,
      document_id: item.field.source_document_id
    });
    pushEvidence(bucket, {
      document_id: item.field.source_document_id,
      page: item.field.source_page,
      finding_type: "identification",
      finding_key: item.key,
      source_text: item.field.source_text || item.field.value
    });
  }

  if (!packageHasDeclarations(record) && !foundIdentification(record.identification.named_insured)) {
    for (const doc of record.documents) {
      for (const page of doc.pages) {
        const sentences = String(page.text || "").split(/(?<=[.!?;\n])/);
        for (const sentence of sentences) {
          if (!looksLikeIdentityExternalReference(sentence)) continue;
          const excerpt = sentence.replace(/\s+/g, " ").trim().slice(0, 400);
          if (!excerpt) continue;
          const bucket = ensure(`missing-declarations:${doc.document_id}`, {
            label: "Missing Declarations / External-Reference Evidence",
            finding_type: "other",
            sort_rank: 15,
            document_id: doc.document_id
          });
          pushEvidence(bucket, {
            document_id: doc.document_id,
            page: page.page,
            finding_type: "other",
            finding_key: "missing_declarations",
            source_text: excerpt
          });
        }
      }
    }
  }

  const presentCoverages = record.coverages.filter((coverage) => coverage.coverage_status !== "NOT FOUND");
  const medical = presentCoverages.find((coverage) => /major medical/i.test(coverage.coverage_type));
  const surgical = presentCoverages.find((coverage) => /^surgical$/i.test(coverage.coverage_type));
  const mergeOptionalMedicalSurgical = Boolean(
    medical &&
      surgical &&
      medical.source_document_id === surgical.source_document_id &&
      medical.coverage_status === "NEEDS CLARIFICATION" &&
      surgical.coverage_status === "NEEDS CLARIFICATION"
  );
  const skipOptionalSameClause = new Set<string>();
  if (mergeOptionalMedicalSurgical && medical) {
    skipOptionalSameClause.add(`${medical.source_document_id}:${medical.source_page}`);
  }

  const addCoverageBucket = (coverage: CoverageRecord, label: string, rank: number, keySuffix: string) => {
    if (!coverage.source_page || coverage.source_page <= 0) return;
    const walkedHit = walked.find(
      (item) =>
        item.document_id === coverage.source_document_id &&
        item.page === coverage.source_page &&
        (item.kind === "grant" || item.section === "coverage" || isOptionalCoverageMention(item.clause))
    );
    const bucket = ensure(`coverage:${keySuffix}:${coverage.source_document_id}`, {
      label,
      finding_type: "coverage",
      sort_rank: rank,
      document_id: coverage.source_document_id
    });
    pushEvidence(bucket, {
      document_id: coverage.source_document_id,
      page: coverage.source_page,
      finding_type: "coverage",
      finding_key: coverage.coverage_type,
      source_text: coverage.source_text,
      section: walkedHit?.section
    });
  };

  if (mergeOptionalMedicalSurgical && medical && surgical) {
    addCoverageBucket(
      medical,
      "Optional Major Medical / Surgical Reference",
      120,
      "optional-medical-surgical"
    );
    addCoverageBucket(
      surgical,
      "Optional Major Medical / Surgical Reference",
      120,
      "optional-medical-surgical"
    );
  }

  for (const coverage of presentCoverages) {
    const isMedical = /major medical/i.test(coverage.coverage_type);
    const isSurgical = /^surgical$/i.test(coverage.coverage_type);
    if (mergeOptionalMedicalSurgical && (isMedical || isSurgical)) continue;
    if (
      coverage.coverage_status === "NEEDS CLARIFICATION" &&
      !isMedical &&
      !isSurgical &&
      skipOptionalSameClause.has(`${coverage.source_document_id}:${coverage.source_page}`)
    ) {
      continue;
    }
    addCoverageBucket(
      coverage,
      coverageIndexLabel(coverage.coverage_type, coverage.coverage_status),
      coverageSortRank(coverage.coverage_type, coverage.coverage_status),
      coverage.coverage_type.toLowerCase()
    );
  }

  const addDutyEvidence = (
    documentId: string,
    page: number,
    sourceText: string,
    family: string,
    findingKey: string
  ) => {
    const group = dutyIndexGroup(family);
    if (!group || !page || page <= 0) return;
    const walkedHit = walked.find(
      (item) => item.document_id === documentId && item.page === page && item.kind === "duty" && item.clause.includes(sourceText.slice(0, 24))
    ) || walked.find((item) => item.document_id === documentId && item.page === page && item.kind === "duty");
    const bucket = ensure(`duty:${group}:${documentId}`, {
      label: dutyGroupLabel(group, new Set([family])),
      finding_type: "duty",
      sort_rank:
        group === "vet_necropsy"
          ? 60
          : group === "notice"
            ? 70
            : group === "theft_police"
              ? 80
              : group === "proof"
                ? 90
                : 100,
      document_id: documentId,
      families: [family]
    });
    bucket.families.add(family);
    bucket.label = dutyGroupLabel(group, bucket.families);
    pushEvidence(bucket, {
      document_id: documentId,
      page,
      finding_type: "duty",
      finding_key: findingKey,
      source_text: sourceText,
      section: walkedHit?.section
    });
  };

  for (const requirement of record.requirements) {
    const blob = `${requirement.requirement} ${requirement.source_text}`;
    addDutyEvidence(
      requirement.source_document_id,
      requirement.source_page,
      requirement.source_text || requirement.requirement,
      dutyFamily(blob),
      requirement.trigger || "duty"
    );
  }
  for (const clause of walked) {
    if (clause.kind !== "duty" || !clause.document_id) continue;
    addDutyEvidence(clause.document_id, clause.page, clause.clause, dutyFamily(clause.clause), dutyFamily(clause.clause));
  }

  for (const clause of walked) {
    if (!clause.document_id || clause.kind === "exclusion" || clause.kind === "grant") continue;
    if (isTerritorialScopeLanguage(clause.clause)) {
      const bucket = ensure(`limit:territorial:${clause.document_id}`, {
        label: "Territorial Limits",
        finding_type: "limit",
        sort_rank: 50,
        document_id: clause.document_id
      });
      pushEvidence(bucket, {
        document_id: clause.document_id,
        page: clause.page,
        finding_type: "limit",
        finding_key: "territorial",
        source_text: clause.clause,
        section: clause.section
      });
    }
    if (isOtherInsuranceLanguage(clause.clause)) {
      const bucket = ensure(`condition:other-insurance:${clause.document_id}`, {
        label: "Other Insurance",
        finding_type: "condition",
        sort_rank: 110,
        document_id: clause.document_id
      });
      pushEvidence(bucket, {
        document_id: clause.document_id,
        page: clause.page,
        finding_type: "condition",
        finding_key: "other_insurance",
        source_text: clause.clause,
        section: clause.section
      });
    }
  }

  const exclusionsByDoc = new Map<string, typeof record.exclusions>();
  for (const exclusion of record.exclusions) {
    const list = exclusionsByDoc.get(exclusion.source_document_id) || [];
    list.push(exclusion);
    exclusionsByDoc.set(exclusion.source_document_id, list);
  }
  for (const [documentId, list] of exclusionsByDoc) {
    const bucket = ensure(`exclusion:${documentId}`, {
      label: "Exclusions",
      finding_type: "exclusion",
      sort_rank: 140,
      document_id: documentId
    });
    for (const exclusion of list) {
      const walkedHit = walked.find(
        (item) =>
          item.document_id === documentId &&
          item.page === exclusion.source_page &&
          (item.kind === "exclusion" || item.section === "exclusions")
      );
      pushEvidence(bucket, {
        document_id: documentId,
        page: exclusion.source_page,
        finding_type: "exclusion",
        finding_key: exclusion.exclusion_type,
        source_text: exclusion.exact_source_excerpt,
        section: walkedHit?.section || "exclusions"
      });
    }
  }

  const documentIndex = new Map(record.documents.map((doc, index) => [doc.document_id, index]));
  const orderedBuckets = [...buckets.values()]
    .filter((bucket) => bucket.evidence.some((item) => item.page > 0))
    .sort((a, b) => {
      if (a.sort_rank !== b.sort_rank) return a.sort_rank - b.sort_rank;
      const docA = documentIndex.get(a.document_id) ?? 999;
      const docB = documentIndex.get(b.document_id) ?? 999;
      if (docA !== docB) return docA - docB;
      const pageA = Math.min(...a.evidence.map((item) => item.page).filter((page) => page > 0));
      const pageB = Math.min(...b.evidence.map((item) => item.page).filter((page) => page > 0));
      return pageA - pageB;
    });

  return orderedBuckets.map((bucket) => {
    const pages = [...new Set(bucket.evidence.map((item) => item.page).filter((page) => page > 0))].sort((a, b) => a - b);
    const sectionNames = [
      ...new Set(
        bucket.evidence
          .map((item) => sectionDisplayLabel(item.section))
          .filter((label): label is string => Boolean(label))
      )
    ];
    return {
      id: bucket.key,
      label: bucket.label,
      document_id: bucket.document_id,
      document_label: sourceDocumentLabel(documentById(record, bucket.document_id)),
      pages,
      page_label: formatPageLocator(pages),
      section_label: sectionNames.length === 1 ? sectionNames[0] : undefined,
      finding_type: bucket.finding_type,
      evidence: bucket.evidence
    };
  });
}

export function looksLikeRawPolicyFragment(text: string): boolean {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length > 90) return true;
  return (
    /\bthe company will indemnify\b/i.test(value) ||
    /\bthe insured shall\b/i.test(value) ||
    /\bthis insurance does not cover\b/i.test(value) ||
    /\bno liability arises\b/i.test(value) ||
    /\bsubject nevertheless\b/i.test(value)
  );
}
