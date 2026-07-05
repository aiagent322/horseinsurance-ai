# Horse Insurance Coverage Checkup™
## API Proxy Skeleton Plan — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — API Planning (pre-route-code)
**Scope:** A **planning document** for the `/api/*` proxy layer — the Cloudflare Pages Functions / Worker boundary that will sit between the static frontend and Supabase. Describes proposed routes, responsibilities, auth/ownership requirements, and standards in prose. Creates no route file, no Function, no Worker, no Supabase connection, no auth config, no secret, no deployment. Every implementation action is separately gated (§18).

---

## 1. Purpose

Spec 11 named the orchestration API as the sole credentialed layer between the static frontend and persistence/model access; spec 14 §6 named "API orchestration skeleton" as Phase 2 of the build, second only to the persistence schema. Neither document specifies the concrete `/api/*` route surface, request/response contract, or per-route ownership enforcement that a builder would need to start writing route code. This document is that specification, at the planning level — it exists so the Phase 2 skeleton can be reviewed and approved before a single route file is written, exactly as specs 16–19 did for the persistence layer before any SQL existed.

This document describes intent only. It writes no Cloudflare Pages Function, no Worker script, no Supabase client call, and no auth wiring. The line it does not cross: **no route file, no Function, no Worker, no Supabase connection, no auth config, no secret, no deployment** (§18). It is a plan a reviewer approves before route code exists.

**Governing constraint:** producing this plan starts no backend, frontend, Supabase, auth, storage, or deployment work (spec 15 §8, spec 17 §16/§17, spec 18 §19/§20, spec 19 §15). Each such action remains its own approval gate.

---

## 2. Source Documents

| Document | Contribution |
|---|---|
| **10 — Runtime Orchestration** | The fixed seven-stage pipeline order (extract → classify → model → score/route → generate → verify → report/display), the nine blocking gates, and the requirement that verification is the final display gate regardless of upstream confidence |
| **11 — Backend & Infrastructure** | The frontend/API boundary (static frontend holds no secrets, API is the sole credentialed layer), file storage model, model invocation architecture |
| **12 — Auth, Account & Isolation** | Identity model (`user_id`/`account_id`/`user_role`), session validation, default-deny access control, per-user isolation, role-limited reviewer/admin access |
| **14 — Implementation Sequencing Plan** | Phase 2 ("API Orchestration Skeleton") scope and its dependency on Phase 1 and the auth-provider decision |
| **16 — Phase 1 Persistence Schema Model** | The object/table shapes this API surface will eventually read/write (uploads, policy_analyses, coverage/clause/exclusion objects, reports, review queue, audit events) |
| **18 — Phase 1 RLS Policy Plan** | The row-level access rules the API's Supabase calls will run under — owner-match, reviewer-scoped, no public, bounded service role |
| **19 — Supabase Apply Runbook** | Current gate status: schema and RLS migrations exist but are unapplied; no project confirmed; no auth connected; no buckets created — this plan assumes that state and builds no route that requires it to be otherwise |

No requirement outside these documents is introduced.

---

## 3. API Boundary

- The `/api/*` surface is the **only** path between the static frontend (Cloudflare Pages) and persistence (Supabase) or the model endpoint (Anthropic API) — consistent with spec 11 §3.
- The frontend never holds a Supabase service-role key, never calls Supabase directly, and never calls the model endpoint directly. Every data or model interaction is mediated by an `/api/*` route.
- The boundary is request/response over HTTPS, carrying a session token; the frontend receives only finished, verified payloads (report content, status handles) — never raw extracted text, another user's data, or intermediate pipeline state (spec 11 §3).
- This boundary is unchanged by this plan — it is restated here because every route proposed in §7 exists specifically to preserve it.

---

## 4. Runtime Assumptions

- Routes are implemented as **Cloudflare Pages Functions** (or an equivalent Worker), matching the network's standard static-frontend-plus-Worker pattern already used elsewhere in the portfolio.
- Routes are **stateless per invocation** — per-analysis pipeline state (current stage, per-statement status) lives in the database, not in Function/Worker memory, so a single request does not need to hold the entire spec 10 pipeline open (spec 11 §9).
- Long-running work (extraction/OCR on large scanned policies, per-statement generation/verification) is invoked asynchronously; a route returns a processing-status handle rather than blocking until the full spec 10 pipeline completes (spec 06 §3 "Analysis started").
- This plan assumes the **current gate state from spec 19 §2**: no Supabase project confirmed, no migrations applied, no auth connected, no buckets created. Nothing proposed here requires that state to be otherwise yet — the routes are designed against the planned schema (spec 16) and planned RLS (spec 18), to be wired once those gates clear.

---

## 5. Auth / Session Requirements

- Every route that touches user-owned data requires a **validated session identity** (spec 12 §5) — `user_id`, `account_id`, `user_role` resolved server-side from the session token, never trusted from the request body or URL.
- **No unauthenticated production upload is allowed.** A request with no resolvable session identity is rejected before it reaches any upload, analysis, or report route (spec 12 §6).
- Session validation happens **once per request, at the API layer** — the same enforcement point for every route, not re-implemented per route.
- An expired or invalid session is treated as unauthenticated (spec 12 §5): denied, not defaulted to a guest/demo identity.

---

## 6. Ownership Enforcement

- Every route that reads or writes user-owned data must enforce **`user_id`/`account_id` ownership server-side** (spec 12 §6/§7) — a query for an artifact is always filtered by the requester's validated identity, never by a client-supplied identifier.
- **Default deny**: absence of a positive ownership match is a denial, never a pass (spec 12 §6/§17) — this applies at the API layer in addition to the database's own RLS backstop (spec 18 §3).
- **Reviewer routes require the `reviewer` or `admin` role** (spec 12 §4/§13) on the validated session — a plain `owner` session must never satisfy a reviewer-scoped route, and reviewer/admin access is itself scoped to routed/assigned items only, never a blanket read.
- Ownership checks happen **before** any Supabase call is made on the user's behalf, not after — a route must not fetch data and then decide whether to return it; it must not fetch it at all if ownership doesn't resolve.

---

## 7. Proposed API Routes

| Route | Purpose |
|---|---|
| `GET /api/health` | Health/status check — service liveness, no user data involved |
| `GET /api/session` | Authenticated session check — confirms a valid session and returns the caller's identity/role |
| `POST /api/uploads/init` | Upload initialization — creates an `upload_id`/`analysis_id` for a new document set |
| `POST /api/uploads/:upload_id/files` | Private upload file registration — records a file's private storage reference against the upload |
| `POST /api/analyses` | Analysis creation — triggers the spec 10 pipeline for a completed upload |
| `GET /api/analyses/:analysis_id/status` | Analysis status — reports current pipeline stage/progress for the caller's own analysis |
| `GET /api/analyses/:analysis_id/report` | Report retrieval — returns the assembled, verified report (spec 05) for the caller's own analysis |
| `POST /api/analyses/:analysis_id/answers` | Answer request — asks a direct consumer question against a completed analysis (spec 04) |
| `GET /api/review/queue` | Review queue listing — reviewer/admin-only list of routed items |
| `PATCH /api/review/items/:item_id` | Review item update — reviewer/admin-only decision on a routed item (spec 13) |
| `POST /api/audit-events` | Audit event creation — internal-only write path for pipeline/reviewer audit records (spec 10 §13, spec 11 §8) |

This list is the proposed MVP surface. Additional routes (e.g., deletion/export per spec 12 §14) are out of scope for this plan and would be sequenced separately.

---

## 8. Route-by-Route Responsibilities

- **`GET /api/health`** — No auth required. Returns service status only; touches no user data, no database row.
- **`GET /api/session`** — Requires a session token; validates it and returns the resolved `user_id`/`account_id`/`user_role`, or an unauthenticated response. No ownership check beyond validating the session itself.
- **`POST /api/uploads/init`** — Requires authenticated session. Creates an `upload_id` owned by the caller's `user_id`/`account_id` (spec 12 §8); owner is set from the session, never from the request body.
- **`POST /api/uploads/:upload_id/files`** — Requires authenticated session and ownership of `:upload_id`. Registers a private-storage reference for an uploaded file; never accepts or returns a public URL (spec 11 §5, spec 18 §17).
- **`POST /api/analyses`** — Requires authenticated session and ownership of the underlying upload. Triggers the spec 10 pipeline asynchronously; returns a processing-status handle, not a blocking result.
- **`GET /api/analyses/:analysis_id/status`** — Requires authenticated session and ownership of `:analysis_id`. Returns current stage/progress only — no raw extracted text, no other user's data.
- **`GET /api/analyses/:analysis_id/report`** — Requires authenticated session and ownership of `:analysis_id`. Returns only statements that passed spec 09 verification (spec 10 §5) — never a blocked or unverified statement.
- **`POST /api/analyses/:analysis_id/answers`** — Requires authenticated session and ownership of `:analysis_id`. Runs a single question through generate→verify (spec 10 §7) and returns the resulting answer object (spec 04 §16) or a refusal per spec 04 §15.
- **`GET /api/review/queue`** — Requires `reviewer`/`admin` role. Returns only items routed/assigned to review (spec 13 §12) — never a general content listing.
- **`PATCH /api/review/items/:item_id`** — Requires `reviewer`/`admin` role and assignment/scope over `:item_id`. Records a review decision; every access and change audited (spec 13 §12, spec 18 §16).
- **`POST /api/audit-events`** — Internal-only, called by the orchestration layer itself (not directly by the frontend) to write audit records (spec 10 §13). Contains object IDs, labels, and reasons — never policy text (spec 11 §8, spec 17 §15.6).

---

## 9. Request Validation

- Every route validates its inputs **server-side**, regardless of any client-side validation the frontend performs (spec 11 §4 treats frontend checks as advisory only).
- File-related routes enforce accepted types and size/count limits per spec 06 §2/§3, returning the spec 06 §3 messages on rejection.
- Route inputs are validated for shape and type before any database call is attempted — a malformed request is rejected before it reaches Supabase, not caught by a downstream database error.
- No route trusts a client-supplied `user_id`, `account_id`, or `upload_id`/`analysis_id` ownership claim without independently verifying it against the validated session (spec 12 §5) and the database's own ownership columns.

---

## 10. Response Shape Standards

- Every response uses a consistent envelope: a success/error indicator, a data payload (where applicable), and — on error — a machine-readable error code plus a consumer-safe message (see §11).
- Report and answer payloads follow the structures already fixed by specs 04 §16 and 05 — this API plan does not redefine those shapes, only how they are delivered.
- Status-check responses (`/api/analyses/:analysis_id/status`) return a small, fixed set of stage/progress values, not free-form text, so the frontend can render consistent processing messages (spec 06 §3).
- No response ever includes another user's data, raw extracted policy text outside a verified report context, or a public/durable file URL (spec 11 §5, spec 18 §17).

---

## 11. Error Handling

- Authentication failures return a distinct, consistent error class (e.g., "unauthenticated") without leaking whether a given resource exists for another user — ownership mismatches and "not found" should be indistinguishable to the caller, so a route never confirms the existence of data it won't return (spec 12 §6/§7 default-deny principle applied to error responses).
- Validation failures return a specific, non-technical error message aligned with spec 06 §3 messaging conventions (calm, plain-language, non-alarming).
- Downstream failures (e.g., Supabase unavailable, model endpoint failure) return a generic "processing failed, please try again" style message to the frontend — internal error detail is logged server-side, never surfaced to the consumer verbatim.
- No error message ever includes policy text, another user's identifiers, or internal implementation detail (stack traces, table names, query text).

---

## 12. Audit Event Requirements

- Every stage transition and every reviewer/admin action is written to the audit trail via the internal audit-event path (spec 10 §13, spec 11 §8), carrying object IDs, stage/decision labels, and reasons — **never policy text** (spec 17 §15.6).
- Audit writes happen from the orchestration layer itself, not from the frontend — the frontend has no route that writes directly to `audit_events`.
- Blocked and review-routed statements are audited with the same rigor as displayed ones (spec 10 §13) — the audit trail must be able to reconstruct any answer's full path.
- Audit reads are internal-only (spec 12 §11, spec 18 §15) — no proposed route in §7 exposes audit-event contents to a consumer.

---

## 13. Supabase Access Pattern

- All Supabase access happens from the API layer only — the frontend never holds a Supabase key of any kind (spec 11 §3).
- The API queries Supabase using the **validated session identity** to scope every query (spec 12 §7) — isolation is enforced at retrieval, with Supabase's RLS (spec 18) as the database-level backstop, not the only line of defense.
- File content lives in private object storage, referenced by opaque keys in the database; the API mediates access via short-lived, user-scoped signed URLs — never a durable public link (spec 11 §5, spec 18 §17).
- This plan assumes the schema (spec 16) and RLS policies (spec 18) as designed, but **does not assume they are applied yet** — per spec 19 §2, both migrations remain unapplied as of this writing, and no route in this plan is executable until they are, auth is connected, and buckets exist.

---

## 14. Service Role Restrictions

- **A Supabase service-role key, if ever used, must remain server-side only** — never in frontend code, never in the public repository, never client-exposed in any response (spec 19 §12).
- Service-role access, where used, is **bounded to its intended operational scope** (spec 18 §13/§19 verification requirement) — it is not a blanket bypass of RLS used casually by every route; ordinary user-facing routes operate under the caller's own scoped identity wherever possible.
- Any route design that would rely on service-role access to skip ownership checks is out of scope for this plan and would require its own explicit review.

---

## 15. Environment Variable Requirements

The following environment variables/secrets will eventually be required by this API layer (naming only — none are created by this plan):

- Supabase project URL
- Supabase service-role key (server-side only)
- Supabase anon/public key, if used, scoped only to what RLS explicitly allows
- Auth provider session-validation configuration values
- Signed-URL / storage access configuration values

Per spec 19 §12 and §15 below, **no environment variable or secret is added by this plan** — this section only names what a future, separately-gated step will need to configure.

---

## 16. Local Development Requirements

- Local development against this API skeleton should be possible without touching a live/production Supabase project — e.g., against a local or staging Supabase instance, per the staging-first recommendation in spec 19 §4.
- Route code should be structured so that swapping the target Supabase project (staging vs. production) is a configuration change, not a code change — consistent with keeping secrets out of code (§15).
- No local development step in this plan requires production credentials, and this plan does not itself set up any local environment — that remains build work, gated per §18.

---

## 17. Do-Not-Build-Yet Items

This plan does **not** authorize:

- Creating any backend route file
- Creating any Cloudflare Pages Function
- Creating any Worker
- Connecting to Supabase
- Configuring auth
- Adding any environment variable or secret
- Building frontend UI
- Building extraction, generation, verification, report, or reviewer logic
- Deploying anything

Writing and reviewing this plan is a planning action only.

---

## 18. Approval Required Before Route Code

Each of the following requires **explicit approval from Rex before the action**, independent of this plan's existence:

- Creating the first route file or Function
- Confirming the Supabase project/provider (spec 19 §4)
- Applying either Phase 1 migration (spec 19 §6)
- Connecting auth (spec 19 §7)
- Creating storage buckets (spec 19 §10)
- Adding any environment variable or secret (spec 19 §12)
- Deploying anything
- Staging, committing, or pushing this document or any resulting route code

Gates are independent; approving one does not approve another.

---

## 19. Out-of-Scope

This plan does **not**:

- Modify specs 01–19 or any SQL migration.
- Write any route code, Function, or Worker script.
- Connect to Supabase, configure auth, create buckets, or add secrets.
- Build frontend UI, or extraction/generation/verification/report/reviewer logic.
- Deploy anything.
- Stage, commit, or push anything without separate explicit approval.
- Introduce new product requirements — it sequences and structures only what specs 10, 11, 12, 14, 16, 18, and 19 already define.

---

*End of v1.0 API Proxy Skeleton Plan. Proposes the `/api/*` route surface, per-route responsibilities, auth/ownership enforcement, request/response standards, error handling, audit requirements, and Supabase access pattern for the Phase 2 orchestration skeleton (spec 14 §6). It creates no route, Function, Worker, Supabase connection, auth config, secret, or deployment; every implementation action remains separately gated.*
