# Horse Insurance Coverage Checkup™
## Clause Taxonomy & Coverage Relationship Specification — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Implementation Reference
**Scope:** Clause classification and coverage relationship rules only. Does not cover final answer generation, report layout, pricing, frontend design, backend infrastructure, or marketing.

---

## 1. Clause Taxonomy Purpose

Extraction (prior specification) produces raw text tied to source references. On its own, that raw text is not yet answerable — a coverage grant sitting alone tells the system nothing about whether it's been narrowed by an exclusion, conditioned on a claim duty, modified by an endorsement, or left incomplete because a referenced form is missing. Before the system can generate a single consumer-facing answer, it must classify every extracted clause by type and establish how clauses relate to one another.

This matters because equine insurance answers are almost never single-clause answers. "Is emergency colic surgery covered?" is not answered by a coverage grant alone — it depends on whether an endorsement modifies the base grant, whether a sublimit applies, whether a prior-gastrointestinal-history exclusion narrows it, and whether a prior-approval condition affects payability. A system that answers from a single coverage grant in isolation — ignoring exclusions, conditions, endorsements, or the fact that a referenced document is missing — will produce answers that are technically "sourced" but practically misleading.

**Governing rule:** no answer may be generated from a single coverage grant clause if related exclusions, conditions, endorsements, limits, or definitions are present in the uploaded documents — or if such related clauses are expected but missing. The clause taxonomy and relationship model exist specifically to make that governing rule enforceable in structured data, not just as a design intention.

---

## 2. Top-Level Clause Types

| Clause Type | Definition | What It Affects | Example Language Pattern | Required source_ref | Confidence Considerations |
|---|---|---|---|---|---|
| **Declarations data** | Summary-level policy facts (named insured, dates, listed coverages, stated limits) | Establishes what is claimed to be in force; anchors all other clause types | "Named Insured: Jane Doe. Coverage: Full Mortality. Limit: $20,000." | Declarations page location | High if clean; must be cross-checked against policy form/endorsements before treated as complete |
| **Coverage grant** | Language stating what the insurer agrees to pay for | Defines the scope of a coverage category | "We will pay for direct physical loss to the insured horse caused by an accident..." | Policy form/endorsement section | Never sufficient alone; must be evaluated with related exclusions/conditions |
| **Coverage limit** | Maximum dollar amount payable for a coverage category | Quantifies coverage grant | "The Company's limit of liability shall not exceed $20,000." | Declarations or limits section/table | High if a single unambiguous figure; lowered if limit appears more than once with different values |
| **Sublimit** | A cap on a specific sub-category within a broader coverage | Narrows a coverage grant for a specific circumstance | "Colic surgery is subject to a sublimit of $5,000." | Endorsement or limits section | Must be explicitly linked to the coverage category it narrows |
| **Deductible** | Amount subtracted from a covered loss before payment | Reduces payable amount under a coverage grant | "Subject to a $250 deductible per claim." | Declarations or endorsement | Confidence lowered if deductible appears inconsistently across documents |
| **Coinsurance** | Percentage of loss the insured bears after deductible | Reduces payable amount under a coverage grant | "Insured shall bear 20% of any loss exceeding the deductible." | Policy form/endorsement | Must be clearly linked to the specific coverage category it applies to |
| **Waiting period** | Time after policy inception before coverage applies | Delays applicability of a coverage grant | "Colic coverage is not effective until 30 days after the policy effective date." | Policy form/endorsement | Must be checked against declared effective date to determine current applicability |
| **Exclusion** | Language removing or narrowing what would otherwise be covered | Limits a coverage grant | "This policy does not cover loss caused by racing." | Exclusions section/endorsement | Must be linked to the coverage category(ies) it affects; verbatim preservation is critical |
| **Condition** | Requirement the insured must satisfy for coverage to apply or a claim to be considered | Affects claim payability, not existence of coverage itself | "Coverage under this endorsement is conditioned on prior written approval." | Policy form/endorsement | Distinguish from exclusions — a condition is a duty, not a categorical carve-out |
| **Definition** | Policy's own stated meaning of a term | Clarifies scope of any clause using the defined term | "'Illness' means a sickness or disease of the horse that first occurs during the policy period." | Definitions section | Must be linked wherever the defined term is used in a coverage-relevant clause |
| **Endorsement** | A document that adds to, removes, or modifies base policy language | Alters coverage grants, limits, deductibles, exclusions | "This endorsement amends the Policy as follows..." | Endorsement document, with reference to what it amends | Confidence lowered if endorsement references a base section not found in upload |
| **Rider** | Functionally similar to an endorsement; often used interchangeably by carriers | Same as endorsement | "Rider EQ-45: Emergency Colic Surgery Coverage" | Rider document | Same treatment as endorsement |
| **Amendment** | A formal change to policy terms, similar to an endorsement | Alters existing clauses | "Amendment No. 2 revises Section III as follows..." | Amendment document | Same treatment as endorsement; must be sequenced correctly if multiple amendments exist |
| **Claim notice requirement** | Requirement to notify the carrier of a loss within a specified manner/time | Affects claim payability | "Written notice must be given within 5 days of loss." | Conditions section | Must be surfaced whenever a claims-related question is asked |
| **Proof of loss requirement** | Requirement to submit formal documentation of a loss | Affects claim payability | "Proof of loss must be submitted within 90 days." | Conditions section | Same treatment as claim notice requirement |
| **Veterinary documentation requirement** | Requirement for vet records/certificates to support a claim | Affects claim payability | "Claimant must provide complete veterinary records for the 12 months preceding loss." | Conditions section | Must be linked to relevant coverage categories (medical, surgical, mortality) |
| **Prior approval requirement** | Requirement to obtain carrier consent before a procedure | Affects claim payability for the associated procedure | "Prior written approval of the Company is required before elective surgery." | Endorsement/policy form | Must be distinguished from emergency-exception language, if present |
| **Euthanasia requirement** | Conditions under which euthanasia-related loss is payable | Affects mortality/humane destruction coverage | "Euthanasia must be performed by a licensed veterinarian upon prior Company consent, except in emergencies." | Policy form/endorsement | Emergency exception language must be captured alongside the general rule |
| **Humane destruction requirement** | Conditions specific to humane destruction on humane grounds | Affects mortality coverage | "Humane destruction is covered only when certified by a licensed veterinarian as necessary to terminate suffering." | Policy form/endorsement | Must be linked to necropsy requirement, if present |
| **Necropsy requirement** | Requirement for post-mortem examination | Affects claim payability for mortality/humane destruction claims | "A necropsy may be required at the Company's discretion." | Conditions section | Must note whether necropsy is mandatory or discretionary |
| **Territory restriction** | Geographic limitation on coverage | Limits coverage grant | "Coverage applies only within the United States and Canada." | Policy form | Must be linked to all coverage categories it restricts |
| **Use restriction** | Limitation based on how the horse is used | Limits coverage grant | "Coverage excludes loss occurring while the horse is used for racing." | Exclusions/policy form | Must be cross-referenced with declared use on declarations page |
| **Age restriction** | Limitation based on horse's age | Limits coverage grant or eligibility | "This policy does not apply to horses over the age of 20." | Policy form/underwriting section | Must be checked against horse's stated age in schedule |
| **Horse schedule** | List of insured horses with individual attributes | Anchors per-horse coverage data | Table: Horse name, breed, age, insured value, coverage lines | Declarations/schedule table | Each row is its own source_ref; must never merge horses |
| **Insured value schedule** | List of insured values, potentially per horse | Anchors coverage limit basis | Table: Horse name, insured value | Declarations/schedule table | Same per-row treatment as horse schedule |
| **Premium/payment information** | Premium amounts, payment schedule, billing terms | Not coverage-relevant, but useful for cross-checking declarations | "Total Annual Premium: $850" | Declarations/invoice | Excluded from coverage analysis; retained for reference only |
| **Cancellation provision** | Terms under which the policy may be cancelled | Affects whether coverage is currently in force | "This policy may be cancelled by either party with 10 days' written notice." | Policy form | Must be checked against any indication of cancellation in uploaded documents |
| **Renewal provision** | Terms under which the policy renews | Affects whether coverage is currently in force | "This policy will renew annually unless cancelled." | Policy form/renewal notice | Cross-check against renewal notice document type, if uploaded |
| **Signature/acceptance block** | Signature lines, acceptance language | Not coverage-relevant | "Accepted and agreed, [signature]" | Any document | Excluded from coverage analysis; retained for completeness verification only |
| **Unknown clause** | Any clause that does not clearly match a defined type | N/A until resolved | N/A | Wherever found | Must never be force-fit into a known category; flagged for review |

---

## 3. Equine Insurance Coverage Categories

| Coverage Category | Plain-English Meaning | Common Modifying Clause Types | Common Exclusions/Limits | Required Document Support Before "Appears Included" | Confidence Considerations |
|---|---|---|---|---|---|
| **Full mortality** | Pays if the insured horse dies or is humanely destroyed from a covered cause, generally broad ("all-risk" style) | Coverage grant, limit, exclusions, definitions, euthanasia/humane destruction requirements | Pre-existing conditions, intentional acts, certain exclusions by name | Coverage grant found in policy form or endorsement, not declarations alone | Confirmed only if coverage grant + limit + relevant exclusions/conditions are all found |
| **Specified-perils mortality** | Pays only if death results from a named peril listed in the policy | Coverage grant (perils list), limit, exclusions | Anything not on the named-perils list is implicitly excluded | Coverage grant with explicit perils list found | Confidence depends on whether the full perils list was extracted, not just a reference to it |
| **Theft** | Pays if the insured horse is stolen | Coverage grant, limit, conditions (notice/reporting to authorities) | Consent-based transfers, care-custody-control carve-outs | Coverage grant found, not just declarations mention | "Confirmed" requires the grant itself, not only a declarations line item |
| **Humane destruction** | Pays when destruction is necessary on humane grounds (e.g., due to suffering) even absent a "mortality" event in the traditional sense | Coverage grant, veterinary certification requirement, necropsy requirement, prior-approval/emergency-exception language | Requires veterinary certification; may require prior consent absent emergency | Explicit humane destruction clause found | Must flag if only "mortality" is mentioned without a distinct humane destruction clause |
| **Euthanasia** | Overlaps with humane destruction; may be treated as a distinct clause or folded into humane destruction depending on carrier form | Same as humane destruction | Same as humane destruction | Explicit euthanasia clause or clearly folded into humane destruction clause | Must not assume euthanasia is covered merely because mortality coverage exists |
| **Major medical** | Pays for veterinary treatment of illness/injury up to a stated limit | Coverage grant, limit, sublimits, exclusions (routine/preventive care), conditions | Routine/preventive care, pre-existing conditions, elective procedures | Coverage grant found in endorsement/policy form, not declarations line item alone | Frequently listed on declarations without a located endorsement — very common "Likely"/"Not Found" scenario |
| **Surgical** | Pays for surgical procedures, often with its own sublimit distinct from major medical | Coverage grant, sublimit, exclusions, prior-approval condition | Elective/cosmetic procedures, pre-existing conditions | Coverage grant or explicit surgical sublimit found | Must be checked separately from major medical — the two are often distinct clauses with distinct limits |
| **Emergency colic surgery** | Pays specifically for emergency colic surgery, frequently carved out with its own sublimit or waiting period | Coverage grant/endorsement, sublimit, waiting period, prior-gastrointestinal-history exclusion, emergency-exception language | Prior colic/GI history, waiting period not yet satisfied, failure to meet emergency-notice conditions | Explicit colic surgery clause/endorsement found — must not be inferred from general surgical coverage | High-scrutiny category; general "surgical" coverage does not imply colic-specific coverage exists |
| **Colic medical treatment** | Pays for non-surgical colic treatment | Coverage grant, sublimit, exclusions | Prior colic history, routine care carve-outs | Explicit clause found distinguishing medical from surgical colic treatment | Must not be conflated with emergency colic surgery coverage |
| **Diagnostics** | Pays for diagnostic procedures (imaging, bloodwork, etc.) tied to a covered condition | Coverage grant (often bundled within major medical), sublimit | Routine/preventive diagnostics, unrelated conditions | Explicit inclusion within major medical or a standalone clause | Often bundled, not standalone — must check whether it's separately limited |
| **Hospitalization** | Pays for inpatient veterinary hospitalization costs | Coverage grant (often bundled within major medical), sublimit | Non-covered underlying condition | Explicit inclusion found | Same bundling caveat as diagnostics |
| **Medication** | Pays for prescribed medication tied to a covered condition | Coverage grant (often bundled), sublimit | Long-term/maintenance medication, supplements | Explicit inclusion found | Same bundling caveat as diagnostics |
| **Veterinary services** | General umbrella term for professional vet service costs tied to a covered condition | Coverage grant (often bundled), sublimit | Routine care, wellness visits | Explicit inclusion found | Treat as bundled unless a standalone clause exists |
| **Loss of use** *(detection only for MVP)* | Pays when a horse becomes permanently unable to perform its intended use, without death | Coverage grant/endorsement (often a separate, restrictive add-on) | Very restrictive; frequently requires specific certification and waiting periods | Detection only — MVP flags presence/absence but does not fully analyze terms | Always flagged with a note that full analysis is out of MVP scope |
| **Liability** *(detection only for MVP)* | Pays for third-party bodily injury/property damage caused by the horse | Coverage grant (typically a distinct policy or endorsement) | Varies widely | Detection only | Same treatment as loss of use |
| **Care, custody, and control** *(detection only for MVP)* | Covers liability for horses in the insured's care that belong to others | Coverage grant (typically endorsement) | Varies widely | Detection only | Same treatment as loss of use |
| **Breeding/stallion/foal coverage** *(detection only for MVP)* | Covers reproductive-related risks (infertility, foal loss, etc.) | Coverage grant (typically distinct endorsement) | Varies widely, often heavily conditioned | Detection only | Same treatment as loss of use |
| **Unknown coverage** | Any coverage-like clause that doesn't map to a recognized MVP category | N/A | N/A | N/A | Flagged for review; never force-classified |

**MVP note:** "Detection only" categories (loss of use, liability, care/custody/control, breeding) are identified and disclosed in the report as present-or-absent, but the system does not attempt full clause-relationship analysis on them in v1. This scoping must be visible to the consumer so they don't mistake "detected" for "fully analyzed."

---

## 4. Coverage Relationship Model

A coverage grant is the anchor clause type. All other clause types attach to one or more coverage grants via typed relationships, not free-floating association. Required linkage types:

- **Coverage grant → limit** — quantifies maximum payable amount
- **Coverage grant → deductible** — reduces payable amount
- **Coverage grant → exclusion** — narrows or removes coverage
- **Coverage grant → condition** — imposes an obligation affecting payability
- **Coverage grant → definition** — clarifies a term used within the grant
- **Coverage grant → endorsement** — records that the grant has been added, modified, or is otherwise governed by an endorsement
- **Coverage grant → claim notice requirement** — records the notice obligation tied to a claim under this coverage
- **Coverage grant → veterinary documentation requirement** — records documentation needed to support a claim under this coverage
- **Coverage grant → prior approval requirement** — records any pre-authorization obligation
- **Coverage grant → euthanasia/humane destruction requirement** — records conditions specific to death/destruction claims
- **Coverage grant → insured horse schedule** — records which horse(s) the grant applies to
- **Coverage grant → insured value schedule** — records the insured value basis for the grant

**Use of `related_clause_ids`:** every clause object carries a `related_clause_ids` array listing the `clause_id` of every clause it has a defined relationship with. This is a two-way bookkeeping mechanism — a coverage grant's `related_clause_ids` includes its exclusions, and each exclusion's `related_clause_ids` includes the coverage grant(s) it affects. Answer generation (out of scope here) is required to traverse `related_clause_ids` before producing any answer about a coverage grant — it may not answer from the grant clause alone.

---

## 5. Endorsement and Rider Rules

Endorsements, riders, and amendments are treated identically for taxonomy purposes (all classified as modifying documents) but are recorded with explicit modification semantics:

- **Endorsements may add coverage** not present in the base policy form.
- **Endorsements may remove coverage** present in the base form.
- **Endorsements may modify limits** stated elsewhere.
- **Endorsements may modify deductibles** stated elsewhere.
- **Endorsements may create new exclusions** not present in the base form.
- **Endorsements may override base policy language** entirely for a given provision.
- **Endorsements may apply narrowly** — to a single horse, a single coverage type, or a single policy period — and this scope must be captured explicitly (`applies_to_horse_ids`, `applies_to_policy_period`, `applies_to_coverage_categories`), never assumed to apply policy-wide by default.
- **Endorsements may reference forms not included in the upload.** When this occurs, the endorsement's relationship to the missing form must be recorded as `references_missing_form`, and confidence on any clause dependent on that missing form must be lowered accordingly.

**Governing rule:** the system must never silently merge endorsement language into base policy language as if it were a single unified clause. Each remains its own clause object with its own `source_ref`; the *relationship* between them (`modifies_clause_ids` / `modified_by_clause_ids`) is what expresses the connection. This preserves the ability to show the consumer exactly which document changed what.

---

## 6. Exclusion Relationship Rules

Each exclusion is linked to the coverage category/categories it affects. Common equine exclusion categories and their treatment:

| Exclusion Category | Coverage Categories Affected | Surfacing in Final Answer | Confidence Impact |
|---|---|---|---|
| Pre-existing condition | Major medical, surgical, colic, mortality | Always surfaced when the affected coverage is discussed | Lowers to Likely/Unclear if scope of "pre-existing" is not clearly defined in the documents |
| Prior illness / prior injury | Major medical, surgical | Surfaced alongside pre-existing condition exclusion | Same as above |
| Prior colic/GI history | Emergency colic surgery, colic medical treatment | Always surfaced for colic-related questions | High-impact — often the deciding factor in colic coverage answers |
| Routine care / preventive care | Major medical, veterinary services | Always surfaced when general medical coverage is discussed | Lowers confidence if scope of "routine" isn't clearly defined |
| Vaccinations, deworming, dental, farrier | Major medical, veterinary services | Surfaced as specific carve-outs | Straightforward if named explicitly |
| Maintenance care, joint injections | Major medical | Surfaced when discussing ongoing/chronic treatment coverage | Lowers confidence if boundary between "maintenance" and "treatment" is unclear |
| Elective procedures | Surgical, major medical | Surfaced whenever surgical coverage is discussed | Straightforward if named explicitly |
| Alternative therapy, experimental treatment | Major medical | Surfaced when discussing treatment scope | Straightforward if named explicitly |
| Chronic conditions | Major medical | Surfaced alongside pre-existing condition | Lowers confidence if "chronic" isn't defined |
| Racing, breeding, stallion fertility, foal risks | Full mortality, major medical, use restrictions | Surfaced if declared use conflicts with exclusion | Must cross-check against declared horse use |
| Commercial/training/boarding/lesson use | Full mortality, major medical | Surfaced if declared use conflicts with exclusion | Must cross-check against declared horse use |
| Competition use | Full mortality, major medical | Same treatment | Same treatment |
| Transportation | Full mortality, theft | Surfaced if relevant to the loss scenario in question | Straightforward if named explicitly |
| Territory limits | All coverage categories | Surfaced as a policy-wide restriction | Straightforward if named explicitly |
| Intentional acts | All coverage categories | Surfaced as a standard carve-out | Straightforward if named explicitly |
| Neglect | Full mortality, major medical | Surfaced as a standard carve-out | Straightforward if named explicitly |
| Misrepresentation | All coverage categories | Surfaced as a standard carve-out | Straightforward if named explicitly |
| Failure to give notice | All coverage categories (claim-stage) | Surfaced as a claim-duty consequence, not a coverage exclusion per se | Classified primarily under conditions (Section 7), cross-linked here |
| Failure to obtain prior approval | Surgical, colic, major medical | Surfaced as a claim-duty consequence | Same cross-link treatment |
| Failure to provide veterinary records | All medical-related categories | Surfaced as a claim-duty consequence | Same cross-link treatment |

**Confidence downgrade rule:** an answer moves from Confirmed to Likely when an exclusion's scope requires minor interpretation (e.g., cross-referencing a definition). It moves to Unclear when the exclusion's application is ambiguous, conflicts with another clause, or depends on an undefined term.

---

## 7. Conditions and Claim Duties

| Condition/Duty | Classification | Effect |
|---|---|---|
| Immediate notice | Claim notice requirement | Time-sensitive obligation; failure may affect claim payability |
| Written notice | Claim notice requirement | Formality obligation |
| Notice within a stated number of days | Claim notice requirement | Deadline obligation |
| Veterinary examination | Veterinary documentation requirement | Substantiation obligation |
| Veterinary records | Veterinary documentation requirement | Substantiation obligation |
| Proof of loss | Proof of loss requirement | Formal claim-submission obligation |
| Claim form | Proof of loss requirement | Formal claim-submission obligation |
| Invoices | Veterinary documentation requirement | Substantiation obligation |
| Medical records | Veterinary documentation requirement | Substantiation obligation |
| Photographs | Veterinary documentation requirement | Substantiation obligation |
| Death certificate | Necropsy/euthanasia-adjacent requirement | Mortality-claim-specific obligation |
| Necropsy | Necropsy requirement | May be mandatory or carrier-discretionary |
| Carrier consent before euthanasia | Euthanasia requirement | Pre-authorization obligation, subject to emergency exceptions |
| Emergency exception language | Modifies euthanasia/prior-approval requirements | Removes/relaxes the consent obligation under emergency circumstances |
| Duty to protect the horse | General condition | Ongoing obligation, not claim-specific |
| Duty to cooperate | General condition | Claims-process obligation |
| Duty to preserve evidence | General condition | Claims-process obligation |
| Duty to mitigate loss | General condition | Ongoing/claims-process obligation |

**Governing rule:** conditions and claim duties do not mean coverage is absent — they mean a claim's payability may depend on satisfying them. This distinction must be preserved in downstream answers: a missing prior-approval condition doesn't make coverage "Not Found," it means the answer must state that coverage appears to exist *and* that a specific duty applies to whether a claim under it would be paid — without predicting the claim outcome.

---

## 8. Definitions

Policy-specific definitions must be extracted and linked wherever the defined term materially affects a coverage-relevant clause. Priority terms to track:

`Horse` · `Insured horse` · `Named insured` · `Policy period` · `Mortality` · `Theft` · `Humane destruction` · `Euthanasia` · `Accident` · `Injury` · `Illness` · `Disease` · `Surgery` · `Veterinary treatment` · `Pre-existing condition` · `Emergency` · `Reasonable and customary` · `Actual cash value` · `Agreed value` · `Insured value` · `Loss of use` · `Territory` · `Endorsement`

**Linkage rule:** whenever a coverage grant, exclusion, or condition uses one of these terms, and the policy has its own defined meaning for that term, the definition clause must be linked via `related_clause_ids`. If a coverage-relevant clause uses a term like "pre-existing condition" and no definition is found anywhere in the uploaded documents, this absence must itself be flagged — an undefined material term is a confidence-lowering condition, not something the system may interpret using outside/common industry meaning.

---

## 9. Confidence Impact Rules

| Label | When Used |
|---|---|
| **Confirmed** | The declarations page lists the coverage, and supporting endorsement/policy-form language (coverage grant, applicable limit, and any material exclusions/conditions) is found in the uploaded documents, with no unresolved conflicts. |
| **Likely** | The declarations page lists the coverage, but some modifying language (e.g., a referenced endorsement, a specific sublimit) is incomplete, OR the answer requires minor cross-referencing (e.g., connecting a definition to a coverage grant) to reach a conclusion. |
| **Unclear** | Conflicting clauses exist (e.g., two different limits), a relevant page is of low OCR quality, or a material exclusion/condition affecting the answer is ambiguous. |
| **Not Found** | No source language exists anywhere in the uploaded documents addressing the requested coverage or term. |

These four labels apply uniformly across every clause type and coverage category discussed in this specification — they are the single confidence vocabulary used everywhere in the system.

---

## 10. Conflict Detection Rules

Conflicts must be identified and recorded as `conflict_ids` linking the affected clauses, never silently resolved. Examples:

- Declarations page lists a coverage but no supporting endorsement is found
- An endorsement modifies a limit, but the base policy form shows a different, unreconciled limit
- Two different deductible amounts appear in different documents
- The insured horse's name differs between the horse schedule and an endorsement
- Policy dates conflict between documents
- Insured value differs across pages
- Coverage appears included in one section and excluded in another
- An endorsement references a form not found in the upload
- Content from what appears to be multiple distinct policy packages is mixed together

**Governing rule:** when any of these conditions is detected, the system creates a conflict record referencing all involved `source_ref`s and lowers confidence on any answer touching the conflicting clauses. The system does not pick a "more likely correct" value on its own — that resolution, if it happens at all, is the consumer's or carrier's to make, and the report must show the conflict transparently rather than resolving it invisibly.

---

## 11. Missing Relationship Rules

| Scenario | System Behavior |
|---|---|
| Coverage grant found, but exclusions missing | Answer may state the coverage grant exists, but must warn that exclusions could not be located and the answer may be incomplete |
| Coverage grant found, but conditions missing | Answer may state the coverage grant exists, but must warn that claim conditions could not be located |
| Major medical listed on declarations, but no major medical endorsement found | Answer states the coverage appears listed, but its terms and exclusions were not found — confidence: Likely or Not Found depending on how much supporting language exists elsewhere |
| Colic surgery listed, but eligibility conditions (waiting period, prior-history exclusion) missing | Answer states the coverage appears listed, but eligibility conditions could not be confirmed |
| Mortality coverage listed, but no distinct humane destruction clause found | Answer must not assume humane destruction is covered under general mortality language without an explicit clause — flagged as Unclear/Not Found for the humane-destruction-specific question |
| A claim-related question is asked, but the claim notice section is missing entirely | Answer must state that claim notice requirements were not found in the uploaded documents and must not state any deadline as fact |

---

## 12. Clause Priority Rules

For educational-explanation purposes only (not legal interpretation), clauses are considered in this order when constructing an answer:

1. **Declarations and schedules** — establish what is listed as being in force
2. **Endorsements/riders/amendments** — may add to or modify what the base form says
3. **Coverage grant** — describes what may be covered, as modified by step 2
4. **Definitions** — clarify the meaning of terms used in the grant
5. **Limits and deductibles** — quantify the coverage
6. **Exclusions** — remove or narrow what would otherwise be covered
7. **Conditions and claim duties** — affect whether a claim under the coverage is payable
8. **Missing documents** — reduce confidence at any point in the above sequence where supporting material is absent

This ordering exists solely to give the answer-generation stage (out of scope here) a consistent, explainable sequence for presenting information to a consumer — it is not a claims-adjudication methodology and must never be presented to the user as one.

---

## 13. Clause Output JSON Schema

```json
{
  "clause_id": "string",
  "clause_type": "string",
  "coverage_category": "string|null",
  "raw_text": "string",
  "normalized_text": "string",
  "plain_english_summary": "string",
  "source_ref": "object",
  "confidence": "integer",
  "related_clause_ids": ["string"],
  "modifies_clause_ids": ["string"],
  "modified_by_clause_ids": ["string"],
  "applies_to_horse_ids": ["string"],
  "applies_to_policy_period": "string|null",
  "applies_to_coverage_categories": ["string"],
  "flags": ["string"],
  "conflict_ids": ["string"],
  "missing_related_clause_types": ["string"]
}
```

---

## 14. Relationship Output JSON Schema

```json
{
  "relationship_id": "string",
  "relationship_type": "adds_coverage | modifies_coverage | excludes_coverage | limits_coverage | defines_term | sets_deductible | sets_sublimit | imposes_condition | imposes_claim_duty | requires_prior_approval | requires_veterinary_documentation | requires_euthanasia_consent | requires_necropsy | applies_to_horse | applies_to_policy_period | conflicts_with | references_missing_form",
  "source_clause_id": "string",
  "target_clause_id": "string",
  "coverage_category": "string|null",
  "relationship_explanation": "string",
  "confidence": "integer",
  "source_ref": "object",
  "flags": ["string"]
}
```

---

## 15. Consumer-Safe Clause Summaries

Rules governing conversion of raw clause text into plain-English summaries:

- Summaries must preserve the meaning of limiting language (e.g., "unless," "except," "subject to") — never smooth it away for readability.
- Summaries must not overstate coverage — no summary may state coverage exists more broadly than the source language supports.
- Summaries must not guarantee claim payment under any circumstance.
- Summaries must mention relevant exclusions and conditions alongside the coverage they modify, not as a disconnected afterthought.
- Summaries must cite the source (`source_ref`) supporting every substantive statement.
- Summaries must use **"appears to"** phrasing whenever confidence is below Confirmed (e.g., "Your policy appears to include major medical coverage, but we could not confirm the specific exclusions that apply.").
- Summaries must use **"not found"** phrasing when no supporting source exists for the point in question, rather than remaining silent or implying an answer.

---

## 16. Examples

### Example 1 — Mortality coverage grant linked to insured value and humane destruction condition
- **Clauses found:** Coverage grant (Full Mortality), Coverage limit ($20,000), Insured value schedule entry ($20,000), Humane destruction requirement (vet certification + prior consent, emergency exception)
- **Relationships created:** `adds_coverage` (grant→policy form), `limits_coverage` (limit→grant), `applies_to_horse` (grant→horse schedule entry), `requires_euthanasia_consent` (humane destruction requirement→grant)
- **Confidence label:** Confirmed
- **Consumer-safe summary:** "Your policy includes Full Mortality coverage for [horse name], with a stated limit of $20,000. Humane destruction is covered when certified by a licensed veterinarian, and generally requires the insurer's prior consent — except in emergencies, where consent is not required first."
- **Answer engine may say:** that mortality and humane destruction coverage exist, the limit, and the consent condition, all with citations.
- **Answer engine must not say:** that a specific future claim would be paid, or that "any death" is automatically covered without regard to the humane destruction conditions.

### Example 2 — Major medical listed on declarations page and supported by endorsement
- **Clauses found:** Declarations data (Major Medical, $7,500 limit listed), Endorsement (Major Medical Endorsement, full grant + $250 deductible + routine care exclusion)
- **Relationships created:** `adds_coverage` (endorsement→declarations reference), `limits_coverage` (limit→grant), `sets_deductible` (deductible clause→grant), `excludes_coverage` (routine care exclusion→grant)
- **Confidence label:** Confirmed
- **Consumer-safe summary:** "Your policy includes Major Medical coverage up to $7,500, subject to a $250 deductible. Routine and preventive care (such as vaccinations and dental work) are not covered under this section."
- **Answer engine may say:** the limit, deductible, and routine-care carve-out, with citations to both the declarations page and the endorsement.
- **Answer engine must not say:** that all veterinary costs are covered, or that the deductible doesn't apply to specific treatment types not addressed in the documents.

### Example 3 — Emergency colic surgery endorsement with prior gastrointestinal history limitation
- **Clauses found:** Endorsement (Emergency Colic Surgery, $5,000 sublimit), Exclusion (prior colic/GI history), Waiting period (30 days from effective date)
- **Relationships created:** `adds_coverage` (endorsement→base policy), `sets_sublimit` (sublimit→grant), `excludes_coverage` (prior-history exclusion→grant), `imposes_condition` (waiting period→grant)
- **Confidence label:** Confirmed
- **Consumer-safe summary:** "Your policy includes an Emergency Colic Surgery endorsement with a $5,000 sublimit. This coverage excludes any horse with a documented prior history of colic or gastrointestinal issues, and only applies starting 30 days after the policy's effective date."
- **Answer engine may say:** the sublimit, the prior-history exclusion, and the waiting period, with citations.
- **Answer engine must not say:** whether this specific horse's prior history would trigger the exclusion (that's a claims determination, not a document-reading task) — only that the exclusion exists and what it says.

### Example 4 — Declarations page lists surgical coverage but surgical endorsement is missing
- **Clauses found:** Declarations data only ("Surgical Coverage: Included")
- **Relationships created:** `references_missing_form` (declarations line item → no matching endorsement found)
- **Confidence label:** Likely (leaning toward Not Found for specific terms)
- **Consumer-safe summary:** "Your Declarations Page lists Surgical Coverage as included, but we couldn't find the endorsement or policy language that defines what this coverage includes, excludes, or any applicable limit. We recommend confirming this section is complete."
- **Answer engine may say:** that surgical coverage is listed on the declarations page.
- **Answer engine must not say:** any specific limit, deductible, or exclusion for surgical coverage, since no supporting source exists.

### Example 5 — Exclusion for routine care linked to major medical
- **Clauses found:** Coverage grant (Major Medical), Exclusion (routine/preventive care, vaccinations, dental, farrier)
- **Relationships created:** `excludes_coverage` (routine care exclusion→major medical grant)
- **Confidence label:** Confirmed
- **Consumer-safe summary:** "Major Medical coverage does not include routine or preventive care such as vaccinations, dental work, or farrier services."
- **Answer engine may say:** the specific carve-outs named in the exclusion, with citation.
- **Answer engine must not say:** a broader or narrower list of excluded services than what's explicitly named in the source text.

### Example 6 — Conflicting deductible language between declarations page and endorsement
- **Clauses found:** Declarations data (Deductible: $250), Endorsement (Deductible: $500, same coverage category)
- **Relationships created:** `conflicts_with` (declarations deductible clause ↔ endorsement deductible clause)
- **Confidence label:** Unclear
- **Consumer-safe summary:** "We found two different deductible amounts for this coverage: $250 on your Declarations Page and $500 in an endorsement. We can't confirm which applies — you may want to check with your carrier or agent of record."
- **Answer engine may say:** that a conflict exists, citing both source locations.
- **Answer engine must not say:** which figure is "correct" or more likely to apply — that resolution is outside the system's role.

---

## 17. QA Checklist

- [ ] Every clause has a `source_ref`
- [ ] Every coverage-category answer considers all related clauses (limits, deductibles, exclusions, conditions, endorsements) before being finalized, not just the coverage grant
- [ ] Endorsements are linked to the base coverage they modify via `modifies_clause_ids` / `modified_by_clause_ids`
- [ ] Exclusions are linked to the coverage category/categories they affect
- [ ] Limits are linked to the coverage category they quantify
- [ ] Deductibles are linked to the coverage category they reduce
- [ ] Claim duties are linked to the relevant claim scenarios (mortality, medical, surgical, etc.)
- [ ] Conflicts are flagged with `conflict_ids`, not silently resolved
- [ ] Missing related clauses are recorded in `missing_related_clause_types`, not left implicit
- [ ] No unsupported coverage category is created without a corresponding coverage grant clause
- [ ] No claim-payment guarantee or claim-outcome prediction is generated anywhere in a clause summary

---

*End of v1.0 Clause Taxonomy & Coverage Relationship Specification. Next implementation documents: final answer generation rules, report layout/design, and backend/infrastructure architecture.*
