# Horse Insurance Coverage Checkup™
## Implementation Sequencing Plan — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Build Planning
**Scope:** Build sequencing only. Maps completed specs 01–13 into a practical build order — what gets built first, what depends on what, what must not be built yet, and what requires explicit approval before implementation or push. Introduces no new product requirements; it only sequences work already defined in specs 01–13.

---

## 1. Purpose

Specs 01–13 define the product completely — foundation, pipeline, data model, confidence, verification, runtime, infrastructure, access control, and reviewer operations. What they deliberately do not define is the *order to build it in*. This document owns that: it turns thirteen interdependent specs into a linear, dependency-respecting build plan, identifies the non-engineering decisions that block production, and fixes the approval and push gates that govern when work may actually be implemented or deployed.

This is a planning document, not an engineering artifact. It writes no schema, no migration, no route, no UI, no stage logic. It references the specs that own each piece and states the sequence and the gates. Every requirement it sequences already exists in specs 01–13; this document adds none.

**Governing constraint:** nothing in this plan authorizes a build or a push. It sequences work; it does not start it. Every phase that touches persistence, secrets, deployment, or GitHub is gated behind an explicit approval from Rex (§18/§19). The plan is a map, not a green light.

---

## 2. Completed Spec Set

The build sequences against these thirteen specs, all present and verified in `/internal/specs/`:

| Spec | Owns |
|---|---|
| 01 — Product Foundation | Scope, guardrails, "no source, no answer", compliance language, MVP coverage set |
| 02 — Extraction Pipeline | Text/OCR/table/source-ref extraction, page preservation, quality bands |
| 03 — Clause Taxonomy | Clause types, coverage relationships, exclusion/condition linkage |
| 04 — Answer Generation | Answer format, confidence labels, coverage status, prohibited language |
| 05 — Report Template | Consumer report structure and display rules |
| 06 — User Upload Flow | Pre-analysis upload UX and messaging |
| 07 — Policy Data Model | Normalized `PolicyAnalysis` object and its sub-objects |
| 08 — Confidence Orchestration | Scoring, capping, review-flag, routing logic |
| 09 — Answer Support Verification | Entailment gate; five verification statuses |
| 10 — Runtime Orchestration | Fixed pipeline order, blocking gates, two-tier entailment, audit trail |
| 11 — Backend & Infrastructure | Compute layout, storage responsibility, build-config defaults, retention posture |
| 12 — Auth, Account & Isolation | Identity model, ownership, per-user isolation, role-limited reviewer access |
| 13 — Reviewer Operations | Human-review workflow, outcomes, prohibitions, user-facing status |

The pipeline they define, in runtime order (spec 10 §5): **extract → classify → model → score/route → generate → verify → report/display**, with verification as the final gate and per-user isolation enforced throughout.

---

## 3. Non-Engineering Decisions Still Open

Three decisions block production. **None are engineering calls; all require an owner and a decision before the dependent build work can complete.**

1. **Auth provider selection** (spec 12 §18). The identity/session model is defined provider-agnostically; a concrete provider must be chosen before persistence keying and the API's auth layer are built. **Supabase Auth appears to be the path-of-least-resistance candidate *only if* it aligns with the existing project/network architecture** — the network already uses Supabase for data on several properties, which would keep identity and data on one platform. This is an observation, not a selection: **provider choice still requires explicit approval before build** (§18).
2. **Exact retention windows in days/months** (spec 11 §15, spec 01 §14). The retention *posture* (conservative, need-bound, user-deletable, no indefinite retention, no public indexing) is fixed; the numeric windows per artifact are a compliance/legal sign-off, not settled in any spec. Purge jobs and deletion behavior depend on these numbers.
3. **Production reviewer staffing plan** (spec 13 §17). The review *workflow and boundaries* are defined; how many reviewers, coverage hours, and shift model are an operational decision required before production upload of real policies is enabled (since routed items need humans to clear them).

These three are surfaced here so they can be routed to their owners in parallel with early build phases — none blocks Phase 1, but each blocks a later gate (§18).

---

## 4. Build Dependency Order

The critical path, each phase depending on the ones before it:

```
Phase 1  Persistence schema + ownership model      (specs 07, 11, 12)
   │
Phase 2  API orchestration skeleton                (specs 10, 12)
   │
Phase 3  Upload + file handling                    (specs 06, 11, 12)
   │
Phase 4  Extraction stage                          (spec 02)
   │
Phase 5  Classification + policy data model        (specs 03, 07)
   │
Phase 6  Confidence scoring + review routing       (spec 08)
   │
Phase 7  Answer generation                         (spec 04)
   │
Phase 8  Answer support verification               (spec 09)
   │
Phase 9  Report assembly                           (spec 05)

Parallel, after API contract is stable (end of Phase 2):
Phase 10 Static frontend upload + report flow      (specs 05, 06)
Phase 11 Reviewer operations UI                     (spec 13)
```

Rule: the backend pipeline (Phases 4–9) is built in the same order it runs at runtime (spec 10 §5), so each stage can be tested against real output from the stage before it. Phases 10–11 are UI workstreams that depend only on a **stable API contract**, not on the pipeline being complete — they may proceed in parallel once Phase 2 fixes the contract (§16).

---

## 5. Phase 1 — Persistence Schema and Ownership Model

**The first build artifact.** Persistence schema/migrations based on the **spec 07 object model**, **spec 11 storage responsibilities**, and **spec 12 ownership/isolation rules**.

- Model `PolicyAnalysis` and its sub-objects (policies, horses, coverages, clauses, exclusions, conditions, source_refs, conflicts, missing items, review flags) from spec 07.
- Apply spec 11 §5–§8 storage responsibility: which artifacts live in the managed DB vs. private object storage; source-maps/confidence/verification/audit records keyed to `analysis_id`.
- Apply spec 12 ownership keying: every ownable artifact carries `account_id` + `user_id`; **owner-not-null enforced at write time** so the spec 12 §17 integrity faults ("upload without owner", "PolicyAnalysis without owner") are structurally impossible, not merely caught at read (spec 12 §17 implementation note).
- Isolation enforced at retrieval (spec 12 §7); no cross-user read path in the schema design.

**Blocked on:** auth provider selection (§3.1) for the exact identity keying, and the create-migrations approval gate (§18).

---

## 6. Phase 2 — API Orchestration Skeleton

**The second build artifact.** Orchestration API skeleton based on **spec 10 runtime order** and **spec 12 access controls**.

- Establish the Workers/serverless layer (spec 11 §2/§3) as the sole credentialed enforcement point.
- Implement the fixed pipeline sequencing shell (spec 10 §5) — stage invocation order, gate checkpoints, per-analysis state in the DB (spec 11 §9) — as a skeleton that stages plug into, before the stages themselves exist.
- Implement per-request session validation and ownership checks (spec 12 §5/§6/§7) and the audit-record write path (spec 10 §13, spec 11 §8).
- **Fix the API contract** (request/response shapes, status handles, report payload) at the end of this phase — this is what unblocks the parallel UI workstreams (§16).

**Blocked on:** Phase 1, auth provider selection (§3.1), and the add-secrets / deploy gates (§18) for anything beyond local skeleton.

---

## 7. Phase 3 — Upload and File Handling

Server-side upload receipt and private storage, per **specs 06, 11, 12**.

- API-mediated upload to **private object storage** (spec 11 §4/§5) — never a public bucket, never the Pages asset tree.
- Owner set from the validated session at receipt (spec 12 §8); `analysis_id`/`upload_id` created and audited.
- Server-side enforcement of accepted types/size/count (spec 06 §2/§3) with the spec 06 §3 messages.
- Pipeline triggered asynchronously with a status handle to the frontend (spec 06 §3).

**Blocked on:** Phases 1–2, create-storage-buckets gate (§18).

---

## 8. Phase 4 — Extraction Stage

The first pipeline stage, per **spec 02**.

- Text extraction, OCR fallback with quality bands (spec 02 §3/§6), page preservation (spec 02 §4), source-ref creation (spec 02 §5), table/key-value extraction, clause segmentation (spec 02 §10), conflict/missing-source flags (spec 02 §11/§12).
- Emits the spec 02 §13 extraction output + `extraction_status` (spec 02 §14) into the model layer.
- The extraction-assist model call (spec 11 §10) is server-side only.

**Blocked on:** Phases 1–3, add-secrets gate for the model endpoint (§18).

---

## 9. Phase 5 — Classification and Policy Data Model

Clause classification and model assembly, per **specs 03, 07**.

- Assign clause types and typed coverage relationships (spec 03 §2/§4/§5); link exclusions/conditions to coverages (spec 03 §6/§7); track definitions (spec 03 §8); flag conflicts and missing relationships (spec 03 §10/§11).
- Assemble the normalized `PolicyAnalysis` (spec 07) and run its §11 validation rules — an invalid model is not passed downstream (spec 07 §11, spec 10 §11).

**Blocked on:** Phase 4.

---

## 10. Phase 6 — Confidence Scoring and Review Routing

Scoring and routing, per **spec 08**.

- Field/clause/coverage/answer confidence scoring with weakest-link resolution and downhill-only rule (spec 08 §4–§8); raise review flags with `caps_confidence_at` ceilings (spec 08 §10); route to show / show-with-caveat / hold-for-review (spec 08 §11/§12).
- Apply the pinned confidence bands from spec 11 §14.

**Blocked on:** Phase 5.

---

## 11. Phase 7 — Answer Generation

Consumer answer production, per **spec 04**.

- Generate answers in the required 10-part format (spec 04 §3) with citations, coverage status (spec 04 §7), confidence labels, and the prohibited-language guardrails (spec 04 §6/§13); scenario answers assembled multi-clause (spec 04 §11); detection-only scoping honored (spec 04 §10).
- Generation reads the fully scored model (spec 10 §5); it produces answers but does not display them — everything passes to verification.

**Blocked on:** Phase 6.

---

## 12. Phase 8 — Answer Support Verification

The final gate, per **spec 09** and the **spec 10 §8** two-tier architecture.

- Tier-1 deterministic checks (citation-orphan, numeric-mismatch, missing-qualifier) on every statement; Tier-2 model entailment judge only on Tier-1 survivors with a live semantic question (overstatement, ambiguity-to-certainty), skipped when none remains (spec 10 §8, spec 11 §11).
- Assign the five verification statuses (spec 09 §3); rescope-and-reverify capped at one pass (spec 09 §11, spec 10 §9); block/replace/route per spec 09 §11–§12.
- **Verification can block display even on a Confirmed upstream label** (spec 10 §6) — build this as the last gate with override authority.
- Tier-2 batching honors isolation (spec 11 §12): never mix users/policies, preserve per-statement citation.

**Blocked on:** Phase 7.

---

## 13. Phase 9 — Report Assembly

Report generation from verified content, per **spec 05**.

- Assemble the spec 05 §2 report sections from **only verified statements** (spec 10 §5, spec 11 §1); display confidence/status as visible words (spec 05 §3); surface missing/unclear items and detection-only categories (spec 05 §2); apply report output rules and the standing disclaimer (spec 05 §4, spec 01 §16).
- Report served only to the owner via the API (spec 12 §10); PDF to private storage (spec 11 §5).

**Blocked on:** Phase 8.

---

## 14. Phase 10 — Static Frontend Upload and Report Flow

The consumer frontend, per **specs 05, 06** — **may proceed in parallel after the API contract is stable (end of Phase 2)**, not gated on the pipeline being complete.

- Cloudflare Pages static upload flow (spec 06): checklist, disclaimer checkbox, add-more-files, status messaging; mobile/camera upload (spec 06 §4).
- Report rendering (spec 05) of the API's verified payload; no secrets, no direct storage/model access (spec 11 §3, spec 12 §2).
- Against a stubbed API contract until the pipeline phases land, then wired to the real endpoints.

**Blocked on:** stable API contract (end of Phase 2), deploy-to-Cloudflare gate (§18) for anything beyond preview.

---

## 15. Phase 11 — Reviewer Operations UI

The reviewer interface, per **spec 13** — **may proceed in parallel after the API contract is stable (end of Phase 2)**.

- Present the spec 13 §6 required elements: queue list, filters by priority/status/reason, snippet/page/section display, statement display, confidence label, verification result, the three-outcome selector (spec 13 §9), the required note field (spec 13 §10), audit event creation (spec 13 §12).
- Enforce the spec 12/13 access boundary server-side: authenticated, role-limited, audited, item-scoped, no cross-account access (spec 13 §5/§15).
- Reviewer outcomes flow back through the same verification bar (spec 13 §9).

**Blocked on:** stable API contract (end of Phase 2); reviewer role support from the auth provider (§3.1); the review queue is only *useful* in production once staffing (§3.3) exists, but the UI can be built before that.

---

## 16. Parallel Workstreams

- **Backend pipeline (Phases 4–9)** is the critical path, built in runtime order.
- **Frontend (Phase 10)** and **Reviewer UI (Phase 11)** are parallel workstreams that depend only on a **stable API contract** (end of Phase 2) — not on the pipeline being finished. They build against the contract (stubbed if needed) and wire to real endpoints as pipeline phases land.
- **The three non-engineering decisions (§3)** run in parallel with all build phases — routed to their owners immediately so they resolve before their dependent gates (§18), rather than blocking mid-build.

Rule: parallel work may start only **after the API contract is stable**. Starting UI against an unstable contract risks rework; the contract-freeze at the end of Phase 2 is the signal that parallel work may begin.

---

## 17. Do-Not-Build-Yet Items

Explicitly not to be built until their blocker clears:

- **Auth integration** — no provider is wired until provider selection is approved (§3.1, §18). Build the identity/ownership *model* (Phase 1) provider-agnostically; do not integrate a specific provider first.
- **Purge/retention jobs** — do not build retention/deletion automation until the numeric windows are set (§3.2). The deletion *access path* (spec 12 §14) can be built; the *timed purge* cannot, since it needs the windows.
- **Production upload of real policy files** — not enabled until the enable-production-upload gate (§18), which itself depends on auth, retention windows, reviewer staffing, and a verified isolation posture.
- **Auto-assignment for review** — out of MVP scope (spec 13 §7); not built at launch.
- **Detection-only category deep analysis** — out of MVP scope (spec 03 §3, spec 04 §10); not built.
- **Multi-user accounts** — modeled but 1:1 for MVP (spec 12 §4); the multi-seat path is not built yet.
- **Any non-production/demo mode touching real policy content** — forbidden (spec 12 §6); not built.

Rule: this plan invents no new work. Anything not traceable to a requirement in specs 01–13 is out of scope by definition (§20) and is not on the build list.

---

## 18. Approval Gates

Each of the following requires **explicit approval from Rex before it is performed** — none is authorized by this plan:

| Gate | What it authorizes | Depends on |
|---|---|---|
| **Select auth provider** | Choosing/wiring the identity provider (§3.1) | Alignment with network architecture; Rex approval |
| **Set retention windows** | Fixing the day/month purge windows (§3.2) | Compliance/legal sign-off |
| **Create database migrations** | Applying the Phase 1 schema | Auth provider selected; Rex approval |
| **Create storage buckets** | Provisioning private object storage (Phase 3) | Rex approval |
| **Add environment variables / secrets** | Model keys, DB/storage credentials | Rex approval |
| **Deploy to Cloudflare** | Publishing Pages/Workers beyond local/preview | Rex approval |
| **Push to GitHub** | Any commit to the repo (§19) | Rex explicit push approval |
| **Enable production upload of real policy files** | Turning on real-policy intake | Auth + retention windows + reviewer staffing + verified isolation; Rex approval |

Rule: gates are independent — approval for one does not imply approval for another. The production-upload gate is the last and strictest, depending on all three non-engineering decisions (§3) plus a verified isolation posture (spec 12).

---

## 19. Push Rules

- **Nothing may be pushed to GitHub unless Rex gives explicit push approval.** This is the standing rule for the entire network and applies to every artifact this plan sequences, including the specs already built this session (07–13) and this plan itself.
- **Do not claim anything is pushed unless the push actually completed.** Status is reported truthfully — "staged locally, not pushed" until a push is confirmed done.
- **If a step fails, repair only that step** — no unrelated changes bundled into a fix, consistent with the network's no-day-dreaming / one-correct-fix rule.
- All spec work to date remains **local and unpushed** (specs 07–13 untracked in the working tree; 01–06 already committed). It stays that way until Rex approves a push.

---

## 20. Out-of-Scope

This planning document does **not**:

- **Build anything** — no schema, migration, route, UI, stage logic, or reviewer tool is created here (that is the whole point of a plan vs. an implementation).
- **Invent product requirements** — it sequences only what specs 01–13 already define; any requirement not in those specs is out of scope.
- **Select the auth provider, set retention windows, or plan staffing** — it *identifies* these as blockers (§3) and gates them (§18); it does not decide them.
- **Author the API contract** — Phase 2 produces the contract; this plan states when it must stabilize, not what its fields are.
- **Define deployment infrastructure specifics** — regions, product SKUs, and CI are deployment decisions (spec 11 §19); this plan sequences phases, not infra choices.
- **Authorize any push or deploy** — every such action is gated behind explicit Rex approval (§18/§19).

---

*End of v1.0 Implementation Sequencing Plan. This document maps completed specs 01–13 into an eleven-phase build order with two parallel UI workstreams, identifies the three non-engineering production blockers (auth provider, retention windows, reviewer staffing), fixes the first two build artifacts (persistence schema, then API skeleton), and gates every persistence/secret/deploy/push action behind explicit approval. It introduces no new product requirements and authorizes no build or push.*
