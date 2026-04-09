# HorseInsurance.ai — Premium Estimator

Standalone 3-file estimator tool for horseinsurance.ai. No dependencies, no build step, no runtime AI.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup — form inputs + results panel |
| `styles.css` | All styles — matches main site design system |
| `app.js` | All calculation logic — pure vanilla JS |

## Deploy

Drop the `/estimator/` folder into the `horseinsurance-ai` repo root.  
Cloudflare Pages will serve it at `https://horseinsurance.ai/estimator/`.

## Premium Model

| Factor | Value |
|--------|-------|
| Base mortality rate | 3.25% of insured value |
| Rope multiplier | 1.05× |
| Barrel multiplier | 1.08× |
| Cutting multiplier | 1.15× |
| Reining multiplier | 1.12× |
| Pleasure multiplier | 0.95× |
| Age loading | 1.0×–1.35× |
| Competition loading | 1.0×–1.12× |
| State index | 0.95×–1.03× |
| Major medical add-on | $275–$650 flat per horse |
| Liability add-on | $225–$550 flat annual |
| Market spread | ±12% of midpoint |

## Customization

All rate constants are at the top of `app.js` in the `DISCIPLINES` array.  
Update multipliers there as underwriting data changes.

## Notes

- No data is collected or transmitted — fully client-side
- Mobile sticky bar shows estimate when scrolled past results panel
- Results panel is sticky on desktop (768px+)
- Disclaimer clearly marks output as educational only
