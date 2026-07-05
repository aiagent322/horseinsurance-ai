# Horse Insurance Coverage Checkup™
## API Guard Module Plan — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Guard Module Planning (pre-implementation)
**Scope:** A **planning document** for the shared `functions/api/_lib/guards.js` (and related `_lib`) module — the guard functions every `/api/*` route calls for session validation, ownership checks, reviewer/admin checks, safe errors, and audit-safe behavior. Describes intended function contracts and behavior in prose. Creates no guard code, no Supabase client code, no package install, no environment variable, no secret, no connection, no auth config. Every implementation action is separately gated (§17).

---

## 1. Purpose

The pushed skeleton already has a real, working `functions/api/_lib/guards.js` and `functions/api/_lib/responses.js` — but every guard in it is a deliberate fail-closed stub (`requireSession`, `requireOwnership`, `requireReviewerRole` each always deny), and spec 21 described how those stubs map onto Supabase client usage without specifying the guard module's own internal shape: what functions it should expose, what each one's contract is, and what additional guards (account membership, admin vs. reviewer, service-context, request validation, audit-safe logging) the module needs before route implementation can proceed past its current placeholders.

This document is that specification, at the planning level. It exists so the guard module's design — its full function list, each function's responsibility and fail-closed behavior, and how routes are expected to compose them — can be reviewed and approved before any of it is implemented for real, continuing the same planning-before-code discipline specs 16–21 already established.

This document describes intent only. It writes no function body, no Supabase call, no import of a client library, and no auth wiring. The line it does not cross: **no guard module code, no Supabase client code, no package install, no environment variable, no secret, no connection, no auth config** (§16, §17). It is a plan a reviewer approves before guard implementation begins.

**Governing constraint:** producing this plan starts no Supabase, auth, backend, frontend, or deployment work (spec 15 §8, spec 18 §19/§20, spec 19 §15, spec 20 §17/§18, spec 21 §17/§18). Each such action remains its own approval gate.

---

## 2. Source Documents

| Document | Contribution |
|---|---|
| **12 — Auth, Account & Isolation** | Identity model (`user_id`/`account_id`/`user_role`), default-deny access control, per-user isolation, role-limited reviewer/admin access, "fail closed" principle |
| **18 — Phase 1 RLS Policy Plan** | Role model (owner/reviewer/admin/service), audit restrictions on `audit_events`, storage access relationship, default-deny as the database-level backstop |
| **20 — API Proxy Skeleton Plan** | The route surface and per-route auth/ownership/role requirements this guard module serves |
| **21 — Supabase Client Wiring Plan** | Client types (anon/public vs. service-role), session/ownership/reviewer-role check flows, audit-write flow, error-handling rules this plan turns into concrete guard function contracts |
| **functions/README.md, functions/api/\*** | The actual pushed skeleton — current `requireSession`, `requireOwnership`, `requireReviewerRole` stubs and the shared `jsonOk`/`jsonError`/`notImplemented`/`unauthenticated`/`forbidden` helpers this plan extends |

No requirement outside these documents is introduced.

---

## 3. Current Gate Status

As of this writing, restated from spec 19 §2 / §3 and unchanged by specs 20–21 or the pushed skeleton:

- No Supabase project confirmed; no migration applied; no auth connected; no bucket created.
- `functions/api/_lib/guards.js` contains three real, working, fail-closed stub functions (`requireSession`, `requireOwnership`, `requireReviewerRole`) — none perform a real check yet.
- `functions/api/_lib/responses.js` contains real, working response-envelope helpers (`jsonOk`, `jsonError`, `notImplemented`, `unauthenticated`, `forbidden`) already used by every route.
- No account-membership guard, admin-specific guard, service-context guard, request-body validator, or audit-safe logging helper exists yet anywhere in the skeleton.

This plan does not change any of the above. It describes the fuller guard module shape that would be implemented once the gates in specs 19, 20 §18, and 21 §18 are cleared.

---

## 4. Guard Module Responsibilities

The guard module's job, once implemented, is to be the **single place** every `/api/*` route calls for:

- Resolving and validating the caller's identity (§6).
- Confirming that identity owns the resource it's trying to access (§7).
- Confirming that identity belongs to the account it claims to act within (§8).
- Confirming that identity holds an elevated role where a route requires one (§9).
- Recognizing legitimate internal/system-initiated calls distinctly from user calls (§10).
- Validating request shape before any of the above even runs (§11).
- Producing consistent, consumer-safe success/error responses (§12).
- Logging in a way that can never leak policy text or secrets (§13).

No route is expected to reimplement any of this logic itself — a route composes guard calls and, once a request clears them, proceeds to its own (separately built) business logic.

---

## 5. Proposed Guard Functions

| Function | Purpose |
|---|---|
| `requireSession()` | Validates the caller has a real, current session; resolves identity |
| `requireOwnership()` | Confirms the validated identity owns a specific resource |
| `requireAccountMembership()` | Confirms the validated identity belongs to the account it claims to act within |
| `requireReviewerRole()` | Confirms the validated identity holds the `reviewer` (or `admin`) role |
| `requireAdminRole()` | Confirms the validated identity holds specifically the `admin` role, where a route needs more than reviewer-level access |
| `requireServiceContext()` | Confirms a call is a legitimate internal/system-initiated call (e.g., orchestration-layer-to-orchestration-layer), not a spoofed "trust me" header from an ordinary request |
| `validateRequestBody()` | Validates a request body's shape/types against a route's expected input before any guard/business logic runs on it |
| `safeJson()` | Produces the standard success response envelope (already implemented as `jsonOk`) |
| `safeError()` | Produces the standard error response envelope (already implemented as `jsonError`, plus the existing `unauthenticated`/`forbidden`/`notImplemented` helpers) |
| `auditSafeLog()` | Writes a log/audit line guaranteed to exclude policy text and secrets, regardless of what's in the surrounding request/response data |

This is the full proposed function list for the module. `requireSession`, `requireOwnership`, and `requireReviewerRole` already exist as fail-closed stubs; `requireAccountMembership`, `requireAdminRole`, `requireServiceContext`, `validateRequestBody`, and `auditSafeLog` are new proposed additions this plan introduces conceptually. `safeJson`/`safeError` map onto the already-implemented `responses.js` helpers.

---

## 6. Session Validation Guard

- **Contract:** given a request, `requireSession()` returns whether a valid, current session exists and, if so, the resolved identity (`user_id`, and enough information for `requireAccountMembership()` to resolve `account_id`/`user_role`).
- **Fail-closed default:** exactly as already implemented — no session ever validates until real auth is wired (spec 21 §8); an expired, missing, or invalid token is denied, never defaulted to a guest/demo identity (spec 12 §5).
- **Scope:** this guard answers only "is there a real, currently-valid session," not "does this session own X" (that's §7) or "does this session have an elevated role" (that's §9/§10) — those are separate, composable guards, not folded into this one.

---

## 7. Ownership Guard

- **Contract:** given a resolved session identity and a target resource identifier (`upload_id`, `analysis_id`, `item_id`, etc.), `requireOwnership()` returns whether that identity's `account_id`/`user_id` owns the resource.
- **Fail-closed default:** exactly as already implemented — absence of a positive ownership match (resource doesn't exist, belongs to someone else, or the check itself fails for any reason) is always a denial (spec 12 §7/§17, spec 21 §10).
- **Query discipline:** once implemented, this guard is expected to filter by the requester's identity at the query itself — never fetch a row and then decide whether to return it (spec 12 §7, spec 20 §6, spec 21 §10) — with Supabase RLS (spec 18) as an independent, redundant backstop, not the only check.
- **No cross-account access:** this guard is the primary mechanism by which the system guarantees no request can read or write another account's data under any resource-identifier shape (spec 12 §7, restated here as a hard requirement of this guard specifically).

---

## 8. Account Membership Guard

- **New guard, not yet in the skeleton.** `requireAccountMembership()` confirms the resolved `user_id` is actually a member of the `account_id` it claims to act within (spec 12 §4, spec 16 §4's `account_members` table).
- **Why distinct from ownership:** ownership (§7) checks "does this account own resource X"; account membership checks "is this user actually part of this account at all." MVP is 1 user : 1 account (spec 12 §4), so in practice these often resolve together today, but modeling them as separate guards avoids conflating the two concepts once multi-user accounts exist — a future user removed from an account must fail this guard immediately, independent of any resource-level ownership check.
- **Fail-closed default:** an unresolvable or stale membership record denies access, exactly like every other guard in this module.

---

## 9. Reviewer/Admin Role Guard

- **`requireReviewerRole()`** (already a fail-closed stub) confirms the resolved identity's `user_role` is `reviewer` or `admin` — a plain `owner` role never satisfies it (spec 12 §4/§13, spec 20 §6).
- **`requireAdminRole()`** (new, proposed) is a stricter variant confirming specifically `admin`, for any future operation that needs more than ordinary reviewer scope (e.g., reassigning/escalating a review item, per spec 18 §16's "Admin may reassign/escalate" note). No route in the current skeleton requires this yet, but the guard is planned now so a future admin-only action has a ready-made, consistently-named check rather than an ad hoc role comparison inline in a route.
- **Role is necessary, not sufficient, for item-level actions:** as already noted in the skeleton's `PATCH /api/review/items/:item_id` comments, passing a role guard does not by itself grant access to a *specific* queued item — a further scope/assignment check (still a `TODO` in that route) is required, consistent with spec 13 §12 and spec 18 §16.
- **Audited by design:** every reviewer/admin action that passes its role/scope checks is expected to produce a corresponding audit event (§13, spec 21 §11/§12) — a passing role check is not itself the end of the story; it must be logged.

---

## 10. Service Role Guardrails

- **`requireServiceContext()`** (new, proposed) is not a user-identity guard at all — it exists to let a route (like `POST /api/audit-events`, spec 20 §12) distinguish a legitimate internal/system-initiated call from an ordinary external request, before considering any service-role-backed operation.
- **This guard does not grant service-role database access by itself** — it only answers "is this call coming from where it's supposed to come from" (the orchestration layer itself, not the public frontend). The actual service-role Supabase client (spec 21 §7) is a separate concern gated by its own approval.
- **Fail-closed default:** without a real internal-call verification mechanism (e.g., a service-to-service credential, per spec 21 §12's existing note), this guard denies everything, exactly like the audit-events route's current placeholder behavior.
- **Restated hard rule:** the service-role key, wherever it is eventually used, remains **server-side only** — never in frontend code, never in a response, never logged (spec 19 §12, spec 20 §14, spec 21 §7/§15). This guard module never exposes a path by which a service-role-backed operation could be triggered from an unauthenticated or ordinary user request.

---

## 11. Request Validation Helpers

- **`validateRequestBody()`** (new, proposed) validates a request body's shape and types against a route's expected input schema — before any guard or business logic runs on it (spec 20 §9).
- This is intentionally a **generic, reusable** validator, not a per-route bespoke parser — each route supplies its own expected shape, and the helper applies consistent rejection behavior (a clear, non-technical validation error, per spec 20 §9/§11) for malformed input.
- Validation happens **before** ownership/role checks wherever a route needs both — a malformed request is rejected on shape grounds first, so a route never attempts an ownership check against garbage input.
- This helper does not perform business-rule validation (e.g., "is this a valid coverage category") — that remains pipeline/stage-owned logic (specs 02–09), out of scope for a guard module.

---

## 12. Safe Error Helpers

- **`safeJson()`** maps directly onto the already-implemented `jsonOk()` in `functions/api/_lib/responses.js` — no new behavior proposed, just naming continuity with this plan's language.
- **`safeError()`** maps onto the already-implemented `jsonError()`, plus the existing `unauthenticated()`/`forbidden()`/`notImplemented()` convenience wrappers — same point: this plan does not propose changing their behavior, only cataloguing them alongside the newly-proposed guards so the full module surface is described in one place.
- **Consumer-safe by construction:** every error helper's message is plain-language and non-technical (spec 20 §11); none ever include stack traces, internal identifiers, table/query names, or policy text — a rule already true of the implemented code and restated here as a permanent constraint on any future guard/error helper added to this module.
- **Indistinguishable denials:** consistent with spec 20 §11 and spec 21 §13, an ownership mismatch and a "resource doesn't exist" condition must produce the same response shape — no error helper in this module may leak which case actually occurred.

---

## 13. Audit-Safe Logging Rules

- **`auditSafeLog()`** (new, proposed) is the single function any guard or route uses to write a log or audit line — it exists specifically so "never log policy text or secrets" is enforced in one place rather than trusted to every call site individually.
- **Structural exclusion, not just a rule:** this helper's proposed contract only accepts a fixed set of safe fields (object IDs, stage/decision labels, reasons, timestamps) — it has no parameter for arbitrary free text, policy content, or secret values, so there is no path by which a caller could accidentally pass through something unsafe (spec 11 §8, spec 17 §15.6, spec 21 §12).
- **Applies uniformly:** every guard in this module (§6–§10), once implemented, is expected to route any logging it does through this helper — a guard should never call a raw `console.log`/`console.error` directly with request/response data.
- **Consistent with existing skeleton discipline:** no route in the current skeleton logs anything today (confirmed in the spec 20-code review); this plan preserves that property going forward by centralizing logging behind a single, constrained helper rather than leaving it to per-route discretion.

---

## 14. Fail-Closed Defaults

Restated as a single, module-wide governing rule, since it is the property every guard above shares:

- **Every guard in this module fails closed by default.** A guard that cannot positively confirm a session, an ownership match, an account membership, a role, or a service context **denies access** — it never defaults to allow, never assumes good faith, and never treats "I couldn't check" as equivalent to "it's fine" (spec 12 §17, spec 20 §6, spec 21 §10/§11, already true of every implemented stub in the skeleton).
- **No unauthenticated production access** — `requireSession()` failing denies the request outright; there is no lower-trust fallback tier for an unauthenticated caller on any user-owned or reviewer-owned route (spec 12 §6).
- **No cross-account access** — `requireOwnership()` and `requireAccountMembership()` together are the mechanism that guarantees this; both fail closed independently, so a bug in one does not, by itself, open a cross-account path.
- This is not a new rule this plan introduces — it is the single property that already characterizes every guard shipped in the pushed skeleton, and this plan requires that every newly proposed guard (§8–§11, §13) share it exactly.

---

## 15. Route Integration Pattern

- The intended integration pattern is unchanged from what the pushed skeleton already demonstrates: a route imports the guards it needs from `_lib/guards.js`, calls them in sequence (session → ownership/membership → role, where applicable), and returns early on any `{ ok: false }` result before touching any business logic.
- **Order matters:** session validation always runs first; a route never attempts an ownership, membership, or role check against an unresolved identity. Request-body validation (§11) runs before any check that depends on the body's contents.
- **Composability, not duplication:** a route composes existing guards rather than reimplementing checks inline — e.g., the review-item-update route is expected to call `requireSession()`, then `requireReviewerRole()`, then (once built) an item-scope check, rather than hand-rolling any of those three.
- **No change to already-pushed routes is proposed by this plan** — this section describes the pattern the existing skeleton already follows, so that future guard additions (§8, §9's admin variant, §10, §11, §13) slot into the same shape rather than introducing a second pattern.

---

## 16. Do-Not-Build-Yet Items

This plan does **not** authorize:

- Creating any guard module code (new functions or modifications to existing stubs)
- Creating any Supabase client code
- Installing any package
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

## 17. Approval Required Before Implementation

Each of the following requires **explicit approval from Rex before the action**, independent of this plan's existence:

- Implementing `requireSession()`, `requireOwnership()`, or `requireReviewerRole()` for real (already flagged in specs 20/21, restated here)
- Creating `requireAccountMembership()`, `requireAdminRole()`, `requireServiceContext()`, `validateRequestBody()`, or `auditSafeLog()` for the first time
- Confirming the Supabase project/provider, applying migrations, connecting auth, or creating buckets (spec 19)
- Installing a Supabase client package or writing client instantiation code (spec 21)
- Adding any environment variable or secret
- Deploying anything
- Staging, committing, or pushing this document or any resulting guard code

Gates are independent; approving one does not approve another.

---

## 18. Out-of-Scope

This plan does **not**:

- Modify specs 01–21, any SQL migration, or any file under `functions/api/*`.
- Create any guard module code, Supabase client code, or install any package.
- Add any environment variable or secret.
- Connect to Supabase, configure auth, apply migrations, or create buckets.
- Build backend functionality or frontend UI.
- Deploy anything.
- Stage, commit, or push anything without separate explicit approval.
- Introduce new product requirements — it plans only what specs 12, 18, 20, and 21, and the existing pushed skeleton, already define.

**Explicit restatement, as required:** this plan does not implement any guard code. Every guard function described here (§5–§13) remains a design description until a separate, explicitly approved implementation step.

---

*End of v1.0 API Guard Module Plan. Catalogues the full intended guard module surface — three already-implemented fail-closed stubs (`requireSession`, `requireOwnership`, `requireReviewerRole`) plus five newly proposed guards/helpers (`requireAccountMembership`, `requireAdminRole`, `requireServiceContext`, `validateRequestBody`, `auditSafeLog`) and the existing response helpers — with each function's responsibility, fail-closed behavior, and role in the route integration pattern. It creates no guard code, client code, package install, secret, or connection; every implementation action remains separately gated.*
