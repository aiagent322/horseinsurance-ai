# Horse Insurance Coverage Checkup™
## Report Template Specification — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Implementation Reference
**Scope:** Consumer-facing report structure only.

---

## 1. Report Purpose

The report is the final deliverable shown to a horse owner after their uploaded insurance documents have been extracted, classified, and analyzed. It is written for the policyholder, not for agents, adjusters, or underwriters, and it must be usable without any insurance background.

The report is an educational, source-cited summary of what the uploaded documents appear to say. It is **not** a coverage determination, legal opinion, claim approval or denial, or insurance recommendation. Every statement in it traces back to a specific page in a specific uploaded document. Where the documents don't support a conclusion, the report says so rather than filling the gap. The report must never be mistaken for a substitute for the policy itself, the carrier, or professional advice.

---

## 2. Required Report Sections

1. **Cover page** — Product name, date of analysis, files/documents reviewed, named insured (as extracted), horse(s) covered. Sets expectations before any findings appear.

2. **Important limitations** — Up front, plain-English statement that this is an educational summary of uploaded documents only, not a coverage/legal/claims determination, and does not guarantee any claim outcome.

3. **Document completeness summary** — What was uploaded, what document types were detected, overall document quality/OCR notes, and whether the set appears complete or has gaps.

4. **Policy snapshot** — Carrier name, policy number, policy period, named insured — as extracted, with source citations.

5. **Horse snapshot** — Per-horse identity data (name, breed, age, insured value) from the horse/insured-value schedule, each row separately cited.

6. **Coverage summary** — Table of MVP coverage categories with coverage status and confidence label for each, giving the reader an at-a-glance view before the detailed answers.

7. **Direct coverage answers** — Full plain-English answers for each MVP-supported question, each with direct answer, status, confidence, and source citations.

8. **Limits and deductibles** — All extracted limits, sublimits, and deductibles, organized by coverage category, with citations.

9. **Exclusions and restrictions** — All extracted exclusions, use/territory/age restrictions, organized by the coverage category each one affects, with citations.

10. **Claim duties and notice requirements** — Notice deadlines, proof of loss, veterinary documentation, prior approval, and necropsy requirements, with citations; explicitly marked "not found" where absent rather than omitted.

11. **Emergency scenario answers** — Plain-English answers to standard scenario questions (death, colic surgery, theft, surgery, pre-existing condition, missed notice deadline), each assembling relevant coverage, exclusions, limits, and duties, always ending with a statement that the answer does not determine claim payment.

12. **Missing or unclear items** — Consolidated list of missing documents, unreadable pages, and unresolved conflicts, explaining what could not be confirmed and why.

13. **Detection-only items** — Categories (loss of use, liability, care/custody/control, breeding, etc.) that were detected in the documents but not deeply analyzed in this version, clearly labeled as such.

14. **Source index** — Full list of uploaded documents referenced in the report, so the reader can verify every citation against their own paperwork.

15. **Final disclaimer** — Standing legal/compliance footer (per the product foundation spec) restating that this is educational only, does not determine coverage, and that the actual policy, carrier, and applicable law control.

---

## 3. Confidence and Status Display

The report uses only the four confidence labels — **Confirmed, Likely, Unclear, Not Found** — and only the seven coverage status values — **Included, Appears Listed, Limited, Excluded, Not Found, Unclear, Detection Only** — exactly as defined in the answer generation specification. No synonyms, icons-only representations, or additional tiers may be introduced at the report layer.

Every confidence label and coverage status must be displayed as a visible word directly next to the relevant answer — never conveyed through color alone. This preserves clarity in black-and-white printouts and for screen-reader accessibility, and prevents any appearance that a "Confirmed" answer and an "Unclear" answer differ only in decoration rather than in substance.

---

## 4. Report Output Rules

- Every factual statement about policy content must carry at least one source citation (file, page, section); statements without one may not appear.
- Missing documents identified anywhere in the analysis must be surfaced in the completeness summary and again in the specific sections they affect — never silently dropped.
- Conflicts between documents must be surfaced plainly, naming both conflicting values and their sources, with confidence capped accordingly.
- Exclusions and conditions must be displayed adjacent to the coverage they modify, not isolated in a disconnected list divorced from context.
- Detection-only categories must be visually and textually distinguished from fully analyzed categories, using the "Detection Only" status rather than blending in with Confirmed/Likely findings.
- The report must never state or imply that a claim will be paid, denied, or approved, under any coverage or scenario.
- The report must never recommend, name, or rank any insurance agent, broker, or carrier.
- The report must render consistently in both web display and downloadable PDF form, preserving section order, citations, and status/confidence labels identically across both formats.

---

*End of v1.0 Report Template Specification.*
