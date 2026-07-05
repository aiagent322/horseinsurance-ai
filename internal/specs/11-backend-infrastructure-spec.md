# Horse Insurance Coverage Checkup™
## Backend & Infrastructure Specification — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Implementation Reference
**Scope:** Where and how the pipeline runs and persists. Defines compute layout, storage responsibility, model invocation, cost controls, retention, concurrency, and security. Does not define stage-internal logic (specs 02–10), reviewer operations, database migrations, or application code.

---

## 1. Purpose

Specs 02–10 define *what* the pipeline does and *in what order*. This document defines *where it runs and where its data lives*. It maps the fixed runtime pipeline (spec 10) onto concrete infrastructure — a static frontend, a serverless orchestration layer, a managed database/object store, and model invocation — and it resolves the storage and retention questions that every prior spec deferred to this one, including the spec 01 §14 retention decision that has been pending since the foundation document.

This spec is an architecture and policy document, not code. It names responsibilities, boundaries, defaults, and constraints. It deliberately does not write migrations, table DDL, Worker code, or SQL — those are build artifacts produced against this spec, subject to the standing rule that nothing is deployed without explicit approval.

**Governing constraints (inherited):**
- Uploaded policy files are **never public assets** (spec 01 §4, §14). No public URL ever resolves to policy content.
- Generated reports and answers use **only verified data that passed spec 09** (spec 10 §5). Infrastructure must make it structurally impossible for unverified content to reach the report store.
- Retention is **conservative by default** (spec 01 §14): nothing is kept indefinitely, and sensitive content is kept only as long as a defined need exists.

---

## 2. Infrastructure Overview

Four layers, consistent with the network's standard pattern:

```
[ Static Frontend ]      Cloudflare Pages — upload UI, report display (spec 05/06)
        │  HTTPS
        ▼
[ Orchestration API ]    Cloudflare Workers (or equivalent serverless) — runs the spec 10 pipeline
        │
        ├──► [ Model Endpoint ]      Anthropic API — OCR-adjacent/extraction assist + Tier-2 entailment judge
        │
        ▼
[ Persistence ]          Managed DB + private object storage (Supabase or equivalent)
                         — files, extracted text, source maps, PolicyAnalysis, confidence,
                           verification, reports, audit trail, review-queue state
```

The frontend is static and holds no secrets and no policy content beyond what the current user is actively viewing. All processing and all persistence sit behind the orchestration API, which is the only layer with credentials to storage and the model endpoint. No browser ever talks directly to storage or the model.

---

## 3. Frontend / API Boundary

- The **frontend (Cloudflare Pages)** is static: HTML/CSS/JS, mobile-first, no runtime secrets, no direct database or object-store access, no direct model calls. It presents the upload flow (spec 06) and renders reports (spec 05) returned by the API.
- The **orchestration API (Workers)** is the only component that: holds storage/model credentials, runs the spec 10 pipeline, enforces per-user isolation (§17), and returns only verified, display-eligible content to the frontend.
- The boundary is **request/response over HTTPS** with a session/auth token identifying the user. The frontend never receives raw extracted text, intermediate state, or another user's data — it receives the finished report payload (verified statements + labels) and upload/processing status messages (spec 06 §3).
- Policy content is never placed in a URL, query string, or path segment (§17). Uploads and reports are referenced by opaque IDs, not by content.

---

## 4. Upload Handling

- Files arrive from the frontend (spec 06) via the API, which writes them to **private object storage** immediately — never to a public bucket, never to the Pages asset tree.
- On receipt the API creates an `analysis_id` and `upload_id` (spec 07 §3) and records the upload event in the audit trail (§8) without storing file content in the audit record.
- Accepted types and size/count limits are enforced at the API (spec 06 §2/§3); rejects return the spec 06 §3 messages. Enforcement is server-side even if the frontend also checks, since the frontend check is advisory only.
- The upload triggers the pipeline (spec 10 §2) asynchronously; the frontend is given a processing-status handle, not a blocking wait (spec 06 §3 "Analysis started").

---

## 5. File Storage Model

| Artifact | Store | Access |
|---|---|---|
| **Original uploaded file** | Private object storage | API-only, via signed/short-lived private access; never public (§17) |
| **Report output (PDF)** | Private object storage | API-only, released to the owning user's session on request |

Rules:
- Original files live in a **private bucket** with no public read, no directory listing, and no content-addressable public URL. Access is always mediated by the API against the requesting user's identity (§17).
- Object keys are opaque IDs, never derived from policy content, insured name, or file name (§17).
- Signed URLs, where used for the user to retrieve their own report, are **short-lived and user-scoped** — not shareable public links.

---

## 6. PolicyAnalysis Record

- The normalized `PolicyAnalysis` object (spec 07) is persisted in the **managed database** as structured records keyed by `analysis_id`, scoped to the owning user.
- It is the canonical assembled state consumed by scoring (spec 08), generation (spec 04), and verification (spec 09). It holds structured policy facts, clauses, coverages, exclusions, conditions, conflicts, and missing items — each carrying its `source_ref`s (spec 07 §8).
- It is **not public**, **not indexed for search**, and **not shared across users**. One analysis belongs to one user.
- Persistence shape (tables/collections) is a build decision against spec 07's object model; this spec fixes *responsibility and access*, not schema. No migrations are defined here.

---

## 7. Intermediate State Storage

| Intermediate artifact | Store | Lifecycle |
|---|---|---|
| **Extracted text / blocks** | Managed DB (or private object storage for large blobs) | Retained only while needed for analysis/review (§15) |
| **Page-level source mappings (`source_ref`s)** | Managed DB, linked to `analysis_id` | Retained with the analysis while the report is live; needed to back every citation |
| **Confidence results** (labels, caps, review flags — spec 08) | Managed DB, on the analysis | Retained with the analysis |
| **Verification results** (spec 09 records) | Managed DB, on the analysis | Retained with the analysis / audit needs |

Rules:
- Intermediate state is **private, per-user, non-indexed**, same as the `PolicyAnalysis` (§6).
- Extracted text is the most sensitive intermediate artifact (it is verbatim policy content). It is retained only as long as analysis and any review require, then subject to the retention policy (§15) — it is not kept indefinitely just because storage is cheap.
- Source mappings must persist as long as the report is accessible, because every displayed citation resolves against them (spec 09 §2); if source maps are purged, the report's citations can no longer be verified and the report itself must be treated as expired (§15).

---

## 8. Audit Record Storage

- The spec 10 §13 audit trail is persisted in the **managed database**, keyed by `analysis_id` and stage transition, scoped to the owning user.
- Audit records store the nine spec 10 §13 fields (stage entered/completed, input/output object IDs, confidence label, verification result, block reason, review reason, timestamp) — **object IDs and labels/reasons, not policy text** (§17). Where a snippet must be retained to justify a block/verification decision, it is stored as part of the verification result under the same retention and access controls, not duplicated into the audit log.
- Blocked and review-routed statements are audited with the same rigor as displayed ones (spec 10 §13) — the audit trail must reconstruct any answer's full path, including why it was blocked.
- Audit records are **internal-only**, never returned to the frontend, never public.

---

## 9. Runtime Stage Execution

- The pipeline (spec 10) runs in the **orchestration API layer** (Workers/serverless). Each stage is invoked in the fixed order; orchestration enforces the gates (spec 10 §6) and writes audit records (§8) at each transition.
- Stages 1–4 (extract → classify → model → score/route) run once per upload and complete before any generation (spec 10 §5, concurrency §16).
- Stages 5–6 (generate → verify) run per statement; stage 7 (report) assembles only verified statements.
- Long-running work (extraction/OCR on large scanned policies) runs asynchronously; the API tracks per-analysis pipeline state in the DB so a stateless serverless invocation can resume/advance the pipeline without holding a long-lived connection. Orchestration state (current stage, per-statement status) lives in the DB, not in Worker memory, so no single invocation must run the whole pipeline in one shot.

---

## 10. Model Invocation Architecture

- Model calls go to the **Anthropic API**, invoked **only from the orchestration API layer** (never the frontend, never with a browser-exposed key — consistent with the network's Worker-proxy pattern).
- Two model-touching uses exist:
  1. **Extraction/OCR assist** (stage 1, spec 02) — where the extraction stage uses a model for OCR-adjacent or structure tasks.
  2. **Tier-2 entailment judge** (stage 6, spec 10 §8) — the only *per-statement* model call in the runtime, and the main variable cost/latency driver.
- All model calls are server-side, credentialed at the Worker, rate-limited and retried per §13, and never receive or emit another user's data (§16/§17).
- The model is invoked against **cited snippets and generated statements only** (spec 10 §8) — orchestration does not send whole policies to the Tier-2 judge; it sends the specific statement and its cited source text, which also bounds cost.

---

## 11. Tier-1 / Tier-2 Verification Cost Controls

The two-tier architecture (spec 10 §8) is the primary cost lever. Rules:

- **Tier-1 deterministic checks run first, on every statement**, with no model call: citation-orphan, numeric-mismatch, and missing-qualifier checks (spec 10 §8). These are cheap and resolve mechanical failures without invoking the model.
- **Tier-2 model judge runs only when Tier-1 cannot resolve support status** — i.e., when a semantic question (overstatement or ambiguity-to-certainty) genuinely remains after Tier 1 (spec 10 §8).
- **Tier-2 is skipped when no semantic question remains.** A statement Tier 1 clears as mechanically exact, fully qualifier-faithful, and non-overstating on its face is Fully Supported without a model call. This skip is the main cost control and must be implemented, not treated as optional.
- Tier-2 statements that hard-failed Tier 1 (orphan, numeric mismatch, inverting qualifier drop) never reach the model — they are already blocked (spec 10 §8).

Net effect: the model is invoked for the *subset* of statements that pass mechanical checks but still carry a real semantic question — not for every statement, and never for statements already resolved either way.

---

## 12. Batching Rules

Tier-2 judgments may be batched to reduce per-call overhead, under strict isolation rules:

- **Batch only within a single analysis** — statements from one `analysis_id` (one user, one upload set). Batching must **never mix unrelated policies or users** (spec 10 §16, §17).
- **Preserve per-statement citation/source mapping** — each statement in a batch keeps its own cited snippet(s) and its own returned verification status; the batch is a transport optimization, not a merge. A batched result must be attributable back to exactly one statement and its `source_ref`s (spec 09 §2).
- **No cross-statement leakage** — the judge's decision on one statement must not be influenced by, or contaminate, another statement's snippet in the same batch. Each statement is judged against its own source text only (spec 09 §6, spec 10 §8).
- **Batch size is a build-config value** (§13), bounded so a single batch failure retries a small, bounded set rather than the whole analysis.
- If batching cannot guarantee the above for a given statement (e.g., a statement whose result is ambiguous in a batch), that statement is judged individually.

---

## 13. Retry and Timeout Configuration

Pinned MVP build-config defaults (adjustable in config; the *requirement that every loop is bounded* is fixed, the numbers are tunable):

| Setting | Default | Notes |
|---|---|---|
| **Stage retry count** | 2 retries (3 attempts total) | Per stage, transient failures/timeouts only (spec 10 §12) |
| **Stage timeout** | 30 s interactive stages; 120 s extraction/OCR | Extraction on large scanned files gets the longer budget |
| **Rescope retry limit** | **1** (hard cap, not tunable) | Exactly one rescope pass, then replace/review (spec 09 §11, spec 10 §9/§12) |
| **Tier-2 batch size** | 10 statements/batch | Bounded so a batch failure retries a small set (§12) |
| **Tier-2 judgments per statement** | 1 (or 1 per rescoped statement) | No re-judging the same wording (spec 10 §12) |
| **Whole-pipeline passes** | 1 per upload | Re-run requires a new `analysis_id` (spec 10 §12) |
| **Model call retry** | 2 retries w/ backoff | Transient API failures; on exhaustion, fail closed (§18) |

The **rescope cap of 1 is a hard invariant** carried from specs 09/10 and is not a tunable — it prevents indeterminate rescope loops. Everything else is a tunable default.

---

## 14. Confidence Band Configuration

Pinned band-to-label cutoffs, referenced-but-unspecified in specs 08/10, fixed here as MVP defaults. All bands use the 0–100 numeric scale from spec 02 §6.

**OCR confidence bands** (carried verbatim from spec 02 §6 — restated for config completeness):

| Band | Label | Downstream cap |
|---|---|---|
| 90–100 | Clean | Full confidence eligible |
| 75–89 | Mostly readable | Cap ≤ Likely |
| 50–74 | Partially readable | Cap ≤ Unclear |
| 25–49 | Poor | Prompt re-upload; not relied on |
| 1–24 | Barely usable | Not used for answers |
| 0 | Unreadable | Treated as missing page |

**Field / clause / answer / verification bands** (numeric extraction/classification confidence → label eligibility, applying spec 08 §4–§8):

| Numeric band | Field-level | Clause-level | Answer-level | Verification-eligible |
|---|---|---|---|---|
| **90–100** | Confirmed-eligible | Confirmed-eligible | Confirmed-eligible | May be Fully Supported |
| **75–89** | ≤ Likely | ≤ Likely | ≤ Likely | May be Fully Supported if entailment passes |
| **50–74** | ≤ Unclear | ≤ Unclear | ≤ Unclear | Insufficient Evidence unless independently cross-verified |
| **25–49** | Not relied upon | Not relied upon | Not relied upon | Insufficient Evidence |
| **0–24** | Not Found | Not usable | Not Found | Unsupported (blocked) |

Rules:
- These bands set the **ceiling** a numeric score permits; categorical caps (missing form, conflict, detection-only) can lower a label further but never raise it above its band (spec 08 §2, downhill-only).
- Bands are config defaults, not stage logic — changing a cutoff changes the ceiling, not the rules that consume it. Specs 08/09/10 remain the authority on how labels are used.
- Verification eligibility (rightmost column) is a ceiling only; a statement in a high band still fails verification if entailment fails (spec 10 §6 — verification overrides the label).

---

## 15. Retention Policy Decision

This section resolves the spec 01 §14 open item with a **conservative MVP retention policy**. Given uploads are sensitive personal/financial documents, the default posture is **minimum retention consistent with a defined need**, never indefinite retention.

| Artifact | Retention rule |
|---|---|
| **Original uploaded file** | Retained only as long as needed for processing, active user access, pending review, or a defined compliance need. Purged after the analysis is complete and the retention window for user access/review lapses. Not kept indefinitely. |
| **Intermediate extracted text** | Retained only while needed for analysis and any pending review. Purged once the analysis is finalized and no review is pending — it is the most sensitive intermediate artifact and gets the shortest practical life. |
| **Page-level source mappings** | Retained as long as the report is accessible (citations resolve against them). Purged with the report; a report whose source maps are gone is treated as expired. |
| **Confidence & verification results** | Retained with the analysis/report while it is live; purged with it. |
| **Final report** | Retained according to the user's account/report-history needs — as long as the user can access their report history, subject to user deletion (below). |
| **Audit trail** | Retained according to compliance/report-history needs; stores IDs/labels/reasons, not policy text (§8), so it carries far lower sensitivity and can outlive purged content without exposing it. |
| **Review-queue routing state** | Retained while the item is pending or recently resolved; purged per the same window as the analysis it belongs to. |

Principles (all inherited from spec 01 §14, now made concrete):
- **No indefinite retention by default.** Every artifact has a defined end-of-life tied to a need (processing, access, review, compliance), not "kept forever."
- **User deletion/export where applicable.** A user may delete their analysis/report; deletion purges the original file, intermediate text, source maps, confidence/verification results, and report, and marks the audit trail as deleted-by-user (the audit record of the deletion itself is retained for compliance, without policy text). Export, where offered, returns the user's own report in a portable form.
- **No public indexing of uploaded policy content**, ever (spec 01 §4, §17). No artifact in this table is ever public or search-indexed.
- Exact windows (days/months per artifact) are a compliance-sign-off decision; this spec fixes the *posture and the tiering*, and the final numeric windows are confirmed with legal/compliance before production (spec 01 §14). The posture — conservative, need-bound, user-deletable — is settled here and is not deferred further.

---

## 16. Concurrency Model

Concurrency is permitted only within these constraints (carried from spec 10 §5/§15):

- **Stages 1–4 complete before generation.** Extraction, classification, modeling, and scoring must all finish for an upload before any statement is generated — generation reads the fully scored model (spec 10 §5).
- **Generation before verification, per statement.** For any single statement, generate completes before verify begins (spec 10 §7).
- **Verification may run in parallel across statements.** Different statements of the same analysis may verify concurrently (subject to batching isolation, §12), because each is judged against its own source only.
- **Report assembly uses only verified statements.** Stage 7 may include a statement only after its verification reached Fully Supported (originally or post-rescope) (spec 10 §5).
- **No silent omission.** A failed or blocked statement is never dropped from the report without an audit record and, where applicable, a stated gap in the report section (spec 08 §9, spec 10 §13/§16). Blocking is visible in the audit trail and, where it affects the consumer's picture, in the report's "missing/unclear" surfacing.

Parallelism is a throughput optimization bounded by these ordering invariants; the invariants hold regardless of how many statements process at once.

---

## 17. Security and Access Controls

| Requirement | Rule |
|---|---|
| **Private upload access** | Uploaded files live in private storage; no public read, no listing, no content-addressable public URL (§5). |
| **Per-user isolation** | Every analysis, intermediate record, report, and audit record is scoped to the owning user; the API enforces that a user can only reach their own data. No cross-user read path exists. |
| **Signed/private file access** | Where a user retrieves their own file/report, access is via short-lived, user-scoped signed access — never a durable public link (§5). |
| **No policy text in public URLs** | Object keys and URLs are opaque IDs, never derived from insured name, file name, or policy content (§4/§5). |
| **No sensitive policy content in logs** | Application/operational logs record events, IDs, statuses, and error classes — never verbatim policy text, insured PII, or snippet content. |
| **Audit logs record events, not exposure** | Audit records store the nine spec 10 §13 fields (IDs, labels, reasons, timestamps) without unnecessary policy text; where a snippet is needed to justify a decision it lives in the verification record under access control, not in a general log (§8). |
| **Credentialed layer only** | Only the orchestration API holds storage/model credentials; the static frontend holds none (§3). |

The controlling principle: policy content is sensitive by default and is exposed only to the owning user, only through the credentialed API, only for as long as retention (§15) permits — and never through a URL, a log, or a public asset.

---

## 18. Failure Handling

Consistent with spec 10 §11's fail-closed principle, extended to infrastructure:

| Failure | Behavior |
|---|---|
| **Storage write failure** (upload/intermediate/report) | Retry per §13; on exhaustion, halt the analysis and surface a system-state message (spec 06 §3); do not proceed with a partial/unpersisted analysis. |
| **Storage read failure** for a required input | Treat as the consuming stage's input failure (spec 10 §11); halt and audit; do not fabricate the missing input. |
| **Model endpoint failure** (extraction assist or Tier-2) | Retry with backoff (§13); on exhaustion **fail closed** — the affected statements are not displayed (verification could not complete), never shown unverified (spec 10 §11). |
| **Source maps missing/purged for a live report** | Treat the report as expired (§15); do not serve a report whose citations can't resolve. |
| **Pipeline state lost mid-run** | Resume from persisted per-analysis state (§9) where possible; if unrecoverable, require a fresh analysis (new `analysis_id`) rather than a partial resume (spec 10 §12). |
| **Auth/isolation check failure** | Deny access; never fall back to serving data without an isolation check — a failed isolation check blocks, it does not default-open (§17). |

The default in every infrastructure failure is identical to the pipeline default: **fail closed** — show nothing unverified, expose nothing cross-user, surface an explicit system-state message rather than degraded or unverified output.

---

## 19. Out-of-Scope

This specification does **not** cover:

- **Stage-internal logic** — extraction, classification, modeling, scoring, generation, verification, rendering (specs 02–10). Infrastructure hosts them; it does not define them.
- **Database migrations, table DDL, or ORM code** — the persistence *responsibility and access* are fixed here; the concrete schema is a build artifact against spec 07's object model, produced separately and not deployed without approval.
- **Worker/application code** — no orchestration code is written here.
- **Reviewer UI, assignment, SLAs, or operations** — infrastructure persists review-queue routing state (§7/§15); how review is conducted is out of scope.
- **Exact retention windows in days/months** — the posture and tiering are fixed (§15); the numeric windows are a legal/compliance sign-off item (spec 01 §14).
- **Vendor lock-in specifics** — Cloudflare Pages/Workers and Supabase are the assumed pattern; "or equivalent" managed serverless/DB/object-store satisfies the same responsibilities. Choosing exact products/regions is a deployment decision.
- **Billing, account management, and auth provider choice** — per-user isolation is required (§17); the specific identity/auth implementation is a build decision.
- **Legal interpretation and claim outcomes** — infrastructure runs a pipeline whose every stage checks document support only (spec 01 §4).

---

*End of v1.0 Backend & Infrastructure Specification. This document maps the spec 10 pipeline onto a static-frontend / serverless-orchestration / managed-persistence architecture, fixes storage responsibility and per-user isolation, pins the MVP build-config defaults (retries, timeouts, confidence bands, batch size, rescope cap), defines the Tier-2 cost controls and batching isolation, and resolves the spec 01 §14 retention question with a conservative, need-bound, user-deletable MVP retention policy. It introduces no new pipeline logic and no new confidence vocabulary.*
