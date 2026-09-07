import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { looksLikeRawExclusionExplanation } from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord } from "../lib/types";

function docFromPages(pages: Array<{ page: number; text: string }>, filename = "exclusion-structure.pdf"): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: filename,
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: "exclusion-structure",
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

function main() {
  const testA = analyzePages([
    {
      page: 1,
      text: `EXCLUSIONS
We do not cover loss caused by flood, except when caused by fire following flood.`
    }
  ]);
  const flood = testA.exclusions.filter((row) => /flood/i.test(row.exclusion_type));
  assert.equal(flood.length, 1, "TEST A: one Flood exclusion");
  assert.equal(testA.exclusions.length, 1, "TEST A: exception is not a second exclusion");
  assert.ok(
    flood[0].attachments?.some((item) => item.kind === "exception" && /fire/i.test(`${item.explanation} ${item.source_text}`)),
    "TEST A: fire-following-flood carve-back attached"
  );
  console.log("TEST A OK");

  const testB = analyzePages([
    {
      page: 1,
      text: `EXCLUSIONS
We do not cover intentional destruction, except when approved by us, provided that a licensed professional certifies the necessity.`
    }
  ]);
  const destruction = testB.exclusions.filter((row) => /intentional destruction/i.test(row.exclusion_type));
  assert.equal(destruction.length, 1, "TEST B: one exclusion");
  assert.ok(
    destruction[0].attachments?.some((item) => item.kind === "exception"),
    "TEST B: exception attached"
  );
  assert.ok(
    destruction[0].attachments?.some((item) => item.kind === "qualification" && /certif/i.test(`${item.explanation} ${item.source_text}`)),
    "TEST B: provided-that qualification attached"
  );
  console.log("TEST B OK");

  const testC = analyzePages([
    {
      page: 1,
      text: `EXCLUSIONS
We do not cover loss caused by confiscation, war, or nuclear reaction.`
    }
  ]);
  assert.ok(testC.exclusions.some((row) => /confiscation/i.test(row.exclusion_type)), "TEST C: confiscation");
  assert.ok(testC.exclusions.some((row) => /war/i.test(row.exclusion_type)), "TEST C: war");
  assert.ok(testC.exclusions.some((row) => /nuclear/i.test(row.exclusion_type)), "TEST C: nuclear");
  assert.ok(testC.exclusions.length >= 3, "TEST C: preserve three material concepts");
  console.log("TEST C OK");

  const testD = analyzePages([
    {
      page: 1,
      text: `EXCLUSIONS
However, this exclusion shall not apply to ordinary nutritional supplements used according to label directions.`
    }
  ]);
  assert.equal(testD.exclusions.length, 0, "TEST D: exception is not a standalone exclusion");
  console.log("TEST D OK");

  const testE = analyzePages([
    {
      page: 1,
      text: `EXCLUSIONS
As used herein, "chemical substance" means any substance introduced into the body other than food or water.`
    }
  ]);
  assert.equal(testE.exclusions.length, 0, "TEST E: definition is not a standalone exclusion");
  console.log("TEST E OK");

  const testF = analyzePages([
    {
      page: 3,
      text: `EXCLUSIONS
1. We do not cover intentional destruction of an insured horse, except when approved by us.`
    },
    {
      page: 4,
      text: `However, this exclusion shall not apply when a licensed veterinarian certifies the necessity. 2. We do not cover loss caused by flood.`
    }
  ]);
  const intentional = testF.exclusions.filter((row) => /intentional destruction/i.test(row.exclusion_type));
  const floodF = testF.exclusions.filter((row) => /flood/i.test(row.exclusion_type));
  assert.equal(intentional.length, 1, "TEST F: continuation stays with parent");
  assert.equal(floodF.length, 1, "TEST F: new numbered exclusion starts at the structural boundary");
  assert.ok(
    intentional[0].attachments?.some((item) => /however|certif|veterinar|approved/i.test(`${item.kind} ${item.explanation} ${item.source_text}`)),
    "TEST F: page-4 continuation attached to parent"
  );
  assert.ok(
    (intentional[0].source_pages || [intentional[0].source_page]).includes(3),
    "TEST F: parent keeps page 3"
  );
  console.log("TEST F OK");

  const testG = analyzePages([
    {
      page: 1,
      text: `EXCLUSIONS
The policy excludes loss caused by war.`
    }
  ]);
  const war = testG.exclusions.find((row) => /war/i.test(row.exclusion_type));
  assert.ok(war, "TEST G: war exclusion present");
  assert.match(war.description, /the policy excludes/i);
  assert.match(war.description, /exclud/i);
  assert.doesNotMatch(war.description, /not established|not found|coverage was not found/i);
  assert.equal(looksLikeRawExclusionExplanation(war.description, war.condition), false);
  console.log("TEST G OK");

  console.log("EXCLUSION STRUCTURE REGRESSION OK", {
    A: "exclusion + exception",
    B: "provided-that qualification",
    C: "multiple causes one paragraph",
    D: "exception not standalone",
    E: "definition not standalone",
    F: "page continuation",
    G: "EXCLUDED vs NOT FOUND wording"
  });
}

main();
