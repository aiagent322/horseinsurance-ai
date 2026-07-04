# Horse Insurance Coverage Checkup™
## Extraction Pipeline & Source-Mapping Specification — v1.0

**Owner:** HorseInsurance.ai
**Status:** Internal — Implementation Reference
**Scope:** Extraction and source-mapping only. Does not cover answer generation, report layout, pricing, frontend, or backend infrastructure.

---

## 1. Extraction Pipeline Purpose

Extraction quality is the foundation the entire product is built on. Every downstream commitment the product makes to the consumer — plain-English answers, source citations, confidence levels, "no source, no answer" — is only as trustworthy as the extraction layer that feeds it. If extraction silently drops a clause, misreads a number, or loses track of which page a limit came from, the product cannot detect that failure downstream; it will simply produce a confident-sounding wrong answer. Extraction is therefore treated as the highest-risk, highest-rigor layer in the system.

The pipeline must preserve, for every piece of extracted content:
- Page numbers (both system-assigned and printed, where visible)
- Section headings and clause headings
- Policy form names and numbers
- Endorsement names and numbers
- Tables (coverage schedules, limits, deductibles, premiums)
- Limits, deductibles, and sublimits
- Exclusions
- Claim duties and notice requirements
- A traceable source reference for every extracted unit of text

**Governing constraint:** answer generation (a later stage, out of scope for this document) may only draw on material that exists in the extraction output. If a clause was not extracted, or was extracted with low confidence, it does not exist for purposes of generating an answer. Nothing may be answered from model background knowledge of "how equine policies typically work." This is the mechanism that enforces "no source, no answer" at the data layer, not just the language layer.

---

## 2. Input Document Types

The extraction pipeline must support:

| Category | Types |
|---|---|
| File formats | Text-based PDF, scanned PDF, JPG image, PNG image, HEIC image (future) |
| Document structure | Multi-page policy package, single-page declaration |
| Upload structure | Multiple uploaded files in one session, multiple distinct policies in one upload, multiple horses on one policy |
| Non-policy uploads | Invoice-only upload, renewal-notice-only upload |

Each of these must be independently classifiable — the pipeline cannot assume a single upload is a single coherent policy. A user may upload an invoice by mistake, or upload two years of renewal notices along with the current policy. The pipeline must detect and separate these rather than treating the whole upload as one document.

---

## 3. Extraction Methods

**A. Text-based PDF extraction**
Extract embedded text layer directly, preserving reading order, page breaks, and font-based structural cues (bold/underline as heading signals). This is the highest-confidence extraction path and is treated as the quality baseline.

**B. OCR fallback for scanned PDFs**
When a PDF has no usable text layer (image-only pages), run OCR per page. Output is treated as inherently lower-confidence than native text extraction and must carry an OCR quality score (Section 6).

**C. OCR for image uploads (JPG/PNG/HEIC)**
Same OCR path as B, applied to standalone image uploads. Image uploads should be checked for orientation and resolution before OCR; low-resolution images should generate an upfront quality warning rather than proceeding silently.

**D. Table extraction**
Tables (horse schedules, limit tables, deductible tables) are extracted as structured grid data, not flattened into prose. Row/column relationships must be preserved so that, for example, a deductible in a table stays associated with the correct horse and coverage line.

**E. Key-value extraction**
Declarations-page-style fields (Named Insured, Policy Number, Effective Date, Insured Value) are extracted as key-value pairs where the document's layout makes the key-value relationship visually explicit (labels + adjacent values, form fields, boxes).

**F. Heading detection**
Section and clause headings are detected using a combination of layout signals (font size/weight, numbering patterns, whitespace) and must be preserved as structural markers, not merged into surrounding body text.

**G. Checkbox / selection mark detection**
Where the source document contains checkboxes, marked options, or selection indicators (e.g., coverage elected via checked box), the pipeline must detect and record the selection state. If mark detection confidence is low, the field must be flagged rather than guessed.

**H. Handwriting detection**
Handwritten annotations or entries are detected and extracted where legible, but are never relied upon as the basis for a "Confirmed" answer unless extraction confidence is high. Low-confidence handwriting is retained in the extraction record (for transparency) but excluded from clause data used in answer generation.

---

## 4. Page Preservation Rules

For every page processed, the system must retain:

- **Original file name** — as uploaded, unmodified
- **Original page number** — position within the original uploaded file
- **Internal (system) page number** — a stable identifier assigned across the full multi-file upload set, so pages can be referenced consistently regardless of source file
- **Detected printed page number** — if the page itself displays a printed page number (e.g., "Page 3 of 12"), this is extracted separately from the system page number, since the two frequently diverge
- **Page order** — the sequence pages were uploaded/appear in, preserved even if later reordering is needed for analysis
- **Document type classification** — per-page classification (declarations / policy form / endorsement / vet record / invoice / renewal notice / unknown)
- **Rotation correction** — pages detected as rotated are corrected before OCR/extraction, with the correction logged
- **Cropping warnings** — pages that appear cut off, cropped, or missing margin content are flagged
- **Duplicate page detection** — identical or near-identical pages (e.g., a page uploaded twice, or a photocopy re-uploaded) are flagged so content isn't double-counted in extraction
- **Missing page number warnings** — where printed page numbers exist and a gap is detected (e.g., page 4 present, page 5 absent, page 6 present), the system flags a likely missing page

---

## 5. Source Reference Format

Every extracted clause, table cell, or key-value pair must carry a source reference object using this structure:

```
source_ref = {
  upload_id,             // identifier for the overall upload session
  file_name,              // original uploaded file name
  system_page_number,     // internal stable page identifier
  printed_page_number,    // printed page number if detected, else null
  document_type,          // declarations | policy_form | endorsement | vet_record | invoice | renewal_notice | unknown
  section_heading,        // nearest detected section heading
  clause_heading,         // nearest detected clause-level heading, if any
  paragraph_index,        // position of paragraph within the section
  line_range,             // start–end line numbers within the page/paragraph
  text_snippet,           // verbatim excerpt supporting the clause
  confidence              // extraction confidence score for this specific unit
}
```

**Governing rule:** every answer generated downstream must cite one or more `source_ref` objects. An answer with no attached `source_ref` is invalid by construction and must not be produced. Where an answer draws on multiple clauses (e.g., a base-policy exclusion modified by an endorsement), it must cite a `source_ref` for each contributing clause.

---

## 6. OCR Quality Scoring

Every OCR'd page (from scanned PDF or image upload) receives a quality score from 0–100, based on factors such as character recognition confidence, image resolution, contrast, and detected artifacts (skew, glare, cutoff text).

| Score Band | Label | System Behavior |
|---|---|---|
| 90–100 | Clean extraction | Treated equivalently to native text extraction; full confidence eligible |
| 75–89 | Mostly readable | Usable for extraction; confidence capped below "Confirmed" tier unless cross-verified elsewhere |
| 50–74 | Partially readable | Extracted content retained but flagged; answers drawing on this page are capped at "Unclear" confidence |
| 25–49 | Poor quality | Extraction attempted but treated as unreliable; system should prompt user to re-upload a clearer copy before relying on this page |
| 1–24 | Barely usable | Content extracted (if any) is not used for answer generation; page is flagged as effectively unreadable |
| 0 | Unreadable | No usable text; page is logged as a gap and treated identically to a missing page for downstream purposes |

At every band below 90, the extraction output must carry the score forward into the `source_ref.confidence` field so that low-quality source material can never silently present as high-confidence downstream.

---

## 7. Extracted Text Normalization Rules

Normalization is limited strictly to formatting cleanup — it must never alter legal meaning or reword source language. Rules:

- **Remove extra whitespace** — collapse redundant spacing/line breaks introduced by OCR or PDF layout artifacts.
- **Preserve punctuation** — commas, semicolons, and periods are retained exactly, since they can affect clause scope.
- **Preserve capitalization when meaningful** — defined terms (often capitalized in policy forms, e.g., "Insured Value," "Mortality") retain their original casing.
- **Preserve dollar amounts** — exact figures, including formatting (e.g., "$25,000" not "25000").
- **Preserve percentages** — exact figures (e.g., "20%" not "20 percent" or "0.2").
- **Preserve dates** — exact as written, without reformatting or reinterpreting date formats.
- **Preserve policy form numbers** — exact alphanumeric strings (e.g., "Form EQ-100 (04/19)").
- **Preserve endorsement numbers** — same treatment as policy form numbers.
- **Preserve section headings** — retained verbatim as structural markers.
- **Preserve numbered lists** — list structure and numbering retained, not flattened into prose.
- **Preserve exclusions** — extracted verbatim, never summarized at the extraction stage.
- **Preserve defined terms** — any term the policy explicitly defines is extracted as written, flagged as a defined term for later cross-referencing.
- **Preserve limiting language** — words like "not," "except," "unless," "subject to," and similar qualifiers are never dropped, reordered, or smoothed over during normalization.

**Explicit rule:** the extraction layer must never paraphrase. Any rewording into plain English happens only at the later answer-generation stage, applied on top of verbatim extracted source text — never as a substitute for it.

---

## 8. Critical Language Preservation

The following words and phrases must be preserved exactly wherever they appear, because they materially change coverage meaning and are frequent sources of misreading:

`excluded` · `not covered` · `subject to` · `unless` · `except` · `only if` · `provided that` · `prior approval` · `written notice` · `immediately` · `within` · `deductible` · `limit` · `sublimit` · `coinsurance` · `waiting period` · `pre-existing` · `prior condition` · `illness` · `injury` · `accident` · `disease` · `mortality` · `theft` · `humane destruction` · `euthanasia` · `necropsy` · `veterinary certificate` · `proof of loss` · `claim form` · `endorsement` · `rider` · `declaration` · `schedule` · `insured value` · `actual cash value` · `agreed value` · `renewal` · `cancellation`

These terms must never be dropped during whitespace cleanup, never be substituted with synonyms during extraction, and must be indexed so that clause segmentation (Section 10) and conflict detection (Section 11) can reliably locate them.

---

## 9. Table and Schedule Extraction

Special handling applies to the following table/schedule types:

- Horse schedules (multiple insured animals listed with individual attributes)
- Insured value schedules
- Coverage limit tables
- Deductible tables
- Premium tables
- Endorsement schedules
- Policy period tables
- Tables covering multiple horses
- Tables covering multiple coverage lines
- Tables covering multiple deductibles

**Extraction requirements:**
- Table structure (rows/columns/headers) is preserved as structured data, not flattened into a text paragraph.
- Each table cell is individually associated with a `source_ref`, including the specific row and column identifiers (e.g., row = "Horse: Rosie," column = "Mortality Limit") so that a downstream answer about one horse's limit is never accidentally sourced to another horse's row.
- Where a table spans multiple pages, row continuity is preserved and each continued row retains linkage to its originating header row.
- Merged cells, footnotes, and asterisked qualifiers within tables are extracted and explicitly linked back to the cell(s) they qualify — a footnote must not be extracted as a floating, disconnected fragment.

---

## 10. Clause Segmentation Rules

Extracted text is segmented into discrete clause units, each assigned a clause type:

- Declarations data
- Coverage grant
- Limit
- Sublimit
- Deductible
- Coinsurance
- Waiting period
- Exclusion
- Condition
- Definition
- Endorsement
- Rider
- Claim notice
- Veterinary documentation requirement
- Prior approval requirement
- Euthanasia / humane destruction requirement
- Necropsy requirement
- Proof of loss requirement
- Territory restriction
- Use restriction
- Age restriction
- Cancellation provision
- Renewal provision
- Signature / acceptance block
- Unknown clause

**Segmentation rules:**
- Segmentation follows the document's own structural boundaries (numbered sections, headings, paragraph breaks) rather than imposing an external structure.
- A clause that doesn't clearly match a known type is segmented as **Unknown clause** rather than being force-fit into the nearest category — mislabeling a clause is more dangerous than leaving it unclassified, since the label drives downstream answer eligibility.
- Each clause retains a link to its immediate parent section/heading so that, e.g., an exclusion nested under "Section IV — Mortality Coverage" is understood as scoped to mortality, not to the policy as a whole.

---

## 11. Document Conflict Detection

The pipeline must actively check for and flag inconsistencies rather than silently picking one version as authoritative. Detection targets include:

- Declarations page lists a coverage (e.g., major medical) but no corresponding endorsement is found in the upload
- A coverage limit appears in two different places with two different amounts
- Policy dates differ between a renewal notice and the declarations page
- The insured horse's name differs across pages/documents
- Insured value differs across pages/documents
- A deductible appears inconsistent across documents
- An endorsement references another form by name/number that is not present in the upload
- Printed page numbers are out of sequential order
- Content from what appears to be multiple distinct policies is mixed together in one upload

**Governing rule:** when a conflict is detected, the system flags it and lowers confidence — it does not attempt to silently resolve which value is "correct." Conflict resolution (if it happens at all) belongs to answer generation and must be visible to the user as a caveat, never hidden by the extraction layer picking a winner.

---

## 12. Missing Source Rules

- If no source text supports a potential answer, no answer may be generated — the extraction output must make the absence visible rather than passing through empty-handed silently.
- If OCR quality is too poor to support a reliable extraction (per Section 6 bands), any answer that would rely on that page is capped at "Unclear" or "Not Found in Documents."
- If a declarations page lists a coverage but the corresponding endorsement/policy form is not present in the upload, the extraction output must carry a flag indicating: *coverage appears listed, but the terms and exclusions governing it were not found in the uploaded documents.*
- If exclusions cannot be located for a coverage line that is otherwise documented, the extraction output must carry a flag warning that coverage answers for that line may be incomplete.
- If claim-condition clauses (notice requirements, deadlines) are not found, downstream answer generation must not state claim deadlines as fact — the extraction output must mark this area as unsupported.

---

## 13. Extraction Output JSON Schema

```json
{
  "upload_id": "string",
  "files": [
    {
      "file_id": "string",
      "file_name": "string",
      "file_type": "pdf | jpg | png | heic",
      "page_count": "integer"
    }
  ],
  "pages": [
    {
      "system_page_number": "integer",
      "file_id": "string",
      "original_page_number": "integer",
      "printed_page_number": "string|null",
      "document_type": "declarations | policy_form | endorsement | vet_record | invoice | renewal_notice | unknown",
      "rotation_corrected": "boolean",
      "cropping_warning": "boolean",
      "duplicate_of": "system_page_number|null",
      "ocr_quality_score": "integer|null"
    }
  ],
  "document_types": ["string"],
  "ocr_quality_score": "integer",
  "extracted_text_blocks": [
    {
      "block_id": "string",
      "system_page_number": "integer",
      "text": "string",
      "confidence": "integer"
    }
  ],
  "source_refs": [
    {
      "upload_id": "string",
      "file_name": "string",
      "system_page_number": "integer",
      "printed_page_number": "string|null",
      "document_type": "string",
      "section_heading": "string|null",
      "clause_heading": "string|null",
      "paragraph_index": "integer",
      "line_range": "string",
      "text_snippet": "string",
      "confidence": "integer"
    }
  ],
  "tables": [
    {
      "table_id": "string",
      "table_type": "horse_schedule | insured_value_schedule | limit_table | deductible_table | premium_table | endorsement_schedule | policy_period_table | other",
      "rows": "array",
      "columns": "array",
      "cell_source_refs": "array"
    }
  ],
  "key_values": [
    {
      "key": "string",
      "value": "string",
      "source_ref": "object"
    }
  ],
  "clauses": [
    {
      "clause_id": "string",
      "clause_type": "string",
      "coverage_category": "string|null",
      "raw_text": "string",
      "normalized_text": "string",
      "source_ref": "object",
      "extraction_confidence": "integer",
      "related_clause_ids": ["string"]
    }
  ],
  "conflicts": [
    {
      "conflict_type": "string",
      "description": "string",
      "related_source_refs": ["object"]
    }
  ],
  "missing_sources": [
    {
      "description": "string",
      "affected_coverage_category": "string|null"
    }
  ],
  "warnings": ["string"],
  "extraction_status": "complete | mostly_complete | partial | poor_quality | unreadable | mixed_documents | needs_more_documents | failed"
}
```

---

## 14. Extraction Status Values

| Status | Meaning |
|---|---|
| **complete** | All expected document types for a standard policy package were found and extracted at high confidence; no material gaps or conflicts detected. |
| **mostly_complete** | Core documents extracted successfully; minor gaps or low-confidence areas exist but do not prevent answering most questions. |
| **partial** | Meaningful sections of the policy package appear to be missing (e.g., declarations found, but no endorsements or exclusions), materially limiting answer scope. |
| **poor_quality** | Documents were present but extraction confidence is low across a significant portion of content, primarily due to OCR/image quality. |
| **unreadable** | One or more uploaded documents could not be extracted at all (0 OCR score or equivalent failure). |
| **mixed_documents** | The upload appears to contain content from more than one distinct policy or unrelated document types mixed together. |
| **needs_more_documents** | The uploaded material references other documents (e.g., an endorsement referencing a form not included) that are required to answer coverage questions completely. |
| **failed** | Extraction could not be completed due to a technical failure (corrupt file, unsupported format, etc.), independent of document quality. |

---

## 15. Consumer-Facing Extraction Message

Standard message displayed to the user after extraction completes:

> **Here's what we found in your upload:**
>
> - **Files processed:** [n] files, [n] pages
> - **Documents detected:** [e.g., 1 Declarations Page, 1 Policy Form, 2 Endorsements]
> - **Document quality:** [Clean / Mostly readable / Some pages were hard to read — see warnings below]
> - **Completeness:** [Complete / Mostly complete / Some sections appear to be missing]
>
> **Things to know before you review your report:**
> - [Warning bullets, only if applicable — e.g., "Page 4 of your Mortality Endorsement was difficult to read. Answers based on this page are marked 'Unclear.'"]
> - [e.g., "Your Declarations Page mentions a Major Medical Endorsement, but we didn't find that document in your upload. We can't confirm what it covers until it's added."]
>
> **What we can answer right now:** based on the documents you uploaded, we can answer questions about [coverage categories with sufficient source support].
>
> **What we can't answer yet:** [coverage categories or questions where source support is missing or too low-confidence], until more documents are provided or unclear pages are replaced with clearer copies.

Tone guidance: factual and matter-of-fact, not alarming. Warnings are framed as "here's what to know" rather than error messages — the goal is to set accurate expectations, not create anxiety about the user's paperwork.

---

## 16. Internal QA Checklist

Before extraction output is considered validated for a given upload, confirm:

- [ ] Page count in output matches page count in original upload
- [ ] Key policy dates (effective/expiration) extracted
- [ ] Carrier name extracted
- [ ] Horse name(s) extracted
- [ ] Insured value extracted
- [ ] Coverage lines detected and classified
- [ ] Endorsements detected and linked to base form
- [ ] Exclusions detected
- [ ] Claim notice language detected
- [ ] Limits and deductibles detected
- [ ] Source references created for every extracted clause/table cell/key-value
- [ ] Conflicts (if any) flagged, not silently resolved
- [ ] Missing documents (if any) flagged
- [ ] Low-quality OCR pages flagged with score and downstream confidence cap applied

---

## 17. Examples

### Example 1 — Clean full digital policy package
- **Extraction status:** complete
- **OCR quality score:** N/A (native text, treated as 100)
- **Documents detected:** Declarations Page, Full Mortality Policy Form, Major Medical Endorsement, Surgical Endorsement
- **Key extracted fields:** Named Insured, horse name/breed/age, insured value ($22,000), mortality limit, major medical limit ($7,500), surgical sublimit ($5,000), deductible ($0 mortality / $250 major medical), effective/expiration dates
- **Source reference example:** `{file_name: "policy_form.pdf", system_page_number: 6, section_heading: "Section III — Major Medical", clause_heading: "Limits of Liability", text_snippet: "...the Company's liability shall not exceed $7,500 per policy period...", confidence: 98}`
- **Warnings:** none
- **Allowed answer scope:** full — all MVP question categories answerable at "Confirmed" confidence

### Example 2 — Scanned policy with readable OCR
- **Extraction status:** mostly_complete
- **OCR quality score:** 82 (average across pages)
- **Documents detected:** Declarations Page (scanned), Policy Form (scanned), one Endorsement (scanned)
- **Key extracted fields:** same categories as Example 1, extracted via OCR
- **Source reference example:** `{file_name: "scanned_policy.pdf", system_page_number: 3, section_heading: "Exclusions", text_snippet: "This policy does not cover loss caused by...", confidence: 82}`
- **Warnings:** "Page 3 had moderate scan quality; answers drawing on this page are capped at 'Likely, with caveat' confidence."
- **Allowed answer scope:** full question set answerable, but confidence capped below "Confirmed" for content sourced from lower-scoring pages

### Example 3 — Declarations page only
- **Extraction status:** partial
- **OCR quality score:** 95 (single clean page)
- **Documents detected:** Declarations Page only
- **Key extracted fields:** Named Insured, horse name, insured value, coverage lines listed by name, limits as stated on declarations
- **Source reference example:** `{file_name: "dec_page.pdf", system_page_number: 1, section_heading: "Schedule of Coverage", text_snippet: "Major Medical — Limit $5,000", confidence: 96}`
- **Warnings:** "Your Declarations Page lists Major Medical and Surgical coverage, but we didn't find the policy form or endorsements that define what those coverages include or exclude."
- **Allowed answer scope:** system can confirm that a coverage line is listed and its stated limit; cannot answer questions about exclusions, conditions, or claim requirements for those lines — those are marked "Not Addressed in Uploaded Documents"

### Example 4 — Multiple horses on one policy
- **Extraction status:** complete
- **OCR quality score:** N/A (native text)
- **Documents detected:** Declarations Page with Horse Schedule (3 horses), Policy Form, 1 Endorsement
- **Key extracted fields:** three separate horse records, each with its own insured value, mortality limit, and deductible, individually linked via table cell source references
- **Source reference example:** `{file_name: "dec_page.pdf", system_page_number: 2, section_heading: "Horse Schedule", clause_heading: "Row: 'Comet' / Column: 'Mortality Limit'", text_snippet: "$18,000", confidence: 97}`
- **Warnings:** none
- **Allowed answer scope:** full, but every answer must specify which horse it pertains to — the system must never merge or average values across horses

### Example 5 — Mixed upload (invoice, renewal notice, partial endorsement)
- **Extraction status:** mixed_documents / needs_more_documents
- **OCR quality score:** 71 (renewal notice scanned; invoice and endorsement page native text)
- **Documents detected:** Invoice (non-policy document), Renewal Notice, one partial page of what appears to be an Endorsement (page 2 of an unknown total)
- **Key extracted fields:** premium amount and due date (from invoice, not usable for coverage answers), renewal effective date, partial endorsement text referencing "Section II" with no Section I present
- **Source reference example:** `{file_name: "endorsement_pg2.pdf", system_page_number: 1, section_heading: "Section II (continued)", text_snippet: "...as described above, the following exclusion applies:", confidence: 65, note: "Section I not found in upload"}`
- **Warnings:** "We found an invoice and a renewal notice, which don't contain coverage terms. We also found part of an endorsement, but it looks like earlier pages are missing — we can't confirm the full exclusion it describes."
- **Allowed answer scope:** very limited — system can state the renewal effective date and that an endorsement of some kind exists, but cannot answer any substantive coverage question tied to the incomplete endorsement; invoice content is excluded from coverage analysis entirely

---

*End of v1.0 Extraction Pipeline & Source-Mapping Specification. Next implementation documents: answer-generation rules, report layout/design, and backend/infrastructure architecture.*
