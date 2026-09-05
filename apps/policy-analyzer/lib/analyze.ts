import { classifyPage } from "./classify";
import {
  collectFormsScheduleText,
  extractEdition,
  isFormsScheduleHeading,
  isIndependentFormEvidence,
  lineHasFormId,
  normalizeEdition,
  normalizeFormId,
  parseListedForms
} from "./form-schedule";
import { hydratePageDiagnostics, isReliablePolicyPage } from "./extraction-quality";
import type {
  AnalysisStatus,
  CompletenessResult,
  ConflictRecord,
  CoverageRecord,
  DocumentRecord,
  EndorsementEffect,
  ExclusionRecord,
  FinancialLimit,
  PageText,
  PolicyFormRecord,
  PolicyIdentification,
  PolicyRecord,
  RequirementRecord,
  Sourced
} from "./types";
import { newId } from "./store";

type Hit = {
  page: number;
  text: string;
  line: string;
  document_id: string;
  document_index: number;
};

function pagesOf(docs: DocumentRecord[]): Hit[] {
  const collected: Hit[] = [];
  docs.forEach((doc, document_index) => {
    for (const raw of doc.pages) {
      const p: PageText = hydratePageDiagnostics(raw);
      if (!isReliablePolicyPage(p)) continue;
      for (const line of p.text.split(/\n+/)) {
        const t = line.replace(/\s+/g, " ").trim();
        if (t) collected.push({ page: p.page, text: p.text, line: t, document_id: doc.document_id, document_index });
      }
    }
  });
  return collected;
}

function firstMatch(
  hits: Hit[],
  re: RegExp
): Sourced<string> | undefined {
  for (const h of hits) {
    const m = h.line.match(re) || h.text.match(re);
    if (m && m[1]) {
      const value = m[1].replace(/\s+/g, " ").trim();
      if (!value) continue;
      return {
        value,
        source_document_id: h.document_id,
        source_page: h.page,
        source_text: excerpt(h.text, value),
        confidence_status: "HIGH"
      };
    }
  }
  return undefined;
}

function excerpt(pageText: string, needle: string, pad = 90): string {
  const idx = pageText.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return pageText.slice(0, 180).trim();
  const start = Math.max(0, idx - pad);
  const end = Math.min(pageText.length, idx + needle.length + pad);
  return pageText.slice(start, end).replace(/\s+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labeled(
  hits: Hit[],
  labels: string[]
): Sourced<string> | undefined {
  for (const h of hits) {
    for (const label of labels) {
      const textRe = new RegExp(`${escapeRe(label)}\\s*[:–—]\\s*([^\\n]+)`, "i");
      const moneyRe = new RegExp(
        `${escapeRe(label)}\\s*[:–—]?\\s*(\\$[\\d,]+(?:\\.\\d{2})?)`,
        "i"
      );
      const money = h.line.match(moneyRe) || h.text.match(moneyRe);
      const text = h.line.match(textRe) || h.text.match(textRe);
      let value = "";
      if (money?.[1]) value = money[1];
      else if (text?.[1]) {
        value = text[1].replace(/\s+/g, " ").trim();
        const inline = value.match(/\$[\d,]+(?:\.\d{2})?/);
        if (inline) value = inline[0];
      }
      if (!value) continue;
      return {
        value,
        source_document_id: h.document_id,
        source_page: h.page,
        source_text: excerpt(h.text, value),
        confidence_status: "HIGH"
      };
    }
  }
  return undefined;
}

function moneyHits(
  hits: Hit[],
  context: RegExp,
  label: string
): FinancialLimit[] {
  const found: FinancialLimit[] = [];
  for (const h of hits) {
    if (!context.test(h.line)) continue;
    const amounts = h.line.match(/\$[\d,]+(?:\.\d{2})?/g);
    if (!amounts) continue;
    found.push({
      id: newId(),
      label,
      amount: amounts[0],
      source_document_id: h.document_id,
      source_page: h.page,
      source_text: excerpt(h.text, amounts[0])
    });
  }
  return found;
}

function uniquePages(hits: Hit[]): Hit[] {
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const h of hits) {
    const key = `${h.document_index}:${h.document_id}:${h.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

function hasPhrase(text: string, phrases: string[]): boolean {
  const t = text.toLowerCase();
  return phrases.some((p) => t.includes(p.toLowerCase()));
}

const ABBREVIATION_END =
  /\b(?:Ed|Inc|Ltd|No|Mr|Mrs|Ms|Dr|Rev|vs|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.$/i;

function splitClauses(text: string): string[] {
  const flattened = text.replace(/-\s*\n\s*/g, "").replace(/\n+/g, " ");
  const parts = flattened
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
  const out: string[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (prev && ABBREVIATION_END.test(prev)) {
      out[out.length - 1] = `${prev} ${part}`;
    } else {
      out.push(part);
    }
  }
  return out;
}

function coverageMentioned(clause: string, names: string[]): boolean {
  const lower = clause.toLowerCase();
  return names.some((n) => lower.includes(n.toLowerCase()));
}

function clauseIsDenial(clause: string, names: string[]): boolean {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const n = escapeRe(name);
    const patterns = [
      new RegExp(`\\bno\\s+${n}\\b`, "i"),
      new RegExp(`${n}\\s+is not provided`, "i"),
      new RegExp(`does not provide\\s+${n}`, "i"),
      new RegExp(`${n}\\s+is excluded`, "i"),
      new RegExp(`excludes\\s+${n}`, "i"),
      new RegExp(`${n}\\s+does not apply`, "i"),
      new RegExp(`not insured for\\s+${n}`, "i"),
      new RegExp(`no\\s+${n}\\s+(?:coverage\\s+)?applies`, "i")
    ];
    if (patterns.some((re) => re.test(clause))) return true;
  }
  if (
    coverageMentioned(clause, names) &&
    /excludes coverage/i.test(clause) &&
    !/excludes coverage for the /i.test(clause)
  ) {
    return true;
  }
  return false;
}

function clauseIsAffirmative(clause: string, names: string[]): boolean {
  if (!coverageMentioned(clause, names)) return false;
  if (clauseIsDenial(clause, names)) return false;
  return (
    /\bprovides\b/i.test(clause) ||
    /\bis provided\b/i.test(clause) ||
    /\bis added\b/i.test(clause) ||
    /\bis covered\b/i.test(clause) ||
    /coverage with a limit/i.test(clause) ||
    /limit of\s*\$/i.test(clause) ||
    /amended to\s*\$/i.test(clause)
  );
}

type CoverageEvidence = {
  status: AnalysisStatus;
  document_id: string;
  document_index: number;
  page: number;
  clause: string;
  pageText: string;
  contradiction?: { grant: CoverageEvidence; denial: CoverageEvidence };
};

function pageIsEndorsement(text: string): boolean {
  return /\bthis endorsement\b/i.test(text) || /(?:^|\n)\s*endorsement\b/i.test(text);
}

function laterEvidence(a: CoverageEvidence, b: CoverageEvidence): boolean {
  if (a.document_index !== b.document_index) return a.document_index > b.document_index;
  return a.page > b.page;
}

function classifyCoverageEvidence(hits: Hit[], names: string[]): CoverageEvidence | null {
  const seen = new Set<string>();
  const units: CoverageEvidence[] = [];
  for (const h of uniquePages(hits)) {
    for (const clause of splitClauses(h.text)) {
      if (!coverageMentioned(clause, names)) continue;
      const key = `${h.document_index}:${h.document_id}:${h.page}:${clause.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      units.push({
        status: "NEEDS CLARIFICATION",
        document_id: h.document_id,
        document_index: h.document_index,
        page: h.page,
        clause,
        pageText: h.text
      });
    }
  }

  let denial: CoverageEvidence | undefined;
  let affirmation: CoverageEvidence | undefined;
  let mention: CoverageEvidence | undefined;
  for (const u of units) {
    mention = mention || u;
    if (clauseIsDenial(u.clause, names)) {
      denial = denial || { ...u, status: "EXCLUDED" };
      continue;
    }
    if (clauseIsAffirmative(u.clause, names)) {
      affirmation = affirmation || { ...u, status: "COVERED" };
    }
  }

  if (denial && affirmation) {
    const endorsementControls = pageIsEndorsement(denial.pageText) && laterEvidence(denial, affirmation);
    return {
      ...(endorsementControls ? denial : denial),
      status: endorsementControls ? "EXCLUDED" : "POSSIBLE CONFLICT",
      contradiction: { grant: affirmation, denial }
    };
  }
  if (denial) return denial;
  if (affirmation) return affirmation;
  if (mention) return mention;
  return null;
}

function uniqueLimitAmounts(items: FinancialLimit[]): FinancialLimit[] {
  const seen = new Set<string>();
  const out: FinancialLimit[] = [];
  for (const item of items) {
    const key = item.amount.replace(/[^\d.]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sourcedFromLimit(limit: FinancialLimit): Sourced<string> {
  return {
    value: limit.amount,
    source_document_id: limit.source_document_id,
    source_page: limit.source_page,
    source_text: limit.source_text,
    confidence_status: "HIGH"
  };
}

function controllingLimit(
  limits: FinancialLimit[],
  hits: Hit[],
  isController: (text: string) => boolean
): FinancialLimit | undefined {
  const ranked = limits
    .map((limit) => {
      const hit = hits.find((h) => h.document_id === limit.source_document_id && h.page === limit.source_page);
      return { limit, hit };
    })
    .filter((row) => row.hit && isController(row.hit.text));
  if (!ranked.length) return undefined;
  ranked.sort((a, b) => {
    const byDoc = (a.hit?.document_index || 0) - (b.hit?.document_index || 0);
    if (byDoc !== 0) return byDoc;
    return a.limit.source_page - b.limit.source_page;
  });
  return ranked[ranked.length - 1].limit;
}

function pageControlsMedical(text: string): boolean {
  return (
    /supersedes the medical limit/i.test(text) ||
    /medical limit is amended/i.test(text) ||
    /modifies and replaces the major medical limit/i.test(text) ||
    (/\bthis endorsement supersedes\b/i.test(text) && /medical/i.test(text))
  );
}

function pageControlsMortality(text: string): boolean {
  return /supersedes the (?:mortality |insured value)?limit/i.test(text) || /mortality .{0,24}is amended/i.test(text);
}

function pageControlsSurgical(text: string): boolean {
  return /supersedes the surgical limit/i.test(text) || /surgical limit is amended/i.test(text);
}

function limitConflictRecord(coverageName: string, left: FinancialLimit, right: FinancialLimit): ConflictRecord {
  return {
    id: newId(),
    title: "Potential Policy Conflict",
    description: `${coverageName} limits differ across uploaded pages. The analyzer does not choose which amount applies.`,
    left: {
      label: left.label,
      value: left.amount,
      source_page: left.source_page,
      source_text: left.source_text
    },
    right: {
      label: right.label,
      value: right.amount,
      source_page: right.source_page,
      source_text: right.source_text
    }
  };
}

function coverageContradictionRecord(
  coverageName: string,
  grant: CoverageEvidence,
  denial: CoverageEvidence
): ConflictRecord {
  return {
    id: newId(),
    title: "Potential Policy Conflict",
    description: `${coverageName} is granted in one provision and excluded in another.`,
    left: {
      label: `${coverageName} grant`,
      value: grant.clause,
      source_page: grant.page,
      source_text: excerpt(grant.pageText, grant.clause)
    },
    right: {
      label: `${coverageName} denial`,
      value: denial.clause,
      source_page: denial.page,
      source_text: excerpt(denial.pageText, denial.clause)
    }
  };
}

export function analyzeDocuments(policyId: string, sessionId: string, documents: DocumentRecord[]): PolicyRecord {
  const now = new Date().toISOString();
  const hits = pagesOf(documents);
  const allText = uniquePages(hits)
    .map((h) => h.text)
    .join("\n\n");

  const identification: PolicyIdentification = {
    carrier_name:
      firstMatch(hits, /(?:issued by|underwritten by)\s+([^\n]+)/i) ||
      firstMatch(hits, /^([A-Z][A-Z0-9 &.'-]{8,}INSURANCE[A-Z0-9 &.'-]*)$/) ||
      firstMatch(hits, /((?:[A-Z][A-Za-z]+ ){1,6}(?:Equine )?(?:Specialty )?Insurance Company)/),
    agency_name: labeled(hits, ["Agency"]),
    agent_name: labeled(hits, ["Agent"]),
    policy_number: labeled(hits, ["Policy Number", "Policy No", "Policy #"]) ||
      firstMatch(hits, /policy\s*(?:number|no\.?|#)\s*[:.]?\s*([A-Z0-9][-A-Z0-9]+)/i),
    named_insured: labeled(hits, ["Named Insured"]),
    policy_effective_date: labeled(hits, ["Policy Effective Date", "Effective Date"]),
    policy_expiration_date: labeled(hits, ["Policy Expiration Date", "Expiration Date"]),
    policy_type: labeled(hits, ["Policy Type"]),
    insured_horse_name: labeled(hits, ["Insured Horse Name", "Horse Name"]),
    registered_name: labeled(hits, ["Registered Name"]),
    breed: labeled(hits, ["Breed"]),
    age: labeled(hits, ["Age"]),
    sex: labeled(hits, ["Sex"]),
    registration_number: labeled(hits, ["Registration Number"]),
    stated_use: labeled(hits, ["Stated Use"]),
    insured_value: labeled(hits, ["Insured Value", "Full Mortality"]),
    currency: labeled(hits, ["Currency"])
  };

  if (!identification.carrier_name) {
    const companyLine = hits.find((h) => /insurance company/i.test(h.line));
    if (companyLine) {
      identification.carrier_name = {
        value: companyLine.line.replace(/\s+/g, " ").trim(),
        source_document_id: companyLine.document_id,
        source_page: companyLine.page,
        source_text: excerpt(companyLine.text, companyLine.line),
        confidence_status: "MEDIUM"
      };
    }
  }

  const coverages: CoverageRecord[] = [];
  const financial_limits: FinancialLimit[] = [];

  function addCoverage(
    type: string,
    present: boolean,
    status: AnalysisStatus,
    extras: Partial<CoverageRecord> = {}
  ) {
    if (!present && status === "NOT FOUND") {
      coverages.push({
        coverage_id: newId(),
        policy_id: policyId,
        coverage_type: type,
        coverage_status: "NOT FOUND",
        description: "NOT FOUND IN DOCUMENTS PROVIDED",
        source_document_id: documents[0]?.document_id || "",
        source_page: 0,
        source_text: "",
        confidence_status: "HIGH",
        ...extras
      });
      return;
    }
    if (!present) return;
    const hit = hits.find((h) => h.text.toLowerCase().includes(type.toLowerCase().split(" ")[0])) || hits[0];
    coverages.push({
      coverage_id: newId(),
      policy_id: policyId,
      coverage_type: type,
      coverage_status: status,
      description: extras.description || excerpt(hit.text, type.split(" ")[0]),
      source_document_id: extras.source_document_id || hit.document_id,
      source_page: extras.source_page || hit.page,
      source_text: extras.source_text || excerpt(hit.text, type.split(" ")[0]),
      confidence_status: extras.confidence_status || "HIGH",
      coverage_limit: extras.coverage_limit,
      deductible: extras.deductible,
      reimbursement_percentage: extras.reimbursement_percentage,
      occurrence_limit: extras.occurrence_limit,
      sublimit: extras.sublimit,
      conditions: extras.conditions
    });
  }

  const mortalityLimits = [
    ...moneyHits(hits, /insured value\s*\/\s*full mortality/i, "Mortality insured value"),
    ...moneyHits(hits, /mortality insured value/i, "Mortality insured value")
  ];
  const labeledMortality =
    labeled(hits, ["Insured Value / Full Mortality", "Insured Value", "mortality insured value"]) ||
    identification.insured_value;
  if (labeledMortality && !mortalityLimits.some((item) => item.amount === labeledMortality.value)) {
    mortalityLimits.unshift({
      id: newId(),
      label: "Mortality insured value",
      amount: labeledMortality.value,
      source_document_id: labeledMortality.source_document_id,
      source_page: labeledMortality.source_page,
      source_text: labeledMortality.source_text
    });
  }
  const uniqueMortality = uniqueLimitAmounts(mortalityLimits);
  const mortalityController = controllingLimit(uniqueMortality, hits, pageControlsMortality);
  const mortalityEv = classifyCoverageEvidence(hits, [
    "full mortality coverage",
    "full mortality",
    "mortality coverage"
  ]);
  let mortalityStatus: AnalysisStatus = mortalityEv?.status || "NOT FOUND";
  if (
    mortalityStatus !== "EXCLUDED" &&
    mortalityStatus !== "POSSIBLE CONFLICT" &&
    uniqueMortality.length >= 2 &&
    !mortalityController
  ) {
    mortalityStatus = "POSSIBLE CONFLICT";
  }
  const mortalityLimit =
    mortalityStatus === "EXCLUDED" || mortalityStatus === "POSSIBLE CONFLICT"
      ? undefined
      : mortalityController
        ? sourcedFromLimit(mortalityController)
        : uniqueMortality[0]
          ? sourcedFromLimit(uniqueMortality[0])
          : labeledMortality;
  addCoverage(
    "Full Mortality",
    mortalityStatus !== "NOT FOUND",
    mortalityStatus,
    {
      coverage_limit: mortalityLimit,
      description:
        mortalityStatus === "EXCLUDED"
          ? "The uploaded documents state that Full Mortality is not provided."
          : mortalityStatus === "NOT FOUND"
            ? "NOT FOUND IN DOCUMENTS PROVIDED"
            : "Full Mortality is stated in the uploaded documents.",
      source_document_id: mortalityController?.source_document_id || mortalityEv?.document_id,
      source_page: mortalityController?.source_page || mortalityEv?.page,
      source_text: mortalityController
        ? mortalityController.source_text
        : mortalityEv
          ? excerpt(mortalityEv.pageText, mortalityEv.clause)
          : ""
    }
  );
  financial_limits.push(...mortalityLimits);

  const medicalLimits = [
    ...moneyHits(hits, /major medical limit/i, "Major Medical limit"),
    ...moneyHits(hits, /major medical coverage with a limit of/i, "Major Medical limit"),
    ...moneyHits(hits, /medical limit is amended to/i, "Major Medical limit")
  ];
  const uniqueMedical = uniqueLimitAmounts(medicalLimits);
  const medicalController = controllingLimit(uniqueMedical, hits, pageControlsMedical);
  const medicalDeductible = labeled(hits, ["Major Medical Deductible", "deductible of"]);
  const reimbursement = firstMatch(hits, /reimbursement is\s+(\d+\s*percent|\d+\s*%)/i);
  const diagnostic = firstMatch(hits, /diagnostic[^\n$]{0,40}(\$[\d,]+)/i);
  const medicalEv = classifyCoverageEvidence(hits, ["major medical coverage", "major medical"]);
  const medicalAmended = Boolean(medicalController) || hasPhrase(allText, ["medical limit is amended", "supersedes the medical limit"]);
  let medicalStatus: AnalysisStatus = medicalEv?.status || "NOT FOUND";
  if (
    medicalStatus !== "EXCLUDED" &&
    medicalStatus !== "POSSIBLE CONFLICT" &&
    uniqueMedical.length >= 2 &&
    !medicalController
  ) {
    medicalStatus = "POSSIBLE CONFLICT";
  } else if (medicalStatus === "COVERED" && medicalAmended) {
    medicalStatus = "COVERED WITH LIMITATIONS";
  }
  const medicalLimit =
    medicalStatus === "EXCLUDED" || medicalStatus === "POSSIBLE CONFLICT"
      ? undefined
      : medicalController
        ? sourcedFromLimit(medicalController)
        : uniqueMedical[0]
          ? sourcedFromLimit(uniqueMedical[0])
          : undefined;
  addCoverage("Major Medical", medicalStatus !== "NOT FOUND", medicalStatus, {
    coverage_limit: medicalLimit,
    deductible: medicalDeductible,
    reimbursement_percentage: reimbursement,
    sublimit: diagnostic,
    conditions: medicalAmended && medicalStatus !== "EXCLUDED" && medicalStatus !== "POSSIBLE CONFLICT"
      ? "An endorsement modifies the medical limit."
      : undefined,
    description:
      medicalStatus === "EXCLUDED"
        ? "The uploaded documents state that Major Medical is not provided."
        : medicalStatus === "NOT FOUND"
          ? "NOT FOUND IN DOCUMENTS PROVIDED"
          : undefined,
    source_document_id: medicalController?.source_document_id || medicalEv?.document_id,
    source_page: medicalController?.source_page || medicalEv?.page,
    source_text: medicalController
      ? medicalController.source_text
      : medicalEv
        ? excerpt(medicalEv.pageText, medicalEv.clause)
        : undefined
  });
  financial_limits.push(...medicalLimits);
  if (medicalDeductible) {
    financial_limits.push({
      id: newId(),
      label: "Major Medical deductible",
      amount: medicalDeductible.value,
      source_document_id: medicalDeductible.source_document_id,
      source_page: medicalDeductible.source_page,
      source_text: medicalDeductible.source_text
    });
  }
  if (reimbursement) {
    financial_limits.push({
      id: newId(),
      label: "Reimbursement percentage",
      amount: reimbursement.value,
      source_document_id: reimbursement.source_document_id,
      source_page: reimbursement.source_page,
      source_text: reimbursement.source_text
    });
  }
  if (diagnostic) {
    financial_limits.push({
      id: newId(),
      label: "Diagnostic imaging sublimit",
      amount: diagnostic.value,
      source_document_id: diagnostic.source_document_id,
      source_page: diagnostic.source_page,
      source_text: diagnostic.source_text
    });
  }

  const surgicalLimits = [
    ...moneyHits(hits, /surgical coverage is added with a/i, "Surgical occurrence limit"),
    ...moneyHits(hits, /surgical (?:occurrence )?limit/i, "Surgical occurrence limit")
  ];
  const uniqueSurgical = uniqueLimitAmounts(surgicalLimits);
  const surgicalController = controllingLimit(uniqueSurgical, hits, pageControlsSurgical);
  const surgicalEv = classifyCoverageEvidence(hits, ["surgical coverage", "surgical"]);
  let surgicalStatus: AnalysisStatus = surgicalEv?.status || "NOT FOUND";
  if (
    surgicalStatus !== "EXCLUDED" &&
    surgicalStatus !== "POSSIBLE CONFLICT" &&
    uniqueSurgical.length >= 2 &&
    !surgicalController
  ) {
    surgicalStatus = "POSSIBLE CONFLICT";
  }
  const surgical =
    surgicalStatus === "EXCLUDED" || surgicalStatus === "POSSIBLE CONFLICT"
      ? undefined
      : surgicalController
        ? sourcedFromLimit(surgicalController)
        : uniqueSurgical[0]
          ? sourcedFromLimit(uniqueSurgical[0])
          : labeled(hits, ["Surgical coverage"]);
  addCoverage("Surgical", surgicalStatus !== "NOT FOUND", surgicalStatus, {
    occurrence_limit: surgical,
    coverage_limit: surgical,
    description:
      surgicalStatus === "EXCLUDED"
        ? "The uploaded documents state that Surgical coverage is not provided."
        : undefined,
    source_document_id: surgicalController?.source_document_id || surgicalEv?.document_id,
    source_page: surgicalController?.source_page || surgicalEv?.page,
    source_text: surgicalController
      ? surgicalController.source_text
      : surgicalEv
        ? excerpt(surgicalEv.pageText, surgicalEv.clause)
        : undefined
  });
  financial_limits.push(...surgicalLimits);

  const colicEv = classifyCoverageEvidence(hits, ["colic surgery"]);
  let colicStatus: AnalysisStatus = colicEv?.status || "NOT FOUND";
  if (colicStatus === "COVERED" && hasPhrase(allText, ["subject to the surgical"])) {
    colicStatus = "COVERED WITH LIMITATIONS";
  }
  addCoverage("Colic Surgery", colicStatus !== "NOT FOUND", colicStatus, {
    conditions: colicStatus === "COVERED WITH LIMITATIONS" ? "Stated as subject to the surgical limit." : undefined,
    source_document_id: colicEv?.document_id,
    source_page: colicEv?.page,
    source_text: colicEv ? excerpt(colicEv.pageText, colicEv.clause) : undefined
  });

  const louEv = classifyCoverageEvidence(hits, ["loss of use coverage", "loss of use"]);
  const louStatus: AnalysisStatus = louEv?.status || "NOT FOUND";
  addCoverage("Loss of Use", louStatus !== "NOT FOUND", louStatus, {
    description:
      louStatus === "EXCLUDED"
        ? "The uploaded documents state that Loss of Use coverage is not provided."
        : louStatus === "NEEDS CLARIFICATION"
          ? "Loss of Use is mentioned. Effect needs clarification."
          : "NOT FOUND IN DOCUMENTS PROVIDED",
    source_document_id: louEv?.document_id,
    source_page: louEv?.page,
    source_text: louEv ? excerpt(louEv.pageText, louEv.clause) : undefined
  });

  const stallionEv = classifyCoverageEvidence(hits, ["stallion infertility coverage", "stallion infertility"]);
  const stallionStatus: AnalysisStatus = stallionEv?.status || "NOT FOUND";
  addCoverage("Stallion Infertility", stallionStatus !== "NOT FOUND", stallionStatus, {
    description:
      stallionStatus === "EXCLUDED"
        ? "The uploaded documents state that Stallion Infertility coverage is not provided."
        : stallionStatus === "NEEDS CLARIFICATION"
          ? "Stallion Infertility is mentioned. Effect needs clarification."
          : "NOT FOUND IN DOCUMENTS PROVIDED",
    source_document_id: stallionEv?.document_id,
    source_page: stallionEv?.page,
    source_text: stallionEv ? excerpt(stallionEv.pageText, stallionEv.clause) : undefined
  });

  const theftEv = classifyCoverageEvidence(hits, ["theft coverage", "coverage for theft"]);
  const theftStatus: AnalysisStatus = theftEv?.status || "NOT FOUND";
  addCoverage("Theft", theftStatus !== "NOT FOUND", theftStatus, {
    description:
      theftStatus === "EXCLUDED"
        ? "The uploaded documents state that Theft coverage is not provided."
        : undefined,
    source_document_id: theftEv?.document_id,
    source_page: theftEv?.page,
    source_text: theftEv ? excerpt(theftEv.pageText, theftEv.clause) : undefined
  });

  const pageHits = uniquePages(hits);
  const exclusions: ExclusionRecord[] = [];
  const seenExclusion = new Set<string>();
  for (const h of pageHits) {
    const excl = /(?:this endorsement )?excludes coverage for the ([^.]+)\./i.exec(h.text);
    if (excl) {
      const key = `excl|${h.page}|${excl[1].trim().toLowerCase()}`;
      if (!seenExclusion.has(key)) {
        seenExclusion.add(key);
        exclusions.push({
          exclusion_id: newId(),
          policy_id: policyId,
          exclusion_type: "Named anatomical / condition exclusion",
          anatomical_area: /fetlock|hock|navicular|tendon/i.exec(excl[1])?.[0],
          condition: excl[1].trim(),
          description: excl[0].trim(),
          source_document_id: h.document_id,
          source_page: h.page,
          exact_source_excerpt: excerpt(h.text, excl[0]),
          confidence_status: "HIGH"
        });
      }
    }
    const pre = /pre-existing condition:\s*([^\n.]+)/i.exec(h.text);
    if (pre) {
      const key = `pre|${h.page}|${pre[1].trim().toLowerCase()}`;
      if (!seenExclusion.has(key)) {
        seenExclusion.add(key);
        exclusions.push({
          exclusion_id: newId(),
          policy_id: policyId,
          exclusion_type: "Pre-existing condition",
          condition: pre[1].trim(),
          description: pre[0].trim(),
          source_document_id: h.document_id,
          source_page: h.page,
          exact_source_excerpt: excerpt(h.text, pre[0]),
          confidence_status: "HIGH"
        });
      }
    }
  }

  const endorsements: EndorsementEffect[] = [];
  const seenEndorsement = new Set<string>();
  for (const h of pageHits) {
    if (!hasPhrase(h.text, ["this endorsement", "modifies", "replaces", "amended", "supersedes", "notwithstanding"])) {
      continue;
    }
    if (hasPhrase(h.text, ["modifies and replaces the major medical limit", "medical limit is amended"])) {
      const to = h.line.match(/amended to\s+(\$[\d,]+)/i) || h.text.match(/amended to\s+(\$[\d,]+)/i);
      const key = `${h.page}|${to?.[1] || "medical"}`;
      if (seenEndorsement.has(key)) continue;
      seenEndorsement.add(key);
      endorsements.push({
        id: newId(),
        original_provision: "Declarations Major Medical limit",
        modifying_endorsement: classifyPage(h.text) === "Unknown Document" ? "Medical endorsement" : "Major Medical Endorsement",
        resulting_status: to
          ? `COVERED WITH LIMITATIONS — medical limit amended to ${to[1]}`
          : "NEEDS CLARIFICATION",
        source_document_id: h.document_id,
        source_page: h.page,
        source_text: excerpt(h.text, "amended")
      });
    }
  }

  const conflicts: ConflictRecord[] = [];
  if (mortalityEv?.contradiction) {
    conflicts.push(
      coverageContradictionRecord("Full Mortality", mortalityEv.contradiction.grant, mortalityEv.contradiction.denial)
    );
  } else if (uniqueMortality.length >= 2 && !mortalityController && mortalityStatus !== "EXCLUDED") {
    conflicts.push(limitConflictRecord("Mortality", uniqueMortality[0], uniqueMortality[1]));
  }
  if (medicalEv?.contradiction) {
    conflicts.push(
      coverageContradictionRecord("Major Medical", medicalEv.contradiction.grant, medicalEv.contradiction.denial)
    );
  } else if (uniqueMedical.length >= 2 && !medicalController && medicalStatus !== "EXCLUDED") {
    conflicts.push(limitConflictRecord("Major Medical", uniqueMedical[0], uniqueMedical[1]));
  }
  if (surgicalEv?.contradiction) {
    conflicts.push(
      coverageContradictionRecord("Surgical", surgicalEv.contradiction.grant, surgicalEv.contradiction.denial)
    );
  } else if (uniqueSurgical.length >= 2 && !surgicalController && surgicalStatus !== "EXCLUDED") {
    conflicts.push(limitConflictRecord("Surgical", uniqueSurgical[0], uniqueSurgical[1]));
  }
  if (theftEv?.contradiction) {
    conflicts.push(coverageContradictionRecord("Theft", theftEv.contradiction.grant, theftEv.contradiction.denial));
  }
  if (louEv?.contradiction) {
    conflicts.push(coverageContradictionRecord("Loss of Use", louEv.contradiction.grant, louEv.contradiction.denial));
  }
  if (stallionEv?.contradiction) {
    conflicts.push(
      coverageContradictionRecord("Stallion Infertility", stallionEv.contradiction.grant, stallionEv.contradiction.denial)
    );
  }
  if (colicEv?.contradiction) {
    conflicts.push(coverageContradictionRecord("Colic Surgery", colicEv.contradiction.grant, colicEv.contradiction.denial));
  }

  const datePairs = hits.filter((h) => /effective date|expiration date/i.test(h.line));
  void datePairs;

  const requirements: RequirementRecord[] = [];
  const reqBlock = hits.find((h) => /emergency requirements/i.test(h.text));
  if (reqBlock) {
    const bullets = reqBlock.text.split(/\n|•|-/).map((s) => s.trim()).filter((s) => s.length > 12);
    const triggers = ["colic", "serious illness", "injury", "surgery", "euthanasia", "death", "theft"];
    for (const line of bullets) {
      if (!/notify|veterinar|preserv|file written|authorization|certif/i.test(line)) continue;
      requirements.push({
        id: newId(),
        trigger: triggers.filter((t) => reqBlock.text.toLowerCase().includes(t)).join(", "),
        requirement: line.replace(/^[\d.)\s]+/, ""),
        source_document_id: reqBlock.document_id,
        source_page: reqBlock.page,
        source_text: excerpt(reqBlock.text, line.slice(0, 40))
      });
    }
  }

  const declarationPages = pageHits.filter((h) => isDeclarationsPage(h.text));
  const formInventory = buildFormInventory(pageHits, declarationPages);
  const warnings: string[] = [];
  if (documents.some((d) => d.extraction_status && d.extraction_status !== "extracted" && d.extraction_status !== "pending")) {
    warnings.push(
      "Text extraction is incomplete. OCR or native extraction did not recover every page. Coverage conclusions use only pages with reliable text."
    );
  }
  if (!declarationPages.length) {
    warnings.push("No page was classified as Declarations.");
  }
  const scheduleFound = declarationPages.some((h) => Boolean(collectFormsScheduleText(h.text)));
  const uncertainSchedule = declarationPages.some((h) => {
    const block = collectFormsScheduleText(h.text);
    return Boolean(block) && parseListedForms(block || "").length === 0;
  });
  if (declarationPages.length && !scheduleFound) {
    warnings.push("No forms or endorsements schedule was identified on the declarations.");
  }
  if (uncertainSchedule) {
    warnings.push("A forms schedule was found but could not be parsed with certainty.");
  }
  for (const form of formInventory) {
    if (form.status === "MISSING") {
      warnings.push(`Listed form ${form.printed_identifier} is missing from the uploaded package.`);
    }
    if (form.status === "EDITION MISMATCH") {
      warnings.push(
        `Listed form ${form.printed_identifier} edition ${form.edition || "unknown"} does not match uploaded edition ${form.match_edition || "unknown"}.`
      );
    }
  }
  const unread = documents
    .flatMap((d) => d.pages)
    .map(hydratePageDiagnostics)
    .filter((p) => p.quality_status === "UNREADABLE");
  if (unread.length) warnings.push(`${unread.length} page(s) have little or no readable text.`);
  const low = documents
    .flatMap((d) => d.pages)
    .map(hydratePageDiagnostics)
    .filter((p) => p.quality_status === "LOW");
  if (low.length) {
    warnings.push(
      `${low.length} page(s) have low-quality extracted text and were not used as reliable policy language.`
    );
  }
  if (!identification.policy_number) warnings.push("Policy number was not found.");
  if (!identification.named_insured) warnings.push("Named insured was not found.");
  const documentIds = documents.map((d) => d.document_id);
  if (new Set(documentIds).size !== documentIds.length) {
    warnings.push(
      "Uploaded documents reuse the same document identifier. The package cannot be treated as complete or published."
    );
  }

  const allListedPresent =
    scheduleFound &&
    !uncertainSchedule &&
    formInventory.length > 0 &&
    formInventory.every((f) => f.status === "PRESENT");
  const completeness: CompletenessResult = {
    status:
      warnings.length === 0 && declarationPages.length > 0 && scheduleFound && allListedPresent
        ? "APPEARS COMPLETE"
        : "DOCUMENT PACKAGE MAY BE INCOMPLETE",
    warnings
  };

  const coverage_gaps: string[] = [];
  const louRec = coverages.find((c) => c.coverage_type === "Loss of Use");
  if (louRec?.coverage_status === "EXCLUDED") {
    coverage_gaps.push(
      "Loss of Use is excluded in the uploaded documents. Ask the agent whether a separate endorsement is available or intended."
    );
  } else if (louRec?.coverage_status === "NOT FOUND") {
    coverage_gaps.push(
      "Loss of Use is not found in the uploaded documents. Ask the agent whether a separate endorsement is available or intended."
    );
  }
  if (exclusions.length) {
    coverage_gaps.push("Named exclusions appear in the package. Confirm with the agent that they match the horse you believe is insured.");
  }
  if (conflicts.length) {
    coverage_gaps.push("Conflicting medical limits appear in the package. Ask which page controls after endorsements.");
  }

  const agent_questions: string[] = [];
  if (identification.policy_number) {
    agent_questions.push(`Is policy ${identification.policy_number.value} the complete in-force contract for ${identification.insured_horse_name?.value || "this horse"}?`);
  } else {
    agent_questions.push("Which policy number is in force, and is this the complete package?");
  }
  if (conflicts.length) {
    agent_questions.push(
      `The documents show Major Medical as ${uniqueMedical.map((m) => m.amount + " (p." + m.source_page + ")").join(" and ")}. Which amount is in force after endorsements?`
    );
  }
  if (exclusions.length) {
    agent_questions.push(
      `Please confirm the exclusion language on page ${exclusions[0].source_page}: “${exclusions[0].description}” — does this apply to the current policy period only?`
    );
  }
  if (requirements.length) {
    agent_questions.push("Please confirm the notice window and euthanasia/remains instructions that apply in an emergency.");
  }
  const missingForms = formInventory.filter((f) => f.status !== "PRESENT");
  if (missingForms.length) {
    agent_questions.push(
      `The declarations list ${missingForms.map((f) => f.printed_identifier).join(", ")} without separately sourced matching form text. Are those forms in force and missing from this upload?`
    );
  } else {
    agent_questions.push("Are any forms listed on the declarations missing from this upload?");
  }

  const educational_notes = [
    "The uploaded policy is the authority. Educational notes below do not add coverage.",
    "Status labels describe what the documents appear to say. They are not a promise that a claim will be paid.",
    "General equine-insurance custom is not used to fill gaps. If a coverage is absent, the report says NOT FOUND IN DOCUMENTS PROVIDED."
  ];

  return {
    policy_id: policyId,
    session_id: sessionId,
    created_at: now,
    updated_at: now,
    completeness_status: completeness.status,
    analysis_status: "complete",
    identification,
    documents,
    coverages,
    exclusions,
    financial_limits: dedupeLimits(financial_limits),
    requirements,
    endorsements,
    conflicts,
    form_inventory: formInventory,
    completeness,
    agent_questions,
    coverage_gaps,
    educational_notes
  };
}

function isDeclarationsPage(text: string): boolean {
  return /\bdeclarations\b/i.test(text);
}

function buildFormInventory(
  hits: Hit[],
  declarationPages: Hit[]
): PolicyFormRecord[] {
  const listed: PolicyFormRecord[] = [];
  const seen = new Set<string>();
  for (const h of declarationPages) {
    const schedule = collectFormsScheduleText(h.text);
    if (!schedule) continue;
    for (const item of parseListedForms(schedule)) {
      const normalized = normalizeFormId(item.printed);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      listed.push({
        id: newId(),
        printed_identifier: item.printed,
        normalized_identifier: normalized,
        form_title: undefined,
        edition: item.edition,
        listing_document_id: h.document_id,
        listing_page: h.page,
        listing_source_text: excerpt(h.text, item.printed),
        status: "MISSING"
      });
    }
  }

  const pages = uniquePages(hits);
  for (const form of listed) {
    const candidates: Array<{
      document_id: string;
      page: number;
      line: string;
      text: string;
      edition?: string;
      listing: boolean;
    }> = [];
    for (const p of pages) {
      for (const rawLine of p.text.split(/\n+/)) {
        const t = rawLine.replace(/\s+/g, " ").trim();
        if (!t) continue;
        if (!lineHasFormId(t, form.printed_identifier)) continue;
        if (isFormsScheduleHeading(t)) continue;
        if (!isIndependentFormEvidence(t, form.printed_identifier, p.text)) continue;
        candidates.push({
          document_id: p.document_id,
          page: p.page,
          line: t,
          text: p.text,
          edition: extractEdition(t) || extractEdition(p.text),
          listing: p.document_id === form.listing_document_id && p.page === form.listing_page
        });
      }
    }
    const match = candidates.find((c) => !c.listing) || candidates[0];
    if (!match) {
      form.status = "MISSING";
      continue;
    }
    form.match_document_id = match.document_id;
    form.match_page = match.page;
    form.match_source_text = excerpt(match.text, form.printed_identifier);
    form.match_edition = match.edition;
    form.form_title = match.line.replace(/\s+/g, " ").trim();
    if (form.edition && match.edition && normalizeEdition(form.edition) !== normalizeEdition(match.edition)) {
      form.status = "EDITION MISMATCH";
    } else {
      form.status = "PRESENT";
    }
  }
  return listed;
}

function dedupeLimits(items: FinancialLimit[]): FinancialLimit[] {
  const seen = new Set<string>();
  const out: FinancialLimit[] = [];
  for (const i of items) {
    const k = `${i.label}|${i.amount}|${i.source_page}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(i);
  }
  return out;
}
