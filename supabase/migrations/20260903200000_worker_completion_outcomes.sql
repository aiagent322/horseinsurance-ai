-- =============================================================================
-- HorseInsurance.ai — Fix #6 additive worker completion and progress rules
-- =============================================================================
-- Does NOT rewrite the accepted Fix #5 migration.
-- Adds allowlisted progress stages, monotonic counters, and needs_review
-- as a bound-report terminal outcome for the production worker.
-- =============================================================================

insert into analyzer_runtime_config (config_key, config_value) values
  ('job_lease_ms', '120000')
on conflict (config_key) do nothing;

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

  if p_stage is not null and p_stage not in ('downloading', 'extracting', 'analyzing', 'finalizing') then
    return false;
  end if;

  if p_documents_processed is not null and p_documents_processed < 0 then
    return false;
  end if;
  if p_page_count is not null and p_page_count < 0 then
    return false;
  end if;
  if p_pages_processed is not null and p_pages_processed < 0 then
    return false;
  end if;

  update analysis_jobs
  set
    stage = coalesce(p_stage, stage),
    documents_processed = case
      when p_documents_processed is null then documents_processed
      else least(document_count, greatest(documents_processed, p_documents_processed))
    end,
    page_count = case
      when p_page_count is null then page_count
      when page_count is null then p_page_count
      else greatest(page_count, p_page_count)
    end,
    pages_processed = case
      when p_pages_processed is null then pages_processed
      else
        least(
          coalesce(
            case
              when p_page_count is null then page_count
              when page_count is null then p_page_count
              else greatest(page_count, p_page_count)
            end,
            greatest(pages_processed, p_pages_processed)
          ),
          greatest(pages_processed, p_pages_processed)
        )
    end,
    last_heartbeat = now(),
    lease_expires_at = now() + (coalesce(app_config('job_lease_ms')::integer, 120000) || ' milliseconds')::interval,
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

drop function if exists complete_analysis_job(uuid, text, jsonb);

create function complete_analysis_job(
  p_job_id uuid,
  p_worker_id text,
  p_report jsonb,
  p_outcome text default 'completed'
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
  v_outcome text;
  v_doc_count integer;
  v_page_count integer;
begin
  if auth.uid() is not null then
    raise exception 'service_role_required';
  end if;

  v_outcome := coalesce(nullif(trim(p_outcome), ''), 'completed');
  if v_outcome not in ('completed', 'needs_review') then
    raise exception 'invalid_completion_outcome';
  end if;

  select * into v_job
  from analysis_jobs
  where job_id = p_job_id
  for update;

  if v_job is null then
    return false;
  end if;

  if v_job.status in ('completed', 'needs_review') then
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

  select coalesce(jsonb_array_length(p_report->'documents'), v_job.document_count)
    into v_doc_count;
  select coalesce((
    select sum(coalesce((d->>'page_count')::integer, 0))
    from jsonb_array_elements(coalesce(p_report->'documents', '[]'::jsonb)) d
  ), v_job.page_count) into v_page_count;

  update analysis_jobs
  set status = v_outcome,
      stage = v_outcome,
      completed_at = now(),
      documents_processed = coalesce(v_doc_count, documents_processed),
      page_count = coalesce(v_page_count, page_count),
      pages_processed = coalesce(v_page_count, pages_processed),
      retryable = false,
      error_code = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where job_id = p_job_id;

  return true;
end;
$$;

revoke all on function complete_analysis_job(uuid, text, jsonb, text) from public;
revoke all on function complete_analysis_job(uuid, text, jsonb, text) from anon;
revoke all on function complete_analysis_job(uuid, text, jsonb, text) from authenticated;
grant execute on function complete_analysis_job(uuid, text, jsonb, text) to service_role;

notify pgrst, 'reload schema';
