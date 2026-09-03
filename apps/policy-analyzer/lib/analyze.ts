import { classifyPage } from "./classify";
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
};

function pagesOf(docs: DocumentRecord[]): Array<Hit & { document_id: string }> {
  const out: Array<Hit & { document_id: string }> = [];
  for (const doc of docs) {
    for (const p of doc.pages) {
      for (const line of p.text.split(/\n+/)) {
        const t = line.replace(/\s+/g, " ").trim();
        if (t) out.push({ page: p.page, text: p.text, line: t, document_id: doc.document_id });
      }
    }
  }
  return out;
}

function firstMatch(
  hits: Array<Hit & { document_id: string }>,
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
  hits: Array<Hit & { document_id: string }>,
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
  hits: Array<Hit & { document_id: string }>,
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

function uniquePages(hits: Array<Hit & { document_id: string }>): Array<Hit & { document_id: string }> {
  const seen = new Set<string>();
  const out: Array<Hit & { document_id: string }> = [];
  for (const h of hits) {
    const key = `${h.document_id}:${h.page}`;
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

export function analyzeDocuments(policyId: string, sessionId: string, documents: DocumentRecord[]): PolicyRecord {
  const now = new Date().toISOString();
  const hits = pagesOf(documents);
  const allText = documents.map((d) => d.pages.map((p) => p.text).join("\n")).join("\n\n");

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

  const mortalityLimit =
    labeled(hits, ["Insured Value / Full Mortality", "Insured Value", "mortality insured value"]) ||
    identification.insured_value;
  const hasMortality = hasPhrase(allText, ["full mortality", "mortality coverage", "mortality insured value"]);
  addCoverage("Full Mortality", hasMortality, hasMortality ? "COVERED" : "NOT FOUND", {
    coverage_limit: mortalityLimit,
    description: hasMortality
      ? "Full Mortality is stated in the uploaded documents."
      : "NOT FOUND IN DOCUMENTS PROVIDED"
  });
  if (mortalityLimit) {
    financial_limits.push({
      id: newId(),
      label: "Mortality insured value",
      amount: mortalityLimit.value,
      source_document_id: mortalityLimit.source_document_id,
      source_page: mortalityLimit.source_page,
      source_text: mortalityLimit.source_text
    });
  }

  const medicalLimits = [
    ...moneyHits(hits, /major medical limit/i, "Major Medical limit"),
    ...moneyHits(hits, /major medical coverage with a limit of/i, "Major Medical limit")
  ];
  const medicalDeductible = labeled(hits, ["Major Medical Deductible", "deductible of"]);
  const reimbursement = firstMatch(hits, /reimbursement is\s+(\d+\s*percent|\d+\s*%)/i);
  const diagnostic = firstMatch(hits, /diagnostic[^\n$]{0,40}(\$[\d,]+)/i);
  const hasMedical = hasPhrase(allText, ["major medical"]);
  const medicalAmended = hasPhrase(allText, ["medical limit is amended", "supersedes the medical limit"]);
  addCoverage("Major Medical", hasMedical, medicalAmended ? "COVERED WITH LIMITATIONS" : hasMedical ? "COVERED" : "NOT FOUND", {
    coverage_limit: medicalLimits[0]
      ? {
          value: medicalLimits[0].amount,
          source_document_id: medicalLimits[0].source_document_id,
          source_page: medicalLimits[0].source_page,
          source_text: medicalLimits[0].source_text,
          confidence_status: "HIGH"
        }
      : undefined,
    deductible: medicalDeductible,
    reimbursement_percentage: reimbursement,
    sublimit: diagnostic,
    conditions: medicalAmended
      ? "An endorsement modifies the medical limit. See Potential Conflicts."
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

  const surgical = firstMatch(hits, /surgical coverage is added with a\s+(\$[\d,]+)/i) ||
    labeled(hits, ["Surgical coverage"]);
  const hasSurgical = hasPhrase(allText, ["surgical coverage", "surgical is added", "colic surgery"]);
  addCoverage("Surgical", hasSurgical, hasSurgical ? "COVERED" : "NOT FOUND", {
    occurrence_limit: surgical,
    coverage_limit: surgical
  });
  if (surgical) {
    financial_limits.push({
      id: newId(),
      label: "Surgical occurrence limit",
      amount: surgical.value,
      source_document_id: surgical.source_document_id,
      source_page: surgical.source_page,
      source_text: surgical.source_text
    });
  }

  const hasColic = hasPhrase(allText, ["colic surgery"]);
  addCoverage("Colic Surgery", hasColic, hasColic ? "COVERED WITH LIMITATIONS" : "NOT FOUND", {
    conditions: hasColic ? "Stated as subject to the surgical limit." : undefined
  });

  const louDenied = hasPhrase(allText, ["does not provide loss of use"]);
  addCoverage("Loss of Use", hasPhrase(allText, ["loss of use"]), louDenied ? "NOT FOUND" : "NEEDS CLARIFICATION", {
    description: louDenied
      ? "The uploaded base form states it does not provide Loss of Use coverage."
      : hasPhrase(allText, ["loss of use"])
        ? "Loss of Use is mentioned. Effect needs clarification."
        : "NOT FOUND IN DOCUMENTS PROVIDED"
  });

  addCoverage(
    "Stallion Infertility",
    hasPhrase(allText, ["stallion infertility"]),
    hasPhrase(allText, ["does not provide stallion infertility"]) ? "NOT FOUND" : "NEEDS CLARIFICATION",
    {
      description: hasPhrase(allText, ["does not provide stallion infertility"])
        ? "The uploaded form states it does not provide Stallion Infertility coverage."
        : "NOT FOUND IN DOCUMENTS PROVIDED"
    }
  );

  const hasTheft = hasPhrase(allText, ["theft coverage", "coverage for theft"]);
  addCoverage("Theft", hasTheft, hasTheft ? "COVERED" : "NOT FOUND");

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
  const uniqueMedical = [...new Map(medicalLimits.map((m) => [m.amount, m])).values()];
  if (uniqueMedical.length >= 2) {
    conflicts.push({
      id: newId(),
      title: "Potential Policy Conflict",
      description: "Major Medical limits differ across uploaded pages. The analyzer does not choose which amount applies.",
      left: {
        label: uniqueMedical[0].label,
        value: uniqueMedical[0].amount,
        source_page: uniqueMedical[0].source_page,
        source_text: uniqueMedical[0].source_text
      },
      right: {
        label: uniqueMedical[1].label,
        value: uniqueMedical[1].amount,
        source_page: uniqueMedical[1].source_page,
        source_text: uniqueMedical[1].source_text
      }
    });
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

  const referenced = new Set<string>();
  for (const m of allText.matchAll(/\b(EQ-[A-Z0-9-]+)\b/g)) referenced.add(m[1]);
  const present = new Set<string>();
  for (const m of allText.matchAll(/\b((?:EQ-BASE|EQ-MED|EQ-EXCL|EQ-END)[A-Z0-9-]*)\b/g)) {
    present.add(m[1]);
  }
  const warnings: string[] = [];
  if (!hasPhrase(allText, ["declarations"])) {
    warnings.push("No page was classified as Declarations.");
  }
  const unread = documents.flatMap((d) => d.pages).filter((p) => p.text.length < 20);
  if (unread.length) warnings.push(`${unread.length} page(s) have little or no readable text.`);
  if (!identification.policy_number) warnings.push("Policy number was not found.");
  if (!identification.named_insured) warnings.push("Named insured was not found.");

  const completeness: CompletenessResult = {
    status: warnings.length ? "DOCUMENT PACKAGE MAY BE INCOMPLETE" : "APPEARS COMPLETE",
    warnings
  };

  const coverage_gaps: string[] = [];
  if (coverages.find((c) => c.coverage_type === "Loss of Use" && c.coverage_status === "NOT FOUND")) {
    coverage_gaps.push("Loss of Use is not provided in the uploaded base form. Ask the agent whether a separate endorsement is available or intended.");
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
  agent_questions.push("Are any forms listed on the declarations missing from this upload?");

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
    completeness,
    agent_questions,
    coverage_gaps,
    educational_notes
  };
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
