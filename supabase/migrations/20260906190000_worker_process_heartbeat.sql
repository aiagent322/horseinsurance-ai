-- =============================================================================
-- HorseInsurance.ai — worker process heartbeat (additive)
-- =============================================================================
-- Records a per-worker last-seen timestamp independent of analysis_jobs.
-- Does NOT rewrite accepted Fix #5–#8 or earlier additive migrations.
-- =============================================================================

insert into analyzer_runtime_config (config_key, config_value) values
  ('schema_version', '20260906190000'),
  ('worker_process_heartbeat', 'true')
on conflict (config_key) do update
  set config_value = excluded.config_value, updated_at = now();

create table if not exists analyzer_worker_heartbeats (
  worker_id text primary key,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analyzer_worker_heartbeats_worker_id_len
    check (char_length(btrim(worker_id)) between 1 and 128)
);

alter table analyzer_worker_heartbeats enable row level security;

revoke all on analyzer_worker_heartbeats from public;
revoke all on analyzer_worker_heartbeats from anon;
revoke all on analyzer_worker_heartbeats from authenticated;

create or replace function heartbeat_analyzer_worker(p_worker_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'service_role_required';
  end if;

  if p_worker_id is null or char_length(btrim(p_worker_id)) = 0 or char_length(p_worker_id) > 128 then
    raise exception 'invalid_worker_id';
  end if;

  insert into analyzer_worker_heartbeats (worker_id, last_seen_at, updated_at)
  values (btrim(p_worker_id), now(), now())
  on conflict (worker_id) do update
    set last_seen_at = now(),
        updated_at = now();

  return true;
end;
$$;

revoke all on function heartbeat_analyzer_worker(text) from public;
revoke all on function heartbeat_analyzer_worker(text) from anon;
revoke all on function heartbeat_analyzer_worker(text) from authenticated;
grant execute on function heartbeat_analyzer_worker(text) to service_role;

create or replace function analyzer_ops_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.uid() is not null then
    raise exception 'service_role_required';
  end if;

  select jsonb_build_object(
    'schema_version', (select config_value from analyzer_runtime_config where config_key = 'schema_version'),
    'queued_count', (select count(*)::integer from analysis_jobs where status = 'queued'),
    'oldest_queued_age_seconds', (
      select coalesce(
        extract(epoch from (now() - min(created_at)))::integer,
        0
      )
      from analysis_jobs
      where status = 'queued'
    ),
    'processing_count', (select count(*)::integer from analysis_jobs where status = 'processing'),
    'expired_lease_count', (
      select count(*)::integer from analysis_jobs
      where status = 'processing'
        and lease_expires_at is not null
        and lease_expires_at <= now()
    ),
    'failed_count', (select count(*)::integer from analysis_jobs where status = 'failed'),
    'last_worker_heartbeat_age_seconds', (
      select extract(epoch from (now() - max(last_seen_at)))::integer
      from analyzer_worker_heartbeats
    ),
    'bucket_exists', exists(select 1 from storage.buckets where id = 'policy-files'),
    'bucket_private', coalesce(
      (select not public from storage.buckets where id = 'policy-files'),
      false
    )
  ) into result;

  return result;
end;
$$;

revoke all on function analyzer_ops_snapshot() from public;
revoke all on function analyzer_ops_snapshot() from anon;
revoke all on function analyzer_ops_snapshot() from authenticated;
grant execute on function analyzer_ops_snapshot() to service_role;
