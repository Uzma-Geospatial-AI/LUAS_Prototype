/* ============================================================
   entry.js — Data entry: water quality readings & pollution sources
   ============================================================ */
import { DATA, nearestWatercourse, districtOf, riskScore } from './data.js';
import { computeWQI, wqiClass, PARAM_META, paramStatus, siColor } from './wqi.js';
import { store, readingsAsStationsJson, sourcesAsGeoJson, readingsAsCsv, download } from './store.js';
import { sourceIcon, sourceSwatch } from './symbols.js';

let pickMap = null, pickMarker = null, ready = false;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => (v === '' || v == null ? NaN : Number(v));

/* Realistic mid-river values, used by "Fill sample values" */
const DEMO = { do: 5.2, bod: 4.0, cod: 30, ss: 70, an: 0.8, ph: 6.8 };

/* ============================================================
   Init
   ============================================================ */
export function initEntry() {
  if (ready) { pickMap?.invalidateSize(); return; }
  ready = true;

  buildParamFields();
  buildStationSelect();
  buildCategorySelect();
  buildPickMap();
  wireTabs();
  wireReadingForm();
  wireSourceForm();
  wireRecords();

  $('rDate').value = new Date().toISOString().slice(0, 7);
  document.addEventListener('userdata', renderRecords);
  updateReadingPreview();
  updateSourcePreview();
  renderRecords();
}

/* ============================================================
   Tabs
   ============================================================ */
function wireTabs() {
  $('entryTabs').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      $('entryTabs').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      document.querySelectorAll('#v-entry .tab-pane').forEach((p) => p.classList.remove('active'));
      $(`tab-${b.dataset.tab}`).classList.add('active');
      if (b.dataset.tab === 'source') setTimeout(() => pickMap?.invalidateSize(), 60);
    };
  });
}

/* ============================================================
   Water quality reading form
   ============================================================ */
function buildParamFields() {
  $('paramFields').innerHTML = Object.entries(PARAM_META).map(([k, m]) => `
    <div class="field">
      <label for="p_${k}">${m.name}${m.unit ? ` <span class="unit">${m.unit}</span>` : ''}</label>
      <input id="p_${k}" type="number" step="${m.step}" min="${m.min}" max="${m.max}"
             placeholder="${DEMO[k]}" inputmode="decimal">
      <div class="hint" id="h_${k}">${m.role}</div>
    </div>`).join('');
  Object.keys(PARAM_META).forEach((k) => {
    $(`p_${k}`).addEventListener('input', updateReadingPreview);
  });
  $('rTemp').addEventListener('input', updateReadingPreview);
}

function buildStationSelect() {
  $('rStation').innerHTML =
    DATA.stations.map((s) => `<option value="${s.code}">${s.code} · ${esc(s.name)}</option>`).join('') +
    '<option value="__new__">➕ Add a new station…</option>';
  $('rStation').onchange = () => {
    const isNew = $('rStation').value === '__new__';
    $('newStationBox').style.display = isNew ? 'block' : 'none';
    $('rStationHint').textContent = isNew
      ? 'Enter the details of the new station. Coordinates should sit on the river channel.'
      : 'Choose an existing station, or add a new one.';
    updateReadingPreview();
  };
  ['rNewCode', 'rNewName', 'rNewLat', 'rNewLon'].forEach((id) =>
    $(id).addEventListener('input', updateReadingPreview));
}

/* Read the form; returns { ok, values, station, errors } */
function readReadingForm() {
  const errors = [];
  const vals = {};
  for (const [k, m] of Object.entries(PARAM_META)) {
    const el = $(`p_${k}`);
    const v = num(el.value);
    const bad = Number.isNaN(v) || v < m.min || v > m.max;
    el.classList.toggle('bad', el.value !== '' && bad);
    const hint = $(`h_${k}`);
    if (el.value !== '' && bad) {
      hint.textContent = `Enter a value between ${m.min} and ${m.max} ${m.unit}`.trim();
      hint.classList.add('err');
    } else if (!Number.isNaN(v)) {
      const st = paramStatus(k, v);
      hint.textContent = st === 'clean' ? 'Within the clean band'
        : st === 'slight' ? 'Slightly polluted band' : 'Polluted band';
      hint.classList.remove('err');
    } else {
      hint.textContent = m.role;
      hint.classList.remove('err');
    }
    if (Number.isNaN(v) || bad) errors.push(k); else vals[k] = v;
  }

  const temp = num($('rTemp').value);
  vals.temp = Number.isNaN(temp) ? 27 : temp;

  let station;
  if ($('rStation').value === '__new__') {
    const code = $('rNewCode').value.trim().toUpperCase();
    const name = $('rNewName').value.trim();
    const lat = num($('rNewLat').value), lon = num($('rNewLon').value);
    if (!code || !name || Number.isNaN(lat) || Number.isNaN(lon)) errors.push('station');
    station = {
      code, name, lat, lon,
      river: $('rNewRiver').value.trim() || 'Sungai Langat',
      segment: $('rNewSeg').value,
      district: Number.isNaN(lat) ? '' : (districtOf(lon, lat) ?? ''),
    };
  } else {
    const s = DATA.stations.find((x) => x.code === $('rStation').value);
    if (!s) errors.push('station');
    station = s && { code: s.code, name: s.name, lat: s.lat, lon: s.lon,
      river: s.river, segment: s.segment, district: s.district };
  }

  const t = $('rDate').value;
  if (!t) errors.push('date');

  return { ok: errors.length === 0, vals, station, t, errors };
}

function updateReadingPreview() {
  const { ok, vals, errors } = readReadingForm();
  const paramsIn = Object.keys(PARAM_META).filter((k) => !errors.includes(k));
  $('rSave').disabled = !ok;

  if (paramsIn.length < 6) {
    $('rPreview').innerHTML = `
      <div class="pv-empty">
        <b style="display:block;font-size:13px;color:var(--text);margin-bottom:7px">
          Live WQI preview</b>
        Enter all six parameters and the index appears here, together with each DOE sub-index.
        <div style="margin-top:12px;font-family:var(--fm);font-size:11px;color:var(--muted-2)">
          ${paramsIn.length} of 6 parameters entered
        </div>
      </div>`;
    return;
  }

  const { wqi, si, saturation } = computeWQI(vals);
  const c = wqiClass(wqi);
  $('rPreview').innerHTML = `
    <div class="pv-head" style="background:linear-gradient(130deg,${c.color},${shade(c.color, -30)})">
      <div class="pv-lab">Computed Water Quality Index</div>
      <div class="pv-val">${wqi.toFixed(1)}</div>
      <div class="pv-cls">${c.label} — ${c.status}</div>
      <div class="pv-use">${c.use}</div>
    </div>
    <div class="si-list">
      ${Object.keys(PARAM_META).map((k) => `
        <div class="si-item">
          <span class="si-n">${PARAM_META[k].short}</span>
          <span class="si-b"><i style="width:${si[k]}%;background:${siColor(si[k])}"></i></span>
          <span class="si-v" style="color:${siColor(si[k])}">${si[k].toFixed(0)}</span>
        </div>`).join('')}
    </div>
    <div style="padding:10px 15px 14px;border-top:1px solid var(--line);
      font-size:11px;color:var(--muted);line-height:1.55">
      DO saturation <b style="font-family:var(--fm)">${saturation.toFixed(1)}%</b> at
      ${vals.temp}°C. WQI = 0.22·DO + 0.19·BOD + 0.16·COD + 0.15·NH₃-N + 0.16·SS + 0.12·pH.
    </div>`;
}

function wireReadingForm() {
  $('rDate').addEventListener('input', updateReadingPreview);

  $('rDemo').onclick = () => {
    for (const [k, v] of Object.entries(DEMO)) $(`p_${k}`).value = v;
    updateReadingPreview();
  };

  $('rClear').onclick = () => {
    Object.keys(PARAM_META).forEach((k) => { $(`p_${k}`).value = ''; });
    $('rMsg').innerHTML = '';
    updateReadingPreview();
  };

  $('rSave').onclick = () => {
    const { ok, vals, station, t } = readReadingForm();
    if (!ok) return;
    const { wqi } = computeWQI(vals);
    store.addReading({
      station: station.code, stationName: station.name,
      lat: station.lat, lon: station.lon,
      river: station.river, district: station.district, segment: station.segment,
      t, ...vals,
      wqi, wqiClass: wqiClass(wqi).id,
    });
    flash('rMsg', `Saved · ${station.code} ${t} · WQI ${wqi.toFixed(1)}`);
  };
}

/* ============================================================
   Pollution source form
   ============================================================ */
function buildCategorySelect() {
  const cats = DATA.srcCats;
  $('sCat').innerHTML = Object.entries(cats)
    .map(([k, c]) => `<option value="${k}">${c.icon} ${esc(c.label)}</option>`).join('');
  const hint = () => {
    const c = cats[$('sCat').value];
    $('sCatHint').textContent = `Typical pollutants: ${c.pol}`;
  };
  $('sCat').onchange = () => {
    hint();
    const lat = num($('sLat').value), lon = num($('sLon').value);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) setPick(lat, lon, false);
    else updateSourcePreview();
  };
  hint();
}

function buildPickMap() {
  pickMap = L.map('pickMap', { center: [2.955, 101.63], zoom: 10, zoomControl: true });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Esri, Maxar' }).addTo(pickMap);
  L.geoJSON(DATA.river, { style: { color: '#f5e01c', weight: 2.4 } }).addTo(pickMap);
  L.geoJSON(DATA.tributaries, { style: { color: '#45bfe0', weight: 1, opacity: 0.65 } }).addTo(pickMap);
  L.geoJSON(DATA.districts, {
    style: { color: '#fff', weight: 1.6, dashArray: '6 4', fill: false, opacity: 0.75 },
  }).addTo(pickMap);

  pickMap.on('click', (e) => {
    setPick(e.latlng.lat, e.latlng.lng);
  });
  ['sLat', 'sLon'].forEach((id) => $(id).addEventListener('input', () => {
    const lat = num($('sLat').value), lon = num($('sLon').value);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) setPick(lat, lon, false);
    else updateSourcePreview();
  }));
  $('sName').addEventListener('input', updateSourcePreview);
}

function setPick(lat, lon, writeInputs = true) {
  if (writeInputs) {
    $('sLat').value = lat.toFixed(5);
    $('sLon').value = lon.toFixed(5);
  }
  if (pickMarker) pickMap.removeLayer(pickMarker);
  const catKey = $('sCat').value;
  pickMarker = L.marker([lat, lon], {
    icon: sourceIcon(catKey, DATA.srcCats[catKey]?.color ?? '#d92d20', 30),
  }).addTo(pickMap);
  updateSourcePreview();
}

function updateSourcePreview() {
  const lat = num($('sLat').value), lon = num($('sLon').value);
  const name = $('sName').value.trim();
  const valid = !Number.isNaN(lat) && !Number.isNaN(lon) && name.length > 0;
  $('sSave').disabled = !valid;

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    $('sPreview').innerHTML = `
      <div class="pv-empty">
        <b style="display:block;font-size:13px;color:var(--text);margin-bottom:7px">
          Location analysis</b>
        Click the map or type coordinates. The portal then measures the distance to the nearest
        watercourse, identifies the district and computes a risk score using the same formula as
        the main dataset.
      </div>`;
    return;
  }

  const cat = DATA.srcCats[$('sCat').value];
  const near = nearestWatercourse(lon, lat);
  const district = districtOf(lon, lat);
  const risk = riskScore($('sCat').value, near.dist);
  const rc = risk >= 4 ? '#d92d20' : risk >= 3 ? '#ef7d1a' : risk >= 2 ? '#f2c40c' : '#17a04a';
  const inZone = near.dist != null && near.dist <= 1500;

  $('sPreview').innerHTML = `
    <div class="pv-head" style="background:linear-gradient(130deg,${cat.color},${shade(cat.color, -30)})">
      <div class="pv-lab">Computed risk score</div>
      <div class="pv-val">${risk.toFixed(2)}</div>
      <div class="pv-cls" style="display:flex;align-items:center;justify-content:center;gap:7px">
        ${sourceSwatch($('sCat').value, '#fff', 17)}${esc(cat.label)}</div>
      <div class="pv-use">Category load ${cat.load}/5 weighted by proximity to water</div>
    </div>
    <div class="si-list" style="padding:8px 0">
      <div class="si-item"><span class="si-n">Nearest watercourse</span>
        <span class="si-v" style="min-width:70px">${near.dist != null ? `${near.dist} m` : '—'}</span></div>
      <div class="si-item"><span class="si-n">Watercourse name</span>
        <span class="si-v" style="min-width:70px;font-size:11px">${esc(near.name ?? 'unnamed')}</span></div>
      <div class="si-item"><span class="si-n">District</span>
        <span class="si-v" style="min-width:70px;font-size:11px">${esc(district ?? 'outside basin')}</span></div>
      <div class="si-item"><span class="si-n">Riparian zone (1.5 km)</span>
        <span class="si-v" style="min-width:70px;font-size:11px;color:${inZone ? '#17a04a' : '#8b93a8'}">
          ${inZone ? 'inside' : 'outside'}</span></div>
      <div class="si-item"><span class="si-n">Risk score</span>
        <span class="si-v" style="min-width:70px;color:${rc}">${risk.toFixed(2)} / 5</span></div>
    </div>
    <div style="padding:10px 15px 14px;border-top:1px solid var(--line);
      font-size:11px;color:var(--muted);line-height:1.55">
      ${district
        ? 'Inside the Langat River Basin districts, so this report will sit alongside the main dataset.'
        : '<b style="color:#b45309">Outside Hulu Langat, Sepang and Kuala Langat</b> — the report is still saved, but falls outside the basin scope of this portal.'}
    </div>`;
}

function wireSourceForm() {
  $('sClear').onclick = () => {
    ['sName', 'sLat', 'sLon', 'sNote'].forEach((id) => { $(id).value = ''; });
    if (pickMarker) { pickMap.removeLayer(pickMarker); pickMarker = null; }
    $('sMsg').innerHTML = '';
    updateSourcePreview();
  };

  $('sSave').onclick = () => {
    const lat = num($('sLat').value), lon = num($('sLon').value);
    const name = $('sName').value.trim();
    if (Number.isNaN(lat) || Number.isNaN(lon) || !name) return;
    const cat = $('sCat').value;
    const near = nearestWatercourse(lon, lat);
    store.addSource({
      name, cat, lat, lon,
      dist: near.dist, watercourse: near.name,
      district: districtOf(lon, lat),
      risk: riskScore(cat, near.dist),
      note: $('sNote').value.trim(),
    });
    flash('sMsg', `Saved · ${name}`);
  };
}

/* ============================================================
   Records tab
   ============================================================ */
function wireRecords() {
  $('expReadings').onclick = () =>
    download('luas-wqi-readings.json', JSON.stringify(readingsAsStationsJson(), null, 2));
  $('expSources').onclick = () =>
    download('luas-reported-sources.geojson', JSON.stringify(sourcesAsGeoJson(), null, 2),
      'application/geo+json');
  $('expCsv').onclick = () =>
    download('luas-wqi-readings.csv', readingsAsCsv(), 'text/csv');

  $('impFile').onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const n = store.merge(JSON.parse(await file.text()));
      alert(n ? `Imported ${n} record${n === 1 ? '' : 's'}.`
              : 'No recognisable records found in that file.');
    } catch (err) {
      alert(`Could not read that file: ${err.message}`);
    }
    e.target.value = '';
  };

  $('wipeAll').onclick = () => {
    if (store.count() === 0) return;
    if (confirm(`Delete all ${store.count()} saved entries from this browser? This cannot be undone.`)) {
      store.clear();
    }
  };
}

export function renderRecords() {
  const reads = store.readings();
  const srcs = store.sources();
  $('recCount').textContent = store.count();

  $('recReadings').innerHTML = reads.length ? reads.map((r) => {
    const { wqi } = computeWQI(r);
    const c = wqiClass(wqi);
    return `<tr>
      <td><b>${esc(r.t)}</b></td>
      <td>${esc(r.stationName ?? r.station)}<span style="color:var(--muted-2);margin-left:5px">${esc(r.station)}</span></td>
      <td class="num">${r.do}</td><td class="num">${r.bod}</td><td class="num">${r.cod}</td>
      <td class="num">${r.ss}</td><td class="num">${r.an}</td><td class="num">${r.ph}</td>
      <td class="num" style="font-weight:700;color:${c.color}">${wqi.toFixed(1)}</td>
      <td><span class="badge" style="background:${c.color}">${c.id}</span></td>
      <td><button class="btn btn-danger" style="padding:3px 9px;font-size:11px"
            data-del-read="${r.id}">Delete</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="11" style="color:var(--muted);padding:18px 13px">No readings saved yet.</td></tr>';

  $('recSources').innerHTML = srcs.length ? srcs.map((s) => {
    const cat = DATA.srcCats[s.cat] ?? { color: '#5f6880', label: s.cat, icon: '📍' };
    return `<tr>
      <td style="display:flex;align-items:center;gap:7px">
        ${sourceSwatch(s.cat, cat.color, 16)}<span>${esc(cat.label)}</span></td>
      <td><b>${esc(s.name)}</b></td>
      <td class="num">${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}</td>
      <td class="num">${s.dist ?? '—'}</td>
      <td style="font-size:11.5px;color:var(--muted);max-width:280px">${esc(s.note || '—')}</td>
      <td><button class="btn btn-danger" style="padding:3px 9px;font-size:11px"
            data-del-src="${s.id}">Delete</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" style="color:var(--muted);padding:18px 13px">No sources reported yet.</td></tr>';

  $('recReadNote').textContent = `${reads.length} reading${reads.length === 1 ? '' : 's'} in this browser`;
  $('recSrcNote').textContent = `${srcs.length} source${srcs.length === 1 ? '' : 's'} in this browser`;

  document.querySelectorAll('[data-del-read]').forEach((b) => {
    b.onclick = () => store.removeReading(b.dataset.delRead);
  });
  document.querySelectorAll('[data-del-src]').forEach((b) => {
    b.onclick = () => store.removeSource(b.dataset.delSrc);
  });
}

/* ============================================================
   Utilities
   ============================================================ */
function flash(id, text) {
  $(id).innerHTML = `<span class="saved-note">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
      style="width:14px;height:14px"><path d="m20 6-11 11-5-5"/></svg>${esc(text)}</span>`;
  setTimeout(() => { const el = $(id); if (el) el.innerHTML = ''; }, 5000);
}

function shade(hex, p) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, v + p));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function resizePickMap() { pickMap?.invalidateSize(); }
