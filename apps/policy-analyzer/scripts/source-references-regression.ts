import assert from "node:assert/strict";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import {
  buildSourceReferenceIndex,
  collectSourceReferences,
  formatCustomerSourceReference,
  formatPageLocator,
  looksLikeRawPolicyFragment,
  type CustomerSourceReference
} from "../lib/policy-semantics";
import { newId } from "../lib/store";
import type { DocumentRecord, ExclusionRecord, PolicyRecord } from "../lib/types";

function docFromPages(
  pages: Array<{ page: number; text: string }>,
  filename: string,
  classification?: DocumentRecord["classification"]
): DocumentRecord {
  return {
    document_id: newId(),
    session_id: newId(),
    original_filename: filename,
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: `source-ref-${filename}`,
    page_count: pages.length,
    storage_location: "memory",
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: classification || classifyPackage(pages),
    pages
  };
}

function analyzeDocs(docs: DocumentRecord[]) {
  return analyzeDocuments(newId(), docs[0].session_id, docs);
}

function visibleLine(ref: CustomerSourceReference, includeDocument = false): string {
  return formatCustomerSourceReference(ref, { includeDocument });
}

function assertProfessionalIndex(refs: CustomerSourceReference[], label: string) {
  assert.ok(refs.length > 0, `${label}: expected customer-facing references`);
  for (const ref of refs) {
    assert.ok(ref.label.trim().length > 0, `${label}: empty label`);
    assert.ok(ref.label.length < 80, `${label}: label too long: ${ref.label}`);
    assert.equal(looksLikeRawPolicyFragment(ref.label), false, `${label}: raw label ${ref.label}`);
    const visible = visibleLine(ref, true);
    assert.equal(looksLikeRawPolicyFragment(visible), false, `${label}: raw visible ${visible}`);
    assert.doesNotMatch(ref.label, /the company will indemnify|the insured shall|this insurance does not cover/i);
    assert.ok(ref.evidence.length > 0, `${label}: ${ref.label} missing evidence`);
    assert.ok(
      ref.evidence.every((item) => item.source_text.trim().length > 0 && item.page > 0 && item.document_id),
      `${label}: ${ref.label} evidence incomplete`
    );
  }
}

function findRef(refs: CustomerSourceReference[], needle: RegExp): CustomerSourceReference {
  const hit = refs.find((ref) => needle.test(ref.label));
  assert.ok(hit, `missing reference matching ${needle}. have: ${refs.map((ref) => ref.label).join(" | ")}`);
  return hit;
}

function blankRecord(docs: DocumentRecord[], extra: Partial<PolicyRecord> = {}): PolicyRecord {
  return {
    policy_id: newId(),
    session_id: docs[0]?.session_id || newId(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completeness_status: "APPEARS COMPLETE",
    analysis_status: "complete",
    identification: {},
    documents: docs,
    coverages: [],
    exclusions: [],
    financial_limits: [],
    requirements: [],
    endorsements: [],
    conflicts: [],
    form_inventory: [],
    completeness: { status: "APPEARS COMPLETE", warnings: [] },
    agent_questions: [],
    coverage_gaps: [],
    educational_notes: [],
    ...extra
  };
}

function exclusionOn(doc: DocumentRecord, page: number, excerpt: string, type: string): ExclusionRecord {
  return {
    exclusion_id: newId(),
    policy_id: "policy",
    exclusion_type: type,
    description: type,
    source_document_id: doc.document_id,
    source_page: page,
    exact_source_excerpt: excerpt,
    confidence_status: "HIGH"
  };
}

function main() {
  assert.equal(formatPageLocator([3, 4]), "Pages 3-4", "page range helper consecutive");
  assert.equal(formatPageLocator([1, 3]), "Pages 1, 3", "page range helper gap");
  assert.equal(formatPageLocator([1]), "Page 1", "page range helper single");
  assert.equal(formatPageLocator([1, 2, 4]), "Pages 1-2, 4", "page range helper mixed");

  const samePage = analyzeDocs([
    docFromPages(
      [
        {
          page: 1,
          text: `COVERAGE
The Company will indemnify the Insured upon the death of an insured horse resulting from accident or injury or illness or disease.
The Company will indemnify the Insured for theft of an insured horse and death directly resulting from theft.`
        }
      ],
      "same-page-coverages.pdf",
      "Base Policy Form"
    )
  ]);
  const samePageIndex = buildSourceReferenceIndex(samePage);
  const mortality = findRef(samePageIndex, /mortality coverage/i);
  const theft = findRef(samePageIndex, /theft coverage/i);
  assert.ok(mortality.pages.includes(1), "TEST A: mortality page 1");
  assert.ok(theft.pages.includes(1), "TEST A: theft page 1");
  assert.notEqual(mortality.id, theft.id, "TEST A: distinguishable references");
  assert.notEqual(mortality.label.toLowerCase(), theft.label.toLowerCase(), "TEST A: subject identity preserved");
  assertProfessionalIndex(samePageIndex, "TEST A");
  console.log("TEST A OK");

  const relatedDuties = analyzeDocs([
    docFromPages(
      [
        {
          page: 2,
          text: `CONDITIONS
The Insured shall immediately employ a licensed veterinarian at the insured's expense upon illness or injury.
Following death, a postmortem and necropsy shall be performed by a qualified veterinarian.`
        }
      ],
      "related-duties.pdf",
      "Base Policy Form"
    )
  ]);
  const dutyIndex = buildSourceReferenceIndex(relatedDuties);
  const vetRefs = dutyIndex.filter((ref) => /veterinar|necropsy/i.test(ref.label));
  assert.ok(vetRefs.length >= 1 && vetRefs.length <= 2, "TEST B: grouped or two concise duty rows");
  for (const ref of vetRefs) {
    assert.ok(ref.pages.includes(2), "TEST B: page 2");
    assert.equal(looksLikeRawPolicyFragment(ref.label), false, `TEST B: raw duty title ${ref.label}`);
    assert.doesNotMatch(ref.label, /licensed veterinarian|postmortem and necropsy shall/i);
  }
  assertProfessionalIndex(dutyIndex, "TEST B");
  console.log("TEST B OK");

  const consecutiveDoc = docFromPages(
    [
      { page: 3, text: "EXCLUSIONS\nThis insurance does not cover intentional destruction." },
      { page: 4, text: "This insurance does not cover war, civil war, or military force." }
    ],
    "consecutive-exclusions.pdf",
    "Base Policy Form"
  );
  const consecutive = blankRecord([consecutiveDoc], {
    exclusions: [
      exclusionOn(consecutiveDoc, 3, "This insurance does not cover intentional destruction.", "Intentional destruction"),
      exclusionOn(consecutiveDoc, 4, "This insurance does not cover war, civil war, or military force.", "War or military force")
    ]
  });
  const consecutiveIndex = buildSourceReferenceIndex(consecutive);
  const exclusionRef = findRef(consecutiveIndex, /^exclusions$/i);
  assert.deepEqual(exclusionRef.pages, [3, 4], "TEST C: exclusion pages");
  assert.equal(exclusionRef.page_label, "Pages 3-4", "TEST C: consecutive range");
  assert.doesNotMatch(exclusionRef.page_label, /p\.3,\s*p\.4/i);
  assertProfessionalIndex(consecutiveIndex, "TEST C");
  console.log("TEST C OK");

  const gappedDoc = docFromPages(
    [
      { page: 1, text: "EXCLUSIONS\nThis insurance does not cover mysterious disappearance." },
      { page: 3, text: "This insurance does not cover consequential loss." }
    ],
    "gapped-exclusions.pdf",
    "Base Policy Form"
  );
  const gapped = blankRecord([gappedDoc], {
    exclusions: [
      exclusionOn(gappedDoc, 1, "This insurance does not cover mysterious disappearance.", "Mysterious disappearance"),
      exclusionOn(gappedDoc, 3, "This insurance does not cover consequential loss.", "Consequential loss")
    ]
  });
  const gappedIndex = buildSourceReferenceIndex(gapped);
  const gappedRef = findRef(gappedIndex, /^exclusions$/i);
  assert.deepEqual(gappedRef.pages, [1, 3], "TEST D: nonconsecutive pages");
  assert.equal(gappedRef.page_label, "Pages 1, 3", "TEST D: must not invent a 1-3 range");
  assert.notEqual(gappedRef.page_label, "Pages 1-3");
  console.log("TEST D OK");

  const missingField = analyzeDocs([
    docFromPages(
      [
        {
          page: 1,
          text: `DEFINITIONS
NAMED INSURED: The individual, partnership, corporation, or entity as stated in Item B of the Declarations.
The uploaded package does not include the Declarations.`
        }
      ],
      "missing-named-insured.pdf",
      "Base Policy Form"
    )
  ]);
  const missingIndex = buildSourceReferenceIndex(missingField);
  assert.equal(missingField.identification.named_insured, undefined, "TEST E: named insured not extracted");
  assert.equal(
    missingIndex.filter((ref) => /^named insured$/i.test(ref.label)).length,
    0,
    "TEST E: must not present Named Insured as a found locator"
  );
  assert.ok(
    missingIndex.every((ref) => !/^named insured$/i.test(ref.label)),
    "TEST E: no Named Insured found-row"
  );
  console.log("TEST E OK");

  const base = docFromPages(
    [
      {
        page: 1,
        text: `COVERAGE
The Company will indemnify the Insured upon the death of an insured horse resulting from accident or injury or illness or disease.`
      }
    ],
    "base-policy-form.pdf",
    "Base Policy Form"
  );
  const endorsement = docFromPages(
    [
      {
        page: 1,
        text: `This endorsement amends the policy.
Major Medical coverage with a limit of $5,000 is provided.`
      }
    ],
    "endorsement-xyz.pdf",
    "Major Medical Endorsement"
  );
  const multi = analyzeDocs([base, endorsement]);
  const multiIndex = buildSourceReferenceIndex(multi);
  const multiMortality = findRef(multiIndex, /mortality coverage/i);
  const multiMedical = findRef(multiIndex, /major medical/i);
  assert.equal(multiMortality.document_id, base.document_id, "TEST F: mortality from base form");
  assert.equal(multiMedical.document_id, endorsement.document_id, "TEST F: medical from endorsement");
  assert.match(multiMortality.document_label, /base policy form/i);
  assert.match(multiMedical.document_label, /endorsement/i);
  assert.notEqual(multiMortality.document_label, multiMedical.document_label, "TEST F: documents distinguishable");
  assert.ok(visibleLine(multiMortality, true).toLowerCase().includes("base policy form"));
  assert.ok(visibleLine(multiMedical, true).toLowerCase().includes("endorsement"));
  assertProfessionalIndex(multiIndex, "TEST F");
  console.log("TEST F OK");

  const evidenceDoc = analyzeDocs([
    docFromPages(
      [
        {
          page: 1,
          text: `COVERAGE
The Company will indemnify the Insured upon the death of an insured horse resulting from accident or injury or illness or disease.`
        }
      ],
      "evidence-link.pdf",
      "Base Policy Form"
    )
  ]);
  const evidenceIndex = buildSourceReferenceIndex(evidenceDoc);
  const evidenceMortality = findRef(evidenceIndex, /mortality coverage/i);
  assert.ok(
    evidenceMortality.evidence.some((item) => /will indemnify/i.test(item.source_text)),
    "TEST G: underlying source_text retained"
  );
  const rawEvidence = collectSourceReferences(evidenceDoc);
  assert.ok(
    rawEvidence.some((item) => item.label === "Full Mortality" && /will indemnify/i.test(item.text)),
    "TEST G: evidence collector still has source text"
  );
  console.log("TEST G OK");

  const longClause =
    "The Company will indemnify the Insured upon the death of an insured horse resulting from accident or injury occurring during the Policy Period, or illness or disease first manifesting during the Policy Period, subject nevertheless to the terms, conditions, and exclusions of this Policy.";
  const noRaw = analyzeDocs([
    docFromPages([{ page: 1, text: `COVERAGE\n${longClause}` }], "no-raw-display.pdf", "Base Policy Form")
  ]);
  const noRawIndex = buildSourceReferenceIndex(noRaw);
  const noRawMortality = findRef(noRawIndex, /mortality coverage/i);
  const noRawVisible = visibleLine(noRawMortality);
  assert.match(noRawVisible, /mortality coverage/i, "TEST H: concise label");
  assert.match(noRawVisible, /page 1/i, "TEST H: locator");
  assert.doesNotMatch(noRawVisible, /will indemnify/i, "TEST H: visible row is not the clause");
  assert.doesNotMatch(noRawVisible, /subject nevertheless/i);
  assert.ok(noRawMortality.evidence.some((item) => item.source_text.includes("will indemnify")));
  assert.equal(looksLikeRawPolicyFragment(noRawVisible), false);
  console.log("TEST H OK");

  console.log("SOURCE REFERENCES REGRESSION OK", {
    testA: samePageIndex.map((ref) => ref.label),
    testB: dutyIndex.map((ref) => `${ref.label} ${ref.page_label}`),
    testC: exclusionRef.page_label,
    testD: gappedRef.page_label
  });
}

main();
