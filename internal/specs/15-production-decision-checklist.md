# Horse Insurance Coverage Checkup™
## Production Decision Checklist — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Decision Gate
**Scope:** The non-engineering decisions that must be approved before Phase 1 (persistence schema) build begins. Not a spec; a short go/no-go checklist derived from specs 01–14.

---

## 1. Purpose

Specs 01–14 fully define the product and its build order. Spec 14 §3/§18 identified three decisions that block production and are **not engineering calls** — they need an owner and a sign-off before dependent build work can complete. This checklist collects those three into one place so they can be decided together, and defines exactly what unlocks Phase 1. It invents nothing new; it only surfaces decisions specs 01–14 already flagged as open.

---

## 2. Decisions Required Before Build

| # | Decision | Blocks | Owner |
|---|---|---|---|
| 1 | **Auth provider** | Phase 1 identity keying, Phase 2 auth layer (spec 12 §18, spec 14 §3.1) | Rex |
| 2 | **Retention windows** | Purge/deletion jobs, production upload (spec 11 §15, spec 01 §14, spec 14 §3.2) | Rex + compliance |
| 3 | **Reviewer staffing** | Production upload of real policies (spec 13 §17, spec 14 §3.3) | Rex |

None blocks writing the schema *model* provider-agnostically, but each blocks a later gate. Deciding all three now keeps the build from stalling mid-phase.

---

## 3. Decision 1 — Auth Provider

- **Recommended default: Supabase Auth** — the network already uses Supabase for data on several properties (HorsePropertyAgents, HorseTrainer.ai, and others), so identity and data stay on one platform, and the persistence keying (spec 12 ownership model) lines up with an existing pattern.
- Alternatives (Clerk, Auth0, or equivalent managed provider) satisfy the same spec 12 identity/session requirements; provider choice is not locked by any spec.
- **Final approval is still required before any schema or auth build.** The spec is deliberately provider-agnostic (spec 12 §18); no provider is wired until this is approved.

---

## 4. Decision 2 — Retention Windows

- The retention **posture** is fixed by spec 11 §15 — conservative, need-bound, user-deletable, no indefinite retention, no public indexing. The **exact periods** are not, and must be approved before production.
- **Do not invent final legal retention windows** — the numbers below are placeholders for compliance to fill, not proposals.

| Artifact | Retention window | Status |
|---|---|---|
| Original uploaded policy file | _____ | Pending compliance |
| Extracted text | _____ | Pending compliance |
| Source snippets | _____ | Pending compliance |
| PolicyAnalysis record | _____ | Pending compliance |
| Verification results | _____ | Pending compliance |
| Final report | _____ | Pending compliance |
| Audit trail | _____ | Pending compliance |
| Deleted-user records (deletion audit, no policy text) | _____ | Pending compliance |

Rule: original policy files carry **no indefinite retention** (spec 11 §15) — whatever window is set, it must have a defined end tied to processing/access/review/compliance need.

---

## 5. Decision 3 — Reviewer Staffing

Confirm each of the following before enabling production upload:

- **MVP review model** — which one? (a) manual internal review, (b) no reviewer workflow at launch, or (c) limited reviewer workflow. Spec 13 defines the workflow; this picks how much of it runs at launch.
- **Who may review** — which specific internal person(s) hold the `reviewer`/`admin` role (spec 12 §4, spec 13 §5). Reviewer is a staff role, never consumer self-signup.
- **No legal advice** — confirmed: reviewers provide no legal conclusions; items needing legal interpretation are handled as insufficient-evidence, not escalated to a lawyer (spec 01 §4, spec 13 §9/§14). This is a product boundary, not a staffing choice, restated here for the record.

---

## 6. Recommended Default Path

If Rex approves the defaults as-is (or edits them), the build proceeds on:

- **Auth:** Supabase Auth.
- **Retention:** conservative, with **no indefinite policy-file retention**; exact windows filled by compliance (§4).
- **Review:** **manual internal reviewer workflow** for MVP, with named internal reviewer(s).
- **Gate:** **build Phase 1 only after Rex approves these defaults or specifies changes.**

This is a recommendation, not an authorization — Phase 1 does not start on this document alone (§7).

---

## 7. Phase 1 Unlock Criteria

Phase 1 (persistence schema, spec 14 §5) may begin only when **all** of the following are true:

- [x] Auth provider approved — Supabase Auth (for Phase 1 planning)
- [x] Retention window placeholders approved — pending compliance finalization; conservative MVP defaults for schema planning only, no indefinite retention of original policy uploads
- [x] Reviewer staffing approach approved — manual internal reviewer workflow for MVP planning
- [x] GitHub spec set confirmed current (specs 01–15 present on `origin/main`)
- [x] Rex explicitly approves Phase 1 schema build — approved to begin after this checklist update is committed and pushed

All Phase 1 unlock criteria met. Phase 1 schema **planning** is approved to begin once this update is committed and pushed. Phase 1 does not include migrations, buckets, auth wiring, or deployment — those remain separately gated (§8).

---

## 8. What Must Not Start Yet

Not to begin until their gate clears (spec 14 §17/§18):

- Database migrations
- Storage buckets
- Auth integration (provider wiring)
- Cloudflare deployment
- Real policy uploads in production
- Reviewer UI
- Paid account / subscription logic

Building the schema *model* provider-agnostically is Phase 1 work and is gated by §7 — the items above are gated separately and later.

---

## 9. Approval Record

_Recorded per Rex's approval._

- Auth provider approved: **Supabase Auth** — approved for Phase 1 planning.
- Retention windows approved: **Approved as pending compliance finalization** — conservative MVP defaults used for schema planning only, with **no indefinite retention of original policy uploads**. Final legal windows still to be set by compliance (§4).
- Reviewer staffing approved: **Manual internal reviewer workflow** for MVP planning — **no legal advice workflow, no external reviewer network.**
- Phase 1 schema build approved: **Yes** — approved to begin after this checklist update is committed and pushed.
- Approved by: **Rex**
- Date: **2026-07-05**

---

*End of v1.0 Production Decision Checklist. This document gates Phase 1 behind three non-engineering approvals (auth provider, retention windows, reviewer staffing); it invents no retention windows and authorizes no build or push.*
