import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocuments } from "../lib/analyze";
import { classifyPackage } from "../lib/classify";
import { segmentLogicalForms } from "../lib/form-segmentation";
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
import { CONTROL2_MULTI_FORM_PACKAGE_PAGES } from "./fixtures/control2-multi-form-package-pages";
import { NATIVE_POLICY_REPORT_PAGES } from "./fixtures/native-policy-report-pages";

const here = dirname(fileURLToPath(import.meta.url));

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

  const productionSources = [
    readFileSync(join(here, "../lib/policy-semantics.ts"), "utf8"),
    readFileSync(join(here, "../lib/analyze.ts"), "utf8")
  ].join("\n");
  assert.doesNotMatch(productionSources, /Chartis|\bAIG\b|97006|77668|77669/);

  const unresolvedOptionalPages = [
    {
      page: 1,
      text: `Declarations
POLICY NUMBER:
ITEM 1. NAMED INSURED & MAILING ADDRESS:
ITEM 3. SCHEDULE OF COVERED HORSES
Horse No. Name of Horse Coverage Description Limit Premium
Forms:
EQ-A-1 Ed. 01/2024
EQ-MM-1 Ed. 01/2024`
    },
    {
      page: 2,
      text: `Base Policy Form EQ-A-1 Ed. 01/2024
This policy provides Full Mortality coverage for the insured horse.
CONDITIONS
You must give us immediate notice of any accident, illness, injury, or death of a horse.
OTHER INSURANCE
If you have other insurance for that horse, we shall be released from any liability or obligation to indemnify with respect to that horse.`
    },
    {
      page: 3,
      text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
EQ-MM-1 (01/2024) Page 1 of 1
MAJOR MEDICAL COVERAGE ENDORSEMENT
This coverage ONLY applies to those horses for which a specific premium charge for Major Medical Coverage is indicated in the Declarations, Item 3. SCHEDULE OF COVERED HORSES.
In consideration of the premium paid, we agree to reimburse you for medical treatment expenses for a covered horse.
This policy provides Major Medical coverage with a limit of $12,000 per policy period.
You must give us immediate notice of any accident, illness, or injury.
If you have other insurance covering major medical, this insurance shall be excess over such other insurance, whether valid or collectible.`
    }
  ];
  const unresolvedOptional = analyzeDocs([
    docFromPages(unresolvedOptionalPages, "unresolved-optional-source-index.pdf")
  ]);
  const unresolvedIndex = buildSourceReferenceIndex(unresolvedOptional);
  const unresolvedNotice = findRef(unresolvedIndex, /notice requirements/i);
  const unresolvedOther = findRef(unresolvedIndex, /other insurance/i);
  const unresolvedMedical = findRef(unresolvedIndex, /major medical/i);
  assert.ok(unresolvedNotice.pages.includes(2), "unresolved: base notice remains");
  assert.equal(unresolvedNotice.pages.includes(3), false, "unresolved: optional notice stays out of operative index");
  assert.ok(unresolvedOther.pages.includes(2), "unresolved: base other insurance remains");
  assert.equal(unresolvedOther.pages.includes(3), false, "unresolved: optional other insurance stays out of operative index");
  assert.ok(unresolvedMedical.pages.includes(3), "unresolved: optional coverage row still cites its form");
  assert.equal(
    unresolvedOptional.coverages.find((row) => /major medical/i.test(row.coverage_type))?.coverage_status,
    "NEEDS CLARIFICATION"
  );
  assert.ok(
    unresolvedNotice.evidence.every((item) => item.applicability === "established"),
    "unresolved: operative notice citations are established"
  );
  assert.ok(
    unresolvedMedical.evidence.some((item) => item.page === 3 && item.applicability === "unestablished"),
    "unresolved: coverage-row citation retains unestablished applicability"
  );
  assertProfessionalIndex(unresolvedIndex, "unresolved optional source index");
  console.log("TEST UNRESOLVED OPTIONAL SOURCE INDEX OK");

  const issuedOptional = analyzeDocs([
    docFromPages(
      [
        {
          page: 1,
          text: `Declarations
Issued by: Educational Equine Specialty Insurance Company
Policy Number: EQ-POS-0001
Named Insured: Jordan Rivers
Insured Horse Name: Thunder
ITEM 3. SCHEDULE OF COVERED HORSES
Name of Horse: Thunder
Coverage Description: Major Medical
Limit of Insurance: $12,000
Premium: $450
Major Medical: $12,000
Forms:
EQ-A-1 Ed. 01/2024
EQ-MM-1 Ed. 01/2024`
        },
        unresolvedOptionalPages[1],
        unresolvedOptionalPages[2]
      ],
      "issued-optional-source-index.pdf"
    )
  ]);
  const issuedIndex = buildSourceReferenceIndex(issuedOptional);
  const issuedNotice = findRef(issuedIndex, /notice requirements/i);
  const issuedOther = findRef(issuedIndex, /other insurance/i);
  const issuedMedical = findRef(issuedIndex, /major medical/i);
  assert.ok(issuedNotice.pages.includes(2) && issuedNotice.pages.includes(3), "issued: optional notice may enter operative index");
  assert.ok(issuedOther.pages.includes(2) && issuedOther.pages.includes(3), "issued: optional other insurance may enter operative index");
  assert.ok(issuedMedical.pages.includes(3), "issued: optional coverage citation remains");
  assert.equal(
    issuedOptional.coverages.find((row) => /major medical/i.test(row.coverage_type))?.coverage_status,
    "COVERED"
  );
  assert.ok(
    issuedNotice.evidence.some((item) => item.page === 3 && item.applicability === "established"),
    "issued: optional-form notice is established"
  );
  console.log("TEST ISSUED OPTIONAL SOURCE INDEX OK");

  const ungatedOptional = analyzeDocs([
    docFromPages(
      [
        {
          page: 1,
          text: `Declarations
Policy Number: EQ-UNGATED-1
Named Insured: Jordan Rivers
Forms:
EQ-A-1 Ed. 01/2024
EQ-B-1 Ed. 01/2024`
        },
        {
          page: 2,
          text: `Base Policy Form EQ-A-1 Ed. 01/2024
This policy provides Full Mortality coverage for the insured horse.
You must give us immediate notice of any accident, illness, injury, or death of a horse.
OTHER INSURANCE
If you have other insurance for that horse, we shall be released from any liability or obligation to indemnify.`
        },
        {
          page: 3,
          text: `ENDORSEMENT
THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.
EQ-B-1 Ed. 01/2024
Surgical coverage is added with a $8,000 occurrence limit.
You must give us immediate notice of any accident, illness, or injury.
If you have other insurance covering surgical expenses, this insurance shall be excess over such other insurance, whether valid or collectible.`
        }
      ],
      "ungated-optional-source-index.pdf"
    )
  ]);
  const ungatedIndex = buildSourceReferenceIndex(ungatedOptional);
  const ungatedNotice = findRef(ungatedIndex, /notice requirements/i);
  const ungatedOther = findRef(ungatedIndex, /other insurance/i);
  const ungatedSurgical = findRef(ungatedIndex, /surgical/i);
  assert.ok(ungatedNotice.pages.includes(3), "ungated: optional forms are not globally suppressed from notice");
  assert.ok(ungatedOther.pages.includes(3), "ungated: optional forms are not globally suppressed from other insurance");
  assert.ok(ungatedSurgical.pages.includes(3), "ungated: surgical coverage citation remains");
  assert.equal(ungatedOptional.coverages.find((row) => /^surgical$/i.test(row.coverage_type))?.coverage_status, "COVERED");
  console.log("TEST UNGATED OPTIONAL SOURCE INDEX OK");

  const control = analyzeDocs([
    docFromPages(CONTROL2_MULTI_FORM_PACKAGE_PAGES, "contractual-specimen-package.pdf")
  ]);
  assert.equal(control.form_inventory.length, 14, "Control #2 logical forms remain 14");
  assert.equal(segmentLogicalForms(CONTROL2_MULTI_FORM_PACKAGE_PAGES).length, 14);
  assert.equal(control.exclusions.length, 13);
  assert.equal(control.requirements.length, 11);
  assert.equal(control.identification.named_insured, undefined);
  assert.equal(control.identification.policy_number, undefined);
  assert.equal(control.completeness.status, "COMPLETE CONTRACTUAL SPECIMEN FORM SET");
  assert.equal(control.coverages.find((row) => row.coverage_type === "Full Mortality")?.coverage_status, "LIMITED");
  assert.equal(control.coverages.find((row) => row.coverage_type === "Theft")?.coverage_status, "LIMITED");
  assert.equal(control.coverages.find((row) => /syndrome/i.test(row.coverage_type))?.coverage_status, "LIMITED");
  assert.equal(control.coverages.find((row) => row.coverage_type === "Major Medical")?.coverage_status, "NEEDS CLARIFICATION");
  assert.equal(control.coverages.find((row) => row.coverage_type === "Colic Surgery")?.coverage_status, "NEEDS CLARIFICATION");
  assert.equal(control.coverages.find((row) => row.coverage_type === "Surgical")?.coverage_status, "NEEDS CLARIFICATION");
  assert.equal(control.conflicts.length, 0);

  const controlIndex = buildSourceReferenceIndex(control);
  const controlNotice = findRef(controlIndex, /notice requirements/i);
  const controlOther = findRef(controlIndex, /other insurance/i);
  const controlMortality = findRef(controlIndex, /mortality coverage/i);
  const controlTheft = findRef(controlIndex, /theft coverage/i);
  const controlWobbler = findRef(controlIndex, /wobbler/i);
  const controlMedical = findRef(controlIndex, /major medical/i);
  const controlColic = findRef(controlIndex, /colic/i);
  const controlSurgical = findRef(controlIndex, /surgical/i);
  const controlExclusions = findRef(controlIndex, /^exclusions$/i);
  const unresolvedOptionalNoticePages = [14, 29, 33, 35];
  for (const page of unresolvedOptionalNoticePages) {
    assert.equal(
      controlNotice.pages.includes(page),
      false,
      `Control #2 Notice Requirements must not include unresolved optional page ${page}`
    );
  }
  assert.ok(controlNotice.pages.includes(11), "Control #2 base-policy notice remains");
  assert.equal(controlOther.pages.includes(15), false, "Control #2 Other Insurance must not include unresolved optional page 15");
  assert.ok(controlOther.pages.includes(12), "Control #2 base-policy Other Insurance remains");
  assert.ok(controlMortality.pages.includes(5), "Control #2 mortality grant page");
  assert.ok(controlTheft.pages.includes(5), "Control #2 theft grant page");
  assert.ok(controlWobbler.pages.includes(5) || controlWobbler.pages.includes(6), "Control #2 wobbler grant page");
  assert.ok(controlMedical.pages.includes(27), "Control #2 optional major medical citation remains");
  assert.ok(controlColic.pages.includes(14), "Control #2 optional colic citation remains");
  assert.ok(controlSurgical.pages.includes(34) || controlSurgical.pages.includes(35), "Control #2 optional surgical citation remains");
  assert.deepEqual(
    [...controlExclusions.pages].sort((a, b) => a - b),
    [6, 7]
  );
  for (const ref of controlIndex.filter((item) => item.finding_type === "duty" || item.finding_type === "condition")) {
    for (const page of [...unresolvedOptionalNoticePages, 15]) {
      if (ref.finding_type === "condition" && page !== 15) continue;
      if (ref.finding_type === "duty" && page === 15) continue;
      assert.equal(
        ref.pages.includes(page),
        false,
        `${ref.label} must not present unresolved optional page ${page} as an operative source`
      );
    }
  }
  assert.ok(
    controlColic.evidence.some((item) => item.page === 14 && item.applicability === "unestablished"),
    "Control #2 colic coverage-row citation remains unestablished"
  );
  assertProfessionalIndex(controlIndex, "Control #2");
  console.log("TEST CONTROL #2 SOURCE INDEX OK");

  const diamond = analyzeDocs([docFromPages(NATIVE_POLICY_REPORT_PAGES, "native-policy.pdf")]);
  assert.equal(diamond.coverages.find((row) => row.coverage_type === "Full Mortality")?.coverage_status, "LIMITED");
  assert.equal(diamond.coverages.find((row) => row.coverage_type === "Theft")?.coverage_status, "LIMITED");
  assert.equal(diamond.coverages.find((row) => row.coverage_type === "Major Medical")?.coverage_status, "NEEDS CLARIFICATION");
  assert.equal(diamond.coverages.find((row) => row.coverage_type === "Surgical")?.coverage_status, "NEEDS CLARIFICATION");
  assert.equal(diamond.coverages.find((row) => row.coverage_type === "Colic Surgery")?.coverage_status, "NOT FOUND");
  assert.equal(diamond.coverages.find((row) => row.coverage_type === "Loss of Use")?.coverage_status, "NOT FOUND");
  assert.equal(diamond.coverages.find((row) => row.coverage_type === "Stallion Infertility")?.coverage_status, "NOT FOUND");
  assert.equal(diamond.exclusions.length, 12);
  assert.equal(diamond.requirements.length, 10);
  const diamondIndex = buildSourceReferenceIndex(diamond);
  const diamondNotice = findRef(diamondIndex, /notice requirements/i);
  const diamondOther = findRef(diamondIndex, /other insurance/i);
  const diamondExclusions = findRef(diamondIndex, /^exclusions$/i);
  assert.ok(diamondNotice.pages.includes(2), "Diamond State notice remains page 2");
  assert.ok(diamondOther.pages.includes(3), "Diamond State Other Insurance remains page 3");
  assert.equal(diamondExclusions.page_label, "Pages 3-4");
  assertProfessionalIndex(diamondIndex, "Diamond State");
  console.log("TEST DIAMOND STATE SOURCE INDEX OK");

  console.log("SOURCE REFERENCES REGRESSION OK", {
    testA: samePageIndex.map((ref) => ref.label),
    testB: dutyIndex.map((ref) => `${ref.label} ${ref.page_label}`),
    testC: exclusionRef.page_label,
    testD: gappedRef.page_label
  });
}

main();
