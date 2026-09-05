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
export const EXAMPLE_LICENCES = [
  { id: 'ex-1', ref: 'LUAS/EL/2023/0142', premises: 'IWK Regional STP — Bandar Baru Bangi',
    category: 'Sewage treatment', standard: 'A', flow: 24000,
    conc: { bod: 18, cod: 72, ss: 42, an: 8.5 }, active: true, example: true },
  { id: 'ex-2', ref: 'LUAS/EL/2022/0087', premises: 'Kawasan Perindustrian Dengkil — common effluent plant',
    category: 'Industrial', standard: 'A', flow: 6800,
    conc: { bod: 19, cod: 78, ss: 46, an: 9.2 }, active: true, example: true },
  { id: 'ex-3', ref: 'LUAS/EL/2024/0031', premises: 'Ladang kelapa sawit Sepang — mill effluent polishing',
    category: 'Agro-industry', standard: 'A', flow: 3200,
    conc: { bod: 16, cod: 68, ss: 38, an: 7.4 }, active: true, example: true },
  { id: 'ex-4', ref: 'LUAS/EL/2021/0219', premises: 'Loji rawatan air Sungai Labu — sludge washwater',
    category: 'Water treatment', standard: 'A', flow: 1900,
    conc: { bod: 8, cod: 34, ss: 48, an: 1.2 }, active: true, example: true },
  { id: 'ex-5', ref: 'LUAS/EL/2020/0154', premises: 'Taman perumahan Dengkil — communal STP (decommissioned)',
    category: 'Sewage treatment', standard: 'B', flow: 900,
    conc: { bod: 45, cod: 180, ss: 92, an: 17 }, active: false, example: true },
];

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
  licences() {
    const d = read();
    return d.examplesCleared ? d.licences : [...EXAMPLE_LICENCES, ...d.licences];
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
