#!/usr/bin/env bash
# Run the Policy Analyzer web process and worker against the disposable
# loopback stack. Secrets stay in /tmp/fix5-live-stack and are never echoed.
set -euo pipefail

STACK_ENV=/tmp/fix5-live-stack/env
MARKER=/tmp/fix5-live-stack/DISPOSABLE_MARKER
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${POLICY_ANALYZER_STAGING_PORT:-43163}"
WEB_PID_FILE=/tmp/fix5-live-stack/m3-web.pid
WORKER_PID_FILE=/tmp/fix5-live-stack/m3-worker.pid

if [[ ! -f "$STACK_ENV" || ! -f "$MARKER" ]]; then
  echo "LOCAL_STAGING_STACK_MISSING" >&2
  echo "Start the disposable stack first: bash scripts/live-stack-start.sh" >&2
  exit 1
fi
if [[ "$(cat "$MARKER")" != "horseinsurance-fix5-live-stack" ]]; then
  echo "LOCAL_STAGING_STACK_MARKER_MISMATCH" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$STACK_ENV"
set +a

if [[ -z "${LIVE_SUPABASE_URL:-}" || -z "${LIVE_SUPABASE_ANON_KEY:-}" || -z "${LIVE_SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "LOCAL_STAGING_ENV_INCOMPLETE" >&2
  exit 1
fi

export NEXT_PUBLIC_SUPABASE_URL="$LIVE_SUPABASE_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$LIVE_SUPABASE_ANON_KEY"
export SUPABASE_URL="$LIVE_SUPABASE_URL"
export SUPABASE_SERVICE_ROLE_KEY="$LIVE_SUPABASE_SERVICE_ROLE_KEY"
export POLICY_ANALYZER_ENV=staging
export POLICY_ANALYZER_UPLOADS_ENABLED=true
export POLICY_RETENTION_DAYS="${POLICY_RETENTION_DAYS:-30}"
export POLICY_ANALYZER_WORKER_ID="${POLICY_ANALYZER_WORKER_ID:-local-staging-worker}"
unset POLICY_ANALYZER_STORE
unset NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY

if [[ -f "$WEB_PID_FILE" ]] && kill -0 "$(cat "$WEB_PID_FILE")" 2>/dev/null; then
  kill "$(cat "$WEB_PID_FILE")" 2>/dev/null || true
fi
if [[ -f "$WORKER_PID_FILE" ]] && kill -0 "$(cat "$WORKER_PID_FILE")" 2>/dev/null; then
  kill "$(cat "$WORKER_PID_FILE")" 2>/dev/null || true
fi

cd "$APP_DIR"
if [[ ! -d node_modules ]]; then
  npm ci
fi

npx next dev --turbopack -H 127.0.0.1 -p "$PORT" >/tmp/fix5-live-stack/m3-web.log 2>&1 &
echo $! >"$WEB_PID_FILE"
npx tsx worker/main.ts >/tmp/fix5-live-stack/m3-worker.log 2>&1 &
echo $! >"$WORKER_PID_FILE"

ready=0
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${PORT}/api/health/live" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "LOCAL_STAGING_WEB_NOT_READY" >&2
  exit 1
fi

echo "LOCAL_STAGING_READY"
echo "Open http://127.0.0.1:${PORT}/"
echo "Mint a loopback login with: node scripts/local-staging-session.mjs"
echo "Do not upload private customer policies to this disposable stack."
