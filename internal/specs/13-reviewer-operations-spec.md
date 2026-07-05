# Horse Insurance Coverage Checkup™
## Reviewer Operations Specification — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Implementation Reference
**Scope:** Human review operations only. Defines what happens after the system routes an item to review — queue entry types, reviewer workflow, permitted outcomes, notes, priority, and user-facing status. Does not define reviewer UI implementation, schemas, auth integration, or the routing logic that feeds the queue (specs 08–10/12 own that).

---

## 1. Purpose

Specs 08–10 route certain items to human review: unsupported or contradicted answers, core-category conflicts, snippet-wording mismatches, integrity faults (spec 08 §11, spec 09 §12, spec 10 §10). Spec 12 §13 fixes the *access boundary* reviewers operate within — authenticated, role-limited, audited, never public. Neither defines the *work itself*: what a reviewer sees, what they may decide, what they may never do, and how their decision flows back to the user. This document owns that work.

Reviewer operations exist because the product deliberately blocks anything it cannot verify (spec 09 §1, spec 10 §6). Blocking is correct behavior, not failure — but some blocked items are recoverable by a human who can confirm that a cited snippet does support a rescoped claim, or that an extraction mis-scoped a source that actually exists. Review is the controlled path for that recovery. It is **not** a path to override the product's guardrails: a reviewer works strictly within the same "no source, no answer" and "confidence is not legal certainty" constraints as the automated pipeline (spec 01 §5, spec 08 §2). A reviewer can *confirm* support the machine couldn't, *narrow* a claim to what the source supports, or *reject* it — never *manufacture* support that isn't there.

**Governing constraint:** a reviewer may never raise a statement above what its cited policy text supports (spec 09 §12, spec 10 §10). Every reviewer outcome is bounded by the same source-fidelity rules that bind generation and verification. Review adds human judgment inside the guardrails; it does not lift them.

---

## 2. Reviewer Operations Overview

- Items arrive in a **review queue** because an upstream stage routed them (spec 08 §11, spec 09 §12, spec 10 §10) — reviewers do not pull arbitrary analyses; they act only on routed items.
- A reviewer is an **authenticated, role-limited staff identity** (`reviewer` or `admin`, spec 12 §4/§13), never a consumer self-signup role. Every reviewer action is **audited** (spec 12 §11/§13).
- A reviewer sees **only the specific routed item and the content needed to decide it** — the statement, its cited snippet(s), page/section reference, confidence label, and verification result (spec 12 §13). Not the whole analysis, not other users' data (spec 12 §7).
- The reviewer produces one of **three outcomes** (§9), which flows back to display: approve, revise/rescope-and-approve, or reject/block. The user sees the *result* through safe status language (§13) — never the queue, the reviewer's identity, or the fact of routing beyond a neutral "review required" state.
- Blocked user-facing output **stays blocked** until a review outcome permits display or a safe replacement is used (§11) — the product never shows an unverified item while it waits for review.

---

## 3. Review Queue Entry Types

Each queue entry carries a **type** identifying what was routed. The thirteen MVP entry types:

| Entry type | Origin | What the reviewer assesses |
|---|---|---|
| **Field-level extraction issue** | spec 08 §4 field scoring | Whether an extracted scalar (carrier, date, value) is correctly read from its source |
| **Missing source mapping** | spec 08 §7, spec 10 §6 | Whether a statement truly lacks source support or the source was mis-mapped |
| **Weak OCR confidence** | spec 02 §6, spec 08 §5 | Whether low-band OCR text is legible enough to support a statement |
| **Conflicting clauses** | spec 02 §11, spec 03 §10, spec 08 §10 | Whether a real conflict exists and how it should be surfaced (never resolved to one value) |
| **Ambiguous coverage relationship** | spec 03 §4/§11 | Whether a grant's links to limits/exclusions/conditions are correctly established |
| **Unclear coverage limit** | spec 04 §13, spec 09 §7 | Whether a limit figure is confirmable or genuinely conflicting |
| **Ambiguous exclusion** | spec 03 §6, spec 09 §9 | Whether an exclusion's scope is supportable or turns on an undefined term |
| **Partial upload issue** | spec 02 §14, spec 10 §6 | Whether missing documents materially limit an answer |
| **Unsupported answer** | spec 09 §6A, spec 10 §6 | Whether the cited snippet supports the wording, or it's genuinely unsupported |
| **Contradicted answer** | spec 09 §6/§7/§9, spec 10 §6 | Whether the statement contradicts its snippet |
| **Insufficient evidence response** | spec 09 §6C/§8 | Whether evidence is too weak/ambiguous to sustain the statement |
| **Failed report section** | spec 08 §9, spec 10 §6 | Whether a section's gap can be safely surfaced or the section stays unavailable |
| **Owner/account integrity fault** | spec 12 §17 | An artifact lacking a resolvable owner — a security/integrity item, not a content judgment |

Rule: an **owner/account integrity fault** is handled distinctly (§14/§16) — it is never a "just approve the content" decision; a reviewer cannot assign an owner to an ownerless artifact, and the item stays inaccessible until the integrity fault is resolved through a security path, not the content-review path.

---

## 4. Review Routing Reasons

Each entry also carries the **routing reason** the upstream stage recorded (spec 10 §13 `review_reason`), so the reviewer knows *why* the machine couldn't resolve it. Reasons map to the entry types above and include: core-category contradiction, snippet-wording mismatch on a core category, numeric contradiction on a core figure, exclusion conflict on a core category, ambiguous-support (extraction may have mis-scoped a real source), and integrity fault (spec 08 §11, spec 09 §12, spec 10 §10).

Rule: the routing reason is **read-only context** for the reviewer — it explains the block; it does not pre-decide the outcome. A reviewer still independently assesses the item against its cited source (§8) and may reach any of the three outcomes regardless of the reason recorded.

---

## 5. Reviewer Roles and Permissions

Carried from spec 12 §4/§13, restated as operational permissions:

| Role | May do | May not do |
|---|---|---|
| `reviewer` | Access routed queue items; view the item's statement, snippet(s), page/section, confidence label, verification result; record one of the three outcomes (§9) with a note (§10) | Access non-routed analyses; view other users' data; access anything beyond the item's decision content; create public access; raise a statement above its source |
| `admin` | Reviewer permissions plus bounded operational actions (reassignment, escalation handling per §14) | Blanket read of all policy content; any action outside a specific operational need; anything a reviewer may not do |

Rules:
- Roles are **authenticated staff identities** (spec 12 §5), never consumer roles; not grantable by self-signup (spec 12 §13).
- Every access and every outcome is **audited** (§12, spec 12 §11/§13).
- Neither role may **expose private policy content outside the review workflow** or convert it to public/indexable content (spec 12 §13/§16). A reviewer viewing a snippet is an internal, audited, purpose-bound access — not a republication.

---

## 6. Review Queue UI Requirements

The reviewer interface (implementation out of scope, §17) must present:

- **Queue list** — the reviewer's accessible routed items.
- **Queue filters** — by priority, status, and routing reason/entry type (§3/§4/§11).
- **Source snippet display** — the verbatim cited `text_snippet`(s) the statement rests on (spec 02 §5, spec 09 §4).
- **Page reference display** — `system_page_number` / `printed_page_number` (spec 02 §4, spec 09 §2).
- **Policy section display** — `section_heading` / `clause_heading` (spec 09 §2).
- **Generated answer or report statement display** — the exact wording under review (spec 04 §16, spec 09 §2).
- **Confidence label display** — the spec 08 label (Confirmed/Likely/Unclear/Not Found).
- **Verification result display** — the spec 09 status (Fully/Partially Supported, Contradicted, Unsupported, Insufficient Evidence).
- **Reviewer outcome selector** — the three permitted outcomes (§9), no others.
- **Reviewer note field** — for the required note (§10).
- **Audit event creation** — every view and every outcome writes an audit record (§12), without duplicating policy text into general logs (spec 12 §16).

Rule: the UI shows **only the item's decision content** — it is not a browser for the full analysis or for other users' data (spec 12 §7/§13). Isolation is enforced server-side (spec 12 §2/§7); the UI never receives content the reviewer isn't entitled to.

---

## 7. Assignment Rules

Practical for MVP:

- **Unassigned queue is acceptable at launch** — items sit in a shared queue reviewers work from.
- **Manual assignment is acceptable at launch** — a reviewer or admin may claim/assign an item.
- **Auto-assignment is optional and out of scope for MVP** (§17) — no routing-to-specific-reviewer logic is required at launch.
- **Assignment changes must be audited** (spec 12 §11) — claim, reassign, and release are each recorded as events (who, which item, when).
- An item may be **claimed by one reviewer at a time** to avoid duplicate work; a claim conflict is a failure state (§16).

---

## 8. Reviewer Workflow

For each item, the reviewer:

1. **Opens the item** (audited access, §12) and reads the statement under review, its routing reason (§4), confidence label, and verification result.
2. **Reads the cited source** — the verbatim snippet(s), page reference, and policy section (§6).
3. **Assesses support** against the same bar the pipeline uses (spec 09 §6): does the cited snippet, as written, support the statement's exact wording — without adding outside assumptions, industry norms, or legal interpretation (spec 01 §5)?
4. **Selects one of the three outcomes** (§9) and **records a note** (§10).
5. The outcome flows back to display: approved/rescoped content becomes eligible for the report (subject to the same verification the pipeline applies to any displayed statement); rejected content stays blocked and is replaced with a safe user-facing status (§13).

Rule: the reviewer assesses **the cited source only** — not their own outside knowledge of "how policies usually work" (spec 01 §5), not the likely claim outcome (spec 08 §2). If the cited source doesn't support the statement, the reviewer cannot approve it into a supported state by supplying the missing support themselves (§9 prohibitions).

---

## 9. Permitted Reviewer Outcomes

Exactly three outcomes, no others (spec 09 §12, spec 10 §10):

**1. Approve as supported.**
The reviewer confirms the cited snippet(s), as written, fully support the statement's wording. Used when the automated verification blocked or under-scored an item the human can confirm is genuinely supported (e.g., a snippet the extraction mis-flagged). The statement becomes eligible for display at a label no higher than its source supports.

**2. Revise / rescope and approve.**
The reviewer narrows the statement to what the source *does* support (dropping an unsupported limit, restoring a dropped qualifier, preserving an ambiguity), then approves the narrowed version. Equivalent to the pipeline's rescope (spec 09 §11) but human-performed. The rescoped statement is still subject to verification's source-fidelity bar — the reviewer may only narrow toward the source, never broaden beyond it.

**3. Reject / block from user display.**
The reviewer confirms the statement is not supportable from the cited source. It stays blocked and is replaced with a safe insufficient-evidence / unable-to-answer status (§13). Rejection is a correct, expected outcome — not a failure.

**Reviewers cannot** (hard prohibitions, enforced as the boundary of every outcome):
- **Invent policy language** — a reviewer never adds text the documents don't contain (spec 04 §2).
- **Override missing source text without citation** — a statement with no supporting snippet cannot be approved into existence; "approve" requires a real cited snippet that supports the wording (spec 09 §5/§6A).
- **Turn ambiguity into certainty** — an ambiguous or undefined-term source cannot be approved as a definite conclusion (spec 09 §6C).
- **Provide legal advice** — no reviewer outcome characterizes enforceability, claim outcome, or legal remedy (spec 01 §4, spec 08 §2).
- **Approve answers unsupported by cited policy text** — the source-fidelity bar is absolute; approval means "the cited text supports this," never "this is probably right."
- **Expose private policy content outside the review workflow** — content stays inside the audited, purpose-bound workflow (spec 12 §13/§16).

---

## 10. Required Reviewer Notes

- Every outcome **requires a reviewer note** capturing the basis for the decision — specifically, *how the cited source supports (or fails to support) the statement*.
- The note is **mandatory for reject and revise/rescope outcomes**, and required for **approve** as well, so the audit trail (§12) records *why* a blocked item was cleared, not just that it was.
- A note must reference the **cited source** the decision rests on (the snippet/page/section already displayed) — it is the human counterpart to the pipeline's `confidence_reason`/verification finding (spec 08 §6, spec 09 §13).
- A **missing required note is a failure state** (§16) — an outcome cannot be finalized without it.
- Notes are internal audit content; they carry the reviewer's reasoning and may reference the already-displayed snippet, but are not consumer-facing (spec 12 §11) and are never a channel to expose content beyond the item.

---

## 11. SLA / Priority Rules

Four priority tiers, assigned from entry type and routing reason:

| Priority | Typical items | Handling posture |
|---|---|---|
| **Critical** | Owner/account integrity fault (§3/§16); any suspected cross-account/security item | Handled first; security path, not just content review (§14) |
| **High** | Core-category contradicted/unsupported answers (mortality, major medical, surgical, colic, theft, humane destruction) | Prioritized ahead of normal content review |
| **Normal** | Non-core unsupported/contradicted/insufficient-evidence items, ambiguous exclusions/limits, conflicting clauses | Standard queue handling |
| **Low** | Field-level extraction issues and partial-upload items with limited downstream impact | Handled as capacity allows |

Rules:
- **No guaranteed legal or emergency response.** The product is educational (spec 01 §2/§4); review is not an emergency service, and priority tiers are workload ordering, not a service guarantee. This must be reflected in user-facing language (§13) — a user is never told review will happen within a promised time or will resolve their coverage question authoritatively.
- **Blocked user-facing output remains blocked until a review outcome allows display or a safe replacement is used** (§2, spec 10 §6). Priority affects *ordering*, never whether an unverified item may be shown early. Nothing is displayed unverified because its review is pending.
- Priority is internal; it is never surfaced to the user as a promise (§13).

---

## 12. Audit Trail Requirements

Every reviewer interaction writes an audit record, consistent with spec 10 §13 and spec 12 §11/§13:

- **Access events** — a reviewer opening an item records who, which item (`analysis_id`/`answer_id`/entry ID), when.
- **Outcome events** — the selected outcome (§9), the reviewer note (§10), the resulting display disposition (eligible / rescoped / blocked-replaced), and timestamp.
- **Assignment events** — claim, reassign, release (§7).
- **Escalation events** — routing to admin/escalation (§14).
- Records carry **IDs, roles, outcomes, reasons, timestamps — not unnecessary policy text** (spec 10 §13, spec 12 §8/§16). Where the reviewer's note references the cited snippet, it lives in the review record under the item's access control, not in a general operational log.
- The trail must **reconstruct any reviewed item's full path**: routed → assigned → viewed → outcome → display disposition, mirroring the pipeline's reconstruct-any-answer requirement (spec 10 §13). Rejected items are audited with the same rigor as approved ones.

---

## 13. User-Facing Status Rules

The user sees a neutral, safe status — never the queue, the reviewer, the routing reason, or another user's anything (spec 12 §7/§12). Safe language for each state:

| State | Safe user-facing language (register, not verbatim mandate) |
|---|---|
| **Analysis in progress** | "We're reviewing your documents now. This may take a moment." (spec 06 §3) |
| **Review required** | "Part of your report is still being checked and isn't ready yet." — neutral, no timeline promise, no mention of why. |
| **Insufficient evidence** | "The uploaded documents don't contain enough information to answer that." (spec 04 §15) |
| **Unable to answer from uploaded policy** | "We couldn't find enough in your uploaded documents to answer this reliably." (spec 04 §15, spec 09 §11) |
| **Report section unavailable** | "This section isn't available based on the documents you uploaded." — states the gap, promises nothing. |
| **Completed report with reviewed items** | The finished report displays verified content normally (spec 05); reviewed items appear as their approved/rescoped result or as a safe insufficient-evidence statement. The report does not annotate which items passed through human review. |

Rules:
- User-facing status **never promises a review timeline, an emergency response, or an authoritative coverage determination** (§11, spec 01 §4).
- User-facing status **never reveals** the routing reason, the reviewer's identity/notes, priority tier, or the existence of the queue (spec 12 §12).
- A **blocked item shows a safe status, never a softened-but-affirmative claim** ("probably covered") — consistent with spec 09 §11 / spec 10 §6.

---

## 14. Escalation Rules

- **Content escalation** — a reviewer uncertain whether an item is supportable may escalate to `admin` for a second decision (audited, §12). Escalation does not change the outcome bar: the escalated decision is still bounded by §9's prohibitions.
- **Integrity/security escalation** — an **owner/account integrity fault** (§3, spec 12 §17) is escalated to the security/integrity path, not resolved as content. A reviewer cannot assign an owner or serve an ownerless artifact; the item stays inaccessible until resolved through the spec 12 fail-closed handling (§16).
- **No legal/attorney escalation** — there is no attorney-escalation network or legal-advice workflow (§17). An item that would *require* legal interpretation to resolve is not escalated to a lawyer; it is handled as insufficient-evidence / unable-to-answer (§13), because the product does not provide legal conclusions (spec 01 §4).
- Escalations are audited as events (§12) and never widen access beyond the role boundary (spec 12 §13).

---

## 15. Security and Privacy Rules

Carried from spec 12 §16, restated for the review context:

- **Reviewers must be authenticated** (spec 12 §5); an unauthenticated request reaches no queue content (§16).
- **Reviewer/admin access is role-limited** to routed items and their decision content (§5, spec 12 §13).
- **Reviewer access is audited** — every view and outcome (§12).
- **Reviewers must not create public access** to private policy content; a review view is internal, purpose-bound, and never a republication or public URL (spec 12 §13/§16).
- **Users never see another user's** policy content, snippets, reports, review status, or audit records (spec 12 §7/§12) — isolation is enforced server-side regardless of the review workflow.
- **No sensitive policy text in general logs**; snippets live only in the item's access-controlled review record (spec 12 §16).
- A reviewer's access is **scoped to the item**, not the analysis — opening a review item does not grant a browse of the owner's full policy or other analyses (§6, spec 12 §7).

---

## 16. Failure States

All fail closed — deny/hold and audit; never default open or show unverified content (spec 10 §11, spec 12 §17).

| Failure | Behavior |
|---|---|
| **Reviewer not authenticated** | No queue access; request denied; audited (spec 12 §5/§17). |
| **Reviewer lacks role** | An identity without `reviewer`/`admin` scope is denied queue access (default deny, spec 12 §6/§13); attempt audited. |
| **Queue entry missing owner/account** | Handled as an integrity fault (§3/§14): the item is inaccessible for content review and escalated to the security path; a reviewer cannot assign an owner (spec 12 §17). |
| **Source snippet missing** | The item cannot be approved (no cited text to support a statement, §9); only reject/block is available, or the item returns for re-extraction — never approved without a snippet (spec 09 §5). |
| **Page reference missing** | Treated like a missing binding element (spec 09 §2): the item cannot be approved as-supported without a resolvable source location; reject/block or return for re-mapping. |
| **Reviewer approves unsupported item** | Not permitted — the outcome is invalid and blocked; an approve outcome requires a cited snippet that supports the wording (§9). An attempt is audited and the item stays blocked. |
| **Reviewer note missing where required** | The outcome cannot be finalized (§10); the system does not record an outcome without its required note. |
| **Assignment conflict** | Two reviewers claiming one item resolves to a single owner-of-record; the losing claim is rejected and audited (§7). |
| **Stale queue entry** | An entry whose underlying analysis was deleted/expired (spec 11 §15, spec 12 §14) is retired from the queue, not acted on; retirement is audited. A pending-review item never blocks a user's deletion request. |
| **Attempted cross-account access** | Denied and audited as a security event (spec 12 §17); never served, regardless of request shape. |

---

## 17. Out-of-Scope

This specification does **not** cover:

- **Actual reviewer UI implementation** — §6 defines *what the UI must present*; the built interface is a separate artifact, not deployed without approval.
- **Database migrations and schemas** — queue/review-record persistence responsibility is inherited from spec 11 §7; concrete schema is a build artifact, not defined here.
- **Auth provider integration** — reviewers authenticate via the same provider decision deferred in spec 12 §18; no provider is selected or wired here.
- **Payment / subscription logic** — out of scope entirely.
- **Legal advice workflow** — the product provides no legal conclusions (spec 01 §4); there is no legal-review path (§14).
- **Attorney escalation network** — none exists; items needing legal interpretation are handled as insufficient-evidence (§14).
- **Exact retention-window legal approval** — the posture is fixed (spec 11 §15); numeric windows are a compliance sign-off item; review records follow the same retention as their analysis.
- **Production staffing plan** — how many reviewers, shifts, and coverage hours are an operational decision; this spec defines the *work and its boundaries*, not staffing.
- **Auto-assignment logic** — optional and out of scope for MVP (§7).
- **Routing logic that feeds the queue** — specs 08–10 own *what gets routed and why*; this spec owns *what happens once it's in the queue*.

---

*End of v1.0 Reviewer Operations Specification. This document defines the human-review workflow inside the spec 12 access boundary — the thirteen queue entry types, the three permitted outcomes (approve / revise-and-approve / reject), the hard prohibitions that keep reviewers within the same source-fidelity guardrails as the pipeline, MVP-practical assignment, priority tiers with no service guarantee, safe user-facing status language, and fail-closed failure handling. It introduces no new pipeline logic, no new confidence vocabulary, and no legal-advice path.*
