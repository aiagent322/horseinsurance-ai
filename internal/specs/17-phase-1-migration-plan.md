# Horse Insurance Coverage Checkup™
## Phase 1 — Migration Plan — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Migration Planning (pre-SQL)
**Scope:** Translates the approved Phase 1 schema **model** (spec 16) into a migration-ready **plan** — what goes in the first migration, what's deferred, and the specific representation decisions a migration author needs settled. Creates no SQL, no table, no bucket, no auth config, no code. Every implementation action is separately gated (§16).

---

## 1. Purpose

Spec 16 modeled the proposed persistence design. This document is the next planning step: it decides *which* tables belong in the **first** migration versus later ones, resolves the open representation questions spec 16 flagged (missing_items/conflicts/value_with_source/link-fields), and states the constraints, indexes, and RLS the first migration must include — so a migration author could write SQL directly from this plan once approved.

It writes no SQL. It is a plan a reviewer approves before any `.sql` file exists. The line it does not cross: **no migration file is created, no table is created, no bucket, no auth, no deployment** (§17, §16). This is the last planning artifact before implementation, and implementation waits on the §16 gates.

**Governing constraint:** producing this plan starts no SQL, database, storage, auth, backend, frontend, or deployment work (spec 15 §8, spec 16 §15/§16). Each such action is a separate approval gate (§16).

---

## 2. Source Documents

| Document | Contribution |
|---|---|
| **07 — Policy Data Model** | Object types, fields, clause-as-source-of-truth, missing_items/conflicts as model concepts |
| **11 — Backend & Infrastructure** | DB-vs-object-storage split, audit-record storage (IDs not text), retention posture |
| **12 — Auth, Account & Isolation** | Ownership columns, owner-not-null, isolation, RLS backstop, role-limited reviewer access |
| **15 — Production Decision Checklist** | Approved defaults: Supabase Auth (planning), conservative retention, manual internal review |
| **16 — Phase 1 Schema Model** | The proposed tables/fields this plan sequences into migrations, and the readiness decisions it resolves |

No requirement outside these documents is introduced.

---

## 3. Migration Scope

- **First migration = the foundation that everything else references**: identity/ownership, the upload→analysis spine, the core analysis content, and the operational tables (audit, review queue) that must exist before the pipeline runs.
- **Deferred = tables that depend on decisions still open** (§15) or that aren't needed until a later pipeline phase is built.
- The first migration is **structure only** — tables, columns, keys, constraints, indexes, and RLS scaffolding. It is not data, not pipeline logic, not buckets, not auth wiring.
- Ordering within the first migration follows FK dependency: `accounts` → `account_members` → `uploads` → analysis root → analysis children → operational tables.

---

## 4. Tables Proposed for First Migration

Included because everything else references them, or the pipeline can't be exercised without them:

| Table | Why first |
|---|---|
| `accounts` | Root ownership boundary (12 §4) |
| `account_members` | user↔account + role; needed for any owner/role check |
| `uploads` | Root of the artifact chain (12 §8) |
| `uploaded_policy_files` | File metadata (bytes deferred to object storage, §6) |
| `extracted_text_pages` | Extraction output landing (02 §13) |
| `source_mappings` | `source_ref` records — every citation resolves here (02 §5); nothing downstream is valid without it |
| `policy_analyses` | Analysis root (07 §3) |
| `coverage_objects` | Core analysis content (07 §4) |
| `clause_objects` | Single source of truth for policy text (07 §5) |
| `exclusion_objects` | Specializes clauses (07 §6) |
| `condition_obligation_objects` | Specializes clauses (07 §7) |
| `confidence_results` | Per-object scoring (08) |
| `verification_results` | Per-statement verification (09) |
| `generated_answers` | Consumer answers (04 §16) |
| `report_sections` | Assembled report structure (05 §2) |
| `audit_events` | Required from the first pipeline run (10 §13) — must exist before any stage executes |
| `review_queue_entries` | Routing target; must exist before scoring/verification can route (08 §11, 13 §3) |

Rationale: the pipeline (spec 10) touches every one of these on a single analysis run, so the first migration must stand them all up together for the pipeline to be testable end-to-end. Splitting them across migrations would leave the pipeline unable to run.

---

## 5. Tables Deferred from First Migration

| Table | Deferred because | Revisit at |
|---|---|---|
| `missing_items` | Dedicated-table decision open (§15.1); may stay embedded as reference fields | Resolved in §15, then included if "dedicated" is chosen |
| `conflict_records` | Dedicated-table decision open (§15.2); may stay embedded | Resolved in §15, then included if "dedicated" chosen |
| `value_with_source` | Representation decision open (§15.3) — embedded columns/JSON vs. dedicated table | Resolved in §15; only a table if that path is chosen |
| Link association tables (e.g. `clause_links`, `coverage_exclusion_links`) | Array-vs-association decision open (§15.4); if arrays chosen, no tables needed | Resolved in §15 |

Rule: nothing is deferred that the first-migration tables **hard-depend on** for existence. The deferred items are either representation choices (which change *how* a field is stored, not whether the owning table exists) or optional query-optimization tables. The core tables in §4 can be created with these unresolved by using the interim representation (embedded/array) and migrating to dedicated tables later if chosen.

---

## 6. Storage Buckets Needed Later

Not created in the first (DB-structure) migration; provisioned separately under the bucket-creation gate (§16, spec 16 §6):

| Bucket (later) | Holds |
|---|---|
| Private policy-file bucket | Original uploaded file bytes (11 §5) — referenced by `uploaded_policy_files.object_storage_key` |
| Private report bucket | Rendered report PDFs (11 §5) — referenced by `report_sections`/analysis |
| (optional) Private large-text bucket | Oversized extracted-text bodies, if not kept inline (16 §6) |

All private, opaque keys, API-mediated signed access only; no public bucket (11 §17, 12 §16). Bucket creation is gated (§16).

---

## 7. Required Ownership Columns

Every user-owned table in §4 carries (spec 12 §6–§9, spec 16 §4/§7):

- `account_id` — isolation boundary
- `user_id` — canonical owner
- `upload_id` and/or `policy_analysis_id` — anchor to the artifact root (on rows below the upload)
- `created_at` — always
- `updated_at` — on mutable rows

`accounts` and `account_members` carry `account_id`/`user_id` intrinsically. `audit_events` and `review_queue_entries` carry the owner of the analysis they describe (for isolation), with reviewer visibility governed by role, not ownership (13 §12).

---

## 8. Required Foreign-Key Relationships

Primary FK chain (first migration):

```
account_members.account_id      → accounts.account_id
uploads.account_id              → accounts.account_id
uploaded_policy_files.upload_id → uploads.upload_id
extracted_text_pages.policy_analysis_id → policy_analyses.policy_analysis_id
source_mappings.policy_analysis_id      → policy_analyses.policy_analysis_id
policy_analyses.upload_id       → uploads.upload_id
coverage_objects.policy_id      → policies.policy_id            (policies FK → policy_analyses)
clause_objects.policy_analysis_id → policy_analyses.policy_analysis_id
clause_objects.source_ref_id    → source_mappings.source_ref_id   (NOT NULL — 07 §5)
exclusion_objects.clause_id     → clause_objects.clause_id
condition_obligation_objects.clause_id → clause_objects.clause_id
confidence_results.policy_analysis_id  → policy_analyses.policy_analysis_id
verification_results.policy_analysis_id → policy_analyses.policy_analysis_id
generated_answers.policy_analysis_id   → policy_analyses.policy_analysis_id
report_sections.policy_analysis_id     → policy_analyses.policy_analysis_id
audit_events.policy_analysis_id        → policy_analyses.policy_analysis_id (nullable for pre-analysis events)
review_queue_entries.policy_analysis_id → policy_analyses.policy_analysis_id
```

Note: `policies` and `horses` (from spec 16) sit between `policy_analyses` and `coverage_objects`/etc.; include them in the first migration as intermediate parents. `user_id` references the auth provider's identity (spec 12 §3) and is **not** an app-table FK until the provider is confirmed (§15/§16).

---

## 9. Required Not-Null Constraints

- **Owner columns NOT NULL** on every owned table — `account_id`, `user_id` (spec 12 §17, spec 16 §4/§8). This is the write-time enforcement that makes ownerless-artifact integrity faults impossible.
- **`clause_objects.source_ref_id` NOT NULL** — a clause with no source is invalid by construction (07 §5, 16 §7).
- **Anchor FKs NOT NULL** where the child cannot exist without its parent (e.g., `uploaded_policy_files.upload_id`, analysis children's `policy_analysis_id`).
- **Enum-constrained columns NOT NULL** where a value is always required (e.g., `coverage_status`, `confidence_label` once scored; `entry_type` on a queue row).
- **`created_at` NOT NULL** everywhere.

Nullable-with-reason fields (e.g., a `deadline_value` that wasn't found, spec 07 §7) are explicitly nullable and paired with a reason field — never emitted as a real value (spec 04 §2).

---

## 10. Required Indexes

- **`(account_id, user_id)`** on every owned table — the primary access pattern; every read filters by owner (12 §7, 16 §12).
- **Anchor FKs** — `upload_id`, `policy_analysis_id`, `policy_id`, `clause_id`, `source_ref_id` (join-heavy assembly).
- **`review_queue_entries (status, priority)`** — reviewer queue listing/filtering (13 §6).
- **`audit_events (policy_analysis_id, timestamp)`** and **`(account_id, timestamp)`** — path reconstruction (10 §13).
- **`created_at`** on retention-governed tables — future purge jobs (§14, 11 §15).

Indexes are specified here for the migration author; none is created in this plan.

---

## 11. RLS Policy Planning

For the first migration's tables (design intent; no policy created — spec 16 §13):

- **Enable RLS + default-deny** on every owned table.
- **Owner read/write policy** — row accessible only when `account_id`/`user_id` match the validated session (12 §5/§7). DB-level backstop to app-layer filtering.
- **Reviewer/admin policy** — role-scoped access to `review_queue_entries` (and linked decision content) routed to review, nothing else; never a general cross-account read (12 §13, 13 §5).
- **No public role** on any policy-content table (11 §17).
- **Service role** bounded to pipeline operation, audited, never a public bypass.

RLS *enabling* is a separate gate (§16); this states the policy set to implement.

---

## 12. Audit Event Requirements

- `audit_events` must exist in the first migration — the pipeline writes to it from the first run (10 §13).
- **Stores references and metadata only — not policy text** (§15.6 decision below; 11 §8/§17). Fields: the nine spec 10 §13 fields + `actor_role` for reviewer/admin actions.
- Snippets that justify a verification/block decision live in `verification_results` (under the item's access control), **not** duplicated into `audit_events` (16 §9).
- Must support reconstructing any item's full path (routed → assigned → viewed → outcome → display) via its indexes (§10).

---

## 13. Review Queue Requirements

- `review_queue_entries` must exist in the first migration — scoring/verification route to it (08 §11, 09 §12, 10 §10).
- Fields: `entry_type` (13 types, 13 §3), `routing_reason`, `priority` (critical/high/normal/low), `status` (pending/claimed/resolved/retired), optional `assigned_reviewer_user_id`, `outcome` (approve/revise/reject), required `reviewer_note` on outcome (13 §9/§10).
- Owner = analysis owner (isolation); visibility = role (13 §12). Consumers never query it.
- MVP: unassigned queue + manual claim acceptable (13 §7); assignment changes audited.

---

## 14. Retention / Purge Job Placeholders

- The first migration includes the **hooks** (`created_at`, analysis lifecycle state) so a future purge job can act — **the purge job itself is not created here and is gated** (§16, spec 16 §11).
- **No indefinite retention of original policy uploads** (15 §4): `uploaded_policy_files` + its bucket object are modeled to be purgeable independently.
- **Retention windows remain pending compliance** (15 §4) — the migration must **not** hard-code a window; purge scheduling is deferred until windows are set.
- User-deletion cascade (12 §14) is a documented requirement for the deletion path (built later, gated), not a table in the first migration.

---

## 15. Open Migration Decisions

Each must be decided before (or as part of) writing the first SQL. This plan states a **recommendation**; the decision is the reviewer's.

**15.1 — Does `missing_items` need a dedicated table?**
*Recommendation: start embedded, add a dedicated table only if reporting needs it.* Keep `missing_item_ids`/records referenced from `policy_analyses`/`coverage_objects` for the first migration. Add a dedicated `missing_items` table **if** the system needs queries like "all analyses with a missing endorsement" (spec 16 §14 note). Deferred from first migration (§5) pending this decision.

**15.2 — Does `conflict_records` need a dedicated table?**
*Recommendation: same as 15.1 — start embedded, promote to a dedicated `conflict_records` table if cross-analysis conflict reporting ("all analyses with unresolved clause conflicts") is required.* Deferred (§5) pending decision.

**15.3 — `value_with_source`: dedicated table or embedded JSON?**
*Recommendation: embedded JSON structure for MVP* (a `{value, source_ref_ids, confidence, null_reason}` JSON column on the owning row), avoiding a join for every scalar. Promote to a dedicated table only if these values need independent querying/indexing. A dedicated table adds normalization at the cost of a join on every field read — likely not worth it for MVP.

**15.4 — `related_clause_ids` / `exclusion_ids`: arrays or association tables?**
*Recommendation: arrays for MVP*, with app-layer enforcement of two-way-linkage integrity (07 §11). Association tables give referential integrity and cleaner many-to-many queries but add join complexity; revisit if link-integrity bugs or link-heavy queries emerge. If integrity guarantees are deemed essential up front, choose association tables instead — this is the one decision where "correct but heavier" (association tables) is a defensible first-migration choice.

**15.5 — Reports: structured sections only, or also rendered output?**
*Recommendation: both, but separated.* Store structured `report_sections` in the DB (first migration) as the source of truth; store the **rendered PDF** in the private report bucket (later, gated §6/§16) referenced from the analysis. The DB holds structure; object storage holds the rendered artifact — consistent with spec 11 §5.

**15.6 — `audit_events`: policy text or references/metadata only?**
*Decision: references and metadata only — no policy text* (11 §8/§17, 16 §9). This is not a discretionary trade-off; storing policy text in the audit trail would raise its sensitivity and violate the spec 11 §17 logging rule. Snippets needed to justify a decision live in `verification_results` under access control, not in `audit_events`.

---

## 16. Approval Required Before Creating SQL

Each requires **explicit approval before the action** (spec 14 §18, spec 15 §8, spec 16 §15) — none authorized by this plan:

- **Creating the first SQL migration** — writing any `.sql`/migration file from this plan
- **Confirming Supabase project/provider** — confirming the project the migration targets
- **Creating Supabase storage buckets** — the §6 buckets
- **Enabling RLS** — implementing the §11 policies
- **Creating purge jobs** — the §14 retention automation (also blocked on compliance windows)
- **Connecting auth** — wiring the provider (identity source for `user_id`)
- **Pushing migration files** — committing/pushing any migration to GitHub (spec 14 §19)
- **Allowing real policy upload** — enabling production intake (12 §6, 15 §8)

Rule: gates are independent; approving one does not approve another. Writing the first SQL file is itself the first gate — this plan stops short of it.

---

## 17. Out-of-Scope

This plan does **not**:

- **Create any SQL migration file, table, index, bucket, or RLS policy** — it plans them for approval.
- **Confirm or configure the provider / Supabase Auth** — §2/§15 assume the approved default for planning; confirmation and wiring are gated (§16).
- **Add environment variables or secrets** — none defined.
- **Build backend routes, frontend UI, extraction/generation/verification/report logic, or reviewer tools** — later phases (spec 14).
- **Deploy anything** — no deployment action.
- **Set retention windows** — pending compliance (§14, 15 §4).
- **Stage, commit, or push** — local until approved after review (§16).
- **Introduce new product requirements** — it sequences only specs 07/11/12/15/16.

---

*End of v1.0 Phase 1 Migration Plan. Translates the spec 16 schema model into a first-migration-vs-deferred split with FK/constraint/index/RLS requirements, resolves the six open representation decisions (missing_items/conflicts/value_with_source deferred-and-recommended; audit-text and reports decided), and gates every implementation action — starting with the creation of the first SQL file — behind explicit approval. It creates no SQL, table, bucket, auth config, or code, and authorizes no push.*
