# HorseInsurance.ai — Coverage Checkup API Skeleton

**Status: SKELETON ONLY. Not functional. Not deployed. Not connected to anything.**

This `functions/` directory contains **non-functional Cloudflare Pages Functions
route stubs** for the Horse Insurance Coverage Checkup™ `/api/*` proxy layer,
created per `internal/specs/20-api-proxy-skeleton-plan.md`.

## What this is

- File-based Cloudflare Pages Functions routing (`functions/api/**`), matching
  the standard Cloudflare Pages convention — no existing route convention was
  found in this repo prior to this skeleton, so this is the minimal
  conventional structure.
- Every route returns a safe, fixed placeholder JSON response — either a
  `501 Not Implemented` envelope, or a `401 unauthenticated` / `403 forbidden`
  placeholder from the shared guard stubs.
- Every route that should require a session, ownership check, or reviewer/
  admin role has a `TODO` comment marking exactly where that real check
  belongs (specs 12, 20 §5/§6).

## What this is NOT

- **Not connected to Supabase or any database.** No table is read or written.
- **Not connected to any auth provider.** `requireSession()` always reports
  "no session" — this is a deliberate fail-closed default (spec 12 §17), not
  a bug.
- **Not connected to object storage.** No file is accepted, stored, or
  returned. No route in this skeleton processes a real policy file.
- **Not deployed.** These files exist locally in the repo only.
- **Not a service-role integration.** No route uses or references a Supabase
  service-role key. If/when a service-role pattern is introduced, it must
  remain server-side only, scoped to its intended operational purpose (spec
  19 §12, spec 20 §14), and is explicitly **not implemented** anywhere in
  this skeleton.

## Structure

```
functions/api/
  _lib/
    responses.js      Shared success/error/501 response envelope helpers
    guards.js          Shared session/ownership/role guard PLACEHOLDERS (TODO)
  health.js                                GET   /api/health
  session.js                               GET   /api/session
  uploads/
    init.js                                POST  /api/uploads/init
    [upload_id]/files.js                   POST  /api/uploads/:upload_id/files
  analyses/
    index.js                               POST  /api/analyses
    [analysis_id]/status.js                GET   /api/analyses/:analysis_id/status
    [analysis_id]/report.js                GET   /api/analyses/:analysis_id/report
    [analysis_id]/answers.js               POST  /api/analyses/:analysis_id/answers
  review/
    queue.js                               GET   /api/review/queue
    items/[item_id].js                     PATCH /api/review/items/:item_id
  audit-events.js                          POST  /api/audit-events
```

## Governing documents

- `internal/specs/20-api-proxy-skeleton-plan.md` — the plan this skeleton implements
- `internal/specs/12-auth-account-isolation-spec.md` — identity/ownership model
- `internal/specs/10-runtime-orchestration-spec.md` — pipeline order these routes will eventually trigger
- `internal/specs/19-supabase-apply-runbook.md` — current gate status (nothing applied/connected yet)

## Next steps (each separately gated — not authorized by this skeleton)

- Confirm Supabase project (spec 19 §4)
- Apply Phase 1 migrations (spec 19 §6)
- Connect an auth provider and implement `requireSession()` for real (spec 12)
- Implement `requireOwnership()` / `requireReviewerRole()` for real (spec 12 §6/§13)
- Create private storage buckets (spec 19 §10/§11)
- Replace each route's `notImplemented(...)` placeholder with real logic, one route at a time
