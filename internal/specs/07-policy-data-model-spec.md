# Horse Insurance Coverage Checkup™
## Policy Data Model Specification — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Implementation Reference
**Scope:** Structured internal data model only. Defines the normalized representation that sits *after* extraction/clause-classification and *before* answer generation and report rendering. Does not define application code, database schemas, migrations, extraction logic, answer logic, report logic, UI, or infrastructure.

---

## 1. Purpose

Extraction (spec 02) produces source-mapped raw text. Clause taxonomy (spec 03) classifies that text into typed clauses and typed relationships. Answer generation (spec 04) consumes structured, related, source-cited clauses and produces consumer answers. Report rendering (spec 05) lays those answers out.

This document defines the connective tissue between them: **the normalized policy data model** — the single, canonical in-memory representation of one analyzed upload that every downstream stage reads from and writes to. Its job is to hold everything the earlier stages produced in one consistent shape, so that answer generation and reporting never have to re-derive structure, re-parse text, or guess at relationships.

The model is a *representation*, not a *processor*. It stores state; it does not extract, classify, interpret, or decide. Every field in it originates from an upstream stage that already applied its own rules. In particular, this model does not relax, override, or reinterpret any rule in specs 01–06 — it exists to carry those decisions forward faithfully, including their confidence caps, conflict flags, missing-document flags, and detection-only scoping.

**Governing constraint (inherited, not new):** every substantive value in the model that describes policy content must trace to at least one `source_ref`. A value with no `source_ref` is invalid by construction — the same "no source, no answer" rule enforced at the extraction and answer layers, expressed here at the data layer. The model must make an unsupported value structurally impossible to represent as though it were supported.

---

## 2. Core Data Objects

The model is composed of the following object types. Each is defined in its own section below.

| Object | Role | Anchors To |
|---|---|---|
| **PolicyAnalysis** | Top-level container for one analyzed upload; holds everything else | The upload session |
| **Policy** | A single distinct policy detected within the upload | PolicyAnalysis |
| **Horse** | One insured animal | Policy |
| **Coverage** | One coverage category as represented for a policy/horse | Policy (and Horse, where per-horse) |
| **Clause** | One classified clause (carried from spec 03) | Coverage / Policy |
| **Exclusion** | One exclusion clause, specialized | Coverage(s) it affects |
| **Condition** | One condition / obligation / claim duty, specialized | Coverage(s) it affects |
| **SourceRef** | Source-mapping object (carried from spec 02) | Any object describing document content |
| **Conflict** | One detected conflict record (carried from specs 02/03) | The clauses/values it links |
| **MissingItem** | One missing-document or missing-relationship record | The coverage/clause it affects |
| **ReviewFlag** | One human-review or confidence-affecting flag | Any object |

**Structural principles:**
- One upload → one `PolicyAnalysis`.
- A `PolicyAnalysis` may contain more than one `Policy` (the `mixed_documents` case from spec 02 must be representable, not flattened into a single policy).
- Objects reference each other by ID, never by embedding a second mutable copy — a `Coverage` references its exclusions by `exclusion_id`, it does not own a private duplicate of the exclusion text. This mirrors the `related_clause_ids` bookkeeping model from spec 03 and prevents two divergent copies of the same clause.
- Every object that describes document content carries `source_refs` and a confidence value. Objects that describe *system state* (e.g., a `MissingItem`) carry `source_refs` where a source supports the observation (e.g., a declarations line naming a missing form) and may carry none where the observation is the *absence* of a source.

---

## 3. Policy-Level Fields

`PolicyAnalysis` (top-level container):

| Field | Type | Notes |
|---|---|---|
| `analysis_id` | string | Unique ID for this analysis run |
| `upload_id` | string | From the extraction output (spec 02); links back to the source upload session |
| `created_at` | timestamp | When the analysis was produced |
| `extraction_status` | enum | Carried verbatim from spec 02 (`complete` … `failed`) |
| `policies` | array<Policy> | One or more detected policies |
| `conflicts` | array<Conflict> | Analysis-wide conflicts (including cross-policy) |
| `missing_items` | array<MissingItem> | Analysis-wide missing documents/relationships |
| `review_flags` | array<ReviewFlag> | Analysis-wide review flags |
| `warnings` | array<string> | Carried from spec 02 consumer/QA warnings |
| `source_index` | array<SourceDocument> | The list of files/pages reviewed, for the report's source index (spec 05 §14) |

`Policy` (one distinct policy within the upload):

| Field | Type | Notes |
|---|---|---|
| `policy_id` | string | Unique within the analysis |
| `carrier_name` | ValueWithSource | Extracted carrier name; may be null-with-reason |
| `policy_number` | ValueWithSource | May be null-with-reason |
| `policy_period_effective` | ValueWithSource | Effective date, exact as written (spec 02 §7 normalization rules) |
| `policy_period_expiration` | ValueWithSource | Expiration date, exact as written |
| `named_insured` | ValueWithSource | As it appears on documents |
| `horses` | array<Horse> | Insured animals under this policy |
| `coverages` | array<Coverage> | Coverage categories represented for this policy |
| `clauses` | array<Clause> | All classified clauses belonging to this policy |
| `document_types_present` | array<string> | Detected doc types (declarations, policy_form, endorsement, …) |
| `is_in_force_indeterminate` | boolean | True when cancellation/renewal clauses make in-force status unclear from documents alone |

`ValueWithSource` is a small reusable shape used for any single extracted scalar: `{ value, source_refs[], confidence, review_flag_ids[], null_reason }`. When a value could not be extracted, `value` is null and `null_reason` explains why (e.g., `"not_found_in_upload"`, `"illegible"`, `"conflicting"`) — the model never represents a missing scalar as an empty string that could read as a real value.

---

## 4. Coverage-Level Fields

`Coverage` (one coverage category, per spec 03 §3 category list):

| Field | Type | Notes |
|---|---|---|
| `coverage_id` | string | Unique within the policy |
| `coverage_category` | enum | One of the spec 03 coverage categories (full_mortality, specified_perils_mortality, theft, humane_destruction, euthanasia, major_medical, surgical, emergency_colic_surgery, colic_medical_treatment, diagnostics, hospitalization, medication, veterinary_services, loss_of_use, liability, care_custody_control, breeding, unknown_coverage) |
| `coverage_status` | enum | One of the seven spec 04 §7 values: Included, Appears Listed, Limited, Excluded, Not Found, Unclear, Detection Only |
| `confidence_label` | enum | One of the four: Confirmed, Likely, Unclear, Not Found |
| `confidence_reason` | string | Human-readable justification (feeds spec 04 `confidence_reason`) |
| `applies_to_horse_ids` | array<string> | Which horses this coverage applies to; never assumed policy-wide (spec 03 §5) |
| `grant_clause_ids` | array<string> | Coverage grant clause(s) anchoring this coverage |
| `limit_ids` | array<string> | Linked limit clauses |
| `sublimit_ids` | array<string> | Linked sublimit clauses |
| `deductible_ids` | array<string> | Linked deductible clauses |
| `coinsurance_ids` | array<string> | Linked coinsurance clauses |
| `waiting_period_ids` | array<string> | Linked waiting-period clauses |
| `exclusion_ids` | array<string> | Linked exclusions |
| `condition_ids` | array<string> | Linked conditions/claim duties |
| `definition_ids` | array<string> | Linked definitions for material terms used in the coverage |
| `modifying_endorsement_ids` | array<string> | Endorsements/riders/amendments modifying this coverage |
| `conflict_ids` | array<string> | Conflicts touching this coverage |
| `missing_item_ids` | array<string> | Missing documents/relationships affecting this coverage |
| `detection_only` | boolean | True for spec 04 §10 categories; hard-caps analytical depth |
| `source_refs` | array<SourceRef> | Aggregate of the source refs supporting the coverage's existence |

**Rules:**
- `confidence_label` in the model must already respect every cap defined in specs 03–04. The model does not compute the cap; it stores the already-capped value and records *why* via `confidence_reason` and the presence of `conflict_ids` / `missing_item_ids`. If `detection_only` is true, `coverage_status` may only be `Detection Only` or `Unclear`, and `confidence_label` may be `Confirmed` **only** in the narrow sense of "detection itself is confirmed" (spec 04 §10) — never as a confirmation of terms.
- A `Coverage` whose only support is a declarations-page listing may not carry status `Included`; the strongest permissible status is `Appears Listed` (spec 04 §5).
- `grant_clause_ids` being empty means the category was named somewhere (e.g., declarations) but no coverage grant was found — this must surface as `Appears Listed` / `Not Found` per the upstream rules, never as `Included`.

---

## 5. Clause-Level Fields

`Clause` carries the spec 03 §13 clause object forward largely unchanged, so nothing classified upstream is lost at the model layer. Fields:

| Field | Type | Notes |
|---|---|---|
| `clause_id` | string | Stable, matches spec 03 |
| `clause_type` | enum | Spec 03 §2 clause type |
| `coverage_category` | enum\|null | If the clause is scoped to a category |
| `raw_text` | string | Verbatim source text (spec 02 normalization only; never paraphrased) |
| `normalized_text` | string | Whitespace-normalized only, meaning preserved |
| `plain_english_summary` | string | Consumer-safe summary (spec 03 §15 rules); may be empty until answer stage populates it |
| `source_ref` | SourceRef | Required — a clause with no source_ref is invalid |
| `confidence` | integer | Extraction/classification confidence (0–100), carried forward |
| `related_clause_ids` | array<string> | Two-way bookkeeping per spec 03 §4 |
| `modifies_clause_ids` | array<string> | For endorsements/riders/amendments (spec 03 §5) |
| `modified_by_clause_ids` | array<string> | Reverse of the above |
| `applies_to_horse_ids` | array<string> | Per-horse scope where applicable |
| `applies_to_policy_period` | string\|null | Period scope where applicable |
| `applies_to_coverage_categories` | array<string> | Categories the clause touches |
| `flags` | array<string> | Free-form upstream flags (e.g., `references_missing_form`, `low_ocr_quality`, `undefined_material_term`) |
| `conflict_ids` | array<string> | Conflicts involving this clause |
| `review_flag_ids` | array<string> | Review flags attached to this clause |
| `missing_related_clause_types` | array<string> | Expected-but-absent related clause types (spec 03 §11) |

**Rule:** the clause is the atomic unit of source truth in the model. `Coverage`, `Exclusion`, and `Condition` objects are *views/links over clauses* — they never store policy text that isn't also present on a `Clause`. This guarantees a single source of truth for every piece of source language.

---

## 6. Exclusion-Level Fields

`Exclusion` specializes a clause of `clause_type = exclusion` (or a claim-duty consequence cross-linked as an exclusion per spec 03 §6). It does not duplicate the clause text; it links to it and adds exclusion-specific structure.

| Field | Type | Notes |
|---|---|---|
| `exclusion_id` | string | Unique within the policy |
| `clause_id` | string | The underlying exclusion clause (source of truth for text) |
| `exclusion_category` | enum | From spec 03 §6 (pre_existing_condition, prior_illness_injury, prior_colic_gi_history, routine_preventive_care, elective_procedures, racing_breeding_use, competition_use, transportation, territory_limits, intentional_acts, neglect, misrepresentation, failure_to_give_notice, failure_to_obtain_prior_approval, failure_to_provide_vet_records, other) |
| `affects_coverage_ids` | array<string> | Every coverage this exclusion narrows/removes |
| `scope_note` | string | Plain-English scope, meaning-preserving (limiting words never smoothed away — spec 02 §8, spec 03 §15) |
| `depends_on_undefined_term` | boolean | True when scope hinges on a material term the documents don't define (confidence-lowering per spec 03 §8) |
| `definition_ids` | array<string> | Linked definitions clarifying the exclusion's terms, if present |
| `source_ref` | SourceRef | Inherited from the underlying clause; restated for direct access |
| `confidence` | integer | Carried from the underlying clause |
| `conflict_ids` | array<string> | Conflicts involving this exclusion |
| `review_flag_ids` | array<string> | Review flags |

**Rule:** an exclusion with `depends_on_undefined_term = true` may not contribute to a `Confirmed` answer about the coverage it affects — the model records the dependency so the answer stage enforces the cap (spec 03 §6 downgrade rule, spec 04 §4).

---

## 7. Condition / Obligation Fields

`Condition` specializes clauses that impose duties (spec 03 §7): claim notice, proof of loss, veterinary documentation, prior approval, euthanasia consent, necropsy, and general duties (protect/cooperate/preserve/mitigate).

| Field | Type | Notes |
|---|---|---|
| `condition_id` | string | Unique within the policy |
| `clause_id` | string | Underlying condition clause (source of truth for text) |
| `condition_type` | enum | claim_notice, proof_of_loss, veterinary_documentation, prior_approval, euthanasia_consent, necropsy, duty_to_protect, duty_to_cooperate, duty_to_preserve_evidence, duty_to_mitigate, other |
| `affects_coverage_ids` | array<string> | Coverages whose claim payability this condition bears on |
| `obligation_text` | string | Plain-English statement of the duty, meaning-preserving |
| `deadline_value` | ValueWithSource | The stated time limit, exact as written; null-with-reason if absent (never invented — spec 04 §2) |
| `is_mandatory` | boolean\|null | E.g., necropsy "may be required" (discretionary) vs "must" (mandatory); null if the documents don't make it determinable |
| `has_emergency_exception` | boolean | Captures emergency-exception language alongside prior-approval/euthanasia consent (spec 03 §7) |
| `emergency_exception_clause_id` | string\|null | The clause carrying the exception, if separate |
| `source_ref` | SourceRef | From underlying clause |
| `confidence` | integer | Carried from underlying clause |
| `conflict_ids` | array<string> | Conflicts involving this condition |
| `review_flag_ids` | array<string> | Review flags |

**Rule (inherited from spec 03 §7):** a condition being present does *not* make coverage "Not Found." Conditions affect *payability*, not *existence*. The model keeps `Condition` objects linked to coverages via `affects_coverage_ids` without lowering the coverage's existence status on account of a duty — while still ensuring the duty is surfaced in scenario/claim-duty answers (spec 04 §14). A `deadline_value` with a null value must never be rendered downstream as a concrete deadline.

---

## 8. Source Mapping Fields

`SourceRef` is carried **verbatim** from spec 02 §5 — the model introduces no new source-mapping shape and must stay byte-compatible with the extraction output so citations round-trip without transformation:

```
SourceRef = {
  upload_id,
  file_name,
  system_page_number,
  printed_page_number,      // null if not detected
  document_type,            // declarations | policy_form | endorsement | vet_record | invoice | renewal_notice | unknown
  section_heading,          // null if none
  clause_heading,           // null if none
  paragraph_index,
  line_range,
  text_snippet,             // verbatim excerpt (source quote)
  confidence                // extraction confidence for this unit (0–100)
}
```

`SourceDocument` (for the report's source index, spec 05 §14):

| Field | Type | Notes |
|---|---|---|
| `file_id` | string | From spec 02 |
| `file_name` | string | As uploaded |
| `file_type` | enum | pdf / jpg / png / heic |
| `page_count` | integer | |
| `document_types_detected` | array<string> | Per-file detected doc types |
| `ocr_quality_score` | integer\|null | Null for native-text files |

**Rules:**
- Every object describing policy content exposes its supporting `SourceRef`(s). Where an object aggregates several clauses (a `Coverage`), it exposes the union of the underlying clauses' refs.
- `source page`, `source quote`, and `confidence score` requested for the model map directly to `system_page_number`/`printed_page_number`, `text_snippet`, and `confidence` on `SourceRef` — no separate parallel fields are introduced, to avoid two divergent notions of "the source."
- `policy section` maps to `section_heading` / `clause_heading` on `SourceRef`, and `applies_to_coverage_categories` / `coverage_category` on the `Clause` — the model preserves both the document's structural location and the normalized coverage relationship.

---

## 9. Confidence / Review Fields

The model uses exactly the confidence vocabulary already defined upstream — **no new tiers, synonyms, or numeric-to-label remapping is introduced here** (spec 05 §3):

- **Labels** (`confidence_label`): Confirmed / Likely / Unclear / Not Found.
- **Numeric scores** (`confidence` on clauses/source_refs): 0–100, carried from extraction/OCR (spec 02 §6). Numeric scores *inform* labels upstream; the model stores both but never re-derives a label from a score on its own.

`ReviewFlag` (one flag affecting confidence or requiring human review):

| Field | Type | Notes |
|---|---|---|
| `review_flag_id` | string | Unique within the analysis |
| `flag_type` | enum | low_ocr_quality, conflicting_values, references_missing_form, undefined_material_term, duplicate_page, cropped_page, mixed_documents, handwriting_low_confidence, checkbox_ambiguous, detection_only_category, out_of_scope_request, other |
| `severity` | enum | info / caps_confidence / blocks_confirmed |
| `caps_confidence_at` | enum\|null | The highest label still permissible given this flag (e.g., `Likely`, `Unclear`); null for info-only |
| `description` | string | Plain-English reason |
| `attached_object_type` | enum | policy / coverage / clause / exclusion / condition / source_document |
| `attached_object_id` | string | The object this flag qualifies |
| `source_refs` | array<SourceRef> | Where a source supports the flag (may be empty for absence-based flags) |

**Rules:**
- A `ReviewFlag` with `severity = blocks_confirmed` on any object contributing to a coverage/answer makes `Confirmed` impermissible for that answer — mirroring the spec 04 §4 governing constraints (missing form, conflict, poor OCR, detection-only). The model stores the flag and the resulting cap; it does not silently drop either.
- `caps_confidence_at` gives the answer stage a machine-readable ceiling so the cap is applied consistently rather than re-argued per answer.
- Review flags are additive: the effective ceiling for an answer is the **lowest** ceiling among all flags touching its contributing objects (the "weakest link" rule from spec 04 §11).

---

## 10. JSON Shape Example

Illustrative only — a single-horse policy with confirmed mortality, a declarations-only major-medical listing (missing endorsement), and a deductible conflict. Trimmed for readability; real objects carry full `SourceRef`s.

```json
{
  "analysis_id": "an_001",
  "upload_id": "up_8842",
  "extraction_status": "mostly_complete",
  "policies": [
    {
      "policy_id": "pol_1",
      "carrier_name": { "value": "Example Equine Mutual", "source_refs": ["…"], "confidence": 97, "null_reason": null },
      "policy_number": { "value": "EQ-100-44821", "source_refs": ["…"], "confidence": 96, "null_reason": null },
      "policy_period_effective": { "value": "04/01/2026", "source_refs": ["…"], "confidence": 96, "null_reason": null },
      "policy_period_expiration": { "value": "04/01/2027", "source_refs": ["…"], "confidence": 96, "null_reason": null },
      "named_insured": { "value": "Jane Doe", "source_refs": ["…"], "confidence": 98, "null_reason": null },
      "horses": [
        { "horse_id": "h_1", "name": { "value": "Comet", "confidence": 97 },
          "breed": { "value": "Quarter Horse", "confidence": 95 },
          "age": { "value": "9", "confidence": 94 },
          "insured_value": { "value": "$20,000", "confidence": 97 } }
      ],
      "coverages": [
        {
          "coverage_id": "cov_mort",
          "coverage_category": "full_mortality",
          "coverage_status": "Included",
          "confidence_label": "Confirmed",
          "confidence_reason": "Grant + limit + humane-destruction condition all found, no conflicts.",
          "applies_to_horse_ids": ["h_1"],
          "grant_clause_ids": ["cl_mort_grant"],
          "limit_ids": ["cl_mort_limit"],
          "condition_ids": ["cond_humane"],
          "exclusion_ids": [],
          "conflict_ids": [],
          "missing_item_ids": [],
          "detection_only": false
        },
        {
          "coverage_id": "cov_medmaj",
          "coverage_category": "major_medical",
          "coverage_status": "Appears Listed",
          "confidence_label": "Likely",
          "confidence_reason": "Listed on declarations; defining endorsement not found in upload.",
          "applies_to_horse_ids": ["h_1"],
          "grant_clause_ids": [],
          "limit_ids": ["cl_medmaj_limit_dec"],
          "deductible_ids": ["cl_ded_dec", "cl_ded_end"],
          "conflict_ids": ["cf_ded"],
          "missing_item_ids": ["mi_medmaj_endorsement"],
          "detection_only": false
        }
      ]
    }
  ],
  "conflicts": [
    {
      "conflict_id": "cf_ded",
      "conflict_type": "deductible_mismatch",
      "description": "Deductible appears as $250 (declarations) and $500 (endorsement) for major medical.",
      "related_clause_ids": ["cl_ded_dec", "cl_ded_end"],
      "related_source_refs": ["…", "…"],
      "affected_coverage_ids": ["cov_medmaj"]
    }
  ],
  "missing_items": [
    {
      "missing_item_id": "mi_medmaj_endorsement",
      "missing_type": "referenced_form_not_uploaded",
      "description": "Declarations references a Major Medical Endorsement not found in the upload.",
      "affected_coverage_ids": ["cov_medmaj"],
      "source_refs": ["…"]
    }
  ],
  "review_flags": [
    {
      "review_flag_id": "rf_ded_conflict",
      "flag_type": "conflicting_values",
      "severity": "blocks_confirmed",
      "caps_confidence_at": "Unclear",
      "description": "Conflicting deductible values for major medical.",
      "attached_object_type": "coverage",
      "attached_object_id": "cov_medmaj"
    }
  ]
}
```

---

## 11. Validation Rules

The model is valid only if all of the following hold. These are integrity checks on the representation — they assume upstream stages already applied their own rules; they catch cases where the model would misrepresent that upstream state.

1. **Source presence** — every `Coverage`, `Clause`, `Exclusion`, `Condition`, and every non-null `ValueWithSource` describing policy content has at least one `source_ref`. Absence-based objects (`MissingItem`) are exempt where they record the absence of a source.
2. **No orphan links** — every ID referenced (`grant_clause_ids`, `exclusion_ids`, `affects_coverage_ids`, `clause_id`, `conflict_ids`, etc.) resolves to an existing object in the same analysis.
3. **Two-way linkage** — if clause A lists B in `related_clause_ids` / `modifies_clause_ids`, then B lists A in the reciprocal field (spec 03 §4/§5). If an `Exclusion` lists a coverage in `affects_coverage_ids`, that coverage lists the exclusion in `exclusion_ids`.
4. **Text single-sourcing** — `Exclusion`, `Condition`, and `Coverage` objects contain no policy text that isn't present on a linked `Clause`. The clause is the only place raw/normalized source text lives.
5. **Vocabulary conformance** — `coverage_status` ∈ the seven spec 04 §7 values; `confidence_label` ∈ the four spec 04 §4 values; every enum field uses only its defined members. No synonyms, no new tiers.
6. **Declarations-only ceiling** — any `Coverage` whose supporting clauses are all `document_type = declarations` has `coverage_status` ≠ `Included` and `confidence_label` ≠ `Confirmed` (spec 04 §5).
7. **Missing-form cap** — any `Coverage`/`Clause` carrying a `references_missing_form` flag, or linked to a `MissingItem` of that type, has `confidence_label` ≠ `Confirmed` (spec 04 §4).
8. **Conflict cap** — any `Coverage`/answer-contributing object linked to a `Conflict` has `confidence_label` ≠ `Confirmed` (spec 04 §13), unless the conflict is explicitly recorded as immaterial to that object.
9. **Detection-only cap** — any `Coverage` with `detection_only = true` has `coverage_status` ∈ {`Detection Only`, `Unclear`} and never receives a terms-level `Confirmed` (spec 04 §10).
10. **Confidence-ceiling consistency** — for any object, its `confidence_label` is no higher than the lowest `caps_confidence_at` among all `ReviewFlag`s attached to it or to objects it depends on (weakest-link rule, spec 04 §11).
11. **Null-value integrity** — every `ValueWithSource` with `value = null` has a non-empty `null_reason`, and no null value is ever emitted downstream as a concrete figure, date, or deadline (spec 04 §2).
12. **Per-horse integrity** — a `Coverage` scoped to specific horses lists them in `applies_to_horse_ids`; values from one horse's schedule row are never linked to another horse's coverage (spec 02 §9, spec 03 §3 horse-schedule rule).
13. **Confidence range** — every numeric `confidence` is an integer 0–100.
14. **Policy separation** — where `extraction_status = mixed_documents`, more than one `Policy` object exists, or a `ReviewFlag` of type `mixed_documents` is present; content from apparently distinct policies is not merged into one `Policy`.

A model failing any of these is invalid and must not be passed to answer generation — the failure itself is surfaced as a `ReviewFlag`/warning rather than silently corrected.

---

## 12. Out-of-Scope

This specification does **not** cover, and downstream implementers must not infer from it:

- **Application/database code** — no table schemas, migrations, ORM models, indexes, or storage-engine choices. The model here is a logical representation; its persistence (if any) is an infrastructure decision, subject to the sensitive-document retention constraints in spec 01 §14.
- **Extraction logic** — how text, pages, tables, and OCR scores are produced (spec 02).
- **Clause classification logic** — how clause types and relationships are decided (spec 03).
- **Answer generation logic** — how labels, statuses, and consumer answers are produced from the model (spec 04). This document defines the *shape* answers read from, not the *rules* that produce them.
- **Report layout/rendering** — how the model is displayed or turned into a PDF (spec 05).
- **Upload flow** — how documents are collected (spec 06).
- **Confidence *computation*** — the model stores already-decided labels/caps and validates their consistency; it does not define the algorithm that assigns them.
- **UI, styling, frontend components, and infrastructure** — entirely out of scope.
- **Detection-only category deep analysis** — remains out of MVP scope (spec 03 §3, spec 04 §10); the model can represent these categories' presence but must not be extended here to model their full terms.

---

*End of v1.0 Policy Data Model Specification. This document defines the normalized internal representation bridging extraction/classification (specs 02–03) and answer/report generation (specs 04–05); it introduces no new rules, only a faithful structure for carrying existing ones.*
