# Analyzer quality evaluation

Independent, versioned accuracy evaluation for the policy analyzer. This milestone measures current behavior. It does not change classification, extraction, completeness, or report-generation logic.

```bash
cd apps/policy-analyzer
npm run test:quality:self
npm run test:quality
```

`test:quality:self` runs evaluator self-tests only. Those tests deliberately corrupt controlled result data and must fail the release gate.

`test:quality` then:

1. Runs the same evaluator self-tests.
2. Runs the unmodified analyzer against `quality-corpus-v1`.
3. Prints a human-readable console report (fixture PASS/FAIL, expected-versus-actual diffs, aggregate metrics, release-gate decision).
4. Writes a machine-readable JSON report to `quality/reports/latest.json`.
5. Exits non-zero if the synthetic release gate fails.

Transient reports under `quality/reports/` are gitignored. Do not commit them.

See `GROUND-TRUTH.md` for the fixture format. See `thresholds.json` for the synthetic release bar.

Do not treat a passing or failing synthetic run as production accuracy or carrier validation.
