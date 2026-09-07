import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { buildSourceReferenceIndex, looksLikeRawExclusionExplanation } from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord, ExclusionRecord } from "../lib/types";
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

function docFromPages(
  pages: Array<{ page: number; text: string }>,
  filename = "native-exclusion.pdf"
): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: filename,
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "live-exclusion-parity",
    page_count: pages.length,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: classifyPackage(pages),
    pages
  };
}

function findExclusion(rows: ExclusionRecord[], needle: RegExp): ExclusionRecord {
  const hit = rows.find((row) => needle.test(`${row.exclusion_type} ${row.description}`));
  assert.ok(hit, `missing exclusion ${needle}`);
  return hit;
}

function attachedBlob(row: ExclusionRecord, kind?: string): string {
  return (row.attachments || [])
    .filter((item) => (kind ? item.kind === kind : true))
    .map((item) => `${item.kind} ${item.explanation} ${item.source_text}`)
    .join("\n");
}

function main() {
  const doc = docFromPages(LIVE_NATIVE_EXCLUSION_PAGES);
  const report = analyzeDocuments(newId(), doc.session_id, [doc]);
  const rows = report.exclusions;

  for (const category of REQUIRED_CATEGORIES) {
    assert.ok(
      rows.some((row) => category.needle.test(`${row.exclusion_type} ${row.description}`)),
      `missing category ${category.label}`
    );
  }

  const stated = rows.filter((row) => /^stated exclusion$/i.test(row.exclusion_type));
  assert.equal(stated.length, 0, `customer-facing "Stated exclusion" labels: ${stated.map((row) => row.description).join(" | ")}`);

  const intentional = rows.filter((row) => /intentional destruction/i.test(row.exclusion_type));
  assert.equal(intentional.length, 1, "intentional destruction must be one primary exclusion item");
  assert.ok(
    /exception|approved|humane/i.test(`${intentional[0].description} ${attachedBlob(intentional[0], "exception")}`),
    "intentional destruction must keep attached exceptions"
  );
  assert.ok(
    /necropsy|post-?mortem/i.test(`${intentional[0].description} ${attachedBlob(intentional[0])}`),
    "necropsy continuation must attach to intentional destruction"
  );
  assert.equal(
    rows.filter((row) => /necropsy|post-?mortem/i.test(row.exclusion_type) || /^stated exclusion$/i.test(row.exclusion_type)).length,
    0,
    "necropsy continuation must not be an independent exclusion"
  );

  const medication = rows.filter((row) => /medication|substance/i.test(row.exclusion_type) && !/malicious/i.test(row.exclusion_type));
  assert.equal(medication.length, 1, "medication/substance must be one exclusion item");
  assert.ok(
    /supplement/i.test(`${medication[0].description} ${attachedBlob(medication[0], "exception")}`),
    "nutritional supplement carve-back must attach as an exception"
  );
  const contagious = findExclusion(rows, /contagious|communicable/i);
  assert.doesNotMatch(
    `${contagious.description} ${attachedBlob(contagious)}`,
    /surgical operation|nutritional supplement|chemical substance|licensed veterinarian/i
  );
  const surgical = findExclusion(rows, /surgical operation/i);
  assert.ok(/veterinar|stated exception/i.test(`${surgical.description} ${attachedBlob(surgical)}`));
  assert.doesNotMatch(`${surgical.description} ${attachedBlob(surgical)}`, /nutritional supplement/i);
  for (const row of rows) {
    if (/medication|substance/i.test(row.exclusion_type) && !/malicious/i.test(row.exclusion_type)) continue;
    assert.doesNotMatch(`${row.description} ${attachedBlob(row)}`, /nutritional supplement/i, `${row.exclusion_type} inherited supplement`);
  }
  assert.equal(
    rows.filter((row) => /supplement/i.test(row.exclusion_type)).length,
    0,
    "nutritional supplement language must not be an independent exclusion"
  );

  const consequential = findExclusion(rows, /consequential loss/i);
  assert.ok(
    /theft/i.test(`${consequential.description} ${attachedBlob(consequential, "exception")}`),
    "consequential loss must preserve the death-following-theft exception"
  );

  assert.ok(
    rows.every((row) => !looksLikeRawExclusionExplanation(row.description, row.condition || row.exact_source_excerpt)),
    "raw source paragraphs must not be used as explanations"
  );
  assert.ok(
    rows.every((row) => /the policy excludes/i.test(row.description)),
    "customer explanations must use exclusion wording"
  );
  assert.ok(
    rows.every((row) => row.source_page > 0 && row.source_document_id),
    "all exclusion items need page evidence"
  );

  assert.equal(findExclusion(rows, /contagious|communicable/i).source_page, 4);
  assert.equal(findExclusion(rows, /surgical operation/i).source_page, 4);
  assert.equal(medication[0].source_page, 4);
  assert.equal(findExclusion(rows, /malicious|willful/i).source_page, 4);
  assert.equal(findExclusion(rows, /proper care/i).source_page, 4);
  assert.equal(findExclusion(rows, /nuclear/i).source_page, 4);
  assert.equal(findExclusion(rows, /confiscation/i).source_page, 4);
  assert.equal(findExclusion(rows, /war|military force/i).source_page, 4);
  assert.equal(findExclusion(rows, /mysterious disappearance|escape/i).source_page, 4);
  assert.equal(findExclusion(rows, /voluntary parting/i).source_page, 4);
  assert.equal(consequential.source_page, 4);
  const intentionalPages = intentional[0].source_pages || [intentional[0].source_page];
  assert.ok(intentionalPages.includes(3), "intentional destruction cites page 3");

  assert.ok(
    rows.some((row) => /nuclear/i.test(row.exclusion_type)) &&
      rows.some((row) => /confiscation/i.test(row.exclusion_type)) &&
      rows.some((row) => /war/i.test(row.exclusion_type)),
    "multi-cause clause must not collapse into the first cause"
  );

  const theftWaiting = rows.filter((row) => /thirty|30\s+days|not been recovered/i.test(`${row.exclusion_type} ${row.description}`));
  const embryo = rows.filter((row) => /embryo|foal/i.test(`${row.exclusion_type} ${row.description}`));
  assert.equal(theftWaiting.length, 0, "30-day theft remains a limitation/condition");
  assert.equal(embryo.length, 0, "embryo/foal remains a limitation/condition");

  const index = buildSourceReferenceIndex(report);
  const exclusionsRef = index.find((item) => /^exclusions$/i.test(item.label));
  assert.ok(exclusionsRef, "Source References must keep grouped Exclusions");
  assert.ok(
    exclusionsRef.pages.includes(3) && exclusionsRef.pages.includes(4),
    `Exclusions locator should span 3-4, got ${exclusionsRef.page_label}`
  );

  const categoryCount = REQUIRED_CATEGORIES.filter((category) =>
    rows.some((row) => category.needle.test(`${row.exclusion_type} ${row.description}`))
  ).length;

  console.log("LIVE EXCLUSION PARITY REGRESSION OK", {
    category_count: categoryCount,
    stated_exclusion: stated.length,
    exclusions: rows.map((row) => row.exclusion_type),
    intentional_pages: intentionalPages,
    medication_exception: attachedBlob(medication[0], "exception")
  });
}

main();
