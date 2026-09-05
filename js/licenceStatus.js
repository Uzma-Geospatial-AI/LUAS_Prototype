/* ============================================================
   licenceStatus.js — Whether a point source holds a discharge licence

   No LUAS licence register is published as open data, so for the 651
   mapped premises the status is ESTIMATED: a deterministic draw per site,
   weighted by how likely that kind of premises is to be licensed at all.
   Sewage works nearly always are; a construction site rarely is. The
   figures are an assumption, not a record, and every readout says so.

   Two rules sit above the estimate:
     · a premises with an entry in the SESAMS register takes its status
       from the register — active means licensed, suspended means not;
     · the estimate comes from the premises id, so a site keeps its colour
       between reloads and between two people looking at the same map.
   ============================================================ */
import { store } from './store.js';

/* Share of premises in each category assumed to hold a licence */
export const LICENSED_SHARE = {
  kumbahan: 0.85,     // sewage and water treatment works
  sisa:     0.70,     // landfill, quarry and waste
  industri: 0.60,     // industry and factories
  ternakan: 0.40,     // farms and aquaculture
  tanah:    0.30,     // construction and cleared land
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

/* What the map should say about one premises.
   Returns { licensed, estimated, licence } where `licence` is the register
   entry when one exists (worked examples included), else null. */
export function licenceStatus(id, cat) {
  const l = store.licences().find((x) => x.srcId === id);
  if (l) return { licensed: l.active !== false, estimated: false, licence: l };
  return { licensed: estimatedLicensed(id, cat), estimated: true, licence: null };
}
