import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPolicyTerm, walkPolicyClauses } from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";

function docFromPages(pages: Array<{ page: number; text: string }>): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: "emergency-requirements.pdf",
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "emergency-requirements-fixture",
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

function reqBlob(report: ReturnType<typeof analyzeDocuments>) {
  return report.requirements.map((row) => row.requirement).join(" ");
}

function main() {
  const testAPages = [{ page: 1, text: "We will indemnify the insured for covered death." }];
  const testAKind = classifyPolicyTerm(testAPages[0].text, null);
  assert.equal(testAKind, "grant", "TEST A classifier");
  const testA = analyzePages(testAPages);
  assert.equal(testA.requirements.length, 0, "TEST A: coverage grant is not an Emergency / Claim Requirement");

  const testBPages = [
    {
      page: 1,
      text: `CONDITIONS
In the event of injury, the insured shall immediately notify the Company.`
    }
  ];
  const testBWalked = walkPolicyClauses(testBPages).find((item) => /immediately notify/i.test(item.clause));
  assert.equal(testBWalked?.kind, "duty", "TEST B classifier");
  const testB = analyzePages(testBPages);
  assert.ok(testB.requirements.some((row) => /immediately notify/i.test(row.requirement)), "TEST B: event-triggered duty is included");

  const testCPages = [
    {
      page: 1,
      text: `CONDITIONS
The insured shall file a sworn proof of loss within 60 days.`
    }
  ];
  const testCWalked = walkPolicyClauses(testCPages).find((item) => /proof of loss/i.test(item.clause));
  assert.equal(testCWalked?.kind, "duty", "TEST C classifier");
  const testC = analyzePages(testCPages);
  const proof = testC.requirements.find((row) => /proof of loss/i.test(row.requirement));
  assert.ok(proof, "TEST C: claim deadline duty is included");
  assert.match(proof.requirement, /within 60 days/i, "TEST C: deadline is preserved");

  const testDPages = [
    {
      page: 1,
      text: `CONDITIONS
The insured shall be the sole owner throughout the policy period.`
    }
  ];
  const testDWalked = walkPolicyClauses(testDPages).find((item) => /sole owner/i.test(item.clause));
  assert.equal(testDWalked?.kind, "condition", "TEST D classifier");
  const testD = analyzePages(testDPages);
  assert.equal(testD.requirements.length, 0, "TEST D: general condition is not an Emergency / Claim Requirement");

  const testEPages = [
    {
      page: 1,
      text: `CONDITIONS
No liability arises for theft until 30 days after notice.`
    }
  ];
  const testEWalked = walkPolicyClauses(testEPages).find((item) => /no liability arises/i.test(item.clause));
  assert.equal(testEWalked?.kind, "limitation", "TEST E classifier");
  const testE = analyzePages(testEPages);
  assert.equal(
    testE.requirements.filter((row) => /no liability arises|until 30 days/i.test(row.requirement)).length,
    0,
    "TEST E: coverage limitation is not an action item"
  );

  const testFPages = [
    {
      page: 1,
      text: `CONDITIONS
The insured shall immediately report theft to the Company.`
    }
  ];
  const testFWalked = walkPolicyClauses(testFPages).find((item) => /report theft/i.test(item.clause));
  assert.equal(testFWalked?.kind, "duty", "TEST F classifier");
  const testF = analyzePages(testFPages);
  assert.ok(testF.requirements.some((row) => /report theft/i.test(row.requirement)), "TEST F: related notice duty is included");

  const testGPages = [
    {
      page: 1,
      text: `EXCLUSIONS
This insurance does not cover loss caused by war.`
    }
  ];
  const testGWalked = walkPolicyClauses(testGPages).find((item) => /caused by war/i.test(item.clause));
  assert.equal(testGWalked?.kind, "exclusion", "TEST G classifier");
  const testG = analyzePages(testGPages);
  assert.equal(testG.requirements.length, 0, "TEST G: exclusion is not an Emergency / Claim Requirement");

  const testHPages = [
    {
      page: 1,
      text: "In the event of damage, the insured shall immediately obtain qualified professional assistance."
    }
  ];
  const testHKind = classifyPolicyTerm(testHPages[0].text, null);
  assert.equal(testHKind, "duty", "TEST H classifier");
  const testH = analyzePages(testHPages);
  assert.ok(
    testH.requirements.some((row) => /qualified professional assistance/i.test(row.requirement)),
    "TEST H: generic professional-assistance duty is included"
  );

  const testIPages = [
    {
      page: 1,
      text: "Upon request, the insured shall produce records and submit to examination under oath."
    }
  ];
  const testIKind = classifyPolicyTerm(testIPages[0].text, null);
  assert.equal(testIKind, "duty", "TEST I classifier");
  const testI = analyzePages(testIPages);
  const cooperation = reqBlob(testI);
  assert.match(cooperation, /examination under oath|produce records/i, "TEST I: cooperation duty is included");

  console.log("EMERGENCY REQUIREMENTS REGRESSION OK", {
    A: "grant excluded",
    B: "event duty included",
    C: "claim deadline included",
    D: "condition excluded",
    E: "limitation excluded",
    F: "notice duty included",
    G: "exclusion excluded",
    H: "professional duty included",
    I: "cooperation duty included"
  });
}

main();
