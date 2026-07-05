# Horse Insurance Coverage Checkup™
## Runtime Orchestration Specification — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Implementation Reference
**Scope:** End-to-end backend processing sequence only. Defines the runtime pipeline that carries one upload from arrival through display, the order of stages, the gates between them, and the audit trail. Does not define extraction/classification/answer/report logic themselves (specs 02–09 own those), reviewer UI/operations, database schemas, or infrastructure.

---

## 1. Purpose

Specs 02–09 each define one stage of the system in isolation — how text is extracted, how clauses are classified, how the data model is shaped, how confidence is scored, how answers are generated, and how they are verified. None of them defines the **runtime spine**: the order those stages run in, what each hands to the next, where a unit of work can be stopped, and how the whole thing is made auditable. This document owns that spine.

Runtime orchestration is the conductor, not a player. It does not extract, classify, score, generate, verify, or render — each of those belongs to its own spec and is treated here as a black box with a defined input and output. Orchestration's job is to invoke the stages in the correct order, enforce the gates between them, handle failures and retries, cap the rescope loop, and record an audit trail so any answer's path can be reconstructed after the fact.

**Governing constraint:** the pipeline order is fixed and verification is the final gate. No consumer-facing answer or report section is displayed until it has passed spec 09 verification — and verification can block a statement **even when its upstream confidence label is Confirmed** (see §6). A Confirmed label means the evidence was scored as strong; it does not mean the generated wording was checked against that evidence. Only verification checks the wording, and only verification decides display.

---

## 2. Runtime Pipeline Overview

One upload flows through seven ordered stages:

```
  UPLOAD
    │
    ▼
[1] EXTRACT ───► [2] CLASSIFY ───► [3] MODEL ───► [4] SCORE/ROUTE
                                                        │
                                                        ▼
                        DISPLAY ◄── [7] REPORT ◄── [6] VERIFY ◄── [5] GENERATE
```

Read left-to-right, top row then bottom row: **extract → classify → model → score/route → generate → verify → report/display.**

Each arrow is a **gate** — a checkpoint where orchestration decides whether the unit proceeds, is blocked, is replaced, or is routed to review. Verification (stage 6) is the last gate before anything reaches the consumer; report/display (stage 7) renders only what verification passed.

Stages 1–4 operate on the whole upload (they build the shared analysis). Stages 5–6 operate per statement/answer (each answer is generated, then verified, independently). Stage 7 assembles verified statements into the report.

---

## 3. Processing Stages

| # | Stage | Owning spec | What it does (black box) |
|---|---|---|---|
| 1 | **Extract** | 02 | Turns uploaded files into source-mapped text, tables, key-values, pages, OCR scores, and `source_ref`s. |
| 2 | **Classify** | 03 | Assigns clause types and typed coverage relationships; flags conflicts and missing relationships. |
| 3 | **Model** | 07 | Assembles the normalized `PolicyAnalysis` (policies, horses, coverages, clauses, exclusions, conditions, conflicts, missing items). |
| 4 | **Score/Route** | 08 | Assigns confidence labels, applies caps, raises review flags, sets routing ceilings across the model. |
| 5 | **Generate** | 04 | Produces consumer answers/statements in the required format, with citations, for each MVP question and report statement. |
| 6 | **Verify** | 09 | Checks each generated statement's wording against its cited snippet; assigns a verification status; blocks/rescopes/replaces/routes. |
| 7 | **Report/Display** | 05 | Renders verified statements and their labels into the consumer report (web + PDF). |

Orchestration treats each stage's internal rules as authoritative and does not second-guess them — it enforces *order, gates, failures, and audit*, not stage-internal correctness.

---

## 4. Stage Inputs and Outputs

| Stage | Primary input | Primary output | Gate on exit |
|---|---|---|---|
| Extract | Uploaded files (spec 06 flow output) | Extraction output + `extraction_status` (spec 02 §13/§14) | Failed-extraction gate (§6) |
| Classify | Extraction output | Classified clauses + relationships + conflicts (spec 03) | Missing-source-mapping gate (§6) |
| Model | Classified output | `PolicyAnalysis` object (spec 07) | Model-validity gate (spec 07 §11) |
| Score/Route | `PolicyAnalysis` | Same model, confidence/flags/ceilings populated (spec 08) | Partial-upload / OCR / conflict caps applied (§6) |
| Generate | Scored model | Answer objects (spec 04 §16), each cited | (no display yet — passes straight to verify) |
| Verify | Each answer object | Verification record + status (spec 09 §3) | **Final display gate** (§6) — blocks/rescopes/replaces/routes |
| Report/Display | Verified statements | Rendered report (spec 05) | Report-section gate (§6) |

Rule: a stage may only consume what a prior stage produced (spec 04 §1, spec 08 §3). No stage reaches back to raw documents to "check" something a prior stage already resolved — if a stage needs a fact, that fact must exist in its input, or it is treated as absent.

---

## 5. Required Pipeline Order

The order is **fixed and non-reorderable**:

**extract → classify → model → score/route → generate → verify → report/display**

Rules:
- No stage may run before its predecessor has completed for the unit in question. Answers cannot be generated before scoring; scoring cannot run before the model exists; the model cannot be built before classification; classification cannot run before extraction.
- **Verify is always the last gate before display.** Nothing is rendered to the consumer that has not passed verification, regardless of how it was scored upstream.
- Stages 1–4 complete once per upload before any answer is generated. Stages 5–6 run per statement and may run concurrently across statements, but for any single statement the generate→verify order is strict.
- Report assembly (stage 7) may only include statements whose verification status is Fully Supported (or the re-verified remainder of a rescoped statement) — it never renders a blocked statement (spec 09 §3/§11).

---

## 6. Blocking Gates

A blocking gate stops a unit from proceeding and routes it to a defined outcome (block, replace, or review). The nine required gates:

| Gate | Trigger | Outcome |
|---|---|---|
| **Failed extraction** | `extraction_status = failed`/`unreadable`, or file corrupt/unsupported (spec 02 §14) | Halt pipeline for the upload; surface system-state "analysis could not be completed" (spec 06 §3). No report produced. |
| **Missing source mapping** | A statement's supporting content has no `source_ref`, or a ref is orphaned (spec 02 §5, spec 07 §11) | Block the affected statement as Unsupported (spec 09 §3); never displayed. |
| **Unsupported answer** | Verification status Unsupported (spec 09 §6A) | Block; rescope if partially supported, else replace or route to review (§10). |
| **Contradicted answer** | Verification status Contradicted (spec 09 §6/§7/§9) | Block the affirmative/resolved form; surface conflict at Unclear or route to review. |
| **Insufficient evidence** | Verification status Insufficient Evidence (spec 09 §6C/§8) | Block strong form; replace with insufficient-evidence response (spec 04 §15). |
| **Partial upload** | `extraction_status` partial/needs_more_documents/mixed_documents (spec 02 §14) | Apply completeness caveat (spec 08 §9); block Confirmed on anything depending on missing material; may still produce a scoped report. |
| **OCR uncertainty** | Contributing snippet from OCR band <75 (spec 02 §6, spec 08 §5) | Cap affected statements at Likely (75–89) / Unclear (50–74) / Not Found (<25); band-<25 content unusable. |
| **Conflicting policy clauses** | Material conflict touches a statement (spec 02 §11, spec 03 §10, spec 08 §10) | Block Confirmed; present both values at Unclear; route core-category conflicts to review (§10). |
| **Report section failure** | A section's core item is blocked/held, or the section is majority Unclear/Not Found (spec 08 §9, spec 09 §11) | Mark the section low-confidence and state the gap; never render a blocked item inside it. |

**Verification can override Confirmed.** Even if score/route (stage 4) assigned a Confirmed label, if verify (stage 6) finds the generated wording is not entailed by its cited snippet — overstatement, ambiguity-to-certainty, numeric mismatch, contradiction — the statement is **blocked**. The upstream label does not create a bypass. This is the single most important property of the runtime: **the label reflects evidence strength; the gate reflects wording fidelity; display requires both.**

---

## 7. Answer Generation and Verification Sequence

For each statement, the strict per-statement sequence is:

1. **Generate** (stage 5) produces the answer in the required format with its citations (spec 04 §3/§16).
2. **Verify** (stage 6) runs the entailment architecture (§8) against the cited snippet(s), producing a verification status (spec 09 §3).
3. **Route on status:**
   - *Fully Supported* → eligible for the report.
   - *Partially Supported* → enter the rescope-and-reverify path (§9), one pass only.
   - *Contradicted / Unsupported / Insufficient Evidence* → block; replace or route to review (§10).
4. **Only statements that end at Fully Supported** (originally, or after one successful rescope) are handed to report assembly (stage 7).

No statement skips step 2. A Confirmed label from stage 4 does not exempt a statement from verification — generation and scoring are necessary but not sufficient for display; verification is the sufficiency check.

---

## 8. Entailment Verification Architecture

Verification (stage 6) runs a **two-tier** entailment check: a cheap deterministic pre-filter first, then a model-based judge only for statements that survive it. This ordering keeps cost down and makes the mechanical failures catch deterministically, reserving the model for genuinely semantic judgments.

**Tier 1 — Deterministic pre-filter (runs on every statement).** Catches mechanical failures without a model:

- **Citation orphan check** — every citation resolves to a real `source_ref` with a non-empty `text_snippet` and all five binding elements (spec 09 §2/§5). Orphan or missing binding → Unsupported, blocked; no Tier 2 needed.
- **Numeric mismatch check** — every stated figure (limit, sublimit, deductible, coinsurance, waiting period, deadline) matches the cited snippet exactly, including scope/unit (spec 09 §7). Mismatch → Contradicted, blocked.
- **Missing-qualifier check** — limiting language in the snippet (`not`, `except`, `unless`, `subject to`, `only if`, `provided that`) that bears on the claim is reflected in the statement; a dropped qualifier → flagged for Tier 2 as potential overstatement, or Contradicted if the drop inverts a limitation (spec 09 §6B, spec 02 §8).

A statement failing a Tier-1 hard check (orphan, numeric mismatch, inverting qualifier drop) is blocked immediately and does not proceed to Tier 2.

**Tier 2 — Model-based entailment judge (runs only on Tier-1 survivors that need semantic judgment).** Judges whether the wording is entailed by the snippet, targeting the two semantic failures the pre-filter can't decide:

- **Overstatement check** — does the statement assert more coverage/broader scope than the snippet grants? (spec 09 §6B) → Partially Supported (rescope) or Contradicted.
- **Ambiguity-to-certainty check** — does the statement present a definite conclusion where the snippet is genuinely ambiguous or turns on an undefined material term? (spec 09 §6C) → Insufficient Evidence.

The Tier-2 judge operates only against the cited snippet as written — it may not add outside assumptions, industry norms, or knowledge of "how policies usually work" (spec 01 §5, spec 09 §6). Its output is one of the five verification statuses (spec 09 §3), which orchestration then routes per §7.

Rule: Tier 1 is mandatory for every statement; Tier 2 runs only when Tier 1 passes but a semantic judgment remains (overstatement/ambiguity). A statement Tier 1 can fully clear as mechanically exact and non-overstating still passes to Tier 2 only if any qualifier or scope nuance needs semantic confirmation — otherwise it is Fully Supported on Tier 1 alone. Implementers may treat Tier 2 as skippable only when Tier 1 leaves no semantic question open.

---

## 9. Rescope-and-Reverify Rule

When verification returns **Partially Supported**, orchestration attempts exactly **one** rescope pass (spec 09 §11.1):

1. Strip the unsupported portion of the statement, leaving only what the snippet Fully Supports (e.g., drop an unverified limit, keep "coverage appears listed").
2. Re-run the rescoped statement through verification (§8).
3. **Evaluate the single re-verification result:**
   - *Fully Supported* → the rescoped statement is displayed.
   - *Anything other than Fully Supported* → **stop.** Do not rescope again.

**Hard cap: one rescope pass.** If the rescoped statement still fails verification, orchestration must **not** loop. It replaces the statement with an insufficient-evidence response (spec 04 §15) or routes it to human review per §10. This cap is absolute — there is no second rescope under any circumstance, to prevent indeterminate loops where each rescope shaves the claim without ever clearing the bar.

---

## 10. Human Review Routing

Orchestration routes a blocked statement to human review — rather than auto-replacing it — under the conditions defined in spec 08 §11 and spec 09 §12 (orchestration enforces the routing; it does not define reviewer workflow, which is out of scope, §15). Route to review when:

- The blocked statement is a **core-category coverage conclusion** (mortality, major medical, surgical, colic, theft, humane destruction) returning Contradicted or Unsupported.
- An **entailment mismatch, numeric contradiction, or exclusion conflict on a core category**.
- The block reason is ambiguous between "genuinely unsupported" and "supported by a snippet extraction may have mis-scoped" — a case a human could plausibly resolve.
- A rescoped statement (§9) still failed and falls into any of the above.

All other blocked statements — non-core, or clearly insufficient-evidence with no plausible support — are **auto-replaced** with the safe insufficient-evidence response and not queued. Reviewer outcomes, for routing purposes only: approve as-is, approve with lowered label/rescoped wording, or suppress with an insufficient-evidence message. A reviewer may never raise a statement above what its cited snippet supports (spec 09 §12).

---

## 11. Error Handling

Errors are distinguished from blocks: a **block** is the pipeline working correctly (an unsupported claim stopped); an **error** is a stage failing to execute. Handling:

| Error class | Behavior |
|---|---|
| **Stage execution failure** (a stage throws/times out) | Retry per §12; on exhausting retries, halt the unit and surface a system-state message (spec 06 §3), not a partial unverified result. |
| **Malformed inter-stage input** | Treat as the consuming stage's failure; do not attempt to repair upstream output; halt and audit. |
| **Extraction total failure** | Failed-extraction gate (§6); no downstream stages run; no report. |
| **Model invalidity** (spec 07 §11 fails) | Do not pass to scoring; surface the validation failure as a system-state error, not a silently corrected model. |
| **Verification unavailable** | If verification (stage 6) cannot run, **nothing is displayed** — the pipeline fails closed. An unverified answer is never shown because the gate was down. |
| **Partial per-statement failure** | A single statement erroring does not fail the whole report; that statement is blocked/replaced and the rest proceed, with the gap stated (spec 08 §9). |

**Fail-closed principle:** whenever the choice is between showing something unverified and showing nothing, orchestration shows nothing (or an explicit system-state message). Display is a privilege earned by passing verification, never a default (spec 01 §5, spec 09 §1).

---

## 12. Retry and Loop Limits

| Loop / retry | Limit | On exhaustion |
|---|---|---|
| **Stage execution retry** (transient failure/timeout) | Bounded, small retry count per stage (exact value a build-config decision) | Halt the unit; system-state error; audit the failure. |
| **Rescope-and-reverify** (§9) | **Exactly one** rescope pass — hard cap | Replace with insufficient-evidence response or route to review; never rescope again. |
| **Tier-2 entailment judge** | One judgment per statement (or per rescoped statement) | No re-judging the same wording; the returned status is final for that wording. |
| **Whole-pipeline** | One pass per upload; re-running requires a new analysis (new `analysis_id`) | A failed upload is not silently re-driven; a fresh run is a fresh audit trail. |

Rule: no loop in the runtime is unbounded. Every retry and every rescope has a fixed ceiling, and exhaustion always resolves to a safe terminal state (block, replace, review, or system-state error) — never to an indefinite retry or an unverified display.

---

## 13. Audit Trail Requirements

Every stage transition for every unit writes an audit record. Required fields on each record:

| Field | Meaning |
|---|---|
| `stage_entered` | Which stage the unit entered (extract/classify/model/score_route/generate/verify/report) |
| `stage_completed` | Which stage completed (with success/blocked/error outcome) |
| `input_object_id` | ID of the object consumed (e.g., `upload_id`, `analysis_id`, `clause_id`, `answer_id`) |
| `output_object_id` | ID of the object produced |
| `confidence_label` | The spec 08 label at that point (Confirmed/Likely/Unclear/Not Found), where applicable |
| `verification_result` | The spec 09 status, for verify-stage records (Fully/Partially Supported, Contradicted, Unsupported, Insufficient Evidence) |
| `block_reason` | Which blocking gate fired (§6), if any |
| `review_reason` | Why routed to review (§10), if any |
| `timestamp` | When the transition occurred |

Rules:
- The audit trail must be sufficient to **reconstruct any answer's full path** — from which upload and pages it drew, what label it carried, whether it was rescoped, whether verification passed, and if not, why it was blocked or routed. This is the accountability mechanism behind "no source, no answer": every displayed answer, and every *blocked* one, has a traceable record.
- Blocked and review-routed statements are audited with the **same rigor** as displayed ones — a blocked answer's `block_reason` is as important to record as a passed answer's success, since blocking is core product behavior (spec 09 §11).
- Audit records are internal; they are not consumer-facing and carry no policy text beyond object IDs and the labels/reasons above. (Where any snippet is retained for audit, it is subject to the spec 01 §14 retention constraints — a decision deferred to infrastructure, §15.)

---

## 14. Runtime JSON State Example

Illustrative runtime state for one answer that carried a Confirmed label out of scoring but was blocked by verification for overstatement, rescoped once, and then displayed. Trimmed for readability.

```json
{
  "analysis_id": "an_001",
  "answer_id": "ans_medmaj_02",
  "pipeline_order": ["extract","classify","model","score_route","generate","verify","report"],
  "current_stage": "report",
  "upstream_confidence_label": "Confirmed",
  "generate": { "status": "complete", "statement": "Your policy covers all veterinary costs up to $7,500." },
  "verify": {
    "tier1": { "citation_orphan": "pass", "numeric_mismatch": "pass", "missing_qualifier": "flagged_for_tier2" },
    "tier2": { "overstatement": "fail", "ambiguity_to_certainty": "pass" },
    "verification_result": "Partially Supported",
    "block_reason": "overstatement_of_policy_language"
  },
  "rescope": {
    "attempt": 1,
    "rescoped_statement": "Your policy appears to include Major Medical coverage up to $7,500, and does not cover routine or preventive care.",
    "reverify_result": "Fully Supported"
  },
  "final_display_outcome": "show_rescoped",
  "routed_to_review": false,
  "verification_overrode_confirmed": true,
  "audit": [
    { "stage_entered":"generate","stage_completed":"generate","input_object_id":"cov_medmaj","output_object_id":"ans_medmaj_02","confidence_label":"Confirmed","verification_result":null,"block_reason":null,"review_reason":null,"timestamp":"2026-07-05T00:41:12Z" },
    { "stage_entered":"verify","stage_completed":"verify","input_object_id":"ans_medmaj_02","output_object_id":"ver_medmaj_02","confidence_label":"Confirmed","verification_result":"Partially Supported","block_reason":"overstatement_of_policy_language","review_reason":null,"timestamp":"2026-07-05T00:41:13Z" },
    { "stage_entered":"verify","stage_completed":"verify","input_object_id":"ans_medmaj_02_rescoped","output_object_id":"ver_medmaj_02b","confidence_label":"Likely","verification_result":"Fully Supported","block_reason":null,"review_reason":null,"timestamp":"2026-07-05T00:41:14Z" },
    { "stage_entered":"report","stage_completed":"report","input_object_id":"ver_medmaj_02b","output_object_id":"rpt_sec_medical","confidence_label":"Likely","verification_result":"Fully Supported","block_reason":null,"review_reason":null,"timestamp":"2026-07-05T00:41:15Z" }
  ]
}
```

The `verification_overrode_confirmed: true` field records the governing property: a Confirmed label out of scoring did not exempt the statement from being blocked and rescoped by verification.

---

## 15. Out-of-Scope

This specification does **not** cover:

- **Stage-internal logic** — how extraction, classification, modeling, scoring, generation, verification, and rendering actually work (specs 02–09 own those). Orchestration treats each as a black box with a defined input/output.
- **Reviewer UI, assignment, SLAs, queue operations, or workflow** — orchestration routes *to* review and records *why*; everything about how review is conducted is out of scope.
- **Database schemas, tables, migrations, and where state/audit records physically live** — an infrastructure decision, subject to spec 01 §14 retention constraints.
- **Report layout and rendering** — spec 05 owns display; orchestration only decides what is eligible to be rendered.
- **Confidence scoring and verification rules themselves** — specs 08 and 09 own the rules; orchestration sequences and gates on them.
- **Concurrency/scaling implementation** — orchestration defines *order and gates*; how many statements verify in parallel, queueing, and throughput are infrastructure concerns (the order constraints in §5 must hold regardless).
- **Exact retry counts and timeout values** — named as build-config decisions in §12; the requirement that every loop is bounded is in scope, the specific numbers are not.
- **Legal interpretation** — orchestration sequences a pipeline whose every stage checks document support, never legal enforceability or claim outcome (spec 01 §4).

---

*End of v1.0 Runtime Orchestration Specification. This document defines the fixed end-to-end pipeline (extract → classify → model → score/route → generate → verify → report/display), the blocking gates between stages, the two-tier entailment architecture, the one-pass rescope cap, and the audit trail — with verification as the final gate that can block display even on a Confirmed label. It introduces no new stage logic and no new confidence vocabulary.*
