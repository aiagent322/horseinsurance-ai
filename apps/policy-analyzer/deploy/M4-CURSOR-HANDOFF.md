# HorseInsurance.ai Policy Analyzer — Cursor session handoff

**Classification:** Milestone 4 hosted staging (not production).  
**Audience:** Successor Cursor agent. Continue from live staging. Do not restart the analyzer or Railway from scratch.  
**Verified:** 2026-09-08, SHA `176f9ec04c94a41f54287bf495224b34e99358b4` live on Railway web.  
**Owner preference:** Short executable output. Prefer a paste-ready ChatGPT prompt when Railway must act. Never print secrets.

---

## 0. How to use this document

1. Do not re-implement Control #1 / #2 / #3, Docker `public/` copy, the Control #3 download route, or pre-upload hosted E2E. Those are done and live.
2. The next gated step is **authenticated** `GET /api/ops/ready` on the live web origin, then hosted E2E pre-upload, then uploads-on happy path.
3. Analyzer source stays in this repo. ChatGPT is used for **Railway dashboard / CLI only**.
4. After every commit that must go live, push **both** remotes. Railway builds GitHub, not Cursor origin.

---

## 1. Mission

Finish **Milestone 4 hosted staging**: isolated staging Supabase + Railway **web** + Railway **worker** on the same git revision.

Sequence:

1. Keep uploads off until `/api/ops/ready` reports `ready: true` with `uploads_enabled: false`.
2. Run hosted E2E pre-upload (`HOSTED E2E PRE-UPLOAD: PASS`).
3. Enable uploads on **web only**, redeploy/restart web.
4. Run full hosted E2E (202 → worker complete → cited report → User B isolation).
5. Only then consider `validation/real-policies/` (catalog still empty). Production is later.

This is **not** production. Do not modify `main`. Do not force-push. Do not print secrets. Do not enable uploads until readiness is healthy with uploads still false.

---

## 2. Verified live state (do not guess)

Checked 2026-09-08 from this workspace against `https://web-production-839ec.up.railway.app`.

| Check | Result |
| --- | --- |
| Working branch | `cursor/policy-analyzer-m4-hosted-staging` |
| Local / Cursor origin / GitHub SHA | `176f9ec04c94a41f54287bf495224b34e99358b4` — **in sync** |
| `main` (protected) | `5eb2de554ebe0e4c7bd17c08f77bc3ca109d2747` — do not change |
| `GET /api/health/live` | `200` `{"status":"live"}` |
| `GET /api/controls/us-3` | `200` `application/pdf`, 3,080,240 bytes, `%PDF-1.7` |
| `GET /api/ops/ready` without token | `404` `{"error":"Not found"}` (correct) |
| Unauthenticated `POST /api/upload` from curl **without** Origin | `403` `{"error":"Forbidden"}` — **same-origin gate**, not proof that uploads are on |
| Uploads flag | Must remain `POLICY_ANALYZER_UPLOADS_ENABLED=false` until readiness passes |
| Worker public URL | **none** (required) |
| This cloud pod Railway CLI | Unauthorized; `POLICY_ANALYZER_OPS_TOKEN` **not** in process env, `.env`, or agent terminals |

**Same-origin pitfall:** `app/api/upload/route.ts` calls `assertSameOrigin` **before** the uploads-disabled 404. Raw `curl -X POST` without `Origin` / `sec-fetch-site` returns 403. Hosted E2E and a browser same-origin POST must still see **404 Not found** while uploads are off. Do not interpret curl 403 as “uploads enabled.”

Railway project IDs (from prior Demo V1 deploy tooling; **confirm before GraphQL**):

| Item | ID |
| --- | --- |
| Project | `eb591f54-1d02-492c-89cb-76940fbbca39` |
| Environment | `386766a1-320d-476a-a307-20b580a69931` |
| Web service | `157eecfc-e3b0-4e60-9bdb-5d43c2a36c5a` |
| Worker service | `974a3f4e-a56b-4aad-9c7e-d4d60ddb0d98` |
| Hosted-e2e service | `d53329a0-ecf8-46e7-bd55-fd27a9e406a6` |

Image **digests** may differ between web and worker. Railway Hobby builds each GitHub service separately. Same **git SHA** is the bar. A shared registry digest is not required.

Hobby workspace cannot enforce 1 vCPU / 1–2 GiB caps. Ignore resource caps as a blocker.

---

## 3. Repositories and branch

| Remote | URL | Role |
| --- | --- | --- |
| GitHub | `https://github.com/aiagent322/horseinsurance-ai.git` | Railway GitHub-backed deploys |
| Cursor origin | this workspace’s `origin` | Agent push target; **not** what Railway builds |

```bash
git push -u origin cursor/policy-analyzer-m4-hosted-staging
git push github HEAD:cursor/policy-analyzer-m4-hosted-staging
```

App lives under `apps/policy-analyzer/` (not repo root). Docker build context is that directory.

If GitHub lags, staging stays on an old SHA. This already happened: Railway resolved GitHub to `9baff75` (homepage PDF only) while Cursor origin was at `9a3cbbc` (pre-upload E2E). Always sync GitHub.

---

## 4. Topology

```text
Browser  →  Railway web (Next.js, port 43147)
                 │
                 ├── isolated staging Supabase
                 │     Postgres · Auth · private policy-files
                 │
Dedicated Railway worker (no public HTTP)
                 │
                 └── same git SHA as web
```

Entrypoint: `tini -- node deploy/entrypoint.mjs` with `web` or `worker`. Default port **43147**, bind `0.0.0.0`. Worker is not a public HTTP API.

Next.js **inlines** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` at **image build**. Runtime-only is not enough for those two. Also pass `GIT_SHA` and `BUILD_DATE`.

Runbooks: `deploy/HOSTED.md`, `deploy/STAGING.md`, `deploy/secrets-checklist.md`, `Dockerfile`, `deploy/entrypoint.mjs`.

Expected schema version: `20260906190000` (`lib/deploy/ops-snapshot.ts`).

---

## 5. What is done — do not redo

### 5.1 Analyzer — three frozen U.S. controls

**Control #1 — Diamond State AEM 200** (native fixture pages). Must not regress:

- Mortality / Theft **LIMITED**
- Major Medical / Surgical **NEEDS CLARIFICATION**
- 12 exclusions, 10 duties, 2 unresolved coverage gaps
- Completeness `DOCUMENT PACKAGE MAY BE INCOMPLETE` (no Declarations)

**Control #2 — Chartis/AIG contractual specimen.** Must not regress:

- 14 logical forms
- Identity empty (blank `POLICY NUMBER:` / `Named Insured:`)
- Mortality / Theft / Wobbler **LIMITED**
- Major Medical / Surgical **NEEDS CLARIFICATION**
- Completeness **COMPLETE CONTRACTUAL SPECIMEN FORM SET**
- 13 exclusions, 11 duties on the identification fixture

**Control #3 — Great American issued package, 28 pages** (PACER OCR overlay, not the 54-page complaint).

- File: `apps/policy-analyzer/public/controls/us-control-3-great-american-amp-e269955.pdf`
- Download: `GET /api/controls/us-3`
- Human-correct: Mortality / Theft / Wobbler / Major Medical / Free Colic **COVERED**; Surgical / LOU / Stallion **NOT FOUND**; completeness **APPEARS COMPLETE**; SDM-706 information-only
- Identity: policy `AMP E269955 00 00`, insured Julie Greenbank, horse **AWESOME AT THIS**, $500,000, 09/28/2017–09/28/2018, carrier Great American Assurance Company
- **No** Great American / AMP / EQU hard-coding in production `lib/`
- Regression: `npm run test:control3` → `scripts/control3-issued-package-regression.ts`
- Production-source ban in that test: `Great American|AMP E269955|EQU 1012|Julie Greenbank|AWESOME AT THIS`

Generic analyzer fixes (not carrier-specific) already in tree:

- Colonless declarations (`Policy No.`, `From`/`To`, `Amount $`)
- Named insured on the following line
- Schedule horse row
- Grant language (`we will insure`, death/humane destruction, theft of a horse) without treating product title **EQUINE MORTALITY** as a grant
- Letter-number form IDs (`EQU 1012`)
- Skip PACER chrome
- Issued vs blank specimen
- OCR inserted-letter form-id de-dupe (`EFQU` vs `EQU`)
- Additional-coverage headings tightened so trainer liability is not invented

### 5.2 Hosted E2E pre-upload (code)

`scripts/hosted-e2e.ts` no longer fails when uploads are disabled.

- If `ready: true` and `uploads_enabled: false` → unauthenticated + signed-in surfaces must **404**, upload must not return **202**, log `HOSTED E2E PRE-UPLOAD: PASS`
- Happy path (upload 202 → worker → citations → User B isolation) only if uploads are on
- Disabled upload API returns the same **Not found** as unauth (not 503 `uploads_disabled`)

### 5.3 Docker / Control #3 download

Runtime image originally omitted `public/`. Staging `/api/controls/us-3` returned **500**.

- `Dockerfile` now `COPY --from=build ... /app/public ./public`
- Route `app/api/controls/us-3/route.ts` reads the PDF; missing file → 404; body is `Uint8Array` (not raw `Buffer`, TS BodyInit)
- A leftover duplicate `headers:` block after the function caused Turbopack `Expected ';', '}' or <eof>` at line 34 — **fixed**. Do not reintroduce trailing junk after the GET handler.

### 5.4 Git on this branch (newest first, relevant)

| SHA | What |
| --- | --- |
| `176f9ec` | **LIVE.** Control #3 route syntax + Uint8Array |
| `5279d10` | Copy `public/` into image |
| `9a3cbbc` | Pre-upload hosted E2E + fail-closed disabled upload |
| `732d897` | Mixed-case heading + `A diagnosis` lookahead |
| `e7cc916` | Acceptance checks fetlock via excerpt/condition, not raw description |
| `a5ea840` | Issued OCR identity/grants/forms (**actual C3 analyzer fix**) |
| `9baff75` | C3 PDF on homepage only — **not** the analyzer fix |
| `8672d8c` | Earlier; first Railway deploy was stuck here |

---

## 6. Hard constraints

- **No production.** `POLICY_ANALYZER_ENV=staging` only.
- **No memory store** on staging/production.
- **No** `POLICY_ANALYZER_ALLOW_PRODUCTION_MIGRATIONS`.
- **No** service-role / ops token / DB URL in `NEXT_PUBLIC_*`.
- **No** carrier hard-coding in `lib/analyze.ts`, `lib/policy-semantics.ts`, `lib/form-schedule.ts`, `lib/form-segmentation.ts`, `lib/package-completeness.ts`, `lib/coverage-applicability.ts`.
- Do not loosen C1/C2 to pass C3.
- Policy-number / named-insured parsers stay **line-anchored** so C2 blank specimen identity stays empty.
- Do not paste secrets into ChatGPT, Cursor chat, git, or images.
- ChatGPT is used for **Railway dashboard/CLI only**. Analyzer, gates, E2E, Docker stay in this repo.
- New Project / this cloud flow: **do not open PRs** unless the user asks.
- `web-production-839ec` must **not** appear in application source. `hosted-staging-regression.ts` forbids it in `upload/route.ts`. Origin URL is env (`POLICY_ANALYZER_STAGING_APP_URL`) only.
- Do not invent `POLICY_ANALYZER_OPS_TOKEN`. The user said it was “in the terminal”; it was **not** in this agent’s terminals.

---

## 7. Tests that must stay green

From `apps/policy-analyzer`:

```bash
npm test                                          # acceptance
npm run test:identification                       # C1 + C2 + generic issued OCR
npm run test:control3                             # 28-page PDF
npm run test:base-coverage-grant
npm run test:form-segmentation                    # C2 = 14 forms
npm run test:completeness
npm run test:native-report-parity                 # C1
npm run test:live-exclusion-parity                # C1 = 12
npm run test:live-duty-parity                     # C1 = 10
npm run test:hosted-staging
npm run test:security
```

C3 expected log shape: policy `AMP E269955 00 00`, Julie Greenbank, AWESOME AT THIS, APPEARS COMPLETE, Mortality/Theft/MM/Colic/Wobbler COVERED, forms include EQU 88 01, 1012, 1013, 1138, 1034, 1029, IL 72 68, IL 73 24, SDM-706, AGR 246C — **not** `EFQU`. Age must not be `HE`. No COVERED liability. No “blank specimen” in mortality/medical descriptions.

Acceptance exclusion descriptions are **paraphrased** (`The policy excludes…`). Fetlock is asserted via `description|condition|exact_source_excerpt`, not raw policy wording in `description`.

Additional coverage headings: all-caps `C. NAME COVERAGE`, or mixed-case with `Coverage`/`Syndrome`, or lookahead `A diagnosis` / `We shall` / `We will`. Do not treat every `A. Title Case` heading as a grant (trainer liability).

---

## 8. Immediate next work (in order)

### A. `/api/ops/ready` (blocked on token in the previous cloud pod)

When the token is available (Railway web env, or operator-run without pasting into chat logs):

```bash
curl -sS -H "Authorization: Bearer $POLICY_ANALYZER_OPS_TOKEN" \
  https://web-production-839ec.up.railway.app/api/ops/ready
```

Report only: HTTP status, `ready`, `uploads_enabled`, each check `name` / `ok` / `code`. Never print the token.

Expect `uploads_enabled: false`. `ready: true` requires configuration, database, schema version `20260906190000`, private `policy-files` bucket, and **fresh worker heartbeat**. If `ready` is false, fix the failing check (usually heartbeat, schema, or bucket) — **do not** set uploads true.

Readiness checks (`lib/deploy/readiness.ts`):

| name | ok code | fail codes |
| --- | --- | --- |
| configuration | `configuration_ok` | `configuration_incomplete` |
| database | `database_connected` | `database_unavailable` / probe errors |
| schema_version | `schema_version_ok` | `migration_mismatch` |
| private_bucket | `bucket_private` | `bucket_missing` / `bucket_not_private` |
| worker_heartbeat | `worker_heartbeat_fresh` | `worker_heartbeat_missing` / `worker_heartbeat_stale` |
| uploads | `uploads_disabled` (until enabled) | `uploads_unsafe` if enabled without DB+private bucket |

### B. Migrations (only if schema check fails)

```bash
npx tsx scripts/hosted-staging-preflight.ts
# prints HOSTED_STAGING_TARGET_OK or STOP — DO NOT MIGRATE
POLICY_ANALYZER_MIGRATE_APPLY=YES npx tsx scripts/hosted-migrate.ts
```

Needs allowlist: `POLICY_ANALYZER_ALLOW_STAGING_MIGRATIONS=YES`, exact `POLICY_ANALYZER_STAGING_PROJECT_REF` / `POLICY_ANALYZER_STAGING_DB_HOSTS`, staging DB URL. Refuse loopback, production, unknown remotes. Never set production migration flags.

### C. Hosted E2E pre-upload (code already supports it)

Requires `POLICY_ANALYZER_HOSTED_E2E=YES`, `POLICY_ANALYZER_STAGING_APP_URL=https://web-production-839ec.up.railway.app`, staging Supabase URL/keys, ops token, `POLICY_ANALYZER_ENV=staging`. Must **not** set production migration flags. Loopback and unknown Supabase refs are refused.

Until uploads are on, success is `HOSTED E2E PRE-UPLOAD: PASS`.

### D. Only after ready + pre-upload pass

1. Set `POLICY_ANALYZER_UPLOADS_ENABLED=true` on **web** only (Railway secret store).
2. Redeploy/restart web.
3. Run full hosted E2E: 202 → worker complete → cited report → User B 404.
4. Then `validation/real-policies/` (catalog still **empty**; 12-package first set is after hosted happy path). Not `quality/` (synthetic gate only).

---

## 9. ChatGPT (Railway only)

Keep ChatGPT off analyzer source. After code is on GitHub:

```text
GitHub branch cursor/policy-analyzer-m4-hosted-staging is now <full sha>. Redeploy STAGING web and worker from latest on that branch. Do not pin a SHA.

Keep uploads false, worker private, no migrations, no secrets in chat.

Return only:
- web origin
- worker public URL
- git revision on web and worker
- GET {origin}/api/health/live
- uploads still false
- blockers
```

For readiness without printing secrets:

```text
From the web service, GET /api/ops/ready with Authorization: Bearer $POLICY_ANALYZER_OPS_TOKEN. Do not print the token.

Return only: HTTP status, ready, uploads_enabled, each check name + ok + code, blockers.
```

Do not ask Railway to pin an exact SHA. The GitHub connector may not expose `commitSha`; deploy **latest branch**.

---

## 10. Definition of “Milestone 4 finished”

- Web + worker on the **same** git SHA that contains C3 analyzer + pre-upload E2E + `public/` in the image (currently `176f9ec` or a descendant).
- `/api/ops/ready` → `ready: true`, `uploads_enabled: false`, then uploads enabled only after that.
- Hosted E2E: pre-upload pass, then happy path pass with User B isolation.
- C1/C2/C3 regressions still green.
- Real-policy catalog still later; production still later.

**Current status:** Staging **process** is live on `176f9ec` with C3 PDF download and fail-closed uploads. Staging **dependency readiness** (`/api/ops/ready` with token) has **not** been executed from the prior agent. That is the next gated step.

---

## 11. File map

| Path | Why it matters |
| --- | --- |
| `apps/policy-analyzer/lib/analyze.ts` | Analyzer entry; no carrier hard-coding |
| `apps/policy-analyzer/lib/policy-semantics.ts` | Identity, grants, exclusions, headings |
| `apps/policy-analyzer/lib/form-segmentation.ts` | Logical forms (C2 = 14) |
| `apps/policy-analyzer/lib/package-completeness.ts` | Issued vs specimen completeness |
| `apps/policy-analyzer/lib/coverage-applicability.ts` | Coverage status |
| `apps/policy-analyzer/app/api/controls/us-3/route.ts` | C3 PDF download; single GET handler only |
| `apps/policy-analyzer/app/api/upload/route.ts` | Same-origin then fail-closed 404 |
| `apps/policy-analyzer/app/api/ops/ready/route.ts` | Token-gated readiness |
| `apps/policy-analyzer/scripts/hosted-e2e.ts` | Pre-upload + happy path |
| `apps/policy-analyzer/scripts/hosted-staging-preflight.ts` | Migration target gate |
| `apps/policy-analyzer/scripts/hosted-migrate.ts` | Apply after OK |
| `apps/policy-analyzer/public/controls/us-control-3-great-american-amp-e269955.pdf` | 28-page issued package |
| `apps/policy-analyzer/Dockerfile` | Must copy `public/` |
| `apps/policy-analyzer/deploy/HOSTED.md` | Milestone 4 runbook |
| `apps/policy-analyzer/validation/real-policies/FIRST-TEST-SET.md` | After happy path only |

---

## 12. Paste-ready first message for the successor chat

```text
Continue Milestone 4 hosted staging for HorseInsurance.ai Policy Analyzer. Do not restart from scratch. Do not modify main. Do not print secrets. Do not enable uploads until /api/ops/ready is ready:true with uploads_enabled:false.

Branch: cursor/policy-analyzer-m4-hosted-staging
Live SHA (GitHub + Cursor origin, in sync): 176f9ec04c94a41f54287bf495224b34e99358b4
Web origin: https://web-production-839ec.up.railway.app
Worker must have no public URL.
App root: apps/policy-analyzer/

Already done and live — do not redo:
- Control #1 Diamond State, Control #2 Chartis/AIG specimen, Control #3 Great American 28-page issued OCR package
- Generic issued-OCR identity/grants/forms (a5ea840), not carrier hard-coding
- Dockerfile copies public/; GET /api/controls/us-3 returns the 3,080,240-byte PDF
- Hosted E2E pre-upload path (9a3cbbc): ready+uploads off → 404 surfaces, no 202, HOSTED E2E PRE-UPLOAD: PASS
- Fail-closed disabled upload is 404 Not found, not 503 uploads_disabled

Verified 2026-09-08:
- GET /api/health/live → 200 {"status":"live"}
- GET /api/controls/us-3 → 200 PDF
- GET /api/ops/ready without token → 404
- curl POST /api/upload without Origin → 403 Forbidden (same-origin gate BEFORE uploads-disabled 404). Browser/E2E same-origin POST must still 404 while uploads are off.

Next gated step: authenticated GET /api/ops/ready. Prior cloud pod had no Railway CLI auth and no POLICY_ANALYZER_OPS_TOKEN in env/terminals — do not invent the token. Report only HTTP status, ready, uploads_enabled, each check name/ok/code.

Then: hosted E2E pre-upload. Only after that, set POLICY_ANALYZER_UPLOADS_ENABLED=true on web only and run full hosted E2E (User B isolation). Real-policy catalog is later.

Push both remotes after any live commit:
  git push -u origin cursor/policy-analyzer-m4-hosted-staging
  git push github HEAD:cursor/policy-analyzer-m4-hosted-staging
Railway builds GitHub, not Cursor origin.

ChatGPT = Railway dashboard/CLI only. Analyzer stays in this repo.
Read the full handoff: apps/policy-analyzer/deploy/M4-CURSOR-HANDOFF.md
```
