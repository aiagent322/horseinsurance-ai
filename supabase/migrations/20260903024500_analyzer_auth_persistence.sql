-- =============================================================================
-- HorseInsurance.ai — Additive analyzer persistence, retention, storage RLS
-- =============================================================================
-- Does NOT rewrite 20260705022540 or 20260705145522.
-- Adds columns/tables/policies/functions required by the Next.js analyzer.
-- Idempotent where practical. Local-only until explicitly applied.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Columns on existing tables
-- -----------------------------------------------------------------------------
alter table uploaded_policy_files
  add column if not exists file_sha256 text,
  add column if not exists document_id uuid,
  add column if not exists extraction_status text;

alter table extracted_text_pages
  add column if not exists file_id uuid references uploaded_policy_files(file_id) on delete cascade,
  add column if not exists extraction_method text,
  add column if not exists quality_status text,
  add column if not exists ocr_attempted boolean not null default false,
  add column if not exists ocr_succeeded boolean not null default false,
  add column if not exists character_count integer,
  add column if not exists word_count integer,
  add column if not exists alphanumeric_ratio numeric,
  add column if not exists diagnostic_warnings jsonb,
  add column if not exists extraction_confidence text;

alter table policy_analyses
  add column if not exists analyzer_policy_id uuid,
  add column if not exists session_id uuid,
  add column if not exists retention_expires_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deletion_status text not null default 'active'
    check (deletion_status in ('active','pending_deletion','deleted')),
  add column if not exists completeness_status text,
  add column if not exists analysis_status text;

alter table coverage_objects
  add column if not exists analyzer_status text,
  add column if not exists description text,
  add column if not exists source_page integer,
  add column if not exists source_document_id uuid;

alter table audit_events
  add column if not exists event_name text,
  add column if not exists outcome text,
  add column if not exists object_type text;

alter table report_sections
  add column if not exists section_payload jsonb;

create unique index if not exists idx_uploaded_policy_files_document
  on uploaded_policy_files (document_id) where document_id is not null;
create unique index if not exists idx_policy_analyses_analyzer_policy
  on policy_analyses (analyzer_policy_id) where analyzer_policy_id is not null;
create index if not exists idx_policy_analyses_retention
  on policy_analyses (retention_expires_at) where deleted_at is null;
create index if not exists idx_policy_analyses_deleted
  on policy_analyses (deletion_status, deleted_at);
create index if not exists idx_audit_events_name
  on audit_events (event_name, event_timestamp);
create index if not exists idx_extracted_text_pages_file
  on extracted_text_pages (file_id);

-- -----------------------------------------------------------------------------
-- Deletion receipts so owner delete is idempotent after rows are removed,
-- without making expired/deleted analyses visible through ordinary SELECT.
-- -----------------------------------------------------------------------------
create table if not exists deletion_receipts (
    analyzer_policy_id uuid primary key,
    account_id         uuid not null references accounts(account_id) on delete cascade,
    user_id            uuid not null,
    created_at         timestamptz not null default now()
);
create index if not exists idx_deletion_receipts_owner on deletion_receipts (account_id, user_id);
alter table deletion_receipts enable row level security;
drop policy if exists receipts_select_owner on deletion_receipts;
drop policy if exists receipts_insert_owner on deletion_receipts;
create policy receipts_select_owner on deletion_receipts
  for select using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy receipts_insert_owner on deletion_receipts
  for insert with check ( user_id = auth.uid() and app_is_account_member(account_id) );

-- -----------------------------------------------------------------------------
-- Form inventory (not present in Phase 1 schema)
-- -----------------------------------------------------------------------------
create table if not exists form_inventory_items (
    form_inventory_id    uuid primary key default gen_random_uuid(),
    policy_analysis_id   uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id           uuid not null references accounts(account_id) on delete cascade,
    user_id              uuid not null,
    printed_identifier   text not null,
    normalized_identifier text not null,
    edition              text,
    listing_page         integer,
    inventory_status     text not null
                           check (inventory_status in ('PRESENT','MISSING','EDITION MISMATCH')),
    match_page           integer,
    created_at           timestamptz not null default now()
);

create index if not exists idx_form_inventory_owner on form_inventory_items (account_id, user_id);
create index if not exists idx_form_inventory_analysis on form_inventory_items (policy_analysis_id);

alter table form_inventory_items enable row level security;

drop policy if exists forminv_select_owner on form_inventory_items;
drop policy if exists forminv_insert_owner on form_inventory_items;
drop policy if exists forminv_update_owner on form_inventory_items;
drop policy if exists forminv_delete_owner on form_inventory_items;
create policy forminv_select_owner on form_inventory_items
  for select using ( app_is_account_member(account_id) );
create policy forminv_insert_owner on form_inventory_items
  for insert with check ( account_id is not null and user_id = auth.uid()
                          and app_is_account_member(account_id) );
create policy forminv_update_owner on form_inventory_items
  for update using ( app_is_account_member(account_id) )
             with check ( app_is_account_member(account_id) );
create policy forminv_delete_owner on form_inventory_items
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );

-- -----------------------------------------------------------------------------
-- Account bootstrap (first sign-in) — missing from historical RLS
-- -----------------------------------------------------------------------------
drop policy if exists accounts_insert_self on accounts;
create policy accounts_insert_self on accounts
  for insert with check ( account_owner_user_id = auth.uid() );

drop policy if exists account_members_insert_self on account_members;
create policy account_members_insert_self on account_members
  for insert with check (
    user_id = auth.uid()
    and user_role = 'owner'
    and exists (
      select 1 from accounts a
      where a.account_id = account_members.account_id
        and a.account_owner_user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- Owner DELETE for user-requested deletion (user-scoped; not service-role bypass)
-- Historical Group H deferred this workflow. Audit remains append-only.
-- -----------------------------------------------------------------------------
drop policy if exists uploads_delete_owner on uploads;
drop policy if exists upfiles_delete_owner on uploaded_policy_files;
drop policy if exists analyses_delete_owner on policy_analyses;
drop policy if exists policies_delete_owner on policies;
drop policy if exists horses_delete_owner on horses;
drop policy if exists srcmap_delete_owner on source_mappings;
drop policy if exists extext_delete_owner on extracted_text_pages;
drop policy if exists clauses_delete_owner on clause_objects;
drop policy if exists coverages_delete_owner on coverage_objects;
drop policy if exists exclusions_delete_owner on exclusion_objects;
drop policy if exists conditions_delete_owner on condition_obligation_objects;
drop policy if exists clinks_delete_owner on clause_links;
drop policy if exists cclinks_delete_owner on coverage_clause_links;
drop policy if exists celinks_delete_owner on coverage_exclusion_links;
drop policy if exists cdlinks_delete_owner on coverage_condition_links;
drop policy if exists chlinks_delete_owner on coverage_horse_links;
drop policy if exists missing_delete_owner on missing_items;
drop policy if exists conflicts_delete_owner on conflict_records;
drop policy if exists cfclinks_delete_owner on conflict_clause_links;
drop policy if exists conf_delete_owner on confidence_results;
drop policy if exists verif_delete_owner on verification_results;
drop policy if exists answers_delete_owner on generated_answers;
drop policy if exists reports_delete_owner on report_sections;
create policy uploads_delete_owner on uploads
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy upfiles_delete_owner on uploaded_policy_files
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy analyses_delete_owner on policy_analyses
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy policies_delete_owner on policies
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy horses_delete_owner on horses
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy srcmap_delete_owner on source_mappings
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy extext_delete_owner on extracted_text_pages
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy clauses_delete_owner on clause_objects
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy coverages_delete_owner on coverage_objects
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy exclusions_delete_owner on exclusion_objects
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy conditions_delete_owner on condition_obligation_objects
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy clinks_delete_owner on clause_links
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy cclinks_delete_owner on coverage_clause_links
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy celinks_delete_owner on coverage_exclusion_links
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy cdlinks_delete_owner on coverage_condition_links
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy chlinks_delete_owner on coverage_horse_links
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy missing_delete_owner on missing_items
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy conflicts_delete_owner on conflict_records
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy cfclinks_delete_owner on conflict_clause_links
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy conf_delete_owner on confidence_results
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy verif_delete_owner on verification_results
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy answers_delete_owner on generated_answers
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );
create policy reports_delete_owner on report_sections
  for delete using ( app_is_account_member(account_id) and user_id = auth.uid() );

-- -----------------------------------------------------------------------------
-- Ownership immutability
-- -----------------------------------------------------------------------------
create or replace function reject_ownership_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.account_id is distinct from old.account_id or new.user_id is distinct from old.user_id then
    raise exception 'ownership columns are immutable';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'uploads','uploaded_policy_files','extracted_text_pages','source_mappings',
    'policy_analyses','policies','horses','clause_objects','coverage_objects',
    'exclusion_objects','condition_obligation_objects','clause_links',
    'coverage_clause_links','coverage_exclusion_links','coverage_condition_links',
    'coverage_horse_links','missing_items','conflict_records','conflict_clause_links',
    'confidence_results','verification_results','generated_answers','report_sections',
    'form_inventory_items','audit_events','review_queue_entries','deletion_receipts'
  ]
  loop
    execute format('drop trigger if exists trg_reject_ownership_mutation on %I', t);
    execute format(
      'create trigger trg_reject_ownership_mutation before update on %I for each row execute function reject_ownership_mutation()',
      t
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Transactional persist (SECURITY INVOKER). Ownership taken only from auth.uid().
-- Client-supplied account_id / user_id / policy_id are ignored.
-- -----------------------------------------------------------------------------
drop function if exists persist_analyzer_package(jsonb);

create function persist_analyzer_package(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  acc uuid;
  analysis_id uuid;
  upload_id uuid;
  policy_row_id uuid;
  analyzer_policy uuid;
  session_uuid uuid;
  report jsonb;
  file_row jsonb;
  page_row jsonb;
  cov_row jsonb;
  excl_row jsonb;
  req_row jsonb;
  conf_row jsonb;
  form_row jsonb;
  miss_row jsonb;
  q_row jsonb;
  file_uuid uuid;
  src_uuid uuid;
  clause_uuid uuid;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Never trust submitted ownership identifiers.
  select m.account_id into acc
  from account_members m
  where m.user_id = uid
    and m.user_role = 'owner'
  order by m.created_at asc
  limit 1;

  if acc is null then
    raise exception 'no_account';
  end if;

  report := payload->'report';
  if report is null or report = 'null'::jsonb then
    raise exception 'missing_report';
  end if;

  -- upload_id / file_id may be supplied only so storage paths written by the
  -- user-scoped server store match DB rows. Ownership is still auth.uid().
  upload_id := coalesce(nullif(payload->>'upload_id','')::uuid, gen_random_uuid());
  analysis_id := gen_random_uuid();
  policy_row_id := gen_random_uuid();
  analyzer_policy := coalesce(nullif(report->>'policy_id','')::uuid, gen_random_uuid());
  session_uuid := coalesce(nullif(report->>'session_id','')::uuid, gen_random_uuid());

  insert into uploads (upload_id, account_id, user_id, status, extraction_status)
  values (upload_id, acc, uid, 'processed', coalesce(payload->>'extraction_status', 'complete'));

  insert into policy_analyses (
    policy_analysis_id, upload_id, account_id, user_id,
    extraction_status, analyzer_policy_id, session_id,
    retention_expires_at, deletion_status, completeness_status, analysis_status
  ) values (
    analysis_id, upload_id, acc, uid,
    coalesce(payload->>'extraction_status', 'complete'),
    analyzer_policy,
    session_uuid,
    (payload->>'retention_expires_at')::timestamptz,
    'active',
    report->>'completeness_status',
    report->>'analysis_status'
  );

  insert into policies (
    policy_id, policy_analysis_id, account_id, user_id,
    carrier_name, policy_number, policy_period_effective, policy_period_expiration,
    named_insured, document_types_present
  ) values (
    policy_row_id, analysis_id, acc, uid,
    payload->'identification'->'carrier_name',
    payload->'identification'->'policy_number',
    payload->'identification'->'policy_effective_date',
    payload->'identification'->'policy_expiration_date',
    payload->'identification'->'named_insured',
    payload->'document_types_present'
  );

  if payload->'identification'->'insured_horse_name' is not null then
    insert into horses (
      policy_id, policy_analysis_id, account_id, user_id,
      name, breed, age, insured_value
    ) values (
      policy_row_id, analysis_id, acc, uid,
      payload->'identification'->'insured_horse_name',
      payload->'identification'->'breed',
      payload->'identification'->'age',
      payload->'identification'->'insured_value'
    );
  end if;

  for file_row in select value from jsonb_array_elements(coalesce(payload->'files', '[]'::jsonb))
  loop
    file_uuid := coalesce(nullif(file_row->>'file_id','')::uuid, gen_random_uuid());
    if split_part(coalesce(file_row->>'object_storage_key',''), '/', 1) is distinct from acc::text then
      raise exception 'object_path_ownership_mismatch';
    end if;
    if split_part(coalesce(file_row->>'object_storage_key',''), '/', 2) is distinct from upload_id::text then
      raise exception 'object_path_upload_mismatch';
    end if;
    insert into uploaded_policy_files (
      file_id, upload_id, account_id, user_id, file_name, file_type,
      object_storage_key, page_count, file_sha256, document_id, extraction_status
    ) values (
      file_uuid, upload_id, acc, uid,
      file_uuid::text || '.pdf',
      'pdf',
      file_row->>'object_storage_key',
      nullif(file_row->>'page_count','')::integer,
      file_row->>'file_sha256',
      nullif(file_row->>'document_id','')::uuid,
      file_row->>'extraction_status'
    );

    for page_row in select value from jsonb_array_elements(coalesce(file_row->'pages', '[]'::jsonb))
    loop
      insert into extracted_text_pages (
        policy_analysis_id, account_id, user_id, file_id,
        system_page_number, text_body, extraction_method, quality_status,
        ocr_attempted, ocr_succeeded, character_count, word_count,
        alphanumeric_ratio, diagnostic_warnings, extraction_confidence
      ) values (
        analysis_id, acc, uid, file_uuid,
        nullif(page_row->>'page','')::integer,
        page_row->>'text',
        page_row->>'extraction_method',
        page_row->>'quality_status',
        coalesce((page_row->>'ocr_attempted')::boolean, false),
        coalesce((page_row->>'ocr_succeeded')::boolean, false),
        nullif(page_row->>'character_count','')::integer,
        nullif(page_row->>'word_count','')::integer,
        nullif(page_row->>'alphanumeric_ratio','')::numeric,
        page_row->'diagnostic_warnings',
        page_row->>'confidence'
      );
    end loop;
  end loop;

  for cov_row in select value from jsonb_array_elements(coalesce(payload->'coverages', '[]'::jsonb))
  loop
    insert into coverage_objects (
      coverage_id, policy_id, policy_analysis_id, account_id, user_id,
      coverage_category, coverage_status, analyzer_status, description,
      source_page, source_document_id, confidence_label
    ) values (
      coalesce(nullif(cov_row->>'coverage_id','')::uuid, gen_random_uuid()),
      policy_row_id, analysis_id, acc, uid,
      cov_row->>'coverage_category',
      cov_row->>'coverage_status',
      cov_row->>'analyzer_status',
      cov_row->>'description',
      nullif(cov_row->>'source_page','')::integer,
      nullif(cov_row->>'source_document_id','')::uuid,
      cov_row->>'confidence_label'
    );
  end loop;

  for excl_row in select value from jsonb_array_elements(coalesce(payload->'exclusions', '[]'::jsonb))
  loop
    src_uuid := gen_random_uuid();
    insert into source_mappings (
      source_ref_id, policy_analysis_id, account_id, user_id, upload_id,
      system_page_number, text_snippet, document_type
    ) values (
      src_uuid, analysis_id, acc, uid, upload_id,
      nullif(excl_row->>'source_page','')::integer,
      left(coalesce(excl_row->>'excerpt',''), 500),
      'exclusion'
    );
    clause_uuid := gen_random_uuid();
    insert into clause_objects (
      clause_id, policy_analysis_id, account_id, user_id, source_ref_id,
      clause_type, coverage_category, raw_text, plain_english_summary
    ) values (
      clause_uuid, analysis_id, acc, uid, src_uuid,
      'exclusion',
      excl_row->>'exclusion_type',
      left(coalesce(excl_row->>'excerpt',''), 2000),
      excl_row->>'description'
    );
    insert into exclusion_objects (
      clause_id, policy_analysis_id, account_id, user_id,
      exclusion_category, scope_note
    ) values (
      clause_uuid, analysis_id, acc, uid,
      excl_row->>'exclusion_type',
      excl_row->>'description'
    );
  end loop;

  for req_row in select value from jsonb_array_elements(coalesce(payload->'requirements', '[]'::jsonb))
  loop
    src_uuid := gen_random_uuid();
    insert into source_mappings (
      source_ref_id, policy_analysis_id, account_id, user_id, upload_id,
      system_page_number, document_type
    ) values (
      src_uuid, analysis_id, acc, uid, upload_id,
      nullif(req_row->>'source_page','')::integer,
      'condition'
    );
    clause_uuid := gen_random_uuid();
    insert into clause_objects (
      clause_id, policy_analysis_id, account_id, user_id, source_ref_id,
      clause_type, raw_text, plain_english_summary
    ) values (
      clause_uuid, analysis_id, acc, uid, src_uuid,
      'condition',
      req_row->>'requirement',
      req_row->>'requirement'
    );
    insert into condition_obligation_objects (
      clause_id, policy_analysis_id, account_id, user_id,
      condition_type, obligation_text, is_mandatory
    ) values (
      clause_uuid, analysis_id, acc, uid,
      req_row->>'trigger',
      req_row->>'requirement',
      true
    );
  end loop;

  for conf_row in select value from jsonb_array_elements(coalesce(payload->'conflicts', '[]'::jsonb))
  loop
    insert into conflict_records (
      policy_analysis_id, account_id, user_id, conflict_type, description, resolved
    ) values (
      analysis_id, acc, uid,
      coalesce(conf_row->>'title', 'conflict'),
      conf_row->>'description',
      false
    );
  end loop;

  for form_row in select value from jsonb_array_elements(coalesce(payload->'forms', '[]'::jsonb))
  loop
    insert into form_inventory_items (
      policy_analysis_id, account_id, user_id,
      printed_identifier, normalized_identifier, edition,
      listing_page, inventory_status, match_page
    ) values (
      analysis_id, acc, uid,
      form_row->>'printed_identifier',
      form_row->>'normalized_identifier',
      form_row->>'edition',
      nullif(form_row->>'listing_page','')::integer,
      form_row->>'inventory_status',
      nullif(form_row->>'match_page','')::integer
    );
  end loop;

  for miss_row in select value from jsonb_array_elements(coalesce(payload->'missing', '[]'::jsonb))
  loop
    insert into missing_items (
      policy_analysis_id, account_id, user_id, missing_type, description
    ) values (
      analysis_id, acc, uid,
      coalesce(miss_row->>'missing_type', 'referenced_form_not_uploaded'),
      miss_row->>'description'
    );
  end loop;

  for q_row in select value from jsonb_array_elements(coalesce(payload->'agent_questions', '[]'::jsonb))
  loop
    insert into generated_answers (
      policy_analysis_id, account_id, user_id,
      user_question, answer_type, direct_answer
    ) values (
      analysis_id, acc, uid,
      q_row->>'question',
      'agent_question',
      q_row->>'question'
    );
  end loop;

  insert into report_sections (
    policy_analysis_id, account_id, user_id, section_key, section_confidence, section_payload
  ) values (
    analysis_id, acc, uid, 'analyzer_report_v1', 'HIGH', report
  );

  return jsonb_build_object(
    'policy_analysis_id', analysis_id,
    'upload_id', upload_id,
    'schema_policy_id', policy_row_id,
    'analyzer_policy_id', analyzer_policy,
    'session_id', session_uuid
  );
end;
$$;

revoke all on function persist_analyzer_package(jsonb) from public;
revoke all on function persist_analyzer_package(jsonb) from anon;
grant execute on function persist_analyzer_package(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Expired rows hidden from ordinary select via additional policy constraint:
-- owners can only select active, unexpired analyses. Implemented in app +
-- helper used by policies on policy_analyses.
-- -----------------------------------------------------------------------------
create or replace function app_analysis_visible(target_analysis uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from policy_analyses p
    where p.policy_analysis_id = target_analysis
      and app_is_account_member(p.account_id)
      and p.user_id = auth.uid()
      and p.deletion_status = 'active'
      and p.deleted_at is null
      and (p.retention_expires_at is null or p.retention_expires_at > now())
  );
$$;

revoke all on function app_analysis_visible(uuid) from public;
revoke all on function app_analysis_visible(uuid) from anon;
grant execute on function app_analysis_visible(uuid) to authenticated;

drop policy if exists analyses_select_owner on policy_analyses;
create policy analyses_select_owner on policy_analyses
  for select using (
    app_is_account_member(account_id)
    and user_id = auth.uid()
    and deletion_status = 'active'
    and deleted_at is null
    and (retention_expires_at is null or retention_expires_at > now())
  );

-- -----------------------------------------------------------------------------
-- Private storage bucket + path-scoped RLS
-- Path shape: {account_id}/{upload_id}/{file_id}.pdf
-- -----------------------------------------------------------------------------
do $storage$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; skipping policy-files bucket';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('policy-files', 'policy-files', false, 20971520, array['application/pdf']::text[])
  on conflict (id) do update set public = excluded.public;

  execute 'drop policy if exists policy_files_select_own on storage.objects';
  execute 'drop policy if exists policy_files_insert_own on storage.objects';
  execute 'drop policy if exists policy_files_update_own on storage.objects';
  execute 'drop policy if exists policy_files_delete_own on storage.objects';

  execute $p$
    create policy policy_files_select_own on storage.objects
      for select using (
        bucket_id = 'policy-files'
        and auth.uid() is not null
        and app_is_account_member((split_part(name, '/', 1))::uuid)
      )
  $p$;
  execute $p$
    create policy policy_files_insert_own on storage.objects
      for insert with check (
        bucket_id = 'policy-files'
        and auth.uid() is not null
        and app_is_account_member((split_part(name, '/', 1))::uuid)
      )
  $p$;
  execute $p$
    create policy policy_files_update_own on storage.objects
      for update using (
        bucket_id = 'policy-files'
        and app_is_account_member((split_part(name, '/', 1))::uuid)
      ) with check (
        bucket_id = 'policy-files'
        and app_is_account_member((split_part(name, '/', 1))::uuid)
      )
  $p$;
  execute $p$
    create policy policy_files_delete_own on storage.objects
      for delete using (
        bucket_id = 'policy-files'
        and app_is_account_member((split_part(name, '/', 1))::uuid)
      )
  $p$;
end
$storage$;
