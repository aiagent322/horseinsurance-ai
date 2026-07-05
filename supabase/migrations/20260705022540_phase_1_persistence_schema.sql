-- =============================================================================
-- HorseInsurance.ai — Phase 1 Persistence Schema (First Migration)
-- =============================================================================
-- Source specs: 07 (data model), 11 (infrastructure), 12 (auth/isolation),
--               15 (production decisions), 16 (schema model), 17 (migration plan).
--
-- STATUS: LOCAL-ONLY. NOT APPLIED. This file is DDL for review under the
-- spec 17 §16 "create first SQL migration" gate. It creates no database objects
-- until explicitly applied under a separate approval. It does not connect to
-- Supabase, create buckets, configure auth, or deploy anything.
--
-- DESIGN RULES (spec 12 / 16 / 17):
--   * uuid primary keys.
--   * Every user-owned table carries account_id + user_id, NOT NULL (owner-not-null
--     enforced at write time — spec 12 §17, 16 §4/§8).
--   * upload_id / policy_analysis_id anchor rows to their artifact root.
--   * created_at on every table; updated_at on mutable rows.
--   * Foreign keys between owned artifacts and their parents.
--   * value_with_source stored as jsonb: {value, source_ref_ids, confidence, null_reason}
--     (spec 17 §15.3).
--   * Core many-to-many relationships use association tables, NOT arrays
--     (spec 17 §15.4).
--   * missing_items and conflict_records are dedicated tables (spec 17 §15.1/§15.2).
--   * report content is structured report_sections only; rendered output deferred
--     (spec 17 §15.5).
--   * audit_events store references/metadata only, never policy text
--     (spec 11 §8/§17, spec 17 §15.6).
--   * uploaded policy files are private references (object storage key), never
--     public URLs (spec 11 §5/§17).
--
-- NOTE ON user_id: references the auth provider's user identity (spec 12 §3).
-- Supabase Auth is the approved default for planning (spec 15), but the provider
-- is not yet confirmed/wired (spec 16 §15, spec 17 §16). user_id is therefore
-- typed uuid but NOT declared as a FK to auth.users here; that FK is added when
-- the auth-connect gate is approved.
-- =============================================================================

-- Extensions ------------------------------------------------------------------
-- pgcrypto provides gen_random_uuid(). Supabase enables this by default; declared
-- here for portability. (No-op if already present.)
create extension if not exists pgcrypto;

-- =============================================================================
-- SECTION 1 — IDENTITY / OWNERSHIP
-- =============================================================================

-- accounts: top-level ownership boundary (spec 12 §4).
create table accounts (
    account_id            uuid primary key default gen_random_uuid(),
    account_owner_user_id uuid not null,
    account_status        text not null default 'active'
                            check (account_status in
                              ('pending','active','suspended','pending_deletion','closed')),
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

-- account_members: user <-> account membership + role (spec 12 §4).
create table account_members (
    account_member_id uuid primary key default gen_random_uuid(),
    account_id        uuid not null references accounts(account_id) on delete cascade,
    user_id           uuid not null,
    user_role         text not null default 'owner'
                        check (user_role in ('owner','reviewer','admin')),
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (account_id, user_id)
);

create index idx_account_members_account_user on account_members (account_id, user_id);

-- =============================================================================
-- SECTION 2 — UPLOAD SPINE
-- =============================================================================

-- uploads: root of the artifact ownership chain (spec 12 §8).
create table uploads (
    upload_id         uuid primary key default gen_random_uuid(),
    account_id        uuid not null references accounts(account_id) on delete cascade,
    user_id           uuid not null,
    status            text not null default 'received',
    extraction_status text
                        check (extraction_status is null or extraction_status in
                          ('complete','mostly_complete','partial','poor_quality',
                           'unreadable','mixed_documents','needs_more_documents','failed')),
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index idx_uploads_owner on uploads (account_id, user_id);

-- uploaded_policy_files: file metadata; bytes live in PRIVATE object storage,
-- referenced by object_storage_key. Never a public URL (spec 11 §5/§17).
create table uploaded_policy_files (
    file_id            uuid primary key default gen_random_uuid(),
    upload_id          uuid not null references uploads(upload_id) on delete cascade,
    account_id         uuid not null references accounts(account_id) on delete cascade,
    user_id            uuid not null,
    file_name          text not null,
    file_type          text not null
                         check (file_type in ('pdf','jpg','png','heic')),
    object_storage_key text not null,   -- private storage key, NOT a public URL
    page_count         integer,
    ocr_quality_score  integer check (ocr_quality_score is null or
                          (ocr_quality_score between 0 and 100)),
    created_at         timestamptz not null default now()
);

create index idx_uploaded_policy_files_owner  on uploaded_policy_files (account_id, user_id);
create index idx_uploaded_policy_files_upload on uploaded_policy_files (upload_id);

-- =============================================================================
-- SECTION 3 — ANALYSIS ROOT
-- =============================================================================

-- policy_analyses: the PolicyAnalysis root record (spec 07 §3).
create table policy_analyses (
    policy_analysis_id uuid primary key default gen_random_uuid(),
    upload_id          uuid not null references uploads(upload_id) on delete cascade,
    account_id         uuid not null references accounts(account_id) on delete cascade,
    user_id            uuid not null,
    extraction_status  text,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create index idx_policy_analyses_owner  on policy_analyses (account_id, user_id);
create index idx_policy_analyses_upload on policy_analyses (upload_id);

-- policies: distinct policy within an analysis (spec 07 §3). Scalar policy facts
-- stored as value_with_source jsonb (spec 17 §15.3).
create table policies (
    policy_id                 uuid primary key default gen_random_uuid(),
    policy_analysis_id        uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id                uuid not null references accounts(account_id) on delete cascade,
    user_id                   uuid not null,
    carrier_name              jsonb,  -- {value, source_ref_ids, confidence, null_reason}
    policy_number             jsonb,
    policy_period_effective   jsonb,
    policy_period_expiration  jsonb,
    named_insured             jsonb,
    document_types_present    jsonb,
    is_in_force_indeterminate boolean not null default false,
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now()
);

create index idx_policies_owner    on policies (account_id, user_id);
create index idx_policies_analysis on policies (policy_analysis_id);

-- horses: insured animal (spec 07 §3). Per-horse scalars as value_with_source jsonb.
create table horses (
    horse_id           uuid primary key default gen_random_uuid(),
    policy_id          uuid not null references policies(policy_id) on delete cascade,
    policy_analysis_id uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id         uuid not null references accounts(account_id) on delete cascade,
    user_id            uuid not null,
    name               jsonb,
    breed              jsonb,
    age                jsonb,
    insured_value      jsonb,
    created_at         timestamptz not null default now()
);

create index idx_horses_owner  on horses (account_id, user_id);
create index idx_horses_policy on horses (policy_id);

-- =============================================================================
-- SECTION 4 — SOURCE MAPPINGS & EXTRACTED TEXT
-- =============================================================================

-- source_mappings: the source_ref (spec 02 §5). Every citation resolves here.
create table source_mappings (
    source_ref_id        uuid primary key default gen_random_uuid(),
    policy_analysis_id   uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id           uuid not null references accounts(account_id) on delete cascade,
    user_id              uuid not null,
    upload_id            uuid references uploads(upload_id) on delete cascade,
    file_name            text,
    system_page_number   integer,
    printed_page_number  text,
    document_type        text,
    section_heading      text,
    clause_heading       text,
    paragraph_index      integer,
    line_range           text,
    text_snippet         text,   -- verbatim cited excerpt (owner-isolated policy text)
    confidence           integer check (confidence is null or (confidence between 0 and 100)),
    created_at           timestamptz not null default now()
);

create index idx_source_mappings_owner    on source_mappings (account_id, user_id);
create index idx_source_mappings_analysis on source_mappings (policy_analysis_id);

-- extracted_text_pages: extracted text units (spec 02 §13). Large bodies may be
-- offloaded to object storage via object_storage_key (spec 16 §6).
create table extracted_text_pages (
    extracted_text_id   uuid primary key default gen_random_uuid(),
    policy_analysis_id  uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id          uuid not null references accounts(account_id) on delete cascade,
    user_id             uuid not null,
    system_page_number  integer,
    text_body           text,               -- inline text, OR
    object_storage_key  text,               -- private storage key for oversized bodies
    confidence          integer check (confidence is null or (confidence between 0 and 100)),
    created_at          timestamptz not null default now()
);

create index idx_extracted_text_pages_owner    on extracted_text_pages (account_id, user_id);
create index idx_extracted_text_pages_analysis on extracted_text_pages (policy_analysis_id);

-- =============================================================================
-- SECTION 5 — CLAUSES (single source of truth for policy text — spec 07 §5)
-- =============================================================================

create table clause_objects (
    clause_id                    uuid primary key default gen_random_uuid(),
    policy_analysis_id           uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id                   uuid not null references accounts(account_id) on delete cascade,
    user_id                      uuid not null,
    source_ref_id                uuid not null references source_mappings(source_ref_id),  -- NOT NULL: spec 07 §5
    clause_type                  text not null,
    coverage_category            text,
    raw_text                     text,
    normalized_text              text,
    plain_english_summary        text,
    applies_to_policy_period     text,
    applies_to_coverage_categories jsonb,   -- descriptive list (not a core M2M link)
    flags                        jsonb,
    missing_related_clause_types jsonb,
    confidence                   integer check (confidence is null or (confidence between 0 and 100)),
    created_at                   timestamptz not null default now()
);

create index idx_clause_objects_owner     on clause_objects (account_id, user_id);
create index idx_clause_objects_analysis  on clause_objects (policy_analysis_id);
create index idx_clause_objects_sourceref on clause_objects (source_ref_id);

-- =============================================================================
-- SECTION 6 — COVERAGES, EXCLUSIONS, CONDITIONS
-- =============================================================================

-- coverage_objects: one coverage category (spec 07 §4).
create table coverage_objects (
    coverage_id        uuid primary key default gen_random_uuid(),
    policy_id          uuid not null references policies(policy_id) on delete cascade,
    policy_analysis_id uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id         uuid not null references accounts(account_id) on delete cascade,
    user_id            uuid not null,
    coverage_category  text not null,
    coverage_status    text
                         check (coverage_status is null or coverage_status in
                           ('Included','Appears Listed','Limited','Excluded',
                            'Not Found','Unclear','Detection Only')),
    confidence_label   text
                         check (confidence_label is null or confidence_label in
                           ('Confirmed','Likely','Unclear','Not Found')),
    confidence_reason  text,
    detection_only     boolean not null default false,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create index idx_coverage_objects_owner    on coverage_objects (account_id, user_id);
create index idx_coverage_objects_analysis on coverage_objects (policy_analysis_id);
create index idx_coverage_objects_policy   on coverage_objects (policy_id);

-- exclusion_objects: specializes an exclusion clause (spec 07 §6). Links to the
-- coverages it affects are via the coverage_exclusion_links association table.
create table exclusion_objects (
    exclusion_id            uuid primary key default gen_random_uuid(),
    clause_id               uuid not null references clause_objects(clause_id) on delete cascade,
    policy_analysis_id      uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id              uuid not null references accounts(account_id) on delete cascade,
    user_id                 uuid not null,
    exclusion_category      text,
    scope_note              text,
    depends_on_undefined_term boolean not null default false,
    confidence              integer check (confidence is null or (confidence between 0 and 100)),
    created_at              timestamptz not null default now()
);

create index idx_exclusion_objects_owner    on exclusion_objects (account_id, user_id);
create index idx_exclusion_objects_clause   on exclusion_objects (clause_id);
create index idx_exclusion_objects_analysis on exclusion_objects (policy_analysis_id);

-- condition_obligation_objects: specializes a condition/duty clause (spec 07 §7).
create table condition_obligation_objects (
    condition_id                 uuid primary key default gen_random_uuid(),
    clause_id                    uuid not null references clause_objects(clause_id) on delete cascade,
    policy_analysis_id           uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id                   uuid not null references accounts(account_id) on delete cascade,
    user_id                      uuid not null,
    condition_type               text,
    obligation_text              text,
    deadline_value               jsonb,   -- value_with_source; null-with-reason if absent
    is_mandatory                 boolean, -- nullable: undeterminable from documents
    has_emergency_exception      boolean not null default false,
    emergency_exception_clause_id uuid references clause_objects(clause_id),
    confidence                   integer check (confidence is null or (confidence between 0 and 100)),
    created_at                   timestamptz not null default now()
);

create index idx_condition_obj_owner    on condition_obligation_objects (account_id, user_id);
create index idx_condition_obj_clause   on condition_obligation_objects (clause_id);
create index idx_condition_obj_analysis on condition_obligation_objects (policy_analysis_id);

-- =============================================================================
-- SECTION 7 — CORE ASSOCIATION TABLES (many-to-many; NOT arrays — spec 17 §15.4)
-- =============================================================================
-- Two-way linkage integrity (spec 07 §11) is enforced at the DB layer via FKs.

-- clause_links: general clause-to-clause relationships (related / modifies).
create table clause_links (
    clause_link_id     uuid primary key default gen_random_uuid(),
    policy_analysis_id uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id         uuid not null references accounts(account_id) on delete cascade,
    user_id            uuid not null,
    from_clause_id     uuid not null references clause_objects(clause_id) on delete cascade,
    to_clause_id       uuid not null references clause_objects(clause_id) on delete cascade,
    link_type          text not null
                         check (link_type in ('related','modifies','modified_by')),
    created_at         timestamptz not null default now(),
    unique (from_clause_id, to_clause_id, link_type)
);

create index idx_clause_links_owner on clause_links (account_id, user_id);
create index idx_clause_links_from  on clause_links (from_clause_id);
create index idx_clause_links_to    on clause_links (to_clause_id);

-- coverage_clause_links: coverage <-> clause (grant/limit/deductible/etc.).
create table coverage_clause_links (
    coverage_clause_link_id uuid primary key default gen_random_uuid(),
    policy_analysis_id      uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id              uuid not null references accounts(account_id) on delete cascade,
    user_id                 uuid not null,
    coverage_id             uuid not null references coverage_objects(coverage_id) on delete cascade,
    clause_id               uuid not null references clause_objects(clause_id) on delete cascade,
    role                    text not null,   -- e.g. grant | limit | sublimit | deductible | definition | endorsement
    created_at              timestamptz not null default now(),
    unique (coverage_id, clause_id, role)
);

create index idx_cov_clause_links_owner    on coverage_clause_links (account_id, user_id);
create index idx_cov_clause_links_coverage on coverage_clause_links (coverage_id);
create index idx_cov_clause_links_clause   on coverage_clause_links (clause_id);

-- coverage_exclusion_links: coverage <-> exclusion (spec 03 §6, spec 07 §4/§6).
create table coverage_exclusion_links (
    coverage_exclusion_link_id uuid primary key default gen_random_uuid(),
    policy_analysis_id         uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id                 uuid not null references accounts(account_id) on delete cascade,
    user_id                    uuid not null,
    coverage_id                uuid not null references coverage_objects(coverage_id) on delete cascade,
    exclusion_id               uuid not null references exclusion_objects(exclusion_id) on delete cascade,
    created_at                 timestamptz not null default now(),
    unique (coverage_id, exclusion_id)
);

create index idx_cov_excl_links_owner     on coverage_exclusion_links (account_id, user_id);
create index idx_cov_excl_links_coverage  on coverage_exclusion_links (coverage_id);
create index idx_cov_excl_links_exclusion on coverage_exclusion_links (exclusion_id);

-- coverage_condition_links: coverage <-> condition/obligation (spec 07 §4/§7).
create table coverage_condition_links (
    coverage_condition_link_id uuid primary key default gen_random_uuid(),
    policy_analysis_id         uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id                 uuid not null references accounts(account_id) on delete cascade,
    user_id                    uuid not null,
    coverage_id                uuid not null references coverage_objects(coverage_id) on delete cascade,
    condition_id               uuid not null references condition_obligation_objects(condition_id) on delete cascade,
    created_at                 timestamptz not null default now(),
    unique (coverage_id, condition_id)
);

create index idx_cov_cond_links_owner     on coverage_condition_links (account_id, user_id);
create index idx_cov_cond_links_coverage  on coverage_condition_links (coverage_id);
create index idx_cov_cond_links_condition on coverage_condition_links (condition_id);

-- coverage_horse_links: coverage <-> horse (per-horse applicability; never merge
-- horses — spec 02 §9, spec 03 §3).
create table coverage_horse_links (
    coverage_horse_link_id uuid primary key default gen_random_uuid(),
    policy_analysis_id     uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id             uuid not null references accounts(account_id) on delete cascade,
    user_id                uuid not null,
    coverage_id            uuid not null references coverage_objects(coverage_id) on delete cascade,
    horse_id               uuid not null references horses(horse_id) on delete cascade,
    created_at             timestamptz not null default now(),
    unique (coverage_id, horse_id)
);

create index idx_cov_horse_links_owner    on coverage_horse_links (account_id, user_id);
create index idx_cov_horse_links_coverage on coverage_horse_links (coverage_id);
create index idx_cov_horse_links_horse    on coverage_horse_links (horse_id);

-- =============================================================================
-- SECTION 8 — MISSING ITEMS & CONFLICTS (dedicated tables — spec 17 §15.1/§15.2)
-- =============================================================================

-- missing_items: dedicated queryable table for missing documents/relationships.
create table missing_items (
    missing_item_id    uuid primary key default gen_random_uuid(),
    policy_analysis_id uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id         uuid not null references accounts(account_id) on delete cascade,
    user_id            uuid not null,
    missing_type       text not null,   -- e.g. referenced_form_not_uploaded | exclusions_missing | ...
    description        text,
    affected_coverage_id uuid references coverage_objects(coverage_id) on delete set null,
    source_ref_id      uuid references source_mappings(source_ref_id) on delete set null,
    created_at         timestamptz not null default now()
);

create index idx_missing_items_owner    on missing_items (account_id, user_id);
create index idx_missing_items_analysis on missing_items (policy_analysis_id);
create index idx_missing_items_type     on missing_items (missing_type);

-- conflict_records: dedicated queryable table for detected conflicts (never
-- silently resolved — spec 03 §10). Involved clauses linked via conflict_clause_links.
create table conflict_records (
    conflict_id        uuid primary key default gen_random_uuid(),
    policy_analysis_id uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id         uuid not null references accounts(account_id) on delete cascade,
    user_id            uuid not null,
    conflict_type      text not null,
    description        text,
    affected_coverage_id uuid references coverage_objects(coverage_id) on delete set null,
    resolved           boolean not null default false,  -- supports "unresolved conflicts" reporting
    created_at         timestamptz not null default now()
);

create index idx_conflict_records_owner    on conflict_records (account_id, user_id);
create index idx_conflict_records_analysis on conflict_records (policy_analysis_id);
create index idx_conflict_records_type     on conflict_records (conflict_type);
create index idx_conflict_records_resolved on conflict_records (resolved);

-- conflict_clause_links: conflict <-> clause (which clauses are in conflict).
create table conflict_clause_links (
    conflict_clause_link_id uuid primary key default gen_random_uuid(),
    policy_analysis_id      uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id              uuid not null references accounts(account_id) on delete cascade,
    user_id                 uuid not null,
    conflict_id             uuid not null references conflict_records(conflict_id) on delete cascade,
    clause_id               uuid not null references clause_objects(clause_id) on delete cascade,
    created_at              timestamptz not null default now(),
    unique (conflict_id, clause_id)
);

create index idx_conflict_clause_links_owner    on conflict_clause_links (account_id, user_id);
create index idx_conflict_clause_links_conflict on conflict_clause_links (conflict_id);
create index idx_conflict_clause_links_clause   on conflict_clause_links (clause_id);

-- =============================================================================
-- SECTION 9 — CONFIDENCE & VERIFICATION
-- =============================================================================

-- confidence_results: per-object confidence label/cap/reason (spec 08).
create table confidence_results (
    confidence_result_id uuid primary key default gen_random_uuid(),
    policy_analysis_id   uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id           uuid not null references accounts(account_id) on delete cascade,
    user_id              uuid not null,
    attached_object_type text not null,
    attached_object_id   uuid not null,
    confidence_label     text
                           check (confidence_label is null or confidence_label in
                             ('Confirmed','Likely','Unclear','Not Found')),
    caps_confidence_at   text,
    caps_applied         jsonb,
    confidence_reason    text,
    created_at           timestamptz not null default now()
);

create index idx_confidence_results_owner    on confidence_results (account_id, user_id);
create index idx_confidence_results_analysis on confidence_results (policy_analysis_id);
create index idx_confidence_results_label    on confidence_results (confidence_label);
create index idx_confidence_results_object   on confidence_results (attached_object_type, attached_object_id);

-- verification_results: per-statement verification (spec 09). Snippets that
-- justify a decision live HERE (access-controlled), not in audit_events (spec 16 §9).
create table verification_results (
    verification_id     uuid primary key default gen_random_uuid(),
    policy_analysis_id  uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id          uuid not null references accounts(account_id) on delete cascade,
    user_id             uuid not null,
    statement_id        uuid,
    verification_status text
                          check (verification_status is null or verification_status in
                            ('Fully Supported','Partially Supported','Contradicted',
                             'Unsupported','Insufficient Evidence')),
    binding             jsonb,   -- {source_page, source_snippet, policy_section, confidence_label}
    entailment_findings jsonb,
    numeric_check       jsonb,
    rescoped_statement  text,
    reverify_status     text,
    display_outcome     text,
    routed_to_review    boolean not null default false,
    review_reason       text,
    created_at          timestamptz not null default now()
);

create index idx_verification_results_owner    on verification_results (account_id, user_id);
create index idx_verification_results_analysis on verification_results (policy_analysis_id);
create index idx_verification_results_status   on verification_results (verification_status);

-- =============================================================================
-- SECTION 10 — ANSWERS & REPORT SECTIONS
-- =============================================================================

-- generated_answers: consumer answers (spec 04 §16).
create table generated_answers (
    answer_id                        uuid primary key default gen_random_uuid(),
    policy_analysis_id               uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id                       uuid not null references accounts(account_id) on delete cascade,
    user_id                          uuid not null,
    user_question                    text,
    normalized_question              text,
    answer_type                      text,
    direct_answer                    text,
    coverage_status                  text,
    confidence_label                 text
                                       check (confidence_label is null or confidence_label in
                                         ('Confirmed','Likely','Unclear','Not Found')),
    confidence_reason                text,
    limits_found                     jsonb,
    deductibles_found                jsonb,
    exclusions_found                 jsonb,
    conditions_found                 jsonb,
    missing_documents                jsonb,
    conflicts                        jsonb,
    detection_only_flag              boolean not null default false,
    consumer_safe_summary            text,
    what_this_answer_does_not_determine text,
    created_at                       timestamptz not null default now(),
    updated_at                       timestamptz not null default now()
);

create index idx_generated_answers_owner    on generated_answers (account_id, user_id);
create index idx_generated_answers_analysis on generated_answers (policy_analysis_id);

-- report_sections: STRUCTURED report content only. Rendered PDF output is DEFERRED
-- (spec 17 §15.5) — not stored in this migration.
create table report_sections (
    report_section_id     uuid primary key default gen_random_uuid(),
    policy_analysis_id    uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id            uuid not null references accounts(account_id) on delete cascade,
    user_id               uuid not null,
    section_key           text not null,
    section_confidence    text,
    included_answer_ids   jsonb,   -- descriptive references to generated_answers
    included_verification_ids jsonb,
    gap_notes             text,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

create index idx_report_sections_owner    on report_sections (account_id, user_id);
create index idx_report_sections_analysis on report_sections (policy_analysis_id);

-- =============================================================================
-- SECTION 11 — OPERATIONAL: AUDIT & REVIEW QUEUE
-- =============================================================================

-- audit_events: references and metadata ONLY — NO policy text (spec 11 §8/§17,
-- spec 17 §15.6). Snippets justifying a decision live in verification_results.
create table audit_events (
    audit_event_id     uuid primary key default gen_random_uuid(),
    account_id         uuid not null references accounts(account_id) on delete cascade,
    user_id            uuid not null,
    policy_analysis_id uuid references policy_analyses(policy_analysis_id) on delete set null,
    stage_entered      text,
    stage_completed    text,
    input_object_id    uuid,
    output_object_id   uuid,
    confidence_label   text,
    verification_result text,
    block_reason       text,
    review_reason      text,
    actor_role         text,   -- for reviewer/admin actions (spec 13 §12)
    event_timestamp    timestamptz not null default now(),
    created_at         timestamptz not null default now()
    -- NOTE: no column stores policy text / snippets by design (spec 11 §17).
);

create index idx_audit_events_owner    on audit_events (account_id, user_id);
create index idx_audit_events_analysis on audit_events (policy_analysis_id, event_timestamp);
create index idx_audit_events_acct_ts  on audit_events (account_id, event_timestamp);

-- review_queue_entries: routed-to-review items (spec 08 §11, spec 10 §10, spec 13 §3).
create table review_queue_entries (
    review_entry_id          uuid primary key default gen_random_uuid(),
    policy_analysis_id       uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id               uuid not null references accounts(account_id) on delete cascade,
    user_id                  uuid not null,
    entry_type               text not null,
    routing_reason           text,
    priority                 text
                               check (priority is null or priority in
                                 ('critical','high','normal','low')),
    status                   text not null default 'pending'
                               check (status in ('pending','claimed','resolved','retired')),
    assigned_reviewer_user_id uuid,
    statement_id             uuid,
    outcome                  text
                               check (outcome is null or outcome in
                                 ('approve','revise','reject')),
    reviewer_note            text,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now()
);

create index idx_review_queue_owner          on review_queue_entries (account_id, user_id);
create index idx_review_queue_analysis       on review_queue_entries (policy_analysis_id);
create index idx_review_queue_status_priority on review_queue_entries (status, priority);

-- =============================================================================
-- SECTION 12 — ROW-LEVEL SECURITY (ENABLE ONLY — POLICIES DEFERRED)
-- =============================================================================
-- Spec 12 §7 / spec 16 §13 / spec 17 §11 require RLS as the DB-level isolation
-- backstop. Per spec 17 §16, "Enabling RLS" and writing RLS POLICIES are SEPARATE
-- APPROVAL GATES. This migration ENABLES RLS with default-deny (RLS on + no policy
-- = no access) so no table is left unprotected, but DOES NOT define the owner /
-- reviewer / service policies.
--
-- >>> DEFERRED APPROVAL ITEM (spec 17 §16): the following RLS POLICIES are NOT
-- >>> written here and must be added under explicit approval before app access:
-- >>>   * owner read/write policy: row visible only when account_id/user_id match
-- >>>     the validated session (spec 12 §5/§7)
-- >>>   * reviewer/admin role-scoped policy over review_queue_entries + linked
-- >>>     decision content (spec 12 §13, spec 13 §5)
-- >>>   * service-role policy bounded to pipeline operation (spec 16 §13)
-- >>>   * NO public role on any policy-content table (spec 11 §17)
-- Until those policies are added under approval, RLS default-deny blocks all
-- non-superuser access — intentional, so nothing is exposed pre-policy.

alter table accounts                     enable row level security;
alter table account_members              enable row level security;
alter table uploads                      enable row level security;
alter table uploaded_policy_files        enable row level security;
alter table extracted_text_pages         enable row level security;
alter table source_mappings              enable row level security;
alter table policy_analyses              enable row level security;
alter table policies                     enable row level security;
alter table horses                       enable row level security;
alter table clause_objects               enable row level security;
alter table coverage_objects             enable row level security;
alter table exclusion_objects            enable row level security;
alter table condition_obligation_objects enable row level security;
alter table clause_links                 enable row level security;
alter table coverage_clause_links        enable row level security;
alter table coverage_exclusion_links     enable row level security;
alter table coverage_condition_links     enable row level security;
alter table coverage_horse_links         enable row level security;
alter table missing_items                enable row level security;
alter table conflict_records             enable row level security;
alter table conflict_clause_links        enable row level security;
alter table confidence_results           enable row level security;
alter table verification_results         enable row level security;
alter table generated_answers            enable row level security;
alter table report_sections              enable row level security;
alter table audit_events                 enable row level security;
alter table review_queue_entries         enable row level security;

-- =============================================================================
-- END OF PHASE 1 PERSISTENCE SCHEMA MIGRATION (local-only, not applied)
-- Deferred / separately-gated items (spec 17 §16): RLS policies, storage buckets,
-- purge/retention jobs (windows pending compliance), auth provider FK to user_id,
-- rendered report output, production upload enablement.
-- =============================================================================
