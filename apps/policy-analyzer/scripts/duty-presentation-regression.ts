import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { looksLikeRawClaimDutySummary } from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord, PolicyRecord } from "../lib/types";

function docFromPages(pages: Array<{ page: number; text: string }>, filename: string): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: filename,
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: filename,
    page_count: pages.length,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: "Unknown Document",
    pages
  };
}

function analyzePages(pages: Array<{ page: number; text: string }>, filename: string) {
  const doc = docFromPages(pages, filename);
  return analyzeDocuments(newId(), doc.session_id, [doc]);
}

function visible(report: PolicyRecord): string {
  return report.requirements.map((row) => `${row.trigger}. ${row.requirement}`).join("\n");
}

function main() {
  const testA = analyzePages(
    [
      {
        page: 1,
        text: `CONDITIONS
In the event of damage, the insured shall immediately retain a licensed professional, arrange an inspection if total loss occurs, and immediately notify the Company.
The insured shall: (a) upon damage immediately obtain qualified professional assistance; (b) upon total loss obtain an inspection; (c) immediately notify the Company.`
      }
    ],
    "duty-presentation-a.pdf"
  );
  assert.ok(testA.requirements.some((row) => /professional assistance/i.test(`${row.trigger} ${row.requirement}`)));
  assert.ok(testA.requirements.some((row) => /inspect/i.test(`${row.trigger} ${row.requirement}`)));
  assert.ok(testA.requirements.some((row) => /notify|notice/i.test(`${row.trigger} ${row.requirement}`)));
  for (const row of testA.requirements) {
    assert.equal(looksLikeRawClaimDutySummary(row.requirement, row.source_text), false, row.requirement);
    assert.ok(row.requirement.length < 220, row.requirement);
    assert.ok(row.source_text && row.source_text.length >= 12);
  }
  assert.doesNotMatch(visible(testA), /the insured shall: \(a\).{20,}\(b\).{20,}\(c\)/i);
  console.log("TEST A OK");

  const testB = analyzePages(
    [
      {
        page: 1,
        text: `CONDITIONS
Submit sworn proof of loss within 45 days.`
      }
    ],
    "duty-presentation-b.pdf"
  );
  const proof = testB.requirements.find((row) => /proof of loss/i.test(`${row.trigger} ${row.requirement}`));
  assert.ok(proof);
  assert.match(proof.requirement, /within 45 days/i);
  assert.equal(looksLikeRawClaimDutySummary(proof.requirement, proof.source_text), false);
  console.log("TEST B OK");

  const testC = analyzePages(
    [
      {
        page: 1,
        text: `CONDITIONS
Immediately notify the contact shown in the Schedule.`
      }
    ],
    "duty-presentation-c.pdf"
  );
  const notice = testC.requirements.find((row) => /notify|notice/i.test(`${row.trigger} ${row.requirement}`));
  assert.ok(notice);
  assert.match(notice.requirement, /schedule/i);
  assert.match(notice.requirement, /not uploaded|missing/i);
  assert.doesNotMatch(notice.requirement, /\bJane\b|\bJohn\b|\b555-|\b@/);
  console.log("TEST C OK");

  const testD = analyzePages(
    [
      {
        page: 1,
        text: `CONDITIONS
The insured shall report the theft to police; follow their recommendations; do not pay ransom.`
      }
    ],
    "duty-presentation-d.pdf"
  );
  const police = testD.requirements.find((row) => /police/i.test(row.trigger));
  const follow = testD.requirements.find((row) => /recommend/i.test(row.trigger));
  const ransom = testD.requirements.find((row) => /ransom/i.test(row.trigger));
  assert.ok(police && follow && ransom);
  assert.notEqual(police.requirement, follow.requirement);
  assert.notEqual(follow.requirement, ransom.requirement);
  assert.notEqual(police.requirement, ransom.requirement);
  for (const row of [police, follow, ransom]) {
    assert.equal(looksLikeRawClaimDutySummary(row.requirement, row.source_text), false);
    assert.ok(row.source_text && /police|ransom|recommend/i.test(row.source_text));
  }
  console.log("TEST D OK");

  const testE = analyzePages(
    [
      {
        page: 1,
        text: `CONDITIONS
The insured shall: (a) maintain the property in sound condition; (b) after loss immediately contact a qualified professional.`
      }
    ],
    "duty-presentation-e.pdf"
  );
  assert.ok(testE.requirements.some((row) => /professional/i.test(`${row.trigger} ${row.requirement}`)));
  assert.equal(testE.requirements.filter((row) => /maintain the property/i.test(row.requirement)).length, 0);
  assert.doesNotMatch(visible(testE), /maintain the property in sound condition/i);
  console.log("TEST E OK");

  const testFSource =
    "Upon request, the insured shall produce records, documents, and receipts for examination and submit to examination under oath.";
  const testF = analyzePages([{ page: 1, text: `CONDITIONS\n${testFSource}` }], "duty-presentation-f.pdf");
  const euo = testF.requirements.find((row) => /examination under oath/i.test(row.trigger));
  const records = testF.requirements.find((row) => /record production/i.test(row.trigger));
  assert.ok(euo && records);
  assert.ok(euo.requirement.length < 220);
  assert.ok(records.requirement.length < 220);
  assert.ok(euo.source_text.includes("examination under oath"));
  assert.ok(/records/i.test(records.source_text));
  assert.notEqual(euo.requirement.toLowerCase(), testFSource.toLowerCase());
  assert.doesNotMatch(euo.trigger, /claim duty/i);
  console.log("TEST F OK");

  console.log("DUTY PRESENTATION REGRESSION OK", {
    A: "multiple duties same source",
    B: "deadline retained",
    C: "recipient retained",
    D: "same-source different families",
    E: "general condition suppressed",
    F: "raw evidence retained"
  });
}

main();
