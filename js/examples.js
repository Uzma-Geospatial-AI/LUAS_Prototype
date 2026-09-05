/* ============================================================
   examples.js — Worked example licences, and the figures behind them

   The register ships with a handful of curated licences so the load budget
   has something to account for on a first visit — and, since 2026-09-06,
   with an ESTIMATED licence for every other premises the map colours green
   (js/licenceStatus.js decides which). The map reads the register, so the
   green symbols and the register rows are the same list by construction. They used to be five invented
   premises with invented names, which meant nothing on the map corresponded
   to them and the map's "Licensed premises" count read zero.

   They are now built from premises that are actually in the catchment: real
   OSM sites with real coordinates, so each one draws on the map, the budget
   adds up against something a reader can go and look at, and picking that
   premises in the form shows the same figures the register already lists.

       WHAT IS REAL AND WHAT IS NOT

   The premises, its name, its category and its position are real. The licence
   reference, the permitted flow and the four permitted concentrations are
   NOT — no LUAS licence register is published as open data, so there is
   nothing to take them from. Every row is flagged `example: true`, badged
   EXAMPLE in the register, and the register carries a standing warning.

   Nothing adverse is asserted about any of them: every example is active and
   within its standard. Inventing a breach, or a decommissioning, against a
   named real business would be a claim about that business, and a badge on
   the row is not enough to undo it.

       DETERMINISTIC

   The figures come from the premises id, so they never move between reloads,
   and the same function fills the form when that premises is picked. If the
   two were generated separately the register and the form would disagree
   about the same licence, which is worse than either number being invented.
   ============================================================ */
import { sourceSummary } from './data.js';
import { LOAD_PARAMS } from './wqi.js';
import { EFFLUENT_STANDARDS } from './loads.js';
import { estimatedLicensed } from './licenceStatus.js';

/* m3/day, a plausible middle for the category */
export const FLOW_BASE = {
  kumbahan: 12000,           // sewage and water treatment works
  industri: 1200,            // an industrial premises
  ternakan: 600,             // farms and aquaculture
  sisa: 400,                 // landfill, quarry, waste handling
  tanah: 250,                // construction and cleared land
};

/* The estimated bulk is a different population from the five curated
   examples: the typical premises on this floodplain is a package plant, a
   workshop or a smallholding, not a regional works. Its flow is drawn on a
   log scale — a third to three times this — so most rows are small and a few
   are not, which is what a real register looks like. Sized so that the whole
   estimated register commits roughly half the reach's allocable BOD load:
   enough to matter, not enough to declare the river closed on first visit. */
const BULK_BASE = {
  kumbahan: 200,
  industri: 60,
  ternakan: 40,
  sisa: 50,
  tanah: 30,
};

/* The five curated picks, by premises id — highest screening risk with a
   name, per category. Memoised once the sources are in; they are what the
   register shows first and what keeps the full-size figures. */
let curated = null;
function curatedIds() {
  if (curated) return curated;
  const feats = sourceSummary().features ?? [];
  if (!feats.length) return new Set();
  curated = new Set(curatedPicks(feats).map((f) => f.properties.id));
  return curated;
}
function curatedPicks(feats) {
  const out = [];
  for (const [cat, n] of Object.entries(TAKE)) {
    out.push(...feats
      .filter((f) => f.properties.cat === cat && f.properties.name)
      .sort((a, b) => b.properties.risk - a.properties.risk
        || String(a.properties.id).localeCompare(String(b.properties.id)))
      .slice(0, n));
  }
  return out;
}

/* The register groups by category, so the source category maps onto one */
export const CAT_LABEL = {
  kumbahan: 'Sewage treatment',
  industri: 'Industrial',
  ternakan: 'Agro-industry',
  sisa: 'Waste',
  tanah: 'Construction',
};

export function hash(seed, salt) {
  let h = (Number(seed) % 2147483647) ^ (salt * 2654435761);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;      /* 0..1 */
}

/* A permitted concentration sits under its limit, so the placeholder does too
   — 55% to 95% of it. One that breached its own standard on arrival would be
   a strange thing to hand someone. */
export function prefillFor(props, stdKey) {
  const std = EFFLUENT_STANDARDS[stdKey] ?? EFFLUENT_STANDARDS.A;
  const bulk = !curatedIds().has(props.id);
  const flow = bulk
    ? Math.max(10, Math.round((BULK_BASE[props.cat] ?? 40)
        * Math.pow(10, -0.5 + hash(props.id, 1)) / 10) * 10)
    : Math.round((FLOW_BASE[props.cat] ?? 1000) * (0.5 + 1.5 * hash(props.id, 1)) / 50) * 50;
  const conc = {};
  LOAD_PARAMS.forEach((param, i) => {
    conc[param] = Math.round(std[param] * (0.55 + 0.4 * hash(props.id, i + 2)) * 10) / 10;
  });
  /* A reference too, so the record is complete on arrival. The year is the
     record's, not today's, so a reference does not change with the calendar. */
  const year = 2020 + Math.floor(hash(props.id, 9) * 6);
  const serial = String(1 + Math.floor(hash(props.id, 10) * 9998)).padStart(4, '0');
  return { flow, conc, ref: `LUAS/EL/${year}/${serial}` };
}

/* How many examples to take from each category.

   Construction and cleared land is deliberately absent. It is a diffuse
   problem — run-off across a surface — which the budget accounts for on the
   load allocation side, not an outfall with a meter on it. Giving a
   construction site a discharge licence with a permitted flow would put it in
   the wrong half of the TMDL. */
const TAKE = { industri: 2, kumbahan: 1, sisa: 1, ternakan: 1 };

export function buildExamples() {
  const su = sourceSummary();
  const feats = su.features ?? [];
  const cats = su.cats ?? {};
  const out = [];

  const row = (f, extra) => {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const { flow, conc, ref } = prefillFor(p, 'A');
    return {
      id: `ex-${p.id}`,
      ref,
      premises: p.name ?? `Unnamed ${(cats[p.cat]?.label ?? 'premises').toLowerCase()} site`,
      category: CAT_LABEL[p.cat] ?? 'Industrial',
      standard: 'A',
      flow,
      conc,
      srcId: p.id,
      lat,
      lon,
      active: true,
      estimated: true,
      example: true,
      ...extra,
    };
  };

  /* The curated five first: highest screening risk with a name, per
     category — the site closest to water; the id breaks ties so the pick
     never wobbles. */
  const picks = curatedPicks(feats);
  const taken = new Set(picks.map((f) => f.properties.id));
  for (const f of picks) out.push(row(f, {}));

  /* Then every other premises the estimate says is licensed, biggest
     screening risk first so the rows nearest the water lead. `bulk` marks
     them: badged ESTIMATED rather than EXAMPLE, and not ringed on the map. */
  feats
    .filter((f) => !taken.has(f.properties.id)
      && estimatedLicensed(f.properties.id, f.properties.cat))
    .sort((a, b) => b.properties.risk - a.properties.risk
      || String(a.properties.id).localeCompare(String(b.properties.id)))
    .forEach((f) => out.push(row(f, { bulk: true })));

  return out;
}
