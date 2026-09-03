/* ============================================================
   data.js — Data loading and derivation
   ============================================================ */
import { computeWQI, wqiClass, classCompliance } from './wqi.js';

/* Phase 1 is written for one station: Sungai Langat at Dengkil. */
export const FOCUS_STATION = 'LGT06';

export const DATA = {
  stations: [],
  meta: null,
  months: [],
  basin: null,
  water: null,
  catchment: null,
  rivers: null,
  selangor: null,
  focus: null,
};

const J = (u) => fetch(u).then((r) => {
  if (!r.ok) throw new Error(`${u} → HTTP ${r.status}`);
  return r.json();
});

export async function loadAll(onStep) {
  onStep?.(0.1, 'Loading monitoring stations…');
  const st = await J('data/stations.json');
  DATA.stations = st.stations;
  DATA.meta = st.meta;
  DATA.months = st.meta.months;

  onStep?.(0.5, 'Loading national basin trend…');
  DATA.basin = await J('data/basin_pollution.json');

  onStep?.(0.65, 'Loading the Sungai Langat catchment…');
  DATA.catchment = await J('data/langat_basin.geojson');
  DATA.rivers = await J('data/langat_rivers.geojson');

  onStep?.(0.75, 'Loading receiving water bodies…');
  /* A FeatureCollection: the map draws the outlines, everything else reads
     the properties, so both views are served off one file. */
  const wb = await J('data/waterbodies_langat.geojson');
  DATA.water = {
    meta: wb.meta,
    bodies: wb.features.map((f) => f.properties),
    geo: wb,
  };

  onStep?.(0.82, 'Loading the Selangor boundary…');
  DATA.selangor = await J('data/selangor_boundary.geojson');

  onStep?.(0.85, 'Computing indices…');
  derive();
  DATA.focus = DATA.stations.find((s) => s.code === FOCUS_STATION) ?? DATA.stations[0];

  onStep?.(1, 'Ready');
  return DATA;
}

function derive() {
  for (const s of DATA.stations) {
    s.wqiSeries = s.series.map((r) => {
      const c = computeWQI(r);
      return { t: r.t, wqi: c.wqi, si: c.si, raw: r, saturation: c.saturation };
    });
    s.latest = s.wqiSeries[s.wqiSeries.length - 1];
    s.cls = wqiClass(s.latest.wqi);

    const n = s.wqiSeries.length;
    const avg = (a, b) => {
      const w = s.wqiSeries.slice(Math.max(0, a), b);
      return w.reduce((t, x) => t + x.wqi, 0) / (w.length || 1);
    };
    s.avg12 = avg(n - 12, n);
    s.prev12 = avg(n - 24, n - 12);
    s.delta = s.avg12 - s.prev12;
  }
  DATA.stations.sort((a, b) => a.code.localeCompare(b.code));
}

export function readingAt(station, monthIdx) {
  const i = Math.max(0, Math.min(station.wqiSeries.length - 1, monthIdx));
  return station.wqiSeries[i];
}

export const latestIdx = () => DATA.months.length - 1;

/* ---- How often does a station meet a target class? ---- */
export function complianceRecord(station, cls = 'II') {
  const months = station.wqiSeries.map((r) => ({
    t: r.t,
    wqi: r.wqi,
    wqiClass: wqiClass(r.wqi).id,
    compliance: classCompliance(r.raw, cls),
  }));
  const total = months.length;
  const passing = months.filter((m) => m.compliance.pass).length;

  const byParam = {};
  for (const p of ['do', 'bod', 'cod', 'ss', 'an', 'ph']) {
    const fails = months.filter((m) => m.compliance.checks[p].pass === false).length;
    byParam[p] = { fails, rate: total ? fails / total : 0 };
  }

  return { months, total, passing, rate: total ? passing / total : 0, byParam };
}

/* ---- Median of a station's readings, used as the design concentration ---- */
export function designConcentration(station, param, window = 12) {
  const vals = station.wqiSeries.slice(-window).map((r) => r.raw[param]).sort((a, b) => a - b);
  if (!vals.length) return 0;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

export function designReading(station, window = 12) {
  const out = {};
  for (const p of ['do', 'bod', 'cod', 'ss', 'an', 'ph']) {
    out[p] = Math.round(designConcentration(station, p, window) * 1000) / 1000;
  }
  return out;
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
  return { years: Object.keys(byYear).sort(), byYear };
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtMonth = (m) => `${MONTHS_EN[+m.split('-')[1] - 1]} ${m.split('-')[0]}`;

/* ============================================================
   Receiving water bodies across the Sungai Langat catchment
   Source: Digital Earth malaysia_water_bodies.geojson, clipped by
   scripts/02_build_waterbodies.py.
   ============================================================ */
export const WATER_GROUPS = {
  treatment: { label: 'Treatment & oxidation basins', color: '#4a3aa7',
    note: 'Wastewater ponds and settling basins \u2014 assets that sit between a discharge and the river.' },
  storage:   { label: 'Lakes & reservoirs', color: '#0aa3d9',
    note: 'Standing water that stores and slowly releases whatever load reaches it.' },
  pond:      { label: 'Ponds', color: '#45bfe0',
    note: 'Mostly ex-mining and detention ponds across the Langat floodplain.' },
  wetland:   { label: 'Wetlands', color: '#17a04a',
    note: 'Natural polishing capacity \u2014 wetlands strip nutrients and suspended solids.' },
  channel:   { label: 'Mapped channel surface', color: '#3c8fb5',
    note: 'The river and stream surface itself within the reach.' },
  other:     { label: 'Other open water', color: '#8b93a8',
    note: 'Water bodies with no type recorded in the source data.' },
};

export function waterSummary() {
  const bodies = DATA.water?.bodies ?? [];
  const groups = {};
  for (const k of Object.keys(WATER_GROUPS)) groups[k] = { n: 0, area: 0, named: 0 };
  for (const b of bodies) {
    const g = groups[b.group] ?? groups.other;
    g.n++;
    g.area += b.area_m2;
    if (b.name) g.named++;
  }
  const total = bodies.reduce((t, b) => t + b.area_m2, 0);
  return {
    bodies, groups, total,
    count: bodies.length,
    basinKm2: DATA.water?.meta?.basin_km2 ?? DATA.catchment?.meta?.area_km2 ?? null,
    largest: bodies.slice(0, 12),
  };
}
