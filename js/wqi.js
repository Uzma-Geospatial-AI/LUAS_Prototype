/* ============================================================
   wqi.js — Enjin Indeks Kualiti Air (WQI) Malaysia
   Formula rasmi Jabatan Alam Sekitar (DOE) Malaysia:
     WQI = 0.22·SIDO + 0.19·SIBOD + 0.16·SICOD
         + 0.15·SIAN + 0.16·SISS  + 0.12·SIpH
   Sub-indeks dikira daripada persamaan "best-fit" DOE.
   ============================================================ */

const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/* Ketepuan oksigen (%). Jika input dalam mg/L, tukar dahulu. */
export function doSaturation(mgL, tempC = 27) {
  // Kelarutan O2 pada tekanan 1 atm (anggaran Benson-Krause dipermudah)
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

/* Ammoniacal Nitrogen (NH3-N) */
export function siAN(x) {
  if (x >= 4) return 0;
  if (x <= 0.3) return clamp(100.5 - 105 * x);
  return clamp(94 * Math.exp(-0.573 * x) - 5 * Math.abs(x - 2));
}

/* Pepejal Terampai (Suspended Solids) */
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

/* Kira WQI + semua sub-indeks daripada satu bacaan.
   r = { do (mg/L), bod, cod, ss, an, ph, temp? }               */
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

/* ---- 5 Aras / Kelas Indeks Pencemaran Air (INWQS, DOE) ---- */
export const WQI_CLASSES = [
  { id: 'I',   min: 92.7, max: 100.1, color: '#0aa3d9', label: 'Kelas I',   status: 'Sangat Bersih',   statusEn: 'Excellent',
    use: 'Bekalan air tanpa rawatan · Habitat sensitif · Spesies akuatik sangat sensitif' },
  { id: 'II',  min: 76.5, max: 92.7,  color: '#17a04a', label: 'Kelas II',  status: 'Bersih',          statusEn: 'Clean / Good',
    use: 'Bekalan air perlu rawatan konvensional · Rekreasi (kontak badan) · Perikanan sensitif' },
  { id: 'III', min: 51.9, max: 76.5,  color: '#f2c40c', label: 'Kelas III', status: 'Sederhana Tercemar', statusEn: 'Slightly Polluted',
    use: 'Bekalan air perlu rawatan lanjutan · Perikanan toleran · Pengairan ternakan' },
  { id: 'IV',  min: 31.0, max: 51.9,  color: '#ef7d1a', label: 'Kelas IV',  status: 'Tercemar',        statusEn: 'Polluted',
    use: 'Pengairan pertanian sahaja · Tidak sesuai untuk bekalan air atau rekreasi' },
  { id: 'V',   min: -1,   max: 31.0,  color: '#d92d20', label: 'Kelas V',   status: 'Sangat Tercemar', statusEn: 'Very Polluted',
    use: 'Melebihi semua aras di atas · Tiada kegunaan bermanfaat · Perlu tindakan pemulihan segera' },
];

export function wqiClass(wqi) {
  return WQI_CLASSES.find((c) => wqi >= c.min && wqi < c.max) ?? WQI_CLASSES[4];
}

export function wqiColor(wqi) { return wqiClass(wqi).color; }

/* Julat sub-indeks bagi status "Bersih / Sederhana / Tercemar" (DOE) */
export const PARAM_META = {
  do:  { name: 'Oksigen Terlarut (DO)', unit: 'mg/L', clean: [5, 99], slight: [3, 5], key: 'do', better: 'high' },
  bod: { name: 'Permintaan Oksigen Biokimia (BOD₅)', unit: 'mg/L', clean: [0, 3], slight: [3, 6], key: 'bod', better: 'low' },
  cod: { name: 'Permintaan Oksigen Kimia (COD)', unit: 'mg/L', clean: [0, 25], slight: [25, 50], key: 'cod', better: 'low' },
  ss:  { name: 'Pepejal Terampai (SS)', unit: 'mg/L', clean: [0, 50], slight: [50, 150], key: 'ss', better: 'low' },
  an:  { name: 'Nitrogen Ammoniakal (NH₃-N)', unit: 'mg/L', clean: [0, 0.3], slight: [0.3, 0.9], key: 'an', better: 'low' },
  ph:  { name: 'Nilai pH', unit: '', clean: [6, 9], slight: [5, 6], key: 'ph', better: 'mid' },
};

/* Status parameter individu mengikut ambang DOE */
export function paramStatus(key, v) {
  const m = PARAM_META[key];
  if (!m) return 'unknown';
  if (key === 'do')  return v >= 5 ? 'clean' : v >= 3 ? 'slight' : 'polluted';
  if (key === 'ph')  return v >= 6 && v <= 9 ? 'clean' : v >= 5 && v <= 10 ? 'slight' : 'polluted';
  return v <= m.clean[1] ? 'clean' : v <= m.slight[1] ? 'slight' : 'polluted';
}
