# Hosted staging (Milestone 4)

Local disposable staging (Milestone 3) remains the loopback stack. Hosted staging is a **separate** isolated Supabase project plus a dedicated web process and worker. It is not production.

```text
Hosted staging web  ──┐
                      ├── isolated staging Supabase
Dedicated worker    ──┘     Postgres · Auth · private policy-files
```

## Isolation

Provision a new Supabase project that is not the production project and not the disposable loopback stack.

Required, stored only in the host secret store:

| Role | Values |
| --- | --- |
| Browser | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `POLICY_ANALYZER_ENV=staging` |
| Web server | `SUPABASE_SERVICE_ROLE_KEY` (never `NEXT_PUBLIC_*`), `POLICY_RETENTION_DAYS`, `POLICY_ANALYZER_OPS_TOKEN`, `POLICY_ANALYZER_UPLOADS_ENABLED=false` until readiness |
| Worker | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `POLICY_ANALYZER_WORKER_ID`, `POLICY_ANALYZER_PROCESS=worker` |
| Migrate | `POLICY_ANALYZER_ALLOW_STAGING_MIGRATIONS=YES`, exact `POLICY_ANALYZER_STAGING_PROJECT_REF` / `POLICY_ANALYZER_STAGING_DB_HOSTS` |

Forbidden in this environment:

- Production project URL, ref, keys, or deploy tokens
- `POLICY_ANALYZER_ALLOW_PRODUCTION_MIGRATIONS=YES`
- Memory store
- Loopback password helper (it activates only when the public Auth URL host is `127.0.0.1`, `localhost`, or `::1`)

## Migration gate

```bash
# Dry-run identity check. Prints hostname and reason only.
POLICY_ANALYZER_ENV=staging \
POLICY_ANALYZER_ALLOW_STAGING_MIGRATIONS=YES \
POLICY_ANALYZER_STAGING_PROJECT_REF=<20-char-staging-ref> \
POLICY_ANALYZER_STAGING_DB_HOSTS=db.<ref>.supabase.co \
POLICY_ANALYZER_MIGRATE_DATABASE_URL=<staging-db-url> \
npx tsx scripts/hosted-staging-preflight.ts
```

If the target is missing, loopback, production, or ambiguous, the command prints `HOSTED_STAGING_TARGET_REFUSED:<reason>` and `STOP — DO NOT MIGRATE`.

Apply only after that command succeeds:

```bash
POLICY_ANALYZER_MIGRATE_APPLY=YES \
npx tsx scripts/hosted-migrate.ts
```

The apply script uses the same gate. It never prints the database URL.

## After migration

1. Confirm `policy-files` is private.
2. Confirm email Auth redirect allow-list is the staging web origin only.
3. Run `npm run test:db-live` only after pointing live-test env at the **staging** project and proving the gate. Do not point it at production.
4. Start web and worker from the same image (`deploy/STAGING.md`).
5. Keep uploads off until `/api/ops/ready` passes with the ops token.
6. Then set `POLICY_ANALYZER_UPLOADS_ENABLED=true` on staging only.
7. Sign in with hosted email (not the loopback password helper).
8. Upload a synthetic educational PDF. Confirm queued → worker → bound report and that a second user cannot read it.

## Real-policy validation

After the hosted happy path works, use `validation/real-policies/` — not `quality/`. See `validation/real-policies/FIRST-TEST-SET.md`.

## Rollback

Same image rollback as `deploy/backup-rollback.md`. Leave additive migrations in place. Disable uploads until readiness passes on the rolled-back pair.
