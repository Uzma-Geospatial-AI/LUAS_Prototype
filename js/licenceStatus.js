/* ============================================================
   licenceStatus.js — Whether a point source holds a discharge licence

   No LUAS licence register is published as open data, so for the 651
   mapped premises the status is ESTIMATED: a deterministic draw per site,
   weighted by how likely that kind of premises is to be licensed at all.
   Sewage works nearly always are; a construction site never is here, because
   its run-off is a diffuse load the TMDL accounts for on the other side of
   the budget, not an outfall with a permit on it. The figures are an
   assumption, not a record, and every readout says so.

   The estimate is not read directly by the map. It decides which premises
   get an estimated licence in the register (js/examples.js), and the map
   reads the register — so the map and the register can never disagree
   about the same place, and "Clear examples" turns every symbol red at
   once. The draw comes from the premises id, so a site keeps its colour
   between reloads and between two people looking at the same map.
   ============================================================ */
import { store } from './store.js';

/* Share of premises in each category assumed to hold a licence */
export const LICENSED_SHARE = {
  kumbahan: 0.85,     // sewage and water treatment works
  sisa:     0.70,     // landfill, quarry and waste
  industri: 0.60,     // industry and factories
  ternakan: 0.40,     // farms and aquaculture
  tanah:    0,        // construction: run-off, not an outfall — never licensed here
};

/* A small integer hash so the draw is stable for a given id */
function unit(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 10000) / 10000;
}

/* The estimate on its own, ignoring the register */
export function estimatedLicensed(id, cat) {
  return unit(id) < (LICENSED_SHARE[cat] ?? 0.5);
}

/* What the map should say about one premises. The register is the only
   source: active entry means licensed, suspended or absent means not.
   Returns { licensed, estimated, licence } — `licence` is the register entry
   when one exists (estimated ones included), else null, and `estimated`
   says whether an absence is the estimate's doing or the register's. */
export function licenceStatus(id) {
  const l = store.licences().find((x) => x.srcId === id);
  if (l) return { licensed: l.active !== false, estimated: !!l.bulk, licence: l };
  return { licensed: false, estimated: store.hasExamples(), licence: null };
}
