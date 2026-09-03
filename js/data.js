/* ============================================================
   data.js — Data loading and derivation
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
  sewerage: null,
  basin: null,
};

const J = (u) => fetch(u).then((r) => {
  if (!r.ok) throw new Error(`${u} → HTTP ${r.status}`);
  return r.json();
});

export async function loadAll(onStep) {
  const steps = [
    ['data/stations.json',                  'stations',       'monitoring stations'],
    ['data/langat_river.geojson',           'river',          'Langat River geometry'],
    ['data/districts.geojson',              'districts',      'basin district boundaries'],
    ['data/pollution_sources.geojson',      'sources',        'pollution sources'],
    ['data/waterbodies_langat.geojson',     'waterLangat',    'Langat water bodies'],
    ['data/tributaries.geojson',            'tributaries',    'tributaries and canals'],
    ['data/sewerage.geojson',               'sewerage',       'drainage and sewerage network'],
    ['data/basin_pollution.json',           'basin',          'national basin trend'],
    ['data/waterbodies_selangor.geojson',   'waterSelangor',  'Selangor water bodies'],
  ];
  let done = 0;
  for (const [url, key, label] of steps) {
    onStep?.(done / steps.length, `Loading ${label}…`);
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
  buildWaterwayIndex();
  onStep?.(1, 'Ready');
  return DATA;
}

/* ---- Compute WQI for every reading at every station ---- */
function derive() {
  for (const s of DATA.stations) {
    s.wqiSeries = s.series.map((r) => {
      const c = computeWQI(r);
      return { t: r.t, wqi: c.wqi, si: c.si, raw: r };
    });
    s.latest = s.wqiSeries[s.wqiSeries.length - 1];
    s.cls = wqiClass(s.latest.wqi);
    // trailing 12-month mean vs the 12 months before it, for direction of travel
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

/* ---- One station's reading at a given month index ---- */
export function readingAt(station, monthIdx) {
  const i = Math.max(0, Math.min(station.wqiSeries.length - 1, monthIdx));
  return station.wqiSeries[i];
}

/* ---- Basin-wide summary for one month ---- */
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

/* ---- Pollution source aggregates ---- */
export function sourceStats(maxDist = 1500) {
  const out = {};
  for (const k of Object.keys(DATA.srcCats)) {
    out[k] = { n: 0, riskSum: 0, near: 0, ...DATA.srcCats[k] };
  }
  for (const f of DATA.sources.features) {
    const p = f.properties;
    if (p.dist > maxDist) continue;
    const o = out[p.cat];
    if (!o) continue;
    o.n++;
    o.riskSum += p.risk;
    if (p.dist <= 250) o.near++;
  }
  return out;
}

/* Land-use pressure within a radius of a station */
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

/* ---- National basin trend (data.gov.my) ---- */
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

/* ============================================================
   Watercourse distance index — used when a user reports a source
   ============================================================ */
const MPD = 111320;                 // metres per degree of latitude
const CELL = 0.01;                  // ~1.1 km grid cells
let wwSeg = [], wwGrid = null;

function buildWaterwayIndex() {
  wwSeg = [];
  const push = (fc, named) => {
    for (const f of fc.features) {
      const g = f.geometry;
      if (g.type !== 'LineString') continue;
      const c = g.coordinates;
      for (let i = 0; i < c.length - 1; i++) {
        wwSeg.push([c[i][0], c[i][1], c[i + 1][0], c[i + 1][1], named ?? f.properties.name ?? null]);
      }
    }
  };
  push(DATA.river, 'Sungai Langat');
  push(DATA.tributaries);

  wwGrid = new Map();
  wwSeg.forEach((s, i) => {
    const x0 = Math.min(s[0], s[2]), x1 = Math.max(s[0], s[2]);
    const y0 = Math.min(s[1], s[3]), y1 = Math.max(s[1], s[3]);
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) {
      for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
        const k = `${gx}:${gy}`;
        if (!wwGrid.has(k)) wwGrid.set(k, []);
        wwGrid.get(k).push(i);
      }
    }
  });
}

function pointSegMetres(lon, lat, s) {
  const kx = Math.cos((lat * Math.PI) / 180) * MPD;
  const ax = (s[0] - lon) * kx, ay = (s[1] - lat) * MPD;
  const bx = (s[2] - lon) * kx, by = (s[3] - lat) * MPD;
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/* Nearest watercourse to a point: { dist (m), name } */
export function nearestWatercourse(lon, lat, maxRings = 4) {
  if (!wwGrid) return { dist: null, name: null };
  const gx0 = Math.floor(lon / CELL), gy0 = Math.floor(lat / CELL);
  let best = Infinity, bestName = null, found = false;
  for (let r = 0; r <= maxRings; r++) {
    for (let gx = gx0 - r; gx <= gx0 + r; gx++) {
      for (let gy = gy0 - r; gy <= gy0 + r; gy++) {
        if (r > 0 && Math.abs(gx - gx0) !== r && Math.abs(gy - gy0) !== r) continue;
        for (const i of wwGrid.get(`${gx}:${gy}`) ?? []) {
          const d = pointSegMetres(lon, lat, wwSeg[i]);
          if (d < best) { best = d; bestName = wwSeg[i][4]; }
          found = true;
        }
      }
    }
    if (found && best < r * CELL * MPD) break;
  }
  return Number.isFinite(best)
    ? { dist: Math.round(best), name: bestName }
    : { dist: null, name: null };
}

/* Which basin district a point falls in (null if outside all three) */
export function districtOf(lon, lat) {
  const inRing = (x, y, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-18) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };
  for (const f of DATA.districts?.features ?? []) {
    for (const poly of f.geometry.coordinates) {
      if (inRing(lon, lat, poly[0])) return f.properties.name;
    }
  }
  return null;
}

/* Risk score for a reported source — same formula as the ETL pipeline */
export function riskScore(cat, distM) {
  const load = DATA.srcCats?.[cat]?.load ?? 3;
  const prox = Math.max(0, 1 - (distM ?? 1500) / 1500);
  return Math.round(load * (0.35 + 0.65 * prox ** 1.6) * 100) / 100;
}
