/* ============================================================
   charges.js — What a discharge is charged

   LUAS already charges a licensed discharge two ways, and the register has
   the figures to work both out:

     · return water by VOLUME, tiered between RM0.10 and RM0.20 per cubic
       metre per month depending on the volume discharged
       — LUAS return water charge schedule

     · pollutant by MASS, per kilogram, but only the mass ABOVE the
       standard limit, for BOD, COD, suspended solids, ammoniacal nitrogen
       and oil and grease
       — Licensing Regulations (Selangor) 2024, Fourth Schedule

       WHAT IS READ AND WHAT IS ASSUMED

   Those two sentences are the whole of what is written down here, and the
   people who wrote them said it is the part they are least sure they have
   read correctly. Three things they do not settle:

     the tier boundary   RM0.10 and RM0.20 are named; where one becomes the
                         other is not. A boundary has to be assumed.
     how tiers apply     "tiered … depending on the volume" reads either as
                         a block tariff, each cubic metre charged at its own
                         band's rate, or as one rate for the whole volume
                         at the band it falls in. Both are offered.
     the rate per kg     the Fourth Schedule is cited for charging per
                         kilogram, but no rate came with it.

   So the schedule is an INPUT, not a constant: every figure is editable,
   the page says which came from the source and which was assumed, and the
   rate per kilogram starts at nothing so no charge is invented. Enter the
   rates and the charges appear.

   One consequence worth noticing: because the mass charge bites only above
   the standard, and every licence in the shipped register is written within
   its standard, the load charge on them is zero by construction. It is the
   volume charge that is not.
   ============================================================ */
import { store } from './store.js';
import { EFFLUENT_STANDARDS } from './loads.js';

/* The parameters the Fourth Schedule names. Oil and grease is one of them
   and has no ambient standard in this system, so it is charged here without
   entering the TMDL: an effluent parameter, not a river one. */
export const CHARGE_PARAMS = [
  { id: 'bod', label: 'BOD₅' },
  { id: 'cod', label: 'COD' },
  { id: 'ss', label: 'Suspended solids' },
  { id: 'an', label: 'Ammoniacal nitrogen' },
  { id: 'og', label: 'Oil and grease' },
];

/* Days in an average month, for turning a permitted daily flow into the
   monthly volume the schedule charges on. 365.25 / 12. */
export const DAYS_PER_MONTH = 30.4375;

export const DEFAULT_CHARGES = {
  /* From the source: the two rates. Assumed: the boundary between them. */
  lowRate: 0.10,
  highRate: 0.20,
  tierAt: 1000,            // m³/month — an assumption, flagged wherever shown
  /* 'block' charges each m³ at its own band's rate; 'flat' charges the whole
     volume at the rate of the band it falls in. */
  tierMode: 'block',
  /* RM per kg above the standard. No rate came with the source, so none is
     invented: zero means "not charged" and the page says why. */
  perKg: { bod: 0, cod: 0, ss: 0, an: 0, og: 0 },
  currency: 'RM',
};

export const charges = () => ({
  ...DEFAULT_CHARGES,
  ...(store.chargeSchedule?.() ?? {}),
  perKg: { ...DEFAULT_CHARGES.perKg, ...(store.chargeSchedule?.().perKg ?? {}) },
});

export const fmtMoney = (v, c = 'RM') => `${c}${Number(v || 0).toLocaleString('en-MY',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ---------------- Volume ---------------- */
export const monthlyVolume = (flowPerDay) => (Number(flowPerDay) || 0) * DAYS_PER_MONTH;

export function volumeCharge(m3PerMonth, sc = charges()) {
  const v = Math.max(0, Number(m3PerMonth) || 0);
  if (!v) return { volume: 0, charge: 0, bands: [] };
  if (sc.tierMode === 'flat') {
    const rate = v > sc.tierAt ? sc.highRate : sc.lowRate;
    return { volume: v, charge: v * rate, bands: [{ m3: v, rate }] };
  }
  const low = Math.min(v, sc.tierAt);
  const high = Math.max(0, v - sc.tierAt);
  const bands = [{ m3: low, rate: sc.lowRate }];
  if (high) bands.push({ m3: high, rate: sc.highRate });
  return { volume: v, charge: low * sc.lowRate + high * sc.highRate, bands };
}

/* ---------------- Mass above the standard ---------------- */
/* The excess is per parameter: how far the permitted concentration sits
   above the standard the licence is held to, turned into kilograms a month.
   At or under the standard there is nothing to charge. */
export function excessLoad(l, sc = charges()) {
  const std = EFFLUENT_STANDARDS[l?.standard ?? 'A'] ?? EFFLUENT_STANDARDS.A;
  const m3 = monthlyVolume(l?.flow);
  const out = { total: 0, charge: 0, rows: [] };
  for (const p of CHARGE_PARAMS) {
    const limit = std[p.id];
    const conc = Number(l?.conc?.[p.id]);
    /* A parameter with no limit in the standard cannot be charged against
       it, and one with no value on the licence has nothing to charge */
    if (limit == null || !Number.isFinite(conc)) {
      out.rows.push({ ...p, limit: limit ?? null, conc: Number.isFinite(conc) ? conc : null,
        over: null, kg: 0, rate: sc.perKg[p.id] ?? 0, charge: 0 });
      continue;
    }
    const over = Math.max(0, conc - limit);
    const kg = (over * m3) / 1000;
    const rate = sc.perKg[p.id] ?? 0;
    const charge = kg * rate;
    out.total += kg;
    out.charge += charge;
    out.rows.push({ ...p, limit, conc, over, kg, rate, charge });
  }
  return out;
}

/* ---------------- One licence ---------------- */
export function chargeFor(l, sc = charges()) {
  const vol = volumeCharge(monthlyVolume(l?.flow), sc);
  const mass = excessLoad(l, sc);
  return {
    volumeM3: vol.volume,
    volumeCharge: vol.charge,
    bands: vol.bands,
    excessKg: mass.total,
    loadCharge: mass.charge,
    rows: mass.rows,
    total: vol.charge + mass.charge,
  };
}

/* ---------------- A register, or part of one ---------------- */
export function chargeSummary(licences, sc = charges()) {
  const out = {
    schedule: sc, n: 0, volumeM3: 0, volumeCharge: 0, excessKg: 0, loadCharge: 0, total: 0,
    rows: [], overStandard: [], rateMissing: false,
  };
  for (const l of licences ?? []) {
    if (l.active === false) continue;
    const c = chargeFor(l, sc);
    out.n += 1;
    out.volumeM3 += c.volumeM3;
    out.volumeCharge += c.volumeCharge;
    out.excessKg += c.excessKg;
    out.loadCharge += c.loadCharge;
    out.total += c.total;
    out.rows.push({ licence: l, charge: c });
    if (c.excessKg > 0) out.overStandard.push({ licence: l, charge: c });
  }
  /* Somebody is over a standard but the rate that would charge it is zero */
  out.rateMissing = out.excessKg > 0 && out.loadCharge === 0;
  out.rows.sort((a, b) => b.charge.total - a.charge.total);
  out.overStandard.sort((a, b) => b.charge.excessKg - a.charge.excessKg);
  return out;
}

/* What the page says about where each figure came from */
export const SOURCES = {
  volume: 'LUAS return water charge schedule',
  load: 'Licensing Regulations (Selangor) 2024, Fourth Schedule',
};
