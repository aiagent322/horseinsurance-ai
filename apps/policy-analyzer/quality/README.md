# Analyzer quality evaluation

Independent, versioned accuracy evaluation for the policy analyzer. This milestone measures current behavior. It does not change classification logic.

```bash
cd apps/policy-analyzer
npm run test:quality
```

That command:

1. Runs evaluator self-tests (the harness must fail fabricated bad results).
2. Runs the unmodified analyzer against `quality-corpus-v1`.
3. Prints a human-readable report.
4. Writes a machine-readable JSON report to `quality/reports/latest.json`.
5. Exits non-zero if release thresholds are missed.

See `GROUND-TRUTH.md` for the fixture format. See `thresholds.json` for the synthetic release bar.

Do not treat a passing or failing synthetic run as production accuracy.
