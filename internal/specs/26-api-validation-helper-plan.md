# Horse Insurance Coverage Checkup™
## API Validation Helper Plan — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Validation Planning (pre-implementation)
**Scope:** A **planning document** for the request-validation helpers that should eventually enforce the request bodies, path parameters, and query parameters defined in spec 24, and produce the approved safe error envelope, inside the `functions/api/*` proxy layer. Describes the intended helpers' contracts and behavior in prose. Creates no validation code, no route code, no guard-module change, no Supabase connection, no auth config. Every implementation action is separately gated (§15).

> **Reconstruction note:** the original v1.0 of this document (local commit `98af410`, 2026-07-05) was lost before it could be pushed. This version was reconstructed on 2026-07-07 from the recovered original header, §1, §15, §16, and closing summary (verbatim), with §2–§14 re-derived from the same source specs (20–25) and the pushed guard-module skeleton. Content-identical intent; wording of §2–§14 may differ from the lost original.

---

## 1. Purpose

Specs 20–25 established the route surface, the shared guard module, how routes call it, the request/response *shapes* (spec 24), and the dedicated review-item scope guard (spec 25). What is still missing is the layer that actually **validates** an incoming request against those shapes before a route acts on it.

Today, `validateRequestBody()` in `functions/api/_lib/guards.js` is a parseability-only placeholder (spec 22 §11, spec 24 §19): it confirms a request body is well-formed JSON when present, and nothing more. No helper validates path parameters, query parameters, field presence, field types, enum membership, or string safety, and no helper rejects unknown fields.

This document is the missing helper-level plan. It names a small, reusable set of validation primitives, defines each one's contract and fail-closed behavior, ties every failure to the approved spec 24 error envelope, and maps each route in the inventory to the validation it needs — so that when real validation logic is eventually implemented, there is an agreed set of helper names, responsibilities, and behaviors to build against, continuing the same planning-before-code discipline specs 16–25 already established.

This document describes intent only. It modifies no route file, no guard module file, no spec, and no migration. The line it does not cross: **no helper code, no route code, no Supabase connection, no auth config** (§14, §15). It is a plan a reviewer approves before implementation begins.

**Governing constraint:** producing this plan starts no backend, frontend, Supabase, auth, or deployment work (spec 15 §8, spec 20 §17/§18, spec 21 §17/§18, spec 22 §16/§17, spec 23 §12/§13, spec 24 §21/§22, spec 25 §13/§14).

---

## 2. Source Documents

- `internal/specs/20-api-proxy-skeleton-plan.md` — route surface, validation-before-business-logic ordering (§9), consumer-safe error rules (§11).
- `internal/specs/21-supabase-client-wiring-plan.md` — server-side-only client boundary; safe-error restatements (§13).
- `internal/specs/22-api-guard-module-plan.md` — guard catalogue; `validateRequestBody()` placeholder definition (§11); `safeJson`/`safeError` vocabulary (§12).
- `internal/specs/23-api-route-guard-integration-plan.md` — established call order in every integrated route (guards then validation then 501).
- `internal/specs/24-api-request-response-schema-plan.md` — the target request/response shapes (§10–§18), route inventory (§7), validation rules (§19), safe error rules (§20), standard error envelope (§6).
- `internal/specs/25-review-item-scope-guard-plan.md` — review-item scope guard plan; structural/gating conventions this document follows.
- `functions/api/_lib/guards.js`, `responses.js`, `audit.js` — the pushed skeleton this plan extends conceptually.
- `functions/README.md` — route/ownership context.

---

## 3. Current Gate Status

Everything below remains **planned, not implemented**:

- `validateRequestBody()` is a parseability-only placeholder — no per-route schema enforcement exists anywhere in the repo.
- No path-parameter or query-parameter validation helper exists.
- No UUID/opaque-ID, enum, safe-string, or unknown-field helper exists.
- No validation package/dependency is installed.
- No Supabase project is connected; no migrations applied; no auth configured (spec 19 gates unchanged).

Nothing in this document changes any of the above.

---

## 4. Current Placeholder State

`validateRequestBody(request)` today (guards.js):

- Returns `{ ok: true, body: null }` for GET/HEAD or empty bodies.
- Attempts `JSON.parse` on any present body; on failure returns `{ ok: false }` with the `invalid_request_body` envelope (400) and never surfaces parser internals (spec 20 §11).
- Performs **no** field-presence, type, enum, length, or unknown-field checking.

Routes (per spec 23 integration) already call it before business logic, so the *call site ordering* the future implementation needs is structurally in place — only the enforcement depth is missing.

---

## 5. Proposed Helper Catalogue

Eight conceptual helpers, all planned to live alongside the existing guard module (whether inside `guards.js` or a sibling `validation.js` is an implementation-time decision, separately gated in §15):

1. **`validateRequestBody(request, schema)` (extension)** — extends the existing placeholder to enforce a per-route schema: required fields present, types correct, no unknown fields (via `rejectUnknownFields`, below). Backwards-compatible signature: with no schema supplied it behaves exactly as today, so extension cannot silently break existing routes.
2. **`validatePathParam(name, value)`** — confirms a path parameter (`upload_id`, `analysis_id`, `item_id`) is a non-empty opaque string. Per spec 24 §19, format validation beyond "non-empty" is deliberately *not* proposed — the check that matters is ownership/scope (spec 12 §6/§7), not string shape.
3. **`validateQueryParams(request, allowed)`** — checks query parameters against a route's allowed set with per-parameter type/enum rules (currently only `/api/review/queue` pagination, spec 24 §16 proposed).
4. **`requireUuid(value)`** — available for any future field that is *known* to be a UUID by contract (e.g., server-generated IDs echoed back in bodies). Not applied to path parameters (see #2).
5. **`requireAllowedEnum(value, allowed)`** — membership check against a fixed list (e.g., review item status transitions, spec 24 §17).
6. **`requireSafeString(value, maxLength)`** — non-empty, length-bounded, no control characters. A *shape* check only — business-rule validation (e.g., "is this a valid coverage category") remains pipeline-owned logic (specs 02–09) and is explicitly not this helper's job (consistent with spec 22 §11).
7. **`rejectUnknownFields(body, allowedFields)`** — any field not in the route's schema fails validation rather than being silently dropped, so a typo'd or injected field can never pass through unnoticed.
8. **`validationError(detailSafeMessage)`** — the single constructor every helper above uses to produce a failure response: always the spec 24 §6 envelope, always code `invalid_request_body`, always status 400, always consumer-safe text.

**Explicitly left open (decided at implementation gate, §15):** the schema *representation* format — hand-rolled shape objects vs. a vetted validation library. This plan defines the contracts either representation must satisfy; it does not pick one, since picking one implies a dependency decision that is separately gated.

---

## 6. Fail-Closed Behavior

- Every helper returns a definite pass or a definite fail — there is no "warn and continue."
- Any internal error inside a helper (unexpected type, thrown exception) is a **fail**, never a pass (same default-deny posture as spec 12 §17 and every guard in spec 22).
- A route must not proceed to guards that depend on body contents, or to business logic, after any validation failure (spec 20 §9 ordering).
- Absence of a schema for a route that has a body is itself a plan defect to be fixed, not a reason to skip validation silently — implementation should treat "route has body but no schema registered" as a fail-closed condition.

---

## 7. Path & Query Parameter Validation

- **Path parameters** (`upload_id`, `analysis_id`, `item_id`): validated as non-empty opaque strings only (§5 #2). Emptiness or absence fails with `validationError()`. Ownership/scope of the referenced resource is *not* this layer's job (§13).
- **Query parameters:** only `/api/review/queue` currently has any (proposed pagination, spec 24 §16). `validateQueryParams()` checks the allowed set and each value's type/range.
- **Explicitly left open (decided at implementation gate, §15):** whether *unrecognized* query parameters are ignored or rejected. Rejecting is stricter and matches the unknown-field posture for bodies (§5 #7); ignoring is friendlier to cache-busters and analytics params. This plan records both options and defers the decision.

---

## 8. Standard Validation Error

All validation failures produce exactly the spec 24 §6 error envelope:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_request_body",
    "message": "We could not read that request. Please check the request and try again."
  }
}
```

- Status: `400`.
- The `invalid_request_body` code is reused for *all* validation failure classes (body, path, query) per spec 24 §19 — no new code per route or per failure type, keeping the frontend's error surface small and stable even as checks get stricter.
- Message text may become mildly more specific at implementation time ("A required field is missing") but only within the safe-error rules below.

---

## 9. Safe Error Rules

Restated as unconditional constraints on every validation failure message (spec 20 §11, spec 21 §13, spec 24 §20):

- Never leak policy text, secrets/tokens, private or public file URLs, stack traces, or internal identifiers (table/column/query names, parser internals).
- Never leak another account's identifiers.
- Never enumerate the full expected schema in an error response (that is documentation's job, not the error surface's).
- Ownership/existence ambiguity is preserved: validation errors are about the *request's* shape, and must never reveal whether a referenced resource exists.

---

## 10. Validation Order

Per spec 20 §9 and the call order spec 23 already integrated:

1. `requireSession()` — identity first.
2. Role/membership guards that do **not** depend on the body (`requireAccountMembership`, `requireReviewerRole`, etc.).
3. **Validation** — path params, query params, body shape (this plan's helpers).
4. Guards that **do** depend on validated body/path contents (`requireOwnership`, spec 25's review-item scope guard).
5. Business logic (currently `notImplemented()` 501 placeholders).

Validation running before body-dependent guards means a guard never operates on unvalidated input; validation running after identity means unauthenticated callers can't probe schema behavior.

---

## 11. Route-by-Route Validation Needs

| Route | Method | Body schema (spec 24) | Path params | Query params |
|---|---|---|---|---|
| `/api/health` | GET | — | — | — |
| `/api/session` | GET | — | — | — |
| `/api/uploads/init` | POST | §10 upload init | — | — |
| `/api/uploads/:upload_id/files` | POST | §11 file registration | `upload_id` | — |
| `/api/analyses` | POST | §12 analysis creation | — | — |
| `/api/analyses/:analysis_id/status` | GET | — | `analysis_id` | — |
| `/api/analyses/:analysis_id/report` | GET | — | `analysis_id` | — |
| `/api/analyses/:analysis_id/answers` | POST | §15 answer request | `analysis_id` | — |
| `/api/review/queue` | GET | — | — | pagination (§16, proposed) |
| `/api/review/items/:item_id` | PATCH | §17 review item update | `item_id` | — |
| `/api/audit-events` | POST | §18 audit event creation | — | — |

Every "Body schema" cell references the spec 24 section defining the target shape; this plan adds no new shapes.

---

## 12. Upload / File Registration Placeholders

The upload-init (§10) and file-registration (§11) schemas in spec 24 describe request *shapes* only. Their validation here is likewise shape-only placeholders: whether a registered file is actually acceptable (type, size, storage rules) is governed by the storage/bucket gates in spec 19, which remain unapproved. Nothing in this plan creates a bucket, accepts a real file, or defines storage policy.

---

## 13. Ownership & Reviewer-Scope Deferral

Validation helpers confirm a request is *well-formed*. They never confirm the caller may *act* on what the request references:

- Ownership of `upload_id` / `analysis_id` remains `requireOwnership()`'s job (spec 22 §6, spec 12 §6/§7).
- Review-item scope (`item_id`) remains the dedicated scope guard's job (spec 25).
- Account membership remains `requireAccountMembership()`'s job (spec 22 §8).

A validation pass must never be interpreted, logged, or documented as an authorization pass.

---

## 14. Do-Not-Build-Yet Items

Named here so they are not built ad hoc during implementation:

- Per-route schema **definitions as code** (the shape objects/library schemas themselves).
- Any validation **library/dependency** installation.
- Content/business validation (coverage categories, policy semantics — pipeline-owned, specs 02–09).
- File-type/size/storage validation (spec 19 gated).
- Rate limiting, abuse throttling, request-size caps (not yet planned in any spec; would need its own plan).
- Any logging of request bodies or field values in validation failures (audit events log *that* validation failed, never the offending contents — consistent with `audit.js` no-payload rules).

---

## 15. Approval Required Before Implementation

Each of the following requires **explicit approval from Rex before the action**, independent of this plan's existence:

- Creating any of the proposed validation helper functions for the first time
- Extending `validateRequestBody()` with real schema enforcement
- Deciding the schema representation format (§5, explicitly left open here)
- Deciding whether unrecognized query parameters are ignored or rejected (§7, explicitly left open here)
- Installing any validation package/dependency
- Modifying any route file to use a new validation helper
- Confirming the Supabase project/provider, applying migrations, connecting auth, or creating buckets (spec 19)
- Adding any environment variable or secret
- Deploying anything
- Staging, committing, or pushing this document or any resulting validation code

Gates are independent; approving one does not approve another.

---

## 16. Out-of-Scope

This plan does **not**:

- Modify specs 01–25, any SQL migration, any route file, or the shared guard module.
- Create any validation helper code or install any package.
- Add any environment variable or secret.
- Connect to Supabase, configure auth, apply migrations, or create buckets.
- Build backend functionality or frontend UI.
- Deploy anything.
- Stage, commit, or push anything without separate explicit approval.
- Introduce new product requirements — it plans only what specs 20, 21, 22, 23, 24, and 25, and the existing pushed route/guard skeletons, already define.

**Explicit restatement, as required:** this plan does not implement validation code. Every helper described here (§5–§9) remains a design description until a separate, explicitly approved implementation step.

---

*End of v1.0 API Validation Helper Plan. Defines the proposed request-body, path-parameter, and query-parameter validation helpers (`validateRequestBody` extension, `validatePathParam`, `validateQueryParams`, `requireUuid`, `requireAllowedEnum`, `requireSafeString`, `rejectUnknownFields`, `validationError`), their fail-closed behavior, the standard validation error shape built on the spec 24 envelope, and the route-by-route validation needs table. It creates no validation code, installs no package, and authorizes no implementation; every action remains separately gated.*
