import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { newId } from "../lib/store";
import type { DocumentRecord, ExclusionRecord, PolicyRecord } from "../lib/types";

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
    classification: classifyPackage(pages),
    pages
  };
}

function analyzePages(pages: Array<{ page: number; text: string }>, filename: string) {
  const doc = docFromPages(pages, filename);
  return analyzeDocuments(newId(), doc.session_id, [doc]);
}

function findExclusion(report: PolicyRecord, needle: RegExp): ExclusionRecord {
  const hit = report.exclusions.find((row) => needle.test(`${row.exclusion_type} ${row.description}`));
  assert.ok(hit, `missing exclusion ${needle}. have: ${report.exclusions.map((row) => row.exclusion_type).join(" | ")}`);
  return hit;
}

function blob(row: ExclusionRecord, kind?: string): string {
  return [
    row.exclusion_type,
    row.description,
    ...(row.attachments || [])
      .filter((item) => (kind ? item.kind === kind : true))
      .map((item) => `${item.kind} ${item.explanation} ${item.source_text}`)
  ].join("\n");
}

function main() {
  const sibling = analyzePages(
    [
      {
        page: 1,
        text: `EXCLUSIONS
(3) We do not cover loss caused by:
(a) mechanical alteration, except when required by emergency;
(b) chemical treatment unless prescribed by a licensed professional.
As used herein, chemical treatment means any compound introduced for non-nutritive purposes.
However, this exclusion shall not apply to ordinary household products used according to label directions.`
      }
    ],
    "ownership-siblings.pdf"
  );
  const mechanical = findExclusion(sibling, /mechanical alteration/i);
  const chemical = findExclusion(sibling, /chemical treatment/i);
  assert.ok(/emergency/i.test(blob(mechanical, "exception")), "TEST A: emergency carve-back belongs to Mechanical Alteration");
  assert.ok(
    /household products/i.test(blob(chemical, "exception")),
    "TEST A: household-products carve-back belongs to Chemical Treatment"
  );
  assert.ok(
    chemical.attachments?.some((item) => item.kind === "definition") || /as used herein|means/i.test(blob(chemical)),
    "TEST A: chemical-treatment definition stays with Chemical Treatment"
  );
  assert.doesNotMatch(blob(mechanical), /household products|chemical treatment means/i);
  assert.equal(
    sibling.exclusions.filter((row) => /^stated exclusion$/i.test(row.exclusion_type)).length,
    0,
    "TEST A: definition/exception are not standalone exclusions"
  );
  console.log("TEST A OK");

  const numbered = analyzePages(
    [
      {
        page: 1,
        text: `EXCLUSIONS
(2) We do not cover loss caused by contamination.
(3) We do not cover loss caused by surgery except when performed by a licensed professional.`
      }
    ],
    "ownership-numbered.pdf"
  );
  const contamination = findExclusion(numbered, /contamination/i);
  const surgery = findExclusion(numbered, /surgery/i);
  assert.doesNotMatch(blob(contamination), /licensed professional|surgery/i);
  assert.ok(/licensed professional/i.test(blob(surgery, "exception")));
  console.log("TEST B OK");

  const continued = analyzePages(
    [
      {
        page: 3,
        text: `EXCLUSIONS
(1) We do not cover intentional destruction except when approved by the insurer.`
      },
      {
        page: 4,
        text: `provided that the insurer must be given an opportunity to inspect the remains.

(2) We do not cover communicable disease.`
      }
    ],
    "ownership-page-continuation.pdf"
  );
  const intentional = findExclusion(continued, /intentional destruction/i);
  const communicable = findExclusion(continued, /communicable disease/i);
  assert.ok(/inspect|opportunit/i.test(blob(intentional)));
  assert.ok((intentional.source_pages || [intentional.source_page]).includes(3));
  assert.ok((intentional.source_pages || [intentional.source_page]).includes(4));
  assert.doesNotMatch(blob(communicable), /inspect|approved by the insurer/i);
  console.log("TEST C OK");

  const multi = analyzePages(
    [
      {
        page: 1,
        text: `EXCLUSIONS
(4) We do not cover:
(a) confiscation;
(b) war;
(c) nuclear reaction.
However, this exclusion shall not apply to a declared peacetime training exercise.`
      }
    ],
    "ownership-multi-siblings.pdf"
  );
  const confiscation = findExclusion(multi, /confiscation/i);
  const war = findExclusion(multi, /war/i);
  const nuclear = findExclusion(multi, /nuclear/i);
  assert.doesNotMatch(blob(confiscation), /peacetime training/i);
  assert.doesNotMatch(blob(war), /peacetime training/i);
  assert.ok(/peacetime training/i.test(blob(nuclear)));
  console.log("TEST D OK");

  const live = analyzePages(
    [
      {
        page: 3,
        text: `PART IV. EXCLUSIONS
(1) This insurance does not cover intentional destruction of an insured horse, except:
(a) destruction approved by the Company;
(b) destruction while the horse is aboard an aircraft and becomes berserk;
(c) humane destruction based on a veterinary determination.

The Company must be given an opportunity`
      },
      {
        page: 4,
        text: `for postmortem or necropsy examination before the remains are disposed of.

(2) This insurance does not cover destruction of an insured horse because of a contagious or communicable disease.

(3) We do not cover loss caused by:
(a) surgical operations, except surgical operations performed by a licensed veterinarian in an attempt to save the life of the horse;
(b) the administration of any medication, drug, or chemical substance. As used herein, "chemical substance" means any substance introduced into the body of the horse other than food or water. However, this exclusion shall not apply to commonly available nutritional supplements used according to product directions.

(4) This insurance does not cover malicious, willful, or intentional acts or omissions of the Insured.

(5) This insurance does not cover failure to provide proper care.

(6) This insurance does not cover loss caused by confiscation, war, civil war, or nuclear reaction or nuclear radiation.

(7) This insurance does not cover mysterious disappearance or escape, or fraudulent voluntary parting with possession or title.

(8) This insurance does not cover consequential loss, except death following theft.`
      }
    ],
    "ownership-live-native.pdf"
  );
  const liveIntentional = findExclusion(live, /intentional destruction/i);
  const liveContagious = findExclusion(live, /contagious|communicable disease/i);
  const liveSurgical = findExclusion(live, /surgical operation/i);
  const liveMedication = findExclusion(live, /medication|substance/i);
  const liveConsequential = findExclusion(live, /consequential loss/i);
  assert.ok(/approved|humane/i.test(blob(liveIntentional, "exception")));
  assert.ok(/necropsy|post-?mortem/i.test(blob(liveIntentional)));
  assert.doesNotMatch(blob(liveIntentional), /nutritional supplement|surgical operations performed/i);
  assert.doesNotMatch(blob(liveContagious), /surgical operation|nutritional supplement|chemical substance|necropsy|post-?mortem/i);
  assert.ok(/licensed veterinarian/i.test(blob(liveSurgical)));
  assert.doesNotMatch(blob(liveSurgical), /nutritional supplement/i);
  assert.ok(/supplement/i.test(blob(liveMedication, "exception")));
  assert.ok(liveMedication.attachments?.some((item) => item.kind === "definition") || /chemical substance/i.test(blob(liveMedication)));
  assert.doesNotMatch(blob(liveMedication), /surgical operations performed/i);
  assert.ok(/theft/i.test(blob(liveConsequential, "exception")));
  assert.doesNotMatch(blob(liveConsequential), /supplement|surgical operation|necropsy/i);
  assert.equal(live.exclusions.filter((row) => /^stated exclusion$/i.test(row.exclusion_type)).length, 0);
  assert.equal(
    live.exclusions.filter((row) => /necropsy|post-?mortem|supplement/i.test(row.exclusion_type)).length,
    0
  );
  console.log("TEST LIVE OK");

  console.log("EXCLUSION OWNERSHIP REGRESSION OK", {
    A: "new sibling closes sibling-specific scope",
    B: "new numbered clause closes prior scope",
    C: "page continuation preserves valid parent",
    D: "carve-back does not propagate to all siblings",
    live: live.exclusions.map((row) => row.exclusion_type)
  });
}

main();
