/* ============================================================
   loads.js — Pollutant load accounting and TMDL

   TMDL = ΣWLA + ΣLA + MOS
     TMDL  Total Maximum Daily Load — the loading capacity of the reach
     WLA   Wasteload allocation — licensed point-source discharges (SESAMS)
     LA    Load allocation — background and non-point sources
     MOS   Margin of safety

   Unit convention throughout:
     river load   kg/day = C (mg/L) × Q (m³/s) × 86.4
     licence load kg/day = C (mg/L) × Q (m³/day) / 1000
   ============================================================ */
import { INWQS, LOAD_PARAMS, PARAM_META } from './wqi.js';

/* 1 m³/s = 86,400 m³/day; 1 mg/L = 1 g/m³ → 86,400 g/day = 86.4 kg/day */
export const RIVER_FACTOR = 86.4;

export const riverLoad = (concMgL, flowCumecs) => concMgL * flowCumecs * RIVER_FACTOR;
export const licenceLoad = (concMgL, flowM3PerDay) => (concMgL * flowM3PerDay) / 1000;

/* ---- Design conditions the whole calculation hangs on ---- */
export const DEFAULT_CONDITIONS = {
  targetClass: 'II',
  /* Sungai Langat at Dengkil. A TMDL is written for a low-flow design
     condition (MAM7 / 7Q10), not mean flow, because that is when the river
     has least capacity to assimilate a load. This default is an ESTIMATE and
     is meant to be replaced with the DID gauged record for station 2816441. */
  designFlow: 4.5,
  flowLabel: 'MAM7 low-flow estimate',
  flowVerified: false,
  mosPercent: 10,
};

/* ---- Malaysian effluent discharge standards ----
   Environmental Quality (Industrial Effluent) Regulations 2009.
   Standard A applies upstream of a water supply intake, Standard B downstream. */
export const EFFLUENT_STANDARDS = {
  A: { label: 'Standard A (upstream of an intake)', bod: 20, cod: 80,  ss: 50,  an: 10 },
  B: { label: 'Standard B (downstream)',            bod: 50, cod: 200, ss: 100, an: 20 },
};

/* ============================================================
   The budget for one pollutant
   ============================================================ */
export function pollutantBudget(param, observedConc, licences, cond) {
  const { targetClass, designFlow, mosPercent } = cond;
  const standard = INWQS[targetClass]?.[param];
  if (standard == null || Array.isArray(standard)) return null;

  const capacity = riverLoad(standard, designFlow);          // TMDL / loading capacity
  const mos = capacity * (mosPercent / 100);
  const available = capacity - mos;                           // allocable to all sources
  const current = riverLoad(observedConc, designFlow);        // load the river carries now

  const licensed = licences.reduce(
    (t, l) => t + (l.active === false ? 0 : licenceLoad(l.conc?.[param] ?? 0, l.flow ?? 0)), 0);

  /* Whatever the river carries that licensed point sources do not account for:
     background, diffuse run-off and unlicensed discharge. */
  const diffuse = Math.max(0, current - licensed);

  const remaining = available - current;
  const utilisation = available > 0 ? current / available : Infinity;

  return {
    param,
    standard,
    capacity,
    mos,
    available,
    current,
    licensed,
    diffuse,
    remaining,
    utilisation,
    overCapacity: remaining < 0,
    /* When over capacity, this is the cut needed to bring the reach into class. */
    reductionNeeded: remaining < 0 ? -remaining : 0,
    observedConc,
  };
}

export function budgetAll(reading, licences, cond) {
  const out = {};
  for (const p of LOAD_PARAMS) {
    const b = pollutantBudget(p, reading[p], licences, cond);
    if (b) out[p] = b;
  }
  return out;
}

/* ============================================================
   "Berapa lagi yang tinggal" expressed as licensable headroom

   Converts the remaining kg/day into the effluent volume that could still be
   licensed at a given discharge standard. The binding pollutant — the one that
   runs out first — sets the answer.
   ============================================================ */
export function headroom(budgets, standardKey = 'A') {
  const std = EFFLUENT_STANDARDS[standardKey];
  const rows = [];

  for (const p of LOAD_PARAMS) {
    const b = budgets[p];
    if (!b) continue;
    const conc = std[p];
    rows.push({
      param: p,
      remaining: b.remaining,
      effluentConc: conc,
      /* m³/day of new effluent at this standard before the pollutant runs out */
      volume: conc > 0 ? (b.remaining / conc) * 1000 : Infinity,
      overCapacity: b.overCapacity,
    });
  }

  const positive = rows.filter((r) => !r.overCapacity);
  const binding = rows.reduce((a, b) => (a == null || b.volume < a.volume ? b : a), null);

  return {
    standard: std,
    standardKey,
    rows,
    binding,
    /* Negative means the reach is already over capacity for at least one pollutant */
    volume: binding ? binding.volume : 0,
    anyOver: rows.some((r) => r.overCapacity),
    allClear: positive.length === rows.length,
  };
}

/* Population equivalent: 1 PE ≈ 0.225 m³/day at ~250 mg/L BOD in raw sewage
   (Malaysian Sewerage Industry Guidelines). Useful for translating headroom
   into "how many more people can this reach serve". */
export const PE_FLOW = 0.225;
export function headroomInPE(headroomVolume) {
  return Math.max(0, Math.floor(headroomVolume / PE_FLOW));
}

/* ============================================================
   Licence helpers
   ============================================================ */
export function licenceLoads(licence) {
  const out = {};
  for (const p of LOAD_PARAMS) {
    out[p] = licenceLoad(licence.conc?.[p] ?? 0, licence.flow ?? 0);
  }
  return out;
}

/* Does a licence's permitted concentration meet the chosen effluent standard? */
export function licenceCompliance(licence, standardKey = 'A') {
  const std = EFFLUENT_STANDARDS[standardKey];
  const breaches = LOAD_PARAMS.filter((p) => (licence.conc?.[p] ?? 0) > std[p]);
  return { pass: breaches.length === 0, breaches, standard: std };
}

/* ---- Formatting ---- */
export const fmtLoad = (kgPerDay) => {
  if (!Number.isFinite(kgPerDay)) return '—';
  const v = Math.abs(kgPerDay);
  if (v >= 1000) return `${(kgPerDay / 1000).toLocaleString('en-MY', { maximumFractionDigits: 2 })} t/day`;
  if (v >= 10) return `${kgPerDay.toLocaleString('en-MY', { maximumFractionDigits: 0 })} kg/day`;
  return `${kgPerDay.toLocaleString('en-MY', { maximumFractionDigits: 2 })} kg/day`;
};

export const fmtVol = (m3PerDay) => {
  if (!Number.isFinite(m3PerDay)) return '—';
  if (Math.abs(m3PerDay) >= 1e6) return `${(m3PerDay / 1e6).toFixed(2)} Mm³/day`;
  return `${Math.round(m3PerDay).toLocaleString('en-MY')} m³/day`;
};

export const paramLabel = (p) => PARAM_META[p].short;
