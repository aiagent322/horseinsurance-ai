import type {
  CompletenessResult,
  ConflictRecord,
  CoverageRecord,
  PolicyFormRecord,
  PolicyIdentification,
  RequirementRecord
} from "./types";

export type AgentQuestionDraft = {
  question: string;
  reason: string;
  key: string;
  priority: number;
};

export type AgentQuestionInput = {
  completeness: CompletenessResult;
  declarationsPresent: boolean;
  identification: PolicyIdentification;
  coverages: Array<Pick<CoverageRecord, "coverage_type" | "coverage_status">>;
  requirements: Array<Pick<RequirementRecord, "trigger" | "requirement" | "source_text">>;
  conflicts: ConflictRecord[];
  formInventory: Array<Pick<PolicyFormRecord, "printed_identifier" | "status">>;
};

const MAX_QUESTIONS = 6;

function joinList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function looksLikeAmount(value: string): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 0 && text.length <= 40 && /\$?\d/.test(text);
}

export function looksLikeQuotedPolicyLanguage(question: string): boolean {
  const text = String(question || "").replace(/\s+/g, " ").trim();
  if (text.length > 400) return true;
  if (/this insurance does not cover|the insured shall|will indemnify/i.test(text)) return true;
  if (/please confirm the (?:exclusion|coverage|duty|limitation) language/i.test(text)) return true;
  const quoted = text.match(/[“"']([^”"']{80,})[”"']/);
  return Boolean(quoted);
}

function missingIdentificationLabels(identification: PolicyIdentification): string[] {
  const missing: string[] = [];
  if (!identification.policy_number) missing.push("policy number");
  if (!identification.policy_effective_date || !identification.policy_expiration_date) missing.push("policy period");
  if (!identification.insured_horse_name) missing.push("insured horse");
  if (!identification.insured_value) missing.push("liability limit");
  if (!identification.deductible) missing.push("deductible");
  return missing;
}

function missingListedFormIds(formInventory: AgentQuestionInput["formInventory"]): string[] {
  return formInventory
    .filter((form) => form.status === "MISSING" || form.status === "EDITION MISMATCH")
    .map((form) => form.printed_identifier)
    .filter(Boolean);
}

function unresolvedOptionalCoverages(coverages: AgentQuestionInput["coverages"]): string[] {
  return coverages
    .filter((coverage) => coverage.coverage_status === "NEEDS CLARIFICATION")
    .map((coverage) => coverage.coverage_type);
}

function noticeContactFromRequirements(
  requirements: AgentQuestionInput["requirements"],
  declarationsPresent: boolean
): { item?: string } | null {
  if (declarationsPresent) return null;
  for (const row of requirements) {
    const blob = `${row.trigger} ${row.requirement} ${row.source_text}`;
    if (!/notice|notify|telephone/i.test(blob)) continue;
    const item = blob.match(/\bitem\s+([a-z0-9]+)\s+of\s+(?:the\s+)?(?:missing\s+)?declarations\b/i)?.[1];
    const pointsToDeclarations =
      Boolean(item) ||
      /entity (?:listed|identified|named) in .{0,40}declarations/i.test(blob) ||
      /person or firm named in item/i.test(blob) ||
      /as stated in item .{0,12}declarations/i.test(blob) ||
      /missing declarations/i.test(blob);
    if (!pointsToDeclarations) continue;
    return item ? { item: item.toUpperCase() } : {};
  }
  return null;
}

function conflictQuestion(conflict: ConflictRecord): string {
  const left = String(conflict.left?.value || "").replace(/\s+/g, " ").trim();
  const right = String(conflict.right?.value || "").replace(/\s+/g, " ").trim();
  if (looksLikeAmount(left) && looksLikeAmount(right)) {
    const label = String(conflict.left?.label || "values")
      .replace(/\s+limit$/i, " limits")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return `Two uploaded documents show different ${label} (${left} and ${right}). Which applies?`;
  }
  const named = conflict.description.match(/^([^.]+?) (?:is granted|limits differ)/i)?.[1]?.trim();
  if (named) {
    return `${named} is stated differently in two uploaded provisions. Which provision controls?`;
  }
  return "Two uploaded documents contain conflicting policy values. Which applies?";
}

function pushDraft(out: AgentQuestionDraft[], draft: AgentQuestionDraft): void {
  if (!draft.question.trim()) return;
  if (looksLikeQuotedPolicyLanguage(draft.question)) return;
  if (out.some((item) => item.key === draft.key || item.question === draft.question)) return;
  out.push(draft);
}

export function buildAgentQuestionDrafts(input: AgentQuestionInput): AgentQuestionDraft[] {
  const drafts: AgentQuestionDraft[] = [];
  const incomplete = input.completeness.status === "DOCUMENT PACKAGE MAY BE INCOMPLETE";
  const missingForms = missingListedFormIds(input.formInventory);
  const missingValues = missingIdentificationLabels(input.identification);
  const optional = unresolvedOptionalCoverages(input.coverages);
  const notice = noticeContactFromRequirements(input.requirements, input.declarationsPresent);

  if (incomplete && !input.declarationsPresent) {
    pushDraft(drafts, {
      key: "missing_package",
      priority: 10,
      reason: "The uploaded package has no Declarations/Schedule page, so issued-policy completeness is unresolved.",
      question:
        "Is this the complete issued policy package? Please provide the Declarations, Schedule, and any endorsements that are part of the policy."
    });
  } else if (incomplete && input.declarationsPresent && missingForms.length) {
    pushDraft(drafts, {
      key: "missing_listed_forms",
      priority: 10,
      reason: "The Declarations list forms that were not matched in the upload.",
      question: `The Declarations list ${joinList(missingForms)} without matching uploaded form text. Are those forms in force and missing from this upload?`
    });
  } else if (incomplete && input.declarationsPresent) {
    pushDraft(drafts, {
      key: "missing_package",
      priority: 10,
      reason: "The package is incomplete even though a Declarations page is present.",
      question:
        "Are there any Schedules or endorsements that form part of the issued policy but are missing from this upload?"
    });
  }

  if (missingValues.length) {
    const where = input.declarationsPresent ? "the Declarations/Schedule" : "the missing Declarations/Schedule";
    const verb = missingValues.length === 1 ? "is" : "are";
    pushDraft(drafts, {
      key: "missing_values",
      priority: 20,
      reason: "Policy-specific values were not found in the uploaded documents.",
      question: `What ${joinList(missingValues)} ${verb} shown on ${where}?`
    });
  }

  if (notice) {
    const itemLabel = notice.item ? `Item ${notice.item} of the Declarations` : "the Declarations";
    pushDraft(drafts, {
      key: "missing_notice_contact",
      priority: 30,
      reason: "A claim-notice duty points to a contact stored in missing Declarations.",
      question: `The policy requires immediate telephone notice to the entity identified in ${itemLabel}. What contact is listed on the missing Declarations?`
    });
  }

  if (optional.length) {
    pushDraft(drafts, {
      key: "optional_coverage",
      priority: 40,
      reason: "Optional coverage is mentioned but not established as in force.",
      question: `Do the Schedule or endorsements establish ${joinList(optional)} coverage for this policy?`
    });
  }

  input.conflicts.forEach((conflict, index) => {
    pushDraft(drafts, {
      key: `conflict:${conflict.id || index}`,
      priority: 50,
      reason: conflict.description,
      question: conflictQuestion(conflict)
    });
  });

  const conflicts = drafts.filter((item) => item.key.startsWith("conflict:"));
  const others = drafts.filter((item) => !item.key.startsWith("conflict:")).sort((a, b) => a.priority - b.priority);
  const room = Math.max(1, MAX_QUESTIONS - Math.min(conflicts.length, 2));
  return [...others.slice(0, room), ...conflicts.slice(0, 2)].sort((a, b) => a.priority - b.priority);
}

export function buildAgentQuestions(input: AgentQuestionInput): string[] {
  return buildAgentQuestionDrafts(input).map((item) => item.question);
}
