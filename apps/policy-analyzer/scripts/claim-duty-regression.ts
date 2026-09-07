import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { segmentLogicalForms } from "../lib/form-segmentation";
import {
  isInsurerPerformanceLanguage,
  isValuationOrAuctionNotice,
  parseSectionHeadingLine,
  walkPolicyClauses
} from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord, PolicyRecord, RequirementRecord } from "../lib/types";
import { CONTROL2_MULTI_FORM_PACKAGE_PAGES } from "./fixtures/control2-multi-form-package-pages";
import { LIVE_NATIVE_DUTY_PAGES } from "./fixtures/live-native-duty-pages";
import { LIVE_NATIVE_EXCLUSION_PAGES } from "./fixtures/live-native-exclusion-pages";
import { NATIVE_POLICY_REPORT_PAGES } from "./fixtures/native-policy-report-pages";

const here = dirname(fileURLToPath(import.meta.url));

const CONTROL2_DUTY_CONCEPTS: Array<{ label: string; needle: RegExp }> = [
  { label: "law-enforcement if a law may have been broken", needle: /law may have been broken/i },
  { label: "immediate general notice", needle: /^immediate notice\b/i },
  { label: "veterinary care", needle: /immediate veterinary care/i },
  { label: "postmortem", needle: /postmortem \/ necropsy/i },
  { label: "inspection", needle: /^inspection\b/i },
  { label: "60-day proof of loss", needle: /proof of loss/i },
  { label: "cooperation", needle: /claim cooperation/i },
  { label: "remains disposal", needle: /remains disposal/i },
  { label: "immediate theft notice", needle: /theft \/ disappearance notice/i },
  { label: "24-hour police theft report", needle: /within 24 hours/i },
  { label: "no ransom", needle: /no ransom/i }
];

const DIAMOND_DUTY_CONCEPTS: Array<{ label: string; needle: RegExp }> = [
  { label: "veterinary", needle: /immediate veterinary care/i },
  { label: "necropsy", needle: /postmortem \/ necropsy/i },
  { label: "illness/injury/death notice", needle: /telephone notice|immediate notice/i },
  { label: "theft notice", needle: /theft \/ disappearance notice/i },
  { label: "police", needle: /police \/ law-enforcement reporting/i },
  { label: "follow recommendations", needle: /follow law-enforcement recommendations/i },
  { label: "no ransom", needle: /no ransom/i },
  { label: "proof of loss", needle: /proof of loss/i },
  { label: "EUO", needle: /examination under oath/i },
  { label: "records", needle: /record production/i }
];

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

function blob(row: RequirementRecord): string {
  return `${row.trigger} ${row.requirement}`;
}

function sourceBlob(row: RequirementRecord): string {
  return `${row.trigger} ${row.requirement} ${row.source_text || ""}`;
}

function matching(report: PolicyRecord, needle: RegExp): RequirementRecord[] {
  return report.requirements.filter((row) => needle.test(blob(row)));
}

function findOne(report: PolicyRecord, needle: RegExp, label: string): RequirementRecord {
  const hits = matching(report, needle);
  assert.equal(
    hits.length,
    1,
    `${label}: expected 1, got ${hits.length} (${report.requirements.map((row) => row.trigger).join(" | ")})`
  );
  return hits[0];
}

function facing(report: PolicyRecord): string {
  return report.requirements.map((row) => `${row.trigger}. ${row.requirement}`).join("\n");
}

function sevenDayGeneralNotice(report: PolicyRecord): RequirementRecord[] {
  return report.requirements.filter((row) => {
    const text = sourceBlob(row);
    if (!/\b7\b|\bseven\b/i.test(text)) return false;
    if (!/notice|notify/i.test(text)) return false;
    if (/auction|highest bid|claiming race|limit of insurance.{0,80}reduc/i.test(text)) return false;
    return true;
  });
}

function duplicateDutyCount(report: PolicyRecord): number {
  const keys = report.requirements.map((row) =>
    `${row.trigger}|${row.requirement.replace(/\s+/g, " ").trim().toLowerCase()}`
  );
  return keys.length - new Set(keys).size;
}

function main() {
  const productionSources = [
    readFileSync(join(here, "../lib/policy-semantics.ts"), "utf8"),
    readFileSync(join(here, "../lib/analyze.ts"), "utf8"),
    readFileSync(join(here, "../lib/coverage-applicability.ts"), "utf8")
  ].join("\n");
  assert.doesNotMatch(productionSources, /Chartis|\bAIG\b|77659|J\.1\.[a-h]|V\.C\.3/);

  assert.equal(parseSectionHeadingLine("DUTIES IN THE EVENT OF LOSS")?.section, "duties");
  assert.equal(parseSectionHeadingLine("J. DUTIES IN THE EVENT OF ACCIDENT, ILLNESS, INJURY, DEATH, OR THEFT")?.section, "duties");
  assert.equal(parseSectionHeadingLine("C. DUTIES IN THE EVENT OF THEFT")?.section, "duties");
  assert.equal(parseSectionHeadingLine("WHAT YOU MUST DO")?.section, "duties");
  assert.equal(parseSectionHeadingLine("LOSS CONDITIONS")?.section, "duties");
  assert.equal(parseSectionHeadingLine("K. SOLE OWNER", "duties")?.section, "conditions");
  assert.equal(parseSectionHeadingLine("A. DEATH OR HUMANE DESTRUCTION")?.section, undefined);
  assert.equal(isInsurerPerformanceLanguage("Once we have received the sworn proof of loss, we shall pay for a covered claim."), true);
  assert.equal(
    isValuationOrAuctionNotice(
      "Entered into a public auction, but not sold, then you shall notify us within seven (7) days of the auction and the limit of insurance shall be reduced to the highest bid."
    ),
    true
  );

  const lettered = analyzePages(
    [
      {
        page: 1,
        text: `EQUINE MORTALITY INSURANCE POLICY
I. COVERAGES
We shall indemnify you in the event of the death of any horse.
CONDITIONS
J. DUTIES IN THE EVENT OF LOSS
1. You must see to the following in the event of accident, illness, injury, death, or theft of a horse:
a. Immediately notify the appropriate law enforcement agency if a law may have been broken.
b. Give us or our authorized representative immediate notice of the accident, illness, injury, death, or theft, including a description of the horse involved.
c. Employ a veterinarian, at your expense, to treat the horse.
d. In case of the horse's death, have a postmortem examination done, at your expense.
e. Allow us to inspect and examine the horse and any relevant records.
f. Send us: i. The death certificate; and ii. The postmortem examination report; and iii. A signed sworn proof of loss. You must provide us with this statement within sixty (60) days of the death, humane destruction, or theft.
g. Cooperate with us in the investigation and/or settlement of the claim.
h. You shall be responsible for the disposal of any horse's remains, at your expense and with our approval.
2. Once we have received the sworn proof of loss, we shall pay for a covered claim, provided you have complied with all terms of this Policy.
K. SOLE OWNER
It is a condition precedent of this Policy that you are the sole owner of each covered horse.
C. DUTIES IN THE EVENT OF THEFT
Coverage B. Theft or Unlawful Removal shall apply provided that:
1. Prior to the inception date of this Policy no thefts were made against you.
2. You notify us immediately if theft or unlawful removal occurs. Our obligation to indemnify you for theft shall begin ninety (90) days from the date you advise us.
3. The theft or unlawful removal of any horse is reported immediately but no later than twenty-four (24) hours to the appropriate law enforcement agencies. You must comply with their instructions or recommendations, but in no case must you:
a. Pay or promise to pay ransom; or
b. Give any third party assurances of your intent to pay.
M. RACING OR AUCTION OF HORSES
If a horse is entered into a public auction, but not sold, then you shall notify us within seven (7) days of the auction and our Limit of Insurance shall be automatically reduced to the highest bid at the auction.`
      }
    ],
    "lettered-duties.pdf"
  );
  assert.equal(lettered.requirements.length, 11, `generic lettered duties expected 11, got ${lettered.requirements.map((row) => row.trigger).join(" | ")}`);
  for (const concept of CONTROL2_DUTY_CONCEPTS) {
    findOne(lettered, concept.needle, `generic ${concept.label}`);
  }
  assert.equal(sevenDayGeneralNotice(lettered).length, 0, "auction seven-day notice is not a general claim duty");
  assert.equal(
    lettered.requirements.filter((row) => /sole owner|heading|duties in the event/i.test(`${row.trigger} ${row.requirement}`)).length,
    0,
    "headings and ownership conditions are not duties"
  );
  const genericNotice = findOne(lettered, /immediate notice/i, "generic immediate notice");
  assert.doesNotMatch(blob(genericNotice), /\b7\b|\bseven\b/i);
  assert.match(blob(genericNotice), /immediate notice/i);
  const genericProof = findOne(lettered, /proof of loss/i, "generic proof");
  assert.match(`${genericProof.requirement} ${genericProof.source_text}`, /60|sixty/i);
  assert.doesNotMatch(genericProof.source_text || "", /once we have received|we shall pay/i);
  assert.equal(matching(lettered, /ransom/i).length, 1, "no-ransom stays one duty");
  assert.equal(duplicateDutyCount(lettered), 0);

  const walkedLettered = walkPolicyClauses([
    {
      page: 1,
      text: `J. DUTIES IN THE EVENT OF LOSS
1. You must see to the following:
a. Immediately notify the appropriate law enforcement agency if a law may have been broken.
b. Give us immediate notice of the accident, illness, injury, death, or theft.`
    }
  ]);
  const letteredDuties = walkedLettered.filter((item) => item.kind === "duty");
  assert.ok(letteredDuties.some((item) => item.letteredItem === "a" && /law may have been broken/i.test(item.clause)));
  assert.ok(letteredDuties.some((item) => item.letteredItem === "b" && /immediate notice/i.test(item.clause)));
  assert.equal(
    letteredDuties.filter((item) => /law may have been broken/i.test(item.clause) && /immediate notice of the accident/i.test(item.clause)).length,
    0,
    "sibling lettered duties must not swallow each other"
  );

  const repeated = analyzePages(
    [
      {
        page: 1,
        text: `CONDITIONS
DUTIES IN THE EVENT OF LOSS
In the event of injury, the insured shall immediately notify the Company.
In the event of injury, the insured shall immediately notify the Company.`
      }
    ],
    "duplicate-notice.pdf"
  );
  assert.equal(matching(repeated, /notify|notice/i).length, 1, "repeated wording must not duplicate the same duty");

  const unresolvedOptional = analyzePages(
    [
      {
        page: 1,
        text: `Page 1 of 1
10021 (1/20)
EQUINE MORTALITY INSURANCE POLICY
DECLARATIONS PAGE
POLICY NUMBER:
ITEM 1. NAMED INSURED & MAILING ADDRESS:
ITEM 3. SCHEDULE OF COVERED HORSES
Horse No. Name of Horse Coverage Description Limit Premium`
      },
      {
        page: 2,
        text: `10022 (1/20) Page 1 of 1
EQUINE MORTALITY INSURANCE POLICY
I. COVERAGES
We shall indemnify you in the event of the death of any horse.
DUTIES IN THE EVENT OF LOSS
In the event of accident, illness, injury, death, or theft, you must give us immediate notice, including a description of the horse involved.`
      },
      {
        page: 3,
        text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
10029 (1/20) Page 1 of 1
AGREED VALUE ENDORSEMENT
This coverage ONLY applies to those horses for which Agreed Value is specifically indicated in the Declarations, Item 3. SCHEDULE OF COVERED HORSES.
In the event of a covered loss, you must notify us within 7 days.`
      }
    ],
    "unresolved-optional-duty.pdf"
  );
  assert.equal(unresolvedOptional.requirements.length, 1, "unresolved optional 7-day duty must not be promoted");
  findOne(unresolvedOptional, /immediate notice/i, "base immediate notice remains");
  assert.equal(sevenDayGeneralNotice(unresolvedOptional).length, 0);
  assert.equal(
    unresolvedOptional.requirements.filter((row) => row.source_page === 3).length,
    0,
    "no general duty may cite the unresolved optional form"
  );

  const issuedOptional = analyzePages(
    [
      {
        page: 1,
        text: `Declarations
Issued by: Educational Equine Specialty Insurance Company
Policy Number: EQ-POS-0001
Named Insured: Jordan Rivers
ITEM 3. SCHEDULE OF COVERED HORSES
Name of Horse: Thunder
Coverage Description: Agreed Value
Limit of Insurance: $12,000
Premium: $450
Agreed Value: $12,000
Forms:
EQ-A-1 Ed. 01/2024
EQ-AV-1 Ed. 01/2024`
      },
      {
        page: 2,
        text: `Base Policy Form EQ-A-1 Ed. 01/2024
This policy provides Full Mortality coverage for the insured horse.
DUTIES IN THE EVENT OF LOSS
In the event of accident, illness, injury, death, or theft, you must give us immediate notice.`
      },
      {
        page: 3,
        text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
EQ-AV-1 (01/2024) Page 1 of 1
AGREED VALUE ENDORSEMENT
This coverage ONLY applies to those horses for which Agreed Value is specifically indicated in the Declarations, Item 3. SCHEDULE OF COVERED HORSES.
In the event of a covered loss, you must notify us within 7 days.`
      }
    ],
    "issued-optional-duty.pdf"
  );
  assert.ok(
    issuedOptional.requirements.some((row) => /\b7\b|\bseven\b/i.test(sourceBlob(row)) && /notice|notify/i.test(blob(row))),
    "issued optional endorsement duty must be retained"
  );
  assert.ok(issuedOptional.requirements.some((row) => /immediate notice/i.test(blob(row))));

  const ungatedOptional = analyzePages(
    [
      {
        page: 1,
        text: `Declarations
Policy Number: EQ-UNGATED-DUTY
Named Insured: Jordan Rivers
Forms:
EQ-A-1 Ed. 01/2024
EQ-B-1 Ed. 01/2024`
      },
      {
        page: 2,
        text: `Base Policy Form EQ-A-1 Ed. 01/2024
This policy provides Full Mortality coverage for the insured horse.
DUTIES IN THE EVENT OF LOSS
In the event of injury, you must give us immediate notice.`
      },
      {
        page: 3,
        text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
EQ-B-1 Ed. 01/2024
Surgical coverage is added with a $8,000 occurrence limit.
In the event of a covered surgical loss, you must file a sworn proof of loss within 30 days.`
      }
    ],
    "ungated-optional-duty.pdf"
  );
  const ungatedProof = ungatedOptional.requirements.find((row) => /proof of loss/i.test(blob(row)));
  assert.ok(ungatedProof, "ungated issued endorsement proof-of-loss duty is retained");
  assert.match(ungatedProof.requirement, /30 days/i);

  const control = analyzePages(CONTROL2_MULTI_FORM_PACKAGE_PAGES, "contractual-specimen-package.pdf");
  assert.equal(control.documents.length, 1, "Control #2 remains one physical file");
  assert.equal(control.form_inventory.length, 14, "Control #2 logical forms remain 14");
  assert.equal(segmentLogicalForms(CONTROL2_MULTI_FORM_PACKAGE_PAGES).length, 14);
  assert.equal(control.exclusions.length, 13, `Control #2 expected 13 exclusions, got ${control.exclusions.length}`);
  assert.equal(control.requirements.length, 11, `Control #2 expected 11 duties, got ${control.requirements.map((row) => row.trigger).join(" | ")}`);
  assert.equal(duplicateDutyCount(control), 0, "Control #2 must not duplicate duties");

  for (const concept of CONTROL2_DUTY_CONCEPTS) {
    findOne(control, concept.needle, `Control #2 ${concept.label}`);
  }

  const immediate = findOne(control, /immediate notice/i, "Control #2 immediate notice");
  assert.equal(immediate.source_page, 11, "immediate notice must cite the base-policy duty page");
  assert.match(immediate.source_text || "", /immediate notice/i);
  assert.doesNotMatch(blob(immediate), /\b7\b|\bseven\b|auction/i);
  assert.equal(sevenDayGeneralNotice(control).length, 0, "false general 7-day notice must be absent");
  assert.equal(
    control.requirements.filter((row) => row.source_page === 22 || row.source_page === 23).length,
    0,
    "no general duty may cite the unresolved Agreed Value form"
  );

  const proof = findOne(control, /proof of loss/i, "Control #2 proof of loss");
  assert.equal(proof.source_page, 11);
  assert.match(`${proof.requirement} ${proof.source_text}`, /60|sixty/i);
  assert.doesNotMatch(proof.source_text || "", /once we have received|we shall pay/i);
  assert.doesNotMatch(`${proof.trigger} ${proof.requirement} ${proof.source_text}`, /colic|statement of loss that includes/i);

  const theftNotice = findOne(control, /theft \/ disappearance notice|theft or unlawful removal/i, "Control #2 theft notice");
  assert.equal(theftNotice.source_page, 9);
  assert.match(theftNotice.source_text || "", /notify us immediately|immediately if theft/i);

  const policeHits = matching(control, /police|law.?enforcement/i);
  assert.ok(policeHits.some((row) => row.source_page === 9 && /24|twenty-four/i.test(blob(row))), "24-hour theft police report");
  assert.ok(
    policeHits.some((row) => row.source_page === 11 && /law may have been broken/i.test(blob(row))),
    "base-policy law-enforcement duty"
  );

  const ransom = findOne(control, /no ransom/i, "Control #2 no ransom");
  assert.equal(ransom.source_page, 9);
  assert.match(ransom.source_text || "", /ransom|intent to pay/i);

  assert.equal(findOne(control, /immediate veterinary care/i, "Control #2 veterinary").source_page, 11);
  assert.equal(findOne(control, /postmortem \/ necropsy/i, "Control #2 postmortem").source_page, 11);
  assert.equal(findOne(control, /^inspection\b/i, "Control #2 inspection").source_page, 11);
  assert.equal(findOne(control, /claim cooperation/i, "Control #2 cooperation").source_page, 11);
  assert.equal(findOne(control, /remains disposal/i, "Control #2 remains").source_page, 11);

  const controlMedical = control.coverages.find((row) => row.coverage_type === "Major Medical");
  assert.equal(controlMedical?.coverage_status, "NEEDS CLARIFICATION", "optional endorsement applicability remains unresolved");

  const diamondDuties = analyzePages(LIVE_NATIVE_DUTY_PAGES, "diamond-state-duties.pdf");
  assert.equal(diamondDuties.requirements.length, 10, `Diamond State expected 10 duties, got ${diamondDuties.requirements.map((row) => row.trigger).join(" | ")}`);
  for (const concept of DIAMOND_DUTY_CONCEPTS) {
    findOne(diamondDuties, concept.needle, `Diamond State ${concept.label}`);
  }
  assert.equal(duplicateDutyCount(diamondDuties), 0);

  const diamondReport = analyzePages(NATIVE_POLICY_REPORT_PAGES, "native-policy.pdf");
  assert.equal(diamondReport.requirements.length, 10, `Diamond State full report expected 10 duties, got ${diamondReport.requirements.length}`);

  const diamondExclusions = analyzePages(LIVE_NATIVE_EXCLUSION_PAGES, "diamond-state-exclusions.pdf");
  assert.equal(diamondExclusions.exclusions.length, 12, `Diamond State expected 12 exclusions, got ${diamondExclusions.exclusions.length}`);

  console.log("CLAIM DUTY REGRESSION OK", {
    control2_duties: control.requirements.map((row) => row.trigger),
    control2_count: control.requirements.length,
    diamond_count: diamondDuties.requirements.length,
    facing: facing(control)
  });
}

main();
