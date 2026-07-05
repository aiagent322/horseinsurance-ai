# Horse Insurance Coverage Checkup™
## Phase 1 — RLS Policy Plan — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — RLS Planning (pre-policy)
**Scope:** A **plan** for the Row-Level Security policies the Phase 1 migration will need — described in prose, per table, per operation. Writes **no** `CREATE POLICY` statement, no SQL, no migration. Applies nothing. Every implementation action is separately gated (§19).

---

## 1. Purpose

The Phase 1 migration (`supabase/migrations/20260705022540_phase_1_persistence_schema.sql`) **enables** RLS on all 27 tables (default-deny) but deliberately writes **no policies** — spec 17 §16 makes "writing RLS policies" a separate approval gate. This document is the plan for those policies: what each table's owner / member / reviewer / admin-service access should be, at the row and operation level, so the policies can be reviewed before any `CREATE POLICY` is written.

It describes intent only. It contains no policy SQL, defines no provider connection, and applies nothing. The line it does not cross: **no `CREATE POLICY`, no new migration, no apply, no Supabase connection, no auth config** (§20, §19). It is the last planning artifact before RLS implementation, and implementation waits on the §19 gate.

**Explicit status statements (required, stated up front):**
- **RLS policies are not being implemented yet.** This is a plan; no policy exists.
- **Supabase Auth is the assumed provider for planning** (spec 15), but final auth connection remains gated (§4, §19).
- **The migration's RLS enablement remains unapplied** until the migration itself is applied under approval — enabling RLS in the file changes nothing in any database until applied.
- **Policy text must never be exposed through audit events** (§15).
- **Reviewer/admin access must be audited** (§8/§9).
- **Deletes are restricted** and handled through retention/deletion workflows, not broad user deletes (§14).

---

## 2. Source Documents

| Document | Contribution |
|---|---|
| **12 — Auth, Account & Isolation** | Identity model, owner-match isolation, role-limited reviewer access, default-deny, no public role |
| **15 — Production Decision Checklist** | Supabase Auth as approved planning default; manual internal review |
| **16 — Schema Model** | RLS intent (§13): default-deny, owner-match, reviewer-scoped, no public, bounded service role |
| **17 — Migration Plan** | RLS enable vs. policy split; policies are a separate gate (§11/§16) |
| **Phase 1 migration SQL** | The 27 tables + their ownership columns these policies attach to |

No requirement outside these is introduced.

---

## 3. RLS Planning Assumptions

- Every owned table carries `account_id` + `user_id` (NOT NULL) — the columns policies match against (spec 12 §7).
- The validated session exposes the requester's `user_id`, `account_id`, and `user_role` (spec 12 §5). Under Supabase Auth this is `auth.uid()` plus app-resolved account/role; the exact function names are settled at implementation (§4).
- Isolation is enforced **at retrieval** by the app layer (owner-filtered queries), with RLS as the **database-level backstop** — a policy is the last line, not the only line (spec 12 §7, spec 16 §13).
- Default-deny is already in force via `ENABLE ROW LEVEL SECURITY` with no policy (once applied): no row is accessible until a policy grants it. Policies are therefore purely **additive grants** over a deny baseline.

---

## 4. Auth Provider Assumption

- **Supabase Auth is the assumed provider for planning** (spec 15 §3/§6). Under it, the session user id is `auth.uid()`, and account/role are resolved from `account_members`.
- **Final auth connection remains gated** (§19, spec 17 §16). This plan does not wire auth, does not add the `user_id → auth.users` FK, and does not assume the provider is connected. If a different provider is chosen, the *policy logic* below is unchanged — only the identity-resolution functions differ.
- Policies are written against the **validated session identity**, never a client-supplied `user_id`/`account_id` (spec 12 §5) — an app or client claiming another user's id must not satisfy any policy.

---

## 5. Role Model

Three access classes (spec 12 §4, spec 13 §5):

| Role | Source | Access class |
|---|---|---|
| **owner** | Consumer; row/account owner | Full access to their own account's artifacts |
| **reviewer** | Internal staff | Read + limited update on **review-routed items** and their decision content only |
| **admin / service** | Internal staff / orchestration API | Bounded maintenance/operation; audited; never a public bypass |

Plus two non-roles that must never gain access:
- **public / anon** — no access to any policy-content table (spec 11 §17, spec 12 §16).
- **unauthenticated** — no production read/write (spec 12 §6).

---

## 6. Owner Access Rules

- An **owner** may access a row only when the row's `account_id` **and** `user_id` match the validated session identity (spec 12 §5/§7).
- This is the primary policy on every owned table: `row.account_id = session.account_id AND row.user_id = session.user_id`.
- Owner access spans select/insert/update as scoped below (§11–§14); **delete is restricted** (§14).
- No owner ever reads another account's rows — there is no policy branch that matches a non-owning session (spec 12 §7).

---

## 7. Account Member Access Rules

- MVP accounts are 1 user : 1 account (spec 12 §4), so **owner access and member access coincide** for launch.
- The plan models member access as **account-scoped** (`row.account_id = session.account_id` for members of that account) so a future multi-seat account needs a policy adjustment, not a re-key. For MVP this collapses to the owner rule (§6) because the only member is the owner.
- Role within the account still governs what a member may do (an account with a reviewer member does not thereby expose consumer data cross-account — reviewer access is its own scoped path, §8).

---

## 8. Reviewer Access Rules

- A **reviewer** may access **only items routed to review** and their decision content (spec 12 §13, spec 13 §5) — never a general browse of analyses or consumer data.
- **Read:** reviewers may select `review_queue_entries` that are routed (and, through them, the specific linked statement / snippet / verification result needed to decide) — scoped to review-routed items, not all rows.
- **Update:** reviewers may update a review entry they are permitted to work (assigned/claimed), to record outcome + required note (spec 13 §9/§10) — limited to the review-decision fields, not the underlying policy content.
- **No cross-account expansion:** a reviewer's access is by review-routing + role, not by owning the data; it never widens into reading arbitrary accounts' analyses.
- **Audited:** every reviewer read and update is an access event recorded in `audit_events` (spec 12 §13, spec 13 §12). The audit is an app-layer responsibility that the policy plan assumes and requires.

---

## 9. Admin / Service Role Rules

- **admin:** bounded operational access defined by specific need (e.g., escalation handling, integrity-fault resolution) — never a blanket read of all policy content (spec 12 §13). Audited.
- **service role** (the orchestration API's credential): operates the pipeline — inserts/updates analysis rows across stages within the owning account's scope. Bounded to pipeline operation, **audited**, and **never exposed beyond the credentialed API** (spec 16 §13). It is not a public bypass and is not reachable from the browser.
- Neither admin nor service role may **expose policy content publicly** or convert private content to a public URL (spec 11 §17). Their elevated access is internal and audited.

---

## 10. Table-by-Table RLS Plan

All 27 Phase 1 tables. Unless noted, the **owner policy** is `account_id = session.account_id AND user_id = session.user_id`; **no public/anon** access anywhere; **delete restricted** (§14).

| Table | Owner access | Reviewer | Admin/Service | Notes |
|---|---|---|---|---|
| `accounts` | Member of the account (`account_id` match; `account_owner_user_id` = session for owner ops) | — | Admin: account lifecycle ops (audited) | Account-scoped, not user-row-scoped |
| `account_members` | Member sees own account's membership | — | Admin: role management (audited) | Governs role; write tightly restricted |
| `uploads` | Owner match | — | Service: pipeline status updates | Root of chain |
| `uploaded_policy_files` | Owner match | — | Service: metadata writes | Bytes in private storage (§17) |
| `extracted_text_pages` | Owner match | Read if linked to a routed item | Service: extraction writes | Sensitive verbatim text |
| `source_mappings` | Owner match | Read if snippet backs a routed item | Service: extraction writes | Holds cited snippets |
| `policy_analyses` | Owner match | — | Service: pipeline writes | Analysis root |
| `policies` | Owner match | — | Service | — |
| `horses` | Owner match | — | Service | Per-horse isolation |
| `clause_objects` | Owner match | Read if part of a routed item's decision content | Service | Source-of-truth text |
| `coverage_objects` | Owner match | Read if part of a routed coverage decision | Service | — |
| `exclusion_objects` | Owner match | Read if part of a routed exclusion decision | Service | — |
| `condition_obligation_objects` | Owner match | Read if part of a routed condition decision | Service | — |
| `clause_links` | Owner match | Read if linking routed clauses | Service | Association table |
| `coverage_clause_links` | Owner match | Read if linking routed content | Service | Association table |
| `coverage_exclusion_links` | Owner match | Read if linking routed content | Service | Association table |
| `coverage_condition_links` | Owner match | Read if linking routed content | Service | Association table |
| `coverage_horse_links` | Owner match | Read if linking routed content | Service | Association table |
| `missing_items` | Owner match | Read if part of a routed item | Service | Dedicated table |
| `conflict_records` | Owner match | Read if part of a routed conflict | Service | Dedicated table |
| `conflict_clause_links` | Owner match | Read if linking a routed conflict | Service | Association table |
| `confidence_results` | Owner match | Read if part of a routed decision | Service | — |
| `verification_results` | Owner match | **Read for routed items** (holds decision snippets) | Service | Reviewer's primary decision content |
| `generated_answers` | Owner match | Read if the answer is routed | Service | — |
| `report_sections` | Owner match | — | Service | Structured only (no rendered output) |
| `audit_events` | **No direct owner read** (internal) | Reviewer/admin read own-scope events only; **append-only** | Service/admin append; no update/delete | §15 |
| `review_queue_entries` | **No owner access** (internal queue) | **Reviewer read + limited update** on routed/assigned items | Admin: reassign/escalate (audited) | §16 |

Reviewer "read if linked to a routed item" everywhere means: the reviewer reaches this row **only** via a `review_queue_entries` item routed to review, and only the specific rows that item's decision needs — never a table-wide reviewer select.

---

## 11. Insert Policies

- **Owner insert:** allowed only when the new row's `account_id`/`user_id` equal the session identity — an owner cannot insert a row owned by someone else (spec 12 §5/§8). This is the write-time complement to owner-not-null: the DB rejects both null owners (NOT NULL) and mismatched owners (RLS).
- **Service insert:** the pipeline's service role inserts analysis rows within the owning account's scope during processing (spec 16 §13), audited.
- **Reviewer insert:** none on content tables; reviewers do not create policy content (spec 13 §9). Reviewer writes are updates to review entries (§13), not inserts.
- **No anon/public insert** — no unauthenticated production insert (spec 12 §6). Upload insert requires a validated session (spec 16 §8).

---

## 12. Select Policies

- **Owner select:** owner-match rows only (§6). The dominant policy across all content tables.
- **Reviewer select:** scoped to review-routed items and their decision content (§8/§10) — never table-wide.
- **Admin/service select:** bounded to operational need, audited (§9).
- **No public/anon select** on any policy-content table (spec 11 §17).
- **`audit_events` / `review_queue_entries`:** owners do **not** select these (§15/§16); access is role-scoped only.

---

## 13. Update Policies

- **Owner update:** owner-match rows, limited to fields an owner may change (owners generally do not edit analysis content, which the pipeline produces; owner-facing updates are account/profile-level). Owner update never changes ownership columns.
- **Service update:** the pipeline updates analysis rows across stages (scoring, verification results, etc.) within account scope, audited (spec 16 §13).
- **Reviewer update:** limited to `review_queue_entries` fields for a permitted/assigned item — recording `outcome` + required `reviewer_note` (spec 13 §9/§10) — nothing on the underlying content tables.
- **No ownership reassignment via update** — `account_id`/`user_id` are not user-mutable (spec 12 §5).

---

## 14. Delete Policies

- **Deletes are restricted and usually handled through retention/deletion workflows, not broad user deletes** (explicit requirement).
- **Owner delete:** not a broad row-delete grant. A user's right to delete their analysis (spec 12 §14) is exercised through a **deletion workflow** (a controlled, audited operation that cascades the analysis and writes a deletion audit event) — not an ad-hoc `DELETE` policy letting owners drop arbitrary rows.
- **Retention purge:** age/need-based deletion is a **purge job** (spec 11 §15, spec 17 §14), gated and blocked on compliance windows — not an RLS-granted user delete.
- **Reviewer/admin delete:** none on content tables; review entries are retired (status change), not deleted (spec 13 §16).
- **`audit_events`:** no delete by anyone in normal operation (§15, append-only) — audit records persist per retention, including the record of a user deletion.

---

## 15. Audit Event Restrictions

- **`audit_events` is append-only** — inserts (by service/reviewer/admin actions) are allowed within scope; **updates and deletes are not** granted in normal operation. The trail is immutable so it can reconstruct any item's path (spec 10 §13).
- **Owners do not read `audit_events`** — it is an internal/compliance artifact, not consumer-facing (spec 12 §11). A user's own report history is served through the app, not by exposing the raw audit trail.
- **Reviewer/admin read** is scoped to their operational events, audited.
- **No policy text is stored in `audit_events`** (spec 11 §8/§17, spec 17 §15.6) — the table has no text/snippet column by design. Therefore **policy text cannot be exposed through audit events**, regardless of who reads them. Snippets justifying a decision live in `verification_results` under owner/reviewer scope, not here.

---

## 16. Review Queue Restrictions

- **`review_queue_entries` is internal** — **owners have no access** (spec 13 §12). A consumer never sees the queue, the routing reason, or that their item was routed; they see only the resulting answer/status.
- **Reviewer read + limited update** — scoped to routed/assigned items, for the review decision only (§8/§13). Every access audited (spec 13 §12).
- **Admin** may reassign/escalate (audited); **no public access**.
- Entries are **retired via status**, not deleted (§14, spec 13 §16); a pending review never blocks an owner's deletion request (spec 12 §14).

---

## 17. Storage Access Relationship

- RLS governs the **database rows**; the **original files and report PDFs** live in **private object storage** (spec 11 §5), governed by storage access controls, not table RLS.
- The relationship: `uploaded_policy_files.object_storage_key` (an RLS-protected row) points to a private object; retrieving the object requires the app to (a) pass the RLS check on the row, then (b) mint a short-lived, user-scoped signed access to the object (spec 11 §5, spec 12 §5). No durable public link; no public bucket (spec 11 §17).
- Storage bucket creation and signed-access wiring are **separate gates** (§19) — this plan states the relationship, not the storage config.

---

## 18. Failure / Deny-by-Default Rules

- **Default deny** — RLS enabled with no matching policy = no access. Every access must be positively granted by a policy; absence of a grant is a denial (spec 12 §6/§17, spec 16 §13).
- **Session absent/invalid** → no policy matches → denied (unauthenticated production access blocked, spec 12 §6).
- **Owner mismatch** → no policy matches → denied; cross-account access is impossible by construction (spec 12 §7).
- **Missing role** → reviewer/admin/service policies don't match a plain owner or anon session → denied (spec 12 §13).
- **Fail closed** — any ambiguity resolves to deny, never to open (spec 12 §17). A misconfigured or absent policy leaves the table at default-deny, which is safe (nothing exposed), not open.

---

## 19. Approval Required Before Writing Policies

Each requires **explicit approval before the action** (spec 17 §16) — none authorized here:

- **Writing the RLS `CREATE POLICY` statements** (in a new migration or the existing one) — the core action this plan precedes
- **Applying the Phase 1 migration** (RLS enablement is inert until applied)
- **Confirming the Supabase project/provider**
- **Connecting Supabase Auth** (adds identity-resolution + the `user_id` FK the policies reference)
- **Creating storage buckets** and wiring signed access (§17)
- **Creating retention/purge jobs** (the delete path, §14; blocked on compliance windows)
- **Enabling production upload**
- **Pushing** this document or any policy migration to GitHub

Gates are independent; approving one approves none of the others. Writing the first `CREATE POLICY` is itself the gate this plan stops short of.

---

## 20. Out-of-Scope

This plan does **not**:

- **Write any `CREATE POLICY` statement or SQL** — it describes policy intent in prose.
- **Create a new migration or modify the existing one** — the existing migration's RLS *enablement* stands; policies are added later under approval.
- **Apply the migration or connect to Supabase** — nothing is applied or connected.
- **Configure auth, create buckets, add secrets** — all gated (§19).
- **Build backend, frontend, extraction/generation/verification/report logic, or reviewer tools** — later phases.
- **Deploy anything.**
- **Set retention windows or build purge jobs** — pending compliance (§14, spec 15 §4).
- **Stage, commit, or push** — local until approved after review (§19).
- **Introduce new product requirements** — it plans RLS only for what specs 12/15/16/17 and the migration define.

---

*End of v1.0 Phase 1 RLS Policy Plan. Describes the intended owner / account-member / reviewer / admin-service policies per table and per operation over the 27 Phase 1 tables — default-deny, owner-match isolation, review-scoped reviewer access, append-only auditless-of-policy-text audit, restricted deletes via retention/deletion workflows, no public or cross-account access. It writes no policy SQL, creates no migration, applies nothing, and authorizes no push; every implementation action is separately gated.*
