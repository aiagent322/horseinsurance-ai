# Horse Insurance Coverage Checkup™
## Authentication, Account & User-Isolation Specification — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Implementation Reference
**Scope:** Identity, ownership, and access enforcement only. Defines how users authenticate, how accounts and roles are represented, and how every artifact in the pipeline is isolated to its owner. Does not select or integrate an auth provider, define schemas/migrations, or define reviewer/admin UI.

---

## 1. Purpose

Spec 11 §17 requires per-user isolation — every analysis, file, report, and audit record scoped to its owner, with no cross-user read path — but it does not define the identity model that makes isolation enforceable. Isolation is meaningless without a definition of *who a user is*, *what they own*, and *how ownership is checked on every access*. This document owns that definition.

Auth and isolation are the foundation the entire product's privacy posture rests on. Uploaded policies are sensitive personal/financial documents (spec 01 §4/§14, spec 11 §15/§17); a single missing ownership check exposes one user's policy to another. This spec therefore treats **ownership as a required property of every artifact** and **an ownership check as a required precondition of every access** — not as a feature to be added, but as an invariant the system cannot violate and still function.

This spec is provider-agnostic. No auth provider is selected here — the repository contains no existing auth integration, so none is assumed. Supabase Auth, Clerk, Auth0, or an equivalent managed provider may satisfy the requirements below; choosing and integrating one is a build decision (§18), constrained only by the requirement that it produce the identity and session properties this spec defines.

**Governing constraint:** in production mode, no policy upload, analysis, or report exists without an authenticated owner, and no artifact is ever accessed without verifying the requester owns it (or holds an audited, role-limited exception, §13). Isolation fails closed (§17) — a missing or unverifiable owner denies access; it never defaults open.

---

## 2. Auth and Account Overview

- **Authentication** establishes *who is making a request* — a verified user identity — via a managed auth provider (§18), surfaced to the orchestration API (spec 11 §3) as a trusted session identity.
- **Authorization/isolation** establishes *what that identity may access* — enforced by the orchestration API on every request against artifact ownership.
- The **static frontend holds no authority** (spec 11 §3): it carries a session token and displays what the API returns, but every access decision is made server-side. A compromised or manipulated frontend cannot grant itself another user's data because the API re-checks ownership on every call.
- The **orchestration API is the sole enforcement point.** It is the only layer with storage/model credentials (spec 11 §3/§17) and the only place ownership is verified. There is no path to policy content that bypasses it.

---

## 3. User Identity Model

A **user** is a single authenticated human principal. Required identity fields:

| Field | Meaning | Notes |
|---|---|---|
| `user_id` | Stable, unique identifier for the user | Opaque; never derived from email/name/policy content (spec 11 §17). The canonical subject every artifact's ownership resolves to. |
| `account_id` | The account the user belongs to | For MVP, typically 1:1 with `user_id` (a personal account), but modeled separately so future multi-user accounts don't require re-keying artifacts (§4). |
| `user_role` | The user's role | One of the roles in §4; governs access scope (§6). Default for a self-signup consumer is `owner` of their own account. |
| `session_identity` | The verified identity on the current request | Produced by the auth provider, validated by the API per request (§5); carries `user_id`, `account_id`, `user_role`. |

Rules:
- `user_id` is the **canonical owner reference.** Every ownable artifact (§8–§12) stores an owner that resolves to a `user_id` (and, where accounts group users, an `account_id`).
- Identity fields are internal; they are never placed in public URLs, logs, or client-visible content beyond what the user needs to see their own account (spec 11 §17).
- A request with no resolvable `session_identity` is unauthenticated and, in production mode, cannot upload or generate (§6).

---

## 4. Account Model

An **account** is the ownership boundary that groups a user's artifacts.

| Field | Meaning |
|---|---|
| `account_id` | Stable, unique account identifier — the top-level isolation boundary |
| `account_owner_user_id` | The `user_id` that owns the account |
| `member_user_ids` | Users belonging to the account (MVP: just the owner; modeled for future multi-seat) |
| `account_status` | Active / suspended / pending-deletion (§15) |

**Roles** (`user_role`), each scoping access (§6):

| Role | Scope |
|---|---|
| `owner` | Full access to their own account's artifacts (uploads, analyses, reports, their own audit view, deletion/export). The default consumer role. |
| `reviewer` | Role-limited, audited access to items **routed to review** (spec 08 §11, spec 09 §12, spec 10 §10) — and only those items, only for the review purpose (§13). |
| `admin` | Role-limited, audited operational access (§13); never a blanket read of all policy content. |

Rules:
- **MVP is single-user accounts** (1 user : 1 account), but the account layer is modeled explicitly so artifacts are keyed to `account_id` + `user_id` from the start — avoiding a painful re-key if multi-user accounts arrive later.
- A user's role is a property of their identity within an account; `reviewer`/`admin` are operational roles held by staff, not consumer self-signup roles (§13).
- Account status gates access: a suspended or pending-deletion account (§15) does not serve normal artifact access.

---

## 5. Session Model

- A **session** is an authenticated period tied to a `session_identity`, established by the auth provider after the user authenticates.
- Every API request carries the session token; the orchestration API **validates it per request** and resolves `user_id`, `account_id`, `user_role` before any access decision. No request is served on an unvalidated or assumed identity.
- **Sessions expire.** An expired or invalid session is treated as unauthenticated (§17): the request is denied and, in production, the user must re-authenticate before uploading, viewing, or generating.
- The session identity is **the only source of the requester's identity** — the API never trusts a `user_id`/`account_id` supplied in the request body or URL over the one in the validated session. A request claiming to act for another user is an unauthorized cross-account attempt (§17), regardless of what the body says.
- Session establishment, refresh, and revocation are provider responsibilities (§18); this spec requires only that the provider yield a per-request-validatable identity with the three fields above.

---

## 6. Access Control Rules

The core rules, enforced by the orchestration API on every request:

- **A user can only view their own uploads** (§8).
- **A user can only view their own analysis results** (§9) — including source snippets, extracted policy text, confidence, and verification records tied to their analyses.
- **A user can only view their own reports** (§10).
- **A user cannot access another user's** source snippets, policy text, files, audit records, or review state — under any request shape (§7).
- **Reviewer/admin access is role-limited and audited** (§13) — scoped to the specific items and purpose their role permits, never a blanket read, and every access recorded.
- **Reviewer/admin access never creates public access** to private policy content (§13, spec 11 §17). A role exception widens *who internal* may see an item for a purpose; it never makes content public or indexable.
- **Unauthenticated users cannot upload policies or generate reports in production mode.** (A non-production/demo mode, if any, is out of scope and must never touch real user policy content.)

Enforcement principle: **default deny.** Access is granted only when the validated session identity is verified to own the requested artifact (or holds a role exception for it). Absence of a positive ownership match is a denial, never a pass (§17).

---

## 7. Per-User Data Isolation

Isolation is enforced at the artifact level for every ownable type (spec 11 §6–§8, §17):

- Every ownable artifact stores an owner (`account_id` + `user_id`); a query for an artifact always filters by the requester's validated identity, so cross-user rows are never returned in the first place — isolation is enforced at retrieval, not by post-filtering results that were already fetched.
- **No cross-user read path exists.** There is no API route, query, or report assembly step that can return one user's policy content to another. Batching (spec 11 §12) already forbids mixing users; that constraint is an instance of this rule.
- Isolation covers the **full artifact set**: original files (§8), extracted text and source snippets, `PolicyAnalysis` (§9), confidence and verification records, reports (§10), audit records (§11), and review-queue state (§12).
- **Snippets and extracted policy text are isolated as strictly as files.** A source snippet is verbatim policy content; exposing another user's snippet is exactly as much a breach as exposing their file. Verification records, which carry snippets to justify decisions (spec 09, spec 11 §8), inherit the owning analysis's isolation.

---

## 8. Upload Ownership Rules

- Every uploaded file has an **`upload_owner`** = the `user_id`/`account_id` of the authenticated session that performed the upload (spec 11 §4). Ownership is set at the moment of receipt, server-side, from the validated session — never from a client-supplied field.
- An **upload without a resolvable owner cannot exist** in production (§17): if the session can't be validated, the upload is rejected before storage.
- The upload owner is the root of the ownership chain: the `analysis_id`/`upload_id` created for it (spec 11 §4) inherit the same owner, and everything derived downstream (§9–§12) carries it forward.
- Only the upload owner (or an audited role exception, §13) may access the original file (spec 11 §5).

---

## 9. PolicyAnalysis Ownership Rules

- Every `PolicyAnalysis` record (spec 07, spec 11 §6) has a **`policy_analysis_owner`** inherited from the upload that produced it (§8). One analysis belongs to one user/account.
- All artifacts *inside* the analysis — clauses, coverages, exclusions, conditions, source refs, confidence results, verification results (spec 11 §6/§7) — share the analysis's owner and isolation. There is no separately accessible sub-record that escapes the parent's ownership.
- The analysis is **not shared across users, not public, not search-indexed** (spec 11 §6). A request for an analysis resolves only if the validated session owns it.
- Generation and verification (specs 04/09) operate on the owner's analysis only; no stage assembles content across owners (an instance of §7 / spec 11 §12).

---

## 10. Report Access Rules

- Every report has a **`report_owner`** inherited from its analysis (§9). Only the report owner may view, download, or export it.
- Reports are served **only via the credentialed API** to the owning session, using short-lived, user-scoped signed access where a file is downloaded (spec 11 §5). No durable public link, no content-addressable public URL.
- A **report requested by a non-owner is denied** (§17) — the request resolves to no accessible report, and the attempt is audited as an unauthorized cross-account access (§11/§17).
- Reports contain **only verified content** that passed spec 09 (spec 10 §5, spec 11 §1); ownership rules govern *who* sees the report, verification governs *what* the report contains — both apply.
- A report whose source maps have been purged (spec 11 §15) is treated as expired and is not served, independent of ownership.

---

## 11. Audit Trail Access Rules

- Every audit record has an **`audit_owner`** inherited from the analysis it describes (spec 10 §13, spec 11 §8). Audit records are internal and are **never returned to the frontend** for any user (spec 11 §8).
- A user does **not** get raw access to the audit trail; a user may receive, as part of export (§14), an account-scoped summary of *their own* report/account history, but the internal stage-transition audit log is an operational/compliance artifact, not consumer-facing.
- **Reviewer/admin** access to audit records is role-limited and itself audited (§13): viewing an audit record is an access event that is recorded.
- Audit records store **IDs, labels, reasons, and timestamps — not policy text** (spec 10 §13, spec 11 §8/§17). This keeps the audit trail low-sensitivity and means audit access, even under a role exception, does not expose verbatim policy content.
- **No cross-account audit access** for `owner`-role users: a user can never see another user's audit records (§7).

---

## 12. Review Queue Access Rules

- Review-queue routing state (spec 11 §7) has an owner (the analysis's owner) for isolation, and a **visibility scope** governing which *reviewer* may see it.
- **`owner`-role users have no access to the review queue** — it is an internal operational surface. A user sees the *result* (a rescoped/replaced/insufficient-evidence answer per specs 09/10), never the queue itself or the fact that their item was routed.
- **Reviewers see only items routed to review** (spec 08 §11, spec 09 §12, spec 10 §10), and only for the review purpose (§13). A reviewer's visibility is the set of review-routed items, not a general view of all analyses.
- Review-queue access by a reviewer is **audited** (§11/§13): which reviewer accessed which item, when, recorded as an access event without duplicating policy text into the general log.
- Review-queue state is subject to the same retention as its analysis (spec 11 §15).

---

## 13. Admin / Reviewer Access

Role exceptions exist for operations (review routing per spec 10 §10) but are tightly bounded:

- **Role-limited.** A `reviewer` may access only items routed to review, only the content needed to make the review decision (the statement, its cited snippet, its verification finding), and only for that purpose. An `admin` holds operational access defined by specific need, never a blanket read of all policy content.
- **Audited.** Every reviewer/admin access to a private artifact is recorded as an access event (§11) — who, what item, when, why. Role access is not silent.
- **Never public.** A role exception widens internal visibility for a purpose; it **never** makes content public, indexable, or reachable by a durable public URL (spec 11 §17). There is no role that converts private policy content into public content.
- **Never above ownership for consumers.** Roles do not let one consumer view another consumer's data; `reviewer`/`admin` are staff operational roles, distinct from the consumer `owner` role, and are not grantable by self-signup.
- **Reviewers cannot raise support above source.** Consistent with spec 09 §12 / spec 10 §10, a reviewer's decisions are bounded (approve/lower/suppress); the access role does not carry authority to approve content its source doesn't support.
- Reviewer/admin *tooling and workflow* are out of scope (§18); this spec defines only the access *boundary* those roles operate within.

---

## 14. User Export and Deletion

Carried from spec 11 §15's user-deletion/export commitment, defined here at the access layer:

**Export:**
- A user may request **export of their final reports and available account records** — their own reports in a portable form, plus account-scoped history they're entitled to (spec 11 §15).
- Export returns **only the requesting user's own data** (§7); it is never a channel to another user's content.

**Deletion:**
- A user may request **deletion of their uploaded files and derived analysis artifacts where permitted** (spec 11 §15). Deletion purges the original file, intermediate extracted text, source maps, confidence/verification results, and report for that analysis.
- **Deletion creates an audit record without storing unnecessary policy text** (spec 11 §8/§15): the record notes that the user deleted the analysis, when, and by whom — not the policy content that was deleted.
- **Retention windows remain subject to compliance sign-off** and reference **spec 11 §15**: the *posture* (conservative, need-bound, user-deletable, no indefinite retention, no public indexing) is fixed; the exact day/month windows are a compliance decision, not settled here (spec 01 §14, spec 11 §15/§19). Where a compliance-required retention obligation conflicts with a deletion request, the compliance obligation governs the specific retained artifact, and that retention is disclosed rather than silently overriding the user's request.

---

## 15. Account Lifecycle

| State | Meaning | Access effect |
|---|---|---|
| **Pending** | Account created, not yet verified/active | Cannot upload/generate in production until active |
| **Active** | Normal state | Full `owner` access to own artifacts |
| **Suspended** | Administratively paused | Normal artifact access denied; data retained per spec 11 §15 pending resolution |
| **Pending-deletion** | User requested deletion (§14); purge in progress/scheduled | Access wound down; artifacts purged per spec 11 §15; deletion audit record created |
| **Closed** | Account closed, artifacts purged | No artifact access; only the compliance-retained audit record of closure remains, without policy text |

Rules:
- Account state gates access: only `active` accounts get normal artifact access; every other state denies or winds down access (§17 fails closed).
- Lifecycle transitions (create/suspend/delete/close) are audited as account events (§11), without policy text.
- Deletion/closure honor the spec 11 §15 retention posture and the §14 deletion rules.

---

## 16. Security Requirements

Carried from and consistent with spec 11 §17:

| Requirement | Rule |
|---|---|
| **Private upload access** | Files are private user data; reachable only by the owner through the credentialed API (§8, spec 11 §5). |
| **Per-user isolation** | Every artifact scoped to `account_id`/`user_id`; enforced at retrieval; no cross-user read path (§7). |
| **Signed/private file access** | Owner file/report retrieval via short-lived, user-scoped signed access; never durable public links (§10, spec 11 §5). |
| **No policy text in public URLs** | Opaque IDs only; URLs never derived from insured name, file name, or policy content (§3, spec 11 §17). |
| **No sensitive policy content in logs** | Operational logs record events/IDs/statuses, never verbatim policy text or insured PII (spec 11 §17). |
| **Audit records events, not exposure** | Audit/access records carry IDs, roles, reasons, timestamps — not unnecessary policy text (§11, spec 11 §8). |
| **Session validated per request** | Identity resolved and ownership checked on every request; request-body identity never trusted over session (§5). |
| **Default deny / fail closed** | Absence of a positive ownership match denies access; a failed identity/isolation check blocks, never defaults open (§17). |

The controlling principle mirrors spec 11: policy content is exposed only to its owner, only through the credentialed API, only while retention permits — and role exceptions widen internal visibility for a bounded purpose without ever creating public access.

---

## 17. Failure States

All failures **fail closed** — deny access and audit the event; never default open (spec 10 §11, spec 11 §18).

| Failure | Behavior |
|---|---|
| **Missing user id** | Request treated as unauthenticated; in production, upload/generate/view denied; re-authentication required. |
| **Missing account id** | Ownership cannot be resolved; access denied; the artifact is not served. An artifact that somehow lacks an account owner is quarantined from access (see next two rows), not served to a guessed owner. |
| **Upload without owner** | Cannot occur in production (§8) — upload is rejected pre-storage if the session can't be validated. If an ownerless upload is detected (data-integrity fault), it is inaccessible and flagged, never served. |
| **PolicyAnalysis without owner** | The analysis is inaccessible (no owner to match a requester against) and flagged as an integrity fault; it is never served to any user (§9). |
| **Report requested by non-owner** | Denied; resolves to no accessible report; attempt audited as unauthorized cross-account access. |
| **Expired session** | Treated as unauthenticated (§5); request denied; user must re-authenticate. |
| **Reviewer role missing** | A request needing `reviewer`/`admin` scope from an identity lacking that role is denied (default deny, §6/§13); attempt audited. |
| **Unauthorized cross-account access attempt** | Denied and audited as a security event (who attempted, what artifact, when — no policy text); never served, regardless of request-body claims (§5). |

Rule: every failure above produces a **denial plus an audit record** (event, IDs, reason, timestamp — no unnecessary policy text). A silent failure that neither serves nor audits is itself a defect.

---

## 18. Out-of-Scope

This specification does **not** cover:

- **Actual auth provider integration** — Supabase Auth / Clerk / Auth0 / equivalent are options; selecting and wiring one is a build decision. The repository selects none today, so none is assumed. This spec fixes only the identity/session *properties* any provider must yield.
- **Database migrations and schemas** — ownership *responsibility and access rules* are fixed; the concrete keying of `account_id`/`user_id` onto tables is a build artifact against spec 07/11, not deployed without approval.
- **Backend routes / application code** — no route or Worker code is defined here.
- **Payment / subscription logic** — account tiers, billing, and entitlements are out of scope; this spec covers identity and isolation only.
- **Reviewer UI, assignment, SLAs, and workflow** — this spec defines the *access boundary* for reviewer/admin roles (§13); the tooling and operations are out of scope (deferred across specs 08–12).
- **Password reset / auth UI flows** — provider responsibilities; not defined here.
- **Legal/compliance approval of exact retention windows** — the posture and tiering are fixed in spec 11 §15 and referenced in §14; the numeric windows are a compliance sign-off item, not settled here (spec 01 §14).

---

*End of v1.0 Authentication, Account & User-Isolation Specification. This document defines the identity, account, role, and session model, and the ownership-and-access rules that make spec 11 §17's per-user isolation enforceable — provider-agnostic, default-deny, fail-closed, with role-limited audited reviewer/admin access that never creates public exposure of private policy content. It introduces no new pipeline logic and defers retention windows to spec 11 §15 / compliance.*
