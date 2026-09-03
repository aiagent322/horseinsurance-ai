# HorseInsurance.ai Policy Analyzer

Upload one or more equine insurance PDFs and get a source-grounded, plain-English report of what the documents actually say.

This is the MVP vertical slice from the Policy Analyzer architecture: upload → inventory → extract → analyze → sourced report. It does not quote, sell, score, or approve claims.

The live HorseInsurance.ai site is an education library. This app is the analyzer. Uploaded policies stay in local `data/` (gitignored). Analysis URLs are random UUIDs and are not indexed.

## Run

```bash
cd apps/policy-analyzer
npm install
npm test
npm run test:semantic
npm run test:completeness
npm run test:ingestion
npm run dev
```

Open http://127.0.0.1:43147/

Use **Run educational fixture** for the labeled 4-page sample, or upload a policy package of up to 10 PDFs.

## Package limits

- Maximum 10 PDFs
- 20 MB per file
- 75 MB for the complete package
- Duplicate files (same SHA-256) are rejected
- Files are stored under generated IDs, never under the submitted filename

Native PDF text is used when it is good enough. Image-only or low-quality pages are sent to a local Tesseract OCR fallback (`tesseract.js` plus vendored `tessdata/eng.traineddata`). OCR does not call an external API. Unreadable pages are not treated as policy language.

## Rules the analyzer follows

- The uploaded files are the authority.
- Missing facts are reported as **NOT FOUND IN DOCUMENTS PROVIDED**.
- Conflicts are shown, not resolved.
- Every dollar figure, exclusion, and notice requirement cites a page.
- A form listed on the declarations is not treated as uploaded unless matching form text is sourced separately.

## Delete

Each report has **Delete analysis**, which removes the JSON record and the original PDFs.

## Storage

Uploads live in `apps/policy-analyzer/data/` on the machine running the app. That folder is gitignored. Analysis URLs are UUIDs and send `X-Robots-Tag: noindex`. On a serverless host the disk is ephemeral — use this locally or behind a persistent volume until object storage is wired.

## What this is not

No quoting, claims, CRM, payments, accounts, or Horse Genius. Status labels are not scores. Educational notes are labeled and do not add coverage.
