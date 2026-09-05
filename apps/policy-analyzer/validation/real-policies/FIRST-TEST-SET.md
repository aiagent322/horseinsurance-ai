# First controlled real-policy test set

Do not use private customer policies in this round.

Use only carrier specimen policies, specimen forms, sample policies Western Media Network owns or has permission to use, and deliberately redacted packages.

## Minimum size

**12 packages** is the smallest set that can expose the failure modes the analyzer must survive before a broader real-policy program. Fewer than that leaves a hole in either extraction (scan/OCR) or package structure (multi-document / endorsement / missing form).

A second round of 8–12 packages can wait until the first 12 have human-reviewed discrepancies.

## Required mix

| ID | Package | Why it is in the first round |
| --- | --- | --- |
| RP-01 | Clean native-text mortality + medical specimen | Baseline hosted happy path |
| RP-02 | Scanned specimen of the same product | Real OCR path |
| RP-03 | Scan with hyphenation / compression noise | OCR quality must not invent grants |
| RP-04 | Poor-quality scan (skew, dark copy) | Must go `needs_review`, not false COVERED |
| RP-05 | Multi-document: declarations + base form + endorsement | Ordering and citation document IDs |
| RP-06 | Later endorsement supersedes earlier medical grant | Controlling-language / later-page rule |
| RP-07 | Two pages state different medical limits, no controller | Conflict → `needs_review` |
| RP-08 | Declarations list a form that is not in the upload | Missing scheduled form |
| RP-09 | Listed form edition does not match uploaded edition | Edition mismatch |
| RP-10 | Duplicate or reordered pages | Must not double-count or drop a grant |
| RP-11 | Named-insured / policy-number omitted or redacted | Identity completeness |
| RP-12 | Handwritten marks or stamps on a specimen, if available; otherwise a redacted endorsement stamp | Must not treat marks as policy language |

If a handwritten specimen is not available, substitute another rights-cleared endorsement-only add-on and record the substitution in reviewer notes. Do not skip RP-06 through RP-09.

## Human review

For each package, a reviewer who did not write the analyzer fills `human_reviewed_result` before anyone pastes analyzer output. Record carrier, form type, page count, scanned vs native, and citations by document id and page.

Discrepancies are classified (`coverage_status`, `citation`, `limit`, `form_inventory`, `conflict`, and so on) and given a severity. Critical discrepancies block expanding the set.

## Hosted staging use

Upload these only to the isolated hosted staging project, after:

1. Staging project allowlist is set
2. Accepted migrations are applied to that project only
3. `POLICY_ANALYZER_UPLOADS_ENABLED=true` is set on staging only
4. User A / User B isolation has passed on that project

Do not enable production uploads. Do not point the disposable loopback helper at this project.
