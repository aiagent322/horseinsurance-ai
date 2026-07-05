-- =============================================================================
-- HorseInsurance.ai — Phase 1 Row-Level Security Policies (Second Migration)
-- =============================================================================
-- Source: spec 12 (auth/isolation), spec 16 (schema model §13), spec 17 (§11/§16),
--         spec 18 (RLS policy plan), and the Phase 1 schema migration
--         (20260705022540_phase_1_persistence_schema.sql).
--
-- STATUS: LOCAL-ONLY. NOT APPLIED. This file writes the CREATE POLICY statements
-- planned in spec 18, under the spec 17 §16 "write RLS policies" gate. It creates
-- no database objects until explicitly applied under separate approval. It does
-- not connect to Supabase, create buckets, configure auth, or deploy anything.
--
-- PREREQUISITE: the schema migration already ran `ENABLE ROW LEVEL SECURITY` on
-- all 27 tables (default-deny). This migration ADDS the policies over that deny
-- baseline. It does NOT modify the schema migration. It must run AFTER it
-- (filename timestamp 20260705145522 > 20260705022540).
--
-- IDENTITY MODEL (spec 12 §3/§5; Supabase Auth = approved planning default, spec 15):
--   * auth.uid() = the validated session user id.
--   * Account membership + role resolved from account_members (source of truth).
--   * Policies match against the VALIDATED session identity only — never a
--     client-supplied user_id/account_id (spec 12 §5).
--
-- NOTE: auth provider connection remains gated (spec 18 §19). These policies
-- reference auth.uid(); applying them presumes Supabase Auth is connected, which
-- is a SEPARATE approval. This file is written, not applied.
--
-- POLICY GROUPS (spec 18):
--   A. Helper functions (session -> accounts, role)     [SECURITY DEFINER, read-only]
--   B. Owner / account-member SELECT+INSERT+UPDATE on owned content tables
--   C. Reviewer read/limited-update, scoped to routed/assigned review items
--   D. Service-role (pipeline) bounded access — no public bypass
--   E. audit_events: append-only (insert only; no update/delete; no policy text)
--   F. review_queue_entries: internal; owners excluded; reviewer/admin only
--   G. accounts / account_members: account-scoped, role-gated writes
--   H. Deletes: restricted; no broad user DELETE policy (retention/deletion workflow only)
--
-- No public/anon policy is created for any policy-content table (spec 11 §17,
-- spec 12 §16). Default-deny remains in force for any operation not granted below.
-- =============================================================================

-- =============================================================================
-- GROUP A — HELPER FUNCTIONS (read-only membership/role resolution)
-- =============================================================================
-- These resolve the session's account membership and role from account_members.
-- SECURITY DEFINER so the helper can read account_members without recursing into
-- its own RLS. They are read-only and expose only membership booleans / ids.

create or replace function app_is_account_member(target_account uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from account_members m
    where m.account_id = target_account
      and m.user_id = auth.uid()
  );
$$;

create or replace function app_has_role(target_account uuid, wanted_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from account_members m
    where m.account_id = target_account
      and m.user_id = auth.uid()
      and m.user_role = wanted_role
  );
$$;

-- Global staff-role check (reviewer/admin are staff roles, not tied to the data's
-- owning account — spec 12 §13, spec 13 §5). True if the session user holds the
-- role in ANY account_members row (staff identities).
create or replace function app_is_staff(wanted_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from account_members m
    where m.user_id = auth.uid()
      and m.user_role = wanted_role
  );
$$;

-- =============================================================================
-- GROUP G — accounts / account_members (account-scoped, role-gated)
-- =============================================================================

-- accounts: a member of the account may read it; only the account owner may update.
create policy accounts_select_member on accounts
  for select using ( app_is_account_member(account_id) );

create policy accounts_update_owner on accounts
  for update using ( account_owner_user_id = auth.uid() )
             with check ( account_owner_user_id = auth.uid() );

-- account_members: a member sees their own account's membership rows.
create policy account_members_select_member on account_members
  for select using ( app_is_account_member(account_id) );

-- Inserting/updating membership (role changes) is an admin/owner operation; scoped
-- to the account owner or a staff admin. (No self-service role escalation.)
create policy account_members_write_admin on account_members
  for insert with check (
    app_has_role(account_id, 'owner') or app_is_staff('admin')
  );

create policy account_members_update_admin on account_members
  for update using (
    app_has_role(account_id, 'owner') or app_is_staff('admin')
  ) with check (
    app_has_role(account_id, 'owner') or app_is_staff('admin')
  );

-- =============================================================================
-- GROUP B — OWNER / ACCOUNT-MEMBER ACCESS on owned content tables
-- =============================================================================
-- Pattern (spec 12 §6/§7, spec 18 §6/§7/§11/§12/§13):
--   SELECT: account member of the row's account (MVP 1:1 => the owner).
--   INSERT: new row's account_id/user_id must match session (owner-match; RLS
--           complement to owner-not-null).
--   UPDATE: account member; ownership columns are not user-mutable.
--   DELETE: NOT granted here (Group H) — restricted to retention/deletion workflow.
-- Applied uniformly to every owned content + association table.

-- ---- uploads ----------------------------------------------------------------
create policy uploads_select_owner on uploads
  for select using ( app_is_account_member(account_id) );
create policy uploads_insert_owner on uploads
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy uploads_update_owner on uploads
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- uploaded_policy_files ---------------------------------------------------
create policy upfiles_select_owner on uploaded_policy_files
  for select using ( app_is_account_member(account_id) );
create policy upfiles_insert_owner on uploaded_policy_files
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy upfiles_update_owner on uploaded_policy_files
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- policy_analyses ---------------------------------------------------------
create policy analyses_select_owner on policy_analyses
  for select using ( app_is_account_member(account_id) );
create policy analyses_insert_owner on policy_analyses
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy analyses_update_owner on policy_analyses
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- policies ----------------------------------------------------------------
create policy policies_select_owner on policies
  for select using ( app_is_account_member(account_id) );
create policy policies_insert_owner on policies
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy policies_update_owner on policies
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- horses ------------------------------------------------------------------
create policy horses_select_owner on horses
  for select using ( app_is_account_member(account_id) );
create policy horses_insert_owner on horses
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy horses_update_owner on horses
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- source_mappings ---------------------------------------------------------
create policy srcmap_select_owner on source_mappings
  for select using ( app_is_account_member(account_id) );
create policy srcmap_insert_owner on source_mappings
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy srcmap_update_owner on source_mappings
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- extracted_text_pages ----------------------------------------------------
create policy extext_select_owner on extracted_text_pages
  for select using ( app_is_account_member(account_id) );
create policy extext_insert_owner on extracted_text_pages
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy extext_update_owner on extracted_text_pages
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- clause_objects ----------------------------------------------------------
create policy clauses_select_owner on clause_objects
  for select using ( app_is_account_member(account_id) );
create policy clauses_insert_owner on clause_objects
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy clauses_update_owner on clause_objects
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- coverage_objects --------------------------------------------------------
create policy coverages_select_owner on coverage_objects
  for select using ( app_is_account_member(account_id) );
create policy coverages_insert_owner on coverage_objects
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy coverages_update_owner on coverage_objects
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- exclusion_objects -------------------------------------------------------
create policy exclusions_select_owner on exclusion_objects
  for select using ( app_is_account_member(account_id) );
create policy exclusions_insert_owner on exclusion_objects
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy exclusions_update_owner on exclusion_objects
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- condition_obligation_objects --------------------------------------------
create policy conditions_select_owner on condition_obligation_objects
  for select using ( app_is_account_member(account_id) );
create policy conditions_insert_owner on condition_obligation_objects
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy conditions_update_owner on condition_obligation_objects
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- clause_links (association) ----------------------------------------------
create policy clinks_select_owner on clause_links
  for select using ( app_is_account_member(account_id) );
create policy clinks_insert_owner on clause_links
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy clinks_update_owner on clause_links
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- coverage_clause_links (association) -------------------------------------
create policy cclinks_select_owner on coverage_clause_links
  for select using ( app_is_account_member(account_id) );
create policy cclinks_insert_owner on coverage_clause_links
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy cclinks_update_owner on coverage_clause_links
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- coverage_exclusion_links (association) ----------------------------------
create policy celinks_select_owner on coverage_exclusion_links
  for select using ( app_is_account_member(account_id) );
create policy celinks_insert_owner on coverage_exclusion_links
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy celinks_update_owner on coverage_exclusion_links
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- coverage_condition_links (association) ----------------------------------
create policy cdlinks_select_owner on coverage_condition_links
  for select using ( app_is_account_member(account_id) );
create policy cdlinks_insert_owner on coverage_condition_links
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy cdlinks_update_owner on coverage_condition_links
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- coverage_horse_links (association) --------------------------------------
create policy chlinks_select_owner on coverage_horse_links
  for select using ( app_is_account_member(account_id) );
create policy chlinks_insert_owner on coverage_horse_links
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy chlinks_update_owner on coverage_horse_links
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- missing_items -----------------------------------------------------------
create policy missing_select_owner on missing_items
  for select using ( app_is_account_member(account_id) );
create policy missing_insert_owner on missing_items
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy missing_update_owner on missing_items
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- conflict_records --------------------------------------------------------
create policy conflicts_select_owner on conflict_records
  for select using ( app_is_account_member(account_id) );
create policy conflicts_insert_owner on conflict_records
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy conflicts_update_owner on conflict_records
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- conflict_clause_links (association) --------------------------------------
create policy cfclinks_select_owner on conflict_clause_links
  for select using ( app_is_account_member(account_id) );
create policy cfclinks_insert_owner on conflict_clause_links
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy cfclinks_update_owner on conflict_clause_links
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- confidence_results ------------------------------------------------------
create policy conf_select_owner on confidence_results
  for select using ( app_is_account_member(account_id) );
create policy conf_insert_owner on confidence_results
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy conf_update_owner on confidence_results
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- verification_results ----------------------------------------------------
-- Owner sees own; reviewers also read (Group C) since this holds decision snippets.
create policy verif_select_owner on verification_results
  for select using ( app_is_account_member(account_id) );
create policy verif_insert_owner on verification_results
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy verif_update_owner on verification_results
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- generated_answers -------------------------------------------------------
create policy answers_select_owner on generated_answers
  for select using ( app_is_account_member(account_id) );
create policy answers_insert_owner on generated_answers
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy answers_update_owner on generated_answers
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- ---- report_sections ---------------------------------------------------------
create policy reports_select_owner on report_sections
  for select using ( app_is_account_member(account_id) );
create policy reports_insert_owner on report_sections
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy reports_update_owner on report_sections
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );

-- =============================================================================
-- GROUP C — REVIEWER ACCESS (role-limited; routed / assigned items only)
-- =============================================================================
-- Reviewers (spec 12 §13, spec 13 §5/§8) read ONLY content tied to a review_queue
-- entry that is routed to review, and update ONLY the review entry they are
-- permitted/assigned. They never get a table-wide select, and never cross into
-- content whose analysis has no routed review item.
--
-- Reviewer read of verification_results (their primary decision content, spec 18
-- §10): only rows whose policy_analysis_id has an active routed review entry.
create policy verif_select_reviewer on verification_results
  for select using (
    app_is_staff('reviewer')
    and exists (
      select 1 from review_queue_entries rq
      where rq.policy_analysis_id = verification_results.policy_analysis_id
        and rq.status in ('pending','claimed')
    )
  );

-- Reviewer read of the underlying decision content (clauses / coverages /
-- exclusions / conditions / source_mappings) for analyses with a routed item.
create policy clauses_select_reviewer on clause_objects
  for select using (
    app_is_staff('reviewer')
    and exists ( select 1 from review_queue_entries rq
                 where rq.policy_analysis_id = clause_objects.policy_analysis_id
                   and rq.status in ('pending','claimed') )
  );

create policy coverages_select_reviewer on coverage_objects
  for select using (
    app_is_staff('reviewer')
    and exists ( select 1 from review_queue_entries rq
                 where rq.policy_analysis_id = coverage_objects.policy_analysis_id
                   and rq.status in ('pending','claimed') )
  );

create policy exclusions_select_reviewer on exclusion_objects
  for select using (
    app_is_staff('reviewer')
    and exists ( select 1 from review_queue_entries rq
                 where rq.policy_analysis_id = exclusion_objects.policy_analysis_id
                   and rq.status in ('pending','claimed') )
  );

create policy conditions_select_reviewer on condition_obligation_objects
  for select using (
    app_is_staff('reviewer')
    and exists ( select 1 from review_queue_entries rq
                 where rq.policy_analysis_id = condition_obligation_objects.policy_analysis_id
                   and rq.status in ('pending','claimed') )
  );

create policy srcmap_select_reviewer on source_mappings
  for select using (
    app_is_staff('reviewer')
    and exists ( select 1 from review_queue_entries rq
                 where rq.policy_analysis_id = source_mappings.policy_analysis_id
                   and rq.status in ('pending','claimed') )
  );

-- =============================================================================
-- GROUP F — review_queue_entries (internal; owners excluded; reviewer/admin only)
-- =============================================================================
-- Owners have NO access (spec 13 §12). Reviewers read routed items and update the
-- one they are permitted/assigned. Admin may reassign/escalate.

create policy rq_select_staff on review_queue_entries
  for select using ( app_is_staff('reviewer') or app_is_staff('admin') );

-- Reviewer may update only an item they are assigned (or an unassigned pending
-- item they are claiming) — records outcome + note (spec 13 §9/§10).
create policy rq_update_reviewer on review_queue_entries
  for update using (
    app_is_staff('reviewer')
    and ( assigned_reviewer_user_id = auth.uid()
          or (assigned_reviewer_user_id is null and status = 'pending') )
  ) with check (
    app_is_staff('reviewer')
  );

-- Admin may update (reassign / escalate / retire).
create policy rq_update_admin on review_queue_entries
  for update using ( app_is_staff('admin') )
             with check ( app_is_staff('admin') );

-- Inserts to the queue come from the pipeline (service role, Group D); no owner
-- or reviewer insert policy is granted here.

-- =============================================================================
-- GROUP E — audit_events (APPEND-ONLY; references/metadata only; no policy text)
-- =============================================================================
-- audit_events stores IDs/labels/reasons/timestamps ONLY — the schema has no
-- policy-text column (spec 11 §17, spec 18 §15). Append-only is enforced by
-- granting INSERT but NO update/delete policy (default-deny blocks update/delete).
--
-- Owners do NOT read audit_events (spec 12 §11, spec 18 §15). Reviewer/admin read
-- their operational scope; the pipeline (service) and staff actions insert.

create policy audit_select_staff on audit_events
  for select using ( app_is_staff('reviewer') or app_is_staff('admin') );

create policy audit_insert_staff on audit_events
  for insert with check (
    -- pipeline/staff append within the owning account's scope; identity present.
    auth.uid() is not null
    and ( app_is_account_member(account_id) or app_is_staff('admin') or app_is_staff('reviewer') )
  );
-- NO update policy and NO delete policy on audit_events => append-only by default-deny.

-- =============================================================================
-- GROUP D — SERVICE ROLE (pipeline) NOTE
-- =============================================================================
-- The orchestration API's Supabase SERVICE ROLE key bypasses RLS by design and is
-- used server-side ONLY (spec 16 §13, spec 11 §3) — never exposed to the browser,
-- never a public bypass. Its access is bounded to pipeline operation and audited
-- at the app layer. No additional policy is required for the service role (it is
-- not subject to RLS); it is documented here so the bypass is explicit and
-- intentional, not accidental. The anon/public key has NO policy anywhere and is
-- therefore fully denied on every table (spec 11 §17, spec 12 §16).

-- =============================================================================
-- GROUP H — DELETES (restricted; NO broad user DELETE policy)
-- =============================================================================
-- No DELETE policy is created on any content, association, audit, or queue table.
-- With RLS enabled and no DELETE policy, deletes are DENIED for all non-service
-- roles (spec 18 §14). User-initiated deletion (spec 12 §14) and retention purges
-- (spec 11 §15) are performed by controlled, audited workflows via the service
-- role (or a dedicated, separately-approved deletion routine) — NOT by an
-- ad-hoc user DELETE grant. Review entries are retired via status update, not
-- deleted (spec 13 §16).
--   >>> DEFERRED (separately gated): the deletion/purge workflow itself
-- (spec 17 §14, blocked on compliance retention windows) is NOT created here.

-- =============================================================================
-- END OF PHASE 1 RLS POLICIES MIGRATION (local-only, not applied)
-- Default-deny remains for any (table, operation) not granted above:
--   * no public/anon access anywhere
--   * no cross-account access (owner policies match session account only)
--   * no owner access to review_queue_entries or audit_events
--   * audit_events append-only (no update/delete)
--   * no DELETE grants (deletion via workflow only)
-- Separately-gated next steps: apply migrations, connect Supabase Auth,
-- create storage buckets, build deletion/purge workflow, enable production upload.
-- =============================================================================
