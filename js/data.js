/* ============================================================
   data.js — Pemuatan & penyediaan data
   ============================================================ */
import { computeWQI, wqiClass } from './wqi.js';

export const DATA = {
  stations: [],
  meta: null,
  months: [],
  river: null,
  tributaries: null,
  waterLangat: null,
  waterSelangor: null,
  sources: null,
  srcCats: null,
  districts: null,
  basin: null,
};

const J = (u) => fetch(u).then((r) => {
  if (!r.ok) throw new Error(`${u} → HTTP ${r.status}`);
  return r.json();
});

export async function loadAll(onStep) {
  const steps = [
    ['data/stations.json',                  'stations'],
    ['data/langat_river.geojson',           'river'],
    ['data/districts.geojson',              'districts'],
    ['data/pollution_sources.geojson',      'sources'],
    ['data/waterbodies_langat.geojson',     'waterLangat'],
    ['data/tributaries.geojson',            'tributaries'],
    ['data/basin_pollution.json',           'basin'],
    ['data/waterbodies_selangor.geojson',   'waterSelangor'],
  ];
  const labels = {
    stations: 'stesen pemantauan', river: 'geometri Sungai Langat',
    sources: 'punca pencemaran', waterLangat: 'badan air Langat',
    districts: 'sempadan daerah lembangan',
    tributaries: 'anak sungai', basin: 'trend lembangan kebangsaan',
    waterSelangor: 'badan air Selangor',
  };
  let done = 0;
  for (const [url, key] of steps) {
    onStep?.(done / steps.length, `Memuat ${labels[key]}…`);
    const j = await J(url);
    if (key === 'stations') {
      DATA.stations = j.stations;
      DATA.meta = j.meta;
      DATA.months = j.meta.months;
    } else {
      DATA[key] = j;
    }
    done++;
  }
  DATA.srcCats = DATA.sources.meta.categories;
  derive();
  onStep?.(1, 'Siap');
  return DATA;
}

/* ---- Kira WQI bagi setiap bacaan setiap stesen ---- */
function derive() {
  for (const s of DATA.stations) {
    s.wqiSeries = s.series.map((r) => {
      const c = computeWQI(r);
      return { t: r.t, wqi: c.wqi, si: c.si, raw: r };
    });
    s.latest = s.wqiSeries[s.wqiSeries.length - 1];
    s.cls = wqiClass(s.latest.wqi);
    // purata 12 bulan terakhir & 12 bulan sebelumnya, untuk arah aliran
    const n = s.wqiSeries.length;
    const avg = (a, b) => {
      const w = s.wqiSeries.slice(a, b);
      return w.reduce((t, x) => t + x.wqi, 0) / (w.length || 1);
    };
    s.avg12 = avg(n - 12, n);
    s.prev12 = avg(n - 24, n - 12);
    s.delta = s.avg12 - s.prev12;
  }
  DATA.stations.sort((a, b) => a.code.localeCompare(b.code));
}

/* ---- Nilai stesen pada indeks bulan tertentu ---- */
export function readingAt(station, monthIdx) {
  const i = Math.max(0, Math.min(station.wqiSeries.length - 1, monthIdx));
  return station.wqiSeries[i];
}

/* ---- Statistik ringkas seluruh lembangan pada satu bulan ---- */
export function basinStats(monthIdx, filterRiver = null) {
  const st = filterRiver
    ? DATA.stations.filter((s) => s.river === filterRiver)
    : DATA.stations;
  const vals = st.map((s) => readingAt(s, monthIdx).wqi);
  const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  const dist = { I: 0, II: 0, III: 0, IV: 0, V: 0 };
  vals.forEach((v) => { dist[wqiClass(v).id]++; });
  return {
    n: vals.length,
    mean: Math.round(mean * 10) / 10,
    min: Math.min(...vals),
    max: Math.max(...vals),
    dist,
    cls: wqiClass(mean),
    polluted: dist.IV + dist.V,
  };
}

/* ---- Agregat punca pencemaran ---- */
export function sourceStats(maxDist = 1500) {
  const out = {};
  for (const k of Object.keys(DATA.srcCats)) {
    out[k] = { n: 0, riskSum: 0, near: 0, ...DATA.srcCats[k] };
  }
  for (const f of DATA.sources.features) {
    const p = f.properties;
    if (p.dist > maxDist) continue;
    const o = out[p.cat];
    o.n++;
    o.riskSum += p.risk;
    if (p.dist <= 250) o.near++;
  }
  return out;
}

/* Tekanan pencemaran di sekitar setiap stesen (radius km) */
export function pressureAround(station, radiusKm = 3) {
  const R = radiusKm * 1000;
  const kx = Math.cos((station.lat * Math.PI) / 180) * 111320;
  const acc = {};
  let total = 0;
  for (const f of DATA.sources.features) {
    const [lon, lat] = f.geometry.coordinates;
    const dx = (lon - station.lon) * kx;
    const dy = (lat - station.lat) * 111320;
    if (Math.abs(dx) > R || Math.abs(dy) > R) continue;
    if (Math.hypot(dx, dy) > R) continue;
    const c = f.properties.cat;
    acc[c] = (acc[c] || 0) + 1;
    total += f.properties.risk;
  }
  return { counts: acc, load: Math.round(total) };
}

/* ---- Data trend lembangan kebangsaan (data.gov.my) ---- */
export function basinTrend() {
  const byYear = {};
  for (const r of DATA.basin) {
    const y = r.date.slice(0, 4);
    byYear[y] ??= {};
    byYear[y][r.measure] ??= {};
    byYear[y][r.measure][r.status] = r.proportion;
    byYear[y].monitored = r.basins_monitored;
  }
  const years = Object.keys(byYear).sort();
  return { years, byYear };
}
