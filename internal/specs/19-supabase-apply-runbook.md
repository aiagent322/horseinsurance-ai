# Horse Insurance Coverage Checkup™
## Supabase Apply Runbook — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Local-Only Runbook (pre-apply)
**Scope:** The exact ordered procedure for applying Phase 1 database work — schema migration, RLS policies, auth connection, storage buckets, environment configuration — **once Rex explicitly opens the apply gate**. This document applies nothing itself. It is a runbook to follow later, not an action taken now.

---

## 1. Purpose

Specs 11, 12, 15, 16, 17, and 18, and the two Phase 1 migration files under `supabase/migrations/`, together define *what* the Phase 1 persistence and security design is and *why* each piece exists. None of them define the **exact sequence of steps** to actually apply that design to a real Supabase project safely. This runbook is that sequence.

It exists so that when Rex is ready to move from planning to execution, there is a single ordered checklist to follow — with explicit stop conditions — rather than improvising apply order in the moment. Writing this runbook is itself a planning action: it authorizes nothing and executes nothing. Every step described below remains gated behind its own explicit approval, exactly as specs 15, 17, and 18 already require.

---

## 2. Current Gate Status

As of this writing:

- The **Phase 1 schema migration** (`supabase/migrations/20260705022540_phase_1_persistence_schema.sql`) **exists but remains unapplied.** It is local-only DDL under review; running it against a live database is a separate, not-yet-granted approval.
- The **Phase 1 RLS policy migration** (`supabase/migrations/20260705145522_phase_1_rls_policies.sql`) **exists but remains unapplied.** Its `CREATE POLICY` statements sit over the schema migration's default-deny baseline and cannot take effect until both migrations are applied, in order.
- **No Supabase project has been confirmed** as the apply target. Planning documents assumed Supabase Auth and a managed Postgres/object-store project as a *default for planning purposes only* (spec 15 §3) — this is not the same as confirming a specific project to apply against.
- **No auth provider is connected.** The RLS policies reference `auth.uid()` under the assumption that Supabase Auth is the eventual provider, but no such connection exists yet, and the `user_id → auth.users` foreign key behavior is not finalized until that connection happens (§8 below).
- **No storage buckets exist.** Original policy files and rendered reports require private buckets that have not been created.
- **No real policy uploads are permitted** under any circumstances until every item in this runbook is completed, verified, and signed off (§13, §15).

This runbook does not change any of the above. It only describes the order in which these gates would be cleared, if and when Rex opens them.

---

## 3. Required Inputs Before Apply

Before any apply step in this runbook may begin, the following must already exist and be confirmed:

- Rex's explicit, written approval to begin the apply sequence (not just to plan it — see spec 15 §6/§7 distinction between planning approval and build/apply approval).
- A confirmed Supabase project (or equivalent managed Postgres + private object storage provider) that the migrations will target (§4).
- Final decision on retention windows from compliance, per spec 15 §4 (placeholders in that document are not final legal values).
- Confirmation of who holds the `reviewer`/`admin` role for the manual internal reviewer workflow (spec 15 §5), since RLS policies reference these roles.
- A reviewed copy of specs 16, 17, and 18 and both migration files, confirmed still current and unmodified since last review.

If any of these is missing, this runbook does not proceed past this section.

---

## 4. Supabase Project Confirmation

- Before any migration is applied, the specific Supabase project (project ref, region, environment — production vs. a staging/sandbox project) must be explicitly confirmed by Rex.
- This confirmation is a distinct decision from "Supabase Auth is the planning default" (spec 15 §3) — a *default assumption for design purposes* is not the same as *this is the project we are applying to*.
- Recommended (not mandated) practice: apply first to a non-production/staging Supabase project to validate the full sequence below before touching any project that will hold real user data.
- No step past this section proceeds without a named, confirmed project.

---

## 5. Pre-Apply Safety Checks

Before applying anything, confirm:

- The two migration files on disk match exactly what was last reviewed and approved — no undisclosed edits.
- The migration filenames' timestamps are in the correct order (schema migration timestamp precedes RLS migration timestamp), since the RLS migration depends on running after the schema migration.
- A rollback/backup plan exists for the target project (even an empty new project should have its baseline state noted).
- No other untested or unrelated migrations are queued against the same project that could interact unexpectedly with these two.
- The confirmed project (§4) is not currently serving any production traffic or real user data at the time of this initial apply.

---

## 6. Migration Apply Order

Strict order, no exceptions:

1. **Apply the schema migration first:** `20260705022540_phase_1_persistence_schema.sql`. This creates all 27 Phase 1 tables, enables Row-Level Security on each (default-deny, no policies yet), and establishes ownership columns, foreign keys, and constraints.
2. **Verify the schema migration succeeded completely** (§13) before proceeding — every table created, every constraint in place, no partial application.
3. **Apply the RLS policy migration second:** `20260705145522_phase_1_rls_policies.sql`. This adds the `CREATE POLICY` statements over the schema migration's deny baseline.
4. **Do not apply the RLS migration before the schema migration** — it depends on tables and columns the schema migration creates, and its filename timestamp is later for exactly this reason.

---

## 7. Auth Connection Order

- Auth connection (wiring Supabase Auth as the live identity provider) is a **separate step from applying either migration** and must happen only after both migrations are applied and verified.
- Recommended order: schema migration → RLS policy migration → auth connection → `user_id → auth.users` FK finalization (§8) → storage buckets (§10) → environment/secrets (§12).
- Connecting auth before this point risks resolving `auth.uid()` against a database that doesn't yet have the RLS policies in place to govern what that identity can access.

---

## 8. `user_id` to `auth.users` FK Timing

- The RLS policies assume `auth.uid()` as the validated session identity, but the exact foreign-key relationship between the app's `user_id` columns and Supabase's `auth.users` table is **not finalized until auth is actually connected** (spec 18 §4, spec 17 §16).
- This FK finalization must happen **after** auth connection (§7), not before — finalizing it against an unconnected or wrong auth provider risks having to redo the constraint.
- Until this FK is finalized and confirmed, no table relying on it should be considered production-ready, even if the migrations have technically been applied.

---

## 9. RLS Policy Apply Order

- RLS is already **enabled** (default-deny) by the schema migration the moment it's applied (§6, step 1) — this happens automatically as part of that migration, not as a separate action.
- The RLS **policy** migration (§6, step 3) must be applied only after the schema migration, per the dependency above.
- After both migrations are applied, RLS policies must be **tested before any real data enters the tables** (§13) — do not treat "migration applied" as equivalent to "RLS verified working."

---

## 10. Storage Bucket Creation Order

- Storage buckets (original policy files, rendered report PDFs) are created **after** both migrations are applied and RLS is verified, and **after** auth connection (§7), since bucket access rules depend on a working identity/ownership model.
- Buckets are created **one at a time**, verified individually (private, no public read, no directory listing) before the next is created.
- No bucket is created until Rex has explicitly opened this specific gate — bucket creation is its own approval, distinct from migration apply approval.

---

## 11. Private Bucket Access Rules

- **Every bucket created under this runbook must be private by default** — no public read, no public write, no anonymous access, no content-addressable public URL.
- Access to bucket contents is always mediated by the application layer via short-lived, user-scoped signed URLs — never a durable public link (spec 11 §5, spec 18 §17).
- A bucket's existence and its RLS-governed reference row (e.g., `uploaded_policy_files.object_storage_key`) must be tested together — confirm that retrieving an object genuinely requires passing the row-level check first (§13), not just that the bucket itself is marked private in provider settings.

---

## 12. Environment Variable / Secret Checklist

The following must be confirmed present, correctly scoped, and never client-exposed before proceeding to verification (§13):

- Supabase project URL and service-role key (server-side only, never in frontend code or public repo)
- Supabase anon/public key (if used, scoped only to what RLS explicitly allows)
- Auth provider configuration values needed for session validation
- Any signed-URL / storage access configuration values
- Confirmation that no secret from this checklist has been committed to the public `horseinsurance-ai` repository at any point

No environment variable or secret is added until Rex has explicitly opened this gate.

---

## 13. Post-Apply Verification

Before any real user is allowed near this system, verify:

- All 27 tables exist with correct structure, matching the reviewed schema migration exactly.
- RLS is enabled on every table with no exceptions.
- Every planned policy from spec 18 exists and matches intent (owner-match, reviewer-scoped, no public, bounded service role).
- **Owner case:** a test user can read/write only their own rows.
- **Non-owner case:** a different test user cannot read another user's rows under any query shape.
- **Reviewer case:** a test reviewer-role account can access only routed/assigned review-queue items, nothing else, and access is audited.
- **Service-role case:** service-role access is bounded to its intended operational scope, not a blanket bypass of RLS in practice.
- Storage buckets are private and require a passing row-level check before any signed access is issued.
- No policy text appears anywhere in `audit_events` or any non-designated table.
- Deletes behave as restricted/workflow-driven, not as open row-level delete grants.

Every one of the four RLS test cases (owner, non-owner, reviewer, service-role) must pass **before** production upload is enabled — no exceptions, no partial sign-off.

---

## 14. Rollback / Stop Conditions

- **If the schema migration fails partway**, stop immediately. Do not attempt the RLS policy migration. Repair or roll back the schema migration only; do not layer further changes on top of a partially-applied state.
- **If the RLS policy migration fails partway**, stop immediately. Do not proceed to auth connection or bucket creation. Repair the RLS migration only.
- **If any post-apply verification case (§13) fails** — owner, non-owner, reviewer, or service-role — stop immediately. Do not enable production upload. Repair only the specific failing policy/step; do not proceed past it on the assumption it will be "fine later."
- **If auth connection produces unexpected `user_id`/`auth.users` behavior**, stop before finalizing the FK (§8). Do not force a FK relationship that doesn't match the verified auth behavior.
- **General rule:** a failure at any step means stop and repair only that step — do not skip ahead, do not apply compensating changes elsewhere to work around an unresolved failure.

---

## 15. Do-Not-Do Items

This runbook, on its own, does **not** authorize:

- Modifying specs 01–18
- Modifying either existing SQL migration
- Creating any new SQL migration
- Applying either migration
- Connecting to Supabase
- Creating database tables
- Creating storage buckets
- Configuring Supabase Auth
- Adding environment variables or secrets
- Building backend routes
- Building frontend UI
- Building extraction, generation, verification, report, or reviewer logic
- Deploying anything
- Staging, committing, or pushing any of the above changes

Writing and reviewing this runbook is a planning action only. Every action listed above remains separately gated and requires its own explicit approval from Rex before it happens.

---

## 16. Approval Checklist

_To be completed by Rex before any apply step in this runbook begins. Blank until explicitly filled in._

- Supabase project confirmed: _____
- Schema migration apply approved: _____
- RLS policy migration apply approved: _____
- Auth connection approved: _____
- user_id FK finalization approved: _____
- Storage bucket creation approved: _____
- Environment variables/secrets approved: _____
- Production upload approved: _____
- Approved by: _____
- Date: _____

---

*End of v1.0 Supabase Apply Runbook. This document is a local-only planning artifact. It creates no migration, applies no migration, connects to no database, creates no bucket, configures no auth, adds no secret, builds no code, and authorizes no deployment. It defines the order in which those actions would happen once Rex explicitly opens each gate.*
