-- =============================================================================
-- HorseInsurance.ai — Fix #7 additive staging operations snapshot
-- =============================================================================
-- Does NOT rewrite accepted Fix #5 or Fix #6 migrations.
-- Records the schema version and exposes a service_role-only ops snapshot.
-- =============================================================================

insert into analyzer_runtime_config (config_key, config_value) values
  ('schema_version', '20260903220000'),
  ('fix7_staging_ops', 'true')
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
    'queue_depth', (select count(*) from analysis_jobs where status = 'queued'),
    'processing_count', (select count(*) from analysis_jobs where status = 'processing'),
    'failed_count', (select count(*) from analysis_jobs where status = 'failed'),
    'needs_review_count', (select count(*) from analysis_jobs where status = 'needs_review'),
    'oldest_queued_age_seconds', (
      select coalesce(
        extract(epoch from (now() - min(created_at)))::integer,
        0
      )
      from analysis_jobs
      where status = 'queued'
    ),
    'attempts_exhausted_count', (
      select count(*) from analysis_jobs
      where status = 'failed' and error_code = 'attempts_exhausted'
    )
  ) into result;

  return result;
end;
$$;

revoke all on function analyzer_ops_snapshot() from public;
revoke all on function analyzer_ops_snapshot() from anon;
revoke all on function analyzer_ops_snapshot() from authenticated;
grant execute on function analyzer_ops_snapshot() to service_role;

create or replace function analyzer_schema_version()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    raise exception 'service_role_required';
  end if;
  return (select config_value from analyzer_runtime_config where config_key = 'schema_version');
end;
$$;

revoke all on function analyzer_schema_version() from public;
revoke all on function analyzer_schema_version() from anon;
revoke all on function analyzer_schema_version() from authenticated;
grant execute on function analyzer_schema_version() to service_role;
