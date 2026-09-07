import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import {
  explainExclusion,
  looksLikePlaceholderExclusionNarrative,
  looksLikeRawExclusionExplanation,
  looksLikeUngrammaticalExclusionNarrative,
  summarizeExclusionSatellite
} from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord, ExclusionRecord, PolicyRecord } from "../lib/types";
import { LIVE_NATIVE_EXCLUSION_PAGES } from "./fixtures/live-native-exclusion-pages";

const REQUIRED_CATEGORIES = [
  { needle: /intentional destruction/i, label: "Intentional Destruction" },
  { needle: /contagious|communicable disease/i, label: "Contagious / Communicable Disease" },
  { needle: /surgical operation/i, label: "Surgical Operations" },
  { needle: /medication|substance/i, label: "Medication / Substance" },
  { needle: /malicious|willful|intentional act/i, label: "Malicious / Willful / Intentional Acts" },
  { needle: /proper care/i, label: "Failure to Provide Proper Care" },
  { needle: /nuclear/i, label: "Nuclear Risk" },
  { needle: /confiscation/i, label: "Confiscation" },
  { needle: /war|military force/i, label: "War / Military Force" },
  { needle: /mysterious disappearance|escape/i, label: "Mysterious Disappearance / Escape" },
  { needle: /fraudulent|voluntary parting/i, label: "Fraudulent Voluntary Parting" },
  { needle: /consequential loss/i, label: "Consequential Loss" }
];

const FORBIDDEN_PLACEHOLDERS = [
  /specified circumstances in which the exclusion may not apply/i,
  /a stated exception in the same provision/i,
  /exception for the Company will not invoke/i,
  /\bstated exclusion\b/i,
  /\bunknown exception\b/i,
  /\brelated exception\b/i
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

function findExclusion(report: PolicyRecord, needle: RegExp): ExclusionRecord {
  const hit = report.exclusions.find((row) => needle.test(`${row.exclusion_type} ${row.description}`));
  assert.ok(hit, `missing exclusion ${needle}. have: ${report.exclusions.map((row) => row.exclusion_type).join(" | ")}`);
  return hit;
}

function facingText(row: ExclusionRecord): string {
  return [
    row.exclusion_type,
    row.description,
    ...(row.attachments || [])
      .filter((item) => item.kind === "exception" || item.kind === "qualification")
      .map((item) => item.explanation)
  ].join("\n");
}

function assertCleanNarrative(label: string, text: string, sourceText?: string): void {
  assert.equal(looksLikePlaceholderExclusionNarrative(text), false, `${label} placeholder: ${text}`);
  assert.equal(looksLikeUngrammaticalExclusionNarrative(text), false, `${label} grammar: ${text}`);
  assert.equal(looksLikeRawExclusionExplanation(text, sourceText), false, `${label} raw dump: ${text}`);
  for (const pattern of FORBIDDEN_PLACEHOLDERS) {
    assert.doesNotMatch(text, pattern, `${label} matched ${pattern}: ${text}`);
  }
  assert.doesNotMatch(text, /\.;|:;|,\./);
  assert.doesNotMatch(text, /exception for the Company will/i);
  assert.doesNotMatch(text, /this insurance does not cover/i);
}

function assertExclusionPresentation(row: ExclusionRecord): void {
  assert.ok(row.exclusion_type && !/^stated exclusion$/i.test(row.exclusion_type), `title: ${row.exclusion_type}`);
  assert.match(row.description, /the policy excludes/i);
  assert.ok(row.description.length < 700, `explanation too long: ${row.description}`);
  assert.ok(row.source_page > 0, `${row.exclusion_type} missing citation`);
  assertCleanNarrative(row.exclusion_type, row.description, row.condition || row.exact_source_excerpt);
  for (const item of row.attachments || []) {
    if (item.kind !== "exception" && item.kind !== "qualification") continue;
    assertCleanNarrative(`${row.exclusion_type} ${item.kind}`, item.explanation, item.source_text);
    assert.notEqual(item.explanation.trim(), item.source_text.replace(/\s+/g, " ").trim());
  }
}

function main() {
  const defenseSource = "the Company will not invoke this exclusion as a defense when destruction is authorized.";
  const defenseSummary = summarizeExclusionSatellite("exception", defenseSource);
  const defenseParent = explainExclusion(
    "Intentional Destruction",
    [{ kind: "exception", explanation: defenseSummary, source_text: defenseSource }],
    "This insurance does not cover intentional destruction of an insured horse, except the Company will not invoke this exclusion as a defense when destruction is authorized."
  );
  assert.match(defenseParent, /the policy excludes/i);
  assert.doesNotMatch(`${defenseParent}\n${defenseSummary}`, /exception for the Company will not invoke/i);
  assert.doesNotMatch(defenseParent, /the Company will not invoke this/i);
  assert.equal(looksLikeUngrammaticalExclusionNarrative(defenseParent), false);
  const testA = analyzePages(
    [
      {
        page: 1,
        text: `EXCLUSIONS
This insurance does not cover intentional destruction of an insured horse, except the Company will not invoke this exclusion as a defense when destruction is authorized.`
      }
    ],
    "presentation-defense.pdf"
  );
  const testARow = findExclusion(testA, /intentional destruction/i);
  assertCleanNarrative("TEST A", facingText(testARow), testARow.condition);
  assert.doesNotMatch(facingText(testARow), /exception for the Company will not invoke/i);
  console.log("TEST A OK");

  const testB = analyzePages(
    [
      {
        page: 1,
        text: `EXCLUSIONS
This insurance does not cover intentional destruction of an insured horse, except humane destruction based on a veterinary determination that destruction is required to terminate incurable and excessive suffering.`
      }
    ],
    "presentation-humane.pdf"
  );
  const testBRow = findExclusion(testB, /intentional destruction/i);
  const testBFacing = facingText(testBRow);
  assert.match(testBFacing, /humane/i);
  assert.doesNotMatch(testBFacing, /specified circumstances in which the exclusion may not apply/i);
  assertCleanNarrative("TEST B", testBFacing, testBRow.condition);
  console.log("TEST B OK");

  const inspectSource = "Provided that the insurer shall be given an opportunity to inspect.";
  const inspectSummary = summarizeExclusionSatellite("qualification", inspectSource);
  assert.match(inspectSummary, /inspect/i);
  assert.doesNotMatch(inspectSummary, /exception/i);
  const testC = analyzePages(
    [
      {
        page: 1,
        text: `EXCLUSIONS
This insurance does not cover loss caused by flood, provided that the insurer shall be given an opportunity to inspect.`
      }
    ],
    "presentation-qualification.pdf"
  );
  const testCRow = findExclusion(testC, /flood/i);
  const testCQualifications = (testCRow.attachments || []).filter((item) => item.kind === "qualification");
  const testCExceptions = (testCRow.attachments || []).filter((item) => item.kind === "exception");
  assert.equal(testCQualifications.length, 1, "TEST C: inspect language is a qualification");
  assert.equal(testCExceptions.length, 0, "TEST C: inspect language must not be labeled as an exception");
  assert.match(testCQualifications[0].explanation, /inspect/i);
  assert.doesNotMatch(testCQualifications[0].explanation, /exception/i);
  console.log("TEST C OK");

  const testD = analyzePages(
    [
      {
        page: 1,
        text: `EXCLUSIONS
We do not cover consequential loss except death following theft.`
      }
    ],
    "presentation-carveback.pdf"
  );
  const testDRow = findExclusion(testD, /consequential loss/i);
  const testDFacing = facingText(testDRow);
  assert.match(testDRow.description, /the policy excludes consequential loss/i);
  assert.match(testDFacing, /death following theft|theft/i);
  assert.match(testDRow.description, /exception/i);
  assert.doesNotMatch(testDFacing, /automatically covered|coverage is guaranteed|this is covered if/i);
  assertCleanNarrative("TEST D", testDFacing, testDRow.condition);
  console.log("TEST D OK");

  const testE = analyzePages(
    [
      {
        page: 1,
        text: `EXCLUSIONS
(1) This insurance does not cover intentional destruction of an insured horse, except:
(a) destruction approved by the Company;
(b) humane destruction based on a veterinary determination.
The Company must be given an opportunity for postmortem or necropsy examination.`
      }
    ],
    "presentation-satellites.pdf"
  );
  const testERow = findExclusion(testE, /intentional destruction/i);
  const testEExceptions = (testERow.attachments || []).filter((item) => item.kind === "exception");
  const testEQualifications = (testERow.attachments || []).filter((item) => item.kind === "qualification");
  assert.equal(testEExceptions.length, 2, `TEST E exceptions: ${testEExceptions.map((item) => item.explanation).join(" | ")}`);
  assert.equal(testEQualifications.length, 1, `TEST E qualifications: ${testEQualifications.map((item) => item.explanation).join(" | ")}`);
  assert.match(testERow.description, /the policy excludes intentional destruction/i);
  assert.ok(testEExceptions.every((item) => item.explanation.trim().length > 12));
  assert.equal(new Set(testEExceptions.map((item) => item.explanation)).size, 2, "TEST E: exception summaries must not repeat");
  assert.match(testEQualifications[0].explanation, /postmortem|necropsy/i);
  assert.doesNotMatch(facingText(testERow), /this exclusion contains an exception for/i);
  assertCleanNarrative("TEST E", facingText(testERow), testERow.condition);
  console.log("TEST E OK");

  const unknownSource = "This insurance does not cover loss caused by solar flare ionization.";
  const unknownFallback = explainExclusion("Solar Flare Ionization", undefined, unknownSource);
  assert.match(unknownFallback, /the policy excludes/i);
  assert.doesNotMatch(unknownFallback, /solar flare ionization\. This insurance does not cover/i);
  assert.notEqual(unknownFallback.replace(/\s+/g, " ").trim(), unknownSource);
  assert.equal(looksLikeUngrammaticalExclusionNarrative(unknownFallback), false);
  const testF = analyzePages(
    [
      {
        page: 1,
        text: `EXCLUSIONS
${unknownSource}`
      }
    ],
    "presentation-unknown.pdf"
  );
  const testFRow = findExclusion(testF, /solar flare/i);
  assert.match(testFRow.description, /the policy excludes/i);
  assert.notEqual(testFRow.description.replace(/\s+/g, " ").trim(), unknownSource);
  assertCleanNarrative("TEST F", facingText(testFRow), testFRow.condition);
  console.log("TEST F OK");

  const testG = analyzePages(LIVE_NATIVE_EXCLUSION_PAGES, "presentation-ownership.pdf");
  const contagious = findExclusion(testG, /contagious|communicable/i);
  const surgical = findExclusion(testG, /surgical operation/i);
  const medication = findExclusion(testG, /medication|substance/i);
  assert.doesNotMatch(facingText(contagious), /surgical operation|nutritional supplement|licensed veterinarian/i);
  assert.match(facingText(surgical), /veterinar|stated exception|exceptions stated/i);
  assert.doesNotMatch(facingText(surgical), /nutritional supplement/i);
  assert.match(facingText(medication), /supplement/i);
  assert.doesNotMatch(facingText(medication), /surgical operations performed/i);
  console.log("TEST G OK");

  const stated = testG.exclusions.filter((row) => /^stated exclusion$/i.test(row.exclusion_type));
  assert.equal(stated.length, 0);
  assert.equal(testG.exclusions.length, 12, `expected 12 exclusions, got ${testG.exclusions.map((row) => row.exclusion_type).join(" | ")}`);
  for (const category of REQUIRED_CATEGORIES) {
    const row = findExclusion(testG, category.needle);
    assertExclusionPresentation(row);
  }

  const intentional = findExclusion(testG, /intentional destruction/i);
  assert.match(intentional.description, /intentional destruction of an insured horse/i);
  assert.ok((intentional.attachments || []).some((item) => item.kind === "exception" && /authoriz|approved/i.test(item.explanation)));
  assert.ok((intentional.attachments || []).some((item) => item.kind === "exception" && /humane/i.test(item.explanation)));
  assert.ok((intentional.attachments || []).some((item) => item.kind === "qualification" && /necropsy|postmortem/i.test(item.explanation)));
  assert.doesNotMatch(facingText(intentional), /will not invoke this particular exclusion as a defense/i);

  assert.match(contagious.description, /contagious or communicable disease/i);
  assert.doesNotMatch(contagious.description, /all losses caused by communicable disease/i);
  assert.equal((contagious.attachments || []).filter((item) => item.kind === "exception").length, 0);

  assert.match(surgical.description, /certain surgical operations/i);
  assert.doesNotMatch(surgical.description, /all surgery is excluded/i);
  assert.ok((surgical.attachments || []).some((item) => item.kind === "exception" && /veterinar/i.test(item.explanation)));

  assert.match(medication.description, /medication or substance/i);
  assert.ok((medication.attachments || []).some((item) => item.kind === "exception" && /supplement/i.test(item.explanation)));

  const malicious = findExclusion(testG, /malicious|willful/i);
  assert.match(malicious.description, /malicious, willful, or intentional acts/i);
  const care = findExclusion(testG, /proper care/i);
  assert.match(care.description, /failure to provide proper care/i);
  const nuclear = findExclusion(testG, /nuclear/i);
  assert.match(nuclear.description, /nuclear/i);
  const confiscation = findExclusion(testG, /confiscation/i);
  assert.match(confiscation.description, /confiscation/i);
  assert.doesNotMatch(confiscation.description, /\bwar\b|nuclear fission/i);
  const war = findExclusion(testG, /war|military force/i);
  assert.match(war.description, /war/i);
  const disappearance = findExclusion(testG, /mysterious disappearance|escape/i);
  assert.match(disappearance.description, /mysterious disappearance or escape/i);
  const parting = findExclusion(testG, /voluntary parting/i);
  assert.match(parting.description, /fraudulent voluntary parting/i);
  const consequential = findExclusion(testG, /consequential loss/i);
  assert.match(consequential.description, /consequential loss/i);
  assert.match(consequential.description, /death following theft/i);
  assert.doesNotMatch(facingText(consequential), /automatically covered|coverage is guaranteed|this is covered if/i);

  const rawParagraphCount = testG.exclusions.filter((row) =>
    looksLikeRawExclusionExplanation(row.description, row.condition || row.exact_source_excerpt)
  ).length;
  const placeholderCount = testG.exclusions.flatMap((row) => [row.description, ...((row.attachments || []).map((item) => item.explanation))]).filter((text) =>
    looksLikePlaceholderExclusionNarrative(text)
  ).length;
  const grammarCount = testG.exclusions.flatMap((row) => [row.description, ...((row.attachments || []).map((item) => item.explanation))]).filter((text) =>
    looksLikeUngrammaticalExclusionNarrative(text)
  ).length;
  assert.equal(rawParagraphCount, 0);
  assert.equal(placeholderCount, 0);
  assert.equal(grammarCount, 0);
  assert.ok(intentional.source_page === 3 || (intentional.source_pages || []).includes(3));
  assert.equal(contagious.source_page, 4);
  assert.equal(surgical.source_page, 4);

  console.log("EXCLUSION PRESENTATION REGRESSION OK", {
    A: "raw fragment synthesis",
    B: "vague placeholder removal",
    C: "qualification vs exception",
    D: "carve-back wording",
    E: "multiple satellites",
    F: "unknown fallback",
    G: "ownership preserved",
    true_exclusion_count: testG.exclusions.length,
    stated_exclusion_count: stated.length,
    raw_paragraph_count: rawParagraphCount,
    generic_placeholder_count: placeholderCount,
    grammar_artifact_count: grammarCount
  });
}

main();
