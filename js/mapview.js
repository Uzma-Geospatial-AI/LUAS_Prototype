/* ============================================================
   mapview.js — Main display: the map

   The landing view. Satellite imagery underneath, the monitoring stations
   and the Digital Earth water bodies on top. Clicking a station gives its
   index, its class and its Class II verdict, with one click through to the
   Phase 1 assessment.
   ============================================================ */
import { DATA, readingAt, latestIdx, waterSummary, WATER_GROUPS } from './data.js';
import { wqiClass, WQI_CLASSES, classCompliance, PARAM_META } from './wqi.js';
import { store } from './store.js';
import { IMAGERY, gibsLayer, REFERENCE_MAPS, WATER_INDICES } from './satellite.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ALL = { ...IMAGERY, ...REFERENCE_MAPS };

let map = null, base = null, current = 'esri';
let stationLayer = null, waterLayer = null;

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function initMap() {
  if (map) { map.invalidateSize(); paintStations(); return; }

  const s = DATA.focus;
  map = L.map('mainMap', { center: [s.lat, s.lon], zoom: 11, zoomControl: false });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  /* --- Water bodies: the Digital Earth outlines themselves --- */
  waterLayer = L.geoJSON(DATA.water.geo, {
    style: waterStyle,
    onEachFeature: (f, layer) => {
      const b = f.properties;
      const g = WATER_GROUPS[b.group] ?? WATER_GROUPS.other;
      layer.bindTooltip(
        `<b>${b.name ? esc(b.name) : 'Unnamed water body'}</b><br>`
        + `${esc(g.label)} · ${esc(b.kind)}<br>`
        + `${(b.area_m2 / 1e4).toFixed(2)} ha · ${b.km.toFixed(1)} km from the station`,
        { sticky: true });
      layer.on({
        mouseover: (e) => e.target.setStyle({ weight: 1.8, fillOpacity: 0.8 }),
        mouseout: (e) => waterLayer.resetStyle(e.target),
      });
    },
  }).addTo(map);

  /* A 1 ha pond is sub-pixel across the whole basin, so the outline has to
     carry the colour itself until the zoom makes the shape readable. */
  map.on('zoomend', () => waterLayer.setStyle(waterStyle));

  stationLayer = L.layerGroup().addTo(map);
  paintStations();

  buildControls();
  buildLegend();
  setBase('esri');

  map.fitBounds(L.latLngBounds(DATA.stations.map((x) => [x.lat, x.lon])).pad(0.16));
  return map;
}

function waterStyle(f) {
  const g = WATER_GROUPS[f.properties.group] ?? WATER_GROUPS.other;
  const wide = (map?.getZoom() ?? 11) < 13;
  return {
    fillColor: g.color, fillOpacity: wide ? 0.85 : 0.6,
    color: wide ? g.color : '#ffffff',
    weight: wide ? 1.9 : 0.8, opacity: wide ? 0.9 : 0.8,
  };
}

/* ---------------- Stations ---------------- */
function paintStations() {
  if (!stationLayer) return;
  stationLayer.clearLayers();
  const i = latestIdx();
  const target = store.conditions().targetClass;

  for (const st of DATA.stations) {
    const r = readingAt(st, i);
    const cls = wqiClass(r.wqi);
    const comp = classCompliance(r.raw, target);
    const focus = st.code === DATA.focus.code;

    L.marker([st.lat, st.lon], {
      zIndexOffset: focus ? 600 : 300,
      icon: L.divIcon({
        className: '',
        html: `<div class="map-stn${focus ? ' focus' : ''}" style="background:${cls.color}">
          ${Math.round(r.wqi)}</div>`,
        iconSize: focus ? [34, 34] : [26, 26],
        iconAnchor: focus ? [17, 17] : [13, 13],
      }),
    })
      .bindTooltip(`<b>${esc(st.code)} — ${esc(st.name)}</b><br>WQI ${r.wqi.toFixed(1)} · ${cls.status}`,
        { direction: 'top', offset: [0, -14] })
      .bindPopup(stationPopup(st, r, cls, comp, target), { maxWidth: 300 })
      .addTo(stationLayer);
  }
}

function stationPopup(st, r, cls, comp, target) {
  const failing = Object.entries(comp.checks)
    .filter(([, c]) => c.pass === false).map(([p]) => PARAM_META[p].short);

  return `
    <div class="map-pop">
      <div class="pop-head" style="background:${cls.color}">
        <div class="pop-code">${esc(st.code)} · ${esc(st.river)}</div>
        <div class="pop-name">${esc(st.name)}</div>
      </div>
      <div class="pop-body">
        <div class="pop-wqi">
          <span class="pop-val" style="color:${cls.color}">${r.wqi.toFixed(1)}</span>
          <span class="pop-cls">${cls.label}<br><b>${cls.status}</b></span>
        </div>
        <div class="pop-verdict ${comp.pass ? 'ok' : 'bad'}">
          ${comp.pass
            ? `Meets Class ${target}`
            : `Fails Class ${target}: ${failing.join(', ')}`}
        </div>
        <table class="pop-tbl">
          ${Object.keys(PARAM_META).map((p) => {
            const chk = comp.checks[p];
            const v = r.raw[p];
            return `<tr>
              <td>${PARAM_META[p].short}</td>
              <td class="num${chk.pass === false ? ' bad' : ''}">${p === 'an' ? v.toFixed(3) : v.toFixed(2)}</td>
              <td class="lim">${chk.limitText}</td>
            </tr>`;
          }).join('')}
        </table>
        ${st.code === DATA.focus.code
          ? '<button class="pop-btn" data-goto="1">Open Phase 1 assessment →</button>'
          : '<div class="pop-note">Phase 1 assesses the Dengkil station</div>'}
      </div>
    </div>`;
}

/* ---------------- Controls ---------------- */
function buildControls() {
  const group = (keys, title) => `
    <div class="mc-group">
      <h5>${title}</h5>
      <div class="mc-btns">${keys.map((k) => `
        <button class="mc-btn" data-base="${k}" title="${esc(ALL[k].use)}">${ALL[k].label}</button>`).join('')}</div>
    </div>`;

  $('mapBasemaps').innerHTML =
    group(Object.keys(IMAGERY).filter((k) => !IMAGERY[k].daily), 'Satellite imagery')
    + group(Object.keys(IMAGERY).filter((k) => IMAGERY[k].daily), 'Daily imagery')
    + group(Object.keys(REFERENCE_MAPS), 'Reference maps');

  document.querySelectorAll('[data-base]').forEach((b) => {
    b.onclick = () => setBase(b.dataset.base);
  });

  const date = $('mapDate');
  date.value = iso(new Date(Date.now() - 2 * 864e5));   // GIBS lags ~1–2 days
  date.max = iso(new Date(Date.now() - 864e5));
  date.min = '2012-01-01';
  date.onchange = () => { if (ALL[current].daily) setBase(current); };

  document.querySelectorAll('[data-mapov]').forEach((i) => {
    i.onchange = () => {
      const l = i.dataset.mapov === 'stations' ? stationLayer : waterLayer;
      if (i.checked) l.addTo(map); else map.removeLayer(l);
    };
  });

  /* Popup buttons are re-created on every open */
  map.on('popupopen', (e) => {
    const btn = e.popup.getElement()?.querySelector('[data-goto]');
    if (btn) {
      btn.onclick = () => {
        map.closePopup();
        document.dispatchEvent(new CustomEvent('gotophase', { detail: { view: 'phase1' } }));
      };
    }
  });

  $('mapIndices').innerHTML = WATER_INDICES.map((x) => `
    <div class="idx-item">
      <div class="idx-h">${x.name}</div>
      <code>${x.formula}</code>
      <div class="idx-ramp" style="background:${x.ramp}"></div>
      <div class="idx-lab"><span>${x.lo}</span><span>${x.hi}</span></div>
      <div class="idx-b">${x.body}</div>
    </div>`).join('');

  const panel = $('mapPanel');
  $('mapPanelToggle').onclick = () => panel.classList.toggle('closed');
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);
}

function setBase(key) {
  current = key;
  const d = ALL[key];
  document.querySelectorAll('[data-base]').forEach((b) =>
    b.classList.toggle('active', b.dataset.base === key));

  if (base) map.removeLayer(base);
  base = d.daily ? gibsLayer(d, $('mapDate').value) : d.make();
  base.addTo(map);
  base.bringToBack();

  $('mapDateRow').style.display = d.daily ? 'flex' : 'none';
  $('mapBaseInfo').innerHTML = `
    <div class="mbi-t">${d.label} <span class="badge soft">${d.res}</span></div>
    <div class="mbi-s">${esc(d.src)}</div>`;
}

/* ---------------- Legend ---------------- */
function buildLegend() {
  $('mapLegendWqi').innerHTML = WQI_CLASSES.map((c) => `
    <div class="ml-row" title="${esc(c.use)}">
      <span class="ml-chip" style="background:${c.color}">${c.id}</span>
      <span><b>${c.status}</b><span class="ml-rng">${c.max > 100
        ? '92.7 – 100' : `${c.min < 0 ? '0' : c.min} – ${c.max}`}</span></span>
    </div>`).join('');

  const w = waterSummary();
  $('mapLegendWater').innerHTML = Object.entries(WATER_GROUPS)
    .filter(([k]) => w.groups[k].n)
    .map(([k, g]) => `
      <div class="ml-row"><span class="ml-dot" style="background:${g.color}"></span>
        <span>${g.label} <span class="ml-rng">${w.groups[k].n}</span></span></div>`).join('');
}

/* ---------------- API ---------------- */
export function resizeMap() { map?.invalidateSize(); }
export function refreshMap() { paintStations(); }
