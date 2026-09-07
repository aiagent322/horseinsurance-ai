import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { explainCoverage } from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";

function docFromPages(pages: Array<{ page: number; text: string }>): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: "coverage-explanation.pdf",
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "coverage-explanation-fixture",
    page_count: pages.length,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: "Unknown Document",
    pages
  };
}

function analyzePages(pages: Array<{ page: number; text: string }>) {
  const doc = docFromPages(pages);
  return analyzeDocuments(newId(), doc.session_id, [doc]);
}

function coverage(report: ReturnType<typeof analyzeDocuments>, type: string) {
  const rec = report.coverages.find((item) => item.coverage_type === type);
  assert.ok(rec, `missing coverage ${type}`);
  return rec;
}

function assertCleanExplanation(text: string, label: string) {
  assert.doesNotMatch(text, /\bEDULE\b|EDULE;/i, `${label}: malformed fragment`);
  assert.doesNotMatch(text, /hereinafter called/i, `${label}: legal alias dump`);
  assert.doesNotMatch(text, /No insured value found/i, `${label}: missing-limit lead`);
  assert.doesNotMatch(text, /^[“"]?[A-Z]{0,3};/, `${label}: chopped heading`);
  assert.ok(!/will indemnify[\s\S]{120,}/i.test(text), `${label}: long grant dump`);
}

function main() {
  const limited = explainCoverage({
    coverageType: "Full Mortality",
    status: "LIMITED",
    grantClause: "The Company will indemnify the Insured upon the death of an insured horse resulting from accident or injury or illness or disease.",
    missingDeclarationsOrSchedule: true
  });
  assert.match(limited, /provides mortality coverage/i, "TEST A: grant stated");
  assert.match(limited, /Declarations\/Schedule/i, "TEST A: missing personalized details");
  assert.doesNotMatch(limited, /NOT FOUND/i, "TEST A: not NOT FOUND");
  assertCleanExplanation(limited, "TEST A");

  const optional = analyzePages([
    {
      page: 3,
      text: "Additional coverages such as Major Medical may be provided by Schedule or endorsement."
    }
  ]);
  const medical = coverage(optional, "Major Medical");
  assert.equal(medical.coverage_status, "NEEDS CLARIFICATION", "TEST B status");
  assert.match(medical.description, /possible additional coverage/i, "TEST B optional mention");
  assert.match(medical.description, /do not establish/i, "TEST B not in force");
  assert.match(medical.description, /Schedule or an endorsement/i, "TEST B missing schedule/endorsement");

  const silent = analyzePages([{ page: 1, text: "Named Insured: Pat Rivers. Policy Number: EQ-TEST-1." }]);
  const lou = coverage(silent, "Loss of Use");
  assert.equal(lou.coverage_status, "NOT FOUND", "TEST C status");
  assert.match(lou.description, /do not establish Loss of Use coverage/i, "TEST C wording");
  assert.doesNotMatch(lou.description, /excluded/i, "TEST C must not say excluded");

  const excluded = analyzePages([
    {
      page: 2,
      text: "This policy does not provide Loss of Use coverage, except as specifically endorsed."
    }
  ]);
  const louEx = coverage(excluded, "Loss of Use");
  assert.equal(louEx.coverage_status, "EXCLUDED", "TEST D status");
  assert.match(louEx.description, /not provided/i, "TEST D exclusion explained");
  assert.match(louEx.description, /exception/i, "TEST D exception preserved");
  assertCleanExplanation(louEx.description, "TEST D");

  const leakPages = [
    {
      page: 1,
      text: `SCHEDULE: As stated in Item J of the Declarations, hereinafter called the Schedule.
PART II. COVERAGE
The Company will indemnify the Insured upon the death of an insured horse resulting from accident or injury occurring during the Policy Period, or illness or disease first manifesting during the Policy Period, subject to immediate notice, the insured horse being listed in the Schedule, the limit in the Schedule, and the deductible; provided however, and subject nevertheless, to the remaining terms.`
    }
  ];
  const leak = analyzePages(leakPages);
  const mortLeak = coverage(leak, "Full Mortality");
  assertCleanExplanation(mortLeak.description, "TEST E");
  assert.doesNotMatch(mortLeak.description, /provided however|subject nevertheless|Item J/i, "TEST E: no raw legal dump");

  const adjacent = analyzePages([
    {
      page: 1,
      text: `The Company will indemnify the Insured upon the death of an insured horse resulting from accident or illness.
The Company will indemnify the Insured for theft of an insured horse and death directly resulting from theft, subject to the Schedule.`
    }
  ]);
  const mortAdj = coverage(adjacent, "Full Mortality");
  const theftAdj = coverage(adjacent, "Theft");
  assert.doesNotMatch(mortAdj.description, /\btheft\b/i, "TEST F: mortality has no theft wording");
  assert.doesNotMatch(theftAdj.description, /\billness\b/i, "TEST F: theft has no mortality-only wording");

  const malformed = explainCoverage({
    coverageType: "Full Mortality",
    status: "LIMITED",
    grantClause: "EDULE; As stated in Item J of the Declarations, hereinafter called the Schedule. The Company will indemnify the Insured upon the death of an insured horse.",
    missingDeclarationsOrSchedule: true
  });
  assert.doesNotMatch(malformed, /\bEDULE\b|EDULE;/i, "TEST G");
  assert.doesNotMatch(malformed, /Item J/i, "TEST G");
  assert.match(malformed, /provides mortality coverage/i, "TEST G still analyzes the grant");

  const legal = explainCoverage({
    coverageType: "Theft",
    status: "LIMITED",
    grantClause:
      "The Company will indemnify the Insured for theft of an insured horse, hereinafter called the Animal, provided however, and subject nevertheless, to reporting.",
    missingDeclarationsOrSchedule: true,
    hasRelatedCoverageLimitation: true
  });
  assert.doesNotMatch(legal, /hereinafter called|provided however|subject nevertheless/i, "TEST H");
  assert.match(legal, /theft/i, "TEST H preserves theft grant");
  assert.match(legal, /reporting|non-recovery|conditions/i, "TEST H preserves qualification");

  console.log("COVERAGE EXPLANATION REGRESSION OK", {
    A: "limited synthesis",
    B: "optional mention",
    C: "not found",
    D: "excluded with exception",
    E: "no raw leak",
    F: "no cross-coverage mix",
    G: "malformed source ignored",
    H: "legal source synthesized"
  });
}

main();
