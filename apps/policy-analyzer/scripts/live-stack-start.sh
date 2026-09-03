#!/usr/bin/env bash
# Start a disposable loopback Supabase-compatible stack for live Fix #5/#6 tests.
# Uses host networking because container-to-container bridging is blocked here.
# Secrets stay in /tmp/fix5-live-stack and are never echoed.
set -euo pipefail

STACK_DIR=/tmp/fix5-live-stack
mkdir -p "$STACK_DIR/storage"
chmod 700 "$STACK_DIR"

JWT_SECRET_FILE="$STACK_DIR/jwt-secret"
ENV_FILE="$STACK_DIR/env"
GATEWAY_LOG="$STACK_DIR/gateway.log"
PG_NAME=fix5-pg
REST_NAME=fix5-rest
AUTH_NAME=fix5-auth
STORAGE_NAME=fix5-storage
PG_IMAGE=public.ecr.aws/supabase/postgres:17.6.1.165
REST_IMAGE=public.ecr.aws/supabase/postgrest:v16.1
AUTH_IMAGE=public.ecr.aws/supabase/gotrue:v2.196.0
STORAGE_IMAGE=public.ecr.aws/supabase/storage-api:v1.70.3
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

docker rm -f "$PG_NAME" "$REST_NAME" "$AUTH_NAME" "$STORAGE_NAME" >/dev/null 2>&1 || true
if [[ -f "$STACK_DIR/gateway.pid" ]] && kill -0 "$(cat "$STACK_DIR/gateway.pid")" 2>/dev/null; then
  kill "$(cat "$STACK_DIR/gateway.pid")" 2>/dev/null || true
fi

if [[ ! -f "$JWT_SECRET_FILE" ]]; then
  python3 - <<'PY' >"$JWT_SECRET_FILE"
import secrets
print(secrets.token_urlsafe(48), end="")
PY
  chmod 600 "$JWT_SECRET_FILE"
fi

python3 - <<'PY'
import json, hmac, hashlib, base64, time, os, pathlib
secret = pathlib.Path("/tmp/fix5-live-stack/jwt-secret").read_text().strip()
def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()
def sign(payload: dict) -> str:
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = b64url(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
    return f"{header}.{body}.{b64url(sig)}"
now = int(time.time())
exp = now + 60 * 60 * 24 * 365
anon = sign({"role": "anon", "iss": "supabase-local", "iat": now, "exp": exp})
service = sign({"role": "service_role", "iss": "supabase-local", "iat": now, "exp": exp})
env = pathlib.Path("/tmp/fix5-live-stack/env")
env.write_text(
    "\n".join(
        [
            f"LIVE_SUPABASE_URL=http://127.0.0.1:54321",
            f"LIVE_SUPABASE_ANON_KEY={anon}",
            f"LIVE_SUPABASE_SERVICE_ROLE_KEY={service}",
            f"POLICY_ANALYZER_LIVE_SKIP_RESET=YES",
            f"POLICY_ANALYZER_LIVE_STACK_MARKER=horseinsurance-fix5-live-stack",
            f"LIVE_POSTGREST_URL=http://127.0.0.1:3000",
            f"LIVE_AUTH_URL=http://127.0.0.1:9999",
            f"LIVE_STORAGE_URL=http://127.0.0.1:54321/storage/v1",
            f"GOTRUE_JWT_SECRET={secret}",
        ]
    )
    + "\n"
)
os.chmod(env, 0o600)
PY

# shellcheck disable=SC1090
source "$ENV_FILE"
JWT_SECRET=$(cat "$JWT_SECRET_FILE")

docker run -d --name "$PG_NAME" --network host \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  "$PG_IMAGE" >/dev/null

for i in $(seq 1 60); do
  if docker exec "$PG_NAME" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$PG_NAME" pg_isready -U postgres >/dev/null

docker exec -i "$PG_NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
alter user authenticator with password 'postgres' login;
alter user supabase_auth_admin with password 'postgres' login;
alter user supabase_storage_admin with password 'postgres' login;
alter user postgres with password 'postgres' login;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
SQL

for f in \
  "$ROOT/supabase/migrations/20260705022540_phase_1_persistence_schema.sql" \
  "$ROOT/supabase/migrations/20260705145522_phase_1_rls_policies.sql" \
  "$ROOT/supabase/migrations/20260903024500_analyzer_auth_persistence.sql" \
  "$ROOT/supabase/migrations/20260903150000_durable_analysis_jobs.sql" \
  "$ROOT/supabase/migrations/20260903200000_worker_completion_outcomes.sql"
do
  docker exec -i "$PG_NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <"$f" >/dev/null
done

docker run -d --name "$REST_NAME" --network host \
  -e PGRST_DB_URI="postgres://authenticator:postgres@127.0.0.1:5432/postgres" \
  -e PGRST_DB_SCHEMAS="public,storage,graphql_public" \
  -e PGRST_DB_ANON_ROLE="anon" \
  -e PGRST_DB_EXTRA_SEARCH_PATH="public,extensions" \
  -e PGRST_JWT_SECRET="$JWT_SECRET" \
  -e PGRST_DB_MAX_ROWS="1000" \
  -e PGRST_SERVER_PORT="3000" \
  "$REST_IMAGE" >/dev/null

docker run -d --name "$AUTH_NAME" --network host \
  -e GOTRUE_API_HOST="0.0.0.0" \
  -e GOTRUE_API_PORT="9999" \
  -e API_EXTERNAL_URL="http://127.0.0.1:54321" \
  -e GOTRUE_DB_DRIVER="postgres" \
  -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:postgres@127.0.0.1:5432/postgres" \
  -e GOTRUE_SITE_URL="http://127.0.0.1:43147" \
  -e GOTRUE_URI_ALLOW_LIST="http://127.0.0.1:43147" \
  -e GOTRUE_DISABLE_SIGNUP="false" \
  -e GOTRUE_JWT_SECRET="$JWT_SECRET" \
  -e GOTRUE_JWT_EXP="3600" \
  -e GOTRUE_JWT_AUD="authenticated" \
  -e GOTRUE_JWT_ADMIN_ROLES="service_role" \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME="authenticated" \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED="true" \
  -e GOTRUE_MAILER_AUTOCONFIRM="true" \
  -e GOTRUE_SMTP_MAX_FREQUENCY="1s" \
  "$AUTH_IMAGE" >/dev/null

docker run -d --name "$STORAGE_NAME" --network host \
  -e ANON_KEY="$LIVE_SUPABASE_ANON_KEY" \
  -e SERVICE_KEY="$LIVE_SUPABASE_SERVICE_ROLE_KEY" \
  -e POSTGREST_URL="http://127.0.0.1:3000" \
  -e PGRST_JWT_SECRET="$JWT_SECRET" \
  -e DATABASE_URL="postgres://supabase_storage_admin:postgres@127.0.0.1:5432/postgres" \
  -e FILE_STORAGE_BACKEND_PATH="/tmp/storage" \
  -e STORAGE_BACKEND="file" \
  -e TENANT_ID="stub" \
  -e REGION="local" \
  -e GLOBAL_S3_BUCKET="stub" \
  -e REQUEST_ALLOW_X_FORWARDED_PATH="true" \
  "$STORAGE_IMAGE" >/dev/null

cd "$ROOT/apps/policy-analyzer"
nohup node scripts/live-stack-gateway.mjs >"$GATEWAY_LOG" 2>&1 &
echo $! >"$STACK_DIR/gateway.pid"

auth_ready=0
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:54321/auth/v1/health" >/dev/null 2>&1; then
    auth_ready=1
    break
  fi
  sleep 1
done
if [[ "$auth_ready" -ne 1 ]]; then
  echo "LIVE_STACK_AUTH_NOT_READY" >&2
  exit 1
fi

storage_ready=0
for i in $(seq 1 90); do
  if docker exec "$PG_NAME" psql -U postgres -d postgres -tAc "select to_regclass('storage.buckets')" 2>/dev/null | grep -q buckets; then
    storage_ready=1
    break
  fi
  sleep 1
done
if [[ "$storage_ready" -ne 1 ]]; then
  echo "LIVE_STACK_STORAGE_NOT_READY" >&2
  exit 1
fi

docker exec -i "$PG_NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('policy-files', 'policy-files', false, 20971520, array['application/pdf']::text[])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists policy_files_select_own on storage.objects;
drop policy if exists policy_files_insert_own on storage.objects;
drop policy if exists policy_files_update_own on storage.objects;
drop policy if exists policy_files_delete_own on storage.objects;
create policy policy_files_select_own on storage.objects
  for select using (
    bucket_id = 'policy-files'
    and auth.uid() is not null
    and public.app_is_account_member((split_part(name, '/', 1))::uuid)
  );
create policy policy_files_insert_own on storage.objects
  for insert with check (
    bucket_id = 'policy-files'
    and auth.uid() is not null
    and public.app_is_account_member((split_part(name, '/', 1))::uuid)
  );
create policy policy_files_update_own on storage.objects
  for update using (
    bucket_id = 'policy-files'
    and public.app_is_account_member((split_part(name, '/', 1))::uuid)
  ) with check (
    bucket_id = 'policy-files'
    and public.app_is_account_member((split_part(name, '/', 1))::uuid)
  );
create policy policy_files_delete_own on storage.objects
  for delete using (
    bucket_id = 'policy-files'
    and public.app_is_account_member((split_part(name, '/', 1))::uuid)
  );
insert into analyzer_runtime_config (config_key, config_value)
values ('disposable_test_stack', 'horseinsurance-fix5-live-stack')
on conflict (config_key) do update set config_value = excluded.config_value, updated_at = now();
notify pgrst, 'reload schema';
SQL
printf '%s\n' 'horseinsurance-fix5-live-stack' >"$STACK_DIR/DISPOSABLE_MARKER"
chmod 600 "$STACK_DIR/DISPOSABLE_MARKER"
echo "LIVE_STACK_READY"
