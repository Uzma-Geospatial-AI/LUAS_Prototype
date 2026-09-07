/* ============================================================
   store.js — Browser-local store

   Holds what the portal lets a user edit:
     · readings  — six-parameter sampling records entered in Phase 1
     · licences  — the effluent discharge licence register used in Phase 3
     · tmdls     — the TMDLs written in Phase 3, one or more per location
     · stations  — monitoring locations added from the app bar
     · cond      — which station every page is written for

   There is no backend, so everything lives in localStorage and belongs to
   one browser. Export writes files that can be committed into data/.
   ============================================================ */
import { DEFAULT_CONDITIONS } from './loads.js';

const KEY = 'luas-system-v2';
const EMPTY = { readings: [], licences: [], tmdls: [], tmdlPick: {}, stations: [], cond: null, examplesCleared: false };

let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...structuredClone(EMPTY), ...JSON.parse(raw) } : structuredClone(EMPTY);
  } catch {
    cache = structuredClone(EMPTY);      // private mode, blocked storage, corrupt value
  }
  /* Older stores predate these keys */
  cache.tmdls ??= [];
  cache.tmdlPick ??= {};
  cache.stations ??= [];
  return cache;
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable — entries stay in memory for this session */
  }
  document.dispatchEvent(new CustomEvent('storechange'));
}

const uid = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ============================================================
   Seed register

   No real LUAS licence register is published, so the portal ships a small
   worked example. Every seeded row is flagged `example: true` and is badged
   in the UI; "Clear examples" removes them for good.
   ============================================================ */
/* Filled once the point sources have loaded — see js/examples.js. Empty until
   then, which only matters for the moment before the first render. */
let examples = [];
export const setExamples = (list) => { examples = Array.isArray(list) ? list : []; };
export const exampleLicences = () => examples;

/* One worked TMDL per station, built from the monitoring record and the
   register once both are in — see js/examples.js. */
let tmdlExamples = [];
export const setTmdlExamples = (list) => { tmdlExamples = Array.isArray(list) ? list : []; };

export const store = {
  /* ---------------- Design conditions ----------------
     The station is the one thing stored here. The target class and the
     design flow every page reads come from the TMDL on record for that
     station, so the app bar, the assessment and the budget cannot disagree
     about what the water is being held to. Without a record, the defaults. */
  conditions() {
    const stored = read().cond ?? {};
    const base = { ...DEFAULT_CONDITIONS, focusStation: stored.focusStation ?? DEFAULT_CONDITIONS.focusStation };
    const t = store.activeTmdl(base.focusStation);
    if (t) {
      base.targetClass = t.targetClass ?? base.targetClass;
      base.designFlow = Number(t.designFlow) || base.designFlow;
      base.flowVerified = !!t.flowVerified;
    }
    return base;
  },
  setConditions(patch) {
    read().cond = { ...(cache.cond ?? {}), ...patch };
    write();
  },
  resetConditions() {
    read().cond = null;
    write();
  },

  /* ---------------- TMDL records ----------------
     A location can hold several — a revision a year, say. The user's own
     come first, newest first, then the worked example. Which one the page
     shows is remembered per location. */
  setTmdlExamples,
  tmdls: () => [...read().tmdls, ...tmdlExamples],
  userTmdls: () => read().tmdls,
  tmdlsFor(code) {
    return store.tmdls().filter((t) => t.station === code);
  },
  activeTmdl(code) {
    const list = store.tmdlsFor(code);
    if (!list.length) return null;
    const pick = read().tmdlPick[code];
    return list.find((t) => t.id === pick) ?? list.find((t) => !t.example) ?? list[0];
  },
  pickTmdl(code, id) {
    read().tmdlPick[code] = id;
    write();
  },
  addTmdl(t) {
    const now = new Date().toISOString();
    const rec = { id: uid(), created: now, updated: now, ...t, example: false };
    read().tmdls.unshift(rec);
    cache.tmdlPick[rec.station] = rec.id;
    write();
    return rec;
  },
  updateTmdl(id, patch) {
    const d = read();
    const i = d.tmdls.findIndex((t) => t.id === id);
    if (i < 0) return false;
    d.tmdls[i] = { ...d.tmdls[i], ...patch, example: false, updated: new Date().toISOString() };
    write();
    return true;
  },
  removeTmdl(id) {
    const d = read();
    const gone = d.tmdls.find((t) => t.id === id);
    d.tmdls = d.tmdls.filter((t) => t.id !== id);
    if (gone && d.tmdlPick[gone.station] === id) delete d.tmdlPick[gone.station];
    write();
  },

  /* ---------------- Locations added from the app bar ---------------- */
  stations: () => read().stations,
  addStation(st) {
    read().stations.push({ ...st, added: new Date().toISOString() });
    write();
  },
  updateStation(code, patch) {
    const d = read();
    const i = d.stations.findIndex((s) => s.code === code);
    if (i < 0) return false;
    d.stations[i] = { ...d.stations[i], ...patch, code };
    write();
    return true;
  },
  removeStation(code) {
    const d = read();
    d.stations = d.stations.filter((s) => s.code !== code);
    write();
  },

  /* ---------------- Licence register ---------------- */
  /* The worked examples are premises taken off the map, so they arrive once
     the point sources have loaded rather than being written in here. */
  setExamples,
  exampleLicences,

  licences() {
    const d = read();
    if (d.examplesCleared) return d.licences;
    /* One premises, one licence. A real licence entered against a premises
       supersedes the example on it, rather than both counting into the
       wasteload and billing that site twice. */
    const taken = new Set(d.licences.map((l) => l.srcId).filter((x) => x != null));
    return [...examples.filter((e) => !taken.has(e.srcId)), ...d.licences];
  },
  userLicences: () => read().licences,
  hasExamples: () => !read().examplesCleared,

  addLicence(l) {
    read().licences.push({ id: uid(), created: new Date().toISOString(), active: true, ...l });
    write();
  },
  updateLicence(id, patch) {
    const d = read();
    const i = d.licences.findIndex((l) => l.id === id);
    if (i < 0) return false;
    d.licences[i] = { ...d.licences[i], ...patch };
    write();
    return true;
  },
  removeLicence(id) {
    cache = read();
    cache.licences = cache.licences.filter((l) => l.id !== id);
    write();
  },
  clearExamples() {
    read().examplesCleared = true;
    write();
  },
  restoreExamples() {
    read().examplesCleared = false;
    write();
  },

  /* ---------------- Sampling records ---------------- */
  readings: () => read().readings,
  addReading(r) {
    read().readings.push({ id: uid(), created: new Date().toISOString(), ...r });
    write();
  },
  removeReading(id) {
    cache = read();
    cache.readings = cache.readings.filter((r) => r.id !== id);
    write();
  },

  clearAll() {
    cache = structuredClone(EMPTY);
    write();
  },

  /* ---------------- Import ---------------- */
  merge(payload) {
    const d = read();
    let n = 0;
    if (Array.isArray(payload?.licences)) {
      for (const l of payload.licences) {
        if (!l || typeof l.flow !== 'number') continue;
        d.licences.push({ ...l, id: uid(), example: false });
        n++;
      }
    }
    if (Array.isArray(payload?.tmdls)) {
      for (const t of payload.tmdls) {
        if (!t || typeof t.station !== 'string' || typeof t.alloc !== 'object') continue;
        d.tmdls.unshift({ ...t, id: uid(), example: false });
        n++;
      }
    }
    if (Array.isArray(payload?.stations)) {
      for (const st of payload.stations) {
        if (!st || typeof st.code !== 'string' || typeof st.lat !== 'number' || typeof st.lon !== 'number') continue;
        if (d.stations.some((x) => x.code === st.code)) continue;
        d.stations.push({ ...st });
        n++;
      }
    }
    if (Array.isArray(payload?.readings)) {
      for (const r of payload.readings) {
        if (!r || typeof r.t !== 'string') continue;
        d.readings.push({ ...r, id: uid() });
        n++;
      }
    }
    if (payload?.cond?.focusStation) { d.cond = { ...(d.cond ?? {}), focusStation: payload.cond.focusStation }; n++; }
    if (n) write();
    return n;
  },
};

/* ---------------- Export helpers ---------------- */
export function registerAsJson() {
  return {
    meta: {
      generated: new Date().toISOString().slice(0, 10),
      system: 'LUAS · LEDS effluent discharge licence register and TMDLs',
      note: 'Rows marked example:true are the shipped worked example, not real licences. '
        + 'tmdls holds the TMDLs written in this browser; each is TMDL = ΣWLA + ΣLA + MOS in kg/day per pollutant.',
      conditions: store.conditions(),
    },
    stations: store.stations(),
    tmdls: store.userTmdls(),
    licences: store.licences(),
    readings: store.readings(),
  };
}

export function registerAsCsv() {
  const head = ['licence_ref', 'premises', 'category', 'standard', 'status',
    'flow_m3_day', 'bod_mgl', 'cod_mgl', 'ss_mgl', 'nh3n_mgl',
    'bod_kg_day', 'cod_kg_day', 'ss_kg_day', 'nh3n_kg_day', 'is_example'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const load = (c, q) => ((c ?? 0) * (q ?? 0) / 1000).toFixed(2);
  const rows = store.licences().map((l) => [
    l.ref, l.premises, l.category, l.standard, l.active === false ? 'inactive' : 'active',
    l.flow, l.conc?.bod, l.conc?.cod, l.conc?.ss, l.conc?.an,
    load(l.conc?.bod, l.flow), load(l.conc?.cod, l.flow),
    load(l.conc?.ss, l.flow), load(l.conc?.an, l.flow),
    l.example ? 'yes' : 'no',
  ].map(esc).join(','));
  return [head.join(','), ...rows].join('\n');
}

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
