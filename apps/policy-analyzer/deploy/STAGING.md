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

Until those exist, keep the image and runbooks and do not open public uploads.

## Web versus worker secrets

Web receives browser-safe public values, the ops token, retention, and the uploads flag. It must not receive `SUPABASE_SERVICE_ROLE_KEY`.

The worker receives the service-role key, worker identity, lease/heartbeat limits, and OCR limits. It must not be published on a public URL.

## Uploads

Staging uploads stay disabled until Auth, database, and the private `policy-files` bucket pass readiness and an operator sets `POLICY_ANALYZER_UPLOADS_ENABLED=true`. Unauthenticated upload, status, report, and original-document routes continue to return the same not-found response.

## Health

- `GET /api/health/live` — process liveness only
- `GET /api/ops/ready` — dependency readiness, requires `Authorization: Bearer $POLICY_ANALYZER_OPS_TOKEN`
- `GET /api/ops/alerts` — allowlisted alert evaluation, same token

Do not expose those ops routes without the token. The worker has no HTTP interface.

## Rollback

Roll the web and worker back to the accepted Fix #6 image/SHA `60d3de8d952cdd059c26d333876f8557dbf6cb4d`. Leave Fix #7 additive schema in place; it does not rewrite Fix #5 or Fix #6 history. Jobs created by a newer worker remain claimable after rollback if their payload still satisfies the older worker. Jobs that depend on Fix #7-only behavior stay queued or fail closed through the existing lease and attempt ceiling.
