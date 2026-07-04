# Horse Insurance Coverage Checkup™
## User Upload Flow Specification — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Implementation Reference
**Scope:** Consumer-facing upload flow only, prior to analysis.

---

## 1. Upload Flow Purpose

The upload flow is the consumer's first interaction with the product. It must accomplish three things: help the horse owner upload the best available set of policy documents, help them understand which document types actually matter to a useful analysis, and set honest expectations that an incomplete upload will limit what the report can confirm.

The flow must be simple enough for a non-technical user to complete without guidance, mobile-friendly since many owners will photograph paperwork from a barn or trailer rather than upload from a desktop, and privacy-conscious given that insurance and financial documents are sensitive. Nothing in this flow involves an agent, a sales conversation, or a quote request — it exists solely to collect documents for analysis.

---

## 2. Upload Screen Requirements

The upload screen must include:

- **Product name** — "Horse Insurance Coverage Checkup™" displayed prominently.
- **Short explanation** — one or two plain-English sentences stating that the tool reads uploaded policy documents and answers questions based only on what's found in them.
- **Accepted file types** — clearly listed (e.g., PDF, JPG, PNG).
- **Maximum file guidance placeholder** — a note on file size/count limits (exact values to be finalized with infrastructure).
- **Document checklist** — a visible list helping the user gather the right paperwork, including:
  - Declarations page
  - Full policy form
  - Mortality coverage form
  - Major medical endorsement
  - Surgical endorsement
  - Emergency colic surgery endorsement
  - Exclusions
  - Conditions
  - Claim procedure pages
  - Renewal notice
  - Invoice, if available
  - Any riders or endorsements
- **Privacy/retention notice placeholder** — a short statement on how uploaded documents are handled (final retention policy pending legal/compliance sign-off, per the product foundation spec).
- **Required disclaimer checkbox** — user must actively acknowledge the tool is educational only before uploading is enabled.
- **Upload button** — initiates file selection.
- **Add more files option** — lets the user attach additional documents without restarting.
- **Continue to analysis button** — enabled only once at least one file is added and the disclaimer is checked.
- **Error message area** — a consistent, visible location for any upload-related error message (see Section 3).

The checklist is presented as helpful guidance, not a hard requirement — the user may proceed with whatever they have, understanding (per the disclaimer and messaging) that gaps will show up as limitations in the final report.

---

## 3. Pre-Analysis Consumer Messages

| Situation | Message |
|---|---|
| Successful file selection | "Got it — [file name] has been added." |
| Unsupported file type | "That file type isn't supported. Please upload a PDF, JPG, or PNG." |
| File too large | "That file is too large to upload. Please try a smaller file or a lower-resolution scan/photo." |
| Upload failed | "Something went wrong uploading that file. Please try again." |
| No file selected | "Please add at least one document before continuing." |
| Multiple files added | "You've added [n] files. You can add more or continue when you're ready." |
| Possible incomplete document set | "Based on what's uploaded, some sections of your policy may not be available for review. You can continue now, or add more documents first for a more complete report." |
| Blurry or unreadable image warning | "This image may be difficult to read clearly. If possible, try a clearer photo or scan for the best results." |
| Analysis started | "We're reviewing your documents now. This may take a moment." |
| Analysis failed | "We weren't able to complete the analysis. Please try again, or check that your files uploaded correctly." |

All messages are written in plain, calm, non-technical language. None imply blame, urgency, or alarm — the goal is to inform the user and let them decide how to proceed, not to pressure them into a particular action.

---

## 4. Upload Flow Rules

- Analysis must not begin until the user has actively accepted the disclaimer checkbox.
- The flow must never imply that every policy, regardless of what's uploaded, can be fully analyzed.
- The flow must never imply that the resulting report determines coverage or claim payment.
- The flow must not require agent name, agent contact information, or any agent-related field.
- The flow must never ask the user to request a quote or express interest in purchasing coverage.
- The flow must contain no sales calls-to-action of any kind.
- The user must be able to add more documents before starting analysis, without losing previously uploaded files.
- If the uploaded set appears incomplete relative to the document checklist, the flow must warn the user that this may reduce the confidence of the resulting report — before they commit to analysis.
- The user must be kept informed once processing starts (e.g., a visible "Analysis started" state), so they are never left wondering whether the upload succeeded.
- The entire flow must function equivalently on both desktop and mobile, including camera-based photo upload on mobile devices.

---

*End of v1.0 User Upload Flow Specification.*
