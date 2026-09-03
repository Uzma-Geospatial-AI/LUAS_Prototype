/* ============================================================
   mapview.js — Main display: the map

   The landing view. Satellite imagery underneath, the monitoring stations
   and the Digital Earth water bodies on top, and four corners that say what
   is being looked at: the counts, the basemap, the layers, the month, and
   the legend. Clicking a station gives its index, its class and its
   target-class verdict.
   ============================================================ */
import { DATA, readingAt, latestIdx, fmtMonth, waterSummary, WATER_GROUPS } from './data.js';
import { wqiClass, WQI_CLASSES, classCompliance, PARAM_META } from './wqi.js';
import { store } from './store.js';
import { IMAGERY, gibsLayer, REFERENCE_MAPS, WATER_INDICES } from './satellite.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ALL = { ...IMAGERY, ...REFERENCE_MAPS };

let map = null, base = null, current = 'esri';
let stationLayer = null, waterLayer = null, reachLayer = null, stateLayer = null;
let monthIdx = null, timer = null;

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function initMap() {
  if (map) { map.invalidateSize(); repaint(); return; }

  const s = DATA.focus;
  monthIdx = latestIdx();

  map = L.map('mainMap', { center: [s.lat, s.lon], zoom: 11, zoomControl: false });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ position: 'topleft', imperial: false }).addTo(map);

  /* --- Selangor: the state LUAS is responsible for --- */
  stateLayer = L.geoJSON(DATA.selangor, {
    style: {
      color: '#ffffff', weight: 2.2, dashArray: '10 7', opacity: 0.92,
      fillColor: '#f5e01c', fillOpacity: 0.05,
    },
    interactive: false,
  }).addTo(map);

  /* --- The reach the water bodies were clipped to --- */
  const radiusKm = DATA.water?.meta?.radius_km ?? 15;
  reachLayer = L.circle([s.lat, s.lon], {
    radius: radiusKm * 1000,
    color: '#f5e01c', weight: 1.6, dashArray: '7 6', fill: false, interactive: false,
  }).addTo(map);

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

  buildBasemaps();
  buildLayerToggles();
  buildLegend();
  buildTimeline();
  setBase('esri');
  repaint();

  /* Open on the whole state, which is the jurisdiction, not just the reach */
  map.fitBounds(stateLayer.getBounds().pad(0.03));
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

/* ---------------- Everything that depends on the month ---------------- */
function repaint() {
  paintStations();
  paintKpis();
}

function paintStations() {
  if (!stationLayer) return;
  stationLayer.clearLayers();
  const target = store.conditions().targetClass;

  for (const st of DATA.stations) {
    const r = readingAt(st, monthIdx);
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

/* The four chips describe the map as it stands, not the latest reading, so
   they move with the slider. */
function paintKpis() {
  const target = store.conditions().targetClass;
  const w = waterSummary();
  const f = readingAt(DATA.focus, monthIdx);
  const cls = wqiClass(f.wqi);
  const meeting = DATA.stations
    .filter((st) => classCompliance(readingAt(st, monthIdx).raw, target).pass).length;

  const chip = (color, mark, value, label) => `
    <div class="mkpi">
      <span class="mk-ic" style="background:${color}">${mark}</span>
      <span><span class="mk-v">${value}</span><span class="mk-l">${label}</span></span>
    </div>`;

  $('mapKpis').innerHTML =
    chip('#22235f', '◉', DATA.stations.length, 'Stations')
    + chip(cls.color, cls.id, f.wqi.toFixed(1), `WQI · ${esc(DATA.focus.name)}`)
    + chip(meeting ? '#17a04a' : '#d92d20', '✓',
      `${meeting}/${DATA.stations.length}`, `Meet Class ${target}`)
    + chip('#45bfe0', '○', w.count, 'Water bodies');
}

function stationPopup(st, r, cls, comp, target) {
  const failing = Object.entries(comp.checks)
    .filter(([, c]) => c.pass === false).map(([p]) => PARAM_META[p].short);

  return `
    <div class="map-pop">
      <div class="pop-head" style="background:${cls.color}">
        <div class="pop-code">${esc(st.code)} · ${esc(st.river)} · ${fmtMonth(DATA.months[monthIdx])}</div>
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

/* ---------------- Top right: basemap ---------------- */
function buildBasemaps() {
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

  $('mapIndices').innerHTML = WATER_INDICES.map((x) => `
    <div class="idx-item">
      <div class="idx-h">${x.name}</div>
      <code>${x.formula}</code>
      <div class="idx-ramp" style="background:${x.ramp}"></div>
      <div class="idx-lab"><span>${x.lo}</span><span>${x.hi}</span></div>
      <div class="idx-b">${x.body}</div>
    </div>`).join('');

  const btn = $('baseToggle');
  const pop = $('basePop');
  btn.onclick = (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) {
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  });

  for (const el of [pop, btn]) {
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }

  /* Popup buttons are re-created on every open */
  map.on('popupopen', (e) => {
    const b = e.popup.getElement()?.querySelector('[data-goto]');
    if (b) {
      b.onclick = () => {
        map.closePopup();
        document.dispatchEvent(new CustomEvent('gotophase', { detail: { view: 'phase1' } }));
      };
    }
  });
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

  $('baseLabel').textContent = d.label;
  $('mapDateRow').style.display = d.daily ? 'flex' : 'none';
  $('mapBaseInfo').innerHTML = `
    <div class="mbi-t">${d.label} <span class="badge soft">${d.res}</span></div>
    <div class="mbi-s">${esc(d.src)}</div>`;
}

/* ---------------- Bottom left: layers ---------------- */
function buildLayerToggles() {
  const w = waterSummary();
  $('ovStations').textContent = DATA.stations.length;
  $('ovWater').textContent = w.count;
  $('ovReach').textContent = `${w.radiusKm} km`;
  $('ovState').textContent = 'state';

  const layers = {
    stations: () => stationLayer, water: () => waterLayer,
    reach: () => reachLayer, selangor: () => stateLayer,
  };
  document.querySelectorAll('[data-mapov]').forEach((i) => {
    i.onchange = () => {
      const l = layers[i.dataset.mapov]();
      if (i.checked) l.addTo(map); else map.removeLayer(l);
    };
  });
  const card = document.querySelector('.map-bl');
  L.DomEvent.disableClickPropagation(card);
}

/* ---------------- Bottom right: legend ---------------- */
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

  const line = (color, dash, label, note) => `
    <div class="ml-row"><span class="ml-line" style="--lc:${color};--ld:${dash}"></span>
      <span>${label} <span class="ml-rng">${note}</span></span></div>`;
  $('mapLegendBounds').innerHTML =
    line('#ffffff', '5px', 'Selangor', 'LUAS jurisdiction')
    + line('#f5e01c', '4px', 'Dengkil reach', `${w.radiusKm} km`);

  L.DomEvent.disableClickPropagation(document.querySelector('.map-br'));
}

/* ---------------- Bottom centre: the month on show ---------------- */
function buildTimeline() {
  const n = DATA.months.length;
  const range = $('timeRange');
  range.max = String(n - 1);
  range.value = String(monthIdx);

  /* One tick per year, so the track reads as a calendar rather than 56 steps */
  const years = [...new Set(DATA.months.map((m) => m.slice(0, 4)))];
  $('timeTicks').innerHTML = years.map((y) => `<span>${y}</span>`).join('');

  range.oninput = () => { pause(); setMonth(+range.value); };
  $('timePlay').onclick = () => (timer ? pause() : play());

  const bar = $('mapTime');
  L.DomEvent.disableClickPropagation(bar);
  L.DomEvent.disableScrollPropagation(bar);
  setMonth(monthIdx);
}

function setMonth(i) {
  monthIdx = Math.max(0, Math.min(DATA.months.length - 1, i));
  $('timeRange').value = String(monthIdx);
  $('timeLabel').textContent = fmtMonth(DATA.months[monthIdx]);
  repaint();
}

function play() {
  if (monthIdx >= DATA.months.length - 1) setMonth(0);
  $('timePlay').classList.add('playing');
  $('timePlay').setAttribute('aria-label', 'Pause');
  timer = setInterval(() => {
    if (monthIdx >= DATA.months.length - 1) { pause(); return; }
    setMonth(monthIdx + 1);
  }, 420);
}

function pause() {
  if (timer) clearInterval(timer);
  timer = null;
  $('timePlay')?.classList.remove('playing');
  $('timePlay')?.setAttribute('aria-label', 'Play');
}

/* ---------------- API ---------------- */
export function resizeMap() { map?.invalidateSize(); }
export function refreshMap() { repaint(); }
export function pauseMap() { pause(); }
