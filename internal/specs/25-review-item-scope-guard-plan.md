# Horse Insurance Coverage Checkup™
## Review Item Scope Guard Plan — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Guard Planning (pre-implementation)
**Scope:** A **planning document** for the dedicated guard that should eventually replace the placeholder use of `requireOwnership()` in `functions/api/review/items/[item_id].js`. Describes the intended guard's contract and behavior in prose. Creates no guard code, no route code, no Supabase connection, no auth config. Every implementation action is separately gated (§14).

---

## 1. Purpose

`functions/api/review/items/[item_id].js` currently calls `requireOwnership(sessionCheck.session, itemId)` as a stand-in for a scope check that confirms a specific reviewer/admin session is actually assigned to the specific queued item it's trying to update — a check that is conceptually distinct from ordinary resource ownership, but was implemented by reusing the existing guard because no dedicated one existed yet (per the in-code comment already documenting this as a known placeholder-of-a-placeholder, spec 23 §7).

This document exists so that gap can be closed properly: it defines what a dedicated `requireReviewItemScope()` guard should actually check, how it differs from `requireOwnership()`, and how it would integrate into the route — reviewed and approved before any real guard code is written, continuing the same planning-before-code discipline specs 16–24 already established.

This document describes intent only. It creates no guard function, modifies no route file, and modifies no part of the shared guard module. The line it does not cross: **no guard code, no route code, no Supabase connection, no auth config** (§13, §14). It is a plan a reviewer approves before implementation begins.

**Governing constraint:** producing this plan starts no backend, frontend, Supabase, auth, or deployment work (spec 15 §8, spec 22 §16/§17, spec 23 §12/§13). Each such action remains its own approval gate.

---

## 2. Source Documents

| Document | Contribution |
|---|---|
| **12 — Auth, Account & Isolation** | Identity model, role definitions (`owner`/`reviewer`/`admin`), default-deny access control, role-limited and audited reviewer/admin access |
| **13 — Reviewer Operations** | The actual review workflow this guard protects — routed-item-only access, reviewer sees only the specific item's decision content, three permitted outcomes, audit requirement, owner/account integrity faults handled distinctly |
| **18 — Phase 1 RLS Policy Plan** | `review_queue_entries` access rules: internal-only, owners have no access, reviewer read + limited update scoped to routed/assigned items, admin may reassign/escalate, entries retired via status not deleted |
| **22 — API Guard Module Plan** | The existing guard catalogue and fail-closed convention this new guard must follow |
| **23 — API Route Guard Integration Plan** | The explicit note flagging `requireOwnership()`'s reuse here as provisional, pending a dedicated scope check |
| **functions/api/review/items/[item_id].js** | The actual route this guard would integrate into, and its current placeholder call |
| **Shared API guard module skeleton** | The existing `{ ok, response }` fail-closed contract this new guard must match |

No requirement outside these documents is introduced.

---

## 3. Current Placeholder

```javascript
// TODO(ownership/scope): beyond the role check above, confirm this
// specific reviewer/admin session is actually assigned/scoped to
// :item_id before allowing any update (spec 13 §12, spec 18 §16) —
// a reviewer role alone does not grant access to every queued item.
// Reusing requireOwnership() here as the item-level scope check per
// internal/specs/23-api-route-guard-integration-plan.md §7; a real
// implementation may need a dedicated scope check distinct from
// resource ownership, but this placeholder keeps the same fail-closed
// shape until that decision is made.
const scopeCheck = requireOwnership(sessionCheck.session, itemId);
if (!scopeCheck.ok) {
  return scopeCheck.response;
}
```

This is safe today only because `requireOwnership()` unconditionally denies — it happens to produce the correct fail-closed result by coincidence of both guards currently doing nothing, not because `requireOwnership()`'s actual eventual logic (matching `account_id`/`user_id` ownership of a resource, spec 12 §7) is the right check for this situation.

---

## 4. Why `requireOwnership()` Is Not Final Here

- **`requireOwnership()`'s real, eventual purpose is resource ownership** (spec 12 §6/§7, spec 22 §7): confirming a session's `account_id`/`user_id` owns a specific artifact like an upload or analysis. A review queue item is not owned by an account in that sense — it is an internal operational record (spec 18 §16) that a reviewer is *assigned to work on*, not a consumer artifact anyone "owns."
- **Owners never have access to review queue entries at all** (spec 18 §16: "owners have no access"). If `requireOwnership()` were ever wired to its real logic and pointed at a review item, the natural implementation would check whether the *account* owns the item — but no consumer account owns a review item, so this would either always fail (masking a design mismatch) or require special-casing that conflates two different concepts under one function name.
- **Review-item access is an assignment/scope question, not an ownership question** (spec 13 §5: "Access routed queue items"; spec 18 §16: "Reviewer read + limited update — scoped to routed/assigned items"). The correct question is "is this reviewer assigned to this specific item," not "does this account own this item."
- **Conflating the two invites a future bug**: if `requireOwnership()` is implemented for real (for uploads/analyses) before this route is revisited, a developer skimming `review/items/[item_id].js` could reasonably assume it already has correct item-level scoping, when in fact it's borrowing unrelated logic that was never designed for this purpose.

---

## 5. Proposed Dedicated Guard

**`requireReviewItemScope(session, itemId)`**

- **Contract:** given a resolved session identity (already confirmed to hold `reviewer` or `admin` role via the existing `requireReviewerRole()` check, which remains a separate, prior guard in the chain) and a target `itemId`, returns whether that specific session is currently assigned/scoped to that specific review queue entry.
- **Distinct from `requireOwnership()`:** this guard never checks `account_id` ownership of the item — review items belong to the operational/reviewer domain (spec 18 §16), not the consumer account domain.
- **Distinct from `requireReviewerRole()`:** holding the reviewer/admin *role* is necessary but not sufficient (spec 13 §5, spec 22 §9) — this guard is the second, item-specific check that role check alone cannot answer.
- **Return shape:** matches the existing guard module convention exactly — `{ ok: boolean, response: Response|null }` — so route integration requires no change to the established `if (!check.ok) return check.response;` pattern.
- **Fail-closed default, as a placeholder:** until implemented for real, this guard (like every other guard in the module) always returns `{ ok: false, response: forbidden() }`.

---

## 6. Review Item Access Rules

- A reviewer or admin may access a review queue item **only if it has been routed and assigned/available to them** (spec 13 §2/§5, spec 18 §16) — never an arbitrary item by ID guess.
- Access is scoped to **the specific routed item's decision content only** — the statement, its cited snippet(s), page/section reference, confidence label, and verification result (spec 13 §2) — never the full underlying analysis or other users' data (spec 12 §7).
- **Review item access is not the same as normal owner access.** An `owner` session (a consumer) must never satisfy this guard under any circumstance, regardless of whether they somehow know or guess an `item_id` (spec 18 §16: "owners have no access").
- **Owners/users should not gain direct access to internal review queue entries unless explicitly supported later** — this plan does not propose any such consumer-facing access path, and none should be added without a separate, explicit product decision.

---

## 7. Reviewer Role Requirements

- This guard is **layered after**, not instead of, the existing `requireReviewerRole()` check — a route calling `requireReviewItemScope()` must already have confirmed the session holds `reviewer` or `admin` (spec 12 §4/§13).
- `admin` sessions are expected to satisfy this guard for **bounded operational actions** (reassignment, escalation — spec 13 §5, spec 18 §5 "Admin may reassign/escalate") in addition to ordinary item review, but this plan does not propose those specific admin-only actions be implemented now — only that the guard's design accommodate both roles consistently with their existing permission tables (spec 13 §5).
- A `reviewer` role alone, without item-specific assignment, must still fail this guard (§6) — role and scope are two independent, both-required conditions.

---

## 8. Assignment / Routed Item Requirements

- The guard's real implementation (not built by this plan) is expected to check, at minimum: (a) the item exists and has not been retired/resolved in a way that excludes further access (spec 18 §16, entries retired via status not deleted), and (b) the requesting reviewer/admin is the item's current assignee, or — depending on the eventual queue-assignment model spec 13's implementation settles on — any reviewer with general queue access if items aren't assigned to specific individuals in MVP.
- **This plan does not resolve which assignment model applies** (per-reviewer assignment vs. general reviewer-pool access to any routed item) — that is a product/operational decision belonging to spec 13's queue-UI implementation (spec 13 §17, out of scope there), not something this guard-planning document invents. Both models are compatible with the guard's proposed contract (§5); only the internal check differs.
- Regardless of assignment model, **a resolved item (status: resolved) does not silently reopen** — per spec 18 §14/§16, entries are retired via status change; the guard should deny further update attempts on an already-resolved item even for a reviewer who could otherwise access it, unless spec 13's workflow explicitly permits revision (a decision left to that spec, not this one).

---

## 9. Account Boundary Requirements

- **Reviewer access must not expose unrelated account content.** Even though a review item concerns a specific consumer's analysis under the hood, the reviewer-facing response must never bundle in that consumer's other analyses, other uploads, or any content beyond the single routed item's decision context (spec 12 §7, spec 13 §5's "may not access non-routed analyses").
- **This guard does not grant the reviewer session any account-level access** — passing `requireReviewItemScope()` authorizes access to one item's decision content only, not a general lookup capability against the underlying consumer's account.
- **Service-role behavior remains server-side only** (spec 19 §12, spec 21 §7, spec 22 §10) — if a future implementation of this guard's underlying data lookup uses a service-role Supabase client to read across the item/analysis relationship (since a plain reviewer-scoped RLS policy may need to join into consumer-owned tables), that key remains server-side only, never exposed to any client, and is a separate, explicitly-gated wiring decision (spec 21), not something this plan authorizes.

---

## 10. Audit Requirements

- **Every use of this guard — pass or fail — should be auditable**, consistent with spec 12 §11/§13 and spec 13 §5's "every access and every outcome is audited."
- The existing route already demonstrates the intended pattern: `review/items/[item_id].js` calls `auditSafeLog()` (spec 22 §13) after its guard chain, building a sanitized record (`stage`, `objectId`, `decision`, `actorRole`) — this plan proposes that a real `requireReviewItemScope()` implementation either call `auditSafeLog()` itself on both grant and deny, or ensure the calling route does so reliably, so that a denied scope check is just as visible in the audit trail as an approved one (spec 13 §5, spec 18 §15's append-only audit requirement).
- **No policy text or verbatim item content is ever included in an audit record for this guard** — only object IDs, decision/outcome codes, and role — consistent with the existing `ALLOWED_FIELDS` whitelist already structurally enforced in `audit.js` (spec 22 §13).

---

## 11. Fail-Closed Behavior

- **All failures deny access by default.** If the item doesn't exist, if the reviewer isn't assigned/scoped to it, if the role check somehow wasn't actually satisfied, or if the underlying data lookup fails for any technical reason, the guard returns `{ ok: false, response: forbidden() }` — never a default-allow, never a partial grant.
- **This property must hold even during placeholder implementation** — exactly as every other guard in the module already does (spec 22 §14) — so `requireReviewItemScope()` as a stub is safe to exist in the live repo before real logic is written, the same way `requireAccountMembership`/`requireAdminRole`/`requireServiceContext` are safe today.
- **Ambiguity resolves to denial** — if a future implementation can't cleanly determine whether a reviewer is assigned to an item (e.g., an assignment-model edge case per §8), the guard denies rather than guessing permissively.

---

## 12. Route Integration Plan

Once implemented (not by this plan), `functions/api/review/items/[item_id].js` would replace:

```javascript
const scopeCheck = requireOwnership(sessionCheck.session, itemId);
```

with:

```javascript
const scopeCheck = requireReviewItemScope(sessionCheck.session, itemId);
```

- No other change to the route's guard chain is proposed — the existing order (session → reviewer role → **item scope** → body validation → audit log → placeholder response) stays the same; only the specific guard function called at the scope-check step changes.
- This is a **one-line substitution** at the implementation stage, made possible specifically because this plan requires the new guard's return contract to exactly match the existing `{ ok, response }` shape (§5) — no surrounding route logic needs to change.
- This plan does not perform that substitution — it is listed here only to make the eventual integration step trivial to execute once approved.

---

## 13. Do-Not-Build-Yet Items

This plan does **not** authorize:

- Creating the `requireReviewItemScope()` function or any other guard code
- Modifying `functions/api/review/items/[item_id].js` or any other route file
- Modifying the shared guard module (`guards.js`, `responses.js`, `audit.js`)
- Creating any backend functionality
- Connecting to Supabase
- Configuring auth
- Adding any environment variable or secret
- Installing any package
- Building frontend UI
- Deploying anything

Writing and reviewing this plan is a planning action only.

---

## 14. Approval Required Before Implementation

Each of the following requires **explicit approval from Rex before the action**, independent of this plan's existence:

- Creating the `requireReviewItemScope()` guard function for the first time
- Deciding the assignment model (per-reviewer assignment vs. general reviewer-pool access) this guard's real logic depends on (§8, explicitly left open here)
- Modifying `functions/api/review/items/[item_id].js` to call the new guard
- Confirming the Supabase project/provider, applying migrations, connecting auth, or creating buckets (spec 19)
- Adding any environment variable or secret
- Deploying anything
- Staging, committing, or pushing this document or any resulting guard/route code

Gates are independent; approving one does not approve another.

---

## 15. Out-of-Scope

This plan does **not**:

- Modify specs 01–24, any SQL migration, any route file, or the shared guard module.
- Create the `requireReviewItemScope()` guard or any other code.
- Resolve the reviewer assignment model (per-item vs. pool-based) — that is a spec 13 operational decision, not decided here.
- Connect to Supabase, configure auth, or add any environment variable/secret.
- Build backend functionality or frontend UI.
- Deploy anything.
- Stage, commit, or push anything without separate explicit approval.
- Introduce new product requirements — it plans only what specs 12, 13, 18, 22, and 23, and the existing route's own in-code TODO, already flag as needed.

---

*End of v1.0 Review Item Scope Guard Plan. Defines the intended `requireReviewItemScope()` guard — its contract, why it must be distinct from `requireOwnership()`, its access/role/assignment/account-boundary/audit rules, its fail-closed default, and the trivial one-line route substitution that would integrate it once built. It creates no guard code, no route code, and authorizes no implementation; every action remains separately gated.*
