# Staging deployment

Protected staging web application and a dedicated worker share one versioned image and receive separate secrets. The worker is never exposed through a public HTTP processing endpoint.

```text
Protected staging web application
        |
        v
Dedicated staging Supabase project
  - Postgres
  - Auth
  - private policy-files bucket
        ^
        |
Dedicated worker process
```

## Image

Build from `apps/policy-analyzer`:

```bash
GIT_SHA=$(git rev-parse HEAD)
docker build \
  --build-arg GIT_SHA="$GIT_SHA" \
  --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t horseinsurance-analyzer:$GIT_SHA \
  .
```

Startup commands:

```bash
docker run --read-only --tmpfs /tmp/ocr --tmpfs /tmp/next \
  --user 10001:10001 \
  -e POLICY_ANALYZER_PROCESS=web \
  horseinsurance-analyzer:$GIT_SHA web

docker run --read-only --tmpfs /tmp/ocr \
  --user 10001:10001 \
  -e POLICY_ANALYZER_PROCESS=worker \
  horseinsurance-analyzer:$GIT_SHA worker
```

`tini` forwards `SIGTERM` to the Node process. The worker shutdown bound is `POLICY_ANALYZER_WORKER_SHUTDOWN_MS` (default 20s). No packages are installed at container start.

Recommended resources for a first staging pair:

- Web: 1 vCPU, 1 GiB RAM
- Worker: 1 vCPU, 2 GiB RAM, 1 concurrent OCR job
- Temporary disk: 2 GiB mounted at `/tmp/ocr`

## Required access before an external deploy

This task does not purchase hosting. An authorized staging deploy needs all of the following:

1. An isolated staging Supabase project (not production, not a shared sandbox)
2. Staging project URL, anon key, and service-role key stored only in the platform secret store
3. An approved host that can run two long-lived processes from the same image
4. Permission to apply analyzer migrations only to that isolated project
5. `POLICY_ANALYZER_ALLOW_STAGING_MIGRATIONS=YES` plus the exact staging project ref/host allowlist — never the production authorization flags

Until those exist, keep the image and runbooks and do not open public uploads.

## Local disposable staging (Milestone 3)

The accepted Fix #5–#8 machine can run a real analysis on the loopback stack without a hosted project:

```bash
cd apps/policy-analyzer
bash scripts/live-stack-start.sh
bash scripts/local-staging.sh
node scripts/local-staging-session.mjs
```

`local-staging.sh` starts the web process and the dedicated worker with uploads enabled. It sources `/tmp/fix5-live-stack/env` and never prints secrets. `local-staging-session.mjs` writes a loopback login to `/tmp/fix5-live-stack/human-login` (mode 0600). Password sign-in appears only when the public Supabase URL is loopback. Hosted staging continues to use email.

Automated coverage:

```bash
set -a && source /tmp/fix5-live-stack/env && set +a
npm run test:db-live
npm run test:staging
```

`test:staging` is the Milestone 3 HTTP integration: authenticated upload, durable job, worker claim, cited report retrieval, cross-account denial, fail-closed publication, cancel-cannot-complete, and single-winner leases.

Do not upload private customer policies to the disposable local stack. Use only synthetic or deliberately selected, rights-cleared educational PDFs.

`20260905160000_m3_account_bootstrap.sql` is additive RLS: an account owner can read the account they just created so first-sign-in membership can be written. It does not rewrite Fix #5–#8 history.


## Web versus worker secrets

Web receives browser-safe public values, the ops token, retention, and the uploads flag. Protected readiness and alerts require a server-only `SUPABASE_SERVICE_ROLE_KEY` (or equivalent ops key) on the web process so they can call `analyzer_ops_snapshot`. That key must never be assigned to `NEXT_PUBLIC_*` variables or shipped to the browser.

The worker receives the service-role key, worker identity, lease/heartbeat limits, and OCR limits. It must not be published on a public URL.

Staging migration authorization (`POLICY_ANALYZER_ALLOW_STAGING_MIGRATIONS` plus the staging project allowlist) must never be combined with production project refs. Production authorization is a separate setting and does not classify unknown remotes as staging.

## Uploads

Staging uploads stay disabled until Auth, database, and the private `policy-files` bucket pass readiness and an operator sets `POLICY_ANALYZER_UPLOADS_ENABLED=true`. Unauthenticated upload, status, report, and original-document routes continue to return the same not-found response.

## Health

- `GET /api/health/live` — process liveness only
- `GET /api/ops/ready` — dependency readiness, requires `Authorization: Bearer $POLICY_ANALYZER_OPS_TOKEN`
- `GET /api/ops/alerts` — allowlisted alert evaluation, same token

Do not expose those ops routes without the token. The worker has no HTTP interface.

## Rollback

Roll the web and worker back to the accepted Fix #6 image/SHA `60d3de8d952cdd059c26d333876f8557dbf6cb4d`. Leave Fix #7 additive schema in place; it does not rewrite Fix #5 or Fix #6 history. Jobs created by a newer worker remain claimable after rollback if their payload still satisfies the older worker. Jobs that depend on Fix #7-only behavior stay queued or fail closed through the existing lease and attempt ceiling.
