/* ============================================================
   store.js — Browser-local store for user-entered data

   This portal is a static site with no backend, so entries live in
   localStorage and belong to one browser only. Export writes files
   that match the shipped data schemas so entries can be merged into
   data/stations.json and data/pollution_sources.geojson.
   ============================================================ */

const KEY = 'luas-wqi-entries-v1';

const EMPTY = { readings: [], sources: [] };

let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...EMPTY, ...JSON.parse(raw) } : structuredClone(EMPTY);
  } catch {
    cache = structuredClone(EMPTY);   // private mode, blocked storage, corrupt value
  }
  return cache;
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* Storage unavailable or full — entries stay in memory for this session. */
  }
  document.dispatchEvent(new CustomEvent('userdata'));
}

const uid = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const store = {
  all: () => read(),
  readings: () => read().readings,
  sources: () => read().sources,
  count: () => read().readings.length + read().sources.length,

  addReading(r) {
    read().readings.push({ id: uid(), created: new Date().toISOString(), ...r });
    write();
  },

  addSource(s) {
    read().sources.push({ id: uid(), created: new Date().toISOString(), ...s });
    write();
  },

  removeReading(id) {
    cache.readings = read().readings.filter((r) => r.id !== id);
    write();
  },

  removeSource(id) {
    cache.sources = read().sources.filter((s) => s.id !== id);
    write();
  },

  clear() {
    cache = structuredClone(EMPTY);
    write();
  },

  /* Merge an imported payload; returns how many records were added. */
  merge(payload) {
    const d = read();
    let n = 0;
    const seen = new Set([...d.readings, ...d.sources].map((x) => x.id));

    const takeReading = (r) => {
      if (!r || typeof r.t !== 'string' || !r.station) return;
      const id = r.id && !seen.has(r.id) ? r.id : uid();
      d.readings.push({ ...r, id });
      seen.add(id); n++;
    };
    const takeSource = (s) => {
      if (!s || typeof s.lat !== 'number' || typeof s.lon !== 'number') return;
      const id = s.id && !seen.has(s.id) ? s.id : uid();
      d.sources.push({ ...s, id });
      seen.add(id); n++;
    };

    if (Array.isArray(payload?.readings)) payload.readings.forEach(takeReading);
    if (Array.isArray(payload?.sources)) payload.sources.forEach(takeSource);

    /* A GeoJSON FeatureCollection of reported sources */
    if (payload?.type === 'FeatureCollection') {
      for (const f of payload.features ?? []) {
        const c = f.geometry?.coordinates;
        if (!Array.isArray(c)) continue;
        takeSource({ ...f.properties, lat: c[1], lon: c[0] });
      }
    }

    /* A stations.json-shaped payload */
    if (Array.isArray(payload?.stations)) {
      for (const st of payload.stations) {
        for (const rec of st.series ?? []) {
          takeReading({
            ...rec,
            station: st.code,
            stationName: st.name,
            lat: st.lat, lon: st.lon,
            river: st.river, district: st.district, segment: st.segment,
          });
        }
      }
    }

    if (n) write();
    return n;
  },
};

/* ---------------- Export helpers ---------------- */

/* Readings grouped by station, matching the data/stations.json schema. */
export function readingsAsStationsJson() {
  const byStation = new Map();
  for (const r of store.readings()) {
    if (!byStation.has(r.station)) {
      byStation.set(r.station, {
        code: r.station,
        name: r.stationName ?? r.station,
        lat: r.lat, lon: r.lon,
        district: r.district ?? '',
        segment: r.segment ?? 'tengah',
        river: r.river ?? 'Sungai Langat',
        series: [],
      });
    }
    byStation.get(r.station).series.push({
      t: r.t, do: r.do, bod: r.bod, cod: r.cod, ss: r.ss, an: r.an, ph: r.ph,
      ...(r.temp != null ? { temp: r.temp } : {}),
    });
  }
  const stations = [...byStation.values()];
  for (const s of stations) s.series.sort((a, b) => a.t.localeCompare(b.t));
  const months = [...new Set(store.readings().map((r) => r.t))].sort();
  return {
    meta: {
      generated: new Date().toISOString().slice(0, 10),
      note: 'User-entered readings exported from the LUAS WQI portal. Merge into data/stations.json.',
      parameters: ['do', 'bod', 'cod', 'ss', 'an', 'ph'],
      months,
    },
    stations,
  };
}

/* Reported sources as GeoJSON, matching data/pollution_sources.geojson. */
export function sourcesAsGeoJson() {
  return {
    type: 'FeatureCollection',
    name: 'reported_pollution_sources',
    meta: {
      generated: new Date().toISOString().slice(0, 10),
      note: 'User-reported sources exported from the LUAS WQI portal. Merge into data/pollution_sources.geojson.',
    },
    features: store.sources().map((s) => ({
      type: 'Feature',
      properties: {
        id: s.id, cat: s.cat, name: s.name,
        dist: s.dist, risk: s.risk,
        district: s.district, note: s.note,
        reported: s.created,
      },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    })),
  };
}

export function readingsAsCsv() {
  const head = ['station', 'station_name', 'lat', 'lon', 'river', 'district',
    'month', 'do_mgl', 'bod_mgl', 'cod_mgl', 'ss_mgl', 'nh3n_mgl', 'ph', 'temp_c', 'wqi', 'class'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = store.readings().map((r) => [
    r.station, r.stationName, r.lat, r.lon, r.river, r.district,
    r.t, r.do, r.bod, r.cod, r.ss, r.an, r.ph, r.temp, r.wqi, r.wqiClass,
  ].map(esc).join(','));
  return [head.join(','), ...rows].join('\n');
}

/* Trigger a file download in the browser. */
export function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
