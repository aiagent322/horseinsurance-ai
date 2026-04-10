/**
 * HorseInsurance.ai — Premium Estimator
 * app.js
 *
 * PREMIUM MODEL:
 * Base mortality rate: 3.25% of insured value (industry midpoint for performance horses)
 * Discipline risk multipliers applied per horse class
 * Coverage level scalar (100% or 80%)
 * Age loading factor
 * Competition loading factor
 * State index scalar
 * Medical add-on: flat per horse × count
 * Liability add-on: flat annual
 *
 * Output: low/high range (±15% of midpoint to reflect market spread)
 */

'use strict';

// ── Discipline config ────────────────────────────────────────
const DISCIPLINES = [
  { id: 'rope',     label: 'Rope Horses',    rate: 0.0325, multiplier: 1.05 },
  { id: 'barrel',   label: 'Barrel Horses',  rate: 0.0325, multiplier: 1.08 },
  { id: 'cutting',  label: 'Cutting Horses', rate: 0.0325, multiplier: 1.15 },
  { id: 'reining',  label: 'Reining Horses', rate: 0.0325, multiplier: 1.12 },
  { id: 'pleasure', label: 'Pleasure Horses',rate: 0.0325, multiplier: 0.95 },
];

// ── DOM refs ─────────────────────────────────────────────────
const els = {
  coverage:    () => parseFloat(document.getElementById('coverage').value),
  medical:     () => parseFloat(document.getElementById('medical').value),
  liability:   () => parseFloat(document.getElementById('liability').value),
  location:    () => parseFloat(document.getElementById('location').value),
  ageRange:    () => parseFloat(document.getElementById('ageRange').value),
  competitive: () => parseFloat(document.getElementById('competitive').value),
  totalHorses: document.getElementById('totalHorses'),
  totalValue:  document.getElementById('totalValue'),
  emptyState:  document.getElementById('emptyState'),
  resultsBody: document.getElementById('resultsBody'),
  premiumLow:  document.getElementById('premiumLow'),
  premiumHigh: document.getElementById('premiumHigh'),
  premiumMonthly: document.getElementById('premiumMonthly'),
  breakdownRows:  document.getElementById('breakdownRows'),
  mobileSummary:  document.getElementById('mobileSummary'),
  mobileRange:    document.getElementById('mobileRange'),
};

// ── Formatters ───────────────────────────────────────────────
function fmtCurrency(n) {
  if (n >= 1000) return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return '$' + Math.round(n).toLocaleString();
}
function fmtFull(n) {
  return '$' + Math.round(n).toLocaleString();
}

// ── Get discipline inputs ─────────────────────────────────────
function getDisciplineData() {
  return DISCIPLINES.map(d => {
    const count = parseInt(document.getElementById(d.id + 'Count').value) || 0;
    const value = parseFloat(document.getElementById(d.id + 'Value').value) || 0;
    return { ...d, count, value };
  });
}

// ── Core calculation ──────────────────────────────────────────
function calculate() {
  const data        = getDisciplineData();
  const coverageLvl = els.coverage();
  const medicalAdd  = els.medical();
  const liabilityAdd= els.liability();
  const locationIdx = els.location();
  const ageFactor   = els.ageRange();
  const compFactor  = els.competitive();

  let totalHorses = 0;
  let totalInsuredValue = 0;
  let mortalityPremium = 0;
  const disciplineBreakdown = [];

  data.forEach(d => {
    if (d.count <= 0 || d.value <= 0) return;
    totalHorses += d.count;
    const insuredValue = d.count * d.value * coverageLvl;
    totalInsuredValue += insuredValue;
    const premium = insuredValue * d.rate * d.multiplier * ageFactor * compFactor * locationIdx;
    mortalityPremium += premium;
    disciplineBreakdown.push({ label: d.label, count: d.count, value: insuredValue, premium });
  });

  const medicalPremium  = medicalAdd * totalHorses;
  const liabilityPremium = liabilityAdd;
  const totalMid = mortalityPremium + medicalPremium + liabilityPremium;

  // Market spread ±15%
  const low  = totalMid * 0.85;
  const high = totalMid * 1.15;

  // Update summary totals
  els.totalHorses.textContent = totalHorses;
  els.totalValue.textContent  = fmtFull(totalInsuredValue);

  if (totalHorses === 0 || totalMid === 0) {
    els.emptyState.style.display  = '';
    els.resultsBody.style.display = 'none';
    els.mobileSummary.style.display = 'none';
    return;
  }

  // Show results
  els.emptyState.style.display  = 'none';
  els.resultsBody.style.display = '';

  els.premiumLow.textContent  = fmtCurrency(low);
  els.premiumHigh.textContent = fmtCurrency(high);
  els.premiumMonthly.textContent = fmtCurrency(totalMid / 12);

  // Rebuild breakdown rows
  let rows = '';
  disciplineBreakdown.forEach(d => {
    rows += `<tr>
      <td>${d.label} (${d.count})</td>
      <td>${fmtCurrency(d.premium)}</td>
    </tr>`;
  });
  if (medicalPremium > 0) {
    rows += `<tr><td>Major Medical / Surgical</td><td>${fmtCurrency(medicalPremium)}</td></tr>`;
  }
  if (liabilityPremium > 0) {
    rows += `<tr><td>Equine Liability</td><td>${fmtCurrency(liabilityPremium)}</td></tr>`;
  }
  // Divider + total
  rows += `<tr>
    <td><strong>Estimated Total (midpoint)</strong></td>
    <td><strong>${fmtFull(totalMid)}/yr</strong></td>
  </tr>`;

  els.breakdownRows.innerHTML = rows;

  // Mobile bar
  els.mobileSummary.style.display = '';
  els.mobileRange.textContent = fmtCurrency(low) + ' – ' + fmtCurrency(high);
}

// ── Event binding ─────────────────────────────────────────────
function bindAll() {
  // All number inputs
  document.querySelectorAll('input[type="number"]').forEach(el => {
    el.addEventListener('input', calculate);
    el.addEventListener('change', calculate);
  });

  // All selects
  document.querySelectorAll('select').forEach(el => {
    el.addEventListener('change', calculate);
  });
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindAll();
  calculate(); // Initial render
});
