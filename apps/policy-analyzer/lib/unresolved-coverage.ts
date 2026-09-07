import { inspectDocumentPackageState } from "./document-terminology";
import { isIndependentFormEvidence, lineHasFormId, normalizeFormId } from "./form-schedule";
import type {
  CompletenessResult,
  ConflictRecord,
  CoverageRecord,
  DocumentRecord,
  PolicyFormRecord,
  PolicyIdentification,
  PolicyRecord
} from "./types";

export const UNRESOLVED_COVERAGE_SECTION_TITLE = "Unresolved Coverage Items";

export const UNRESOLVED_COVERAGE_CATEGORIES = [
  "Missing Package Information",
  "Needs Clarification",
  "Not Established",
  "Documented Limitation",
  "Documented Gap"
] as const;

export type UnresolvedCoverageCategory = (typeof UNRESOLVED_COVERAGE_CATEGORIES)[number];

export type UnresolvedCoverageItem = {
  category: UnresolvedCoverageCategory;
  explanation: string;
};

type UnresolvedInput = {
  completeness: CompletenessResult;
  documents: DocumentRecord[];
  coverages: CoverageRecord[];
  conflicts: ConflictRecord[];
  form_inventory: PolicyFormRecord[];
  identification: PolicyIdentification;
};

const CLARIFICATION_GROUP = ["Major Medical", "Surgical"] as const;

function packageText(documents: DocumentRecord[]): string {
  return documents
    .flatMap((doc) => doc.pages.map((page) => page.text || ""))
    .join("\n");
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function coverageNamePattern(type: string): string {
  if (type === "Full Mortality") return "full mortality|mortality coverage";
  if (type === "Surgical") return "surgical coverage|equine (?:zero deductible )?surgical";
  return escapeRe(type);
}

function mentionsCoverage(text: string, type: string): boolean {
  return new RegExp(`\\b(?:${coverageNamePattern(type)})\\b`, "i").test(text);
}

function coverageWasRequested(text: string, type: string): boolean {
  const name = coverageNamePattern(type);
  return (
    new RegExp(`(?:${name}).{0,60}(?:requested|intended|applied for|to be included)`, "i").test(text) ||
    new RegExp(`(?:requested|intended|applied for|application (?:requests|includes)).{0,60}(?:${name})`, "i").test(
      text
    )
  );
}

function coverageAffirmativelyOmitted(text: string, type: string): boolean {
  const name = coverageNamePattern(type);
  return (
    new RegExp(`(?:${name}).{0,40}(?:not included|not purchased|not in force|declined)`, "i").test(text) ||
    new RegExp(`(?:does not provide|do not provide|is not provided)\\s+(?:${name})`, "i").test(text) ||
    new RegExp(`no\\s+(?:${name})\\b`, "i").test(text)
  );
}

function hasExpectationEvidence(text: string, type: string, status: string): boolean {
  if (status === "NEEDS CLARIFICATION" || status === "POSSIBLE CONFLICT" || status === "DOCUMENT MISSING") {
    return true;
  }
  if (!mentionsCoverage(text, type)) return false;
  if (coverageWasRequested(text, type)) return true;
  if (/\badditional coverages such as\b/i.test(text) && mentionsCoverage(text, type)) return true;
  if (
    new RegExp(`(?:${coverageNamePattern(type)}).{0,80}(?:schedule|endorsement|declarations)`, "i").test(text) ||
    new RegExp(`(?:schedule|endorsement|declarations).{0,80}(?:${coverageNamePattern(type)})`, "i").test(text)
  ) {
    return true;
  }
  return false;
}

function referencedCoverageForms(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const pattern =
    /\b(?:coverage is provided by|as provided (?:in|by)|provided by|subject to)\s+(?:endorsement|form)\s+([A-Z]{2,8}(?:[ -][A-Z0-9]{1,8}){0,4})/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const printed = match[1].replace(/\s+/g, " ").trim();
    if (/^(?:the )?(?:declarations|schedule)$/i.test(printed)) continue;
    const normalized = normalizeFormId(printed);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    found.push(printed);
  }
  return found;
}

function isCoverageFormReferenceLine(line: string): boolean {
  return /\b(?:coverage is provided by|as provided (?:in|by)|provided by|subject to)\s+(?:endorsement|form)\b/i.test(
    line
  );
}

function formAppearsUploaded(
  documents: DocumentRecord[],
  formInventory: PolicyFormRecord[],
  printed: string
): boolean {
  const want = normalizeFormId(printed);
  if (formInventory.some((form) => normalizeFormId(form.printed_identifier) === want && form.status === "PRESENT")) {
    return true;
  }
  for (const doc of documents) {
    for (const page of doc.pages) {
      const pageText = page.text || "";
      for (const line of pageText.split(/\n+/)) {
        const compact = line.replace(/\s+/g, " ").trim();
        if (!compact || !lineHasFormId(compact, printed)) continue;
        if (isCoverageFormReferenceLine(compact)) continue;
        if (isIndependentFormEvidence(compact, printed, pageText)) return true;
        if (/endorsement/i.test(compact) && !isCoverageFormReferenceLine(compact)) return true;
      }
    }
  }
  return false;
}

function alreadyCovers(items: UnresolvedCoverageItem[], needle: RegExp): boolean {
  return items.some((item) => needle.test(`${item.category} ${item.explanation}`));
}

function clarificationCoverages(coverages: CoverageRecord[]): CoverageRecord[] {
  return coverages.filter((coverage) => coverage.coverage_status === "NEEDS CLARIFICATION");
}

function joinCoverageNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function formatUnresolvedCoverageItem(item: UnresolvedCoverageItem): string {
  return `${item.category} — ${item.explanation}`;
}

export function parseUnresolvedCoverageItem(text: string): UnresolvedCoverageItem {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  for (const category of UNRESOLVED_COVERAGE_CATEGORIES) {
    const prefix = `${category} — `;
    if (value.startsWith(prefix)) {
      return { category, explanation: value.slice(prefix.length).trim() };
    }
  }
  return { category: "Needs Clarification", explanation: value };
}

export function buildUnresolvedCoverageItems(input: UnresolvedInput): UnresolvedCoverageItem[] {
  const items: UnresolvedCoverageItem[] = [];
  const state = inspectDocumentPackageState({
    documents: input.documents,
    form_inventory: input.form_inventory,
    completeness: input.completeness
  });
  const blob = packageText(input.documents);
  const policyFormId = input.identification.policy_form?.value
    ? normalizeFormId(input.identification.policy_form.value)
    : "";

  if (input.completeness.status === "COMPLETE CONTRACTUAL SPECIMEN FORM SET") {
    items.push({
      category: "Not Established",
      explanation:
        "Issued policy facts are not established from this contractual specimen form set. Policy number, named insured, policy period, insured horse, scheduled value, and selected optional coverages are blank."
    });
  } else if (!state.declarationsPresent || state.declarationsMissingWarning) {
    items.push({
      category: "Missing Package Information",
      explanation:
        "The uploaded package does not include the Declarations/Schedule, so policy-specific limits, deductibles, insured horse information, and issued endorsements cannot be fully verified."
    });
  }

  const missingListed = input.form_inventory
    .filter((form) => form.status === "MISSING")
    .map((form) => form.printed_identifier);
  const missingReferenced = referencedCoverageForms(blob).filter((printed) => {
    if (policyFormId && normalizeFormId(printed) === policyFormId) return false;
    return !formAppearsUploaded(input.documents, input.form_inventory, printed);
  });
  const missingForms = [...new Set([...missingListed, ...missingReferenced])];
  if (missingForms.length && state.declarationsPresent && !state.declarationsMissingWarning) {
    items.push({
      category: "Needs Clarification",
      explanation: `The uploaded Declarations list ${joinCoverageNames(missingForms)} without matching uploaded form text, so whether those forms are in force is not established.`
    });
  } else if (missingReferenced.length && (!state.declarationsPresent || state.declarationsMissingWarning)) {
    items.push({
      category: "Needs Clarification",
      explanation: `The policy refers to ${joinCoverageNames(missingReferenced)} as providing coverage, but ${
        missingReferenced.length === 1 ? "that form was" : "those forms were"
      } not found in the uploaded package. Whether the coverage is in force is not established.`
    });
  }

  const unresolved = clarificationCoverages(input.coverages);
  const grouped = unresolved.filter((coverage) =>
    (CLARIFICATION_GROUP as readonly string[]).includes(coverage.coverage_type)
  );
  const remainder = unresolved.filter(
    (coverage) => !(CLARIFICATION_GROUP as readonly string[]).includes(coverage.coverage_type)
  );
  if (grouped.length === CLARIFICATION_GROUP.length) {
    items.push({
      category: "Needs Clarification",
      explanation:
        "Major Medical and Surgical are mentioned as possible additional coverage, but they are not established as in force in the uploaded documents."
    });
  } else {
    remainder.push(...grouped);
  }
  for (const coverage of remainder) {
    items.push({
      category: "Needs Clarification",
      explanation: `${coverage.coverage_type} is mentioned as possible additional coverage, but it is not established as in force in the uploaded documents.`
    });
  }

  for (const coverage of input.coverages) {
    if (coverage.coverage_status !== "POSSIBLE CONFLICT") continue;
    if (alreadyCovers(items, new RegExp(escapeRe(coverage.coverage_type), "i"))) continue;
    items.push({
      category: "Documented Gap",
      explanation: `${coverage.coverage_type} is granted in one uploaded provision and excluded in another, so the in-force coverage is not established.`
    });
  }

  for (const coverage of input.coverages) {
    const requested = coverageWasRequested(blob, coverage.coverage_type);
    const omitted =
      coverage.coverage_status === "EXCLUDED" || coverageAffirmativelyOmitted(blob, coverage.coverage_type);
    if (!requested || !omitted) continue;
    if (alreadyCovers(items, new RegExp(escapeRe(coverage.coverage_type), "i"))) continue;
    items.push({
      category: "Documented Gap",
      explanation: `${coverage.coverage_type} appears to have been requested in one uploaded document and not included in another. The in-force coverage is not established.`
    });
  }

  for (const coverage of input.coverages) {
    if (coverage.coverage_status !== "NOT FOUND") continue;
    if (!hasExpectationEvidence(blob, coverage.coverage_type, coverage.coverage_status)) continue;
    if (alreadyCovers(items, new RegExp(escapeRe(coverage.coverage_type), "i"))) continue;
    items.push({
      category: "Not Established",
      explanation: `${coverage.coverage_type} is referenced in the uploaded documents, but it is not established as in force.`
    });
  }

  for (const conflict of input.conflicts) {
    const text = `${conflict.title} ${conflict.description}`;
    if (/named exclusions/i.test(text)) continue;
    if (/limits differ/i.test(text)) {
      const named = conflict.description.match(/^([^.]+?) limits differ/i)?.[1]?.trim() || "Coverage";
      if (alreadyCovers(items, new RegExp(`${escapeRe(named)} limits differ`, "i"))) continue;
      items.push({
        category: "Needs Clarification",
        explanation: `${named} limits differ across uploaded documents, so the in-force limit is not established.`
      });
      continue;
    }
    if (/granted in one provision and excluded/i.test(text)) {
      const named = conflict.description.match(/^([^.]+?) is granted/i)?.[1]?.trim();
      if (named && alreadyCovers(items, new RegExp(escapeRe(named), "i"))) continue;
      items.push({
        category: "Documented Gap",
        explanation: named
          ? `${named} is granted in one uploaded provision and excluded in another, so the in-force coverage is not established.`
          : "Uploaded provisions grant and exclude the same coverage, so the in-force coverage is not established."
      });
    }
  }

  return items.filter((item) => {
    const blobText = `${item.category} ${item.explanation}`;
    return !/you should add|consider purchasing|ask your agent to increase|missing coverage|coverage gap because/i.test(
      blobText
    );
  });
}

export function buildUnresolvedCoverageGapStrings(input: UnresolvedInput): string[] {
  return buildUnresolvedCoverageItems(input).map(formatUnresolvedCoverageItem);
}

export function unresolvedCoverageItemsFromReport(
  record: Pick<PolicyRecord, "coverage_gaps">
): UnresolvedCoverageItem[] {
  return (record.coverage_gaps || []).map(parseUnresolvedCoverageItem);
}
