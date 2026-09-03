/* ============================================================
   wqi.js — Water Quality Index engine and INWQS class standards

   Official Department of Environment (DOE) Malaysia formula:
     WQI = 0.22·SIDO + 0.19·SIBOD + 0.16·SICOD
         + 0.15·SIAN + 0.16·SISS  + 0.12·SIpH
   ============================================================ */

const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/* Oxygen saturation (%) from a mg/L reading at a given temperature. */
export function doSaturation(mgL, tempC = 27) {
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
export function siAN(x) {
  if (x >= 4) return 0;
  if (x <= 0.3) return clamp(100.5 - 105 * x);
  return clamp(94 * Math.exp(-0.573 * x) - 5 * Math.abs(x - 2));
}
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

/* Compute the index and every sub-index from one sampling record.
   r = { do (mg/L), bod, cod, ss, an, ph, temp? }                */
export function computeWQI(r) {
  const sat = doSaturation(r.do, r.temp ?? 27);
  const si = {
    do: siDO(sat), bod: siBOD(r.bod), cod: siCOD(r.cod),
    an: siAN(r.an), ss: siSS(r.ss), ph: siPH(r.ph),
  };
  const wqi = 0.22 * si.do + 0.19 * si.bod + 0.16 * si.cod
            + 0.15 * si.an + 0.16 * si.ss + 0.12 * si.ph;
  return { wqi: Math.round(wqi * 10) / 10, si, saturation: Math.round(sat * 10) / 10 };
}

export const WEIGHTS = { do: 0.22, bod: 0.19, cod: 0.16, ss: 0.16, an: 0.15, ph: 0.12 };

/* ---- The five WQI classes (DOE water quality index bands) ---- */
export const WQI_CLASSES = [
  { id: 'I',   min: 92.7, max: 100.1, color: '#0aa3d9', label: 'Class I',   status: 'Excellent',
    use: 'Water supply with no treatment · Very sensitive aquatic species' },
  { id: 'II',  min: 76.5, max: 92.7,  color: '#17a04a', label: 'Class II',  status: 'Clean',
    use: 'Water supply with conventional treatment · Body-contact recreation · Sensitive fisheries' },
  { id: 'III', min: 51.9, max: 76.5,  color: '#f2c40c', label: 'Class III', status: 'Slightly Polluted',
    use: 'Water supply with extensive treatment · Tolerant fisheries · Livestock watering' },
  { id: 'IV',  min: 31.0, max: 51.9,  color: '#ef7d1a', label: 'Class IV',  status: 'Polluted',
    use: 'Irrigation only · Unsuitable for water supply or recreation' },
  { id: 'V',   min: -1,   max: 31.0,  color: '#d92d20', label: 'Class V',   status: 'Very Polluted',
    use: 'Exceeds all levels above · No beneficial use' },
];

export function wqiClass(wqi) {
  return WQI_CLASSES.find((c) => wqi >= c.min && wqi < c.max) ?? WQI_CLASSES[4];
}
export function wqiColor(wqi) { return wqiClass(wqi).color; }

/* ============================================================
   INWQS — Interim National Water Quality Standards for Malaysia
   Ambient limits per class. `dir` says which way is compliant.
   ============================================================ */
export const INWQS = {
  I:   { an: 0.1, bod: 1,  cod: 10,  ss: 25,  do: 7,     ph: [6.5, 8.5] },
  II:  { an: 0.3, bod: 3,  cod: 25,  ss: 50,  do: [5, 7], ph: [6, 9] },
  III: { an: 0.9, bod: 6,  cod: 50,  ss: 150, do: [3, 5], ph: [5, 9] },
  IV:  { an: 2.7, bod: 12, cod: 100, ss: 300, do: 3,     ph: [5, 9] },
};

export const TARGET_CLASSES = [
  { id: 'I',   label: 'Class I — no treatment required' },
  { id: 'II',  label: 'Class II — conventional treatment (Langat target)' },
  { id: 'III', label: 'Class III — extensive treatment' },
  { id: 'IV',  label: 'Class IV — irrigation only' },
];

/* Parameters that carry a mass load, i.e. the ones a TMDL is written for. */
export const LOAD_PARAMS = ['bod', 'cod', 'ss', 'an'];

export const PARAM_META = {
  do:  { name: 'Dissolved Oxygen', short: 'DO', unit: 'mg/L', better: 'high',
         min: 0, max: 20, step: 0.01, loadable: false,
         role: 'Sustains aquatic life. Falls as organic matter decomposes — the most direct indicator of stress.' },
  bod: { name: 'Biochemical Oxygen Demand', short: 'BOD₅', unit: 'mg/L', better: 'low',
         min: 0, max: 200, step: 0.01, loadable: true,
         role: 'Oxygen microbes consume breaking down organic matter. Signals sewage and food waste.' },
  cod: { name: 'Chemical Oxygen Demand', short: 'COD', unit: 'mg/L', better: 'low',
         min: 0, max: 1000, step: 0.1, loadable: true,
         role: 'Total oxidisable matter including synthetic compounds. Signals industrial effluent.' },
  ss:  { name: 'Suspended Solids', short: 'SS', unit: 'mg/L', better: 'low',
         min: 0, max: 5000, step: 0.1, loadable: true,
         role: 'Particles that cloud the water, block light and smother the riverbed.' },
  an:  { name: 'Ammoniacal Nitrogen', short: 'NH₃-N', unit: 'mg/L', better: 'low',
         min: 0, max: 50, step: 0.001, loadable: true,
         role: 'Ammonia from sewage, fertiliser and livestock waste. Toxic to fish; drives eutrophication.' },
  ph:  { name: 'pH Value', short: 'pH', unit: '', better: 'mid',
         min: 0, max: 14, step: 0.01, loadable: false,
         role: 'Acidity/alkalinity. Deviation signals industrial discharge or acid drainage.' },
};

/* Does one reading meet the ambient standard for a target class?
   Returns { pass, limit, limitText, margin, ratio }             */
export function checkStandard(param, value, cls = 'II') {
  const std = INWQS[cls]?.[param];
  if (std == null) return { pass: null, limit: null, limitText: '—' };

  if (param === 'ph') {
    const [lo, hi] = std;
    return {
      pass: value >= lo && value <= hi,
      limit: std, limitText: `${lo} – ${hi}`,
      margin: value < lo ? value - lo : value > hi ? value - hi : 0,
      ratio: null,
    };
  }

  if (param === 'do') {
    /* DO is a floor. Class II is written as a 5–7 band; the binding value
       for compliance is the lower bound. */
    const lo = Array.isArray(std) ? std[0] : std;
    return {
      pass: value >= lo, limit: lo, limitText: `≥ ${lo}`,
      margin: value - lo, ratio: lo > 0 ? value / lo : null,
    };
  }

  /* Everything else is a ceiling. */
  return {
    pass: value <= std, limit: std, limitText: `≤ ${std}`,
    margin: std - value, ratio: std > 0 ? value / std : null,
  };
}

/* Overall verdict for a full six-parameter reading against a target class. */
export function classCompliance(reading, cls = 'II') {
  const checks = {};
  let failed = 0;
  for (const p of Object.keys(PARAM_META)) {
    checks[p] = checkStandard(p, reading[p], cls);
    if (checks[p].pass === false) failed++;
  }
  return { cls, checks, failed, pass: failed === 0 };
}

/* Colour for a sub-index value, on the same five-level ramp. */
export function siColor(v) {
  return v >= 92.7 ? '#0aa3d9' : v >= 76.5 ? '#17a04a'
       : v >= 51.9 ? '#f2c40c' : v >= 31 ? '#ef7d1a' : '#d92d20';
}

/* Status of an individual parameter against the DOE clean/slight/polluted bands. */
export function paramStatus(key, v) {
  if (key === 'do') return v >= 5 ? 'clean' : v >= 3 ? 'slight' : 'polluted';
  if (key === 'ph') return v >= 6 && v <= 9 ? 'clean' : v >= 5 && v <= 10 ? 'slight' : 'polluted';
  const bands = { bod: [3, 6], cod: [25, 50], ss: [50, 150], an: [0.3, 0.9] }[key];
  if (!bands) return 'unknown';
  return v <= bands[0] ? 'clean' : v <= bands[1] ? 'slight' : 'polluted';
}
