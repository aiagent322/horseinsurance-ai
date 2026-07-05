# Horse Insurance Coverage Checkup™
## Answer Support Verification Specification — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Implementation Reference
**Scope:** Verification gate only. Defines how the system checks that every consumer-facing answer, report statement, and coverage conclusion is actually supported by cited policy text before display. Does not define extraction, classification, answer wording, report layout, reviewer UI/operations, or infrastructure.

---

## 1. Purpose

Confidence orchestration (spec 08) assigns labels and routes items, and its §7 introduced a snippet-to-wording check — verifying that a citation actually backs the claim, not merely that a citation exists. That check is the single highest-value guard against "cited but unsupported" answers, and it needs its own rules. This document owns them.

Answer support verification is the **final gate before display**. After an answer has been generated (spec 04) and scored (spec 08), verification asks one question of every consumer-facing statement: *does the cited policy text actually support these exact words?* An answer can be fluent, correctly formatted, carry a citation, and still fail — because the citation doesn't say what the answer says, because the answer overstates the language, or because it converts ambiguity into certainty. Verification exists to catch precisely those cases, which no earlier stage is positioned to catch: extraction verifies text was captured, classification verifies clause type, orchestration verifies confidence math — none of them verify that the *generated wording* is entailed by the *cited source*.

Verification is a **checking function**, not a generating or interpreting one. It does not write answers, does not reword them (it can only pass, block, or replace), and does not interpret contract meaning. It compares generated statements against cited source snippets and produces a verification status that governs whether the statement may be shown.

**Governing constraint:** no consumer-facing statement about policy content may be displayed unless it passes verification. A statement that is unsupported, contradicted, or backed by insufficient evidence is blocked from final display — replaced with a safe insufficient-evidence response or routed to review (spec 08 §11). Verification never "lets it through with a caveat" when the underlying support is absent; caveats are for genuine low confidence, not for missing support.

---

## 2. What Must Be Verified

Every one of the following must pass verification before display:

- **Direct answers** — each consumer Q&A answer (spec 04 §3).
- **Report statements** — every factual statement of policy content in the report (spec 05 §2 sections).
- **Coverage conclusions** — every coverage status/existence determination (spec 04 §7, spec 07 §4).
- **Limit and deductible statements** — every stated figure.
- **Exclusion statements** — every stated exclusion and its scope.
- **Condition/claim-duty statements** — every stated deadline, requirement, or obligation.
- **Scenario answers** — each assembled multi-clause scenario response (spec 04 §11).

Every verified statement must be tied to all five of the following, or it does not pass:

1. **Source page** — `system_page_number` (and `printed_page_number` where present), from the `source_ref` (spec 02 §5).
2. **Source quote/snippet** — the verbatim `text_snippet` the statement rests on.
3. **Policy section** — `section_heading` / `clause_heading` locating the statement in the document.
4. **Confidence label** — the spec 08 label (Confirmed / Likely / Unclear / Not Found).
5. **Verification status** — one of the five values in §3, assigned by this spec.

A statement missing any of these five is treated as unsupported (§3) and blocked. System-state statements (e.g., "an endorsement is missing") are exempt from the source-quote requirement only where the statement records an *absence* — the absence itself is the finding (spec 07 §2).

---

## 3. Supported vs Unsupported Statements

Verification assigns each statement exactly one of five verification statuses:

| Status | Meaning | Display outcome |
|---|---|---|
| **Fully Supported** | The cited snippet(s) directly and completely support the statement as worded; no overstatement, no added certainty. | Eligible for display; confidence label unchanged. |
| **Partially Supported** | The snippet supports part of the statement but not all of it (e.g., supports that coverage exists but not the stated limit). | The unsupported portion is stripped or the statement is downgraded/rescoped to what *is* supported; the pared-back statement is re-verified. |
| **Contradicted** | The cited snippet says something inconsistent with the statement (e.g., snippet excludes what the statement says is covered). | **Blocked.** Replaced with safe insufficient-evidence response or routed to review. |
| **Unsupported** | No cited snippet supports the statement, or a required citation element (§2) is missing. | **Blocked.** Replaced or routed to review. |
| **Insufficient Evidence** | Some support exists but is too weak, ambiguous, or incomplete to sustain the statement (e.g., OCR-degraded snippet, declarations-only support for an exclusion claim). | **Blocked** from the strong form; replaced with an explicit insufficient-evidence statement (spec 04 §15). |

Rule: only **Fully Supported** statements (and the pared-back remainder of a **Partially Supported** one after re-verification) may reach the consumer as affirmative statements of policy content. **Contradicted**, **Unsupported**, and **Insufficient Evidence** are never shown in affirmative form — they are blocked and handled per §11.

---

## 4. Source Snippet Requirements

For a statement to be verifiable, its supporting `source_ref` snippet must meet these requirements:

- **Verbatim** — the snippet is the exact source text (spec 02 §7 normalization only: whitespace cleanup, never rewording).
- **Present and non-empty** — an empty/absent snippet makes the statement Unsupported (spec 08 §7 `missing_source_quote`).
- **Legible enough to sustain the claim** — snippet drawn from OCR band <75 caps verification at Insufficient Evidence unless the specific supporting text is independently legible and cross-verified (spec 02 §6, spec 08 §5/§7).
- **Sufficient in extent** — the snippet must contain the specific language the statement relies on, including any limiting words (`not`, `except`, `unless`, `subject to`, `only if`) that bear on the claim (spec 02 §8). A snippet that stops before a limiting qualifier cannot support a statement that ignores that qualifier.
- **Correctly scoped** — for per-horse or per-coverage claims, the snippet must come from the correct horse's row / correct coverage section (spec 02 §9, spec 03 §3). A snippet from another horse's schedule row cannot support this horse's limit.

A statement may cite multiple snippets; each must independently meet these requirements for the portion it supports, and together they must cover the whole statement for it to be **Fully Supported**.

---

## 5. Citation Requirements

- Every affirmative statement of policy content cites at least one `source_ref` carrying all five binding elements (§2).
- Where a statement rests on multiple clauses (grant + limit + exclusion), every material clause is cited — not just the most prominent (spec 04 §5). A statement citing only the grant while silently relying on an unstated exclusion is **Partially Supported** at best and rescoped.
- **Declarations-only citations** may support "Appears Listed" statements but may never alone support an exclusion, claim-duty, or scenario-outcome statement (spec 04 §5). A verification of such a statement backed only by `document_type = declarations` is **Insufficient Evidence**.
- A citation must resolve to a real `source_ref` in the analysis (spec 07 §11 no-orphan rule). A citation pointing to a nonexistent or mismatched ref makes the statement **Unsupported**.

---

## 6. Entailment Rules

Entailment is the core check: *is the generated wording entailed by the cited snippet?* Three failure patterns are called out explicitly because they are the most common and most dangerous:

**A. Cited snippet does not support the generated wording.**
The snippet is about a different point than the statement, or does not contain the asserted fact. → **Unsupported.** Blocked. (This is the spec 08 §7 snippet-wording-mismatch case, now the primary entailment failure.)

**B. Answer overstates the policy language.**
The snippet supports a narrower claim than the statement makes — e.g., snippet says "surgical coverage applies to emergency procedures," statement says "all surgery is covered." → **Partially Supported** (rescope to the narrower supported claim) or **Contradicted** if the overstatement inverts a limitation. The statement may never assert more coverage than the snippet grants (spec 03 §15, spec 04 §6).

**C. Answer converts ambiguity into certainty.**
The snippet is genuinely ambiguous or uses an undefined material term, but the statement presents a definite conclusion. → **Insufficient Evidence.** The statement must be replaced with one that preserves the ambiguity (spec 03 §8, spec 08 §8). Verification never permits "reads cleaner" to override "is actually uncertain."

General entailment rules:
- A statement is entailed only if a plain reading of the snippet(s) makes the statement true without adding outside assumptions or industry norms (spec 01 §5).
- Limiting language in the snippet must be reflected in the statement; dropping a qualifier is an overstatement (pattern B).
- Hedged, source-anchored phrasing that matches the snippet's actual strength passes; absolute or outcome-predicting phrasing fails regardless of snippet (spec 04 §6, §11).
- Entailment is checked against the snippet as written — not against what the reviewer or model "knows" the policy probably means.

---

## 7. Numeric and Limit Verification

Numbers get their own strict check because a transposed or mismatched figure reads as authoritative:

- **Exact-match rule** — a stated limit, sublimit, deductible, coinsurance percentage, waiting period, or deadline must match the figure in the cited snippet exactly, including formatting-significant details (`$7,500` not `$7,500.00→$750`, `20%` not `2%`) (spec 02 §7). Any mismatch → **Contradicted.** Blocked.
- **Numeric limit mismatch across documents** — if two cited snippets show two different figures for the same item, the statement may not assert a single figure. It is **Contradicted** in its single-figure form; the only verifiable statement presents both figures with both sources at Unclear (spec 04 §13, spec 08 §8). Verification never selects one.
- **Unit/scope match** — a per-claim deductible may not be stated as per-policy-period (or vice versa) unless the snippet says so; mismatched scope is **Contradicted**.
- **No inferred figures** — a figure not present in any cited snippet is **Unsupported** and blocked; verification never permits a computed, rounded, or "typical" number (spec 04 §2).
- **Null figures** — a `ValueWithSource` with null value may never surface as a figure; a statement asserting one is **Unsupported** (spec 07 §11).

---

## 8. Coverage Conclusion Verification

A coverage conclusion (status + existence) passes only if its full support chain verifies:

- **Grant present for affirmative "Included."** A statement that coverage is *Included* requires a verified coverage grant snippet, not merely a declarations listing. Declarations-only support caps the verifiable conclusion at *Appears Listed* (spec 04 §5, spec 08 §6). An "Included" statement on declarations-only support is **Partially Supported** → rescoped to "Appears Listed."
- **Material modifiers verified.** For a *Confirmed / Included* conclusion, the applicable limit and any material exclusions/conditions must themselves be Fully Supported (spec 04 §4). If a material exclusion exists but wasn't incorporated, the conclusion is **Partially Supported** and must be rescoped to surface the exclusion.
- **Missing endorsement.** If the conclusion depends on an endorsement that isn't in the upload (`references_missing_form`), the affirmative-terms conclusion is **Insufficient Evidence**; only "Appears Listed, defining document not found" verifies (spec 04 §4, spec 08 §6). Blocked in its strong form.
- **Detection-only categories.** A terms-level conclusion for a detection-only category (loss of use, liability, care/custody/control, breeding) is **Unsupported** by definition of scope; only a detection statement ("this category is mentioned") verifies (spec 04 §10).
- **Scenario conclusions** verify only if every assembled component (coverage, exclusions, limits, conditions) is individually Fully Supported; the scenario inherits the weakest component's status (spec 04 §11). And every scenario conclusion must include the boundary statement that it does not determine whether a claim would be paid — a scenario statement lacking that boundary fails verification on format (spec 04 §11).

---

## 9. Exclusion Verification

- **Named-scope rule** — an exclusion statement may name only the carve-outs actually present in the cited snippet; a broader or narrower list than the snippet is **Partially Supported** (rescope) or **Contradicted** (spec 03 §16 Example 5, spec 04 §5 Example under §14).
- **Limiting-language fidelity** — the exclusion's qualifiers (`only`, `except`, `unless`, `to the extent`) must be carried into the statement; dropping them overstates the exclusion's reach in either direction → **Partially Supported**/rescope.
- **Undefined-term ambiguity** — if the exclusion turns on a material term the documents don't define (e.g., "pre-existing" undefined), a definite statement of its scope is **Insufficient Evidence**; the verifiable statement notes the term is undefined and its application unclear (spec 03 §8, spec 08 §6).
- **Exclusion conflict** — where one document excludes what another appears to grant, or two exclusion clauses conflict on scope, a statement resolving the conflict is **Contradicted**; only a statement surfacing both with sources at Unclear verifies (spec 03 §10, spec 08 §10). Verification does not resolve exclusion conflicts.
- **Applicability boundary** — an exclusion statement may describe what the exclusion *says*, never whether it *applies to this horse's specific history* — the latter is a claims determination and any statement making it is **Unsupported** (spec 03 §16 Example 3, spec 04 §2).

---

## 10. Conflict Detection

Verification is also a conflict backstop — it re-checks for contradictions at the statement level, catching any that slipped the upstream conflict pass (spec 02 §11, spec 03 §10, spec 08):

- **Snippet-internal contradiction** — a statement whose own cited snippets disagree is **Contradicted** and blocked in resolved form.
- **Statement-vs-snippet contradiction** — the entailment check (§6A/§6B) catches where the statement asserts the opposite of, or more than, the snippet.
- **Cross-statement contradiction** — if two statements slated for the same report contradict each other and both cite valid sources, both are flagged and the conflict is surfaced to the consumer rather than one silently winning (spec 08 §10). Neither may be shown as Confirmed.
- **Materiality gate** — a contradiction on a non-coverage field immaterial to the statement (e.g., a conflicting premium figure in a coverage answer) does not block the coverage statement, consistent with spec 04 §13's immateriality carve-out. Verification records it but does not block on it.

Every detected contradiction produces a verification record naming both sources; verification never resolves which is correct (spec 08 §13).

---

## 11. Unsupported Answer Handling

When a statement is **Contradicted, Unsupported, or Insufficient Evidence**, it is blocked from affirmative display and handled in this order:

1. **Rescope if partially supported.** If part of the statement is Fully Supported, strip the unsupported portion and re-verify the remainder. If the remainder passes, show only the remainder (e.g., "coverage appears listed" instead of "coverage is included up to $X").
2. **Replace with a safe insufficient-evidence response.** If nothing survives rescoping, replace the statement with an explicit insufficient-evidence answer drawn from the spec 04 §15 patterns — e.g., "The uploaded documents don't contain enough information to answer that," "The relevant page is unreadable," "The uploaded documents conflict on this point." The replacement is itself a verifiable statement (its support is the *absence* or *conflict*, which is a real system-state finding).
3. **Route to review where §12 requires it.** Certain block cases (core-category contradictions, snippet-wording mismatches on core coverages) are routed to human review rather than auto-replaced, per §12.

Rules:
- A blocked statement is **never** shown in softened-but-still-affirmative form ("this is probably covered"). Blocking means the affirmative claim does not appear at all.
- The replacement response never fills the gap with general insurance knowledge (spec 01 §5, spec 04 §2).
- Blocking is expected and correct behavior, not an error — the product working as designed (spec 04 §15).

---

## 12. Review Routing Rules

Verification decides routing but not reviewer workflow (out of scope, §15). It routes a blocked statement to human review — rather than auto-replacing it — when any of the following holds (consistent with spec 08 §11):

- The statement is a **core-category coverage conclusion** (mortality, major medical, surgical, colic, theft, humane destruction) that came back **Contradicted** or **Unsupported** — a core answer failing verification warrants human eyes before it's silently replaced.
- An **entailment mismatch (§6A)** on a core coverage, limit, deductible, or exclusion statement.
- A **numeric contradiction (§7)** on a core-category figure.
- An **exclusion conflict (§9)** on a core category.
- The statement's block reason is ambiguous between "genuinely unsupported" and "supported by a snippet the extraction may have mis-scoped" — i.e., cases where a human could plausibly confirm support the automated check couldn't.

All other blocked statements (non-core, or clearly insufficient-evidence with no plausible support) are **auto-replaced** with the safe insufficient-evidence response (§11.2) and not queued.

Reviewer outcomes for routing purposes only (spec 08 §11): approve as-is, approve with lowered label/rescoped wording, or suppress with an insufficient-evidence message. A reviewer may never approve a statement above what its cited snippet supports — the entailment bar applies to human decisions too.

---

## 13. Verification JSON Shape Example

Illustrative verification record attached to one answer — a major-medical statement that overstated the source. Trimmed for readability.

```json
{
  "verification_id": "ver_medmaj_02",
  "statement_id": "ans_medmaj_02",
  "statement_text_checked": "Your policy covers all veterinary costs up to $7,500.",
  "verification_status": "Partially Supported",
  "binding": {
    "source_page": 6,
    "printed_page_number": "6 of 12",
    "source_snippet": "Major Medical: the Company will pay covered veterinary expenses up to $7,500, excluding routine and preventive care.",
    "policy_section": "Section III — Major Medical / Limits of Liability",
    "confidence_label": "Likely"
  },
  "entailment_findings": [
    {
      "pattern": "overstatement",
      "detail": "Snippet limits payment to 'covered' expenses and excludes routine/preventive care; statement asserts 'all veterinary costs'.",
      "action": "rescope"
    }
  ],
  "numeric_check": { "figure_stated": "$7,500", "figure_in_snippet": "$7,500", "match": true },
  "rescoped_statement": "Your policy appears to include Major Medical coverage up to $7,500, and does not cover routine or preventive care.",
  "rescope_reverified_status": "Fully Supported",
  "display_outcome": "show_rescoped",
  "routed_to_review": false,
  "confidence_is_not_legal_certainty": true
}
```

Second example — a core coverage statement contradicted by its snippet, routed to review:

```json
{
  "verification_id": "ver_mort_05",
  "statement_id": "ans_mort_05",
  "statement_text_checked": "Humane destruction is covered without any conditions.",
  "verification_status": "Contradicted",
  "binding": {
    "source_page": 4,
    "source_snippet": "Humane destruction is covered only when certified by a licensed veterinarian and, except in emergencies, with the Company's prior consent.",
    "policy_section": "Section IV — Humane Destruction",
    "confidence_label": "Unclear"
  },
  "entailment_findings": [
    {
      "pattern": "contradiction",
      "detail": "Snippet imposes veterinary certification and prior-consent conditions; statement asserts no conditions.",
      "action": "block"
    }
  ],
  "display_outcome": "blocked",
  "routed_to_review": true,
  "review_reason": "core_category_contradiction",
  "confidence_is_not_legal_certainty": true
}
```

---

## 14. Failure States

| Failure | Verification behavior |
|---|---|
| **Cited snippet does not support wording (§6A)** | Unsupported → block; route to review if core-category, else replace. |
| **Answer overstates policy language (§6B)** | Partially Supported → rescope to the supported claim and re-verify; block if overstatement inverts a limitation. |
| **Answer converts ambiguity into certainty (§6C)** | Insufficient Evidence → replace with ambiguity-preserving statement. |
| **Numeric limit mismatch (§7)** | Contradicted → block single-figure form; present both figures at Unclear or replace. |
| **Exclusion conflict (§9)** | Contradicted → block resolved form; surface both sources at Unclear. |
| **Missing endorsement (§8)** | Insufficient Evidence for terms → block strong form; only "Appears Listed / defining doc not found" verifies. |
| **Partial upload** | Statements depending on missing material are Insufficient Evidence; report carries completeness caveat (spec 08 §9); no Confirmed on affected statements. |
| **OCR uncertainty** | Snippet from band <75 caps verification at Insufficient Evidence unless independently legible/cross-verified (spec 02 §6, spec 08 §5). |
| **Missing binding element (page/snippet/section/label/status)** | Unsupported → block. |
| **Total verification failure (inputs malformed)** | Do not display the affected statements; surface system-state message rather than unverified content (spec 08 §13). |

In every failure state the default is identical to the rest of the pipeline: block the unsupported claim and be explicit about the gap; never soften-and-show, never fill from outside knowledge (spec 01 §5).

---

## 15. Out-of-Scope

This specification does **not** cover:

- **Reviewer UI, assignments, SLAs, queue operations, or workflow** — verification decides *what routes to review and why*; everything about *how* review is conducted is out of scope.
- **Answer/summary generation and wording** — verification checks and, at most, rescopes or replaces; it never authors new affirmative wording beyond the fixed insufficient-evidence patterns (spec 04 owns generation).
- **Confidence label assignment** — spec 08 assigns labels; verification consumes them and blocks/rescopes, but does not re-score confidence math.
- **Extraction, OCR, classification** — the snippets and refs verification checks against are produced by specs 02–03.
- **Report layout and display** — spec 05 owns rendering of verified statements and their labels.
- **The data model structure** — spec 07 owns object shapes; verification populates verification-status fields.
- **Legal interpretation** — verification checks document support only, never enforceability or claim outcome (spec 01 §4, spec 08 §2). "Confidence is not legal certainty" is carried on every verification record.
- **Persistence/infrastructure** — where verification records and the review queue live is an infrastructure decision, subject to spec 01 §14 retention constraints.

---

*End of v1.0 Answer Support Verification Specification. This document defines the final display gate that checks generated wording against cited source text; it blocks any unsupported, contradicted, or insufficient-evidence statement from consumer display, and introduces no new confidence vocabulary.*
