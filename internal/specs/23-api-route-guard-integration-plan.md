# Horse Insurance Coverage Checkup™
## API Route Guard Integration Plan — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Route Integration Planning (pre-implementation)
**Scope:** A **planning document** for how the existing `functions/api/*` route skeletons should be updated to import and use the full shared guard module (spec 22) — including the newer guards (`requireAccountMembership`, `requireAdminRole`, `requireServiceContext`, `validateRequestBody`, `auditSafeLog`) that routes do not yet call. Describes intended per-route guard usage in prose. Modifies no route file, no guard module file, no spec, no migration. Every implementation action is separately gated (§13).

---

## 1. Purpose

The shared guard module (`functions/api/_lib/guards.js`, `responses.js`, `audit.js`) now has ten functions, per spec 22: three already wired into routes (`requireSession`, `requireOwnership`, `requireReviewerRole`) and five that exist but that **no route currently imports** (`requireAccountMembership`, `requireAdminRole`, `requireServiceContext`, `validateRequestBody`, `auditSafeLog`, plus the `safeJson`/`safeError` naming aliases). Neither spec 22 nor the pushed guard module itself specifies **which route should call which of the newer guards, in what order, or why** — that mapping is what this document provides.

This document exists so the route-by-route integration work — updating each route file to call the additional guards it needs — can be reviewed and approved before any route file is touched, continuing the same planning-before-code discipline specs 16–22 already established. It is a plan a reviewer approves before route integration begins, not the integration itself.

This document describes intent only. It modifies no route file and no guard module file. The line it does not cross: **no route file update, no guard module change, no Supabase connection, no auth config** (§12, §13). Route files remain exactly as pushed until a separate, explicitly approved integration step.

**Governing constraint:** producing this plan starts no backend, frontend, Supabase, auth, or deployment work (spec 15 §8, spec 20 §17/§18, spec 21 §17/§18, spec 22 §16/§17). Each such action remains its own approval gate.

---

## 2. Source Documents

| Document | Contribution |
|---|---|
| **20 — API Proxy Skeleton Plan** | The route surface and each route's original auth/ownership/role requirements |
| **21 — Supabase Client Wiring Plan** | How guards eventually map onto real Supabase calls (client types, session/ownership/role flows) — this plan doesn't repeat that wiring, only which guard a route should call |
| **22 — API Guard Module Plan** | The full ten-function guard catalogue this plan maps onto specific routes |
| **functions/README.md, functions/api/\*** | The actual pushed route skeletons — their current imports and handler bodies, inventoried in §5 |
| **Shared guard module skeleton** (`functions/api/_lib/guards.js`, `responses.js`, `audit.js`) | The real, already-implemented fail-closed guard functions this plan assigns to routes |

No requirement outside these documents is introduced.

---

## 3. Current Gate Status

As of this writing:

- All eleven routes exist as pushed, non-functional skeletons under `functions/api/*`.
- Every route already imports and calls a subset of the three original guards (`requireSession`, `requireOwnership`, `requireReviewerRole`) and the two original response helpers (`notImplemented`, plus `jsonOk` on the health route) — confirmed by direct inspection of each file's `import` lines.
- **No route imports or calls any of the five newer guards** (`requireAccountMembership`, `requireAdminRole`, `requireServiceContext`, `validateRequestBody`, `auditSafeLog`) or the `safeJson`/`safeError` aliases — these exist in the guard module but are currently unused by any route.
- No Supabase project is confirmed; no migration is applied; no auth is connected (spec 19 §2, unchanged).
- This plan does not change any of the above. It describes which routes *would* import which additional guards, once a separate integration step is approved.

---

## 4. Integration Goal

The end state this plan describes (not yet built): every route calls the full set of guards its function in the system actually requires — not just the three it happens to already import — so that, for example, an internal-only route can eventually distinguish a real internal caller (`requireServiceContext`), a route with a request body can validate it before touching any guard that reads that body (`validateRequestBody`), and any route producing a reviewer/admin-visible side effect can write a sanitized audit line (`auditSafeLog`). None of this is implemented by this plan — it is the integration target a future, separately-approved step would build toward.

---

## 5. Existing Route Inventory

As currently pushed, confirmed by direct inspection:

| Route | Method | Current guard imports | Current response helpers |
|---|---|---|---|
| `functions/api/health.js` | GET | *(none)* | `jsonOk` |
| `functions/api/session.js` | GET | `requireSession` | `notImplemented` |
| `functions/api/uploads/init.js` | POST | `requireSession` | `notImplemented` |
| `functions/api/uploads/[upload_id]/files.js` | POST | `requireSession`, `requireOwnership` | `notImplemented` |
| `functions/api/analyses/index.js` | POST | `requireSession`, `requireOwnership` | `notImplemented` |
| `functions/api/analyses/[analysis_id]/status.js` | GET | `requireSession`, `requireOwnership` | `notImplemented` |
| `functions/api/analyses/[analysis_id]/report.js` | GET | `requireSession`, `requireOwnership` | `notImplemented` |
| `functions/api/analyses/[analysis_id]/answers.js` | POST | `requireSession`, `requireOwnership` | `notImplemented` |
| `functions/api/review/queue.js` | GET | `requireSession`, `requireReviewerRole` | `notImplemented` |
| `functions/api/review/items/[item_id].js` | PATCH | `requireSession`, `requireReviewerRole` | `notImplemented` |
| `functions/api/audit-events.js` | POST | `requireSession` | `notImplemented` |

This inventory is the baseline every proposal in §7 is written against.

---

## 6. Shared Guard Imports

All ten guard-module functions are available for import from `functions/api/_lib/guards.js` (`requireSession`, `requireOwnership`, `requireAccountMembership`, `requireReviewerRole`, `requireAdminRole`, `requireServiceContext`, `validateRequestBody`) and `functions/api/_lib/responses.js`/`functions/api/_lib/audit.js` (`safeJson`, `safeError`, `auditSafeLog`, alongside the original `jsonOk`, `jsonError`, `notImplemented`, `unauthenticated`, `forbidden`). This plan does not propose changing any import path or export name — integration means adding additional `import` statements to routes that need them, not restructuring the guard module itself.

---

## 7. Route-by-Route Guard Usage

Proposed target guard usage per route (additions relative to §5's baseline are **bolded**):

| Route | `requireSession` | `requireOwnership` | `requireAccountMembership` | `requireReviewerRole` | `requireAdminRole` | `requireServiceContext` | `validateRequestBody` | `safeJson`/`safeError` | `auditSafeLog` |
|---|---|---|---|---|---|---|---|---|---|
| `health.js` | — | — | — | — | — | — | — | ✅ (`safeJson`, already `jsonOk`) | — |
| `session.js` | ✅ (existing) | — | — | — | — | — | — | **✅ propose `safeJson`/`safeError`** | — |
| `uploads/init.js` | ✅ (existing) | — | **✅ propose** | — | — | — | **✅ propose** | **✅ propose** | — |
| `uploads/[upload_id]/files.js` | ✅ (existing) | ✅ (existing) | **✅ propose** | — | — | — | **✅ propose** | **✅ propose** | — |
| `analyses/index.js` | ✅ (existing) | ✅ (existing) | **✅ propose** | — | — | — | **✅ propose** | **✅ propose** | — |
| `analyses/[analysis_id]/status.js` | ✅ (existing) | ✅ (existing) | — | — | — | — | — | **✅ propose** | — |
| `analyses/[analysis_id]/report.js` | ✅ (existing) | ✅ (existing) | — | — | — | — | — | **✅ propose** | — |
| `analyses/[analysis_id]/answers.js` | ✅ (existing) | ✅ (existing) | — | — | — | — | **✅ propose** | **✅ propose** | — |
| `review/queue.js` | ✅ (existing) | — | — | ✅ (existing) | — | — | — | **✅ propose** | **✅ may use** |
| `review/items/[item_id].js` | ✅ (existing) | **✅ propose** (item-level, beyond role) | — | ✅ (existing) | **✅ may use** (if escalation added later) | — | **✅ propose** | **✅ propose** | **✅ may use** |
| `audit-events.js` | ✅ (existing, per spec 20 §12 as a placeholder even though internal) | — | — | — | — | **✅ propose (replace/augment requireSession)** | **✅ propose** | **✅ propose** | **✅ may use (self-referential — this route IS the audit write path)** |

Notes on the table:
- **`requireAccountMembership`** is proposed only for routes that create or reference an `account_id`-scoped resource for the first time in a request (`uploads/init`, `uploads/:upload_id/files`, `analyses` creation) — status/report/answer routes already gate on `requireOwnership`, which is account-scoped by construction (spec 22 §7), so adding a redundant membership check there is not proposed.
- **`requireAdminRole`** has no current route requiring it — it is listed as "may use" only for `review/items/:item_id` if a future escalate/reassign action (spec 18 §16) is added to that route; this plan does not propose adding that action now.
- **`requireServiceContext`** is proposed only for `audit-events.js`, since that is the one route spec 20 §12 already describes as internal-only. This plan proposes it **replace or augment** the current placeholder `requireSession` call there, since an internal system call is not really a "user session" at all — but the exact replace-vs-augment decision is left to the integration step itself (§13), not decided here.
- **`validateRequestBody`** is proposed for every route that accepts a body (all `POST`/`PATCH` routes) — not for `GET` routes, which have no body to validate.
- **`auditSafeLog`** is marked "may use" (not "propose") for reviewer-facing routes and the audit-events route itself, since spec 22 §9/§11 ties audit writes to reviewer/admin actions and system-initiated events specifically — ordinary user-owned routes (uploads, analyses, reports, answers) are not proposed to call it directly, since the underlying pipeline stages (specs 04–10), not the route layer, are expected to be the actual source of most audit events once built.

---

## 8. Fail-Closed Behavior

- Every proposed addition in §7 uses a guard that **already fails closed** (per spec 22 §14, confirmed by direct inspection of `guards.js`) — adding a call to `requireAccountMembership`, `requireAdminRole`, or `requireServiceContext` to a route only adds another unconditional denial path, never a path to `ok: true`.
- No route's overall behavior can become *more* permissive by this plan's proposals — every addition is another gate a request must pass, stacked after the guards a route already has, so a route with more guards proposed is strictly harder to satisfy than before, not easier.
- **This property must be preserved by whoever actually implements this plan**: when route integration eventually happens, each added guard call must be inserted so that failing it still returns the guard's own denial response immediately (mirroring the existing `if (!check.ok) return check.response;` pattern already used throughout the skeleton) — never wrapped in a way that could suppress or bypass the denial.
- Until a separate, approved implementation step adds these calls, **every route's actual behavior remains exactly as currently pushed** — this plan changes no route's real behavior today.

---

## 9. Safe Placeholder Responses

- Every route, once integrated per §7, is expected to use `safeJson`/`safeError` (or their existing `jsonOk`/`jsonError`/`notImplemented`/`unauthenticated`/`forbidden` equivalents — this plan does not require replacing working calls, only adding the newer names where a route doesn't yet return anything) consistently, so response shape stays uniform across the whole route surface (spec 20 §10, spec 22 §12).
- No route is proposed to introduce a new response shape, error code convention, or status code outside what specs 20 §10/§11 and 22 §12 already define.
- `health.js` is proposed to keep using `jsonOk`/`safeJson` for its liveness response only — no guard call is proposed for this route at all (§7, health/status stays public and guard-free, per spec 20 §8).

---

## 10. Audit-Safe Logging

- `auditSafeLog` is proposed only where a route's action is the kind of thing spec 11 §8/spec 22 §13 already says belongs in the audit trail: reviewer/admin actions (`review/queue.js`, `review/items/:item_id.js`) and the internal audit-write path itself (`audit-events.js`).
- No user-owned route (uploads, analyses, reports, answers) is proposed to call `auditSafeLog` directly — per spec 11 §9/§13, stage transitions and audit events are expected to originate from the orchestration/pipeline layer as it's built (specs 04–10), not bolted onto the route layer as an afterthought. This plan does not propose changing that division of responsibility.
- Wherever `auditSafeLog` is eventually called, it continues to accept only the fixed whitelist of fields already enforced structurally in `audit.js` (`stage`, `objectId`, `decision`, `reason`, `actorRole`, `timestamp`) — this plan does not propose expanding that whitelist or introducing any new field.

---

## 11. Service Role Restrictions

- **`requireServiceContext`**, proposed only for `audit-events.js` (§7), does not by itself grant service-role Supabase access — it only proposes a way to distinguish a legitimate internal caller from an ordinary request, consistent with its existing contract in the guard module (spec 22 §10).
- **No route is proposed to instantiate a service-role Supabase client** — that remains entirely out of scope for this plan and for route integration generally, gated separately under spec 21 §7/§18.
- **The service-role key, wherever it is eventually used, remains server-side only** — never in frontend code, never in a response, never logged — restated here as an unconditional constraint on any future route integration work, not something this plan or any route integration step may relax.

---

## 12. Do-Not-Build-Yet Items

This plan does **not** authorize:

- Modifying any route file under `functions/api/*`
- Modifying the shared guard module (`guards.js`, `responses.js`, `audit.js`)
- Creating any backend functionality
- Connecting to Supabase
- Configuring auth
- Adding any environment variable or secret
- Installing any package
- Building extraction, generation, verification, report, reviewer, or frontend logic
- Deploying anything

Writing and reviewing this plan is a planning action only.

---

## 13. Approval Required Before Route Updates

Each of the following requires **explicit approval from Rex before the action**, independent of this plan's existence:

- Adding any guard import or guard call to any route file (the core action this plan precedes)
- Deciding the `requireServiceContext` replace-vs-augment question for `audit-events.js` (§7, explicitly left open here)
- Adding any escalate/reassign action to `review/items/:item_id` that would require `requireAdminRole` (§7, not proposed as built, only flagged as a future possibility)
- Confirming the Supabase project/provider, applying migrations, connecting auth, or creating buckets (spec 19)
- Adding any environment variable or secret
- Deploying anything
- Staging, committing, or pushing this document or any resulting route changes

Gates are independent; approving one does not approve another.

---

## 14. Out-of-Scope

This plan does **not**:

- Modify specs 01–22, any SQL migration, any route file, or the shared guard module.
- Update any route file to import or call any guard — it proposes which routes *should* import which guards, without performing the update.
- Implement auth, connect to Supabase, or make any route functional.
- Add any environment variable, secret, or package.
- Build backend functionality or frontend UI.
- Deploy anything.
- Stage, commit, or push anything without separate explicit approval.
- Introduce new product requirements — it plans only what specs 20, 21, and 22, and the existing pushed route/guard skeletons, already define.

**Explicit restatement, as required:** this plan does not update route files, does not implement auth, does not connect to Supabase, and does not make any route functional. Route integration requires separate, explicit approval before any route file is touched.

---

*End of v1.0 API Route Guard Integration Plan. Maps the five previously-unused shared guard functions (`requireAccountMembership`, `requireAdminRole`, `requireServiceContext`, `validateRequestBody`, `auditSafeLog`) onto the eleven existing route skeletons, route by route, while confirming every proposed addition preserves fail-closed behavior. It modifies no route file and no guard module file; every implementation action remains separately gated.*
