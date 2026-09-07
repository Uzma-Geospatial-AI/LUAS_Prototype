/* ============================================================
   locations.js — Adding a monitoring location from the app bar

   The picker in the app bar is the one place a location is chosen, so it is
   also where one is added. The dialog asks for the details first — a code,
   a name, what kind of place it is, the water and district it sits in —
   then the position, and the station is drawn on the map at those
   coordinates and picked, so every page follows it.

   A location added here has no official record. Its series is whatever is
   saved for it from the Station Assessment calculator, one reading a month;
   until the first one it is drawn grey and every page says so. It lives in
   this browser, like the register, and goes out with the JSON export.
   ============================================================ */
import { DATA, refreshUserStations, setFocus } from './data.js';
import { store } from './store.js';
import { mapCentre } from './mapview.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => (v === '' || v == null ? NaN : Number(v));

export const KINDS = [
  ['river', 'River monitoring station'],
  ['lake', 'Lake or reservoir'],
  ['intake', 'Water intake'],
  ['outfall', 'Discharge point'],
  ['other', 'Other'],
];
export const SEGMENTS = [
  ['hulu', 'Upper reach (hulu)'],
  ['tengah', 'Middle reach (tengah)'],
  ['hilir', 'Lower reach (hilir)'],
  ['muara', 'Estuary (muara)'],
];
export const kindLabel = (k) => KINDS.find(([id]) => id === k)?.[1] ?? 'Location';

/* The code of the station being edited, or null while adding one */
let editing = null;

export function buildLocationDialog() {
  $('lcKind').innerHTML = KINDS.map(([id, lab]) => `<option value="${id}">${esc(lab)}</option>`).join('');
  $('lcSegment').innerHTML = SEGMENTS.map(([id, lab]) => `<option value="${id}">${esc(lab)}</option>`).join('');

  for (const id of ['lcCode', 'lcName', 'lcRiver', 'lcDistrict', 'lcLat', 'lcLon']) {
    $(id).addEventListener('input', check);
  }
  $('lcCentre').onclick = () => {
    const c = mapCentre();
    if (!c) {
      $('lcPosHint').textContent = 'Open the map first, so there is a centre to take.';
      return;
    }
    $('lcLat').value = c[0].toFixed(5);
    $('lcLon').value = c[1].toFixed(5);
    check();
  };
  $('lcSave').onclick = () => save(false);
  $('lcSaveShow').onclick = () => save(true);
  $('lcCancel').onclick = close;
  $('lcClose').onclick = close;
  $('lcBack').onclick = close;
  $('lcRemove').onclick = remove;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('locDialog').hidden) close();
  });
}

/* Open to add, or open on a station of the user's own to edit it */
export function openLocationDialog(st = null) {
  editing = st ? st.code : null;

  /* The rivers and districts already on the map, offered as they are typed */
  const uniq = (f) => [...new Set(DATA.stations.map(f).filter(Boolean))].sort();
  $('lcRivers').innerHTML = uniq((s) => s.river).map((v) => `<option value="${esc(v)}">`).join('');
  $('lcDistricts').innerHTML = uniq((s) => s.district).map((v) => `<option value="${esc(v)}">`).join('');

  $('lcHead').textContent = st ? `Edit ${st.code}` : 'New location';
  $('lcCode').value = st ? st.code : nextCode();
  $('lcCode').disabled = !!st;       /* the code is what its readings are filed under */
  $('lcName').value = st?.name ?? '';
  $('lcKind').value = st?.kind ?? 'river';
  $('lcRiver').value = st?.river ?? 'Sungai Langat';
  $('lcDistrict').value = st?.district ?? '';
  $('lcSegment').value = st?.segment ?? 'tengah';
  $('lcLat').value = st?.lat ?? '';
  $('lcLon').value = st?.lon ?? '';
  $('lcNote').value = st?.note ?? '';
  $('lcRemove').hidden = !st;
  $('lcPosHint').textContent = 'Decimal degrees. The station is drawn on the map here, and every page follows it once picked.';

  $('locDialog').hidden = false;
  document.body.classList.add('modal-open');
  check();
  $(st ? 'lcName' : 'lcCode').focus();
}

function close() {
  editing = null;
  $('locDialog').hidden = true;
  document.body.classList.remove('modal-open');
}

function nextCode() {
  let n = 1;
  const code = () => `NEW${String(n).padStart(2, '0')}`;
  while (DATA.stations.some((s) => s.code === code())) n += 1;
  return code();
}

/* The record as typed, or the reason it is not one yet */
function read() {
  const code = $('lcCode').value.trim().toUpperCase();
  const name = $('lcName').value.trim();
  const river = $('lcRiver').value.trim();
  const district = $('lcDistrict').value.trim();
  const lat = num($('lcLat').value);
  const lon = num($('lcLon').value);

  if (!/^[A-Z0-9][A-Z0-9_-]{1,11}$/.test(code)) return { why: 'A code of 2–12 letters and digits is needed.' };
  if (!editing && DATA.stations.some((s) => s.code === code)) return { why: `${code} is already a station.` };
  if (!name) return { why: 'A name is needed.' };
  if (!river) return { why: 'The river or water it sits on is needed.' };
  if (!district) return { why: 'A district is needed.' };
  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) {
    return { why: 'A latitude and a longitude are needed, in decimal degrees.' };
  }
  const rec = {
    code, name, kind: $('lcKind').value, river, district, segment: $('lcSegment').value,
    lat, lon, note: $('lcNote').value.trim(),
  };
  /* Selangor, roughly. Outside it the coordinates are more likely wrong
     than the station is, but it is a warning, not a bar. */
  const outside = lat < 2.5 || lat > 3.95 || lon < 100.7 || lon > 102.1;
  return { rec, warn: outside, why: outside ? 'Outside Selangor — check the coordinates. It can still be saved.' : '' };
}

function check() {
  const r = read();
  $('lcSave').disabled = !r.rec;
  $('lcSaveShow').disabled = !r.rec;
  const h = $('lcHint');
  h.textContent = r.why || (r.rec ? 'Ready to save.' : '');
  h.className = `hint${r.rec ? (r.warn ? ' err' : ' ok') : ''}`;
}

function save(show) {
  const r = read();
  if (!r.rec) return;
  const was = editing;
  close();
  if (was) store.updateStation(was, r.rec);
  else store.addStation(r.rec);
  refreshUserStations();
  document.dispatchEvent(new CustomEvent('stationschange'));
  /* Picked, so every page follows it. setFocus fires the store's change;
     when it is already the focus, fire it here so the pages redraw. */
  if (!setFocus(r.rec.code)) document.dispatchEvent(new CustomEvent('storechange'));
  if (show) {
    document.dispatchEvent(new CustomEvent('showonmap', { detail: { station: r.rec.code } }));
  }
}

function remove() {
  const st = DATA.stations.find((s) => s.code === editing);
  if (!st) return;
  const n = store.readings().filter((r) => r.station === st.code).length;
  const kept = n ? ` Its ${n} saved reading${n === 1 ? '' : 's'} stay in this browser's records.` : '';
  if (!confirm(`Remove ${st.code} · ${st.name} from the map and the picker?${kept}`)) return;
  close();
  store.removeStation(st.code);
  refreshUserStations();
  document.dispatchEvent(new CustomEvent('stationschange'));
  /* The focus has moved off it; say so in the store, so a reload agrees */
  store.setConditions({ focusStation: DATA.focus.code });
}
