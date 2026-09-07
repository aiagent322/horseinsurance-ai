import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { looksLikeQuotedPolicyLanguage } from "../lib/agent-questions";
import { classifyPackage } from "../lib/classify";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";
import { CONTROL2_MULTI_FORM_PACKAGE_PAGES } from "./fixtures/control2-multi-form-package-pages";

function docFromPages(pages: Array<{ page: number; text: string }>, filename = "agent-questions.pdf"): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: filename,
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "agent-questions",
    page_count: pages.length,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: classifyPackage(pages),
    pages
  };
}

function analyzePages(pages: Array<{ page: number; text: string }>) {
  const doc = docFromPages(pages);
  return analyzeDocuments(newId(), doc.session_id, [doc]);
}

function blob(questions: string[]): string {
  return questions.join("\n");
}

function main() {
  const testA = analyzePages([
    {
      page: 1,
      text: `EXCLUSIONS
This insurance does not cover loss caused by war.`
    }
  ]);
  assert.ok(testA.exclusions.some((row) => /war/i.test(row.exclusion_type)));
  assert.doesNotMatch(blob(testA.agent_questions), /confirm.{0,40}exclusion|exclusion language|does this apply to the current policy period|war exclusion/i);
  console.log("TEST A OK");

  const testB = analyzePages([
    {
      page: 1,
      text: `PART II. COVERAGE
The Company will indemnify the Insured upon the death of an insured horse as stated in the Declarations and Schedule.`
    }
  ]);
  assert.ok(
    testB.agent_questions.some((question) => /declarations/i.test(question) && /schedule/i.test(question)),
    "TEST B: missing Declarations/Schedule question"
  );
  console.log("TEST B OK");

  const testC = analyzePages([
    {
      page: 1,
      text: `PART II. COVERAGE
The Company will indemnify the Insured upon the death of an insured horse.

PART III. CONDITIONS
The Insured shall immediately give telephone notice to the person or firm named in Item G of the Declarations.`
    }
  ]);
  assert.ok(
    testC.agent_questions.some((question) => /notice/i.test(question) && /contact|declarations/i.test(question)),
    "TEST C: missing notice contact question"
  );
  console.log("TEST C OK");

  const testD = analyzePages([
    {
      page: 1,
      text: `PART II. COVERAGE
The Company will indemnify the Insured upon the death of an insured horse.
Additional coverages such as Equine Major Medical and Equine Zero Deductible Surgical may be fully earned as stated in the Schedule or endorsements to the Policy.`
    }
  ]);
  const medical = testD.coverages.find((row) => row.coverage_type === "Major Medical");
  const surgical = testD.coverages.find((row) => row.coverage_type === "Surgical");
  assert.equal(medical?.coverage_status, "NEEDS CLARIFICATION");
  assert.equal(surgical?.coverage_status, "NEEDS CLARIFICATION");
  assert.ok(
    testD.agent_questions.some((question) => /major medical/i.test(question) && /surgical/i.test(question) && /schedule|endorsement/i.test(question)),
    "TEST D: optional coverage question"
  );
  console.log("TEST D OK");

  const testE = analyzePages([
    {
      page: 1,
      text: `PART II. COVERAGE
The Company will indemnify the Insured upon the death of an insured horse resulting from accident or injury or illness or disease.`
    }
  ]);
  assert.equal(testE.coverages.find((row) => row.coverage_type === "Loss of Use")?.coverage_status, "NOT FOUND");
  assert.doesNotMatch(
    blob(testE.agent_questions),
    /loss of use|should have been included|can loss of use be added/i
  );
  console.log("TEST E OK");

  const testF = analyzePages([
    {
      page: 1,
      text: `PART III. CONDITIONS
After an insured loss, the Insured shall render a detailed sworn proof of loss within sixty (60) days.`
    }
  ]);
  assert.ok(testF.requirements.some((row) => /proof of loss/i.test(`${row.trigger} ${row.requirement}`)));
  assert.doesNotMatch(blob(testF.agent_questions), /proof of loss|confirm the .{0,20}duty/i);
  console.log("TEST F OK");

  const testG = analyzePages([
    {
      page: 1,
      text: `Declarations
Policy Number: EQ-CONF-1
Named Insured: Test Owner
Insured Horse Name: Conflict Horse
Policy Effective Date: January 1, 2026
Policy Expiration Date: January 1, 2027
Insured Value / Full Mortality: $40,000
Major Medical Limit: $5,000
Forms:
EQ-A-1 Ed. 01/2024`
    },
    {
      page: 2,
      text: `Base Policy Form EQ-A-1 Ed. 01/2024
This policy provides Full Mortality coverage for the insured horse.
This policy provides Major Medical coverage with a limit of $12,000 per policy period.`
    }
  ]);
  assert.ok(testG.conflicts.length >= 1, "TEST G: conflict detected");
  assert.ok(
    testG.agent_questions.some((question) => /which (applies|provision controls)/i.test(question) && /\$5,000/i.test(question) && /\$12,000/i.test(question)),
    `TEST G: conflict question. have: ${testG.agent_questions.join(" | ")}`
  );
  console.log("TEST G OK");

  const testH = analyzePages([
    {
      page: 1,
      text: `PART II. COVERAGE
The Company will indemnify the Insured upon the death of an insured horse as stated in the Declarations and Schedule.`
    }
  ]);
  const valueQuestions = testH.agent_questions.filter((question) =>
    /policy number|policy period|insured horse|liability limit|deductible/i.test(question)
  );
  assert.ok(valueQuestions.length >= 1, "TEST H: missing-value question exists");
  assert.ok(valueQuestions.length <= 2, "TEST H: missing values are combined");
  console.log("TEST H OK");

  const longExclusion =
    "This insurance does not cover intentional destruction of an insured horse except when approved in writing after a complete investigation of the facts surrounding the proposed destruction including the horse's current condition the available veterinary options the likely prognosis and every other circumstance that a reasonable underwriter would consider material to the decision, and even then only if the remains are preserved for examination, the company is given a full and fair opportunity to inspect before disposal, and the insured has complied with every other condition of this policy that could conceivably relate to the loss.";
  assert.ok(longExclusion.length > 200);
  const testI = analyzePages([
    {
      page: 1,
      text: `EXCLUSIONS
${longExclusion}`
    }
  ]);
  assert.ok(testI.exclusions.length >= 1);
  assert.ok(testI.agent_questions.every((question) => !looksLikeQuotedPolicyLanguage(question)));
  assert.ok(testI.agent_questions.every((question) => !question.includes(longExclusion.slice(0, 80))));
  assert.doesNotMatch(blob(testI.agent_questions), /please confirm the following language/i);
  console.log("TEST I OK");

  const control = analyzePages(CONTROL2_MULTI_FORM_PACKAGE_PAGES);
  const controlBlob = blob(control.agent_questions);
  assert.equal(control.completeness.status, "COMPLETE CONTRACTUAL SPECIMEN FORM SET");
  assert.ok(
    control.agent_questions.some((question) => /actual issued declarations\/schedule/i.test(question)),
    "Control #2 asks for the issued Declarations/Schedule"
  );
  assert.ok(
    control.agent_questions.some((question) => /horse\(s\), values, limits, and policy period/i.test(question)),
    "Control #2 asks for issued horse/value/period facts"
  );
  assert.ok(
    control.agent_questions.some((question) => /optional endorsements were actually selected or issued/i.test(question)),
    "Control #2 asks which optional endorsements were issued"
  );
  assert.doesNotMatch(controlBlob, /are endorsements missing/i);
  assert.doesNotMatch(
    controlBlob,
    /schedules or endorsements that form part of the issued policy but are missing/i
  );
  assert.doesNotMatch(controlBlob, /complete issued policy package/i);
  console.log("TEST CONTROL2 OK");

  console.log("AGENT QUESTION REGRESSION OK", {
    A: "known exclusion suppressed",
    B: "missing declarations",
    C: "missing notice contact",
    D: "optional coverage",
    E: "unmentioned optional suppressed",
    F: "known duty suppressed",
    G: "true conflict",
    H: "missing-value deduplication",
    I: "no raw clause quote",
    control2: "specimen issued-policy questions"
  });
}

main();
