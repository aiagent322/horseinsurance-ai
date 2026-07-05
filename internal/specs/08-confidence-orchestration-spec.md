# Horse Insurance Coverage Checkup™
## Confidence Orchestration Specification — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Implementation Reference
**Scope:** Confidence scoring and review routing only. Defines how already-extracted facts, clauses, relationships, exclusions, source mappings, answers, and report sections are scored, capped, flagged, and routed before a consumer sees them. Does not define extraction, classification, answer wording, report layout, UI, or legal interpretation.

---

## 1. Purpose

The data model (spec 07) stores confidence labels and caps but explicitly does **not** define the logic that assigns them. This document owns that logic. It defines how the system decides, for every fact and every answer, which of the four confidence labels applies, when a value must be capped below its apparent strength, and when a fact or answer must be routed to human review instead of shown directly.

Confidence orchestration exists because groundedness is the product's central promise (spec 01 §2). A pipeline that extracts cleanly but scores confidence carelessly will still produce confident-sounding wrong answers — the exact failure mode specs 02–04 were written to prevent. Orchestration is the layer that makes "no source, no answer" and the confidence caps in specs 03–04 operate as one consistent, auditable mechanism rather than as rules re-argued independently at each stage.

Orchestration is a *scoring and routing* function. It does not read documents, does not reword answers, and does not interpret contract meaning. It takes structured inputs that upstream stages already produced, applies deterministic scoring and capping rules, attaches review flags, and routes each unit to one of three destinations: **show directly**, **show with caveat**, or **hold for human review**.

**Governing constraint:** orchestration may only ever *lower* confidence relative to what raw inputs suggest — never raise it. There is no rule anywhere in this spec by which a weakly-supported fact becomes more confident through processing. Confidence flows downhill only.

---

## 2. What Confidence Means

Confidence in this system is a measure of **how well the uploaded documents support a statement** — nothing more. It is explicitly **not**:

- a measure of whether a claim will be paid,
- a measure of whether coverage is adequate, wise, or competitive,
- a legal opinion on enforceability, or
- a prediction of carrier behavior.

Confidence answers one question only: *given what was uploaded, how directly and unambiguously do those documents support this specific statement?* A "Confirmed" mortality answer means the documents clearly say what the answer says — not that any real-world mortality claim would succeed (spec 04 §11).

The system uses exactly the four labels defined upstream and introduces no others (spec 03 §9, spec 04 §4, spec 05 §3, spec 07 §9): **Confirmed, Likely, Unclear, Not Found.** Numeric scores (0–100) exist only as *inputs* that inform label assignment; they are never shown to the consumer as a confidence percentage, and a numeric score never overrides a categorical cap.

**Confidence is not legal certainty.** Even a "Confirmed" label describes document support, not legal or factual truth about a future claim. This distinction is load-bearing and must be preserved in every routing and flagging decision below.

---

## 3. Confidence Inputs

Orchestration consumes the following, all produced upstream:

| Input | Source | Role in scoring |
|---|---|---|
| Extraction confidence (0–100) | spec 02 clause/block confidence | Base signal for field- and clause-level scoring |
| OCR quality score (0–100, banded) | spec 02 §6 | Caps confidence for anything sourced from a low-band page |
| `source_ref` presence + `text_snippet` | spec 02 §5 | A missing snippet is a hard cap (see §7) |
| Clause type + classification confidence | spec 03 §2 | Unknown/ambiguous clause types lower confidence |
| Coverage relationships (`related_clause_ids`, `modifies_*`) | spec 03 §4/§5 | Missing expected relationships cap confidence |
| Conflict records | spec 02 §11, spec 03 §10, spec 07 Conflict | Any material conflict blocks Confirmed |
| Missing-item records | spec 03 §11, spec 07 MissingItem | Missing referenced form blocks Confirmed |
| Detection-only flag | spec 03 §3, spec 04 §10 | Blocks terms-level Confirmed |
| Undefined-material-term flag | spec 03 §8 | Lowers to Likely/Unclear |
| Extraction status | spec 02 §14 | Partial/poor/mixed statuses cap report-level confidence |

Orchestration never invents a signal not present in this list. If a signal is absent, its absence is itself treated as a downgrade trigger where the rules below specify — never as a neutral "assume fine."

---

## 4. Field-Level Confidence

Applies to individual extracted scalars (`ValueWithSource` in spec 07 §3): carrier name, policy number, dates, named insured, insured value, individual limits/deductibles.

Scoring:

| Condition | Resulting label |
|---|---|
| Single value, native text or OCR ≥90, one unambiguous source, no conflict | **Confirmed** |
| Value present but sourced from OCR band 75–89, or requires reading a slightly ambiguous field | **Likely** (capped below Confirmed) |
| Same field shows two different values across documents; OCR band 50–74; field partly illegible | **Unclear** |
| No source text contains the field | **Not Found** (value = null, `null_reason` set — spec 07 §11) |

Rules:
- A field with `value = null` is always **Not Found**; it may never be emitted as a real figure or date (spec 04 §2).
- A field appearing in two places with two different values is **Unclear** and generates a conflict flag (§10) — orchestration does not pick a winner (spec 04 §13).
- A field sourced only from a declarations page is still eligible for Confirmed *as a stated declarations value* (e.g., "the declarations page states the insured value is $20,000"), but this does not lift any coverage-level ceiling — see §6.

---

## 5. Clause-Level Confidence

Applies to each classified clause (spec 03/07 Clause).

Base score = the clause's extraction/classification confidence, then capped by:

| Trigger | Cap |
|---|---|
| Clause sourced from OCR band 50–74 | ≤ Unclear |
| Clause sourced from OCR band 75–89 | ≤ Likely |
| Clause type = `unknown_clause` | ≤ Unclear; routed to review (§11) |
| `text_snippet` missing/empty for the clause | ≤ Unclear and flagged (§7) |
| Clause carries `references_missing_form` | ≤ Likely; blocks Confirmed on dependents |
| Clause uses a material term the documents don't define (`undefined_material_term`) | ≤ Likely |
| Low-confidence handwriting (spec 02 §3H) | excluded from Confirmed-eligible clause data |

Rules:
- A clause's label is the **minimum** of its base score band and every cap triggered above (weakest-link, applied at clause scope).
- An exclusion clause whose scope `depends_on_undefined_term` (spec 07 §6) is capped at Likely for any coverage it affects — orchestration propagates this cap to the coverage in §6.
- Clause-level scoring never raises a clause above its extraction confidence band.

---

## 6. Coverage Relationship Confidence

Applies to a `Coverage` object, assembled from a grant plus its linked limits, deductibles, exclusions, conditions, definitions, and endorsements (spec 03 §4, spec 07 §4).

A coverage's confidence is the **weakest link** across every clause required to answer about it — never the strongest, and never an average:

1. Collect all contributing clauses (grant + all linked modifiers relevant to the question scope).
2. Take each clause's capped label from §5.
3. Apply coverage-level caps:

| Condition | Cap |
|---|---|
| No coverage grant found; only a declarations listing | ≤ **Likely**, status ≤ `Appears Listed` (spec 04 §5) |
| A required related form is missing (`MissingItem` of referenced-form type) | ≤ Likely; **Confirmed blocked** |
| Any material conflict touches a contributing clause | ≤ Unclear; **Confirmed blocked** (spec 04 §13) |
| Coverage is detection-only | status ∈ {Detection Only, Unclear}; terms-level Confirmed blocked (spec 04 §10) |
| A linked exclusion depends on an undefined term | ≤ Likely for that coverage |
| Expected exclusions/conditions could not be located | ≤ Likely **and** review flag "coverage picture may be incomplete" (spec 03 §11, spec 04 §14) |

4. The coverage's final label = the lowest label surviving steps 2–3.

Rule: a coverage may be **Confirmed** only if grant + applicable limit + any material exclusions/conditions are all present, all ≥ their required bands, with no conflict, no missing form, and not detection-only (spec 04 §4). This is a conjunction — failing any one drops it to the next-lowest surviving label.

---

## 7. Source Mapping Confidence

Applies to the `source_ref` backing any statement (spec 02 §5, spec 07 §8).

- **Missing source quote (`text_snippet` empty/absent):** the statement is capped at **Unclear** and flagged `missing_source_quote`. A statement with *no* source_ref at all is **Not Found** and cannot be shown as an answer (spec 02 §5, spec 04 §5) — it is held, not displayed.
- **Weak OCR/extraction confidence:** the source_ref's own `confidence` propagates the OCR band caps from §5. A source_ref with confidence <25 (spec 02 bands 1–24 / 0) is not usable for answer generation; anything relying on it becomes Not Found for that point.
- **Declarations-only source:** may support "Appears Listed" statements but may never alone support exclusions, claim duties, or scenario outcomes (spec 04 §5). Orchestration enforces this by refusing Confirmed to any exclusion/condition/scenario statement whose only source_refs are `document_type = declarations`.
- **Snippet-statement mismatch:** if a statement's wording is not supported by its cited `text_snippet`, the statement is held for review (`unsupported_direct_answer`, §10) rather than shown. Orchestration checks that a citation actually backs the claim, not merely that a citation exists.

---

## 8. Answer Confidence

Applies to each consumer-facing answer (spec 04 §16 answer object).

An answer's confidence = the **weakest link** among all clauses, coverages, and source_refs it draws on (spec 04 §11). Rules:

- An answer inherits every cap from the coverages (§6) and clauses (§5) it cites. It can be no more confident than its least-supported contributing element.
- **Scenario answers** are always multi-clause and take the minimum across coverage + exclusions + limits + conditions + missing items (spec 04 §11). A single weak or missing component drops the whole scenario answer.
- **Unsupported direct answers** — any answer that cannot cite a source_ref for a substantive claim, or whose snippet doesn't support its wording (§7), is **not shown**. It is either downgraded to an explicit "not found / not enough in the documents" answer (spec 04 §15) or held for review, per the routing table in §12.
- **Unclear coverage limits** — where two limit figures conflict, the answer states both figures with both sources at **Unclear** and never resolves which applies (spec 04 §13).
- **Ambiguous exclusions** — an exclusion whose scope depends on an undefined term, or whose applicability is genuinely ambiguous, caps the answer at Likely (scope readable but interpretation-dependent) or Unclear (genuinely ambiguous), and the ambiguity is stated in the answer, not smoothed over (spec 03 §6, spec 04 §14).
- Orchestration populates the answer object's `confidence_label`, `confidence_reason`, and review routing; it does not write `direct_answer` or `consumer_safe_summary` wording (that is spec 04's job).

---

## 9. Report Confidence

Applies to whole report sections and the report as a unit (spec 05 §2 sections).

- Each report section inherits the **lowest** confidence among the answers/coverages it contains. A section is only as strong as its weakest displayed item.
- **Low-confidence report sections** (a section where the majority of items are Unclear/Not Found, or any core item is held for review) must be marked at section level so the reader isn't left inferring reliability from individual rows alone. The section is not suppressed — it is labeled and its gaps stated (spec 05 §3/§4).
- **Partial policy uploads** — where `extraction_status` is `partial`, `poor_quality`, `mixed_documents`, `needs_more_documents`, or `unreadable` (spec 02 §14), the report carries an overall completeness caveat, and no section dependent on the missing/unreadable material may present Confirmed answers.
- Report-level confidence never exceeds the extraction status ceiling: e.g., a `partial` extraction cannot yield an "everything confirmed" report even if the pages that *were* read are clean.
- The report must display confidence/status as visible words next to each item (spec 05 §3) — orchestration supplies the label; rendering is spec 05.

---

## 10. Review Flags

Orchestration raises `ReviewFlag` objects (spec 07 §9) with a machine-readable ceiling (`caps_confidence_at`) and severity. Flag types and their effect:

| Flag type | Trigger | Severity / ceiling |
|---|---|---|
| `missing_source_quote` | Statement's `text_snippet` empty/absent | caps_confidence → Unclear |
| `no_source_ref` | Statement has no source_ref at all | blocks display → held (Not Found) |
| `low_ocr_quality` | Contributing page OCR band <75 | caps → Likely (75–89) / Unclear (50–74) / Not Found (<25) |
| `conflicting_values` | Two different values for the same field/limit/deductible | blocks_confirmed → Unclear |
| `references_missing_form` | Declarations/endorsement references an absent form | blocks_confirmed → Likely |
| `partial_upload` | Extraction status partial/needs_more_documents | caps report section → Likely |
| `unclear_coverage_limit` | Limit ambiguous or conflicting | blocks_confirmed → Unclear |
| `ambiguous_exclusion` | Exclusion scope undefined/ambiguous | caps → Likely or Unclear |
| `unsupported_direct_answer` | Answer wording not backed by cited snippet | blocks display → held |
| `undefined_material_term` | Material term used but not defined | caps → Likely |
| `detection_only_category` | Category is detection-only | blocks terms-level Confirmed |
| `mixed_documents` | Upload spans >1 policy | blocks_confirmed cross-policy answers; routes to review |
| `unknown_clause` | Clause couldn't be classified | caps → Unclear; routes to review |

Rules:
- Flags are **additive**: the effective ceiling on any answer is the lowest `caps_confidence_at` among all flags touching its contributing objects (weakest-link, spec 04 §11 / spec 07 §9).
- Every flag carries a plain-English `description` and the `attached_object_id` it qualifies, so the audit trail shows *why* a cap was applied.
- Any answer based on missing, weak, conflicting, or ambiguous source text carries at least one flag — a downgraded answer with no flag explaining the downgrade is itself an error.

---

## 11. Human Review Queue Rules

Some items are not merely capped — they are **held** from direct display and routed to a human review queue. Orchestration decides routing; it does not define the reviewer UI or workflow (out of scope, §15).

Route to human review when any of the following is true:

- An answer would be **held** per §10 (`no_source_ref`, `unsupported_direct_answer`).
- A `conflicting_values` flag touches a **core** coverage answer (mortality, major medical, surgical, colic, theft, humane destruction) — surface-level conflicts on non-core fields (e.g., premium) do not require review.
- Extraction status is `mixed_documents` or `unreadable`.
- An `unknown_clause` sits on a clause that would otherwise be a coverage grant, limit, deductible, exclusion, or claim-duty for a core category.
- A statement's snippet-to-wording check (§7) fails.

Items that are merely capped (Likely/Unclear with a clear, source-cited reason) are **not** routed to review — they are shown with their caveat. Review is reserved for cases where showing the item directly would risk presenting unsupported or misleading content, not for ordinary low confidence.

Reviewer outcomes (for routing purposes only): **approve as-is**, **approve with lowered label**, or **suppress with a "not found / could not confirm" message**. A reviewer may never *raise* a label above what the source supports — the downhill-only rule (§1) applies to humans too.

---

## 12. Confidence Thresholds

The routing decision for any item resolves to one of three destinations:

| Effective label after all caps | Destination |
|---|---|
| **Confirmed** | Show directly |
| **Likely** | Show with caveat (source-cited reason stated inline) |
| **Unclear** | Show with caveat **unless** a §11 review trigger applies → then hold for review |
| **Not Found** | Show as an explicit "not found in your documents" statement (spec 04 §15), never blank |
| Held (no_source_ref / unsupported_direct_answer) | Hold for human review; never shown until resolved |

Threshold rules:
- Thresholds are categorical, not numeric — there is no "72% = show" cutoff exposed to the consumer. Numeric scores feed label assignment (§4–§8); the label drives routing.
- The destination for any composite item (answer, section) is governed by its **weakest** contributing element (spec 04 §11).
- No item routes to "show directly" while carrying an unresolved `blocks_confirmed` or `blocks display` flag.

---

## 13. Failure States

| Failure | Orchestration behavior |
|---|---|
| **Missing source quote** | Cap at Unclear, flag `missing_source_quote`; if no source_ref at all, hold as Not Found. |
| **Weak OCR / extraction** | Apply band caps (§5/§7); <25 confidence source is unusable → Not Found for that point. |
| **Conflicting clauses** | Never resolve; present both with sources at Unclear; route core-category conflicts to review (§11). |
| **Partial policy upload** | Apply completeness caveat at report level (§9); block Confirmed on anything depending on missing material. |
| **Unclear coverage limits** | State all conflicting figures with sources at Unclear; never select one (spec 04 §13). |
| **Ambiguous exclusions** | Cap at Likely/Unclear; state the ambiguity explicitly; never guess scope from industry norms (spec 03 §8). |
| **Unsupported direct answer** | Do not show; convert to an explicit insufficient-source statement or hold for review (§11). |
| **Low-confidence report section** | Mark the section's confidence at the level of its weakest item; state what could not be confirmed (§9). |
| **Total orchestration failure** (inputs malformed/absent) | Do not emit a report; surface a system-level "analysis could not be completed" state (spec 06 §3) rather than a partial, unscored report. |

In every failure state, the default is to **lower confidence and be explicit about the gap**, never to fill it. Silence-with-explanation beats an inferred answer (spec 01 §5).

---

## 14. JSON Shape Example

Illustrative orchestration output attached to one answer — a colic-surgery answer downgraded by a missing referenced endorsement. Trimmed for readability.

```json
{
  "answer_id": "ans_colic_01",
  "answer_type": "coverage_existence",
  "assigned_confidence_label": "Likely",
  "confidence_reason": "Colic surgery listed on declarations and an endorsement is referenced, but that endorsement was not found in the upload; sublimit and exclusions could not be confirmed.",
  "weakest_link": {
    "object_type": "coverage",
    "object_id": "cov_colic",
    "label_before_caps": "Confirmed",
    "label_after_caps": "Likely"
  },
  "caps_applied": [
    { "flag_type": "references_missing_form", "ceiling": "Likely", "attached_object_id": "cov_colic" }
  ],
  "contributing_source_refs": ["sr_dec_colic_line"],
  "routing_decision": "show_with_caveat",
  "held_for_review": false,
  "review_reason": null,
  "confidence_is_not_legal_certainty": true
}
```

Second example — an answer held for review because its wording isn't backed by its snippet:

```json
{
  "answer_id": "ans_mortality_03",
  "assigned_confidence_label": "Unclear",
  "confidence_reason": "Cited snippet does not support the stated humane-destruction condition; requires human review before display.",
  "caps_applied": [
    { "flag_type": "unsupported_direct_answer", "ceiling": null, "attached_object_id": "ans_mortality_03" }
  ],
  "routing_decision": "hold_for_review",
  "held_for_review": true,
  "review_reason": "snippet_wording_mismatch",
  "confidence_is_not_legal_certainty": true
}
```

---

## 15. Out-of-Scope

This specification does **not** cover:

- **Legal interpretation** — orchestration scores document support, never enforceability, bad faith, or claim outcome (spec 01 §4, spec 04 §2). "Confidence is not legal certainty" is a hard boundary of this spec.
- **Answer/summary wording** — orchestration assigns labels and routing; the plain-English text of answers and summaries belongs to spec 04.
- **Report layout, styling, color, and display of labels** — spec 05 owns rendering; this spec only supplies the label and routing decision.
- **UI for the human review queue** — reviewer screens, assignment, SLAs, and tooling are out of scope; this spec defines only *what routes to review and why*.
- **Extraction, OCR, and classification logic** — the signals consumed here are produced by specs 02–03; orchestration does not re-derive them.
- **The data model's structure** — spec 07 owns the object shapes; this spec populates their confidence/flag fields.
- **Numeric threshold tuning as consumer-facing output** — internal numeric scores are inputs only and are never shown as a confidence percentage to the consumer.
- **Persistence/infrastructure** — where scored output and review-queue state live is an infrastructure decision, subject to the spec 01 §14 retention constraints.

---

*End of v1.0 Confidence Orchestration Specification. This document defines the scoring, capping, flagging, and routing logic that spec 07 deliberately left unspecified; it introduces no new confidence vocabulary and only lowers confidence, never raises it.*
