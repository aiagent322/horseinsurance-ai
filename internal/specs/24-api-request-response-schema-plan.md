# Horse Insurance Coverage Checkup™
## API Request/Response Schema Plan — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Schema Planning (pre-implementation)
**Scope:** A **planning document** for the expected request bodies, path parameters, query parameters, response envelopes, and error shapes for the `functions/api/*` route skeletons. Describes intended schemas in prose/tables. Modifies no route file, no guard module file, no spec, no migration. Every implementation action is separately gated (§22).

---

## 1. Purpose

Specs 20–23 established the route surface, the shared guard module, and how routes call it — but none of them fixes the actual **shape** of a request body or response payload for any route. Right now every route's placeholder response is the generic `{ ok: false, error: { code, message } }` or `{ ok: true, data }` envelope with no route-specific field list, and no route validates a body against a defined shape (`validateRequestBody()` currently only checks that a body, if present, is parseable JSON — spec 22 §11 explicitly scopes it that way).

This document is that missing shape definition, at the planning level. It exists so that when real request validation and real response payloads are eventually implemented, there is an agreed schema to build against — the same planning-before-code discipline specs 16–23 already established for schema, RLS, routes, and guards.

This document describes intent only. It modifies no route file and no guard module file. The line it does not cross: **no route code, no validation logic, no Supabase connection, no auth config** (§21, §22). It is a plan a reviewer approves before schema implementation begins.

**Governing constraint:** producing this plan starts no backend, frontend, Supabase, auth, or deployment work (spec 15 §8, spec 20 §17/§18, spec 21 §17/§18, spec 22 §16/§17, spec 23 §12/§13). Each such action remains its own approval gate.

---

## 2. Source Documents

| Document | Contribution |
|---|---|
| **10 — Runtime Orchestration** | The seven-stage pipeline whose stage/progress values this plan's status schema must be able to express |
| **12 — Auth, Account & Isolation** | Identity model (`user_id`/`account_id`/`user_role`) that scopes every user-owned/reviewer response |
| **16 — Phase 1 Persistence Schema Model** | The underlying object shapes (`policy_analyses`, `coverage_objects`, `report_sections`, etc.) this plan's response fields are expected to eventually surface a subset of |
| **20 — API Proxy Skeleton Plan** | The eleven routes and their original purpose/response-shape expectations (§10 response shape standards) |
| **21 — Supabase Client Wiring Plan** | Error-handling rules (indistinguishable denials, no internal detail leaked) this plan's error schema inherits |
| **22 — API Guard Module Plan** | `validateRequestBody()`'s current scope (shape/parseability only, no schema enforcement yet) and `safeJson`/`safeError`'s existing envelope |
| **23 — API Route Guard Integration Plan** | Which routes currently call `validateRequestBody()`, confirming which routes this plan needs to define a body schema for |
| **functions/README.md, functions/api/\*, shared guard module skeleton** | The actual pushed code — current envelope shape (`{ ok, data }` / `{ ok, error: { code, message } }`), current route list, and current guard usage this plan is grounded against |

No requirement outside these documents is introduced.

---

## 3. Current Gate Status

As of this writing:

- All eleven routes are non-functional skeletons; every protected route fails closed via the shared guard module (spec 22, spec 23).
- The response envelope actually implemented in `functions/api/_lib/responses.js` is: success = `{ ok: true, data }`; error = `{ ok: false, error: { code, message } }`. This plan does not propose changing that envelope shape — it proposes what goes **inside** `data` and what `code`/`message` values are expected per route.
- `validateRequestBody()` (spec 22 §11) currently performs only a safe placeholder check — parses JSON if a body is present, rejects unparseable input — with **no per-route schema enforcement**. This plan defines what that per-route schema *would* be, without implementing the enforcement.
- No Supabase project is confirmed; no migration is applied; no auth is connected (spec 19 §2, unchanged).
- This plan does not change any of the above.

---

## 4. Schema Design Rules

- **Envelope shape is fixed and already implemented** — this plan works within `{ ok, data }` / `{ ok, error: { code, message } }`, not around it.
- **Every field name proposed below is illustrative of the intended shape, not yet enforced** — no route currently returns any of these fields; they are all inside `TODO(implementation)`-marked, currently-unreached code paths.
- **No schema proposed here may include:** raw policy text, secrets/tokens, private or public file URLs, internal error detail (stack traces, table/query names), or another account's identifiers — consistent with spec 20 §10/§11 and spec 21 §13.
- **Every user-owned or reviewer-owned schema is scoped to the resolved session identity** — a response schema never includes a field that would require exposing data beyond what the requester's own `user_id`/`account_id` (or `reviewer`/`admin` role) already permits per spec 12.
- **IDs are opaque** — `upload_id`, `policy_analysis_id`, `report_id`/`analysis_id`, and `item_id` are treated as opaque identifiers in every schema below, never derived from or exposing policy content, insured name, or file name (spec 11 §5, spec 16 §3).
- **No route accepts or processes real policy files yet.** Upload initialization and file registration schemas are placeholders only until the database, auth, storage buckets, RLS, environment configuration, and production upload gate are explicitly approved and verified.

---

## 5. Standard Success Envelope

```json
{
  "ok": true,
  "data": { }
}
```

- `ok`: always `true` on success.
- `data`: route-specific payload (see §8–§18 for shape per route); `null` when a route has nothing to return (rare, but the envelope already supports it per the existing `jsonOk`/`safeJson` implementation, which defaults `data` to `null` if omitted).

---

## 6. Standard Error Envelope

```json
{
  "ok": false,
  "error": {
    "code": "string",
    "message": "string"
  }
}
```

- `ok`: always `false` on error.
- `error.code`: a fixed, machine-readable code (see §20 for the standard code list) — never a raw exception name or internal identifier.
- `error.message`: plain-language, non-technical, consumer-safe text (spec 20 §11) — never a stack trace, query fragment, or policy-text excerpt.

### Validation Error Response

```json
{
  "ok": false,
  "error": {
    "code": "invalid_request_body",
    "message": "We could not read that request. Please check the request and try again."
  }
}
```
(Already implemented in `guards.js`'s `validateRequestBody()` for the parseability case; this plan extends the same `code` for future per-route schema-validation failures, so the code stays stable even as the underlying check gets stricter.)

### Unauthorized Response

```json
{
  "ok": false,
  "error": {
    "code": "unauthenticated",
    "message": "You must be signed in to do this."
  }
}
```
Status: `401`. (Already implemented as `unauthenticated()`.)

### Forbidden Response

```json
{
  "ok": false,
  "error": {
    "code": "forbidden",
    "message": "You don't have access to this."
  }
}
```
Status: `403`. (Already implemented as `forbidden()`.) Per spec 20 §11/§21 §13, this same shape covers both "not yours" and "doesn't exist" — the two are never distinguished in the response.

### Not Implemented Response

```json
{
  "ok": false,
  "error": {
    "code": "not_implemented",
    "message": "This endpoint (<ROUTE>) is a skeleton placeholder and is not implemented yet."
  }
}
```
Status: `501`. (Already implemented as `notImplemented()` / the equivalent literal `safeError(...)` calls per spec 23.)

---

## 7. Route Inventory

| Route | Method | Auth/role required | Body? | Path params | Query params |
|---|---|---|---|---|---|
| `/api/health` | GET | none (public) | no | none | none |
| `/api/session` | GET | session | no | none | none |
| `/api/uploads/init` | POST | session, account membership | yes | none | none |
| `/api/uploads/:upload_id/files` | POST | session, account membership, ownership | yes | `upload_id` | none |
| `/api/analyses` | POST | session, account membership, ownership | yes | none | none |
| `/api/analyses/:analysis_id/status` | GET | session, ownership | no | `analysis_id` | none |
| `/api/analyses/:analysis_id/report` | GET | session, ownership | no | `analysis_id` | none |
| `/api/analyses/:analysis_id/answers` | POST | session, ownership | yes | `analysis_id` | none |
| `/api/review/queue` | GET | session, reviewer/admin role | no | none | proposed: pagination (see §16) |
| `/api/review/items/:item_id` | PATCH | session, reviewer/admin role, item scope | yes | `item_id` | none |
| `/api/audit-events` | POST | session (placeholder) + service context | yes | none | none |

---

## 8. Health / Status Schema

**Request:** no body, no params.

**Response (`data`):**
```json
{
  "status": "ok",
  "service": "horseinsurance-ai-coverage-checkup-api",
  "mode": "skeleton"
}
```
Matches the field names already returned by the implemented `health.js`. No auth-scoped content — safe for public/unauthenticated access (spec 20 §8).

---

## 9. Session Check Schema

**Request:** no body, no params. Session identity comes from the request's session token (cookie/header), not a field.

**Response (`data`, once implemented):**
```json
{
  "user_id": "string (opaque)",
  "account_id": "string (opaque)",
  "user_role": "owner | reviewer | admin"
}
```
Never includes email, name, or any other PII beyond what the session itself already carries — this plan proposes the minimal identity triple per spec 12 §3.

---

## 10. Upload Initialization Schema

**Request body (proposed):**
```json
{
  "document_count_hint": "integer (optional)"
}
```
Minimal — this route creates the upload/analysis container before any file exists, so the only proposed input is an optional hint the frontend may already know (e.g., how many files the user selected), never file content itself (spec 06, task rule "no route may accept or process real policy files yet").

**Response (`data`, once implemented):**
```json
{
  "upload_id": "string (opaque)",
  "policy_analysis_id": "string (opaque)"
}
```

---

## 11. Private Upload File Registration Schema

**Path param:** `upload_id`

**Request body (proposed):**
```json
{
  "file_name": "string",
  "file_type": "pdf | jpg | png | heic",
  "object_storage_key": "string (opaque, server-assigned reference — never a public URL)"
}
```
Per spec 11 §5/§18 §17: the actual file bytes are never in this request body — the body only registers a reference to a private object already written via a separate, signed upload mechanism (out of scope for this plan). No field in this schema is or contains a URL.

**Response (`data`, once implemented):**
```json
{
  "upload_id": "string (opaque)",
  "file_id": "string (opaque)",
  "registered": true
}
```
No `url` field of any kind — consistent with "no route may expose private file URLs."

---

## 12. Analysis Creation Schema

**Request body (proposed):**
```json
{
  "upload_id": "string (opaque)"
}
```
Per the existing `TODO(ownership)` note already in `analyses/index.js`: this is the field the real ownership check must extract instead of the current placeholder `null`.

**Response (`data`, once implemented):**
```json
{
  "policy_analysis_id": "string (opaque)",
  "status": "queued"
}
```
Returns a processing-status handle, never a blocking full pipeline result (spec 10 §5, spec 20 §4).

---

## 13. Analysis Status Schema

**Path param:** `analysis_id`

**Request:** no body.

**Response (`data`, once implemented):**
```json
{
  "policy_analysis_id": "string (opaque)",
  "stage": "extract | classify | model | score_route | generate | verify | report",
  "progress": "queued | in_progress | complete | blocked | needs_review",
  "updated_at": "ISO 8601 UTC timestamp"
}
```
`stage` values map directly to spec 10 §3's seven pipeline stages. No raw extracted text, no policy text, no other user's data — a small, fixed set of values only (spec 20 §10).

---

## 14. Report Retrieval Schema

**Path param:** `analysis_id`

**Request:** no body.

**Response (`data`, once implemented):** a `report_sections`-shaped payload (spec 16 §15.5, spec 17 §4) — array of sections, each following the spec 05 report structure and spec 04 §16 answer-object shape (direct answer, coverage status, confidence label, source references, etc.). This plan does not redefine those already-fixed shapes; it only confirms the report route's `data` field is this array, wrapped once in the standard envelope (§5), and that it **never** includes a statement that hasn't passed spec 09 verification, and never includes a file URL of any kind.

---

## 15. Answer Request Schema

**Path param:** `analysis_id`

**Request body (proposed):**
```json
{
  "question": "string"
}
```
The only input is the consumer's plain-language question text — never a policy-document upload, never a file reference.

**Response (`data`, once implemented):** a single spec 04 §16 answer object (direct answer, coverage status, confidence label, source references, etc.) or the spec 04 §15 refusal shape when evidence is insufficient. This plan does not redefine that object shape, only confirms it is what populates `data` for this route.

---

## 16. Review Queue Listing Schema

**Request:** no body.

**Query params (proposed, optional):**
```
?status=pending|assigned|resolved
?limit=integer
?cursor=string (opaque, for pagination)
```
Pagination is proposed since a real review queue could grow large; this plan does not fix exact defaults/limits, only that cursor-based pagination is the intended shape rather than offset-based, to avoid unstable ordering across concurrent updates.

**Response (`data`, once implemented):**
```json
{
  "items": [
    {
      "item_id": "string (opaque)",
      "policy_analysis_id": "string (opaque)",
      "routing_reason": "string (short code, not policy text)",
      "status": "pending | assigned | resolved",
      "created_at": "ISO 8601 UTC timestamp"
    }
  ],
  "next_cursor": "string (opaque) | null"
}
```
Per spec 13 §12/spec 18 §16: never a general content listing, never another user's policy text — `routing_reason` is a short reason code, not free text describing document content.

---

## 17. Review Item Update Schema

**Path param:** `item_id`

**Request body (proposed):**
```json
{
  "decision": "approve | reject | escalate",
  "note": "string (optional, short reviewer note — reason code style, not verbatim policy text)"
}
```

**Response (`data`, once implemented):**
```json
{
  "item_id": "string (opaque)",
  "status": "resolved",
  "decision": "approve | reject | escalate"
}
```
Per spec 18 §14, this route never performs a raw delete — a review item is retired via status change, which this response schema reflects (`status: "resolved"`, not row removal).

---

## 18. Audit Event Creation Schema

**Request body (proposed, matching the existing `ALLOWED_FIELDS` whitelist in `audit.js`):**
```json
{
  "stage": "string",
  "objectId": "string (opaque)",
  "decision": "string",
  "reason": "string (short code, not free text)",
  "actorRole": "owner | reviewer | admin | service",
  "timestamp": "ISO 8601 UTC timestamp"
}
```
This schema is not new — it is the same fixed whitelist already structurally enforced by `auditSafeLog()` (spec 22 §13), restated here as the route's expected request body shape for consistency.

**Response (`data`, once implemented):**
```json
{
  "recorded": true
}
```
Minimal by design — this internal route has no reason to echo back anything beyond confirmation, since the caller (the orchestration layer itself) already has the data it just sent.

---

## 19. Validation Rules

- Every route with a body validates that body's **shape** (required fields present, correct types) before any guard that depends on the body's contents runs (spec 20 §9, already true structurally since `validateRequestBody()` is called before business logic in every integrated route per spec 23).
- **This plan does not implement per-route schema enforcement** — `validateRequestBody()` remains, as of this writing, a parseability-only check (spec 22 §11). The schemas in §10–§18 are the target shape a future, separately-approved implementation would validate against.
- Validation failures always use the `invalid_request_body` error code (§6) — this plan does not propose a different code per route, to keep the error surface small and predictable for the frontend.
- Path parameters (`upload_id`, `analysis_id`, `item_id`) are treated as opaque strings; this plan does not propose format validation (e.g., UUID regex) beyond "non-empty," since the real validation that matters is the ownership/scope check (spec 12 §6/§7), not string shape.

---

## 20. Safe Error Rules

- **Errors must never leak:** policy text, secrets/tokens, private or public file URLs, stack traces, internal identifiers (table/column/query names), or another account's identifiers — restated here as an unconditional constraint on every error schema in §6, per spec 20 §11 and spec 21 §13.
- **Standard error codes** (this plan's proposed fixed vocabulary, extending what's already implemented): `unauthenticated`, `forbidden`, `invalid_request_body`, `not_implemented`. Any future real-implementation error condition should map onto one of these four rather than inventing a new code per edge case, unless a genuinely new failure category is identified and separately approved.
- **Ownership/existence ambiguity is preserved in errors** — a `forbidden` response never reveals whether a resource exists for someone else vs. doesn't exist at all (§6, spec 12 §6/§7, spec 20 §11, spec 21 §13 already established this; restated here as a schema-level constraint).

---

## 21. Do-Not-Build-Yet Items

This plan does **not** authorize:

- Modifying any route file under `functions/api/*`
- Modifying the shared guard module (`guards.js`, `responses.js`, `audit.js`)
- Implementing real per-route request-body schema validation
- Implementing any of the response payloads described in §8–§18
- Creating any backend functionality
- Connecting to Supabase
- Configuring auth
- Adding any environment variable or secret
- Installing any package
- Building extraction, generation, verification, report, reviewer, or frontend logic
- Deploying anything

Writing and reviewing this plan is a planning action only.

---

## 22. Approval Required Before Implementation

Each of the following requires **explicit approval from Rex before the action**, independent of this plan's existence:

- Implementing real schema validation inside `validateRequestBody()` or a per-route validator
- Modifying any route file to return any of the `data` payloads described in §8–§18
- Confirming the Supabase project/provider, applying migrations, connecting auth, or creating buckets (spec 19)
- Adding any environment variable or secret
- Deploying anything
- Staging, committing, or pushing this document or any resulting schema-validation code

Gates are independent; approving one does not approve another.

---

## 23. Out-of-Scope

This plan does **not**:

- Modify specs 01–23, any SQL migration, any route file, or the shared guard module.
- Implement any validation logic or route functionality — every schema above is descriptive, not enforced.
- Connect to Supabase, configure auth, or add any environment variable/secret.
- Build backend functionality or frontend UI.
- Deploy anything.
- Stage, commit, or push anything without separate explicit approval.
- Introduce new product requirements — it plans only what specs 10, 12, 16, 20, 21, 22, and 23, and the existing pushed route/guard skeletons, already define.

---

*End of v1.0 API Request/Response Schema Plan. Defines the standard success/error envelopes (already implemented) and the proposed per-route request-body and response-payload shapes for all eleven routes, plus validation and safe-error rules. It implements no validation logic and no route functionality; every implementation action remains separately gated.*
