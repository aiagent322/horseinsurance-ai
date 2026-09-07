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
    /\b(?:we |the company )?(?:agree|agrees) to reimburse\b/i.test(clause) ||
    /\bwill reimburse\b/i.test(clause) ||
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

export function textHasIssuedApplicabilityGate(text: string): boolean {
  const n = String(text || "").replace(/\s+/g, " ");
  if (!n.trim()) return false;
  if (/\bonly applies (?:if|to)\b/i.test(n)) return true;
  if (/\bspecific premium(?: charge)?\b/i.test(n) && /\b(?:shown|indicated)\b/i.test(n)) return true;
  if (/\bpremium charge for\b/i.test(n) && /\b(?:is )?(?:indicated|shown)\b/i.test(n)) return true;
  if (/\bspecifically indicated in (?:the )?(?:declarations|schedule|item)\b/i.test(n)) return true;
  if (/\bif this endorsement is attached\b/i.test(n)) return true;
  if (/\bif (?:this )?coverage (?:is )?selected\b/i.test(n)) return true;
  if (/\bcoverage selected\b/i.test(n) && /\b(?:declarations|schedule)\b/i.test(n)) return true;
  if (/\bfor each horse shown in (?:the )?(?:declarations|schedule|item)\b/i.test(n)) return true;
  if (/\bif (?:a )?specific premium\b/i.test(n)) return true;
  if (/\bonly if .{0,80}(?:premium|indicated|shown|selected|scheduled)\b/i.test(n)) return true;
  if (/\bif shown (?:on|in) the (?:declarations|schedule)\b/i.test(n)) return true;
  if (/\bshown in the (?:declarations|schedule)\b/i.test(n) && /\b(?:only if|only applies)\b/i.test(n)) return true;
  return false;
}

const GENERIC_SELECTION_TERMS = new Set([
  "coverage",
  "endorsement",
  "insurance",
  "policy",
  "expense",
  "expenses",
  "equine",
  "optional",
  "form",
  "item",
  "schedule",
  "declarations"
]);

export function coverageSelectionTerms(names: string[], title?: string): string[] {
  const out: string[] = [];
  for (const raw of [...names, title || ""]) {
    const cleaned = String(raw || "")
      .replace(/\bendorsement\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length >= 4) out.push(cleaned);
    const words = cleaned.split(" ").filter((word) => word.length > 2 && !GENERIC_SELECTION_TERMS.has(word.toLowerCase()));
    if (words.length >= 2) out.push(words.slice(0, 2).join(" "));
    if (words.length >= 1 && words[0].length >= 6) out.push(words[0]);
  }
  const unique = new Set<string>();
  for (const term of out) {
    const key = term.toLowerCase();
    if (key.length < 4 || GENERIC_SELECTION_TERMS.has(key)) continue;
    unique.add(key);
  }
  return [...unique];
}

export function hasIssuedCoverageSelection(declarationsText: string, terms: string[]): boolean {
  const hay = String(declarationsText || "").replace(/\s+/g, " ").trim();
  if (!hay) return false;
  const lower = hay.toLowerCase();
  for (const term of terms) {
    const needle = term.toLowerCase().replace(/\s+/g, " ").trim();
    if (needle.length < 4) continue;
    let from = 0;
    while (from < lower.length) {
      const idx = lower.indexOf(needle, from);
      if (idx < 0) break;
      const window = hay.slice(Math.max(0, idx - 48), Math.min(hay.length, idx + needle.length + 140));
      if (/\$[\d,]+(?:\.\d{2})?/.test(window)) return true;
      if (/\b(?:yes|included|selected|elected)\b/i.test(window)) return true;
      if (/\bpremium\b.{0,32}\$?\d/i.test(window)) return true;
      if (/\b(?:limit|amount)\b.{0,24}\$?\d/i.test(window)) return true;
      if (/[\[(]\s*[xX✓✔]\s*[\])]/.test(window)) return true;
      from = idx + needle.length;
    }
  }
  return false;
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
  if (/\bequine surgical clinic\b/.test(lower)) return false;
  if (/\bsurgical clinic\b/.test(lower) && !/\bsurgical (?:procedure )?(?:expenses?|coverage)\b/.test(lower)) {
    return false;
  }
  if (/\bsurgical coverage\b/.test(lower)) return true;
  if (/\bsurgical procedure expenses?\b/.test(lower)) return true;
  if (/\bequine (?:zero deductible )?surgical coverage\b/.test(lower)) return true;
  if (/\bequine zero deductible surgical\b/.test(lower)) return true;
  return false;
}

export function clauseConcernsStallionCoverage(clause: string): boolean {
  const lower = clause.toLowerCase();
  if (!/\bstallion\b/.test(lower)) return false;
  return (
    /\b(?:infertil|impotent|availability|permanent disability|servicing mares|fails to complete two services|incapable of servicing)\b/.test(
      lower
    )
  );
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

const SECTION_ORDINAL =
  "(?:(?:part|article|section)\\s+[ivxlcdm0-9]+|(?:xiv|xiii|xii|xi|viii|vii|vi|iv|ix|iii|ii|xv|x|v|i))\\.?\\s+";

const STRONG_HEADING_PATTERN = new RegExp(
  `^(?:${SECTION_ORDINAL})?[—–-]?\\s*(what we do not cover|losses not insured|exclusions|duties after (?:a )?loss|claim conditions|duties of the insured|emergency requirements|claim requirements|general conditions|conditions|limitations|insuring agreement|arbitration(?: clause)?)\\s*[:.]?\\s*(.*)$`,
  "i"
);

const WEAK_HEADING_PATTERN = new RegExp(
  `^(?:${SECTION_ORDINAL})?[—–-]?\\s*(definitions?|coverages?|agreement)\\s*[:.]?\\s*$`,
  "i"
);

function sectionFromHeadingName(name: string): PolicySection | null {
  const n = name.replace(/\s+/g, " ").trim().toLowerCase();
  if (n === "what we do not cover" || n === "losses not insured" || n === "exclusions") return "exclusions";
  if (n === "duties after loss" || n === "duties after a loss" || n === "claim conditions" || n === "duties of the insured") {
    return "duties";
  }
  if (n === "emergency requirements" || n === "claim requirements") return "duties";
  if (n === "general conditions" || n === "conditions") return "conditions";
  if (n === "limitations") return "limitations";
  if (n === "insuring agreement" || n === "coverage" || n === "coverages" || n === "agreement") return "coverage";
  if (n === "definition" || n === "definitions") return "definitions";
  if (n === "arbitration" || n === "arbitration clause") return "arbitration";
  return null;
}

export function parseSectionHeadingLine(
  line: string,
  current?: PolicySection | null
): { section: PolicySection; rest: string } | null {
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
  const dutyHeading = raw.match(
    /^(?:[A-Z]\.\s+)?(duties(?:\s+after(?:\s+a)?\s+loss)?(?:\s+in the event of\b.*)?|what you must do|loss conditions)\s*[:.]?\s*$/i
  );
  if (dutyHeading) return { section: "duties", rest: "" };
  const titled = raw.match(/^[A-Z]\.\s+([A-Z][A-Z0-9 ,/'()&-]{3,})\s*$/);
  if (titled?.[1]) {
    if (/\bduties\b|what you must do|claim conditions|loss conditions|emergency requirements/i.test(titled[1])) {
      return { section: "duties", rest: "" };
    }
    if (current === "duties") return { section: "conditions", rest: "" };
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
    /\bwe (?:do not|will not) cover\b/i.test(clause) ||
    /\bwe will not pay for\b/i.test(clause) ||
    /\bwill not pay for (?:any )?loss\b/i.test(clause) ||
    /\bthe policy excludes\b/i.test(clause) ||
    /\bthe (?:company|insurer) (?:does not cover|shall not be liable)\b/i.test(clause) ||
    /\b(?:this (?:insurance|policy|endorsement) )?shall not apply to (?:any )?(?:claims?|loss|losses)\b/i.test(clause) ||
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
    /\b(?:notify|notice|report(?:ed)?|file|submit|produce|provide|obtain|employ|arrange|preserve|protect|cooperat\w*|furnish|inspect)\b/i.test(
      clause
    ) ||
    /\bsend us\b/i.test(clause) ||
    /\ballow us to inspect\b/i.test(clause) ||
    /\bexaminations?\s+under\s+oath\b/i.test(clause) ||
    /\bproof of loss\b/i.test(clause) ||
    /\bransom\b/i.test(clause) ||
    /\bqualified professional\b/i.test(clause) ||
    /\bprofessional (?:assistance|treatment)\b/i.test(clause) ||
    /\bpostmortem\b/i.test(clause) ||
    /\bpost-mortem\b/i.test(clause) ||
    /\bnecropsy\b/i.test(clause) ||
    /\bdisposal of\b.{0,80}\bremains\b/i.test(clause) ||
    /\bfollow .{0,80}recommend/i.test(clause)
  );
}

function hasEventOrClaimCue(clause: string): boolean {
  return (
    /\bin the event of\b/i.test(clause) ||
    /\bupon\b.{0,24}\b(?:request|illness|injury|death|theft|loss|damage|disappearance|accident)\b/i.test(clause) ||
    /\bfollowing (?:death|loss|theft|injury)\b/i.test(clause) ||
    /\bafter (?:an |the )?(?:insured )?loss\b/i.test(clause) ||
    /\bimmediate(?:ly)?\b/i.test(clause) ||
    /\bwithin\b.{0,24}\b(?:\d+|hours?|days?)\b/i.test(clause) ||
    /\b(?:if|when|as) requested\b/i.test(clause) ||
    /\bupon request\b/i.test(clause) ||
    /\bproof of loss\b/i.test(clause) ||
    /\bexaminations?\s+under\s+oath\b/i.test(clause) ||
    /\b(?:produce|submit|provide|preserve|furnish)\b.{0,60}(?:records|documents|receipts|invoices|books)\b/i.test(clause) ||
    /\bransom\b/i.test(clause) ||
    /\bfollow .{0,80}recommend/i.test(clause) ||
    /\b(?:police|law.?enforcement)\b/i.test(clause) ||
    /\bpostmortem\b/i.test(clause) ||
    /\bpost-mortem\b/i.test(clause) ||
    /\bnecropsy\b/i.test(clause)
  );
}

function hasDutyObligation(clause: string): boolean {
  if (/\b(shall|must|required to)\b/i.test(clause)) return true;
  if (/\b(?:shall|must|do)\s+not\b/i.test(clause)) return true;
  if (/\byou (?:must |shall )?notify\b/i.test(clause)) return true;
  if (/^\(\s*[a-z]+\s*\)/.test(clause.trim()) && /\bimmediate(?:ly)?\b/i.test(clause)) return true;
  return /^(?:[-•]\s*|\(\s*[a-z]{1,3}\s*\)\s*|[A-Za-z]\.\s*)?(?:immediately\s+)?(?:notify|report|file|submit|produce|obtain|employ|arrange|preserve|protect|follow|cooperate|give|allow|send|furnish)\b/i.test(
    clause.trim()
  );
}

export function isInsurerPerformanceLanguage(clause: string): boolean {
  const text = String(clause || "").replace(/\s+/g, " ").trim();
  if (/\b(?:you|the insured)\s+(?:must|shall)\b/i.test(text)) return false;
  return (
    /\bonce we have received\b/i.test(text) ||
    /\bwe shall pay\b/i.test(text) ||
    /\bwe will pay for a covered claim\b/i.test(text) ||
    /\bour obligation to indemnify\b/i.test(text)
  );
}

export function isValuationOrAuctionNotice(clause: string): boolean {
  const text = String(clause || "").replace(/\s+/g, " ").trim();
  if (!/notify|notice|report/i.test(text)) return false;
  return (
    /\b(?:public )?auction\b/i.test(text) ||
    /\bclaiming (?:race|price)\b/i.test(text) ||
    /\bhighest (?:bid|amount bid)\b/i.test(text) ||
    /limit of insurance.{0,120}reduc/i.test(text)
  );
}

export function isClaimDutyLanguage(clause: string): boolean {
  if (isCoverageGrantLanguage(clause)) return false;
  if (isCoverageLimitationLanguage(clause)) return false;
  if (isInsurerPerformanceLanguage(clause)) return false;
  if (isValuationOrAuctionNotice(clause)) return false;
  if (!hasDutyAction(clause) || !hasDutyObligation(clause)) return false;
  return hasEventOrClaimCue(clause);
}

export function classifyPolicyTerm(clause: string, section: PolicySection | null): PolicyTermKind | null {
  const text = String(clause || "").replace(/\s+/g, " ").trim();
  const markedListItem = /^(?:\d+\.\s*|\(\s*\d+\s*\)\s*|\(\s*[a-z]{1,3}\s*\)\s*|[A-Za-z]\.\s+)/i.test(text);
  if (text.length < 5) return null;
  if (text.length < 12 && !(section === "exclusions" && markedListItem)) return null;
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
    if (isInsurerPerformanceLanguage(text) || isValuationOrAuctionNotice(text)) return null;
    if (duty) return "duty";
    if (markedListItem && hasDutyAction(text) && !limitation && !exclusionWording) return "duty";
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

const BARE_CLAUSE_LIST_MARKER =
  /^(?:\d+\.|\(\s*\d+\s*\)|\(\s*[a-z]{1,3}\s*\)|[A-Za-z]\.)(?:\s+(?:\d+\.|\(\s*\d+\s*\)|\(\s*[a-z]{1,3}\s*\)|[A-Za-z]\.))*$/i;

function isBareClauseListMarker(text: string): boolean {
  return BARE_CLAUSE_LIST_MARKER.test(String(text || "").replace(/\s+/g, " ").trim());
}

function trailingListMarker(text: string): boolean {
  return /(?:^|[\s:])(?:\d+\.|\(\s*\d+\s*\)|\(\s*[a-z]{1,3}\s*\)|[A-Za-z]\.)$/i.test(String(text || "").trim());
}

function continuesEnumeratedList(part: string): boolean {
  return /^(?:and\s+)?(?:i{1,3}|iv|vi{0,3}|ix|x|[a-z])\.\s/i.test(String(part || "").trim());
}

export function splitPolicyClauses(text: string): string[] {
  const flattened = String(text || "").replace(/-\s*\n\s*/g, "").replace(/\n+/g, " ");
  const parts = flattened
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
  const out: string[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (
      prev &&
      (CLAUSE_ABBREVIATION_END.test(prev) ||
        isBareClauseListMarker(prev) ||
        /\bitem\s+\d+\.$/i.test(prev) ||
        trailingListMarker(prev) ||
        (/[;:]$/.test(prev) && continuesEnumeratedList(part)))
    ) {
      out[out.length - 1] = `${prev} ${part}`;
    } else {
      out.push(part);
    }
  }
  return out;
}

function isSequentialLetteredMarker(
  letter: string,
  lastLetter: string | null
): boolean {
  if (!lastLetter || letter.length !== 1 || lastLetter.length !== 1) return false;
  return letter.charCodeAt(0) === lastLetter.charCodeAt(0) + 1;
}

export function splitLetteredSubparagraphs(text: string): string[] {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const marker = /(\(\s*[a-z]+\s*\)|(?:^|(?<=[.!?;:]\s))[A-Z]\.(?=\s)|(?:^|(?<=[:;]\s)|(?<=[.!?]\s))[a-z]\.(?=\s))/g;
  const starts: number[] = [];
  let lastLetter: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(raw))) {
    const letter = match[1].replace(/[().\s]/g, "").toLowerCase();
    if (/^(i{2,3}|iv|vi{0,3}|ix|x)$/.test(letter)) continue;
    if (letter === "i" && lastLetter !== "h") continue;
    const before = raw.slice(0, match.index);
    const atBoundary = match.index === 0 || /[.;:]\s+$/.test(before);
    const sequential = isSequentialLetteredMarker(letter, lastLetter) && /\s$/.test(before);
    if (!atBoundary && !sequential) continue;
    starts.push(match.index);
    lastLetter = letter;
  }
  if (starts.length === 0) return [raw];
  const intro = starts[0] > 0 ? raw.slice(0, starts[0]).trim() : "";
  const obligationPrefix = /\b(shall|must)\b/i.test(intro) ? intro.replace(/[:]\s*$/, "").trim() : "";
  const slices: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : raw.length;
    let piece = raw.slice(starts[i], end).trim();
    if (obligationPrefix && !/\b(shall|must)\b/i.test(piece)) {
      const marked = piece.match(/^(?:\d+\.\s*|\(\s*\d+\s*\)\s*|\(\s*[a-z]{1,3}\s*\)\s*|[A-Za-z]\.\s*)/);
      if (marked) {
        const lead = obligationPrefix.replace(/^(?:\d+\.\s*)/, "").trim();
        piece = `${marked[0]}${lead} ${piece.slice(marked[0].length)}`.replace(/\s+/g, " ").trim();
      } else {
        piece = `${obligationPrefix} ${piece}`;
      }
    }
    if (piece.length >= 5) slices.push(piece);
  }
  if (
    intro.length >= 12 &&
    !/^(?:\d+\.?\s*)?(?:the\s+)?insured\s+shall:?$/i.test(intro) &&
    starts[0] > 0
  ) {
    slices.unshift(intro);
  }
  return slices.length ? slices : [raw];
}

export function splitNumberedListItems(text: string): string[] {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const marker =
    /(?:^|(?<=[.!?;:]\s)|(?<=\s))(?:\(\s*\d+\s*\)|\d+\.)(?=\s+(?:this |we |the (?:company|insurer|policy)|loss caused by))/gi;
  const starts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = marker.exec(raw))) {
    starts.push(match.index);
  }
  if (starts.length === 0) return [raw];
  const slices: string[] = [];
  if (starts[0] > 0) {
    const head = raw.slice(0, starts[0]).trim();
    if (head.length >= 12) slices.push(head);
  }
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : raw.length;
    const piece = raw.slice(starts[i], end).trim();
    if (piece.length >= 5) slices.push(piece);
  }
  return slices.length ? slices : [raw];
}

export function partitionCompleteClauses(text: string): { complete: string; remainder: string } {
  const raw = String(text || "").trim();
  if (!raw) return { complete: "", remainder: "" };
  if (/[.!?;]$/.test(raw)) return { complete: raw, remainder: "" };
  let lastBreak = -1;
  const re = /[.!?;](?=\s)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    if (match[0] === "." && /\d$/.test(raw.slice(0, match.index))) continue;
    lastBreak = match.index;
  }
  if (lastBreak < 0) return { complete: "", remainder: raw };
  return {
    complete: raw.slice(0, lastBreak + 1).trim(),
    remainder: raw.slice(lastBreak + 1).trim()
  };
}

export function splitCoordinatedDuties(clause: string): string[] {
  const pieces = String(clause || "")
    .split(
      /\s*(?:;|,?\s+and\s+(?=(?:shall|must|immediately)?\s*(?:notify|report|produce|submit|preserve|protect|follow|file|employ|arrange|cooperate))|,\s+(?=(?:shall|must|immediately)?\s*(?:notify|report|produce|submit|preserve|protect|follow|file|employ|arrange)))\s*/i
    )
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 8);
  return pieces.length > 1 ? pieces : [String(clause || "").replace(/\s+/g, " ").trim()].filter(Boolean);
}

export type WalkedPolicyClause = {
  clause: string;
  page: number;
  document_id?: string;
  section: PolicySection | null;
  kind: PolicyTermKind | null;
  numberedItem?: number | null;
  letteredItem?: string | null;
};

const CLAUSE_LIST_PREFIX =
  /^(?:\d+\.\s*|\(\s*\d+\s*\)\s*|\(\s*[a-z]{1,3}\s*\)\s*|[A-Z]\.\s*)+/;

function isPageChromeLine(line: string): boolean {
  const text = String(line || "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/^page\s+\d+(?:\s+of\s+\d+)?$/i.test(text)) return true;
  return /^(?:[A-Za-z0-9][A-Za-z0-9/.\-]{0,24}\s+)?(?:\(\s*\d{1,2}\/\d{2,4}\s*\)\s+)?page\s+\d+\s+of\s+\d+$/i.test(text);
}

export function stripClauseListPrefix(text: string): string {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(CLAUSE_LIST_PREFIX, "")
    .trim();
}

function parseClauseListMarkers(clause: string): { numbered: number | null; lettered: string | null } {
  const text = String(clause || "").trim();
  const numberedDot = text.match(/^(\d+)\.(?=\s|$)/);
  const numberedParen = text.match(/^\(\s*(\d+)\s*\)(?=\s|$)/);
  const letteredParen = text.match(/^(?:\d+\.\s*|\(\s*\d+\s*\)\s*)?\(\s*([a-z]{1,3})\s*\)/i);
  const letteredDot = text.match(/^([A-Za-z])\.(?=\s|$)/);
  return {
    numbered: numberedDot ? Number(numberedDot[1]) : numberedParen ? Number(numberedParen[1]) : null,
    lettered: letteredParen ? letteredParen[1].toLowerCase() : letteredDot ? letteredDot[1].toLowerCase() : null
  };
}

export function walkPolicyClauses(
  pages: Array<{ page: number; text: string; document_id?: string }>
): WalkedPolicyClause[] {
  let section: PolicySection | null = null;
  let lastDocumentId: string | undefined;
  let leftover = "";
  let leftoverPage = 0;
  let currentNumbered: number | null = null;
  const out: WalkedPolicyClause[] = [];

  const emit = (chunk: string, page: number, document_id: string | undefined, active: PolicySection | null) => {
    for (const numbered of splitNumberedListItems(chunk)) {
      for (const unit of splitLetteredSubparagraphs(numbered)) {
        for (const clause of splitPolicyClauses(unit)) {
          const markers = parseClauseListMarkers(clause);
          const tooShort =
            clause.length < 5 || (clause.length < 12 && markers.lettered == null && markers.numbered == null);
          if (tooShort) continue;
          if (markers.numbered != null) currentNumbered = markers.numbered;
          out.push({
            clause,
            page,
            document_id,
            section: active,
            kind: classifyPolicyTerm(clause, active),
            numberedItem: currentNumbered,
            letteredItem: markers.lettered
          });
        }
      }
    }
  };

  const flushLeftover = (document_id: string | undefined) => {
    if (leftover.trim()) emit(leftover, leftoverPage || 1, document_id, section);
    leftover = "";
  };

  for (const page of pages) {
    if (page.document_id !== undefined && lastDocumentId !== undefined && page.document_id !== lastDocumentId) {
      flushLeftover(lastDocumentId);
      section = null;
      currentNumbered = null;
    }
    if (page.document_id !== undefined) lastDocumentId = page.document_id;

    let buffer = leftover;
    leftover = "";

    const flush = () => {
      if (buffer.trim()) emit(buffer, page.page, page.document_id, section);
      buffer = "";
    };

    for (const rawLine of String(page.text || "").split(/\n/)) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (!line || isPageChromeLine(line)) continue;
      const parsed = parseSectionHeadingLine(line, section);
      if (parsed) {
        flush();
        section = parsed.section;
        currentNumbered = null;
        if (parsed.rest) buffer = parsed.rest;
        continue;
      }
      if (CLAUSE_LIST_PREFIX.test(line) && buffer.trim()) {
        flush();
      }
      buffer = buffer ? `${buffer} ${line}` : line;
    }

    const partitioned = partitionCompleteClauses(buffer);
    leftover = partitioned.remainder;
    leftoverPage = leftover ? page.page : 0;
    buffer = partitioned.complete;
    flush();
  }
  flushLeftover(lastDocumentId);
  return out;
}

export const KNOWN_EXCLUSION_CATEGORIES: { title: string; test: (text: string) => boolean }[] = [
  { title: "Intentional Destruction", test: (t) => /intentional destruction|humane destruction/.test(t) },
  { title: "Contagious / Communicable Disease", test: (t) => /contagious|communicable disease/.test(t) },
  { title: "Surgical Operations", test: (t) => /surgical operation/.test(t) },
  { title: "Medication / Substance", test: (t) => /medication|narcotic|\bdrug\b|chemical substance|\bsubstance\b/.test(t) },
  { title: "Malicious / Willful / Intentional Acts", test: (t) => /malicious|willful|intentional act/.test(t) },
  { title: "Failure to Provide Proper Care", test: (t) => /failure to provide proper care/.test(t) },
  { title: "Nuclear Risk", test: (t) => /nuclear/.test(t) },
  { title: "Confiscation", test: (t) => /confiscation/.test(t) },
  { title: "War / Military Force", test: (t) => /\bwar\b|civil war|military force/.test(t) },
  { title: "Mysterious Disappearance / Escape", test: (t) => /mysterious disappearance|\bescape\b/.test(t) },
  { title: "Fraudulent Voluntary Parting", test: (t) => /voluntary parting/.test(t) },
  { title: "Consequential Loss", test: (t) => /consequential loss/.test(t) }
];

export const KNOWN_EXCLUSION_TITLES = new Set(KNOWN_EXCLUSION_CATEGORIES.map((item) => item.title));

export function exclusionCategories(clause: string): string[] {
  const t = String(clause || "").toLowerCase();
  return KNOWN_EXCLUSION_CATEGORIES.filter((item) => item.test(t)).map((item) => item.title);
}

export function exclusionCategory(clause: string): string {
  return exclusionCategories(clause)[0] || genericExclusionTitle(clause) || "Stated exclusion";
}

const EXCEPTION_CUE =
  /\bexcept(?:\s+that)?\b|\bhowever\b|\bprovided(?:\s*,?\s*however)?(?:\s+that)?\b|this exclusion (?:shall|does|will) not apply|\bunless\b|\bsubject to\b|\bnotwithstanding\b|carve-?back/i;

export function hasExclusionExceptionCue(clause: string): boolean {
  return EXCEPTION_CUE.test(String(clause || ""));
}

export function isExclusionDefinitionLanguage(clause: string): boolean {
  const text = String(clause || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (startsAsNewExclusionLanguage(text) && !/\bas used herein\b|\bshall mean\b|\bmeans\s+["“']/i.test(text)) {
    return false;
  }
  return (
    /\bas used herein\b/i.test(text) ||
    /\bshall mean\b/i.test(text) ||
    /\bmeans\s+["“']/i.test(text) ||
    /\bfor (?:the )?purposes of this (?:exclusion|section|endorsement)\b/i.test(text)
  );
}

export function isExclusionQualificationLanguage(clause: string): boolean {
  const text = String(clause || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (
    /(post-?mortem|necropsy).{0,120}(opportunit|examin)/i.test(text) ||
    /(opportunit).{0,80}(post-?mortem|necropsy|examin)/i.test(text)
  ) {
    return true;
  }
  if (/\bthe (?:company|insurer) must be given\b/i.test(text) && /(post-?mortem|necropsy|examin)/i.test(text)) {
    return true;
  }
  if (/\bprovided(?:\s*,?\s*however)?(?:\s+that)\b/i.test(text) && !startsAsNewExclusionLanguage(text)) {
    return true;
  }
  return false;
}

export function startsAsExceptionLanguage(clause: string): boolean {
  return /^(?:however|except(?:\s+that)?|provided(?:\s*,?\s*however)?(?:\s+that)?|this exclusion (?:shall|does|will) not apply|unless|notwithstanding|subject to)\b/i.test(
    stripClauseListPrefix(clause)
  );
}

export function startsAsNewExclusionLanguage(clause: string): boolean {
  const text = stripClauseListPrefix(clause);
  return (
    /^(?:this insurance|this policy|this endorsement|we|the company|the insurer|the policy)\s+(?:does not cover|do not cover|shall not be liable|will not pay|excludes|excludes coverage)\b/i.test(
      text
    ) || /^(?:we (?:do not|will not) cover|the policy excludes|loss caused by)\b/i.test(text)
  );
}

export type ExclusionClauseRelation = "parent" | "exception" | "qualification" | "definition" | "continuation";

export type ExclusionParentScope = {
  numberedItem?: number | null;
  letteredItem?: string | null;
  types: string[];
};

export function isUmbrellaExclusionOpener(clause: string): boolean {
  const core = splitExclusionSatellites(clause).core;
  if (exclusionCategories(core).length > 0) return false;
  const stripped = stripClauseListPrefix(core).replace(/\s+/g, " ").trim();
  if (
    !/(?:does not cover|do not cover|will not cover|excludes(?:\s+coverage)?|shall not apply|does not apply)/i.test(
      stripped
    )
  ) {
    return false;
  }
  const remainder = stripped
    .replace(
      /^(?:this insurance|this policy|this endorsement|we|the company|the insurer|the policy)\s+/i,
      ""
    )
    .replace(
      /^(?:does not cover|do not cover|will not cover|shall not be liable(?:\s+for)?|will not pay(?:\s+for)?|excludes(?:\s+coverage(?:\s+for)?)?|shall not apply|does not apply)\s*/i,
      ""
    )
    .replace(/^(?:to\s+)?(?:any\s+)?(?:claims?|loss(?:es)?)\s*/i, "")
    .replace(/^(?:arising out of|resulting from)\s*,?\s*/i, "")
    .replace(/^(?:any\s+)?loss(?:\s+directly(?:\s+or\s+indirectly)?)?\s*/i, "")
    .replace(
      /\b(?:caused by|happening through|in consequence of|resulting from|arising out of|as a consequence of|directly or indirectly)\b/gi,
      " "
    )
    .replace(/\b(?:and|or|to)\b/gi, " ")
    .replace(/[:.;,\s]+/g, " ")
    .trim();
  return remainder.length === 0;
}

function isNewExclusionSubject(clause: WalkedPolicyClause, parent: ExclusionParentScope | null, cats: string[]): boolean {
  if (!parent) return startsAsNewExclusionLanguage(clause.clause) || cats.length > 0 || Boolean(clause.letteredItem);

  const numberedChanged =
    clause.numberedItem != null && parent.numberedItem != null && clause.numberedItem !== parent.numberedItem;
  const introducesNewKnownCause = cats.length > 0 && cats.some((title) => !parent.types.includes(title));
  const letteredChanged =
    Boolean(parent.letteredItem) && Boolean(clause.letteredItem) && clause.letteredItem !== parent.letteredItem;

  if (letteredChanged && !startsAsExceptionLanguage(clause.clause)) return true;
  if (parent.letteredItem && !clause.letteredItem && !startsAsNewExclusionLanguage(clause.clause)) {
    return false;
  }
  if (numberedChanged && (startsAsNewExclusionLanguage(clause.clause) || cats.length > 0)) return true;
  if (clause.letteredItem) {
    if (introducesNewKnownCause) return true;
    if (parent.types.length === 0 && (cats.length > 0 || Boolean(genericExclusionTitle(clause.clause)))) return true;
    const letteredTitle = genericExclusionTitle(clause.clause);
    if (
      parent.letteredItem &&
      clause.letteredItem !== parent.letteredItem &&
      letteredTitle &&
      !parent.types.includes(letteredTitle)
    ) {
      return true;
    }
    if (!parent.letteredItem && !parent.numberedItem) return true;
    return false;
  }
  if (startsAsNewExclusionLanguage(clause.clause) && (numberedChanged || introducesNewKnownCause || parent.types.length === 0)) {
    return true;
  }
  return false;
}

export function classifyExclusionClauseRelation(
  clause: WalkedPolicyClause,
  parent: ExclusionParentScope | null
): ExclusionClauseRelation {
  const text = String(clause.clause || "").replace(/\s+/g, " ").trim();
  if (isExclusionDefinitionLanguage(text)) return "definition";
  if (startsAsExceptionLanguage(text)) return "exception";
  if (isExclusionQualificationLanguage(text) && !startsAsNewExclusionLanguage(text)) return "qualification";

  const cats = exclusionCategories(splitExclusionSatellites(text).core);
  if (isNewExclusionSubject(clause, parent, cats)) return "parent";
  if (parent && clause.letteredItem) return "exception";
  if (parent?.letteredItem && !clause.letteredItem && !startsAsNewExclusionLanguage(text)) {
    if (
      hasExclusionExceptionCue(text) ||
      /^(?:\d+\.\s*)?(?:to\b|if we|where the|unless)\b/i.test(stripClauseListPrefix(text))
    ) {
      return "exception";
    }
    return "continuation";
  }
  if (parent && clause.numberedItem != null && parent.numberedItem != null && clause.numberedItem === parent.numberedItem) {
    if (cats.length > 0 && cats.every((title) => parent.types.includes(title))) return "continuation";
    if (!startsAsNewExclusionLanguage(text) && cats.length === 0) {
      return hasExclusionExceptionCue(text) ? "exception" : "continuation";
    }
  }
  if (startsAsNewExclusionLanguage(text) || cats.length > 0) return "parent";
  if (parent) {
    if (hasExclusionExceptionCue(text)) return "exception";
    if (isExclusionQualificationLanguage(text)) return "qualification";
    return "continuation";
  }
  return "parent";
}

export function splitExclusionSatellites(text: string): {
  core: string;
  exceptions: string[];
  qualifications: string[];
} {
  let core = String(text || "").replace(/\s+/g, " ").trim();
  const exceptions: string[] = [];
  const qualifications: string[] = [];
  const provided = core.match(/\bprovided(?:\s*,?\s*however)?(?:\s+that)\b[\s\S]*/i);
  if (provided && provided.index != null && provided.index > 12) {
    qualifications.push(provided[0].trim());
    core = core.slice(0, provided.index).replace(/[,;:\s]+$/, "").trim();
  }
  const excepted = core.match(
    /\b(?:except(?:\s+that)?|however(?:\s*,)?(?:\s+this exclusion (?:shall|does|will) not apply)?|this exclusion (?:shall|does|will) not apply)[\s\S]*/i
  );
  if (excepted && excepted.index != null && excepted.index > 12) {
    exceptions.push(excepted[0].trim());
    core = core.slice(0, excepted.index).replace(/[,;:\s]+$/, "").trim();
  }
  return { core, exceptions, qualifications };
}

function titleCaseCause(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:any|the|a)\s+/i, "")
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

export function genericExclusionTitle(clause: string): string | null {
  const core = splitExclusionSatellites(clause).core;
  const stripped = stripClauseListPrefix(core);
  const caused = stripped.match(/\bloss caused by\s+([^.;]+)/i);
  const covered = stripped.match(
    /(?:does not cover|do not cover|will not cover|excludes(?:\s+coverage for)?)\s+(?:loss\s+(?:of|from|caused by)\s+)?([^.;]+)/i
  );
  let raw = (caused?.[1] || covered?.[1] || "").replace(/\s+/g, " ").trim();
  if (!raw && /^(?:\d+\.|\(\s*\d+\s*\)|\(\s*[a-z]{1,3}\s*\)|[A-Za-z]\.)/i.test(core)) {
    raw = stripped.split(/\s*[;,]+\s*|\s+or\s+/i)[0]?.trim() || "";
    if (/^(?:this insurance|this policy|we do not(?:\s+cover)?|the company|the policy|loss|loss caused by)$/i.test(raw.replace(/[:.]+$/, ""))) {
      raw = "";
    }
  }
  if (!raw) return null;
  const first = raw.split(/\s*,\s*|\s+or\s+/i)[0]?.trim() || "";
  if (first.length < 3 || first.length > 100) return null;
  if (/^(?:any\s+)?loss(?:\s+directly(?:\s+or\s+indirectly)?)?$/i.test(first)) return null;
  if (/\bloss\b/i.test(first) && /(?:directly|indirectly|caused by)$/i.test(first)) return null;
  if (/^(?:caused by|happening through|in consequence of)$/i.test(first)) return null;
  return titleCaseCause(first);
}

export function summarizeExclusionSatellite(
  kind: ExclusionClauseRelation | "exception" | "qualification" | "definition" | "continuation",
  clause: string
): string {
  const text = String(clause || "").replace(/\s+/g, " ").trim();

  if (kind === "definition") {
    return "The provision defines a term used in this exclusion.";
  }

  if (kind === "qualification" || kind === "continuation") {
    if (/post-?mortem|necropsy/.test(text)) {
      return "The Company must be given the opportunity for the required postmortem/necropsy examination.";
    }
    if (/inspect|examin/.test(text) && /opportunit|provided that|must be given/i.test(text)) {
      return "The insurer must be given an opportunity to inspect, as stated in the policy.";
    }
    if (/certif/.test(text) && /licensed|professional|veterinar/.test(text)) {
      return "A licensed professional must certify the necessity, as stated in the policy.";
    }
    return "The exclusion is subject to a stated procedural condition in the same provision.";
  }

  if (/will not invoke|not invoke this.{0,60}exclusion|as a defense/i.test(text)) {
    return "The Company will not rely on this exclusion as a defense in the circumstances stated in the policy.";
  }
  if (/fire/.test(text) && /flood/.test(text)) {
    return "Fire following flood, as stated in the provision.";
  }
  if (/supplement/.test(text) && /direction|label|product/.test(text)) {
    return "Commonly available nutritional supplements used according to the stated product directions and policy conditions.";
  }
  if (/supplement/.test(text)) {
    return "Qualifying nutritional supplements meeting the stated policy conditions.";
  }
  if (/death/.test(text) && /theft/.test(text)) {
    return "Death following theft, as stated in the provision.";
  }
  if (/humane/.test(text)) {
    return "Certain humane-destruction circumstances supported by the required veterinary determination.";
  }
  if (/approved|authoriz/.test(text)) {
    return "Company-authorized destruction in the circumstances stated by the policy.";
  }
  if (/licensed/.test(text) && /veterinar/.test(text) && /surgical|operation/.test(text)) {
    return "Surgical operations performed by a licensed veterinarian under the specified medically necessary or approved circumstances.";
  }
  if (/licensed/.test(text) && /veterinar|professional/.test(text)) {
    return "Circumstances involving a licensed professional determination, as stated in the policy.";
  }
  if (/aircraft|in.?transit|aboard|transport/.test(text) || /emergency/.test(text)) {
    return "Certain emergency or in-transit circumstances stated in the policy.";
  }
  if (/household product/.test(text)) {
    return "Ordinary household products used according to stated label directions.";
  }
  if (/peacetime|training exercise/.test(text)) {
    return "A declared peacetime training exercise, as stated in the provision.";
  }
  return "A circumstance described in the provision in which this exclusion may not apply.";
}

const EXCLUSION_CAUSE_PHRASE: Record<string, string> = {
  "Intentional Destruction": "intentional destruction of an insured horse",
  "Contagious / Communicable Disease": "destruction of a horse because of contagious or communicable disease",
  "Surgical Operations": "loss arising from certain surgical operations",
  "Medication / Substance": "loss arising from certain medication or substance circumstances described in the policy",
  "Malicious / Willful / Intentional Acts": "loss caused by malicious, willful, or intentional acts or omissions",
  "Failure to Provide Proper Care": "loss caused by failure to provide proper care and attention",
  "Nuclear Risk": "loss caused by nuclear fission, nuclear fusion, or radioactive contamination",
  Confiscation: "loss caused by confiscation or similar governmental action described in the provision",
  "War / Military Force": "loss caused by war, civil war, insurrection, invasion, military force, or related events described in the policy",
  "Mysterious Disappearance / Escape": "loss arising from mysterious disappearance or escape",
  "Fraudulent Voluntary Parting": "loss resulting from fraudulent voluntary parting with possession or title",
  "Consequential Loss": "consequential loss, injury, or damage",
  "Named anatomical / condition exclusion": "coverage for the named anatomical area or condition",
  "Pre-existing condition": "pre-existing conditions as stated in the documents"
};

const EXCLUSION_PLACEHOLDER_PATTERNS = [
  /specified circumstances in which the exclusion may not apply/i,
  /specified circumstances in which destruction may not be barred/i,
  /a stated exception in the same provision/i,
  /\bstated exclusion\b/i,
  /exception for the Company will not invoke/i,
  /\bunknown exception\b/i,
  /\brelated exception\b/i
];

const EXCLUSION_GRAMMAR_ARTIFACT_PATTERNS = [
  /\.;/,
  /:;/,
  /,\./,
  /for the Company will/i,
  /exception for when/i,
  /exception for where/i,
  /contains an exception for the policy excludes/i,
  /contains an exception for the Company/i,
  /exception for the Company will/i,
  /subject to The Company must/i
];

function joinExclusionPhrases(parts: string[]): string {
  const unique = [...new Set(parts.filter(Boolean))];
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

function satelliteBlob(attachments?: Array<{ kind: string; explanation: string; source_text?: string }>): string {
  return (attachments || []).map((item) => `${item.explanation} ${item.source_text || ""}`).join(" ");
}

function exclusionLeadSentence(type: string, source: string): string {
  switch (type) {
    case "Intentional Destruction":
      return "The policy excludes intentional destruction of an insured horse.";
    case "Contagious / Communicable Disease":
      if (/destruct/.test(source)) {
        return "The policy excludes destruction of a horse because it contracted or was exposed to a contagious or communicable disease.";
      }
      return "The policy excludes destruction of a horse because of contagious or communicable disease.";
    case "Surgical Operations":
      return "The policy excludes loss arising from certain surgical operations.";
    case "Medication / Substance":
      return "The policy excludes loss arising from certain medication or substance circumstances described in the policy.";
    case "Malicious / Willful / Intentional Acts":
      if (/\binsured\b/i.test(source)) {
        return "The policy excludes loss caused by malicious, willful, or intentional acts or omissions by the insured or specified persons associated with the insured.";
      }
      return "The policy excludes loss caused by malicious, willful, or intentional acts or omissions.";
    case "Failure to Provide Proper Care":
      return "The policy excludes loss caused by failure to provide proper care and attention.";
    case "Nuclear Risk":
      return "The policy excludes loss caused by nuclear fission, nuclear fusion, or radioactive contamination.";
    case "Confiscation":
      return "The policy excludes loss caused by confiscation or similar governmental action described in the provision.";
    case "War / Military Force":
      return "The policy excludes loss caused by war, civil war, insurrection, invasion, military force, or related events described in the policy.";
    case "Mysterious Disappearance / Escape":
      return "The policy excludes loss arising from mysterious disappearance or escape.";
    case "Fraudulent Voluntary Parting":
      return "The policy excludes loss resulting from fraudulent voluntary parting with possession or title.";
    case "Consequential Loss":
      return "The policy excludes consequential loss, injury, or damage.";
    default: {
      const phrase = EXCLUSION_CAUSE_PHRASE[type];
      if (phrase) return `The policy excludes ${phrase}.`;
      const named = type.replace(/\s*\/\s*/g, " ").trim();
      if (named && !/^stated exclusion$/i.test(named)) {
        return `The policy excludes ${named.charAt(0).toLowerCase()}${named.slice(1)}.`;
      }
      return "The policy excludes this cause of loss.";
    }
  }
}

function withSubjectClause(lead: string, clause: string): string {
  return `${lead.replace(/\.+$/, "")}, ${clause}.`;
}

function genericSatelliteSubjectClause(exceptions: boolean, qualifications: boolean): string {
  if (exceptions && qualifications) return "subject to the exceptions or qualifications stated in the provision";
  if (exceptions) return "subject to the exceptions stated in the policy";
  return "subject to the qualifications stated in the provision";
}

function intentionalDestructionExceptionSentence(source: string): string {
  const authorized = /approved|authoriz/.test(source);
  const humane = /humane/.test(source);
  const emergency = /aircraft|in.?transit|aboard|emergency|berserk/.test(source);
  const bits: string[] = [];
  if (authorized) bits.push("Company-authorized destruction");
  if (emergency || humane) {
    bits.push("certain emergency or humane-destruction circumstances subject to the policy's veterinary requirements");
  }
  if (bits.length) return `Exceptions include ${joinExclusionPhrases(bits)}.`;
  return "The exclusion is subject to specified exceptions for circumstances permitted by the policy.";
}

function qualificationNarrative(source: string): string | undefined {
  if (/post-?mortem|necropsy/.test(source)) {
    return "The Company must be given the opportunity for the required postmortem/necropsy examination in the circumstances specified by the policy.";
  }
  if (/inspect/.test(source)) {
    return "The Company must be given the opportunity to inspect as stated in the policy.";
  }
  if (/certif/.test(source)) {
    return "A licensed professional must certify the necessity, as stated in the policy.";
  }
  return undefined;
}

export function looksLikePlaceholderExclusionNarrative(text: string): boolean {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return false;
  return EXCLUSION_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

export function looksLikeUngrammaticalExclusionNarrative(text: string): boolean {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return false;
  return EXCLUSION_GRAMMAR_ARTIFACT_PATTERNS.some((pattern) => pattern.test(value));
}

function conservativeExclusionFallback(hasSatellites: boolean): string {
  return hasSatellites
    ? "The policy excludes this cause of loss, subject to the exceptions or qualifications stated in the provision."
    : "The policy excludes this cause of loss.";
}

function finalizeExclusionNarrative(text: string, hasSatellites: boolean): string {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (
    !cleaned ||
    looksLikePlaceholderExclusionNarrative(cleaned) ||
    looksLikeUngrammaticalExclusionNarrative(cleaned) ||
    /this is covered if|automatically covered|coverage is guaranteed/i.test(cleaned)
  ) {
    return conservativeExclusionFallback(hasSatellites);
  }
  return cleaned;
}

export function explainExclusion(
  type: string,
  attachments?: Array<{ kind: string; explanation: string; source_text?: string }>,
  sourceText?: string
): string {
  const source = `${sourceText || ""} ${satelliteBlob(attachments)}`;
  const exceptions = (attachments || []).filter((item) => item.kind === "exception");
  const qualifications = (attachments || []).filter((item) => item.kind === "qualification");
  const hasSatellites = exceptions.length > 0 || qualifications.length > 0;
  const parts: string[] = [exclusionLeadSentence(type, source)];

  if (type === "Intentional Destruction" && exceptions.length > 0) {
    parts.push(intentionalDestructionExceptionSentence(source));
  } else if (type === "Surgical Operations" && exceptions.length > 0) {
    parts[0] = withSubjectClause(parts[0], "subject to the exceptions stated in the policy");
  } else if (type === "Medication / Substance" && /supplement/.test(source)) {
    parts.push(
      "The provision contains an exception for commonly available nutritional supplements used according to the stated product directions and policy conditions."
    );
  } else if (type === "Consequential Loss" && /death/.test(source) && /theft/.test(source)) {
    parts[0] = withSubjectClause(
      "The policy excludes consequential loss, injury, or damage",
      "subject to the policy's stated exception for death following theft"
    );
  } else if (hasSatellites) {
    parts[0] = withSubjectClause(parts[0], genericSatelliteSubjectClause(exceptions.length > 0, qualifications.length > 0));
  }

  if (qualifications.length > 0) {
    const qualification = qualificationNarrative(source);
    if (qualification) parts.push(qualification);
  }

  return finalizeExclusionNarrative(parts.join(" "), hasSatellites);
}

export function looksLikeRawExclusionExplanation(description: string, sourceText?: string): boolean {
  const desc = String(description || "").replace(/\s+/g, " ").trim();
  const src = String(sourceText || "").replace(/\s+/g, " ").trim();
  if (!desc) return false;
  if (src && desc === src && desc.length > 80) return true;
  if (src && desc.length >= 160 && src.toLowerCase().includes(desc.slice(0, 80).toLowerCase())) return true;
  if (/this insurance does not cover/i.test(desc) && desc.length > 140) return true;
  return false;
}

export type DutyRule = { trigger: string; pattern: RegExp };

export const CLAIM_DUTY_RULES: DutyRule[] = [
  { trigger: "Immediate veterinary care", pattern: /(?:employ|obtain|seek)\b.{0,60}\b(?:licensed\s+)?veterinar|veterinar(?:y)?\s+(?:care|treatment)|qualified professional|professional (?:assistance|treatment)/i },
  { trigger: "Postmortem / necropsy", pattern: /\b(postmortem|post-mortem|necropsy)\b/i },
  { trigger: "Immediate notice", pattern: /immediate(?:ly)? .{0,50}(?:telephone )?notice|\bnotify\b.{0,40}(?:company|insurer|carrier)|telephone notice/i },
  { trigger: "Theft / disappearance notice", pattern: /theft.{0,80}(?:notice|report)|disappearance.{0,50}notice/i },
  { trigger: "Police / law-enforcement reporting", pattern: /\bpolice\b|law.?enforcement/i },
  { trigger: "No ransom", pattern: /\bransom\b/i },
  { trigger: "Proof of loss", pattern: /proof of loss/i },
  { trigger: "Examination under oath", pattern: /examinations?\s+under\s+oath/i },
  { trigger: "Record production", pattern: /(?:produce|submit|provide|preserve|furnish).{0,60}(?:records|documents|receipts|invoices|books)/i }
];

const DUTY_TRIGGER_BY_FAMILY: Record<string, string> = {
  professional_treatment: "Immediate Veterinary Care",
  necropsy: "Postmortem / Necropsy",
  notice: "Immediate Notice",
  theft_notice: "Theft / Disappearance Notice",
  police: "Police / Law-Enforcement Reporting",
  follow_law_enforcement: "Follow Law-Enforcement Recommendations",
  ransom: "No Ransom",
  proof_of_loss: "Proof of Loss",
  examination_under_oath: "Examination Under Oath",
  records: "Record Production",
  property_protection: "Protect Property",
  cooperation: "Claim Cooperation",
  inspection: "Inspection",
  remains_disposal: "Remains Disposal"
};

type DutyFamilyRule = { family: string; test: (text: string) => boolean };

function theftSpecificNotice(text: string): boolean {
  if (!/(?:theft|disappearance|unlawful removal)/.test(text)) return false;
  if (!/notice|notify/.test(text)) return false;
  const events = ["accident", "illness", "injury", "death"].filter((event) => new RegExp(`\\b${event}\\b`).test(text));
  return events.length < 2;
}

const DUTY_FAMILY_RULES: DutyFamilyRule[] = [
  {
    family: "professional_treatment",
    test: (t) =>
      /(?:employ|obtain|seek)\b.{0,60}\b(?:licensed\s+)?veterinar|veterinar(?:y)?\s+(?:care|treatment|surgeon)|qualified professional|professional (?:assistance|treatment)/.test(t)
  },
  {
    family: "necropsy",
    test: (t) =>
      /postmortem|post-mortem|\bnecropsy\b/.test(t) &&
      !/\bsend us\b/.test(t) &&
      !/death certificate/.test(t)
  },
  { family: "examination_under_oath", test: (t) => /examinations?\s+under\s+oath/.test(t) },
  { family: "proof_of_loss", test: (t) => /proof of loss/.test(t) || (/\bsend us\b/.test(t) && /death certificate/.test(t)) || (/this statement/.test(t) && /within .{0,24}days/.test(t) && /(?:death|theft|loss|humane destruction)/.test(t)) },
  {
    family: "inspection",
    test: (t) =>
      /allow us to inspect|inspect and examine the horse|inspect.{0,40}the (?:horse|animal|property)/.test(t) &&
      !/examinations?\s+under\s+oath/.test(t)
  },
  {
    family: "records",
    test: (t) =>
      !/allow us to inspect|inspect and examine the horse/.test(t) &&
      (/(?:produce|submit|provide|preserve|furnish|copy)\b.{0,60}\b(?:records|documents|receipts|invoices|books)\b/.test(t) ||
        /(?:records|documents|receipts|invoices|books)\b.{0,40}\b(?:produc|examin|copy)/.test(t))
  },
  { family: "ransom", test: (t) => /\bransom\b/.test(t) || /assurances? of .{0,60}intent to pay/.test(t) },
  { family: "follow_law_enforcement", test: (t) => /follow .{0,80}recommend/.test(t) },
  { family: "police", test: (t) => /(?:police|law.?enforcement)/.test(t) },
  {
    family: "theft_notice",
    test: (t) => theftSpecificNotice(t)
  },
  { family: "notice", test: (t) => /notify|notice/.test(t) && !/(?:police|law.?enforcement)/.test(t) && !theftSpecificNotice(t) },
  { family: "property_protection", test: (t) => /\bprotect\b.{0,40}\b(?:property|damage)\b/.test(t) },
  { family: "cooperation", test: (t) => /cooperat/.test(t) },
  {
    family: "remains_disposal",
    test: (t) => /disposal of .{0,80}remains|dispose of .{0,80}remains|responsible for the disposal/.test(t)
  }
];

export function allDutyFamilies(clause: string): string[] {
  const t = String(clause || "").toLowerCase();
  const found: string[] = [];
  for (const rule of DUTY_FAMILY_RULES) {
    if (rule.test(t) && !found.includes(rule.family)) found.push(rule.family);
  }
  return found;
}

export function dutyFamily(clause: string): string {
  return allDutyFamilies(clause)[0] || "claim_duty";
}

export function clauseSpanForFamily(clause: string, family: string): string {
  const full = String(clause || "").replace(/\s+/g, " ").trim();
  const units = [
    ...splitLetteredSubparagraphs(full),
    ...splitCoordinatedDuties(full),
    ...splitPolicyClauses(full)
  ];
  const hit = units.find((unit) => allDutyFamilies(unit).includes(family));
  return (hit || full).replace(/\s+/g, " ").trim();
}

export type DutySummaryContext = {
  missingDeclarations?: boolean;
  missingSchedule?: boolean;
};

export type ClaimDutyDescription = {
  family: string;
  trigger: string;
  summary: string;
  sourceSpan: string;
  declarationsItem?: string;
};

function sentence(text: string): string {
  const value = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[;:,]+$/g, "");
  if (!value) return "";
  const capped = value.charAt(0).toUpperCase() + value.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

function extractDeadline(text: string): string | undefined {
  const match = String(text || "").match(
    /\b(?:within|no later than)\s+((?:[a-z]+(?:-[a-z]+)?\s*\(\s*\d+\s*\)|\d+))\s*(days?|hours?)/i
  );
  if (!match) return undefined;
  const amount = match[1].match(/\d+/)?.[0];
  if (!amount) return undefined;
  return `within ${amount} ${match[2].toLowerCase()}`;
}

function extractRecipient(text: string): { label: string; external?: "declarations" | "schedule" } | undefined {
  const named = text.match(
    /\b((?:the\s+)?(?:person|firm|entity|contact|company|insurer)(?:\s+or\s+firm)?(?:\s+named|\s+shown|\s+listed|\s+identified)?(?:\s+in\s+item\s+[a-z0-9]+)?\s+of\s+(?:the\s+)?(?:missing\s+)?(?:declarations|schedule))\b/i
  );
  if (named) {
    const external = /schedule/i.test(named[1]) ? "schedule" : "declarations";
    return { label: named[1].replace(/\s+/g, " ").trim(), external };
  }
  if (/\bitem\s+[a-z0-9]+\s+of\s+(?:the\s+)?declarations\b/i.test(text)) {
    return { label: "the entity identified in the Declarations", external: "declarations" };
  }
  if (/\bcontact shown in the schedule\b/i.test(text) || /\bshown in the schedule\b/i.test(text)) {
    return { label: "the contact shown in the Schedule", external: "schedule" };
  }
  const company = text.match(/\bthe (?:company|insurer|carrier)\b/i);
  if (company) return { label: company[0] };
  return undefined;
}

function extractEventPhrase(text: string): string | undefined {
  if (/\beither\s+\(\s*[a-z]{1,3}\s*\)\s+or\s+\(\s*[a-z]{1,3}\s*\)/i.test(text)) {
    return "illness, injury, or death";
  }
  const match = text.match(
    /\b(?:in the event of(?:\s+(?:any|either))?|after|upon|following(?=\s+(?:the\s+)?(?:death|loss|theft|injury)))\s+(.+?)(?=\s+whatsoever|\s+(?:the\s+)?insured\s+(?:shall|must)|\s+immediately|\s+at the insured|\s+employ|\s+obtain|\s+arrange|\s+give|\s+notify|\s+report|\s+retain|\s+cooperate|\s+allow|\s+send|\s+have a |,?\s+the insured|$)/i
  );
  if (!match) return undefined;
  const phrase = match[1]
    .replace(/\bwhatsoever\b/gi, "")
    .replace(/[.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^any\s+/i, "")
    .replace(/^the following\b/i, "")
    .trim();
  if (!phrase || phrase.length < 3 || phrase.length > 160) return undefined;
  if (/^\(\s*[a-z]{1,3}\s*\)$/i.test(phrase)) return undefined;
  if (/^in the event of\b/i.test(phrase)) return undefined;
  return phrase;
}

function extractDeadlineScope(text: string): string | undefined {
  const match = String(text || "").match(/\bwithin\s+[^\s()]+\s*(?:\(\s*\d+\s*\)\s*)?(?:days?|hours?)\s+of\s+(.+)$/i);
  if (!match) return undefined;
  const phrase = match[1].replace(/[.,;:]+$/g, "").replace(/\s+/g, " ").trim();
  return phrase.length >= 3 && phrase.length <= 160 ? phrase : undefined;
}

function afterEvents(events: string | undefined): string {
  if (!events) return "";
  if (/^an?\s+/i.test(events) || /^(?:the|this|that)\s+/i.test(events)) return `After ${events}`;
  return `After ${events}`;
}

function missingExternalSentence(
  external: "declarations" | "schedule" | undefined,
  context?: DutySummaryContext
): string {
  if (external === "declarations" && context?.missingDeclarations) {
    return "That contact cannot be identified because the Declarations were not uploaded.";
  }
  if (external === "schedule" && context?.missingSchedule) {
    return "That contact cannot be identified because the Schedule was not uploaded.";
  }
  return "";
}

export function looksLikeRawClaimDutySummary(text: string, sourceText?: string): boolean {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return false;
  if (/\(\s*a\s*\).{8,}\(\s*b\s*\)/i.test(value)) return true;
  if (/\bthe insured shall\b/i.test(value) && value.length > 110) return true;
  if (/\bat all times provide proper care\b/i.test(value)) return true;
  if (/\bveterinar/i.test(value) && /\bnecropsy\b/i.test(value) && /telephone notice|item [a-z]/i.test(value)) {
    return true;
  }
  const source = String(sourceText || "").replace(/\s+/g, " ").trim();
  if (source && value.length > 140 && source.toLowerCase().includes(value.slice(0, 80).toLowerCase()) && value.length > source.length * 0.6) {
    return true;
  }
  return value.length > 280;
}

function dutyLabel(family: string, span: string): string {
  if (DUTY_TRIGGER_BY_FAMILY[family]) return DUTY_TRIGGER_BY_FAMILY[family];
  if (/inspect/i.test(span)) return "Inspection";
  return "Claim requirement";
}

function synthesizeClaimDuty(family: string, span: string, clause: string, context?: DutySummaryContext): string {
  const text = `${span} ${clause}`;
  const immediately =
    /\bimmediately\b/i.test(span) ||
    /\bimmediately\b/i.test(clause) ||
    /\bimmediate notice\b/i.test(span) ||
    /\bimmediate notice\b/i.test(clause);
  const uponRequest = /\bupon (?:written )?request\b/i.test(text);
  const deadline = extractDeadline(span) || extractDeadline(clause);
  const events =
    extractEventPhrase(span) ||
    extractDeadlineScope(span) ||
    (family === "notice" ? extractEventPhrase(clause) || extractDeadlineScope(clause) : undefined);
  const recipient = extractRecipient(span) || extractRecipient(clause);
  const expense = /at the insured'?s own expense|at the insured'?s expense/i.test(text);
  const licensedVet = /licensed veterinarian/i.test(text);
  const veterinarian = /veterinar/i.test(text);
  const qualifiedProfessional = /qualified professional assistance/i.test(text);
  const professionalAssistance = /professional assistance/i.test(text);
  const after = afterEvents(events);
  const timing = immediately ? "immediately " : "";

  if (family === "professional_treatment") {
    const helper = qualifiedProfessional
      ? "qualified professional assistance"
      : professionalAssistance
        ? "professional assistance"
        : licensedVet
          ? "care from a licensed veterinarian"
          : veterinarian
            ? "veterinary care"
            : "professional assistance";
    const lead = after || "After a covered illness, injury, or disability";
    const cost = expense ? " at the insured's expense" : "";
    if (qualifiedProfessional || professionalAssistance) {
      return sentence(`${lead}, ${timing}obtain ${helper}${cost}`);
    }
    return sentence(`${lead}, ${timing}obtain ${helper}${cost}`);
  }

  if (family === "necropsy") {
    const lead =
      after && !/,/.test(after) ? after : "After the death of an insured horse";
    const who = licensedVet || veterinarian ? " by a licensed veterinarian" : "";
    const cost = expense ? " at the insured's expense" : "";
    return sentence(`${lead}, ${timing}arrange a postmortem and necropsy examination${who}${cost}`);
  }

  if (family === "notice") {
    const method = /telephone/i.test(text) ? "give telephone notice" : "notify";
    const target =
      recipient?.external === "declarations"
        ? "the entity identified in the Declarations"
        : recipient?.external === "schedule"
          ? "the contact shown in the Schedule"
          : recipient?.label || "the Company";
    const to = method === "notify" ? ` ${target}` : ` to ${target}`;
    const ofWhat = events && !after ? ` of ${events}` : "";
    const lead = after ? `${after}, ` : "";
    const first = sentence(`${lead}${timing}${method}${to}${deadline ? ` ${deadline}` : ""}${ofWhat}`.replace(/\s+/g, " "));
    const missing = missingExternalSentence(recipient?.external, context);
    return missing ? `${first} ${missing}` : first;
  }

  if (family === "theft_notice") {
    const target =
      recipient?.external === "declarations"
        ? " to the entity identified in the Declarations"
        : recipient?.external === "schedule"
          ? " to the contact shown in the Schedule"
          : recipient?.label
            ? ` to ${recipient.label}`
            : " as required by the policy";
    const first = sentence(`${timing}report theft or disappearance${target}`.replace(/\s+/g, " "));
    const missing = missingExternalSentence(recipient?.external, context);
    return missing ? `${first} ${missing}` : first;
  }

  if (family === "police") {
    const policeDeadline = extractDeadline(span) || extractDeadline(clause);
    if (/law may have been broken/i.test(text)) {
      return sentence(`${timing}notify the appropriate law-enforcement agency if a law may have been broken`);
    }
    const agencies = /law.?enforcement/i.test(text)
      ? "police and other appropriate law-enforcement agencies"
      : "police";
    return sentence(
      `${timing}report theft or disappearance to ${agencies}${policeDeadline ? ` ${policeDeadline}` : ""}`.replace(/\s+/g, " ")
    );
  }

  if (family === "follow_law_enforcement") {
    return sentence("Follow the recommendations of the investigating law-enforcement agencies");
  }

  if (family === "ransom") {
    const extra = /similar assurance/i.test(text) ? ", or give similar assurances to a third party" : "";
    return sentence(`Do not pay or promise ransom${extra}`);
  }

  if (family === "proof_of_loss") {
    const detail = /\bdetailed\b/i.test(text) ? "detailed " : "";
    const sworn = /\bsworn\b/i.test(text) ? "sworn " : "";
    const when = deadline ? ` ${deadline}` : "";
    const afterLoss = /\bafter (?:an\s+)?(?:insured\s+)?loss\b/i.test(text) || /\bafter the loss\b/i.test(text);
    return sentence(`Submit a ${detail}${sworn}proof of loss${when}${afterLoss ? " after the loss" : ""}`.replace(/\s+/g, " "));
  }

  if (family === "examination_under_oath") {
    const requested = uponRequest
      ? recipient?.label
        ? ` when requested by ${recipient.label}`
        : " when requested"
      : "";
    const first = sentence(`Submit to examination under oath${requested}`);
    if (/agents?|employees?|representatives?/i.test(text)) {
      return `${first} Agents, employees, and representatives may also be required to submit.`;
    }
    return first;
  }

  if (family === "records") {
    if (/\bpreserve\b/i.test(span)) return sentence(`${timing}preserve all records`.trim());
    const copying = /\bcopy/i.test(text) ? " and copying" : "";
    const kinds = [];
    if (/\bbooks\b/i.test(text)) kinds.push("books");
    if (/\bdocuments?\b/i.test(text)) kinds.push("documents");
    if (/\brecords?\b/i.test(text)) kinds.push("records");
    if (/\breceipts?\b/i.test(text)) kinds.push("receipts");
    if (/\binvoices?\b/i.test(text)) kinds.push("invoices");
    const listed = kinds.length
      ? kinds.length === 1
        ? kinds[0]
        : kinds.length === 2
          ? `${kinds[0]} and ${kinds[1]}`
          : `${kinds.slice(0, -1).join(", ")}, and ${kinds[kinds.length - 1]}`
      : "records, documents, and receipts";
    if (uponRequest) return sentence(`Produce ${listed} for examination${copying} when requested`);
    return sentence(`${timing}produce ${listed} for examination${copying}`.trim());
  }

  if (family === "property_protection") {
    return sentence(`${timing}protect the property from further damage`.trim());
  }

  if (family === "cooperation") {
    return sentence("Cooperate with the Company as required after a loss");
  }

  if (family === "inspection") {
    return sentence("Allow the Company to inspect and examine the horse and any relevant records");
  }

  if (family === "remains_disposal") {
    const cost = expense ? " at the insured's expense" : "";
    return sentence(`Dispose of remains as required${cost} and with the Company's approval`.replace(/\s+/g, " "));
  }

  if (/inspect/i.test(span)) {
    return sentence(`${after || "After a total loss"}, ${timing}obtain an inspection`.replace(/\s+/g, " "));
  }

  let generic = stripClauseListPrefix(span)
    .replace(/^(?:the\s+)?insured\s+(?:shall|must)(?:\s+also)?\s+/i, "")
    .replace(/[;:]+$/g, "")
    .trim();
  if (looksLikeRawClaimDutySummary(generic, clause) || generic.length > 180) {
    const action = generic.match(
      /\b(?:immediately\s+)?(?:obtain|notify|report|submit|produce|preserve|protect|arrange|file|retain|contact|inspect|give notice)[\s\S]{0,100}/i
    );
    generic = (action?.[0] || generic).replace(/[,;:]+$/g, "").trim();
  }
  const lead = after ? `${after}, ` : immediately ? "Immediately " : "";
  if (lead && !/^(after|immediately)\b/i.test(generic)) {
    return sentence(`${lead}${generic}`.replace(/\s+/g, " "));
  }
  return sentence(generic);
}

export function describeClaimDuty(clause: string, family?: string, context?: DutySummaryContext): ClaimDutyDescription {
  const resolvedFamily = family || dutyFamily(clause);
  const sourceSpan = clauseSpanForFamily(clause, resolvedFamily);
  const trigger =
    dutyLabel(resolvedFamily, sourceSpan) ||
    CLAIM_DUTY_RULES.find((rule) => rule.pattern.test(sourceSpan))?.trigger ||
    resolvedFamily.replace(/_/g, " ");
  const item = `${sourceSpan} ${clause}`.match(/\bitem\s+([a-z0-9]+)\s+of\s+(?:the\s+)?declarations\b/i)?.[1];
  let summary = synthesizeClaimDuty(resolvedFamily, sourceSpan, clause, context);
  if (looksLikeRawClaimDutySummary(summary, clause)) {
    summary = sentence(trigger === "Claim requirement" ? "A claim requirement applies as stated in the source" : `Comply with the ${trigger.toLowerCase()} requirement`);
  }
  return {
    family: resolvedFamily,
    trigger,
    summary,
    sourceSpan,
    declarationsItem: item ? item.toUpperCase() : undefined
  };
}

export type CoverageExplanationFacts = {
  coverageType: string;
  status: AnalysisStatus;
  grantClause?: string;
  denialClause?: string;
  optionalMention?: boolean;
  applicabilityUnresolved?: boolean;
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
      ? `The policy excludes ${type} coverage, subject to a stated exception in the same provision.`
      : `The policy excludes ${type} coverage.`;
  }
  if (status === "POSSIBLE CONFLICT") {
    return `${type} is granted in one provision and excluded in another. The analyzer does not choose which provision controls.`;
  }
  if (status === "NEEDS CLARIFICATION") {
    if (facts.applicabilityUnresolved) {
      return `${type} coverage form is present, but the uploaded documents do not establish that this optional coverage is issued or in force.`;
    }
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
    const pages = exclusion.source_pages?.length ? exclusion.source_pages : [exclusion.source_page];
    for (const page of pages) {
      pushRef(
        out,
        seen,
        `Exclusion: ${exclusion.exclusion_type}`,
        page,
        exclusion.exact_source_excerpt,
        exclusion.source_document_id
      );
    }
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

function declarationsScheduleTextFromRecord(record: PolicyRecord): string {
  const chunks: string[] = [];
  for (const doc of record.documents) {
    for (const page of doc.pages || []) {
      const form = record.form_inventory.find((item) => {
        const documentId = item.match_document_id || item.listing_document_id;
        if (documentId !== doc.document_id) return false;
        if (typeof item.page_start !== "number") return false;
        return page.page >= item.page_start && page.page <= (item.page_end || item.page_start);
      });
      if (form && /declarations|schedule/i.test(String(form.form_role || ""))) {
        chunks.push(page.text || "");
        continue;
      }
      const head = String(page.text || "").slice(0, 600);
      if (isDeclarationsHeading(page.text || "") || /\bdeclarations page\b/i.test(head)) {
        chunks.push(page.text || "");
      }
    }
  }
  return chunks.join("\n");
}

function unresolvedOptionalTerritoryPage(record: PolicyRecord, documentId: string, page: number): boolean {
  const doc = record.documents.find((item) => item.document_id === documentId);
  if (!doc) return false;
  const pageRec = doc.pages.find((item) => item.page === page);
  const pageText = pageRec?.text || "";
  const form = record.form_inventory.find((item) => {
    const id = item.match_document_id || item.listing_document_id;
    if (id !== documentId || typeof item.page_start !== "number") return false;
    return page >= item.page_start && page <= (item.page_end || item.page_start);
  });
  const optional = form
    ? /endorsement|optional coverage/i.test(String(form.form_role || ""))
    : /\bthis endorsement\b/i.test(pageText);
  if (!optional) return false;
  let formText = pageText;
  if (form && typeof form.page_start === "number") {
    formText = doc.pages
      .filter((item) => item.page >= form.page_start! && item.page <= (form.page_end || form.page_start!))
      .map((item) => item.text || "")
      .join("\n");
  }
  if (!textHasIssuedApplicabilityGate(formText)) return false;
  const decls = declarationsScheduleTextFromRecord(record);
  if (
    hasIssuedCoverageSelection(
      decls,
      coverageSelectionTerms(["worldwide coverage", "worldwide", "territorial limits", "coverage territory"])
    )
  ) {
    return false;
  }
  return true;
}

function isTerritorialScopeLanguage(text: string): boolean {
  if (isOptionalCoverageMention(text)) return false;
  if (/\bterritorial limits?\b/i.test(text) && !/\bincluding transit\b/i.test(text)) return true;
  if (/\bcoverage territory\b/i.test(text) && /\b(?:worldwide|anywhere in the world)\b/i.test(text)) return true;
  if (/\bthis policy applies worldwide\b/i.test(text)) return true;
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
    case "inspection":
      return "inspection";
    case "remains_disposal":
      return "remains";
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
  if (group === "inspection") return "Inspection Requirements";
  if (group === "remains") return "Remains Disposal";
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
    const families = allDutyFamilies(blob);
    const list = families.length ? families : [dutyFamily(blob)];
    for (const family of list) {
      addDutyEvidence(
        requirement.source_document_id,
        requirement.source_page,
        requirement.source_text || requirement.requirement,
        family,
        requirement.trigger || family
      );
    }
  }
  for (const clause of walked) {
    if (clause.kind !== "duty" || !clause.document_id) continue;
    const families = allDutyFamilies(clause.clause);
    const list = families.length ? families : [dutyFamily(clause.clause)];
    for (const family of list) {
      addDutyEvidence(clause.document_id, clause.page, clause.clause, family, family);
    }
  }

  for (const clause of walked) {
    if (!clause.document_id || clause.kind === "exclusion" || clause.kind === "grant") continue;
    if (
      isTerritorialScopeLanguage(clause.clause) &&
      !unresolvedOptionalTerritoryPage(record, clause.document_id, clause.page)
    ) {
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
      const pages = exclusion.source_pages?.length ? exclusion.source_pages : [exclusion.source_page];
      const walkedHit = walked.find(
        (item) =>
          item.document_id === documentId &&
          item.page === exclusion.source_page &&
          (item.kind === "exclusion" || item.section === "exclusions")
      );
      for (const page of pages) {
        pushEvidence(bucket, {
          document_id: documentId,
          page,
          finding_type: "exclusion",
          finding_key: exclusion.exclusion_type,
          source_text: exclusion.exact_source_excerpt,
          section: walkedHit?.section || "exclusions"
        });
      }
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
