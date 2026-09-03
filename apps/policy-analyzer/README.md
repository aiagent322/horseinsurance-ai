# HorseInsurance.ai Policy Analyzer

Upload one or more equine insurance PDFs and get a source-grounded, plain-English report of what the documents actually say.

This is the analyzer application under `apps/policy-analyzer/`. The root HorseInsurance.ai site remains the public education library. Uploaded policies are private to the signed-in account. Analysis URLs are random UUIDs and are not indexed.

Production persistence uses Supabase Postgres plus a private `policy-files` bucket. There is no local-filesystem fallback. Missing Supabase configuration fails closed.

## Run

Copy `.env.example` to `.env.local` and set the Supabase URL and publishable/anonymous key. Set `POLICY_RETENTION_DAYS` before production use.

```bash
cd apps/policy-analyzer
npm ci
npm test
npm run test:semantic
npm run test:completeness
npm run test:ingestion
npm run test:persistence
npm run test:security
npm run test:retention
npm run test:db-auth
npm run test:jobs
npm run test:db-live
npm run dev
```

Open http://127.0.0.1:43147/

`test:db-live` talks to a disposable loopback Postgres, Auth, PostgREST, and Storage stack. It never targets a shared or production project. From `apps/policy-analyzer`:

```bash
bash scripts/live-stack-start.sh
set -a && source /tmp/fix5-live-stack/env && set +a
npm run test:db-live
```

Remote destructive runs additionally require an exact `POLICY_ANALYZER_TEST_PROJECT_REF` match, `ALLOW_DESTRUCTIVE_SUPABASE_TESTS=YES`, and confirmation the project is empty of non-test data.

Sign in with a passwordless email link or one-time code. Then upload a policy package of up to 10 PDFs, or run the educational fixture as a stored analysis.

The educational fixture PDF at `/api/fixture` is public sample content with no customer data. Saving it as an analysis requires authentication and is disabled in production unless `ENABLE_FIXTURE_ANALYSIS=true`.

## Package limits

- Maximum 10 PDFs
- 20 MB per file
- 75 MB for the complete package
- Duplicate files (same SHA-256) are rejected
- Object storage paths are generated server-side from account, upload, and file IDs. Submitted filenames never become paths.

Native PDF text is used when it is good enough. Image-only or low-quality pages are sent to a local Tesseract OCR fallback (`tesseract.js` plus vendored `tessdata/eng.traineddata`). OCR does not call an external API. Unreadable pages are not treated as policy language.

## Privacy and retention

- Unauthenticated visitors cannot upload, read a report, download an original, or delete an analysis.
- Authenticated users can access only their own account’s records and objects.
- Unauthorized lookups return the same not-found response.
- User-facing operations use a user-scoped Supabase client so RLS stays active.
- Original PDFs are stored in a private bucket and streamed through authenticated routes.
- Production requires `POLICY_RETENTION_DAYS`. Expired analyses are hidden before physical purge.
- User-requested deletion is ownership-scoped and idempotent.
- `purgeExpiredAnalyses` is a server-side maintenance function for a later authorized scheduler. There is no public purge endpoint.

These controls are isolation and retention measures. They are not a claim of HIPAA, SOC 2, ISO, regulatory, or carrier compliance.

## Rules the analyzer follows

- The uploaded files are the authority.
- Missing facts are reported as **NOT FOUND IN DOCUMENTS PROVIDED**.
- Conflicts are shown, not resolved.
- Every dollar figure, exclusion, and notice requirement cites a page.
- A form listed on the declarations is not treated as uploaded unless matching form text is sourced separately.

## What this is not

No quoting, claims, CRM, payments, or Horse Genius. Status labels are not scores. Educational notes are labeled and do not add coverage.
