/* ============================================================
   data.js — Data loading and derivation
   ============================================================ */
import { computeWQI, wqiClass, classCompliance } from './wqi.js';
import { store } from './store.js';
import { DEFAULT_CONDITIONS } from './loads.js';
import { probe, readNode, SOURCE } from './firebase.js';

/* The station the assessment is written for. It defaults to Sungai Langat at
   Dengkil and can be changed from the app bar or from any marker on the map;
   every phase reads DATA.focus, so they all follow. */
export const FOCUS_STATION = 'LGT06';

export function setFocus(code) {
  const st = DATA.stations.find((s) => s.code === code);
  if (!st || st.code === DATA.focus?.code) return false;
  DATA.focus = st;
  store.setConditions({ focusStation: code });   /* fires storechange */
  return true;
}

export const DATA = {
  stations: [],
  meta: null,
  months: [],
  basin: null,
  water: null,
  catchment: null,
  rivers: null,
  sources: null,
  selangor: null,
  focus: null,
};

const J = (u) => fetch(u).then((r) => {
  if (!r.ok) throw new Error(`${u} → HTTP ${r.status}`);
  return r.json();
});

/* The eight datasets do not depend on one another, so they are requested
   together rather than one after the next. Awaited in a chain they cost the
   sum of eight round trips — about 3 seconds on a throttled phone; started
   together they cost roughly the slowest one. The progress bar advances as
   each lands, so it still reports real work rather than a guess. */
export async function loadAll(onStep) {
  /* key in DATA · database node · bundled file · what to call it while loading */
  const FILES = [
    ['stations', 'stations', 'data/stations.json', 'monitoring stations'],
    ['basin', 'basin_pollution', 'data/basin_pollution.json', 'national basin trend'],
    ['catchment', 'catchment', 'data/langat_basin.geojson', 'the Sungai Langat catchment'],
    ['rivers', 'rivers', 'data/langat_rivers.geojson', 'the river network'],
    ['water', 'waterbodies', 'data/waterbodies_langat.geojson', 'receiving water bodies'],
    ['sources', 'sources', 'data/pollution_sources.geojson', 'point sources'],
    ['selangor', 'selangor', 'data/selangor_boundary.geojson', 'the Selangor boundary'],
    ['levels', 'water_levels', 'data/water_levels.json', 'river water levels'],
  ];

  /* One probe decides for all eight. Asking the database node by node would
     cost eight timeouts when it is closed or down, and the whole point of
     keeping the bundled files is that being unable to reach the database
     costs the reader nothing. */
  onStep?.(0.08, 'Checking the database…');
  const live = await probe();

  let done = 0;
  const got = {};
  await Promise.all(FILES.map(([key, node, url, label]) => {
    const read = live
      ? readNode(node).catch(() => { SOURCE.fellBack.push(node); return J(url); })
      : J(url);
    return read.then((d) => {
      got[key] = d;
      done += 1;
      onStep?.(0.1 + 0.75 * (done / FILES.length), `Loaded ${label}…`);
    });
  }));

  SOURCE.from = !live ? 'files'
    : SOURCE.fellBack.length === 0 ? 'database'
      : SOURCE.fellBack.length === FILES.length ? 'files' : 'mixed';

  DATA.stations = got.stations.stations;
  DATA.meta = got.stations.meta;
  DATA.months = got.stations.meta.months;
  DATA.basin = got.basin;
  DATA.catchment = got.catchment;
  DATA.rivers = got.rivers;
  DATA.sources = got.sources;
  DATA.selangor = got.selangor;
  /* JPS river water level. A snapshot with the station clock on it, because
     InfoBanjir sends no CORS header and a static page cannot read it live. */
  DATA.levels = got.levels;

  /* A FeatureCollection: the map draws the outlines, everything else reads
     the properties, so both views are served off one file. */
  DATA.water = {
    meta: got.water.meta,
    bodies: got.water.features.map((f) => f.properties),
    geo: got.water,
  };

  onStep?.(0.9, 'Computing indices…');
  refreshUserStations();
  const chosen = store.conditions().focusStation ?? FOCUS_STATION;
  DATA.focus = DATA.stations.find((s) => s.code === chosen)
    ?? DATA.stations.find((s) => s.code === FOCUS_STATION)
    ?? DATA.stations[0];

  onStep?.(1, 'Ready');
  return DATA;
}

function derive() {
  for (const s of DATA.stations) {
    s.wqiSeries = s.series.map((r) => {
      const c = computeWQI(r);
      return { t: r.t, wqi: c.wqi, si: c.si, raw: r, saturation: c.saturation };
    });
    s.latest = s.wqiSeries[s.wqiSeries.length - 1] ?? null;
    s.cls = s.latest ? wqiClass(s.latest.wqi) : null;

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

/* The reading standing at a month: the one taken that month, or failing that
   the latest taken before it, so a station sampled in August still shows
   in September. Null when the station has nothing at or before that month.
   The reading carries its own month in `t`, so a reader can tell the two
   cases apart. */
export function readingAt(station, monthIdx) {
  const i = Math.max(0, Math.min(DATA.months.length - 1, monthIdx));
  const m = DATA.months[i];
  let best = null;
  for (const r of station.wqiSeries) {
    if (r.t <= m) best = r; else break;
  }
  return best;
}

/* The reading taken in exactly that month, or null */
export function readingIn(station, month) {
  return station.wqiSeries.find((r) => r.t === month) ?? null;
}

export const latestIdx = () => DATA.months.length - 1;

/* ---- Locations added from the app bar ----
   A station added there has no official record. Its series is whatever
   has been saved for it from the Phase 1 calculator, one reading a month,
   the latest saved for a month winning. The official stations' series are
   the files' and are not touched. */
function userSeries(code) {
  const byMonth = new Map();
  for (const r of store.readings()) {
    if (r.station !== code || typeof r.t !== 'string') continue;
    const t = r.t.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(t)) continue;
    byMonth.set(t, { t, do: +r.do, bod: +r.bod, cod: +r.cod, ss: +r.ss, an: +r.an, ph: +r.ph, temp: r.temp });
  }
  return [...byMonth.values()].sort((a, b) => a.t.localeCompare(b.t));
}

/* The month range every page walks: the files' record, stretched to take
   in any month a reading has been saved for, contiguous from first to last */
function extendMonths() {
  const base = DATA.meta.months;
  let lo = base[0], hi = base[base.length - 1];
  for (const s of DATA.stations) {
    if (!s.user) continue;
    for (const r of s.series) { if (r.t < lo) lo = r.t; if (r.t > hi) hi = r.t; }
  }
  const out = [];
  let [y, m] = lo.split('-').map(Number);
  const [hy, hm] = hi.split('-').map(Number);
  while (y < hy || (y === hy && m <= hm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  DATA.months = out;
}

/* Bring the stations added in this browser in beside the official ones,
   with whatever readings they have, and derive everything again. Called
   on load and whenever the store changes. */
export function refreshUserStations() {
  DATA.stations = DATA.stations.filter((s) => !s.user);
  for (const u of store.stations()) {
    if (DATA.stations.some((s) => s.code === u.code)) continue;   /* an official code wins */
    DATA.stations.push({ ...u, user: true, series: userSeries(u.code) });
  }
  extendMonths();
  derive();
  estimateFlows();
  /* The focus is held by code: the object behind it may have been rebuilt,
     or removed */
  const code = DATA.focus?.code ?? store.conditions().focusStation ?? FOCUS_STATION;
  DATA.focus = DATA.stations.find((s) => s.code === code)
    ?? DATA.stations.find((s) => s.code === FOCUS_STATION)
    ?? DATA.stations[0];
}

/* ---- A design low flow for each station ----
   Only Dengkil has an estimate written down: 4.5 m³/s, MAM7. No other
   station has one, and a TMDL cannot be written without a flow, so each
   station's is scaled from Dengkil's by the mapped channel length draining
   to it — the same accumulation the map scales line width by, read off the
   nearest reach at the point the station sits on it. A first estimate,
   flagged as one everywhere it shows, to be replaced station by station
   with the DID gauged record. */
function drainedAt(st) {
  const all = DATA.rivers?.features ?? [];
  const k = Math.cos((st.lat * Math.PI) / 180);
  const px = st.lon * k, py = st.lat;
  /* The station's own river first: at a confluence or a mouth the nearest
     line can be a side channel that drains almost nothing. Any reach only
     when the named river is not mapped within about 2 km. */
  const nearest = (feats) => {
    let best = null;
    for (const f of feats) {
    const c = f.geometry.coordinates;
    for (let i = 0; i < c.length - 1; i++) {
      const x1 = c[i][0] * k, y1 = c[i][1], x2 = c[i + 1][0] * k, y2 = c[i + 1][1];
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = (px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2;
      if (!best || d < best.d) best = { d, f, i, t };
    }
  }
    return best;
  };
  const own = st.river ? nearest(all.filter((f) => f.properties.name === st.river)) : null;
  const best = own && Math.sqrt(own.d) < 0.018 ? own : nearest(all);
  if (!best) return null;
  /* How far down the reach the station sits: what the reach itself adds
     below that point is not yet draining through the station */
  const c = best.f.geometry.coordinates;
  const seg = (a, b) => Math.hypot((b[0] - a[0]) * k, b[1] - a[1]);
  let before = 0, total = 0;
  for (let i = 0; i < c.length - 1; i++) {
    const l = seg(c[i], c[i + 1]);
    total += l;
    if (i < best.i) before += l;
    else if (i === best.i) before += l * best.t;
  }
  const frac = total ? before / total : 1;
  const p = best.f.properties;
  let val = Math.max(1, (p.up ?? 0) - (p.m ?? 0) * (1 - frac));
  /* An outlet reach of a river that has bigger reaches upstream is a mouth
     the mapped network does not join up to; the mouth carries the whole
     river, so the river's largest accumulation is added to it. */
  if (best === own && p.next == null) {
    const maxUp = Math.max(0, ...all.filter((f) => f.properties.name === st.river).map((f) => f.properties.up ?? 0));
    if (maxUp > (p.up ?? 0)) val += maxUp;
  }
  return val;
}

function estimateFlows() {
  if (!DATA.rivers) return;
  const ref = DATA.stations.find((s) => s.code === FOCUS_STATION);
  const refUp = ref ? (ref.drained ??= drainedAt(ref)) : null;
  for (const s of DATA.stations) {
    if (s.flowEst != null) continue;
    s.drained = s.drained ?? drainedAt(s);
    s.flowEst = refUp && s.drained
      ? Math.max(0.05, Math.round(DEFAULT_CONDITIONS.designFlow * (s.drained / refUp) * 100) / 100)
      : DEFAULT_CONDITIONS.designFlow;
  }
}

/* How the estimate was arrived at, for the flag that sits on it */
export function flowBasis(st) {
  if (!st?.drained) return 'An estimate, not yet checked against a gauged record.';
  return st.code === FOCUS_STATION
    ? 'MAM7 low-flow estimate for Dengkil, not yet checked against the DID gauged record (station 2816441).'
    : `Scaled from Dengkil's 4.5 m³/s by mapped channel length draining to this station `
      + `(${(st.drained / 1000).toFixed(0)} km). An estimate, to be replaced with the DID gauged record.`;
}

/* ---- Which station a licence counts at ----
   A licence discharges to one place, and the budget it belongs in is the
   one written for the nearest monitoring station to it — unless the
   register says another. A licence with no position counts nowhere, and
   the register says so. */
export function stationForLicence(l) {
  if (l.station && DATA.stations.some((s) => s.code === l.station)) return l.station;
  if (typeof l.lat !== 'number' || typeof l.lon !== 'number') return null;
  const k = Math.cos((l.lat * Math.PI) / 180);
  let best = null, bd = Infinity;
  for (const s of DATA.stations) {
    const d = (s.lat - l.lat) ** 2 + ((s.lon - l.lon) * k) ** 2;
    if (d < bd) { bd = d; best = s.code; }
  }
  return best;
}

export function licencesAt(code) {
  return store.licences().filter((l) => stationForLicence(l) === code);
}

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
/* No wetland group. The source classification covers seasonally inundated and
   converted land, so on this catchment it resolved to twelve unnamed polygons
   — two of them 374 and 111 ha — lying over what the imagery shows as planted
   estate. Drawing that as a water body claims a receiving water where there is
   no open water, and at the zoom the map is read at it covered the features
   that are real. scripts/02 drops it too, so a rebuild agrees. */
export const WATER_GROUPS = {
  treatment: { label: 'Treatment & oxidation basins', color: '#4a3aa7',
    note: 'Wastewater ponds and settling basins \u2014 assets that sit between a discharge and the river.' },
  storage:   { label: 'Lakes & reservoirs', color: '#0aa3d9',
    note: 'Standing water that stores and slowly releases whatever load reaches it.' },
  pond:      { label: 'Ponds', color: '#45bfe0',
    note: 'Mostly ex-mining and detention ponds across the Langat floodplain.' },
  channel:   { label: 'Mapped channel surface', color: '#3c8fb5',
    note: 'The river and stream surface itself within the reach.' },
  other:     { label: 'Other open water', color: '#8b93a8',
    note: 'Water bodies with no type recorded in the source data.' },
};

/* ============================================================
   Point sources — what can put a load into the river
   Source: OpenStreetMap, clipped to the catchment and the riparian zone
   by scripts/08_build_pollution_sources.py.
   ============================================================ */
export function sourceSummary() {
  const meta = DATA.sources?.meta ?? {};
  const cats = meta.categories ?? {};
  const feats = DATA.sources?.features ?? [];
  const groups = {};
  for (const key of Object.keys(cats)) groups[key] = { n: 0, near: 0, risk: 0 };
  for (const f of feats) {
    const g = groups[f.properties.cat];
    if (!g) continue;
    g.n++;
    g.risk += f.properties.risk;
    if (f.properties.dist <= 250) g.near++;
  }
  return {
    cats, groups, features: feats,
    count: feats.length,
    bufferM: meta.buffer_m ?? 1500,
    near: feats.filter((f) => f.properties.dist <= 250).length,
  };
}

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
