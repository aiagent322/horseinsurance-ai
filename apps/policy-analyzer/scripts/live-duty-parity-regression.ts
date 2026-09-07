import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import {
  allDutyFamilies,
  buildSourceReferenceIndex,
  classifyPolicyTerm,
  walkPolicyClauses
} from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";
import { LIVE_NATIVE_DUTY_PAGES } from "./fixtures/live-native-duty-pages";

function docFromPages(
  pages: Array<{ page: number; text: string }>,
  filename = "native-duty.pdf"
): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: filename,
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "live-duty-parity",
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

function reqText(report: ReturnType<typeof analyzeDocuments>): string {
  return report.requirements.map((row) => `${row.trigger} ${row.requirement}`).join("\n");
}

function hasConcept(report: ReturnType<typeof analyzeDocuments>, needle: RegExp): boolean {
  return report.requirements.some((row) => needle.test(`${row.trigger} ${row.requirement}`));
}

function assertPageCited(report: ReturnType<typeof analyzeDocuments>, needle: RegExp): void {
  const hit = report.requirements.find((row) => needle.test(`${row.trigger} ${row.requirement}`));
  assert.ok(hit, `missing duty matching ${needle}`);
  assert.ok(hit.source_page > 0, `${needle} missing page`);
  assert.ok(hit.source_document_id, `${needle} missing document id`);
}

function main() {
  const testA = analyzePages([
    {
      page: 1,
      text: `CONDITIONS
In the event of loss, the insured shall immediately notify the Company, protect the property from further damage, and preserve all records.`
    }
  ]);
  assert.ok(hasConcept(testA, /notify|notice/i), "TEST A: notice survives");
  assert.ok(hasConcept(testA, /protect/i), "TEST A: protection survives");
  assert.ok(hasConcept(testA, /record/i), "TEST A: records survive");
  assert.ok(testA.requirements.length >= 2, "TEST A: multiple findings from one sentence");
  console.log("TEST A OK");

  const testBPages = [
    {
      page: 1,
      text: `CONDITIONS
The insured shall: (a) maintain the property in sound condition; (b) upon damage immediately obtain professional assistance; (c) upon total loss obtain an inspection; (d) immediately notify the Company.`
    }
  ];
  const testBWalked = walkPolicyClauses(testBPages);
  assert.ok(
    testBWalked.some((item) => item.kind === "condition" && /maintain the property/i.test(item.clause)),
    "TEST B: (a) remains a general condition"
  );
  const testB = analyzePages(testBPages);
  assert.ok(hasConcept(testB, /professional assistance/i), "TEST B: (b) professional duty");
  assert.ok(hasConcept(testB, /inspection/i), "TEST B: (c) inspection duty");
  assert.ok(hasConcept(testB, /notify/i), "TEST B: (d) notice duty");
  assert.equal(testB.requirements.filter((row) => /maintain the property/i.test(row.requirement)).length, 0);
  console.log("TEST B OK");

  const testC = analyzePages([
    {
      page: 1,
      text: `CONDITIONS
The insured shall report the theft to police; follow their recommendations; do not pay ransom.`
    }
  ]);
  assert.ok(hasConcept(testC, /police/i), "TEST C: police");
  assert.ok(hasConcept(testC, /recommend/i), "TEST C: follow recommendations");
  assert.ok(hasConcept(testC, /ransom/i), "TEST C: no ransom");
  console.log("TEST C OK");

  const testD = analyzePages([
    {
      page: 1,
      text: `CONDITIONS
Submit to examination under oath and produce books, records, invoices, and receipts.`
    }
  ]);
  assert.ok(hasConcept(testD, /examination under oath/i), "TEST D: EUO");
  assert.ok(hasConcept(testD, /record|receipt|invoice/i), "TEST D: records");
  console.log("TEST D OK");

  const testE = analyzePages([
    {
      page: 2,
      text: `CONDITIONS
After an insured loss, the Insured shall render a detailed,`
    },
    {
      page: 3,
      text: `sworn proof of loss within sixty (60) days. Upon request, the Insured shall submit to examinations under oath. The Insured shall produce for examination all books, documents, records, receipts and invoices.`
    }
  ]);
  const proof = testE.requirements.find((row) => /proof of loss/i.test(`${row.trigger} ${row.requirement}`));
  const euo = testE.requirements.find((row) => /examination under oath/i.test(`${row.trigger} ${row.requirement}`));
  const records = testE.requirements.find((row) => /record production|produce for examination|records/i.test(`${row.trigger} ${row.requirement}`));
  assert.ok(proof, "TEST E: proof of loss");
  assert.ok(euo, "TEST E: EUO");
  assert.ok(records, "TEST E: records");
  assert.equal(proof?.source_page, 3, "TEST E: proof continues onto page 3");
  assert.equal(euo?.source_page, 3);
  assert.equal(records?.source_page, 3);
  console.log("TEST E OK");

  const liveDoc = docFromPages(LIVE_NATIVE_DUTY_PAGES, "native-extracted-policy.pdf");
  const live = analyzeDocuments(newId(), liveDoc.session_id, [liveDoc]);
  const blob = reqText(live);
  assert.ok(hasConcept(live, /veterinar/i), "live: veterinary care");
  assert.ok(hasConcept(live, /necropsy|postmortem|post-mortem/i), "live: necropsy");
  assert.ok(hasConcept(live, /telephone notice|immediate notice/i), "live: illness/injury/death notice");
  assert.ok(hasConcept(live, /theft \/ disappearance notice|theft or disappearance/i), "live: theft notice");
  assert.ok(hasConcept(live, /police|law.?enforcement reporting/i), "live: police");
  assert.ok(hasConcept(live, /recommend/i), "live: follow law-enforcement recommendations");
  assert.ok(hasConcept(live, /ransom/i), "live: no ransom");
  assert.ok(hasConcept(live, /proof of loss/i), "live: proof of loss");
  assert.ok(hasConcept(live, /examination under oath/i), "live: EUO");
  assert.ok(hasConcept(live, /record production|produce for examination|records, receipts/i), "live: records");

  assertPageCited(live, /veterinar/i);
  assertPageCited(live, /necropsy|postmortem/i);
  assertPageCited(live, /telephone notice|immediate notice/i);
  assertPageCited(live, /proof of loss/i);
  assertPageCited(live, /examination under oath/i);
  assertPageCited(live, /record production|produce for examination/i);

  const vet = live.requirements.find((row) => /veterinar/i.test(`${row.trigger} ${row.requirement}`));
  const necropsy = live.requirements.find((row) => /necropsy|postmortem/i.test(`${row.trigger} ${row.requirement}`));
  assert.equal(vet?.source_page, 2);
  assert.equal(necropsy?.source_page, 2);
  const proofLive = live.requirements.find((row) => /proof of loss/i.test(`${row.trigger} ${row.requirement}`));
  assert.ok(proofLive && (proofLive.source_page === 2 || proofLive.source_page === 3));

  assert.doesNotMatch(blob, /will indemnify/i);
  assert.doesNotMatch(blob, /territorial limits/i);
  assert.doesNotMatch(blob, /sole owner/i);
  assert.doesNotMatch(blob, /not been recovered|thirty \(30\) days/i);
  assert.doesNotMatch(blob, /this insurance does not cover/i);
  assert.equal(live.requirements.filter((row) => /proper care and attention/i.test(row.requirement)).length, 0);

  const index = buildSourceReferenceIndex(live);
  assert.ok(index.some((item) => /veterinar|necropsy/i.test(item.label) && item.pages.includes(2)));
  assert.ok(index.some((item) => /notice requirements/i.test(item.label) && item.pages.includes(2)));
  assert.ok(index.some((item) => /theft \/ police/i.test(item.label) && item.pages.includes(2)));
  assert.ok(index.some((item) => /proof of loss/i.test(item.label)));
  assert.ok(index.some((item) => /examination under oath|record production/i.test(item.label)));

  const compound = allDutyFamilies(
    "Upon request, submit to examinations under oath and produce books, records, invoices, and receipts."
  );
  assert.ok(compound.includes("examination_under_oath"));
  assert.ok(compound.includes("records"));
  assert.equal(classifyPolicyTerm("The Company will indemnify the Insured upon the death of an insured horse.", null), "grant");

  console.log("LIVE DUTY PARITY REGRESSION OK", {
    A: "multiple actions one sentence",
    B: "lettered subparagraphs",
    C: "semicolon-separated duties",
    D: "EUO + records",
    E: "page continuation",
    live_count: live.requirements.length,
    live_triggers: live.requirements.map((row) => row.trigger)
  });
}

main();
