/* ============================================================
   wqi.js — Malaysian Water Quality Index engine
   Official Department of Environment (DOE) Malaysia formula:
     WQI = 0.22·SIDO + 0.19·SIBOD + 0.16·SICOD
         + 0.15·SIAN + 0.16·SISS  + 0.12·SIpH
   Sub-indices come from the DOE best-fit equations.
   ============================================================ */

const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/* Oxygen saturation (%). Converts a mg/L reading at a given temperature. */
export function doSaturation(mgL, tempC = 27) {
  // O2 solubility at 1 atm (simplified Benson-Krause)
  const cs = 14.652 - 0.41022 * tempC + 0.007991 * tempC ** 2 - 0.000077774 * tempC ** 3;
  return (mgL / cs) * 100;
}

export function siDO(satPct) {
  const x = satPct;
  if (x <= 8) return 0;
  if (x >= 92) return 100;
  return clamp(-0.395 + 0.030 * x * x - 0.00020 * x ** 3);
}

export function siBOD(x) {
  return clamp(x <= 5 ? 100.4 - 4.23 * x : 108 * Math.exp(-0.055 * x) - 0.1 * x);
}

export function siCOD(x) {
  return clamp(x <= 20 ? -1.33 * x + 99.1 : 103 * Math.exp(-0.0157 * x) - 0.04 * x);
}

/* Ammoniacal nitrogen (NH3-N) */
export function siAN(x) {
  if (x >= 4) return 0;
  if (x <= 0.3) return clamp(100.5 - 105 * x);
  return clamp(94 * Math.exp(-0.573 * x) - 5 * Math.abs(x - 2));
}

/* Suspended solids */
export function siSS(x) {
  if (x >= 1000) return 0;
  if (x <= 100) return clamp(97.5 * Math.exp(-0.00676 * x) + 0.05 * x);
  return clamp(71 * Math.exp(-0.0016 * x) - 0.015 * x);
}

export function siPH(x) {
  if (x < 5.5) return clamp(17.2 - 17.2 * x + 5.02 * x * x);
  if (x < 7) return clamp(-242 + 95.5 * x - 6.67 * x * x);
  if (x < 8.75) return clamp(-181 + 82.4 * x - 6.05 * x * x);
  return clamp(536 - 77.0 * x + 2.76 * x * x);
}

/* Compute WQI and every sub-index from one sampling record.
   r = { do (mg/L), bod, cod, ss, an, ph, temp? }                */
export function computeWQI(r) {
  const sat = doSaturation(r.do, r.temp ?? 27);
  const si = {
    do: siDO(sat),
    bod: siBOD(r.bod),
    cod: siCOD(r.cod),
    an: siAN(r.an),
    ss: siSS(r.ss),
    ph: siPH(r.ph),
  };
  const wqi =
    0.22 * si.do + 0.19 * si.bod + 0.16 * si.cod +
    0.15 * si.an + 0.16 * si.ss + 0.12 * si.ph;
  return { wqi: Math.round(wqi * 10) / 10, si, saturation: Math.round(sat * 10) / 10 };
}

/* ---- The five water pollution index levels (INWQS, DOE) ---- */
export const WQI_CLASSES = [
  { id: 'I',   min: 92.7, max: 100.1, color: '#0aa3d9', label: 'Class I',   status: 'Excellent',
    use: 'Water supply with no treatment · Sensitive habitat · Very sensitive aquatic species' },
  { id: 'II',  min: 76.5, max: 92.7,  color: '#17a04a', label: 'Class II',  status: 'Clean',
    use: 'Water supply with conventional treatment · Body-contact recreation · Sensitive fisheries' },
  { id: 'III', min: 51.9, max: 76.5,  color: '#f2c40c', label: 'Class III', status: 'Slightly Polluted',
    use: 'Water supply with extensive treatment · Tolerant fisheries · Livestock watering' },
  { id: 'IV',  min: 31.0, max: 51.9,  color: '#ef7d1a', label: 'Class IV',  status: 'Polluted',
    use: 'Irrigation only · Unsuitable for water supply or recreation' },
  { id: 'V',   min: -1,   max: 31.0,  color: '#d92d20', label: 'Class V',   status: 'Very Polluted',
    use: 'Exceeds all levels above · No beneficial use · Requires immediate remediation' },
];

export function wqiClass(wqi) {
  return WQI_CLASSES.find((c) => wqi >= c.min && wqi < c.max) ?? WQI_CLASSES[4];
}

export function wqiColor(wqi) { return wqiClass(wqi).color; }

/* Parameter metadata and DOE status bands */
export const PARAM_META = {
  do:  { name: 'Dissolved Oxygen (DO)', short: 'DO', unit: 'mg/L',
         clean: [5, 99], slight: [3, 5], min: 0, max: 20, step: 0.01, better: 'high',
         role: 'Sustains aquatic life. Falls as organic matter decomposes — the most direct indicator of stress.' },
  bod: { name: 'Biochemical Oxygen Demand (BOD₅)', short: 'BOD₅', unit: 'mg/L',
         clean: [0, 3], slight: [3, 6], min: 0, max: 200, step: 0.01, better: 'low',
         role: 'Oxygen microbes consume breaking down organic matter. Signals sewage and food waste.' },
  cod: { name: 'Chemical Oxygen Demand (COD)', short: 'COD', unit: 'mg/L',
         clean: [0, 25], slight: [25, 50], min: 0, max: 1000, step: 0.1, better: 'low',
         role: 'Total oxidisable matter including synthetic compounds. Signals industrial effluent.' },
  ss:  { name: 'Suspended Solids (SS)', short: 'SS', unit: 'mg/L',
         clean: [0, 50], slight: [50, 150], min: 0, max: 5000, step: 0.1, better: 'low',
         role: 'Particles that cloud the water, block light and smother the riverbed.' },
  an:  { name: 'Ammoniacal Nitrogen (NH₃-N)', short: 'NH₃-N', unit: 'mg/L',
         clean: [0, 0.3], slight: [0.3, 0.9], min: 0, max: 50, step: 0.001, better: 'low',
         role: 'Ammonia from sewage, fertiliser and livestock waste. Toxic to fish; drives eutrophication.' },
  ph:  { name: 'pH Value', short: 'pH', unit: '',
         clean: [6, 9], slight: [5, 6], min: 0, max: 14, step: 0.01, better: 'mid',
         role: 'Acidity/alkalinity. Deviation signals industrial discharge or acid drainage.' },
};

/* Status of an individual parameter against DOE thresholds */
export function paramStatus(key, v) {
  const m = PARAM_META[key];
  if (!m) return 'unknown';
  if (key === 'do')  return v >= 5 ? 'clean' : v >= 3 ? 'slight' : 'polluted';
  if (key === 'ph')  return v >= 6 && v <= 9 ? 'clean' : v >= 5 && v <= 10 ? 'slight' : 'polluted';
  return v <= m.clean[1] ? 'clean' : v <= m.slight[1] ? 'slight' : 'polluted';
}

/* Human-readable threshold bands, for the guide table */
export function thresholdText(key) {
  const m = PARAM_META[key];
  if (key === 'do') return { clean: '≥ 5', slight: '3 – 5', polluted: '< 3' };
  if (key === 'ph') return { clean: '6 – 9', slight: '5 – 6 / 9 – 10', polluted: '< 5 or > 10' };
  return { clean: `≤ ${m.clean[1]}`, slight: `${m.slight[0]} – ${m.slight[1]}`, polluted: `> ${m.slight[1]}` };
}

/* Colour for a sub-index value, using the same five-level ramp */
export function siColor(v) {
  return v >= 92.7 ? '#0aa3d9' : v >= 76.5 ? '#17a04a'
       : v >= 51.9 ? '#f2c40c' : v >= 31 ? '#ef7d1a' : '#d92d20';
}
