-- =============================================================================
-- HorseInsurance.ai — Durable analysis jobs, reservations, protected limits
-- =============================================================================
-- Additive to the Phase 1 schema + RLS + analyzer auth persistence migrations.
-- Does NOT rewrite earlier migrations.
-- Local-only until explicitly applied.
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- 1. PROTECTED CONFIGURATION
-- =============================================================================

create table analyzer_runtime_config (
    config_key   text primary key,
    config_value text not null,
    updated_at   timestamptz not null default now()
);

insert into analyzer_runtime_config (config_key, config_value) values
  ('uploads_per_account_per_hour', '20'),
  ('active_jobs_per_account',      '5'),
  ('max_files_per_package',        '10'),
  ('max_job_attempts',             '3'),
  ('reservation_expiry_minutes',   '30'),
  ('retention_days',               '30'),
  ('claim_batch_max',              '20')
on conflict (config_key) do nothing;

alter table analyzer_runtime_config enable row level security;

revoke all on analyzer_runtime_config from public;
revoke all on analyzer_runtime_config from anon;
revoke all on analyzer_runtime_config from authenticated;

create or replace function app_config(p_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select config_value from analyzer_runtime_config where config_key = p_key;
$$;

revoke all on function app_config(text) from public;
revoke all on function app_config(text) from anon;
revoke all on function app_config(text) from authenticated;

-- =============================================================================
-- 2. ACCOUNT USAGE COUNTERS
-- =============================================================================

create table account_usage_windows (
    account_id    uuid not null references accounts(account_id) on delete cascade,
    window_start  timestamptz not null,
    upload_count  integer not null default 0 check (upload_count >= 0),
    primary key (account_id, window_start)
);

alter table account_usage_windows enable row level security;

revoke all on account_usage_windows from public;
revoke all on account_usage_windows from anon;
revoke all on account_usage_windows from authenticated;

-- =============================================================================
-- 3. ANALYSIS JOBS
-- =============================================================================

create table analysis_jobs (
    job_id              uuid primary key default gen_random_uuid(),
    policy_id           uuid not null,
    analysis_id         uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id          uuid not null references accounts(account_id) on delete cascade,
    owner_user_id       uuid not null,
    status              text not null default 'queued'
                          check (status in ('queued','processing','completed','failed','needs_review','cancelled')),
    attempt_count       integer not null default 0 check (attempt_count >= 0),
    max_attempts        integer not null default 3 check (max_attempts between 1 and 20),
    created_at          timestamptz not null default now(),
    available_at        timestamptz not null default now(),
    started_at          timestamptz,
    completed_at        timestamptz,
    lease_owner         text,
    lease_expires_at    timestamptz,
    last_heartbeat      timestamptz,
    error_code          text,
    failure_stage       text,
    cancelled_at        timestamptz,
    recovery            jsonb not null default '{}'::jsonb,
    stage               text not null default 'queued',
    document_count      integer not null default 0 check (document_count >= 0),
    documents_processed integer not null default 0 check (documents_processed >= 0),
    page_count          integer check (page_count is null or page_count >= 0),
    pages_processed     integer not null default 0 check (pages_processed >= 0),
    retryable           boolean not null default false,
    updated_at          timestamptz not null default now(),
    unique (analysis_id),
    unique (policy_id),
    check (
      (status = 'processing' and lease_owner is not null and lease_expires_at is not null)
      or (status <> 'processing' and lease_owner is null)
    )
);

create index idx_analysis_jobs_claimable
  on analysis_jobs (status, available_at)
  where status in ('queued','processing');

create index idx_analysis_jobs_account
  on analysis_jobs (account_id, status);

alter table analysis_jobs enable row level security;

revoke all on analysis_jobs from public;
revoke all on analysis_jobs from anon;
revoke insert, update, delete on analysis_jobs from authenticated;
grant select on analysis_jobs to authenticated;

create policy jobs_select_own on analysis_jobs
  for select using (
    owner_user_id = auth.uid()
    and app_is_account_member(account_id)
  );

create unique index if not exists idx_report_sections_analysis_key
  on report_sections (policy_analysis_id, section_key);

-- =============================================================================
-- 4. UPLOAD RESERVATIONS + FILE TUPLES
-- =============================================================================

create table upload_reservations (
    reservation_id  uuid primary key default gen_random_uuid(),
    account_id      uuid not null references accounts(account_id) on delete cascade,
    owner_user_id   uuid not null,
    upload_id       uuid not null unique,
    analysis_id     uuid not null unique,
    policy_id       uuid not null unique,
    session_id      uuid not null,
    job_id          uuid not null unique,
    file_count      integer not null check (file_count between 1 and 10),
    status          text not null default 'pending'
                      check (status in ('pending','finalized','abandoned','expired')),
    expires_at      timestamptz not null,
    created_at      timestamptz not null default now(),
    finalized_at    timestamptz
);

create table upload_reservation_files (
    reservation_file_id uuid primary key default gen_random_uuid(),
    reservation_id      uuid not null references upload_reservations(reservation_id) on delete cascade,
    ordinal             integer not null check (ordinal >= 1),
    file_id             uuid not null,
    document_id         uuid not null,
    storage_path        text not null,
    unique (reservation_id, ordinal),
    unique (file_id),
    unique (document_id),
    unique (storage_path)
);

create index idx_reservations_owner on upload_reservations (account_id, owner_user_id);
create index idx_reservations_status on upload_reservations (status, expires_at);
create index idx_reservation_files_reservation on upload_reservation_files (reservation_id);

alter table upload_reservations enable row level security;
alter table upload_reservation_files enable row level security;

revoke all on upload_reservations from public;
revoke all on upload_reservations from anon;
revoke all on upload_reservations from authenticated;
revoke all on upload_reservation_files from public;
revoke all on upload_reservation_files from anon;
revoke all on upload_reservation_files from authenticated;

-- =============================================================================
-- 5. RESERVE PACKAGE
-- =============================================================================

create or replace function reserve_analyzer_package(p_file_count integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_acc uuid;
  v_max_files integer;
  v_rate_limit integer;
  v_active_limit integer;
  v_expiry_minutes integer;
  v_window_start timestamptz;
  v_current_count integer;
  v_active_count integer;
  v_reservation_id uuid;
  v_upload_id uuid;
  v_analysis_id uuid;
  v_policy_id uuid;
  v_session_id uuid;
  v_job_id uuid;
  v_file_id uuid;
  v_document_id uuid;
  v_path text;
  v_expires_at timestamptz;
  v_files jsonb := '[]'::jsonb;
  i integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select m.account_id into v_acc
  from account_members m
  where m.user_id = v_uid and m.user_role = 'owner'
  order by m.created_at asc limit 1;

  if v_acc is null then
    raise exception 'no_account';
  end if;

  v_max_files := coalesce(app_config('max_files_per_package')::integer, 10);
  v_rate_limit := coalesce(app_config('uploads_per_account_per_hour')::integer, 20);
  v_active_limit := coalesce(app_config('active_jobs_per_account')::integer, 5);
  v_expiry_minutes := coalesce(app_config('reservation_expiry_minutes')::integer, 30);

  if p_file_count < 1 or p_file_count > v_max_files then
    raise exception 'invalid_file_count';
  end if;

  perform 1 from accounts where account_id = v_acc for update;

  update upload_reservations
  set status = 'expired'
  where account_id = v_acc
    and status = 'pending'
    and expires_at < now();

  v_window_start := date_trunc('hour', now());
  insert into account_usage_windows (account_id, window_start, upload_count)
  values (v_acc, v_window_start, 0)
  on conflict (account_id, window_start) do nothing;

  select upload_count into v_current_count
  from account_usage_windows
  where account_id = v_acc and window_start = v_window_start
  for update;

  if v_current_count >= v_rate_limit then
    raise exception 'rate_limited';
  end if;

  select
    (select count(*) from analysis_jobs
      where account_id = v_acc and status in ('queued', 'processing'))
    +
    (select count(*) from upload_reservations
      where account_id = v_acc and status = 'pending' and expires_at > now())
  into v_active_count;

  if v_active_count >= v_active_limit then
    raise exception 'backlog_limited';
  end if;

  v_reservation_id := gen_random_uuid();
  v_upload_id := gen_random_uuid();
  v_analysis_id := gen_random_uuid();
  v_policy_id := gen_random_uuid();
  v_session_id := gen_random_uuid();
  v_job_id := gen_random_uuid();
  v_expires_at := now() + (v_expiry_minutes || ' minutes')::interval;

  update account_usage_windows
  set upload_count = upload_count + 1
  where account_id = v_acc and window_start = v_window_start;

  insert into upload_reservations (
    reservation_id, account_id, owner_user_id, upload_id, analysis_id,
    policy_id, session_id, job_id, file_count, status, expires_at
  ) values (
    v_reservation_id, v_acc, v_uid, v_upload_id, v_analysis_id,
    v_policy_id, v_session_id, v_job_id, p_file_count, 'pending', v_expires_at
  );

  for i in 1..p_file_count loop
    v_file_id := gen_random_uuid();
    v_document_id := gen_random_uuid();
    v_path := v_acc::text || '/' || v_upload_id::text || '/' || v_file_id::text || '.pdf';
    insert into upload_reservation_files (
      reservation_id, ordinal, file_id, document_id, storage_path
    ) values (
      v_reservation_id, i, v_file_id, v_document_id, v_path
    );
    v_files := v_files || jsonb_build_object(
      'ordinal', i,
      'file_id', v_file_id,
      'document_id', v_document_id,
      'storage_path', v_path
    );
  end loop;

  return jsonb_build_object(
    'reservation_id', v_reservation_id,
    'upload_id', v_upload_id,
    'analysis_id', v_analysis_id,
    'policy_id', v_policy_id,
    'session_id', v_session_id,
    'job_id', v_job_id,
    'file_count', p_file_count,
    'files', v_files,
    'expires_at', v_expires_at
  );
end;
$$;

revoke all on function reserve_analyzer_package(integer) from public;
revoke all on function reserve_analyzer_package(integer) from anon;
grant execute on function reserve_analyzer_package(integer) to authenticated;

-- =============================================================================
-- 6. FINALIZE PACKAGE
-- =============================================================================

create or replace function finalize_analyzer_package(
  p_reservation_id uuid,
  p_files jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_res record;
  v_max_attempts integer;
  v_retention_days integer;
  v_file jsonb;
  v_file_id uuid;
  v_doc_id uuid;
  v_path text;
  v_sha text;
  v_ordinal integer;
  v_matched integer;
  v_filename text;
  i integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_res
  from upload_reservations
  where reservation_id = p_reservation_id
  for update;

  if v_res is null then
    raise exception 'reservation_not_found';
  end if;

  if v_res.owner_user_id <> v_uid then
    raise exception 'reservation_owner_mismatch';
  end if;

  if v_res.status <> 'pending' then
    raise exception 'reservation_already_used';
  end if;

  if v_res.expires_at < now() then
    update upload_reservations set status = 'expired' where reservation_id = p_reservation_id;
    raise exception 'reservation_expired';
  end if;

  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception 'file_count_mismatch';
  end if;

  if jsonb_array_length(p_files) <> v_res.file_count then
    raise exception 'file_count_mismatch';
  end if;

  if to_regclass('storage.objects') is null then
    raise exception 'storage_unavailable';
  end if;

  if not exists (select 1 from storage.buckets where id = 'policy-files') then
    raise exception 'storage_unavailable';
  end if;

  v_max_attempts := coalesce(app_config('max_job_attempts')::integer, 3);
  v_retention_days := coalesce(app_config('retention_days')::integer, 30);

  if (
    select count(*) from (
      select value->>'file_id' as fid from jsonb_array_elements(p_files)
    ) s
  ) <> (
    select count(distinct value->>'file_id') from jsonb_array_elements(p_files)
  ) then
    raise exception 'duplicate_file_ids';
  end if;

  if (
    select count(*) from (select value->>'document_id' as did from jsonb_array_elements(p_files)) s
  ) <> (
    select count(distinct value->>'document_id') from jsonb_array_elements(p_files)
  ) then
    raise exception 'duplicate_document_ids';
  end if;

  if (
    select count(*) from (select value->>'storage_path' as p from jsonb_array_elements(p_files)) s
  ) <> (
    select count(distinct value->>'storage_path') from jsonb_array_elements(p_files)
  ) then
    raise exception 'duplicate_storage_paths';
  end if;

  for i in 0..jsonb_array_length(p_files) - 1 loop
    v_file := p_files->i;
    v_file_id := nullif(v_file->>'file_id','')::uuid;
    v_doc_id := nullif(v_file->>'document_id','')::uuid;
    v_path := v_file->>'storage_path';
    v_sha := v_file->>'sha256';

    if v_file_id is null or v_doc_id is null or v_path is null or v_sha is null then
      raise exception 'file_field_missing';
    end if;

    if length(v_sha) <> 64 or v_sha !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid_sha256';
    end if;

    if split_part(v_path, '/', 1) <> v_res.account_id::text then
      raise exception 'storage_path_foreign_account';
    end if;

    select ordinal into v_ordinal
    from upload_reservation_files
    where reservation_id = p_reservation_id
      and file_id = v_file_id
      and document_id = v_doc_id
      and storage_path = v_path;

    if v_ordinal is null then
      raise exception 'reserved_tuple_mismatch';
    end if;

    if not exists (
      select 1 from storage.objects
      where bucket_id = 'policy-files' and name = v_path
    ) then
      raise exception 'storage_object_missing';
    end if;
  end loop;

  select count(*) into v_matched
  from upload_reservation_files rf
  where rf.reservation_id = p_reservation_id
    and exists (
      select 1 from jsonb_array_elements(p_files) f
      where (f->>'file_id')::uuid = rf.file_id
        and (f->>'document_id')::uuid = rf.document_id
        and f->>'storage_path' = rf.storage_path
    );

  if v_matched <> v_res.file_count then
    raise exception 'reserved_file_missing';
  end if;

  insert into uploads (upload_id, account_id, user_id, status)
  values (v_res.upload_id, v_res.account_id, v_uid, 'received');

  insert into policy_analyses (
    policy_analysis_id, upload_id, account_id, user_id,
    analyzer_policy_id, session_id,
    retention_expires_at, deletion_status
  ) values (
    v_res.analysis_id, v_res.upload_id, v_res.account_id, v_uid,
    v_res.policy_id, v_res.session_id,
    now() + (v_retention_days || ' days')::interval,
    'active'
  );

  for i in 0..jsonb_array_length(p_files) - 1 loop
    v_file := p_files->i;
    v_filename := coalesce(v_file->>'original_filename', (v_file->>'file_id') || '.pdf');
    v_filename := regexp_replace(v_filename, E'[\\n\\r\\t\\x00-\\x1f]+', '_', 'g');
    v_filename := regexp_replace(v_filename, '[/\\\\]+', '_', 'g');
    v_filename := left(v_filename, 120);
    insert into uploaded_policy_files (
      file_id, upload_id, account_id, user_id,
      file_name, file_type, object_storage_key,
      page_count, file_sha256, document_id, extraction_status
    ) values (
      (v_file->>'file_id')::uuid,
      v_res.upload_id,
      v_res.account_id,
      v_uid,
      v_filename,
      'pdf',
      v_file->>'storage_path',
      nullif(v_file->>'page_count', '')::integer,
      v_file->>'sha256',
      (v_file->>'document_id')::uuid,
      'pending'
    );
  end loop;

  insert into analysis_jobs (
    job_id, policy_id, analysis_id, account_id, owner_user_id,
    status, attempt_count, max_attempts,
    document_count, stage
  ) values (
    v_res.job_id, v_res.policy_id, v_res.analysis_id, v_res.account_id, v_uid,
    'queued', 0, v_max_attempts,
    v_res.file_count, 'queued'
  );

  update upload_reservations
  set status = 'finalized', finalized_at = now()
  where reservation_id = p_reservation_id;

  return jsonb_build_object(
    'policy_id', v_res.policy_id,
    'analysis_id', v_res.analysis_id,
    'upload_id', v_res.upload_id,
    'session_id', v_res.session_id,
    'job_id', v_res.job_id,
    'document_count', v_res.file_count
  );
end;
$$;

revoke all on function finalize_analyzer_package(uuid, jsonb) from public;
revoke all on function finalize_analyzer_package(uuid, jsonb) from anon;
grant execute on function finalize_analyzer_package(uuid, jsonb) to authenticated;

-- =============================================================================
-- 7. ABANDON RESERVATION
-- =============================================================================

create or replace function abandon_analyzer_reservation(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_res record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_res
  from upload_reservations
  where reservation_id = p_reservation_id
  for update;

  if v_res is null then
    return false;
  end if;

  if v_res.owner_user_id <> v_uid then
    return false;
  end if;

  if v_res.status <> 'pending' then
    return false;
  end if;

  update upload_reservations
  set status = 'abandoned'
  where reservation_id = p_reservation_id;

  return true;
end;
$$;

revoke all on function abandon_analyzer_reservation(uuid) from public;
revoke all on function abandon_analyzer_reservation(uuid) from anon;
grant execute on function abandon_analyzer_reservation(uuid) to authenticated;

-- =============================================================================
-- 8. REPORT BINDING + SAFE JOB STATUS
-- =============================================================================

create or replace function analyzer_report_binding_error(p_job_id uuid, p_report jsonb)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_job record;
  v_analysis record;
  v_report_ids uuid[];
  v_file_ids uuid[];
  v_dup integer;
begin
  if p_report is null or jsonb_typeof(p_report) <> 'object' then
    return 'report_unavailable';
  end if;

  select * into v_job from analysis_jobs where job_id = p_job_id;
  if v_job is null then
    return 'report_unavailable';
  end if;

  select * into v_analysis
  from policy_analyses
  where policy_analysis_id = v_job.analysis_id;
  if v_analysis is null then
    return 'report_unavailable';
  end if;

  if coalesce(p_report->>'policy_id', '') is distinct from v_job.policy_id::text then
    return 'report_policy_mismatch';
  end if;

  if coalesce(p_report->>'session_id', '') is distinct from v_analysis.session_id::text then
    return 'report_session_mismatch';
  end if;

  if jsonb_typeof(p_report->'documents') is distinct from 'array' then
    return 'report_documents_invalid';
  end if;

  select count(*) - count(distinct d->>'document_id') into v_dup
  from jsonb_array_elements(p_report->'documents') d;
  if v_dup > 0 then
    return 'report_duplicate_document_ids';
  end if;

  begin
    select coalesce(array_agg((d->>'document_id')::uuid order by 1), '{}'::uuid[])
      into v_report_ids
    from jsonb_array_elements(p_report->'documents') d;
  exception when invalid_text_representation then
    return 'report_foreign_document';
  end;

  select coalesce(array_agg(document_id order by document_id), '{}'::uuid[])
    into v_file_ids
  from uploaded_policy_files
  where upload_id = v_analysis.upload_id;

  if exists (
    select unnest(v_report_ids)
    except
    select unnest(v_file_ids)
  ) then
    return 'report_foreign_document';
  end if;

  if exists (
    select unnest(v_file_ids)
    except
    select unnest(v_report_ids)
  ) then
    return 'report_missing_document';
  end if;

  if coalesce(jsonb_array_length(p_report->'documents'), -1) is distinct from v_job.document_count
     or coalesce(array_length(v_file_ids, 1), 0) is distinct from v_job.document_count then
    return 'report_document_count_mismatch';
  end if;

  return null;
end;
$$;

revoke all on function analyzer_report_binding_error(uuid, jsonb) from public;
revoke all on function analyzer_report_binding_error(uuid, jsonb) from anon;
revoke all on function analyzer_report_binding_error(uuid, jsonb) from authenticated;

create or replace function get_own_job_status(p_policy_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_job record;
  v_analysis record;
  v_payload jsonb;
  v_bind text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_analysis
  from policy_analyses
  where analyzer_policy_id = p_policy_id
    and user_id = v_uid
    and app_is_account_member(account_id)
    and deletion_status = 'active'
    and deleted_at is null
    and (retention_expires_at is null or retention_expires_at > now());

  if v_analysis is null then
    return null;
  end if;

  select * into v_job
  from analysis_jobs
  where policy_id = p_policy_id
    and analysis_id = v_analysis.policy_analysis_id
    and owner_user_id = v_uid
    and app_is_account_member(account_id);

  if v_job is null then
    return jsonb_build_object(
      'analysis_id', v_analysis.policy_analysis_id,
      'status', 'failed',
      'stage', 'failed',
      'document_count', 0,
      'documents_processed', 0,
      'page_count', null,
      'pages_processed', 0,
      'error_code', 'report_unavailable',
      'retryable', false,
      'updated_at', now()
    );
  end if;

  if v_job.status in ('completed', 'needs_review') then
    select section_payload into v_payload
    from report_sections
    where policy_analysis_id = v_job.analysis_id
      and section_key = 'analyzer_report_v1';
    v_bind := analyzer_report_binding_error(v_job.job_id, v_payload);
    if v_bind is not null then
      return jsonb_build_object(
        'analysis_id', v_job.analysis_id,
        'status', 'failed',
        'stage', 'failed',
        'document_count', v_job.document_count,
        'documents_processed', 0,
        'page_count', null,
        'pages_processed', 0,
        'error_code', 'report_unavailable',
        'retryable', false,
        'updated_at', now()
      );
    end if;
  end if;

  return jsonb_build_object(
    'analysis_id', v_job.analysis_id,
    'status', v_job.status,
    'stage', v_job.stage,
    'document_count', v_job.document_count,
    'documents_processed', v_job.documents_processed,
    'page_count', v_job.page_count,
    'pages_processed', v_job.pages_processed,
    'error_code', v_job.error_code,
    'retryable', v_job.retryable,
    'updated_at', v_job.updated_at
  );
end;
$$;

revoke all on function get_own_job_status(uuid) from public;
revoke all on function get_own_job_status(uuid) from anon;
grant execute on function get_own_job_status(uuid) to authenticated;

-- =============================================================================
-- 9. CANCEL OWN JOB
-- =============================================================================

create or replace function cancel_own_analysis_job(p_policy_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_job record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_job
  from analysis_jobs
  where policy_id = p_policy_id
    and owner_user_id = v_uid
    and app_is_account_member(account_id)
    and status in ('queued', 'processing')
  for update;

  if v_job is null then
    return false;
  end if;

  update analysis_jobs
  set status = 'cancelled',
      cancelled_at = now(),
      error_code = 'cancelled',
      retryable = false,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where job_id = v_job.job_id;

  return true;
end;
$$;

revoke all on function cancel_own_analysis_job(uuid) from public;
revoke all on function cancel_own_analysis_job(uuid) from anon;
grant execute on function cancel_own_analysis_job(uuid) to authenticated;

-- =============================================================================
-- 10. WORKER FUNCTIONS — EXECUTE granted only to service_role
-- auth.uid() IS NULL is defense in depth, not the authorization boundary.
-- =============================================================================

create or replace function claim_analysis_jobs(p_worker_id text, p_limit integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease_ms integer := 120000;
  v_now timestamptz := now();
  v_claimed jsonb := '[]'::jsonb;
  v_job record;
  v_files jsonb;
  v_batch integer;
  v_max integer;
begin
  if auth.uid() is not null then
    raise exception 'service_role_required';
  end if;

  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'invalid_worker_id';
  end if;

  v_max := coalesce(app_config('claim_batch_max')::integer, 20);
  if p_limit is null or p_limit < 1 or p_limit > v_max then
    raise exception 'invalid_claim_limit';
  end if;
  v_batch := p_limit;

  update analysis_jobs
  set status = 'failed',
      error_code = 'attempts_exhausted',
      failure_stage = 'lease',
      retryable = false,
      lease_owner = null,
      lease_expires_at = null,
      completed_at = v_now,
      stage = 'failed',
      updated_at = v_now
  where status = 'processing'
    and cancelled_at is null
    and lease_expires_at is not null
    and lease_expires_at <= v_now
    and attempt_count >= max_attempts;

  for v_job in
    select j.*
    from analysis_jobs j
    where j.status in ('queued', 'processing')
      and j.cancelled_at is null
      and (
        (j.status = 'queued' and j.available_at <= v_now)
        or (j.status = 'processing' and j.lease_expires_at is not null and j.lease_expires_at <= v_now
            and j.attempt_count < j.max_attempts)
      )
    order by j.available_at asc
    limit v_batch
    for update skip locked
  loop
    update analysis_jobs
    set status = 'processing',
        lease_owner = p_worker_id,
        lease_expires_at = v_now + (v_lease_ms || ' milliseconds')::interval,
        last_heartbeat = v_now,
        started_at = coalesce(started_at, v_now),
        attempt_count = attempt_count + 1,
        stage = 'processing',
        updated_at = v_now
    where job_id = v_job.job_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'file_id', f.file_id,
      'document_id', f.document_id,
      'storage_path', f.object_storage_key,
      'sha256', f.file_sha256,
      'original_filename', f.file_name
    ) order by f.created_at), '[]'::jsonb)
    into v_files
    from uploaded_policy_files f
    where f.upload_id = (
      select pa.upload_id from policy_analyses pa where pa.policy_analysis_id = v_job.analysis_id
    );

    v_claimed := v_claimed || jsonb_build_object(
      'job_id', v_job.job_id,
      'policy_id', v_job.policy_id,
      'analysis_id', v_job.analysis_id,
      'account_id', v_job.account_id,
      'owner_user_id', v_job.owner_user_id,
      'attempt_count', v_job.attempt_count + 1,
      'files', v_files,
      'session_id', (select pa.session_id from policy_analyses pa where pa.policy_analysis_id = v_job.analysis_id)
    );
  end loop;

  return v_claimed;
end;
$$;

revoke all on function claim_analysis_jobs(text, integer) from public;
revoke all on function claim_analysis_jobs(text, integer) from anon;
revoke all on function claim_analysis_jobs(text, integer) from authenticated;
grant execute on function claim_analysis_jobs(text, integer) to service_role;

create or replace function heartbeat_analysis_job(p_job_id uuid, p_worker_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'service_role_required';
  end if;

  update analysis_jobs
  set last_heartbeat = now(),
      lease_expires_at = now() + interval '120 seconds',
      updated_at = now()
  where job_id = p_job_id
    and status = 'processing'
    and lease_owner = p_worker_id
    and lease_expires_at is not null
    and lease_expires_at > now();

  return found;
end;
$$;

revoke all on function heartbeat_analysis_job(uuid, text) from public;
revoke all on function heartbeat_analysis_job(uuid, text) from anon;
revoke all on function heartbeat_analysis_job(uuid, text) from authenticated;
grant execute on function heartbeat_analysis_job(uuid, text) to service_role;

create or replace function update_job_progress(
  p_job_id uuid,
  p_worker_id text,
  p_stage text,
  p_documents_processed integer default null,
  p_page_count integer default null,
  p_pages_processed integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'service_role_required';
  end if;

  update analysis_jobs
  set stage = coalesce(p_stage, stage),
      documents_processed = coalesce(p_documents_processed, documents_processed),
      page_count = coalesce(p_page_count, page_count),
      pages_processed = coalesce(p_pages_processed, pages_processed),
      last_heartbeat = now(),
      lease_expires_at = now() + interval '120 seconds',
      updated_at = now()
  where job_id = p_job_id
    and status = 'processing'
    and lease_owner = p_worker_id
    and lease_expires_at is not null
    and lease_expires_at > now();

  return found;
end;
$$;

revoke all on function update_job_progress(uuid, text, text, integer, integer, integer) from public;
revoke all on function update_job_progress(uuid, text, text, integer, integer, integer) from anon;
revoke all on function update_job_progress(uuid, text, text, integer, integer, integer) from authenticated;
grant execute on function update_job_progress(uuid, text, text, integer, integer, integer) to service_role;

create or replace function fail_analysis_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_stage text,
  p_retryable boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  if auth.uid() is not null then
    raise exception 'service_role_required';
  end if;

  select * into v_job
  from analysis_jobs
  where job_id = p_job_id
  for update;

  if v_job is null then
    return false;
  end if;

  if v_job.status <> 'processing'
     or v_job.lease_owner is distinct from p_worker_id
     or v_job.lease_expires_at is null
     or v_job.lease_expires_at <= now() then
    return false;
  end if;

  if p_retryable and v_job.attempt_count < v_job.max_attempts then
    update analysis_jobs
    set status = 'queued',
        error_code = p_error_code,
        failure_stage = p_stage,
        retryable = true,
        lease_owner = null,
        lease_expires_at = null,
        available_at = now() + (power(2, v_job.attempt_count) || ' seconds')::interval,
        stage = 'queued',
        updated_at = now()
    where job_id = p_job_id;
  else
    update analysis_jobs
    set status = 'failed',
        error_code = p_error_code,
        failure_stage = p_stage,
        retryable = false,
        lease_owner = null,
        lease_expires_at = null,
        completed_at = now(),
        stage = 'failed',
        updated_at = now()
    where job_id = p_job_id;
  end if;

  return true;
end;
$$;

revoke all on function fail_analysis_job(uuid, text, text, text, boolean) from public;
revoke all on function fail_analysis_job(uuid, text, text, text, boolean) from anon;
revoke all on function fail_analysis_job(uuid, text, text, text, boolean) from authenticated;
grant execute on function fail_analysis_job(uuid, text, text, text, boolean) to service_role;

create or replace function complete_analysis_job(
  p_job_id uuid,
  p_worker_id text,
  p_report jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_stored jsonb;
  v_bind text;
begin
  if auth.uid() is not null then
    raise exception 'service_role_required';
  end if;

  select * into v_job
  from analysis_jobs
  where job_id = p_job_id
  for update;

  if v_job is null then
    return false;
  end if;

  if v_job.status = 'completed' then
    select section_payload into v_stored
    from report_sections
    where policy_analysis_id = v_job.analysis_id
      and section_key = 'analyzer_report_v1';
    if analyzer_report_binding_error(v_job.job_id, v_stored) is not null then
      raise exception 'report_unavailable';
    end if;
    return true;
  end if;

  if v_job.cancelled_at is not null or v_job.status = 'cancelled' then
    raise exception 'job_cancelled';
  end if;

  if v_job.status <> 'processing'
     or v_job.lease_owner is distinct from p_worker_id
     or v_job.lease_expires_at is null
     or v_job.lease_expires_at <= now() then
    raise exception 'lease_mismatch';
  end if;

  v_bind := analyzer_report_binding_error(p_job_id, p_report);
  if v_bind is not null then
    raise exception '%', v_bind;
  end if;

  insert into report_sections (
    policy_analysis_id, account_id, user_id,
    section_key, section_confidence, section_payload
  ) values (
    v_job.analysis_id, v_job.account_id, v_job.owner_user_id,
    'analyzer_report_v1', 'HIGH', p_report
  )
  on conflict (policy_analysis_id, section_key) do update
    set section_payload = excluded.section_payload,
        updated_at = now();

  update policy_analyses
  set analysis_status = 'complete',
      completeness_status = p_report->>'completeness_status',
      extraction_status = 'complete',
      updated_at = now()
  where policy_analysis_id = v_job.analysis_id;

  update analysis_jobs
  set status = 'completed',
      stage = 'completed',
      completed_at = now(),
      documents_processed = coalesce((p_report->>'document_count')::integer, documents_processed),
      page_count = coalesce((p_report->>'page_count')::integer, page_count),
      pages_processed = coalesce((p_report->>'page_count')::integer, pages_processed),
      retryable = false,
      error_code = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where job_id = p_job_id;

  return true;
end;
$$;

revoke all on function complete_analysis_job(uuid, text, jsonb) from public;
revoke all on function complete_analysis_job(uuid, text, jsonb) from anon;
revoke all on function complete_analysis_job(uuid, text, jsonb) from authenticated;
grant execute on function complete_analysis_job(uuid, text, jsonb) to service_role;

-- =============================================================================
-- 11. IDENTITY IMMUTABILITY
-- Dedicated trigger functions, one per table. reject_ownership_mutation()
-- reads NEW.user_id / OLD.user_id and is valid only for tables that have
-- both account_id and user_id. analysis_jobs and upload_reservations use
-- owner_user_id, so they must not share that generic trigger.
-- upload_reservation_files has no UPDATE trigger: no RPC mutates it, and
-- it has neither user_id nor owner_user_id.
-- =============================================================================

create or replace function reject_analysis_job_identity_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.account_id is distinct from old.account_id
     or new.owner_user_id is distinct from old.owner_user_id
     or new.policy_id is distinct from old.policy_id
     or new.analysis_id is distinct from old.analysis_id then
    raise exception 'job identity columns are immutable';
  end if;
  return new;
end;
$$;

create or replace function reject_upload_reservation_identity_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.account_id is distinct from old.account_id
     or new.owner_user_id is distinct from old.owner_user_id
     or new.upload_id is distinct from old.upload_id
     or new.analysis_id is distinct from old.analysis_id
     or new.policy_id is distinct from old.policy_id
     or new.session_id is distinct from old.session_id
     or new.job_id is distinct from old.job_id then
    raise exception 'reservation identity columns are immutable';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['analysis_jobs', 'upload_reservations']
  loop
    execute format('drop trigger if exists trg_reject_ownership_mutation on %I', t);
  end loop;
end $$;

drop trigger if exists trg_reject_analysis_job_identity_mutation on analysis_jobs;
create trigger trg_reject_analysis_job_identity_mutation
  before update on analysis_jobs
  for each row execute function reject_analysis_job_identity_mutation();

drop trigger if exists trg_reject_upload_reservation_identity_mutation on upload_reservations;
create trigger trg_reject_upload_reservation_identity_mutation
  before update on upload_reservations
  for each row execute function reject_upload_reservation_identity_mutation();

create or replace function reject_usage_account_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.account_id is distinct from old.account_id then
    raise exception 'usage account_id is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_usage_account_change on account_usage_windows;
create trigger trg_reject_usage_account_change
  before update on account_usage_windows
  for each row execute function reject_usage_account_change();
