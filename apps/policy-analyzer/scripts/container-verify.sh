#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="horseinsurance-analyzer-fix7"
CANARY="FIX7_SECRET_CANARY_DO_NOT_EMBED"
SHA="$(git -C "$ROOT/../.." rev-parse HEAD)"
DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cd "$ROOT"
docker build \
  --build-arg GIT_SHA="$SHA" \
  --build-arg BUILD_DATE="$DATE" \
  -t "$IMAGE" \
  .

if docker history --no-trunc "$IMAGE" | grep -F "$CANARY"; then
  echo "CANARY_IN_IMAGE_HISTORY" >&2
  exit 1
fi
if docker history --no-trunc "$IMAGE" | grep -Ei 'service_role|eyJhbGci'; then
  echo "SECRET_PATTERN_IN_IMAGE_HISTORY" >&2
  exit 1
fi

USER_LINE="$(docker run --rm --entrypoint id "$IMAGE")"
echo "$USER_LINE" | grep -q 'uid=10001' || { echo "RUNTIME_USER_NOT_ANALYZER" >&2; exit 1; }
echo "$USER_LINE" | grep -qv 'uid=0(' || { echo "RUNTIME_USER_IS_ROOT" >&2; exit 1; }

FS_HIT="$(docker run --rm --entrypoint sh "$IMAGE" -c "grep -R \"$CANARY\" /app /tmp 2>/dev/null || true")"
if [[ -n "$FS_HIT" ]]; then
  echo "CANARY_IN_IMAGE_FS" >&2
  exit 1
fi

echo "==> container-verify: hosted E2E runner is in the runtime image"
docker run --rm --entrypoint sh "$IMAGE" -c 'test -f /app/scripts/hosted-e2e.ts && test -f /app/scripts/live-safety.ts && test ! -f /app/scripts/hosted-migrate.ts && test ! -f /app/scripts/live-db-regression.ts && test ! -f /app/scripts/retention.ts && test ! -f /app/scripts/jobs.ts'

echo "==> container-verify: npm run test:hosted-e2e reaches the runner when disabled"
set +e
HOSTED_E2E_OUT="$(docker run --rm --entrypoint npm \
  -e POLICY_ANALYZER_HOSTED_E2E= \
  -e POLICY_ANALYZER_STAGING_APP_URL= \
  "$IMAGE" \
  run test:hosted-e2e 2>&1)"
HOSTED_E2E_CODE=$?
set -e
printf '%s\n' "$HOSTED_E2E_OUT"
if [[ "$HOSTED_E2E_CODE" -ne 0 ]]; then
  echo "HOSTED_E2E_DISABLED_DID_NOT_EXIT_CLEANLY" >&2
  exit 1
fi
printf '%s\n' "$HOSTED_E2E_OUT" | grep -q "HOSTED_E2E_NOT_CONFIGURED" || {
  echo "HOSTED_E2E_DISABLED_MISSING_MARKER" >&2
  exit 1
}
if printf '%s\n' "$HOSTED_E2E_OUT" | grep -q "ERR_MODULE_NOT_FOUND"; then
  echo "HOSTED_E2E_MODULE_NOT_FOUND" >&2
  exit 1
fi

echo "==> container-verify: hosted E2E pre-upload inputs exist and are readable"
docker run --rm --user 10001:10001 --entrypoint sh "$IMAGE" -c \
  'command -v curl >/dev/null && test -x "$(command -v curl)" && test -r /app/lib/build-complete-pdf.ts && test -r /app/scripts/hosted-e2e.ts && test -w /tmp/ocr'
PREUPLOAD_OUT="$(docker run --rm --user 10001:10001 \
  --entrypoint /app/node_modules/.bin/tsx \
  -e TMPDIR=/tmp/ocr \
  "$IMAGE" \
  -e 'import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCompletePolicyPdf } from "./lib/build-complete-pdf.ts";
void (async () => {
  const pdf = await buildCompletePolicyPdf();
  if (!Buffer.isBuffer(pdf) || pdf.length < 64 || pdf.subarray(0, 4).toString() !== "%PDF") {
    process.exit(2);
  }
  const out = path.join(tmpdir(), "hosted-e2e-preupload.pdf");
  writeFileSync(out, pdf);
  const roundTrip = readFileSync(out);
  unlinkSync(out);
  if (roundTrip.subarray(0, 4).toString() !== "%PDF") process.exit(3);
  console.log("HOSTED_E2E_PREUPLOAD_INPUT_OK");
})();')"
printf '%s\n' "$PREUPLOAD_OUT"
printf '%s\n' "$PREUPLOAD_OUT" | grep -q "HOSTED_E2E_PREUPLOAD_INPUT_OK" || {
  echo "HOSTED_E2E_PREUPLOAD_INPUT_MISSING" >&2
  exit 1
}

WEB_CID="$(docker run -d --user 10001:10001 \
  -e POLICY_ANALYZER_ENV=staging \
  -e POLICY_ANALYZER_PROCESS=web \
  -e POLICY_ANALYZER_UPLOADS_ENABLED=false \
  -e POLICY_RETENTION_DAYS=30 \
  -e NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=public-anon-placeholder \
  -e POLICY_ANALYZER_OPS_TOKEN=ops-placeholder \
  -p 127.0.0.1:43149:43147 \
  "$IMAGE" web)"
trap 'docker rm -f "$WEB_CID" >/dev/null 2>&1 || true' EXIT
web_ok=0
for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:43149/api/health/live" | grep -q live; then
    web_ok=1
    break
  fi
  sleep 1
done
if [[ "$web_ok" -ne 1 ]]; then
  docker logs "$WEB_CID" >&2 || true
  echo "WEB_PROCESS_DID_NOT_START" >&2
  exit 1
fi
docker rm -f "$WEB_CID" >/dev/null
WEB_CID=""

set +e
docker run --rm \
  -e POLICY_ANALYZER_ENV=staging \
  -e NODE_ENV=production \
  -e POLICY_ANALYZER_STORE=memory \
  -e POLICY_ANALYZER_PROCESS=worker \
  "$IMAGE" worker >/tmp/fix7-worker-memory.log 2>&1
MEM_CODE=$?
set -e
if [[ "$MEM_CODE" -eq 0 ]]; then
  echo "WORKER_ACCEPTED_MEMORY_IN_STAGING" >&2
  exit 1
fi

set +e
docker run --rm \
  -e POLICY_ANALYZER_ENV=staging \
  -e NODE_ENV=production \
  -e POLICY_ANALYZER_STORE=supabase \
  -e POLICY_ANALYZER_PROCESS=worker \
  "$IMAGE" worker >/tmp/fix7-worker-missing.log 2>&1
MISS_CODE=$?
set -e
if [[ "$MISS_CODE" -eq 0 ]]; then
  echo "WORKER_STARTED_WITHOUT_CREDENTIALS" >&2
  exit 1
fi

if [[ -f /tmp/fix5-live-stack/env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /tmp/fix5-live-stack/env
  set +a
  set +e
  docker run --rm --network host \
    -e POLICY_ANALYZER_ENV=staging \
    -e NODE_ENV=production \
    -e POLICY_ANALYZER_STORE=supabase \
    -e POLICY_ANALYZER_PROCESS=worker-once \
    -e POLICY_RETENTION_DAYS=30 \
    -e SUPABASE_URL="$LIVE_SUPABASE_URL" \
    -e NEXT_PUBLIC_SUPABASE_URL="$LIVE_SUPABASE_URL" \
    -e NEXT_PUBLIC_SUPABASE_ANON_KEY="$LIVE_SUPABASE_ANON_KEY" \
    -e SUPABASE_SERVICE_ROLE_KEY="$LIVE_SUPABASE_SERVICE_ROLE_KEY" \
    -e POLICY_ANALYZER_WORKER_ID=fix7-container-worker \
    "$IMAGE" worker-once >/tmp/fix7-worker-once.log 2>&1
  ONCE_CODE=$?
  set -e
  if [[ "$ONCE_CODE" -ne 0 ]]; then
    echo "WORKER_ONCE_STAGING_STYLE_FAILED" >&2
    exit 1
  fi
fi

TERM_CID="$(docker run -d \
  -e POLICY_ANALYZER_ENV=staging \
  -e POLICY_ANALYZER_PROCESS=web \
  -e POLICY_RETENTION_DAYS=30 \
  -e NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=public-anon-placeholder \
  "$IMAGE" web)"
sleep 3
START=$(date +%s)
docker kill --signal=SIGTERM "$TERM_CID" >/dev/null
for i in $(seq 1 30); do
  if ! docker ps -q --filter "id=$TERM_CID" | grep -q .; then
    break
  fi
  sleep 1
done
END=$(date +%s)
if docker ps -q --filter "id=$TERM_CID" | grep -q .; then
  docker rm -f "$TERM_CID" >/dev/null
  echo "SIGTERM_DID_NOT_STOP_PROCESS" >&2
  exit 1
fi
ELAPSED=$((END - START))
if [[ "$ELAPSED" -gt 25 ]]; then
  echo "SIGTERM_EXCEEDED_BOUND" >&2
  exit 1
fi
docker rm -f "$TERM_CID" >/dev/null 2>&1 || true

echo "CONTAINER VERIFY OK"
