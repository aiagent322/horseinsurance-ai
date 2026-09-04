# Staging secret checklist

Fill these in the hosting platform's protected secret store only. Do not put values in git, images, tickets, or chat.

## Browser-safe public configuration

- [ ] `NEXT_PUBLIC_SUPABASE_URL` — isolated staging project URL
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` — staging anon/publishable key
- [ ] `POLICY_ANALYZER_ENV=staging`

## Web-server-only

- [ ] `POLICY_RETENTION_DAYS`
- [ ] `POLICY_ANALYZER_UPLOADS_ENABLED=false` until readiness passes
- [ ] `POLICY_ANALYZER_OPS_TOKEN` — random operator token
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — server-only, required for `/api/ops/ready` and `/api/ops/alerts` live probes; never `NEXT_PUBLIC_`
- [ ] `POLICY_ANALYZER_ALLOW_STAGING_MIGRATIONS` — `YES` only when applying migrations to the allowlisted staging project
- [ ] `POLICY_ANALYZER_STAGING_PROJECT_REF` / `POLICY_ANALYZER_STAGING_DB_HOSTS` — exact staging project only
- [ ] Production migration flags unset in staging
- [ ] `ENABLE_FIXTURE_ANALYSIS` — `true` only if the educational fixture should enqueue in staging

## Worker-only

- [ ] `SUPABASE_URL` — same isolated staging project
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — staging service role only
- [ ] `POLICY_ANALYZER_WORKER_ID`
- [ ] `POLICY_ANALYZER_PROCESS=worker`

## Operational limits

- [ ] `POLICY_ANALYZER_WORKER_CONCURRENCY` (start at 1)
- [ ] `POLICY_ANALYZER_WORKER_CLAIM_LIMIT` (start at 1)
- [ ] `POLICY_ANALYZER_WORKER_POLL_MS`
- [ ] `POLICY_ANALYZER_WORKER_HEARTBEAT_MS`
- [ ] `POLICY_ANALYZER_JOB_LEASE_MS`
- [ ] `POLICY_ANALYZER_WORKER_SHUTDOWN_MS`

## OCR

- [ ] `POLICY_ANALYZER_OCR_TIMEOUT_MS`

## Forbidden

- [ ] No `NEXT_PUBLIC_*SERVICE_ROLE*` variables
- [ ] No production project URL or keys
- [ ] No memory store (`POLICY_ANALYZER_STORE` unset or `supabase`)
- [ ] No unredacted customer documents in the image or host volume
