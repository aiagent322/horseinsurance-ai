# Horse Insurance Coverage Checkup™
## Direct Answer Generation Rules Specification — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Implementation Reference
**Scope:** Direct answer generation rules only. Does not cover final report layout, pricing, frontend design, backend infrastructure, or marketing.

---

## 1. Answer Engine Purpose

The answer engine is the final consumer-facing layer of the system. It takes classified, source-cited clauses and their coverage relationships (as defined in the extraction and clause taxonomy specifications) and converts them into direct, plain-English answers to consumer questions.

The answer engine does not read documents itself and does not have independent knowledge of the policy — it can only work with what has already been extracted, source-mapped, classified into clause types, and linked through coverage relationships. If a clause was not captured upstream, or a relationship was not established, the answer engine has no way to know it exists, and must behave exactly as if it doesn't.

Every answer the engine produces must be built from: the uploaded document sources (`source_ref`s), the related clauses connected to the relevant coverage grant (limits, deductibles, exclusions, conditions, endorsements, definitions), the confidence label warranted by that evidence, any missing-document warnings, and any conflict flags. The engine's job is threefold, in strict priority order:

1. **Answer directly when the evidence supports it** — a consumer should never be given vague hedging when the documents clearly say something.
2. **Refuse to guess when the evidence does not support it** — the engine must never fill a gap with general insurance knowledge, industry convention, or inference from a similar clause elsewhere.
3. **Surface uncertainty clearly** — when evidence is partial, conflicting, or low-quality, the answer must say so plainly rather than rounding up to a more confident-sounding conclusion.

---

## 2. Non-Negotiable Answer Rules

The following rules apply to every answer the system generates, with no exceptions:

- **No source, no answer.** If a claim cannot be tied to a specific `source_ref`, it is not made.
- **No invented coverage.** The system never states a coverage exists unless a coverage grant clause was extracted and classified.
- **No invented limits.** The system never states a specific dollar limit unless that figure was extracted from a source document.
- **No invented deductibles.** Same rule as limits.
- **No invented deadlines.** The system never states a claim notice or proof-of-loss deadline unless that specific figure appears in the uploaded documents.
- **No claim-payment guarantees.** The system never states or implies that a specific claim will or will not be paid.
- **No legal conclusions.** The system never characterizes contract enforceability, bad faith, or legal remedies.
- **No carrier recommendations.** The system never names, ranks, or suggests any insurance carrier.
- **No agent referrals.** The system never suggests contacting a specific agent or broker, or suggests agent involvement as a product feature.
- **No Confirmed label if a relevant supporting form is missing.** If a coverage grant depends on an endorsement, exclusion schedule, or other referenced document that was not found in the upload, the answer cannot be Confirmed.
- **No Confirmed label if relevant clauses conflict.** Any unresolved conflict touching the answer caps confidence below Confirmed.
- **No answer may ignore exclusions, conditions, endorsements, or missing documents.** Every answer must actively check for and incorporate these, not merely default to citing the coverage grant.
- **No answer may rely only on a declarations page for a full coverage conclusion.** A declarations-page listing alone supports, at most, an "Appears Listed" status — never a full Included/Confirmed determination.
- **No answer may treat detection-only categories as fully analyzed.** Loss of use, liability, care/custody/control, and breeding-related categories are detection-only in MVP (see Section 10) and must never be given a full Confirmed coverage analysis regardless of how much source text is found.

---

## 3. Required Answer Structure

Every consumer-facing answer must include the following components, in order:

1. **Question** — the consumer's question as asked (or a normalized version, paired with the original)
2. **Direct answer** — a plain-English answer, one to three sentences
3. **Coverage status** — one of the standardized values in Section 7
4. **Confidence label** — one of: Confirmed / Likely / Unclear / Not Found
5. **Source references** — every `source_ref` supporting the answer
6. **Policy language summary** — plain-English summary of the relevant clause(s), source-cited
7. **Limits or deductibles found** — any relevant figures, with citations
8. **Relevant exclusions or conditions found** — with citations
9. **Missing documents or uncertainty** — explicit statement of any gaps affecting the answer
10. **What the answer does not determine** — an explicit boundary statement (e.g., "This does not determine whether a specific claim would be paid")

No answer may omit any of these ten components. If a component is not applicable (e.g., no limits found), the field is still present and states that explicitly (e.g., "No limit was found in the uploaded documents for this coverage").

---

## 4. Confidence Label Rules

Only four confidence labels exist, and each has strict, non-overlapping eligibility criteria:

**Confirmed** — used only when:
- The uploaded documents contain clear source support for the coverage/term/limit/exclusion/condition in question, AND
- All required related clauses (per the clause taxonomy relationship model) are present — e.g., a coverage grant plus its limit, plus any material exclusions/conditions that would affect the answer, AND
- No material conflicts exist among the relevant clauses, AND
- The coverage/term is within an MVP-supported category (not detection-only).

**Likely** — used when:
- The declarations page or a schedule lists the coverage, but the supporting endorsement, exclusion detail, or condition detail is incomplete or was not found, OR
- The answer requires connecting two clearly-stated provisions (e.g., a definition plus a coverage grant) without any conflict or ambiguity, but the connection isn't as directly stated as a Confirmed answer would require.

**Unclear** — used when:
- Documents conflict on a material point, OR
- Relevant page(s) have poor OCR quality, OR
- Page order is broken or a duplicate/missing page affects the relevant content, OR
- A relevant referenced form is missing, OR
- Policy language itself is ambiguous or uses an undefined material term.

**Not Found** — used when:
- No source language exists anywhere in the uploaded documents addressing the requested coverage, term, limit, deductible, exclusion, condition, or claim duty.

**Governing constraints, stated explicitly:**
- A clause carrying a `references_missing_form` relationship **prevents** a Confirmed label on any answer that depends on it.
- A clause carrying a `conflicts_with` relationship **prevents** a Confirmed label on any answer that depends on it.
- Detection-only coverage categories **prevent** a deep Confirmed answer; the only Confirmed-eligible statement for these categories is confirming that the category is mentioned/detected in the documents — not confirming its terms, scope, or exclusions.
- Poor OCR quality (per the extraction spec's quality bands) on any page contributing to the answer **prevents** a Confirmed label for that answer.

---

## 5. Source Citation Rules

- Every factual statement about policy content must cite at least one `source_ref`.
- If multiple clauses contribute to a single answer (e.g., a coverage grant, its limit, and an exclusion), all material `source_ref`s must be cited — not just the first or most prominent one.
- Each citation shown to the consumer should reflect, where available: file name, page number, section heading, clause heading, and a short supporting text snippet.
- If no `source_ref` exists to support a statement, that statement cannot be made — the answer must instead be labeled Not Found or Unclear for that specific point.
- **A declarations page alone may never be cited as sufficient support for:** exclusions, claim duties, or scenario-specific outcomes. Declarations-only support caps coverage status at "Appears Listed" and confidence at "Likely" or below, and any exclusion/condition/claim-duty question dependent on missing supporting documents must be answered as Not Found or Unclear, never inferred from the declarations listing.

---

## 6. Direct Answer Language Rules

**Approved language patterns:**
- "Based on the uploaded documents, this coverage appears to be listed."
- "Based on the uploaded documents, this coverage is supported by the declarations page and endorsement."
- "The uploaded documents do not show this coverage."
- "The uploaded documents are incomplete on this point."
- "This answer is limited to the documents uploaded."
- "The policy language appears to require..."
- "The endorsement appears to limit..."
- "The document appears to exclude..."

**Prohibited language patterns:**
- "Your claim is covered."
- "The carrier must pay."
- "You are guaranteed coverage."
- "This is legally enforceable."
- "The insurer cannot deny this."
- "You should sue."
- "You should buy this coverage."
- "This is the best policy."
- "You do not need to review the policy."
- "You can rely on this as a final coverage determination."

Any generated answer containing a prohibited pattern (or a close paraphrase carrying the same meaning) must be rejected before being shown to the consumer. Approved patterns are not an exhaustive whitelist of exact sentences, but they establish the register and hedging structure every answer must follow: source-anchored, non-absolute, and free of outcome predictions.

---

## 7. Coverage Status Values

| Status | When Used |
|---|---|
| **Included** | A coverage grant, its limit, and its material exclusions/conditions are all found and consistent — the strongest status, generally paired with Confirmed confidence. |
| **Appears Listed** | The coverage is named on a declarations page or schedule, but full supporting policy/endorsement language was not confirmed — generally paired with Likely confidence. |
| **Limited** | The coverage exists but is materially narrowed by a sublimit, exclusion, waiting period, or condition significant enough to change the consumer's understanding of its scope. |
| **Excluded** | The uploaded documents explicitly state the item/scenario in question is not covered. |
| **Not Found** | No source language addresses the coverage/term at all. |
| **Unclear** | Conflicting, ambiguous, or low-quality source material prevents a clear status determination. |
| **Detection Only** | The category was identified as present/mentioned in the documents, but MVP scope does not support a full coverage analysis of its terms (see Section 10). |

---

## 8. Answer Types

**A. Policy identity questions** — e.g., carrier name, policy number, policy period, named insured, horse name, insured value.
- *Required sources:* declarations page key-value extractions.
- *Confidence rules:* Confirmed if clearly extracted and consistent across documents; Unclear if conflicting values appear across documents (e.g., different insured values on different pages).

**B. Coverage existence questions** — e.g., "Do I have mortality coverage?", "Do I have major medical?", "Is colic surgery included?"
- *Required sources:* coverage grant clause, cross-checked against declarations listing.
- *Confidence rules:* per Section 4 — Confirmed requires grant + limit + material exclusions/conditions; declarations-only support caps at Likely/Appears Listed.

**C. Limit and deductible questions** — e.g., "What is my limit?", "What is my deductible?", "Is there a sublimit?"
- *Required sources:* limit/deductible/sublimit clauses linked to the specific coverage category asked about.
- *Confidence rules:* Confirmed only if a single, unambiguous, non-conflicting figure is found; Unclear if multiple different figures exist across documents.

**D. Exclusion questions** — e.g., "Is routine care excluded?", "Are pre-existing conditions excluded?"
- *Required sources:* exclusion clauses linked to the relevant coverage category.
- *Confidence rules:* Confirmed if the exclusion is explicitly named and its scope is clear; Likely/Unclear if the exclusion's boundary depends on an undefined term.

**E. Claim duty questions** — e.g., "How fast do I have to give notice?", "What documents are required?"
- *Required sources:* claim notice / proof of loss / veterinary documentation requirement clauses.
- *Confidence rules:* Confirmed only if the specific figure/requirement is explicitly stated; Not Found if no claim-conditions section was located at all — deadlines are never stated as fact without an explicit source.

**F. Scenario questions** — e.g., "What happens if my horse dies?", "What happens if my horse needs colic surgery?"
- *Required sources:* all clauses connected to the relevant coverage grant via the relationship model (limits, exclusions, conditions, claim duties).
- *Confidence rules:* per Section 11 (scenario answer rules) — always multi-clause, never single-clause.

**G. Missing document questions** — e.g., "What documents are missing?", "Why is the answer unclear?"
- *Required sources:* the extraction pipeline's completeness/conflict output (missing_sources, conflicts, warnings).
- *Confidence rules:* these questions are inherently answerable directly from system state; no coverage confidence label is needed, but the answer must be concrete about what's missing and why it matters.

**H. Detection-only questions** — e.g., "Does this document mention liability?", "Does it mention loss of use?"
- *Required sources:* any clause classified under a detection-only coverage category.
- *Confidence rules:* the system may confirm detection (presence/absence) at Confirmed confidence, but may not give a Confirmed analysis of the category's terms — see Section 10.

---

## 9. MVP-Supported Answer Categories

The system may answer in full analytical detail (subject to all confidence and source rules above) for:

- Declarations page information
- Full mortality
- Specified-perils mortality
- Theft
- Humane destruction
- Euthanasia language
- Major medical
- Surgical
- Emergency colic surgery
- Limits
- Deductibles
- Exclusions
- Claim notice requirements
- Veterinary documentation requirements
- Missing document warnings
- Direct consumer Q&A across the above categories
- Downloadable PDF report summarizing all of the above

---

## 10. Detection-Only Categories

The following categories may be detected (their presence/absence confirmed) but must not receive full clause-relationship analysis in MVP:

- Loss of use
- Liability
- Care, custody, and control
- Boarding or training liability
- Commercial equine liability
- Breeding coverage
- Stallion infertility
- Foal coverage
- Farm/ranch package coverage

**Rules:**
- The system may state that the uploaded documents appear to mention or list one of these categories, with a source citation for that mention.
- The system must not provide a full interpretation of the category's terms, exclusions, or conditions unless every required supporting clause is present *and* the category has been brought into full analytical scope in a future version — as of this MVP, it has not.
- Any deeper question about one of these categories (e.g., "What does my liability coverage exclude?") must be answered with a **Detection Only** or **Unclear** status, plainly stating that full analysis of this category is outside the current scope of the tool, rather than attempting a partial analysis that could read as more authoritative than it is.

---

## 11. Scenario Answer Rules

Scenario questions (e.g., "What happens if my horse dies?", "What happens if my horse needs colic surgery?", "What happens if my horse is stolen?", "What happens if my horse needs surgery?", "What happens if my horse has a pre-existing condition?", "What happens if I miss the notice deadline?") are inherently multi-clause and must never be answered from a single coverage grant.

Every scenario answer must assemble and present:
- Relevant coverage categories found (which grants apply to this scenario)
- Relevant exclusions found (anything that could remove or narrow the applicable coverage)
- Relevant limits/deductibles found (what would quantify a payout, if any)
- Relevant claim duties found (notice, documentation, prior approval, necropsy, etc.)
- Missing documents affecting the completeness of the answer
- A confidence label reflecting the weakest link in the chain of clauses used (a scenario answer is only as strong as its least-supported component)
- An explicit, unambiguous statement that the answer does not determine whether an actual claim would be paid

**Absolute rule:** scenario answers must never state or imply that a claim will be paid, regardless of how complete and consistent the underlying documents are. Even a fully "Confirmed" scenario answer describes what the documents say would apply — not a prediction or guarantee of a real-world claim outcome.

---

## 12. Missing Document Answer Rules

| Situation | Standard Answer Language |
|---|---|
| Declarations page missing | "We didn't find a declarations page in your upload. Basic policy details like your limits and named insured may not be available until it's provided." |
| Endorsement missing (referenced but not uploaded) | "Your declarations page references [coverage], but we couldn't find the endorsement that defines its terms. We can confirm it's listed, but not what it covers or excludes." |
| Exclusions missing | "We found coverage language for [category], but couldn't locate an exclusions section. This coverage answer may be incomplete." |
| Conditions missing | "We couldn't find the claim conditions section for [category]. We can't confirm requirements like notice deadlines or documentation needed." |
| Claim procedure missing | "We didn't find a section describing how to report a claim. We can't confirm notice deadlines or required forms." |
| Referenced form missing | "This document references [form name/number], which wasn't included in your upload. Some answers may be incomplete until it's provided." |
| OCR unreadable page | "One or more pages in your upload were too unclear to read reliably. Answers that would depend on those pages are marked Unclear or Not Found." |
| Mixed policies uploaded | "It looks like your upload may contain more than one policy or unrelated documents. We've done our best to separate them, but you may want to confirm which documents belong together." |

---

## 13. Conflict Answer Rules

Examples of conflicts: two different limits found; two different deductibles found; coverage listed in one document but absent in another; horse name conflict; policy period conflict; endorsement conflict; missing referenced form; multiple policy packages mixed together.

**Rules:**
- Every detected conflict must be surfaced plainly to the consumer, naming both conflicting values and their sources.
- The system does not choose one value over another unless a specific, pre-built hierarchy rule exists for that exact conflict type (e.g., "the most recent endorsement modifies an earlier base-policy figure" — but only where the system has been specifically designed and tested to apply that hierarchy; absent such a rule, no selection is made).
- Confidence is lowered to Unclear for any answer touching a material conflict, unless the conflict is clearly immaterial to the question asked (e.g., a conflicting premium figure has no bearing on a coverage-exclusion question).
- **No answer touching a conflict may be labeled Confirmed.**

---

## 14. Exclusion and Condition Handling

- If a coverage appears included and any exclusion clause is linked to it, the exclusion must be mentioned in the answer — it is never acceptable to answer a coverage-existence question without checking for and surfacing linked exclusions.
- If a claim duty (notice, documentation, prior approval, etc.) is linked to the coverage in question, it must be mentioned in the answer, particularly for scenario and claim-duty question types.
- If exclusions could not be located for an otherwise-supported coverage grant, the answer must explicitly warn that the coverage picture may be incomplete — silence on this point is not acceptable.
- If conditions could not be located, the answer must not state claim requirements as complete or settled; it must say they weren't found.
- Exclusions and conditions must be presented in plain English, each with its own source citation — they are not to be bundled into a single vague caveat sentence when specific source-backed detail is available.

---

## 15. Answer Refusal / Insufficient Source Rules

When source support is insufficient, the system must refuse to answer directly using plain, consumer-safe language such as:

- "I did not find enough policy language in the uploaded documents to answer that."
- "The uploaded documents appear to be missing the endorsement needed to answer this."
- "The relevant page is unreadable."
- "The uploaded documents conflict on this point."
- "The documents mention this coverage, but do not include the terms needed to explain it."

These refusals are not failures of the product — they are the product working as designed. The system must never disguise a refusal as an answer by using confident-sounding language over insufficient evidence.

---

## 16. Output JSON Schema for Answers

```json
{
  "answer_id": "string",
  "user_question": "string",
  "normalized_question": "string",
  "answer_type": "policy_identity | coverage_existence | limit_deductible | exclusion | claim_duty | scenario | missing_document | detection_only",
  "direct_answer": "string",
  "coverage_status": "Included | Appears Listed | Limited | Excluded | Not Found | Unclear | Detection Only",
  "confidence_label": "Confirmed | Likely | Unclear | Not Found",
  "confidence_reason": "string",
  "source_refs": ["object"],
  "supporting_clause_ids": ["string"],
  "related_clause_ids_considered": ["string"],
  "limits_found": ["object"],
  "deductibles_found": ["object"],
  "exclusions_found": ["object"],
  "conditions_found": ["object"],
  "missing_documents": ["string"],
  "conflicts": ["object"],
  "detection_only_flag": "boolean",
  "prohibited_claims_avoided": ["string"],
  "consumer_safe_summary": "string",
  "what_this_answer_does_not_determine": "string"
}
```

---

## 17. Answer Examples

### Example 1 — Do I have mortality coverage?
- **Direct answer:** "Yes, based on your uploaded documents, you have Full Mortality coverage for [horse name]."
- **Coverage status:** Included
- **Confidence label:** Confirmed
- **Source references (generic):** Policy form, mortality coverage grant section; declarations page, coverage listing
- **Relevant warning:** None, if no conflicts/missing forms
- **Must not say:** Any statement about whether a specific future death would be paid out.

### Example 2 — Do I have major medical?
- **Direct answer:** "Your Declarations Page lists Major Medical coverage, but we couldn't find the endorsement that defines what it covers or excludes."
- **Coverage status:** Appears Listed
- **Confidence label:** Likely
- **Source references (generic):** Declarations page listing only
- **Relevant warning:** "We recommend confirming this endorsement is included in your policy package."
- **Must not say:** Any specific limit, deductible, or exclusion for major medical, since no supporting document was found.

### Example 3 — Is colic surgery covered?
- **Direct answer:** "Yes, your policy includes an Emergency Colic Surgery endorsement with a $5,000 sublimit, but it excludes horses with a documented prior history of colic or gastrointestinal issues."
- **Coverage status:** Limited
- **Confidence label:** Confirmed
- **Source references (generic):** Endorsement, colic surgery grant and sublimit; exclusions section, prior-history exclusion
- **Relevant warning:** None beyond the exclusion itself, which is stated directly
- **Must not say:** Whether this specific horse's medical history would trigger the exclusion.

### Example 4 — What is my deductible?
- **Direct answer:** "Based on the uploaded documents, your deductible for Major Medical coverage is $250."
- **Coverage status:** Included
- **Confidence label:** Confirmed
- **Source references (generic):** Endorsement, deductible clause
- **Relevant warning:** None, if only one figure is found
- **Must not say:** A deductible amount for a different coverage category not asked about, or an inferred deductible where none was stated.

### Example 5 — Are pre-existing conditions excluded?
- **Direct answer:** "Yes, your policy excludes pre-existing conditions from Major Medical coverage."
- **Coverage status:** Excluded (for the specific carve-out)
- **Confidence label:** Confirmed, if "pre-existing condition" is defined in the documents; Likely if the term is used but undefined
- **Source references (generic):** Exclusions section; definitions section, if present
- **Relevant warning:** "The documents don't define exactly what counts as 'pre-existing,' which could affect how this exclusion applies," if no definition is found
- **Must not say:** Whether a specific medical history would count as pre-existing for this horse.

### Example 6 — What happens if my horse dies?
- **Direct answer:** "Your policy includes Full Mortality coverage up to $20,000. Humane destruction is covered if certified by a licensed veterinarian, generally requiring the insurer's prior consent except in emergencies. Notice of loss must be given in writing within 5 days."
- **Coverage status:** Included
- **Confidence label:** Confirmed
- **Source references (generic):** Mortality coverage grant and limit; humane destruction clause; claim notice clause
- **Relevant warning:** None, if all supporting clauses are present and consistent
- **Must not say:** That a claim following the horse's death will be paid.

### Example 7 — Does this policy include liability?
- **Direct answer:** "Your uploaded documents mention a Liability section, but detailed analysis of liability coverage is outside what this tool currently reviews in depth."
- **Coverage status:** Detection Only
- **Confidence label:** Confirmed (for the fact of detection only)
- **Source references (generic):** Section heading reference where "Liability" appears
- **Relevant warning:** "We can tell you this section exists, but not yet explain its terms, limits, or exclusions."
- **Must not say:** Any specific liability limit, exclusion, or condition, since this category is detection-only in the current version.

### Example 8 — What documents are missing?
- **Direct answer:** "Your Declarations Page references a Major Medical Endorsement and a Colic Surgery Rider, but neither was found in your upload."
- **Coverage status:** N/A (system-state question, not a coverage question)
- **Confidence label:** N/A (this is a factual statement about upload completeness, not a coverage confidence determination)
- **Source references (generic):** Declarations page listing referencing the missing documents by name
- **Relevant warning:** "Until these are provided, we can't confirm the terms of these two coverages."
- **Must not say:** Any assumption about what those missing documents likely say.

### Example 9 — The declarations page lists surgical coverage but no surgical endorsement is found.
- **Direct answer:** "Your Declarations Page lists Surgical Coverage as included, but we couldn't find the endorsement or policy language that defines what it covers, excludes, or any applicable limit."
- **Coverage status:** Appears Listed
- **Confidence label:** Likely (leaning toward Not Found for specific terms)
- **Source references (generic):** Declarations page listing only
- **Relevant warning:** "We recommend confirming this section of your policy package is complete."
- **Must not say:** Any specific surgical limit, deductible, or exclusion.

### Example 10 — Two documents show different major medical limits.
- **Direct answer:** "We found two different Major Medical limits in your uploaded documents: $5,000 on your Declarations Page and $7,500 in an endorsement. We can't confirm which applies."
- **Coverage status:** Unclear
- **Confidence label:** Unclear
- **Source references (generic):** Declarations page limit figure; endorsement limit figure
- **Relevant warning:** "You may want to check with your carrier or agent of record to confirm which figure is correct."
- **Must not say:** Which figure is "correct" or more likely to be the operative one.

---

## 18. QA Checklist for Answer Generation

- [ ] Every answer has `source_refs`, or is explicitly marked Not Found/Unclear
- [ ] No answer invents coverage not backed by a coverage grant clause
- [ ] No answer invents a limit not found in source documents
- [ ] No answer invents a deductible not found in source documents
- [ ] No answer invents a claim deadline not found in source documents
- [ ] No answer guarantees or predicts claim payment
- [ ] No answer gives a legal conclusion
- [ ] No answer recommends a specific carrier
- [ ] No answer suggests an agent referral
- [ ] Missing referenced forms prevent a Confirmed label
- [ ] Unresolved conflicts prevent a Confirmed label
- [ ] Detection-only categories are not given a full coverage analysis
- [ ] Linked exclusions are checked and surfaced for every coverage-existence answer
- [ ] Linked conditions are checked and surfaced for every scenario/claim-duty answer
- [ ] Confidence label is justified by the specific evidence present (not defaulted upward)
- [ ] Consumer-safe language patterns are used throughout (Section 6)
- [ ] The "what this answer does not determine" field is present and populated for every answer

---

*End of v1.0 Direct Answer Generation Rules Specification. Next implementation documents: final report layout/design, and backend/infrastructure architecture.*
