import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import {
  classifyPolicyTerm,
  walkPolicyClauses,
  type PolicyTermKind
} from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";

function docFromPages(pages: Array<{ page: number; text: string }>, filename = "taxonomy.pdf"): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: filename,
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "taxonomy-fixture",
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
  return { doc, report: analyzeDocuments(newId(), doc.session_id, [doc]) };
}

function assertLimitationOrCondition(kind: PolicyTermKind | null, label: string) {
  assert.ok(kind === "limitation" || kind === "condition", `${label}: expected limitation or condition, got ${kind}`);
  assert.notEqual(kind, "exclusion", `${label}: must not be exclusion`);
}

function clauseKind(pages: Array<{ page: number; text: string }>, needle: RegExp) {
  const walked = walkPolicyClauses(pages);
  const hit = walked.find((item) => needle.test(item.clause));
  assert.ok(hit, `missing clause matching ${needle}`);
  return hit;
}

function main() {
  const testAPages = [
    {
      page: 1,
      text: `CONDITIONS
No liability arises for theft until 30 days after notice of the incident is given to the Company.`
    }
  ];
  const testA = clauseKind(testAPages, /no liability arises for theft/i);
  assert.equal(testA.section, "conditions");
  assertLimitationOrCondition(testA.kind, "TEST A classifier");
  const testAReport = analyzePages(testAPages).report;
  assert.equal(testAReport.exclusions.length, 0, "TEST A: negative wording under Conditions is not an exclusion finding");

  const testBPages = [
    {
      page: 1,
      text: `CONDITIONS
No coverage is afforded for an embryo unless separately insured.`
    }
  ];
  const testB = clauseKind(testBPages, /no coverage is afforded for an embryo/i);
  assert.equal(testB.section, "conditions");
  assertLimitationOrCondition(testB.kind, "TEST B classifier");
  const testBReport = analyzePages(testBPages).report;
  assert.equal(testBReport.exclusions.length, 0, "TEST B: no-coverage wording under Conditions is not an exclusion finding");

  const testCPages = [
    {
      page: 1,
      text: `EXCLUSIONS
This insurance does not cover loss caused by war.`
    }
  ];
  const testC = clauseKind(testCPages, /loss caused by war/i);
  assert.equal(testC.section, "exclusions");
  assert.equal(testC.kind, "exclusion", "TEST C classifier");
  const testCReport = analyzePages(testCPages).report;
  assert.ok(
    testCReport.exclusions.some((row) => /war/i.test(row.description)),
    "TEST C: true exclusion is reported"
  );

  const testDPages = [
    {
      page: 1,
      text: `CONDITIONS
DUTIES AFTER LOSS
The insured shall immediately notify the Company and file a sworn proof of loss within 60 days.`
    }
  ];
  const testD = clauseKind(testDPages, /proof of loss within 60 days/i);
  assert.equal(testD.section, "duties");
  assert.equal(testD.kind, "duty", "TEST D classifier");
  assert.notEqual(testD.kind, "exclusion");
  const testDReport = analyzePages(testDPages).report;
  assert.equal(testDReport.exclusions.length, 0, "TEST D: claim duty is not an exclusion finding");

  const testEPages = [
    {
      page: 1,
      text: `CONDITIONS
The insured shall provide proper care and attention.`
    }
  ];
  const testE = clauseKind(testEPages, /provide proper care and attention/i);
  assert.equal(testE.section, "conditions");
  assert.equal(testE.kind, "condition", "TEST E classifier");
  const testEReport = analyzePages(testEPages).report;
  assert.equal(testEReport.exclusions.length, 0, "TEST E: affirmative condition is not an exclusion finding");

  const testFPages = [
    {
      page: 1,
      text: `EXCLUSIONS
This insurance does not cover loss caused by failure to provide proper care.`
    }
  ];
  const testF = clauseKind(testFPages, /failure to provide proper care/i);
  assert.equal(testF.section, "exclusions");
  assert.equal(testF.kind, "exclusion", "TEST F classifier");
  const testFReport = analyzePages(testFPages).report;
  assert.ok(
    testFReport.exclusions.some((row) => /failure to provide proper care/i.test(row.description)),
    "TEST F: related proper-care exclusion is reported"
  );

  const testGPages = [
    {
      page: 1,
      text: `CONDITIONS
The horse shall be used only for the declared use.`
    },
    {
      page: 2,
      text: `No liability arises for theft until 30 days after notice is given to the Company.
No coverage is afforded for an embryo unless separately insured.
EXCLUSIONS
This insurance does not cover loss caused by war.`
    }
  ];
  const walkedG = walkPolicyClauses(testGPages);
  const clauseA = walkedG.find((item) => /declared use/i.test(item.clause));
  const clauseB = walkedG.find((item) => /no liability arises for theft/i.test(item.clause));
  const clauseC = walkedG.find((item) => /embryo unless separately insured/i.test(item.clause));
  const clauseD = walkedG.find((item) => /loss caused by war/i.test(item.clause));
  assert.equal(clauseA?.section, "conditions", "TEST G: clause A keeps Conditions after the heading");
  assert.equal(clauseB?.section, "conditions", "TEST G: page break does not reset Conditions");
  assert.equal(clauseC?.section, "conditions", "TEST G: clause C stays Conditions until Exclusions");
  assert.equal(clauseD?.section, "exclusions", "TEST G: clause D is under Exclusions");
  assertLimitationOrCondition(clauseA?.kind || null, "TEST G A");
  assertLimitationOrCondition(clauseB?.kind || null, "TEST G B");
  assertLimitationOrCondition(clauseC?.kind || null, "TEST G C");
  assert.equal(clauseD?.kind, "exclusion", "TEST G D");
  const testGReport = analyzePages(testGPages).report;
  assert.equal(
    testGReport.exclusions.filter((row) => /no liability arises for theft|embryo unless separately/i.test(row.description))
      .length,
    0,
    "TEST G: continued Conditions clauses are not exclusion findings"
  );
  assert.ok(testGReport.exclusions.some((row) => /war/i.test(row.description)), "TEST G: war exclusion is reported");

  const headingless = "We will not pay for loss caused directly or indirectly by nuclear reaction.";
  assert.equal(classifyPolicyTerm(headingless, null), "exclusion", "TEST H classifier");
  const testHReport = analyzePages([{ page: 1, text: headingless }]).report;
  assert.ok(
    testHReport.exclusions.some((row) => /nuclear/i.test(row.description)),
    "TEST H: headingless exclusion is reported"
  );

  console.log("TAXONOMY REGRESSION OK", {
    A: testA.kind,
    B: testB.kind,
    C: testC.kind,
    D: testD.kind,
    E: testE.kind,
    F: testF.kind,
    G: { A: clauseA?.kind, B: clauseB?.kind, C: clauseC?.kind, D: clauseD?.kind },
    H: "exclusion"
  });
}

main();
