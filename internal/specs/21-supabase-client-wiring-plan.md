# Horse Insurance Coverage Checkup™
## Supabase Client Wiring Plan — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Client Wiring Planning (pre-implementation)
**Scope:** A **planning document** for how the `/api/*` proxy skeleton (spec 20, `functions/api/*`) will eventually initialize and use Supabase clients. Describes client types, usage rules, and flows in prose. Creates no Supabase client code, no package install, no environment variable, no secret, no connection, no auth config. Every implementation action is separately gated (§18).

---

## 1. Purpose

Spec 20 planned the `/api/*` route surface and its guard placeholders (`requireSession`, `requireOwnership`, `requireReviewerRole` — currently fail-closed stubs in `functions/api/_lib/guards.js`); the pushed skeleton (`functions/api/*`) implements those routes as non-functional stubs with `TODO(auth)`, `TODO(ownership)`, and `TODO(role)` markers. Neither document nor the skeleton itself specifies **how** those TODOs get filled in — which Supabase client to use where, how a session resolves to `user_id`/`account_id`/`user_role`, or how ownership/role checks translate into an actual Supabase call under the spec 18 RLS policies.

This document is that specification, at the planning level. It exists so the client-wiring work can be reviewed and approved before any Supabase client is instantiated in code — the same planning-before-code discipline specs 16–20 already established for schema, RLS, and routes.

This document describes intent only. It writes no `createClient(...)` call, no `import` of a Supabase package, no `.env` file, and no auth wiring. The line it does not cross: **no Supabase client code, no package install, no environment variable, no secret, no connection, no auth config** (§17, §18). It is a plan a reviewer approves before wiring begins.

**Governing constraint:** producing this plan starts no Supabase, auth, backend, frontend, or deployment work (spec 15 §8, spec 17 §16/§17, spec 18 §19/§20, spec 19 §15, spec 20 §17/§18). Each such action remains its own approval gate.

---

## 2. Source Documents

| Document | Contribution |
|---|---|
| **11 — Backend & Infrastructure** | Frontend/API boundary (API is the sole credentialed layer), model invocation architecture, file storage model |
| **12 — Auth, Account & Isolation** | Identity model (`user_id`/`account_id`/`user_role`), session validation, default-deny access control, role-limited reviewer/admin access |
| **18 — Phase 1 RLS Policy Plan** | The row-level rules Supabase calls will run under — owner-match, reviewer-scoped, no public, bounded service role, `auth.uid()` assumption |
| **19 — Supabase Apply Runbook** | Current gate status: migrations unapplied, no project confirmed, no auth connected, no buckets created; environment/secret checklist and ordering |
| **20 — API Proxy Skeleton Plan** | The route surface, auth/session requirements, ownership enforcement, service-role restrictions this wiring plan fills in |
| **functions/README.md, functions/api/\*** | The actual pushed skeleton — its guard placeholders (`requireSession`, `requireOwnership`, `requireReviewerRole`) and their `TODO` markers, which this plan maps a real implementation onto |

No requirement outside these documents is introduced.

---

## 3. Current Gate Status

As of this writing, restated from spec 19 §2 and confirmed unchanged by the pushed skeleton:

- No Supabase project has been confirmed as a target.
- Neither Phase 1 migration (schema or RLS) has been applied.
- No auth provider is connected; `auth.uid()` is not yet a resolvable identity anywhere.
- No storage buckets exist.
- The `functions/api/_lib/guards.js` placeholders (`requireSession`, `requireOwnership`, `requireReviewerRole`) **always fail closed** — they deny by default because there is nothing to check against yet.

This plan does not change any of the above. It describes how those placeholders would be filled in once the gates in spec 19 and spec 20 §18 are cleared, in the order those documents already establish (project confirmation → migrations → auth connection → buckets → environment/secrets).

---

## 4. Runtime Environment Assumptions

- Supabase clients, when wired, run **only inside `functions/api/*` route handlers** (or shared helpers they call) — never in any static frontend asset (spec 11 §3, spec 20 §3).
- Cloudflare Pages Functions execute in a Workers-style runtime; a Supabase JS client used here must be compatible with that runtime (no Node-only APIs assumed). Confirming the specific client library/version is an implementation decision at wiring time, not fixed by this plan.
- Route handlers remain **stateless per invocation** (spec 20 §4) — a Supabase client is created per request (or via a lightweight per-request factory), not held as long-lived global state across invocations, consistent with the serverless execution model.
- This plan assumes the eventual identity provider is Supabase Auth (spec 15 §3 planning default, spec 18 §4), so `auth.uid()` is the expected session-identity primitive referenced throughout — but as spec 18 §4 already notes, if a different provider is chosen, only the identity-resolution function changes, not the ownership/RLS logic itself.

---

## 5. Supabase Client Types

Two distinct client types are anticipated, matching the two access classes spec 18 §5 already defines:

| Client type | Backing key | Used for |
|---|---|---|
| **Anon/public client, request-scoped** | `SUPABASE_ANON_KEY` | Operations performed *as the requesting user* — every user-owned route (uploads, analyses, reports, answers) — where Supabase's RLS (spec 18) is the actual access-control mechanism, not the app layer alone. |
| **Service-role client** | `SUPABASE_SERVICE_ROLE_KEY` | Narrow, specifically-justified server-side operations that must bypass RLS for a legitimate system reason (e.g., internal audit-event writes, scheduled purge jobs per spec 19) — never used as a general-purpose shortcut. |

No other client type is anticipated for MVP. A route defaults to the anon/public client unless a specific, documented reason requires the service-role client (§7).

---

## 6. Public Anon Client Rules

- The anon/public client is used for **authenticated-user-scoped operations only** — it is instantiated per request, carrying the caller's validated session token so that Supabase's RLS policies (spec 18) evaluate `auth.uid()` against the actual requester.
- RLS is the **actual enforcement mechanism** for this client — the app-layer ownership check (`requireOwnership`, spec 20 §6) is a first-line guard, and Supabase RLS is the database-level backstop (spec 18 §3), not the other way around. Both must independently deny access to a non-owner.
- The anon/public client must never be used to perform an operation the requesting user isn't independently authorized for via RLS — it is not a way to "get around" a route's own auth/ownership guard, it is the mechanism that makes the guard's decision actually matter at the data layer.
- Every user-owned route in the skeleton (`uploads/init`, `uploads/:upload_id/files`, `analyses`, `analyses/:analysis_id/status`, `analyses/:analysis_id/report`, `analyses/:analysis_id/answers`) is expected to use the anon/public client, scoped to the session, once wired.

---

## 7. Service Role Client Rules

- The service-role client **bypasses RLS** and must therefore be used only for narrowly-scoped, specifically justified server-side maintenance/system operations — not as a convenience for routes that don't want to deal with RLS.
- **The service-role key must never be exposed to frontend code, never appear in a client-side bundle, never appear in a response body, and never be logged** (spec 19 §12, spec 20 §14).
- Anticipated legitimate uses, per the existing skeleton and specs, are narrow:
  - The internal `POST /api/audit-events` path (spec 20 §12), since audit writes are system-initiated, not user-initiated, and audit records intentionally sit outside normal per-user RLS read access (spec 18 §15).
  - Future retention/purge jobs (spec 19 §14, spec 17 §15.6), which are system-scheduled, not user-triggered.
- **No user-owned route (uploads, analyses, reports, answers) is expected to use the service-role client.** If a future implementation finds it needs the service-role client on a user-facing route, that is a signal to re-examine the RLS policy for that table (spec 18) rather than reach for a bypass.
- Service-role client instantiation, wherever it happens, must remain server-side only — inside a `functions/api/*` handler, never in any file shipped to the browser (spec 11 §3, spec 20 §3/§14).

---

## 8. Session Validation Flow

Once wired, the intended flow for `requireSession()` (currently a fail-closed stub in `functions/api/_lib/guards.js`) is:

1. Extract the session token from the incoming request (cookie or `Authorization` header, per the eventual auth provider's convention).
2. Validate the token against the auth provider — under the Supabase Auth planning default, this resolves to a call that confirms `auth.uid()` for a valid, non-expired session.
3. On success, return the resolved session identity (`user_id`, plus enough information to resolve `account_id`/`user_role` per §9) to the calling route.
4. On any failure — missing token, expired token, invalid token — return the existing `unauthenticated()` response (spec 20 §5, already implemented in `functions/api/_lib/responses.js`). An invalid session is never treated as a valid one, and there is no guest/demo fallback identity (spec 12 §5).

This flow does not change the shape of `requireSession()`'s return value already used by every route (`{ ok, session, response }`) — wiring fills in the implementation, it does not change the contract the routes already call.

---

## 9. User / Account Resolution Flow

- `user_id` comes directly from the validated session (`auth.uid()` under the Supabase Auth assumption) — it is never accepted from the request body or URL (spec 12 §5, spec 20 §6, already stated in the skeleton's `TODO(ownership)` comments).
- `account_id` and `user_role` are resolved server-side from the `account_members` table (per spec 16 §4, spec 18 §4) — a lookup keyed by the validated `user_id`, not supplied by the client.
- This resolution happens **once per request**, immediately after session validation succeeds, and the resolved `{ user_id, account_id, user_role }` triple is what every subsequent ownership/role check in that request uses — a route does not re-resolve account/role separately for each check.
- MVP is 1 user : 1 account (spec 12 §4, spec 16 §4), so this resolution is expected to be simple for now, but the lookup step is not skipped even in that simple case — it keeps the code path correct if multi-user accounts are introduced later.

---

## 10. Ownership Check Flow

Once wired, the intended flow for `requireOwnership()` (currently a fail-closed stub) is:

1. Given the resolved session identity (§9) and a target resource identifier (`upload_id`, `analysis_id`, etc.), query the relevant table **filtered by `account_id`/`user_id`** — never fetch the row first and check ownership after (spec 12 §7, spec 20 §6).
2. Rely on the anon/public client (§6) so that Supabase's RLS (spec 18) independently enforces the same owner-match rule at the database level — the app-layer filter and the RLS policy are both checking the same thing, redundantly, on purpose.
3. **Absence of a positive ownership match is a denial, never a pass** — this applies whether the absence is because the resource doesn't exist, belongs to someone else, or the query failed for any reason. All of these collapse to the same `forbidden()` response (spec 20 §6, spec 12 §17 "fail closed").
4. This flow does not change `requireOwnership()`'s existing contract (`{ ok, response }`) already called by every user-owned route — including the `TODO` left in `functions/api/analyses/index.js` noting that a real `upload_id` (not `null`) must be extracted from the validated request body once this is implemented.

---

## 11. Reviewer Role Check Flow

Once wired, the intended flow for `requireReviewerRole()` (currently a fail-closed stub) is:

1. Using the session identity resolved in §9, confirm `user_role` is `reviewer` or `admin` — a plain `owner` role must never satisfy this check (spec 12 §4/§13, spec 20 §6, already stated in the skeleton's route comments).
2. This role check is necessary but **not sufficient** for the review-item-update route (`PATCH /api/review/items/:item_id`) — per the existing `TODO(ownership/scope)` comment already in that file, a reviewer/admin role alone does not grant access to every queued item; a further scope/assignment check is required before allowing an update, matching spec 13 §12 and spec 18 §16.
3. Reviewer/admin access, once wired, must be **audited** (spec 12 §13, spec 18 §16, spec 20 §12) — every reviewer-role check that passes and results in an actual read/update should produce a corresponding audit event (§12 below), not just an unaudited allow.
4. This flow does not change `requireReviewerRole()`'s existing contract (`{ ok, response }`) already called by `functions/api/review/queue.js` and `functions/api/review/items/[item_id].js`.

---

## 12. Audit Event Write Flow

- Once wired, audit writes happen via the internal `POST /api/audit-events` path (spec 20 §12) or an equivalent internal call from within the orchestration layer itself — never directly from the frontend.
- Audit event payloads carry **object IDs, stage/decision labels, and reasons only — never policy text** (spec 11 §8, spec 17 §15.6, already stated in `functions/api/audit-events.js`'s existing comments). This constraint is structural, not just documented: an audit-event writer should have no code path that accepts or forwards a policy-text field at all.
- The audit-write path is anticipated to use the **service-role client** (§7), since audit writes are system-initiated and audit records intentionally sit outside normal per-user RLS read access (spec 18 §15) — but the service-role client's use here remains narrowly scoped to this one write path, not a general bypass available to other routes.
- Every reviewer/admin action that passes its role/scope checks (§11) is expected to produce an audit event recording what was accessed/changed, consistent with spec 13 §12's audit requirement.

---

## 13. Error Handling

- Supabase connection/query failures (once wired) must return the same generic, consumer-safe error shape already defined in spec 20 §11 and implemented in `functions/api/_lib/responses.js` (`jsonError` with a plain-language message) — internal Supabase error detail (query text, table names, stack traces) is logged server-side only, never surfaced to the consumer.
- A Supabase error must not be used to distinguish "resource doesn't exist" from "resource exists but isn't yours" in the response returned to the caller — both remain indistinguishable `forbidden()`/`not found`-equivalent responses, consistent with spec 20 §11's default-deny principle already applied to error responses.
- RLS-driven denials (an anon/public-client query that legitimately returns zero rows because RLS filtered it out) are treated identically to an app-layer ownership-check denial — both result in the same `forbidden()` response, since from the caller's perspective they must be indistinguishable.

---

## 14. Environment Variable Names To Reserve

The following names are reserved as **placeholders for future use only** — none are created, populated, or referenced in any executable code by this plan:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_ENV`

Naming these here is documentation only, so that when environment configuration is eventually approved (spec 19 §12, spec 20 §18), there is already an agreed naming convention to use rather than inventing one in the moment.

---

## 15. Secrets Handling Rules

- No secret of any kind is added, populated, or referenced in executable code by this plan (§17).
- Once wiring is approved and secrets exist, the service-role key must remain **server-side only** — never in frontend code, never in the public repository, never in a client-visible response, never in a log line (spec 19 §12, spec 20 §14, restated here).
- The anon/public key, once configured, is expected to be safe for the API layer to hold server-side, but is still scoped only to what RLS explicitly allows (spec 18) — it is not treated as equivalent in sensitivity to the service-role key, but it is still not exposed to the frontend under this proxy architecture, since the frontend never talks to Supabase directly (spec 11 §3, spec 20 §3).
- Any future local `.env`-style file used for development must never be committed to the repository — this is a standing rule restated here, not a new one.

---

## 16. Local Development Rules

- Local development against wired Supabase clients should target a **non-production/staging Supabase project** wherever possible, consistent with the staging-first recommendation already in spec 19 §4.
- The choice of target project (staging vs. production) should be a configuration change (which environment variable values are set), not a code change — consistent with spec 20 §16's existing local-development requirement.
- No local development step described here requires production credentials, and this plan does not itself set up any local environment, `.env` file, or Supabase project — that remains build work, gated per §18.

---

## 17. Do-Not-Build-Yet Items

This plan does **not** authorize:

- Creating any Supabase client instantiation code
- Installing any Supabase package/dependency
- Adding any environment variable or secret
- Connecting to any Supabase project
- Configuring any auth provider
- Applying any migration
- Creating any storage bucket
- Modifying any API route file
- Building any backend functionality
- Building any frontend UI
- Deploying anything

Writing and reviewing this plan is a planning action only.

---

## 18. Approval Required Before Wiring

Each of the following requires **explicit approval from Rex before the action**, independent of this plan's existence:

- Confirming the Supabase project/provider (spec 19 §4)
- Applying either Phase 1 migration (spec 19 §6)
- Connecting auth (spec 19 §7)
- Creating storage buckets (spec 19 §10)
- Installing a Supabase client package
- Adding any environment variable or secret (spec 19 §12, §14/§15 above)
- Writing the first real Supabase client instantiation in route code
- Implementing `requireSession()`, `requireOwnership()`, or `requireReviewerRole()` for real
- Deploying anything
- Staging, committing, or pushing this document or any resulting wiring code

Gates are independent; approving one does not approve another.

---

## 19. Out-of-Scope

This plan does **not**:

- Modify specs 01–20, any SQL migration, or any file under `functions/api/*`.
- Create any Supabase client code, install any package, or write any auth wiring.
- Add any environment variable or secret.
- Connect to Supabase, configure auth, apply migrations, or create buckets.
- Build backend functionality or frontend UI.
- Deploy anything.
- Stage, commit, or push anything without separate explicit approval.
- Introduce new product requirements — it plans only what specs 11, 12, 18, 19, and 20, and the existing pushed skeleton, already define.

**Explicit restatement, as required:** this plan does not connect to Supabase, does not implement auth, does not create any client, and does not add any secret. Wiring requires explicit approval later, gated per §18.

---

*End of v1.0 Supabase Client Wiring Plan. Maps the fail-closed guard placeholders already in `functions/api/_lib/guards.js` onto an intended real implementation — client types, usage rules for anon/public vs. service-role clients, session/ownership/reviewer-role check flows, audit-write flow, error handling, and reserved (unpopulated) environment variable names. It creates no client, installs no package, adds no secret, connects to nothing, and authorizes no wiring; every implementation action remains separately gated.*
