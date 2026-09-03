# HorseInsurance.ai Policy Analyzer

Upload an equine insurance PDF and get a source-grounded, plain-English report of what the documents actually say.

This is the MVP vertical slice from the Policy Analyzer architecture: upload → inventory → extract → analyze → sourced report. It does not quote, sell, score, or approve claims.

The live HorseInsurance.ai site is an education library. This app is the analyzer. Uploaded policies stay in local `data/` (gitignored). Analysis URLs are random UUIDs and are not indexed.

## Run

```bash
cd policy-analyzer
npm install
npm test
npm run dev
```

Open http://127.0.0.1:43147/

Use **Run educational fixture** for the labeled 4-page sample, or upload a real policy PDF.

## Rules the analyzer follows

- The uploaded file is the authority.
- Missing facts are reported as **NOT FOUND IN DOCUMENTS PROVIDED**.
- Conflicts are shown, not resolved.
- Every dollar figure, exclusion, and notice requirement cites a page.

## Delete

Each report has **Delete analysis**, which removes the JSON record and the original PDF.

## Storage

Uploads live in `policy-analyzer/data/` on the machine running the app. That folder is gitignored. Analysis URLs are UUIDs and send `X-Robots-Tag: noindex`. On a serverless host the disk is ephemeral — use this locally or behind a persistent volume until object storage is wired.

## What this is not

No quoting, claims, CRM, payments, accounts, or Horse Genius. Status labels are not scores. Educational notes are labeled and do not add coverage.
