/* ============================================================
   store.js — Browser-local store

   Holds two things the portal lets a user edit:
     · readings  — six-parameter sampling records entered in Phase 1
     · licences  — the SESAMS effluent discharge register used in Phase 3
     · cond      — the TMDL design conditions

   There is no backend, so everything lives in localStorage and belongs to
   one browser. Export writes files that can be committed into data/.
   ============================================================ */
import { DEFAULT_CONDITIONS } from './loads.js';

const KEY = 'luas-system-v2';
const EMPTY = { readings: [], licences: [], cond: null, examplesCleared: false };

let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...structuredClone(EMPTY), ...JSON.parse(raw) } : structuredClone(EMPTY);
  } catch {
    cache = structuredClone(EMPTY);      // private mode, blocked storage, corrupt value
  }
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

export const store = {
  /* ---------------- Design conditions ---------------- */
  conditions() {
    return { ...DEFAULT_CONDITIONS, ...(read().cond ?? {}) };
  },
  setConditions(patch) {
    read().cond = { ...(cache.cond ?? {}), ...patch };
    write();
  },
  resetConditions() {
    read().cond = null;
    write();
  },

  /* ---------------- Licence register (SESAMS) ---------------- */
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
    if (Array.isArray(payload?.readings)) {
      for (const r of payload.readings) {
        if (!r || typeof r.t !== 'string') continue;
        d.readings.push({ ...r, id: uid() });
        n++;
      }
    }
    if (payload?.cond) { d.cond = { ...(d.cond ?? {}), ...payload.cond }; n++; }
    if (n) write();
    return n;
  },
};

/* ---------------- Export helpers ---------------- */
export function registerAsJson() {
  return {
    meta: {
      generated: new Date().toISOString().slice(0, 10),
      system: 'LUAS · LEDS effluent discharge licence register (SESAMS)',
      note: 'Rows marked example:true are the shipped worked example, not real licences.',
      conditions: store.conditions(),
    },
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
