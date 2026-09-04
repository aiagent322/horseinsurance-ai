-- =============================================================================
-- HorseInsurance.ai — Fix #7 trusted operations snapshot (additive)
-- =============================================================================
-- Replaces the Fix #7 ops snapshot with fail-closed fields used by readiness
-- and alerts. Does NOT rewrite accepted Fix #5 or Fix #6 migrations.
-- =============================================================================

insert into analyzer_runtime_config (config_key, config_value) values
  ('schema_version', '20260904010000'),
  ('fix7_trusted_ops', 'true')
on conflict (config_key) do update
  set config_value = excluded.config_value, updated_at = now();

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
      select extract(epoch from (now() - max(last_heartbeat)))::integer
      from analysis_jobs
      where last_heartbeat is not null
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
