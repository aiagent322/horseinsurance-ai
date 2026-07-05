# Horse Insurance Coverage Checkup™
## Phase 1 — Persistence Schema Model — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Schema Modeling (pre-implementation)
**Scope:** A **proposed** persistence model only. Describes the tables, storage areas, ownership, isolation, and retention *design* that a later migration would implement. Creates no migration, no table, no bucket, no auth config, no code. Every implementation action is separately gated (§15).

---

## 1. Purpose

Spec 14 §5 names the persistence schema as the first build artifact, and spec 15 approved Phase 1 *planning* (Supabase Auth, conservative retention, manual internal review). This document is that planning: a schema **model** derived from the spec 07 object model, spec 11 storage responsibilities, and spec 12 ownership/isolation rules, so the design can be reviewed before any migration is written.

Nothing here is executed. It is a design a reviewer can check against the specs and approve (or amend) before implementation begins. The document deliberately stops at "here is the proposed shape and the constraints it must satisfy" — it does not write DDL, does not create anything in Supabase, and does not start any downstream build (§16, §15).

**Governing constraint:** this is a model, not an implementation. Producing it starts no migration, bucket, auth, backend, frontend, or deployment work (spec 15 §8). Phase 1 implementation actions each wait on their own approval gate (§15).

---

## 2. Source Specs

| Spec | What this model draws from it |
|---|---|
| **07 — Policy Data Model** | The object types to persist (`PolicyAnalysis`, policies, horses, coverages, clauses, exclusions, conditions, source_refs, conflicts, missing items, review flags), their fields, and the clause-as-single-source-of-truth rule |
| **11 — Backend & Infrastructure** | Storage responsibility (DB vs. private object storage), the confidence-band config, retention posture, and audit-record storage |
| **12 — Auth, Account & Isolation** | The identity model (`user_id`/`account_id`), ownership on every artifact, per-user isolation, owner-not-null, role-limited audited reviewer access |
| **15 — Production Decision Checklist** | Approved defaults: Supabase Auth (planning), conservative retention with no indefinite policy-file retention, manual internal review |

This model introduces no requirement not present in those specs; it only proposes a persistence shape for them.

---

## 3. Schema Modeling Assumptions

- **Provider:** modeled against a managed Postgres + private object storage (Supabase, per spec 15's approved default), but written so an equivalent managed DB/object store would satisfy it. Provider confirmation is a separate gate (§15).
- **Identity source:** `user_id` originates from the auth provider (spec 12 §3); this model treats it as an external, stable, opaque identifier the app's tables reference — the model does **not** define the auth provider's own user table.
- **Account cardinality:** MVP is 1 user : 1 account (spec 12 §4), but `account_id` is carried as its own column on every owned row so a future multi-seat account needs no re-key.
- **Clause is the single source of truth for policy text** (spec 07 §5): coverage/exclusion/condition rows link to clause rows and never duplicate raw policy text.
- **Large verbatim blobs** (original file bytes, possibly large extracted-text bodies) live in **private object storage**; structured records and references live in the **DB** (spec 11 §5–§7).
- **Confidence labels/statuses** use only the fixed vocabularies from specs 04/08/09; this model stores them as constrained enums, introducing no new values.
- All timestamps are UTC.

---

## 4. Core Ownership Model

Every user-owned artifact carries the ownership chain rooted at the authenticated upload (spec 12 §8–§12):

```
account  (account_id)
  └─ user references (user_id ∈ account)
        └─ upload            (upload_id,  owner: account_id + user_id)
              └─ policy_analysis (policy_analysis_id, inherits owner)
                    └─ all analysis sub-objects (inherit owner + policy_analysis_id)
```

Rules (spec 12 §7/§8/§17):
- Every owned row stores `account_id` **and** `user_id`. Rows below the upload also store `upload_id` and/or `policy_analysis_id` to anchor them to their root.
- `owner` columns are **NOT NULL, enforced at write time** — an ownerless row cannot be inserted, making the spec 12 §17 integrity faults structurally impossible rather than caught on read.
- Isolation is enforced at **retrieval** (queries filter by the requester's validated `account_id`/`user_id`); there is no query path that returns cross-account rows (spec 12 §7). RLS (§13) is the database-level backstop.

---

## 5. Proposed Tables

Structured records (DB). Large blobs go to object storage (§6).

| Table (proposed) | Holds | Spec origin |
|---|---|---|
| `accounts` | Account boundary + status | 12 §4 |
| `account_members` | user↔account membership + role (MVP: owner only) | 12 §4 |
| `uploads` | One upload session | 11 §4, 12 §8 |
| `uploaded_files` | Metadata for each uploaded file (bytes in object storage) | 11 §5 |
| `extracted_text_blocks` | Extracted text units (large bodies may point to object storage) | 02 §13, 11 §7 |
| `page_source_mappings` | Page-level `source_ref` records | 02 §5, 11 §7 |
| `policy_analyses` | The `PolicyAnalysis` root record | 07 §3, 11 §6 |
| `policies` | Distinct policy within an analysis | 07 §3 |
| `horses` | Insured animal | 07 §3 |
| `coverages` | Coverage-category object | 07 §4 |
| `clauses` | Classified clause (source of truth for text) | 07 §5 |
| `exclusions` | Exclusion specializing a clause | 07 §6 |
| `conditions` | Condition/obligation specializing a clause | 07 §7 |
| `confidence_results` | Per-object confidence label/cap/reason | 08, 11 §7 |
| `verification_results` | Per-statement verification status/finding | 09, 11 §7 |
| `generated_answers` | Consumer answer objects | 04 §16 |
| `report_sections` | Assembled report section records | 05 §2 |
| `audit_events` | Stage/access/outcome audit trail | 10 §13, 11 §8, 12 §11 |
| `review_queue_entries` | Routed-to-review items + state | 08 §11, 10 §10, 13 §3 |

Relationship/link tables (e.g., clause `related_clause_ids`, coverage→exclusion links) are modeled as association rows or array columns in §7; the two-way linkage rule (spec 07 §11) applies however they're stored.

---

## 6. Proposed Storage Areas

| Artifact | Store | Access |
|---|---|---|
| Original uploaded file (bytes) | **Private object storage** | API-only, short-lived user-scoped signed access; never public (11 §5, 12 §5/§8) |
| Final report PDF | **Private object storage** | API-only, released to owning session (11 §5, 12 §10) |
| Large extracted-text bodies (optional) | Private object storage, referenced from `extracted_text_blocks` | API-only, owner-scoped |
| All structured records | **Managed DB** | Owner-scoped queries + RLS (§13) |

Rules: no policy content in any public bucket, no content-addressable public URL, object keys are opaque IDs never derived from policy content/insured name/file name (11 §5/§17, 12 §16). Bucket creation is a separate gate (§15).

---

## 7. Table-by-Table Field Model

Field lists are **proposed**, not DDL. Types are indicative. Every user-owned table carries the ownership block: `user_id`, `account_id`, `upload_id`/`policy_analysis_id` where applicable, `created_at`, and `updated_at` where the row is mutable.

### `accounts`
`account_id` (PK) · `account_owner_user_id` · `account_status` (pending/active/suspended/pending_deletion/closed) · `created_at` · `updated_at`

### `account_members`
`account_member_id` (PK) · `account_id` (FK) · `user_id` · `user_role` (owner/reviewer/admin) · `created_at` · `updated_at`

### `uploads`
`upload_id` (PK) · `account_id` · `user_id` · `status` · `extraction_status` (02 §14) · `created_at` · `updated_at`
*Owner NOT NULL (§4/§8).*

### `uploaded_files`
`file_id` (PK) · `upload_id` (FK) · `account_id` · `user_id` · `file_name` · `file_type` (pdf/jpg/png/heic) · `object_storage_key` · `page_count` · `ocr_quality_score` (nullable) · `created_at`

### `extracted_text_blocks`
`block_id` (PK) · `policy_analysis_id` (FK) · `account_id` · `user_id` · `system_page_number` · `text` *(or `object_storage_key` for large bodies)* · `confidence` · `created_at`

### `page_source_mappings` (the `source_ref`, spec 02 §5)
`source_ref_id` (PK) · `policy_analysis_id` (FK) · `account_id` · `user_id` · `upload_id` · `file_name` · `system_page_number` · `printed_page_number` (nullable) · `document_type` · `section_heading` (nullable) · `clause_heading` (nullable) · `paragraph_index` · `line_range` · `text_snippet` · `confidence` · `created_at`

### `policy_analyses`
`policy_analysis_id` (PK) · `account_id` · `user_id` · `upload_id` (FK) · `extraction_status` · `created_at` · `updated_at`
*Owner NOT NULL.*

### `policies`
`policy_id` (PK) · `policy_analysis_id` (FK) · `account_id` · `user_id` · `carrier_name` (value+source+confidence, or FK to a `value_with_source` row) · `policy_number` · `policy_period_effective` · `policy_period_expiration` · `named_insured` · `document_types_present` · `is_in_force_indeterminate` · `created_at` · `updated_at`

### `horses`
`horse_id` (PK) · `policy_id` (FK) · `policy_analysis_id` · `account_id` · `user_id` · `name` · `breed` · `age` · `insured_value` *(each as value+source+confidence)* · `created_at`

### `coverages`
`coverage_id` (PK) · `policy_id` (FK) · `policy_analysis_id` · `account_id` · `user_id` · `coverage_category` (enum, 07 §4) · `coverage_status` (7 values, 04 §7) · `confidence_label` (4 values) · `confidence_reason` · `applies_to_horse_ids` · `grant_clause_ids` · `limit_ids` · `sublimit_ids` · `deductible_ids` · `exclusion_ids` · `condition_ids` · `definition_ids` · `modifying_endorsement_ids` · `conflict_ids` · `missing_item_ids` · `detection_only` · `created_at` · `updated_at`

### `clauses` (single source of truth for text, 07 §5)
`clause_id` (PK) · `policy_analysis_id` (FK) · `account_id` · `user_id` · `clause_type` (enum, 03 §2) · `coverage_category` (nullable) · `raw_text` · `normalized_text` · `plain_english_summary` · `source_ref_id` (FK, NOT NULL — 07 §5) · `confidence` · `related_clause_ids` · `modifies_clause_ids` · `modified_by_clause_ids` · `applies_to_horse_ids` · `applies_to_policy_period` (nullable) · `applies_to_coverage_categories` · `flags` · `conflict_ids` · `review_flag_ids` · `missing_related_clause_types` · `created_at`

### `exclusions` (specializes a clause, 07 §6)
`exclusion_id` (PK) · `clause_id` (FK) · `policy_analysis_id` · `account_id` · `user_id` · `exclusion_category` (enum) · `affects_coverage_ids` · `scope_note` · `depends_on_undefined_term` · `definition_ids` · `source_ref_id` (FK) · `confidence` · `conflict_ids` · `review_flag_ids` · `created_at`

### `conditions` (specializes a clause, 07 §7)
`condition_id` (PK) · `clause_id` (FK) · `policy_analysis_id` · `account_id` · `user_id` · `condition_type` (enum) · `affects_coverage_ids` · `obligation_text` · `deadline_value` (value+source, nullable-with-reason) · `is_mandatory` (nullable) · `has_emergency_exception` · `emergency_exception_clause_id` (nullable) · `source_ref_id` (FK) · `confidence` · `conflict_ids` · `review_flag_ids` · `created_at`

### `confidence_results` (08)
`confidence_result_id` (PK) · `policy_analysis_id` (FK) · `account_id` · `user_id` · `attached_object_type` · `attached_object_id` · `confidence_label` · `caps_applied` · `caps_confidence_at` (nullable) · `confidence_reason` · `review_flag_ids` · `created_at`

### `verification_results` (09)
`verification_id` (PK) · `policy_analysis_id` (FK) · `account_id` · `user_id` · `statement_id` · `verification_status` (5 values, 09 §3) · `binding` (page/snippet/section/label) · `entailment_findings` · `numeric_check` · `rescoped_statement` (nullable) · `reverify_status` (nullable) · `display_outcome` · `routed_to_review` · `review_reason` (nullable) · `created_at`

### `generated_answers` (04 §16)
`answer_id` (PK) · `policy_analysis_id` (FK) · `account_id` · `user_id` · `user_question` · `normalized_question` · `answer_type` · `direct_answer` · `coverage_status` · `confidence_label` · `confidence_reason` · `source_ref_ids` · `supporting_clause_ids` · `limits_found` · `deductibles_found` · `exclusions_found` · `conditions_found` · `missing_documents` · `conflicts` · `detection_only_flag` · `consumer_safe_summary` · `what_this_answer_does_not_determine` · `created_at` · `updated_at`

### `report_sections` (05 §2)
`report_section_id` (PK) · `policy_analysis_id` (FK) · `account_id` · `user_id` · `section_key` · `section_confidence` · `included_answer_ids` · `included_verification_ids` · `gap_notes` · `created_at` · `updated_at`

### `audit_events` (10 §13, 11 §8, 12 §11)
`audit_event_id` (PK) · `account_id` · `user_id` · `policy_analysis_id` (nullable) · `stage_entered` · `stage_completed` · `input_object_id` · `output_object_id` · `confidence_label` (nullable) · `verification_result` (nullable) · `block_reason` (nullable) · `review_reason` (nullable) · `actor_role` (nullable — for reviewer/admin actions) · `timestamp`
*No policy text stored (11 §8/§17); snippets that justify a decision live in `verification_results`, not here.*

### `review_queue_entries` (13 §3)
`review_entry_id` (PK) · `policy_analysis_id` (FK) · `account_id` · `user_id` · `entry_type` (13 §3, 13 values) · `routing_reason` · `priority` (critical/high/normal/low, 13 §11) · `status` (pending/claimed/resolved/retired) · `assigned_reviewer_user_id` (nullable) · `statement_id` (nullable) · `outcome` (nullable — approve/revise/reject) · `reviewer_note` (nullable) · `created_at` · `updated_at`

---

## 8. Ownership and Isolation Constraints

Applied to every user-owned table (spec 12 §6–§9, §16, §17):

- **Owner columns present and NOT NULL** — `account_id` + `user_id` on every owned row; `upload_id`/`policy_analysis_id` on rows below the upload. Enforced at write time; no ownerless insert.
- **Every policy artifact tied to an authenticated user/account** — no artifact exists without a resolvable owner (12 §8/§9).
- **No cross-account access** — all reads filter by the requester's validated identity; there is no query, join, or view returning another account's rows (12 §7). RLS (§13) enforces this at the DB layer regardless of app-code correctness.
- **Reviewer/admin access role-limited and audited** — reviewers reach only `review_queue_entries` routed to them and the specific decision content, never a general browse; every access writes an `audit_events` row (12 §13, 13 §5/§12).
- **Unauthenticated production uploads not allowed** — `uploads`/`uploaded_files` inserts require a validated session; no anonymous write path in production (12 §6, 15 §6).
- **No policy text in public URLs or logs** — object keys opaque; audit/log rows carry IDs/labels/reasons, not verbatim policy text (11 §17, 12 §16).

---

## 9. Audit Trail Model

- `audit_events` records every stage transition and every reviewer/admin access/outcome (10 §13, 12 §11, 13 §12), with the nine spec 10 §13 fields plus `actor_role` for staff actions.
- Records store **IDs, labels, reasons, timestamps — not policy text** (11 §8/§17). A blocked or review-routed item is audited with the same rigor as a displayed one (10 §13, 13 §12).
- The trail must reconstruct any answer's full path (routed → assigned → viewed → outcome → display) — a design requirement on what fields must be captured, not on how they're queried.
- Deletion of user data writes a deletion audit event (12 §14) recording that the user deleted the analysis, when, by whom — without the deleted policy content.

---

## 10. Review Queue State Model

- `review_queue_entries` holds routed items (08 §11, 10 §10, 13 §3) with `entry_type` (the 13 types), `routing_reason`, `priority`, `status`, optional `assigned_reviewer_user_id`, and the eventual `outcome` + required `reviewer_note` (13 §9/§10).
- **Owner (`account_id`/`user_id`) is the analysis's owner** — for isolation; **visibility** to a reviewer is by role, not ownership (13 §12). Consumers never query this table (13 §12).
- MVP assignment: unassigned queue + manual claim acceptable (13 §7); `status` supports pending/claimed/resolved/retired; assignment changes are audited (13 §7).
- A stale entry (analysis deleted/expired) is retired, not acted on (13 §16); a pending review never blocks a user's deletion request (12 §14).

---

## 11. Retention / Deletion Planning

Per spec 11 §15 and spec 15 §4 — **posture fixed, numeric windows pending compliance** (§15). This model provides the *hooks* retention needs, not the schedules:

- Each retention-governed artifact carries `created_at` (and the analysis carries lifecycle state) so a future purge job can act on age/need — **the purge job itself is a separate gate (§15) and is not designed here.**
- **No indefinite retention of original policy uploads** (15 §4): `uploaded_files` is modeled to be purgeable independently (bytes in object storage, metadata row retirable), so the original can be removed while lower-sensitivity records persist per their own windows.
- **User deletion** (12 §14): a delete cascades over original file, extracted text, source maps, confidence/verification results, and report for the analysis; the `audit_events` deletion record persists (no policy text).
- Windows for original file, extracted text, source snippets, PolicyAnalysis, verification results, report, audit trail, and deleted-user records remain **pending compliance** (15 §4) — the schema must not hard-code a window until they're set.

---

## 12. Indexing Considerations

Proposed (for review; no index is created here):

- **Ownership-filter indexes** — `(account_id, user_id)` on every owned table, since every read filters by owner (§8). This is the primary access pattern and the most important index for both correctness-of-scope and performance.
- **Anchor FKs** — index `upload_id`, `policy_analysis_id`, `policy_id`, `clause_id`, `source_ref_id` for the join-heavy analysis assembly.
- **Queue work** — `review_queue_entries` on `(status, priority)` for reviewer queue listing/filtering (13 §6).
- **Audit reconstruction** — `audit_events` on `(policy_analysis_id, timestamp)` and `(account_id, timestamp)` to reconstruct an item's path (§9).
- **Time-based purge** — `created_at` on retention-governed tables to support future purge jobs (§11).

---

## 13. Row-Level Security Planning

RLS is the **database-level backstop** to app-layer isolation (spec 12 §7), proposed here as design intent (no policy is created):

- **Default deny.** Every owned table has RLS enabled; the baseline policy denies all access.
- **Owner read/write policy** — a row is accessible to a session only when the row's `account_id`/`user_id` match the validated session identity (12 §5/§7). Enforced in the DB so a bug in app-layer filtering cannot leak cross-account rows.
- **Reviewer/admin policy** — a role-scoped policy grants a `reviewer` access to `review_queue_entries` (and the specific linked decision content) that are routed to review, and nothing else; every such access is expected to be audited at the app layer (13 §5/§12). Reviewer policies never grant a general cross-account read.
- **No public role** — no RLS policy grants anonymous/public access to any policy-content table (11 §17, 12 §16).
- **Service role** — the orchestration API's service credential operates within the same isolation intent; any elevated access is bounded to pipeline operation and audited, never a blanket bypass exposed beyond the API.

RLS policy implementation is a separate gate (§15) — this section states the intended policies, not their SQL.

---

## 14. Migration Readiness Checklist

Before a migration is written (each item still gated, §15):

- [ ] Provider confirmed (Supabase or equivalent) — spec 15 approved Supabase Auth for planning; project confirmation pending (§15)
- [ ] Auth `user_id` source/format confirmed (so ownership columns type-match the provider)
- [ ] Enum value lists frozen against specs 03/04/07/08/09/13 (coverage categories, clause types, statuses, labels, entry types)
- [ ] `value_with_source` representation decided (embedded columns vs. dedicated table) for scalar+source+confidence fields
- [ ] Array-column vs. association-table decision for `*_ids` link fields (with two-way-linkage integrity, 07 §11)
- [ ] `missing_items` / `conflicts` representation decided — before migrations are created, decide whether `missing_items` and `conflicts` remain embedded/reference fields inside `PolicyAnalysis`, answer, and verification records, or become dedicated queryable tables. Dedicated tables may be useful if the system needs reporting such as "all analyses with a missing endorsement" or "all analyses with unresolved clause conflicts."
- [ ] Retention windows received from compliance (§11, 15 §4) — or confirmation the schema ships window-agnostic
- [ ] Owner-NOT-NULL + write-time enforcement approach confirmed (§4/§8)
- [ ] RLS policy set reviewed (§13)
- [ ] Object-storage bucket layout + key scheme reviewed (§6)
- [ ] This model reviewed and approved by Rex

None of these is performed here; the checklist is the handoff from *model* to *migration*, and migration is a separate approval (§15).

---

## 15. Items Requiring Separate Approval

Each requires **explicit approval before implementation** (spec 14 §18, spec 15 §7/§8) — none is authorized by this document:

- **Database migrations** — writing/applying any DDL from this model
- **Supabase project/provider confirmation** — confirming the provider and project (spec 15 approved Supabase Auth for *planning*; project confirmation is its own step)
- **Storage bucket creation** — provisioning private object storage (§6)
- **RLS policy implementation** — writing/enabling the §13 policies
- **Retention purge jobs** — building the §11 purge/deletion automation (also blocked on compliance windows)
- **Auth integration** — wiring the provider (§3 assumption ≠ integration)
- **Production upload enablement** — turning on real-policy intake (12 §6, 15 §8)
- **GitHub push** — committing/pushing this document or any implementation (spec 14 §19; nothing pushed without Rex's explicit approval)

---

## 16. Out-of-Scope

This document does **not**:

- **Create any migration, table, index, bucket, or RLS policy** — it proposes them for review.
- **Configure Supabase Auth or any provider** — §3 assumes a provider for modeling; integration is gated (§15).
- **Add environment variables or secrets** — none defined here.
- **Build backend routes, frontend UI, extraction/generation/verification logic, or reviewer tools** — all later phases (spec 14).
- **Deploy anything** — no deployment action.
- **Set retention windows** — posture only; numbers pending compliance (§11, 15 §4).
- **Stage, commit, or push** — the file is local until Rex approves after review (§15).
- **Introduce new product requirements** — it persists only what specs 07/11/12/15 define.

---

*End of v1.0 Phase 1 Persistence Schema Model. A proposed persistence design derived from specs 07/11/12/15 — tables, storage areas, ownership/isolation, audit, review-queue state, retention hooks, indexing, and RLS intent — with owner-not-null and per-user isolation on every artifact. It creates no migration, table, bucket, auth config, or code, and authorizes no push; every implementation action is separately gated.*
