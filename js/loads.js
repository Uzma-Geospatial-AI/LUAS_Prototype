/* ============================================================
   loads.js — Pollutant load accounting and TMDL

   TMDL = ΣWLA + ΣLA + MOS
     TMDL  Total Maximum Daily Load — what is written for the reach
     WLA   Wasteload allocation — licensed point-source discharges
     LA    Load allocation — background and non-point sources
     MOS   Margin of safety

   A TMDL record holds the three terms as inputs, in kg/day for each
   pollutant, together with the target class and the design low flow it was
   written for. The loading capacity — standard concentration × design flow
   × 0.024 — is what the sum has to fit inside. Nothing here invents an
   allocation; the record says what it is, and this file says whether it
   fits and how much of it is used.

   Unit convention throughout:
     river load   kg/day = C (mg/L) × Q (m³/h) × 0.024
     licence load kg/day = C (mg/L) × Q (m³/day) / 1000

   The river flow is in cubic metres an hour, the unit the operators here
   work in. It was in m³/s until 2026-09-07; records written before that
   are converted where they are read back (see store.js).
   ============================================================ */
import { INWQS, LOAD_PARAMS, PARAM_META } from './wqi.js';

/* 1 m³/h = 24 m³/day; 1 mg/L = 1 g/m³ → 24 g/day = 0.024 kg/day */
export const RIVER_FACTOR = 0.024;
/* One m³/s in m³/h, for reading back a record written before the change */
export const CUMEC_TO_M3H = 3600;

export const riverLoad = (concMgL, flowM3PerHour) => concMgL * flowM3PerHour * RIVER_FACTOR;
export const licenceLoad = (concMgL, flowM3PerDay) => (concMgL * flowM3PerDay) / 1000;

/* ---- Defaults a new TMDL starts from ---- */
export const DEFAULT_CONDITIONS = {
  /* Which station the assessment and the load budget are written for. Dengkil
     is the default because it is the Langat station the brief names, not
     because anything depends on it. */
  focusStation: 'LGT06',
  targetClass: 'II',
  /* Sungai Langat at Dengkil. A TMDL is written for a low-flow design
     condition (MAM7 / 7Q10), not mean flow, because that is when the river
     has least capacity to assimilate a load. This default is an ESTIMATE and
     is meant to be replaced with the DID gauged record for station 2816441. */
  designFlow: 16200,          /* 4.5 m³/s */
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
   Loading capacity — what the reach can carry at a class and a flow
   ============================================================ */
export function loadingCapacity(param, targetClass, designFlow) {
  const standard = INWQS[targetClass]?.[param];
  if (standard == null || Array.isArray(standard)) return null;
  return { standard, capacity: riverLoad(standard, designFlow) };
}

/* The wasteload every active licence in the register permits, summed */
export function licensedLoad(licences, param) {
  return licences.reduce(
    (t, l) => t + (l.active === false ? 0 : licenceLoad(l.conc?.[param] ?? 0, l.flow ?? 0)), 0);
}

/* ============================================================
   Writing a TMDL to capacity

   The starting point a new record is offered. The margin of safety is a
   share of the capacity. With room to spare, the licences in the register
   are honoured in the ΣWLA, the background takes what the river carries
   beyond them, and the spare is added to the ΣWLA as room to licence.
   Where the river is already over capacity the licences are kept, up to
   the capacity, and the ΣLA takes what is left — so the page shows the
   diffuse reduction the class would need, rather than a licence headroom
   the river does not have.
   ============================================================ */
const r1 = (x) => Math.round(x * 10) / 10;
export function suggestAllocation(reading, licences, cond) {
  const out = {};
  for (const p of LOAD_PARAMS) {
    const cap = loadingCapacity(p, cond.targetClass, cond.designFlow);
    if (!cap) continue;
    const mos = cap.capacity * ((cond.mosPercent ?? 10) / 100);
    const available = cap.capacity - mos;
    const current = riverLoad(reading[p] ?? 0, cond.designFlow);
    const licensed = licensedLoad(licences, p);
    const diffuse = Math.max(0, current - licensed);
    let wla, la;
    if (licensed + diffuse <= available) {
      la = diffuse;
      wla = available - la;
    } else {
      wla = Math.min(licensed, available);
      la = available - wla;
    }
    out[p] = { wla: r1(wla), la: r1(la), mos: r1(mos) };
  }
  return out;
}

/* ============================================================
   The budget for one pollutant, under one TMDL record
   ============================================================ */
export function pollutantBudget(param, observedConc, licences, tmdl) {
  const cap = loadingCapacity(param, tmdl.targetClass, tmdl.designFlow);
  if (!cap) return null;
  const { standard, capacity } = cap;

  const a = tmdl.alloc?.[param] ?? {};
  const wla = Number(a.wla) || 0;
  const la = Number(a.la) || 0;
  const mos = Number(a.mos) || 0;
  const total = wla + la + mos;                               // the TMDL itself
  const excess = Math.max(0, total - capacity);               // what does not fit

  const current = riverLoad(observedConc, tmdl.designFlow);   // load the river carries now
  const licensed = licensedLoad(licences, param);
  /* Whatever the river carries that licensed point sources do not account for:
     background, diffuse run-off and unlicensed discharge. */
  const diffuse = Math.max(0, current - licensed);

  const remaining = wla - licensed;                           // left to licence
  const laRemaining = la - diffuse;                           // room left in the LA
  const utilisation = wla > 0 ? licensed / wla : (licensed > 0 ? Infinity : 0);

  return {
    param,
    standard,
    capacity,
    wla, la, mos,
    tmdl: total,
    available: wla + la,
    excess,
    fits: excess < 0.5,
    current,
    licensed,
    diffuse,
    remaining,
    laRemaining,
    utilisation,
    overCapacity: remaining < -0.5,
    /* When the licences exceed the WLA, the cut needed to come back inside it */
    reductionNeeded: remaining < -0.5 ? -remaining : 0,
    observedConc,
  };
}

export function budgetAll(reading, licences, tmdl) {
  const out = {};
  if (!tmdl) return out;
  for (const p of LOAD_PARAMS) {
    const b = pollutantBudget(p, reading[p], licences, tmdl);
    if (b) out[p] = b;
  }
  return out;
}

/* ============================================================
   "Berapa lagi yang tinggal" expressed as licensable headroom

   Converts what is left of the ΣWLA into the effluent volume that could
   still be licensed at a given discharge standard. The binding pollutant —
   the one that runs out first — sets the answer.
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
    /* Negative means the licences already exceed the WLA for at least one pollutant */
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
