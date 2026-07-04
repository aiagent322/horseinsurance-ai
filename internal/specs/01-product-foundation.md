# Horse Insurance Coverage Checkup™
## Product Foundation Specification — v1.0 (MVP)
**Owner:** HorseInsurance.ai
**Status:** Internal — Implementation Reference
**Classification:** Product / Compliance / Engineering foundation document

---

## 1. Product Definition

Horse Insurance Coverage Checkup™ is a document intelligence tool that allows a horse owner to upload their equine insurance policy documents and receive plain-English, source-cited answers describing what those uploaded documents appear to say.

The product reads only what the user uploads. It does not access carrier databases, does not know what policy the user "should" have, and does not evaluate whether the user's coverage is adequate, competitive, or advisable. It is a document comprehension and citation tool, not an advisory, sales, or claims tool.

Every output is grounded in — and traceable to — a specific location in a specific uploaded document. If a question cannot be answered from what was uploaded, the product says so explicitly rather than filling the gap with general insurance knowledge.

---

## 2. Consumer Promise

> "We will tell you what your uploaded policy documents actually say — in plain English, with the exact source shown for every answer. We will never guess, never assume, and never tell you what your policy doesn't say."

The consumer promise rests on three commitments:
1. **Groundedness** — every statement is tied to a specific document and section.
2. **Transparency about limits** — the tool tells the user what it cannot determine, rather than staying silent or guessing.
3. **Neutrality** — no product, carrier, or agent is ever promoted, and no coverage adequacy judgment is ever offered.

---

## 3. What the Product Does

- Accepts uploaded equine insurance policy documents (declarations pages, policy forms, endorsements, riders, exclusion schedules).
- Extracts and structures the content of those documents (coverage types, limits, deductibles, conditions, exclusions, definitions, notice requirements).
- Answers direct consumer questions about the uploaded documents in plain English.
- Cites the specific document and section/page supporting each answer.
- Flags contradictions between documents (e.g., an endorsement that modifies a base policy exclusion).
- Identifies commonly-expected policy sections that appear to be missing from the upload and warns the user accordingly.
- Produces a downloadable PDF summary report of coverage as documented.
- Assigns a confidence level to every answer based on how directly the source material supports it.

---

## 4. What the Product Must Never Do

The product must never:
- Sell, solicit, quote, bind, or facilitate the purchase of insurance.
- Recommend, rank, or name insurance carriers, agents, or brokers.
- Refer the user to an agent, broker, or carrier representative.
- Adjust, approve, deny, estimate, or predict the outcome of a claim.
- Guarantee, imply, or predict that a claim will or will not be paid.
- Provide legal advice or legal interpretation of contract enforceability.
- State or imply that the user's coverage is "good," "bad," "sufficient," "risky," or in need of change.
- Answer any question using general insurance knowledge not grounded in the uploaded documents.
- Fabricate, infer, or "fill in" a policy term that is not present in the uploaded material.
- Retain uploaded documents beyond what is required to generate the report (see Section 14 / Data Handling).

---

## 5. The Core Rule: "No Source, No Answer"

This is the non-negotiable operating principle of the product:

> **If a claim cannot be tied to a specific sentence, clause, table, or section in an uploaded document, the system does not make the claim.**

Implementation implications:
- Every factual statement in a report must carry a citation (document name + section/page identifier).
- If the uploaded documents do not address a question, the answer is: *"This isn't addressed in the documents you uploaded,"* not a general industry answer.
- The system is prohibited from using outside/background knowledge about "how equine mortality policies typically work" to answer a question the documents don't cover. Silence-with-explanation is always preferred over an inferred answer.
- Confidence levels (Section 7) exist specifically to make the strength of grounding visible to the user at all times.

---

## 6. Required Answer Format

Every answer delivered to a consumer question must follow a fixed structure:

1. **Direct Answer** — one to three plain-English sentences answering the question as asked.
2. **Source Citation** — the specific document title and location (e.g., *"Declarations Page, Item 4"*; *"Mortality Endorsement, Section II(b), page 3"*).
3. **Supporting Quote or Paraphrase** — the relevant policy language, quoted or closely paraphrased, so the user can see exactly what the system is basing the answer on.
4. **Confidence Level** — see Section 7.
5. **Caveat (if applicable)** — any ambiguity, conflicting document, or missing information relevant to the answer.

No answer may skip the citation step, including simple yes/no questions.

---

## 7. Required Confidence Levels

Every answer carries one of four confidence labels:

| Level | Meaning | When Used |
|---|---|---|
| **Confirmed** | The uploaded documents directly and unambiguously state this. | Direct, unambiguous match to a clause. |
| **Likely, with caveat** | The documents support this conclusion, but require light interpretation (e.g., cross-referencing a definition elsewhere in the same document). | Requires connecting two clearly stated provisions. |
| **Unclear / conflicting** | The uploaded documents contain ambiguous or contradictory language on this point. | Endorsement vs. base form conflict, undefined term, illegible text. |
| **Not addressed in uploaded documents** | Nothing in the uploaded material speaks to this question. | Question falls outside what was uploaded. |

The system must never present a "Likely" or "Unclear" answer with the same visual/textual confidence as a "Confirmed" answer.

---

## 8. Required Document Types (MVP)

The system must be able to accept and process:
- Declarations page
- Full policy form (base contract)
- Endorsements / riders
- Exclusion schedules or addenda
- Veterinary certificates or health records submitted by the user (for cross-reference against documentation requirements, not for medical interpretation)

Accepted file format: PDF (text-based and scanned/image PDF via OCR). Multi-file upload must be supported, since equine policies are frequently split across a base form and multiple endorsements.

---

## 9. Required Policy Sections the System Must Understand

The parser/extraction layer must be able to locate and structure:
- Named insured / policyholder information
- Description of the insured animal (name, breed, age, use, value)
- Coverage period (effective and expiration dates)
- Coverage type(s) selected
- Limits of liability / insured value
- Deductible(s) and how they apply
- Premium basis (not required in output, but useful for cross-checking declarations)
- Definitions section (critical — many coverage disputes hinge on defined terms)
- Exclusions
- Conditions (notice requirements, veterinary documentation requirements, cooperation clauses)
- Endorsement effective dates and what base-policy language they modify
- Claims notice / reporting requirements and deadlines

---

## 10. Required Equine Insurance Coverage Categories (MVP)

The system must recognize and report on, when present:
1. **Mortality coverage** (all-risk/full mortality)
2. **Specified-perils mortality** (named-peril only)
3. **Theft**
4. **Humane destruction / euthanasia provisions**
5. **Major medical**
6. **Surgical coverage**
7. **Emergency colic surgery** (frequently a distinct sub-limit or rider)
8. **Limits of liability** (per-category and aggregate, if both exist)
9. **Deductibles** (per-claim, per-condition, or annual, as applicable)
10. **Exclusions** (both general and endorsement-specific)
11. **Claim notice requirements** (time limits, required notification method)
12. **Veterinary documentation requirements** (pre-existing condition disclosures, current Coggins/health certificates, treating-vet records required at claim time)

---

## 11. Direct Consumer Questions the System Should Answer (MVP set)

- "What type of mortality coverage do I have — full mortality or specified perils?"
- "Is theft covered under this policy?"
- "Does this policy cover humane destruction / euthanasia, and under what conditions?"
- "Do I have major medical coverage, and what does it cover?"
- "Is surgical coverage included, and is there a separate limit?"
- "Is emergency colic surgery covered, and is there a sub-limit or waiting period?"
- "What is my coverage limit for [category]?"
- "What is my deductible, and how does it apply?"
- "What is explicitly excluded under this policy?"
- "How soon do I need to report a claim, and how do I do it?"
- "What veterinary documentation do I need to have ready if I file a claim?"
- "Do any endorsements change what's in the base policy?"
- "Is there anything in my uploaded documents that looks incomplete or missing?"

---

## 12. Compliance-Safe Language Rules

All system output must:
- Attribute every substantive claim to "your uploaded documents," never to the system's own authority.
- Use hedged, source-anchored phrasing: *"Your Declarations Page states…"*, *"The Mortality Endorsement defines…"*, *"This isn't stated in the documents you uploaded."*
- Distinguish clearly between quoting policy language and paraphrasing it.
- Include a standing disclaimer on every report (see Section 16) that the tool is educational and does not replace the policy itself, the carrier, or a licensed professional.
- Direct users back to their insurance carrier or agent of record for any determination the documents don't resolve — **without naming, ranking, or recommending any specific carrier or agent.**

---

## 13. Prohibited Language Rules

The system must never use:
- "You are covered" / "You are not covered" as a standalone claim without a citation and confidence level attached.
- "This will be paid" / "This claim will be denied" or any claim-outcome language.
- "We recommend" / "You should switch to…" / "A better policy would…"
- Carrier or agent names in a recommending, comparative, or promotional context.
- "Guaranteed," "approved," "certified" (in the sense of certifying coverage adequacy).
- Legal terms of art implying legal conclusions (e.g., "this exclusion is unenforceable," "this constitutes bad faith").
- Absolute language ("always," "never," "all policies") about insurance practices in general — every statement must stay tied to the specific uploaded documents.

---

## 14. Missing-Document Handling Rules

- If a document type expected for a complete coverage picture is absent (e.g., no endorsements uploaded but the declarations page references one), the report must explicitly list it under a **"Documents That May Be Missing"** section.
- If a question cannot be answered because the relevant page/section appears to be missing, cut off, or illegible, the system must say so directly rather than guessing from context elsewhere in the document.
- The system must never assume a "standard" industry provision fills a gap left by a missing document.
- Data handling: uploaded documents and extracted content are processed for the purpose of generating the report and are not retained beyond what is necessary for the user's active session/report generation, consistent with the sensitivity of personal insurance and financial documents. (Final retention policy to be confirmed with legal/compliance before production launch.)

---

## 15. High-Level Workflow (Upload → Final Report)

1. **Upload** — User uploads one or more PDF documents (declarations, policy form, endorsements, etc.).
2. **Document identification** — System classifies each uploaded file by type (declarations, base form, endorsement, vet record).
3. **Extraction** — System extracts structured content per Section 9 (sections, definitions, limits, exclusions, conditions).
4. **Cross-referencing** — System reconciles endorsements against the base form to detect modifications or conflicts.
5. **Gap check** — System compares extracted content against the expected section list (Section 9) and coverage category list (Section 10) to identify what's missing or unaddressed.
6. **Q&A / Report generation** — System answers the fixed consumer question set (Section 11) and any user-submitted question, using the required answer format (Section 6) and confidence levels (Section 7).
7. **Compliance pass** — Output is checked against prohibited language rules (Section 13) before being shown to the user.
8. **Report delivery** — User views the report in-browser and can download it as a PDF.

---

## 16. Final Report Sections

The downloadable PDF report must contain, in this order:

1. **Cover summary** — insured name (as it appears on documents), animal described, document list reviewed, date of analysis.
2. **Coverage Snapshot** — table of the MVP coverage categories (Section 10) with status: Confirmed / Likely / Unclear / Not Addressed / Not Found in Documents.
3. **Limits & Deductibles Summary** — extracted values, per category, with citations.
4. **Exclusions Summary** — plain-English list of exclusions found, with citations.
5. **Claim Notice & Documentation Requirements** — what the documents say the user must do/provide, and by when.
6. **Documents That May Be Missing** — explicit list, per Section 14.
7. **Q&A Section** — full answer set from Section 11, in required answer format.
8. **Source Index** — list of all uploaded documents referenced, with page/section counts, so the user can verify every citation against their own paperwork.
9. **Standing Disclaimer** — fixed legal/compliance footer appearing on every report:
   > *"This report is an educational summary based solely on the documents you uploaded. It is not insurance advice, legal advice, or a determination of coverage, and it does not obtain, sell, underwrite, or modify any insurance policy. It does not adjust, approve, deny, or guarantee payment of any claim. Your actual policy, declarations page, endorsements, exclusions, conditions, and applicable law govern all coverage questions. For binding determinations, contact your insurance carrier or agent of record."*

---

*End of v1.0 Product Foundation Specification. This document establishes the MVP scope and guardrails only; UI/UX design, extraction model selection, and infrastructure architecture are addressed in separate implementation documents.*
