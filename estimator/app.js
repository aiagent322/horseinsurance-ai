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
 * Gender loading factor (stallions +18%)
 * Operation type (commercial +22%)
 * State index scalar
 * Medical add-on: flat per horse × count, adjusted by deductible scalar
 * Loss of Use add-on: rate × total insured value
 * Liability add-on: flat annual
 * Discounts: stacked, capped at 30%
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

// ── Discount config ──────────────────────────────────────────
const DISCOUNTS = [
  { id: 'disc_multihorse',  pct: 0.10 },
  { id: 'disc_largebarn',   pct: 0.05 },
  { id: 'disc_association', pct: 0.10 },
  { id: 'disc_claimsfree',  pct: 0.05 },
  { id: 'disc_paidfull',    pct: 0.03 },
  { id: 'disc_microchip',   pct: 0.02 },
];
const DISCOUNT_CAP = 0.30;

// ── DOM refs ─────────────────────────────────────────────────
const els = {
  coverage:      () => parseFloat(document.getElementById('coverage').value),
  medical:       () => parseFloat(document.getElementById('medical').value),
  liability:     () => parseFloat(document.getElementById('liability').value),
  location:      () => parseFloat(document.getElementById('location').value),
  ageRange:      () => parseFloat(document.getElementById('ageRange').value),
  competitive:   () => parseFloat(document.getElementById('competitive').value),
  gender:        () => parseFloat(document.getElementById('gender').value),
  ownership:     () => parseFloat(document.getElementById('ownership').value),
  deductible:    () => parseFloat(document.getElementById('deductible').value),
  lossofuse:     () => parseFloat(document.getElementById('lossofuse').value),
  totalHorses:   document.getElementById('totalHorses'),
  totalValue:    document.getElementById('totalValue'),
  emptyState:    document.getElementById('emptyState'),
  resultsBody:   document.getElementById('resultsBody'),
  premiumLow:    document.getElementById('premiumLow'),
  premiumHigh:   document.getElementById('premiumHigh'),
  premiumMonthly: document.getElementById('premiumMonthly'),
  breakdownRows:  document.getElementById('breakdownRows'),
  mobileSummary:  document.getElementById('mobileSummary'),
  mobileRange:    document.getElementById('mobileRange'),
  discountTotal:  document.getElementById('discountTotal'),
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

// ── Get discount multiplier ───────────────────────────────────
function getDiscountMultiplier() {
  let totalDiscount = 0;
  DISCOUNTS.forEach(d => {
    const el = document.getElementById(d.id);
    if (el && el.checked) totalDiscount += d.pct;
  });
  totalDiscount = Math.min(totalDiscount, DISCOUNT_CAP);
  if (els.discountTotal) {
    els.discountTotal.textContent = totalDiscount > 0
      ? '−' + Math.round(totalDiscount * 100) + '%'
      : '0%';
  }
  return 1 - totalDiscount;
}

// ── Core calculation ──────────────────────────────────────────
function calculate() {
  const data          = getDisciplineData();
  const coverageLvl   = els.coverage();
  const medicalAdd    = els.medical();
  const liabilityAdd  = els.liability();
  const locationIdx   = els.location();
  const ageFactor     = els.ageRange();
  const compFactor    = els.competitive();
  const genderFactor  = els.gender();
  const ownerFactor   = els.ownership();
  const deductibleScl = els.deductible();
  const louRate       = els.lossofuse();
  const discountMult  = getDiscountMultiplier();

  let totalHorses = 0;
  let totalInsuredValue = 0;
  let mortalityPremium = 0;
  const disciplineBreakdown = [];

  data.forEach(d => {
    if (d.count <= 0 || d.value <= 0) return;
    totalHorses += d.count;
    const insuredValue = d.count * d.value * coverageLvl;
    totalInsuredValue += insuredValue;
    const premium = insuredValue * d.rate * d.multiplier
                    * ageFactor * compFactor * genderFactor * ownerFactor * locationIdx;
    mortalityPremium += premium;
    disciplineBreakdown.push({ label: d.label, count: d.count, insuredValue, premium });
  });

  // Medical: flat per horse, adjusted by deductible scalar
  const medicalPremium   = medicalAdd * totalHorses * deductibleScl;

  // Loss of Use: rate × total insured value
  const louPremium       = louRate * totalInsuredValue;

  // Liability: flat annual, scaled by operation type
  const liabilityPremium = liabilityAdd * (ownerFactor > 1.0 ? 1.35 : 1.0);

  const subtotal = mortalityPremium + medicalPremium + louPremium + liabilityPremium;
  const totalMid = subtotal * discountMult;

  // Market spread ±15%
  const low  = totalMid * 0.85;
  const high = totalMid * 1.15;

  // Update summary totals
  els.totalHorses.textContent = totalHorses;
  els.totalValue.textContent  = fmtFull(totalInsuredValue);

  if (totalHorses === 0 || subtotal === 0) {
    els.emptyState.style.display    = '';
    els.resultsBody.style.display   = 'none';
    els.mobileSummary.style.display = 'none';
    return;
  }

  // Show results
  els.emptyState.style.display  = 'none';
  els.resultsBody.style.display = '';

  els.premiumLow.textContent     = fmtCurrency(low);
  els.premiumHigh.textContent    = fmtCurrency(high);
  els.premiumMonthly.textContent = fmtCurrency(totalMid / 12);

  // Rebuild breakdown rows
  let rows = '';
  disciplineBreakdown.forEach(d => {
    rows += `<tr><td>${d.label} (${d.count})</td><td>${fmtCurrency(d.premium)}</td></tr>`;
  });
  if (medicalPremium > 0) {
    rows += `<tr><td>Major Medical / Surgical</td><td>${fmtCurrency(medicalPremium)}</td></tr>`;
  }
  if (louPremium > 0) {
    rows += `<tr><td>Loss of Use</td><td>${fmtCurrency(louPremium)}</td></tr>`;
  }
  if (liabilityPremium > 0) {
    rows += `<tr><td>Equine Liability</td><td>${fmtCurrency(liabilityPremium)}</td></tr>`;
  }

  // Show discount line if applied
  const discountAmt = subtotal - totalMid;
  if (discountAmt > 0) {
    rows += `<tr><td>Discounts Applied</td><td style="color:var(--success)">−${fmtCurrency(discountAmt)}</td></tr>`;
  }

  // Total
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
  document.querySelectorAll('input[type="number"]').forEach(el => {
    el.addEventListener('input', calculate);
    el.addEventListener('change', calculate);
  });
  document.querySelectorAll('select').forEach(el => {
    el.addEventListener('change', calculate);
  });
  document.querySelectorAll('input[type="checkbox"]').forEach(el => {
    el.addEventListener('change', calculate);
  });
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindAll();
  calculate();
});
