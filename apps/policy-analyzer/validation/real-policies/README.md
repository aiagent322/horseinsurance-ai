# Real-policy validation

This catalog is **not** part of the synthetic release gate in `quality/`.

Use it only for controlled, rights-cleared equine policy PDFs after hosted staging is isolated and uploads are explicitly enabled.

## Rules

- Human reviewers author ground truth. Do not copy analyzer output into `human_reviewed_result`.
- Do not add files from `quality/fixtures`.
- Do not ingest private customer policies in this milestone.
- Allowed rights: carrier specimen, WMN-owned, permissioned sample, or deliberately redacted.
- Uploads stay disabled on hosted staging until Auth, RLS, private storage, and the worker pass readiness.

## Layout

| Path | Purpose |
| --- | --- |
| `catalog.json` | Listed validation IDs |
| `records/*.json` | One human-reviewed record per policy package |
| `specimens/` | Rights-cleared PDF packages only (gitignored binaries recommended) |
| `FIRST-TEST-SET.md` | First controlled mix |

## Run

```bash
npm run test:real-policy
```

That command validates the schema and harness. It does not analyze customer PDFs.
