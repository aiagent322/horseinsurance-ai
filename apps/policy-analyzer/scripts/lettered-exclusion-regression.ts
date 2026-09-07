import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { segmentLogicalForms } from "../lib/form-segmentation";
import {
  genericExclusionTitle,
  isUmbrellaExclusionOpener,
  parseSectionHeadingLine
} from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord, ExclusionRecord, PolicyRecord } from "../lib/types";
import { CONTROL2_MULTI_FORM_PACKAGE_PAGES } from "./fixtures/control2-multi-form-package-pages";
import { LIVE_NATIVE_EXCLUSION_PAGES } from "./fixtures/live-native-exclusion-pages";

const here = dirname(fileURLToPath(import.meta.url));

const LETTERED_CONCEPTS: Array<{ label: string; needle: RegExp }> = [
  { label: "A dishonest / malicious acts", needle: /dishonest|malicious|fraudulent|intentional act/i },
  { label: "B nuclear / atomic", needle: /nuclear|atomic|fission|radioactive/i },
  { label: "C war / military force", needle: /\bwar\b|military force|insurrection/i },
  { label: "D undeclared use", needle: /purpose|schedule of covered horses|use of any horse/i },
  { label: "E surgical operations", needle: /surgical operation/i },
  { label: "F drugs / medication", needle: /medication|inoculation|\bdrugs?\b/i },
  { label: "G aircraft / hostile animals", needle: /loaded onto|hostility|dislike|hostile animals/i },
  { label: "H governmental slaughter", needle: /slaughter|killing of a horse/i },
  { label: "I mysterious disappearance", needle: /mysterious disappearance|\bescape\b/i },
  { label: "J unauthorized transfer", needle: /unauthorized instructions|transfer horses/i },
  { label: "K undisclosed pre-policy", needle: /prior to the effective date|not disclosed/i },
  { label: "L relinquishment of ownership", needle: /relinquish|ownership rights/i },
  { label: "M west nile / vaccination", needle: /west nile|vaccinat/i }
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

function blob(row: ExclusionRecord, kind?: string): string {
  return [
    row.exclusion_type,
    row.description,
    row.condition,
    row.exact_source_excerpt,
    ...(row.attachments || [])
      .filter((item) => (kind ? item.kind === kind : true))
      .map((item) => `${item.kind} ${item.explanation} ${item.source_text}`)
  ].join("\n");
}

function matching(report: PolicyRecord, needle: RegExp): ExclusionRecord[] {
  return report.exclusions.filter((row) => needle.test(`${row.exclusion_type} ${row.description} ${row.condition || ""}`));
}

function findOne(report: PolicyRecord, needle: RegExp, label: string): ExclusionRecord {
  const hits = matching(report, needle);
  assert.equal(hits.length, 1, `${label}: expected 1, got ${hits.length} (${report.exclusions.map((row) => row.exclusion_type).join(" | ")})`);
  return hits[0];
}

function main() {
  const productionSources = [
    readFileSync(join(here, "../lib/policy-semantics.ts"), "utf8"),
    readFileSync(join(here, "../lib/analyze.ts"), "utf8")
  ].join("\n");
  assert.doesNotMatch(productionSources, /Chartis|\bAIG\b|77659/);

  assert.equal(parseSectionHeadingLine("II EXCLUSIONS")?.section, "exclusions");
  assert.equal(parseSectionHeadingLine("SECTION II — EXCLUSIONS")?.section, "exclusions");
  assert.equal(parseSectionHeadingLine("PART IV. EXCLUSIONS")?.section, "exclusions");
  assert.equal(parseSectionHeadingLine("III. DEFINITIONS")?.section, "definitions");
  assert.equal(parseSectionHeadingLine("I. COVERAGES")?.section, "coverage");
  assert.equal(
    parseSectionHeadingLine("D. EXCLUSIONS"),
    null,
    "a lettered subsection titled Exclusions is not a roman section heading"
  );

  const leadIn =
    "This Policy shall not apply to claims arising out of, resulting from, directly or indirectly caused by, or as a consequence of:";
  assert.equal(isUmbrellaExclusionOpener(leadIn), true);
  assert.equal(genericExclusionTitle(leadIn), null);

  const diamondLead =
    "(3) This insurance does not cover any loss directly or indirectly caused by, happening through, or in consequence of:";
  assert.equal(isUmbrellaExclusionOpener(diamondLead), true);
  assert.equal(genericExclusionTitle(diamondLead), null);

  const generic = analyzePages(
    [
      {
        page: 1,
        text: `SECTION II — EXCLUSIONS
This Policy shall not apply to claims arising out of, resulting from, directly or indirectly caused by, or as a consequence of:
A. Dishonest, fraudulent, or malicious acts by the insured.
This exclusion shall not apply if a criminal conviction is later obtained.
B. Nuclear reaction or radiation.
C. War, including undeclared or civil war;
2. Warlike action by a military force; or`
      },
      {
        page: 2,
        text: `3. Insurrection, rebellion, or usurped power.
D. Use of an insured animal for a purpose not shown on the schedule.
E. Surgical operations.
This exclusion shall not apply:
1. To any surgical operation required only in an emergency attempt to prevent death; or
2. If we are notified in advance and agree to the operation.
F. Administration of drugs or medication unless a veterinarian directs the treatment.
G. Injury while being loaded onto an aircraft with hostile animals.
H. Governmental slaughter or killing of an animal.
This exclusion shall not apply:
1. If we authorize the destruction;
2. To humane destruction; or
3. Where the animal is destroyed aboard an aircraft for safety.
I. Mysterious disappearance or escape.
J. Unauthorized instructions to transfer the animal.
K. An accident or illness not disclosed prior to the effective date.
L. Relinquishment of ownership rights by sale or lease.
M. West Nile Virus, unless you provide written proof of current vaccination.`
      }
    ],
    "lettered-exclusions.pdf"
  );

  assert.equal(generic.exclusions.length, 13, `generic expected 13, got ${generic.exclusions.map((row) => row.exclusion_type).join(" | ")}`);
  assert.equal(
    generic.exclusions.filter((row) => /shall not apply to claims arising out of|loss directly/i.test(row.exclusion_type)).length,
    0,
    "generic lead-in must not become a standalone exclusion"
  );
  for (const concept of LETTERED_CONCEPTS) {
    findOne(generic, concept.needle, `generic ${concept.label}`);
  }

  const genericSurgical = findOne(generic, /surgical operation/i, "generic E");
  const genericMedication = findOne(generic, /medication|\bdrugs?\b/i, "generic F");
  assert.ok(/emergency/i.test(blob(genericSurgical, "exception")), "E keeps the emergency exception");
  assert.ok(/notified|agree/i.test(blob(genericSurgical, "exception")), "E keeps the agreed-operation exception");
  assert.doesNotMatch(blob(genericSurgical), /veterinarian directs|administration of drugs/i);
  assert.ok(/veterinar/i.test(blob(genericMedication)), "F keeps the veterinarian-directed exception");
  assert.doesNotMatch(blob(genericMedication), /emergency attempt to prevent death/i);

  const genericWar = findOne(generic, /\bwar\b|insurrection/i, "generic C");
  const genericWarPages = genericWar.source_pages || [genericWar.source_page];
  assert.ok(genericWarPages.includes(1) && genericWarPages.includes(2), `C must span the page boundary, got ${genericWarPages.join(",")}`);
  assert.equal(matching(generic, /\bwar\b|insurrection/i).length, 1, "page-boundary continuation must not duplicate C");

  const genericSlaughter = findOne(generic, /slaughter|killing of an animal/i, "generic H");
  assert.ok(/authorize|humane destruction|aircraft/i.test(blob(genericSlaughter, "exception")));
  findOne(generic, /mysterious disappearance|\bescape\b/i, "generic I not swallowed by H");

  const genericWestNile = findOne(generic, /west nile|vaccinat/i, "generic M");
  assert.ok(/vaccin/i.test(blob(genericWestNile)));

  const control = analyzePages(CONTROL2_MULTI_FORM_PACKAGE_PAGES, "contractual-specimen-package.pdf");
  assert.equal(control.documents.length, 1, "Control #2 remains one physical file");
  assert.equal(control.form_inventory.length, 14, "Control #2 logical forms remain 14");
  assert.equal(segmentLogicalForms(CONTROL2_MULTI_FORM_PACKAGE_PAGES).length, 14);
  assert.equal(control.exclusions.length, 13, `Control #2 expected 13, got ${control.exclusions.map((row) => row.exclusion_type).join(" | ")}`);
  assert.equal(
    control.exclusions.filter((row) => /shall not apply to claims arising out of|loss directly/i.test(row.exclusion_type)).length,
    0,
    "Control #2 lead-in must not become a standalone exclusion"
  );
  assert.equal(
    control.exclusions.filter((row) => /^stated exclusion$/i.test(row.exclusion_type)).length,
    0,
    "lettered children must receive real titles"
  );

  const seenTypes = new Set<string>();
  for (const row of control.exclusions) {
    assert.equal(seenTypes.has(row.exclusion_type), false, `duplicate exclusion type ${row.exclusion_type}`);
    seenTypes.add(row.exclusion_type);
    const pages = row.source_pages || [row.source_page];
    assert.ok(
      pages.every((page) => page === 6 || page === 7),
      `${row.exclusion_type} source pages ${pages.join(",")} must stay on 6-7`
    );
  }

  for (const concept of LETTERED_CONCEPTS) {
    findOne(control, concept.needle, `Control #2 ${concept.label}`);
  }

  const controlA = findOne(control, /dishonest|malicious|fraudulent/i, "Control #2 A");
  assert.ok(/convict/i.test(blob(controlA, "exception")), "A keeps the criminal-conviction exception");

  const controlE = findOne(control, /surgical operation/i, "Control #2 E");
  const controlF = findOne(control, /medication|inoculation/i, "Control #2 F");
  assert.ok(/emergency/i.test(blob(controlE, "exception")), "E keeps the emergency surgical exception");
  assert.ok(/notified|agree/i.test(blob(controlE, "exception")), "E keeps the agreed surgical exception");
  assert.doesNotMatch(blob(controlE), /inoculation|administration of drugs/i);
  assert.ok(/veterinar/i.test(blob(controlF, "exception")), "F keeps the veterinarian-directed exception");
  assert.doesNotMatch(blob(controlF), /emergency attempt to prevent death/i);

  const controlH = findOne(control, /slaughter|killing of a horse/i, "Control #2 H");
  assert.ok(/authorize/i.test(blob(controlH, "exception")));
  assert.ok(/humane destruction/i.test(blob(controlH, "exception")));
  findOne(control, /mysterious disappearance|\bescape\b/i, "Control #2 I not swallowed by H");

  const controlC = findOne(control, /\bwar\b|military force|insurrection/i, "Control #2 C");
  const controlCPages = controlC.source_pages || [controlC.source_page];
  assert.ok(controlCPages.includes(6) && controlCPages.includes(7), `Control #2 C pages ${controlCPages.join(",")}`);

  const controlM = findOne(control, /west nile|vaccinat/i, "Control #2 M");
  assert.ok(/vaccin/i.test(blob(controlM)));

  const controlMedical = control.coverages.find((row) => row.coverage_type === "Major Medical");
  assert.equal(controlMedical?.coverage_status, "NEEDS CLARIFICATION", "optional endorsement applicability remains unresolved");

  const diamond = analyzePages(LIVE_NATIVE_EXCLUSION_PAGES, "diamond-state-exclusions.pdf");
  assert.equal(diamond.exclusions.length, 12, `Diamond State expected 12, got ${diamond.exclusions.map((row) => row.exclusion_type).join(" | ")}`);
  assert.equal(
    diamond.exclusions.filter((row) => /loss directly/i.test(row.exclusion_type)).length,
    0,
    "Diamond State Loss Directly must stay 0"
  );
  assert.equal(
    diamond.exclusions.filter((row) => /medication|substance/i.test(row.exclusion_type) && !/malicious/i.test(row.exclusion_type))
      .length,
    1,
    "Diamond State Medication / Substance must remain separate"
  );

  console.log("LETTERED EXCLUSION REGRESSION OK", {
    generic: generic.exclusions.map((row) => row.exclusion_type),
    control2: control.exclusions.map((row) => row.exclusion_type),
    diamond: diamond.exclusions.map((row) => row.exclusion_type)
  });
}

main();
