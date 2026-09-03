-- =============================================================================
-- HorseInsurance.ai — Durable analysis jobs, reservations, protected limits
-- =============================================================================
-- Additive to the Phase 1 schema + RLS + analyzer auth persistence migrations.
-- Does NOT rewrite earlier migrations.
-- Local-only until explicitly applied.
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- 1. PROTECTED CONFIGURATION (not readable or writable by authenticated users)
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
  ('retention_days',               '30')
on conflict (config_key) do nothing;

alter table analyzer_runtime_config enable row level security;
-- No RLS policy created: authenticated/anon/public cannot read or write.

revoke all on analyzer_runtime_config from public;
revoke all on analyzer_runtime_config from anon;
revoke all on analyzer_runtime_config from authenticated;

-- Helper: read a config value (SECURITY DEFINER so it can read the table).
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
    upload_count  integer not null default 0,
    primary key (account_id, window_start)
);

alter table account_usage_windows enable row level security;
-- No RLS policy: authenticated users cannot read or write counters.

revoke all on account_usage_windows from public;
revoke all on account_usage_windows from anon;
revoke all on account_usage_windows from authenticated;

-- =============================================================================
-- 3. ANALYSIS JOBS TABLE
-- =============================================================================

create table analysis_jobs (
    job_id             uuid primary key default gen_random_uuid(),
    policy_id          uuid not null,
    analysis_id        uuid not null references policy_analyses(policy_analysis_id) on delete cascade,
    account_id         uuid not null references accounts(account_id) on delete cascade,
    owner_user_id      uuid not null,
    status             text not null default 'queued'
                         check (status in ('queued','processing','completed','failed','needs_review','cancelled')),
    attempt_count      integer not null default 0,
    max_attempts       integer not null default 3,
    created_at         timestamptz not null default now(),
    available_at       timestamptz not null default now(),
    started_at         timestamptz,
    completed_at       timestamptz,
    lease_owner        text,
    lease_expires_at   timestamptz,
    last_heartbeat     timestamptz,
    error_code         text,
    failure_stage      text,
    cancelled_at       timestamptz,
    recovery           jsonb not null default '{}'::jsonb,
    stage              text not null default 'queued',
    document_count     integer not null default 0,
    documents_processed integer not null default 0,
    page_count         integer,
    pages_processed    integer not null default 0,
    retryable          boolean not null default false,
    updated_at         timestamptz not null default now()
);

create index idx_analysis_jobs_claimable
  on analysis_jobs (status, available_at)
  where status in ('queued','processing');

create index idx_analysis_jobs_account
  on analysis_jobs (account_id, status);

create index idx_analysis_jobs_policy
  on analysis_jobs (policy_id);

alter table analysis_jobs enable row level security;

-- Authenticated users: SELECT own safe status only (via function below).
-- No INSERT/UPDATE/DELETE policy for authenticated on analysis_jobs.
revoke all on analysis_jobs from public;
revoke all on analysis_jobs from anon;
revoke insert, update, delete on analysis_jobs from authenticated;
grant select on analysis_jobs to authenticated;

create policy jobs_select_own on analysis_jobs
  for select using (
    owner_user_id = auth.uid()
    and app_is_account_member(account_id)
  );

-- =============================================================================
-- 4. UPLOAD RESERVATIONS
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
    file_count      integer not null,
    file_ids        uuid[] not null,
    document_ids    uuid[] not null,
    storage_paths   text[] not null,
    status          text not null default 'pending'
                      check (status in ('pending','finalized','abandoned','expired')),
    expires_at      timestamptz not null,
    created_at      timestamptz not null default now(),
    finalized_at    timestamptz
);

create index idx_reservations_owner on upload_reservations (account_id, owner_user_id);
create index idx_reservations_status on upload_reservations (status, expires_at);

alter table upload_reservations enable row level security;
-- No direct DML from authenticated users; only via SECURITY DEFINER functions.

revoke all on upload_reservations from public;
revoke all on upload_reservations from anon;
revoke all on upload_reservations from authenticated;

-- =============================================================================
-- 5. RESERVE PACKAGE (SECURITY DEFINER — authenticated only)
-- =============================================================================
-- Derives user from auth.uid(), account from account_members.
-- Generates all IDs in trusted DB code.
-- Enforces rate and backlog limits transactionally.
-- Serializes concurrent account quota decisions via SELECT ... FOR UPDATE.
-- Reservation expires safely. Worker cannot claim before finalization.

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
  v_file_ids uuid[];
  v_document_ids uuid[];
  v_storage_paths text[];
  v_expires_at timestamptz;
  i integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Resolve account from membership (never caller-supplied).
  select m.account_id into v_acc
  from account_members m
  where m.user_id = v_uid and m.user_role = 'owner'
  order by m.created_at asc limit 1;

  if v_acc is null then
    raise exception 'no_account';
  end if;

  -- Read protected limits.
  v_max_files := coalesce(app_config('max_files_per_package')::integer, 10);
  v_rate_limit := coalesce(app_config('uploads_per_account_per_hour')::integer, 20);
  v_active_limit := coalesce(app_config('active_jobs_per_account')::integer, 5);
  v_expiry_minutes := coalesce(app_config('reservation_expiry_minutes')::integer, 30);

  if p_file_count < 1 or p_file_count > v_max_files then
    raise exception 'invalid_file_count';
  end if;

  -- Serialize concurrent quota decisions for this account.
  perform 1 from accounts where account_id = v_acc for update;

  -- Rate limit: uploads per account per hour.
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

  -- Active jobs backlog limit.
  select count(*) into v_active_count
  from analysis_jobs
  where account_id = v_acc and status in ('queued', 'processing');

  if v_active_count >= v_active_limit then
    raise exception 'backlog_limited';
  end if;

  -- Generate all authoritative IDs.
  v_reservation_id := gen_random_uuid();
  v_upload_id := gen_random_uuid();
  v_analysis_id := gen_random_uuid();
  v_policy_id := gen_random_uuid();
  v_session_id := gen_random_uuid();
  v_job_id := gen_random_uuid();

  v_file_ids := array[]::uuid[];
  v_document_ids := array[]::uuid[];
  v_storage_paths := array[]::text[];

  for i in 1..p_file_count loop
    v_file_ids := v_file_ids || gen_random_uuid();
    v_document_ids := v_document_ids || gen_random_uuid();
    v_storage_paths := v_storage_paths || (v_acc::text || '/' || v_upload_id::text || '/' || v_file_ids[i]::text || '.pdf');
  end loop;

  v_expires_at := now() + (v_expiry_minutes || ' minutes')::interval;

  -- Increment usage counter.
  update account_usage_windows
  set upload_count = upload_count + 1
  where account_id = v_acc and window_start = v_window_start;

  -- Create the reservation.
  insert into upload_reservations (
    reservation_id, account_id, owner_user_id, upload_id, analysis_id,
    policy_id, session_id, job_id, file_count, file_ids, document_ids,
    storage_paths, status, expires_at
  ) values (
    v_reservation_id, v_acc, v_uid, v_upload_id, v_analysis_id,
    v_policy_id, v_session_id, v_job_id, p_file_count, v_file_ids, v_document_ids,
    v_storage_paths, 'pending', v_expires_at
  );

  return jsonb_build_object(
    'reservation_id', v_reservation_id,
    'upload_id', v_upload_id,
    'analysis_id', v_analysis_id,
    'policy_id', v_policy_id,
    'session_id', v_session_id,
    'job_id', v_job_id,
    'file_ids', to_jsonb(v_file_ids),
    'document_ids', to_jsonb(v_document_ids),
    'storage_paths', to_jsonb(v_storage_paths),
    'expires_at', v_expires_at
  );
end;
$$;

revoke all on function reserve_analyzer_package(integer) from public;
revoke all on function reserve_analyzer_package(integer) from anon;
grant execute on function reserve_analyzer_package(integer) to authenticated;

-- =============================================================================
-- 6. FINALIZE PACKAGE (SECURITY DEFINER — authenticated only)
-- =============================================================================
-- Locks and verifies reservation. Requires same authenticated owner.
-- Requires exactly the reserved files with SHA-256 and exact storage paths.
-- Verifies every Storage object exists (via storage.objects).
-- Creates upload, analysis, file metadata, and queued job atomically.
-- Uses database-controlled retry and retention settings.

create or replace function finalize_analyzer_package(
  p_reservation_id uuid,
  p_files jsonb  -- [{file_id, document_id, sha256, storage_path, page_count, original_filename}]
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
  v_submitted_ids uuid[];
  v_submitted_paths text[];
  i integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Lock the reservation row.
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

  -- Validate file count matches exactly.
  if jsonb_array_length(p_files) <> v_res.file_count then
    raise exception 'file_count_mismatch';
  end if;

  -- Read protected settings.
  v_max_attempts := coalesce(app_config('max_job_attempts')::integer, 3);
  v_retention_days := coalesce(app_config('retention_days')::integer, 30);

  -- Validate each file: exact IDs, exact paths, SHA-256 present.
  v_submitted_ids := array[]::uuid[];
  v_submitted_paths := array[]::text[];
  for i in 0..jsonb_array_length(p_files) - 1 loop
    v_file := p_files->i;
    v_file_id := (v_file->>'file_id')::uuid;
    v_doc_id := (v_file->>'document_id')::uuid;
    v_path := v_file->>'storage_path';
    v_sha := v_file->>'sha256';

    if v_file_id is null or v_doc_id is null or v_path is null or v_sha is null then
      raise exception 'file_field_missing';
    end if;

    -- SHA-256 must be lowercase hex, exactly 64 chars.
    if length(v_sha) <> 64 or v_sha !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid_sha256';
    end if;

    -- File ID must be one of the reserved IDs.
    if not (v_file_id = any(v_res.file_ids)) then
      raise exception 'file_id_not_reserved';
    end if;

    -- Document ID must match the corresponding reserved document ID.
    if not (v_doc_id = any(v_res.document_ids)) then
      raise exception 'document_id_not_reserved';
    end if;

    -- Storage path must exactly match the reserved path.
    if not (v_path = any(v_res.storage_paths)) then
      raise exception 'storage_path_mismatch';
    end if;

    -- Path must start with account_id/ (no foreign account injection).
    if split_part(v_path, '/', 1) <> v_res.account_id::text then
      raise exception 'storage_path_foreign_account';
    end if;

    -- Verify the Storage object exists (requires storage schema).
    if to_regclass('storage.objects') is not null then
      if not exists (
        select 1 from storage.objects
        where bucket_id = 'policy-files' and name = v_path
      ) then
        raise exception 'storage_object_missing';
      end if;
    end if;

    v_submitted_ids := v_submitted_ids || v_file_id;
    v_submitted_paths := v_submitted_paths || v_path;
  end loop;

  -- Every reserved file ID must be submitted (no omissions).
  for i in 1..array_length(v_res.file_ids, 1) loop
    if not (v_res.file_ids[i] = any(v_submitted_ids)) then
      raise exception 'reserved_file_missing';
    end if;
  end loop;

  -- No duplicate file IDs.
  if array_length(v_submitted_ids, 1) <> (select count(distinct u) from unnest(v_submitted_ids) u) then
    raise exception 'duplicate_file_ids';
  end if;

  -- ---- Atomic creation of upload, analysis, files, queued job ----

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

  -- Insert file metadata.
  for i in 0..jsonb_array_length(p_files) - 1 loop
    v_file := p_files->i;
    insert into uploaded_policy_files (
      file_id, upload_id, account_id, user_id,
      file_name, file_type, object_storage_key,
      page_count, file_sha256, document_id, extraction_status
    ) values (
      (v_file->>'file_id')::uuid,
      v_res.upload_id,
      v_res.account_id,
      v_uid,
      coalesce(v_file->>'original_filename', (v_file->>'file_id') || '.pdf'),
      'pdf',
      v_file->>'storage_path',
      nullif(v_file->>'page_count', '')::integer,
      v_file->>'sha256',
      (v_file->>'document_id')::uuid,
      'pending'
    );
  end loop;

  -- Create the queued job.
  insert into analysis_jobs (
    job_id, policy_id, analysis_id, account_id, owner_user_id,
    status, attempt_count, max_attempts,
    document_count, stage
  ) values (
    v_res.job_id, v_res.policy_id, v_res.analysis_id, v_res.account_id, v_uid,
    'queued', 0, v_max_attempts,
    v_res.file_count, 'queued'
  );

  -- Mark reservation finalized.
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
-- 7. ABANDON RESERVATION (SECURITY DEFINER — authenticated only)
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
-- 8. SAFE JOB STATUS (SECURITY DEFINER — authenticated only)
-- =============================================================================
-- Returns a safe subset of job state. The SELECT policy on analysis_jobs
-- already restricts to own rows, but this function provides a typed safe view.

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
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_job
  from analysis_jobs
  where policy_id = p_policy_id
    and owner_user_id = v_uid
    and app_is_account_member(account_id)
  order by created_at desc
  limit 1;

  if v_job is null then
    return null;
  end if;

  return jsonb_build_object(
    'analysis_id', v_job.policy_id,
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
-- 9. CANCEL OWN JOB (SECURITY DEFINER — authenticated only)
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
      updated_at = now()
  where job_id = v_job.job_id;

  return true;
end;
$$;

revoke all on function cancel_own_analysis_job(uuid) from public;
revoke all on function cancel_own_analysis_job(uuid) from anon;
grant execute on function cancel_own_analysis_job(uuid) to authenticated;

-- =============================================================================
-- 10. WORKER FUNCTIONS (service_role only)
-- =============================================================================

-- CLAIM JOBS: FOR UPDATE SKIP LOCKED.
-- Only claims finalized reservations (job exists in analysis_jobs).
-- Expired leases may be reclaimed within attempt limit.

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
begin
  -- service_role check: auth.uid() is null for service role calls.
  -- If auth.uid() is set, this is NOT a service_role call.
  if auth.uid() is not null then
    raise exception 'service_role_required';
  end if;

  for v_job in
    select j.*
    from analysis_jobs j
    where j.status in ('queued', 'processing')
      and j.cancelled_at is null
      and (
        (j.status = 'queued' and j.available_at <= v_now)
        or (j.status = 'processing' and j.lease_expires_at is not null and j.lease_expires_at < v_now
            and j.attempt_count < j.max_attempts)
      )
    order by j.available_at asc
    limit p_limit
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

    -- Gather file metadata for the worker.
    select coalesce(jsonb_agg(jsonb_build_object(
      'file_id', f.file_id,
      'document_id', f.document_id,
      'storage_path', f.object_storage_key,
      'sha256', f.file_sha256,
      'original_filename', f.file_name
    )), '[]'::jsonb)
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

-- HEARTBEAT JOB

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
    and lease_owner = p_worker_id
    and status = 'processing';

  return found;
end;
$$;

revoke all on function heartbeat_analysis_job(uuid, text) from public;
revoke all on function heartbeat_analysis_job(uuid, text) from anon;
revoke all on function heartbeat_analysis_job(uuid, text) from authenticated;

-- UPDATE JOB PROGRESS

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
    and lease_owner = p_worker_id
    and status = 'processing';

  return found;
end;
$$;

revoke all on function update_job_progress(uuid, text, text, integer, integer, integer) from public;
revoke all on function update_job_progress(uuid, text, text, integer, integer, integer) from anon;
revoke all on function update_job_progress(uuid, text, text, integer, integer, integer) from authenticated;

-- FAIL JOB

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
    and lease_owner = p_worker_id
  for update;

  if v_job is null then
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

-- COMPLETE JOB
-- Verifies active lease. Rejects cancelled jobs. Idempotent.
-- Findings published only after full report transaction succeeds.

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

  -- Idempotent: already completed with a report.
  if v_job.status = 'completed' then
    return true;
  end if;

  -- Reject cancelled jobs.
  if v_job.cancelled_at is not null or v_job.status = 'cancelled' then
    raise exception 'job_cancelled';
  end if;

  -- Verify active lease.
  if v_job.lease_owner <> p_worker_id then
    raise exception 'lease_mismatch';
  end if;

  -- Store the report in report_sections atomically.
  insert into report_sections (
    policy_analysis_id, account_id, user_id,
    section_key, section_confidence, section_payload
  ) values (
    v_job.analysis_id, v_job.account_id, v_job.owner_user_id,
    'analyzer_report_v1', 'HIGH', p_report
  )
  on conflict do nothing;

  -- Update the analysis status.
  update policy_analyses
  set analysis_status = 'complete',
      completeness_status = p_report->>'completeness_status',
      extraction_status = 'complete',
      updated_at = now()
  where policy_analysis_id = v_job.analysis_id;

  -- Mark job completed.
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

-- =============================================================================
-- 11. OWNERSHIP IMMUTABILITY on new tables
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array['analysis_jobs', 'upload_reservations', 'account_usage_windows']
  loop
    execute format('drop trigger if exists trg_reject_ownership_mutation on %I', t);
  end loop;
end $$;

create trigger trg_reject_ownership_mutation
  before update on analysis_jobs
  for each row execute function reject_ownership_mutation();

-- account_usage_windows has account_id but no user_id column,
-- so we add a specific guard.
create or replace function reject_usage_account_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.account_id is distinct from old.account_id then
    raise exception 'ownership columns are immutable';
  end if;
  return new;
end;
$$;

create trigger trg_reject_usage_account_change
  before update on account_usage_windows
  for each row execute function reject_usage_account_change();

-- =============================================================================
-- END — Durable analysis jobs, reservations, protected limits
-- =============================================================================
