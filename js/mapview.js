/* ============================================================
   mapview.js — Main display: the map

   The landing view. Satellite imagery underneath, the catchment and its
   rivers, the monitoring stations, the water bodies and the pollution
   sources on top, and four corners that say what is being looked at.

   Visibility
   ----------
   Every drawable thing has an id — `wqi:III`, `water:pond`, `src:industri`,
   `river:main`, `bound:catchment` — and `visible` holds the ids that are on.
   A legend row toggles one id. A switch in the layers card is a master over a
   group of ids: turning it off clears the whole group, and it reads back as
   on, off or part-on from its members. One state, two ways into it, so the
   two panels can never disagree.
   ============================================================ */
import { DATA, readingAt, latestIdx, fmtMonth, waterSummary, sourceSummary,
         WATER_GROUPS } from './data.js';
import { wqiClass, WQI_CLASSES, classCompliance, PARAM_META } from './wqi.js';
import { store } from './store.js';
import { IMAGERY, gibsLayer, REFERENCE_MAPS, WATER_INDICES } from './satellite.js';
import { sourceIcon, sourceSwatch } from './symbols.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ALL = { ...IMAGERY, ...REFERENCE_MAPS };

let map = null, base = null, current = 'esri';
let stationLayer = null, basinLayer = null, stateLayer = null;
const waterLayers = {};       // water:<group>
const sourceLayers = {};      // src:<category>
const riverLayers = {};       // river:main | river:trib

const visible = new Set();
const MASTERS = {};           // layers-card switch -> the ids it commands
/* "river:<osm id>" / "water:<osm id>" -> the drawn feature, so a source can
   point at the water it actually reaches. */
const receiving = new Map();

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

  buildCatchment();
  buildRivers();
  buildWaterBodies();
  buildSources();
  stationLayer = L.layerGroup().addTo(map);

  buildBasemaps();
  buildLayerToggles();
  buildLegend();
  buildTimeline();
  setBase('esri');

  /* A 1 ha pond is sub-pixel across the whole basin, so the outline has to
     carry the colour itself until the zoom makes the shape readable. */
  map.on('zoomend', restyleWater);

  applyVisibility();
  map.fitBounds(basinLayer.getBounds().pad(0.06));   // open on the catchment
  return map;
}

/* ---------------- Boundaries ---------------- */
function buildCatchment() {
  basinLayer = L.geoJSON(DATA.catchment, {
    style: {
      color: '#f5e01c', weight: 2.4, dashArray: '9 6', opacity: 0.95,
      fillColor: '#f5e01c', fillOpacity: 0.07,
    },
    interactive: false,
  });
  stateLayer = L.geoJSON(DATA.selangor, {
    style: {
      color: '#ffffff', weight: 2.2, dashArray: '10 7', opacity: 0.92,
      fillColor: '#f5e01c', fillOpacity: 0.05,
    },
    interactive: false,
  });
  visible.add('bound:catchment').add('bound:selangor');
  MASTERS.basin = ['bound:catchment'];
  MASTERS.selangor = ['bound:selangor'];
}

/* ---------------- Rivers ---------------- */
function buildRivers() {
  const feats = DATA.rivers.features;
  const split = {
    main: feats.filter((f) => f.properties.main),
    trib: feats.filter((f) => !f.properties.main),
  };
  for (const [key, list] of Object.entries(split)) {
    riverLayers[key] = L.geoJSON({ type: 'FeatureCollection', features: list }, {
      style: key === 'main'
        ? { color: '#0aa3d9', weight: 3.2, opacity: 0.95 }
        : { color: '#45bfe0', weight: 1.4, opacity: 0.8 },
      onEachFeature: (f, layer) => {
        const r = f.properties;
        layer.bindTooltip(
          `<b>${r.name ? esc(r.name) : 'Unnamed river'}</b><br>`
          + `${(r.m / 1000).toFixed(1)} km of mapped channel`
          + (r.main ? '<br>Main channel' : ''),
          { sticky: true });
        if (r.id != null) receiving.set(`river:${r.id}`, { layer, vis: `river:${key}` });
      },
    });
    visible.add(`river:${key}`);
  }
  MASTERS.rivers = ['river:main', 'river:trib'];
}

/* ---------------- Water bodies ---------------- */
function buildWaterBodies() {
  const ids = [];
  for (const key of Object.keys(WATER_GROUPS)) {
    const list = DATA.water.geo.features.filter((f) => f.properties.group === key);
    if (!list.length) continue;
    const layer = L.geoJSON({ type: 'FeatureCollection', features: list }, {
      style: waterStyle,
      onEachFeature: (f, l) => {
        const b = f.properties;
        const g = WATER_GROUPS[b.group] ?? WATER_GROUPS.other;
        l.bindTooltip(
          `<b>${b.name ? esc(b.name) : 'Unnamed water body'}</b><br>`
          + `${esc(g.label)} · ${esc(b.kind)}<br>`
          + `${(b.area_m2 / 1e4).toFixed(2)} ha · ${b.km.toFixed(1)} km from the nearest river`,
          { sticky: true });
        l.on({
          mouseover: (e) => e.target.setStyle({ weight: 1.8, fillOpacity: 0.8 }),
          mouseout: (e) => layer.resetStyle(e.target),
        });
        if (b.id != null) receiving.set(`water:${b.id}`, { layer: l, vis: `water:${key}` });
      },
    });
    waterLayers[key] = layer;
    visible.add(`water:${key}`);
    ids.push(`water:${key}`);
  }
  MASTERS.water = ids;
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

function restyleWater() {
  for (const l of Object.values(waterLayers)) l.setStyle(waterStyle);
}

/* ---------------- What can put a load into the river ---------------- */
function buildSources() {
  const su = sourceSummary();
  const ids = [];
  for (const [key, c] of Object.entries(su.cats)) {
    const list = su.features.filter((f) => f.properties.cat === key);
    if (!list.length) continue;
    sourceLayers[key] = L.layerGroup(list.map((f) => {
      const p = f.properties;
      /* Size carries the risk score, so the ones on the bank read heaviest */
      const size = Math.round(12 + p.risk * 2.1);
      const [lon, lat] = f.geometry.coordinates;
      p.at = f.geometry.coordinates;      /* the popup needs it to frame the view */
      return L.marker([lat, lon], {
        icon: sourceIcon(c.shape, c.color, size),
        zIndexOffset: Math.round(p.risk * 20),
      })
        .bindTooltip(
          `<b>${p.name ? esc(p.name) : esc(c.label)}</b><br>`
          + `${esc(c.label)}<br>${p.dist} m from ${p.to ? esc(p.to.name) : 'water'}`,
          { direction: 'top', offset: [0, -size / 2 - 2] })
        .bindPopup(sourcePopup(p, c), { maxWidth: 300 });
    }));
    visible.add(`src:${key}`);
    ids.push(`src:${key}`);
  }
  MASTERS.sources = ids;
}

const PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
  + ' stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/>'
  + '<circle cx="12" cy="10" r="2.8"/></svg>';

function sourcePopup(p, c) {
  const to = p.to;
  return `
    <div class="map-pop">
      <div class="pop-head" style="background:${c.color}">
        <div class="pop-code">${esc(c.label)}</div>
        <div class="pop-name">${p.name ? esc(p.name) : 'Unnamed site'}</div>
      </div>
      <div class="pop-body">
        <table class="pop-tbl">
          ${to ? `<tr>
            <td>Nearest water<div class="pop-sub">${esc(to.name)}</div></td>
            <td class="num">${p.dist} m
              ${receiving.has(`${to.kind}:${to.id}`)
                ? `<button class="pin-btn" data-flash="${to.kind}:${to.id}"
                     data-at="${p.at[1]},${p.at[0]}"
                     title="Show ${esc(to.name)} on the map">${PIN}</button>` : ''}
            </td></tr>`
          : `<tr><td>Distance to water</td><td class="num">${p.dist} m</td></tr>`}
          ${p.dist_langat != null
            ? `<tr><td>To Sungai Langat</td><td class="num">${p.dist_langat} m</td></tr>` : ''}
          <tr><td>Screening risk</td><td class="num">${p.risk.toFixed(2)} / 5</td></tr>
        </table>
        <div class="pop-pol"><b>Typically carries</b><br>${esc(c.pol)}</div>
        <div class="pop-note">Screening only — no discharge here is metered</div>
      </div>
    </div>`;
}

/* Fly to the water a source reaches and flash it. If its layer has been
   switched off in the legend, switch it back on — the point of the button is
   to be shown the thing. */
function showReceiving(key, at) {
  const t = receiving.get(key);
  if (!t) return;

  if (!visible.has(t.vis)) { visible.add(t.vis); applyVisibility(); }

  /* Frame the SOURCE, not the target. A river reach can be kilometres long and
     its centre may be nowhere near the site; the water it reaches is within
     1.5 km by construction, so centring the site shows both. */
  if (at) map.flyTo(at, Math.max(map.getZoom(), 15), { duration: 0.7 });

  const el = t.layer.getElement?.();
  if (!el) return;
  el.classList.remove('flash-water');
  void el.getBoundingClientRect();          /* restart the animation */
  el.classList.add('flash-water');
  setTimeout(() => el.classList.remove('flash-water'), 3200);
}

/* ---------------- Visibility ---------------- */
function applyVisibility() {
  const set = (layer, on) => {
    if (!layer) return;
    if (on) { if (!map.hasLayer(layer)) layer.addTo(map); }
    else if (map.hasLayer(layer)) map.removeLayer(layer);
  };

  set(basinLayer, visible.has('bound:catchment'));
  set(stateLayer, visible.has('bound:selangor'));
  for (const [k, l] of Object.entries(riverLayers)) set(l, visible.has(`river:${k}`));
  for (const [k, l] of Object.entries(waterLayers)) set(l, visible.has(`water:${k}`));
  for (const [k, l] of Object.entries(sourceLayers)) set(l, visible.has(`src:${k}`));

  repaint();
  syncControls();
}

function toggle(id) {
  if (visible.has(id)) visible.delete(id); else visible.add(id);
  applyVisibility();
}

/* A master is on when every member is on, off when none is, and part-on in
   between — which is what `indeterminate` is for. */
function syncControls() {
  document.querySelectorAll('[data-vis]').forEach((b) => {
    const on = visible.has(b.dataset.vis);
    b.classList.toggle('off', !on);
    b.setAttribute('aria-pressed', String(on));
  });
  for (const [key, ids] of Object.entries(MASTERS)) {
    const box = document.querySelector(`[data-mapov="${key}"]`);
    if (!box) continue;
    const on = ids.filter((i) => visible.has(i)).length;
    box.checked = on > 0;
    box.indeterminate = on > 0 && on < ids.length;
  }
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
    if (!visible.has(`wqi:${cls.id}`)) continue;      /* filtered out in the legend */
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
    + chip('#45bfe0', '○', sourceSummary().count, 'Pollution sources');
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

  /* Popups are rebuilt on every open, so their buttons are wired here */
  map.on('popupopen', (e) => {
    const root = e.popup.getElement();
    const goto = root?.querySelector('[data-goto]');
    if (goto) {
      goto.onclick = () => {
        map.closePopup();
        document.dispatchEvent(new CustomEvent('gotophase', { detail: { view: 'phase1' } }));
      };
    }
    const pin = root?.querySelector('[data-flash]');
    if (pin) {
      pin.onclick = () => showReceiving(
        pin.dataset.flash,
        pin.dataset.at ? pin.dataset.at.split(',').map(Number) : null);
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

/* ---------------- Bottom left: the group masters ---------------- */
function buildLayerToggles() {
  const w = waterSummary();
  MASTERS.stations = WQI_CLASSES.map((c) => `wqi:${c.id}`);
  for (const id of MASTERS.stations) visible.add(id);

  $('ovStations').textContent = DATA.stations.length;
  $('ovWater').textContent = w.count.toLocaleString('en');
  $('ovSources').textContent = sourceSummary().count;
  $('ovRivers').textContent = `${Math.round(DATA.rivers.meta.total_km)} km`;
  $('ovBasin').textContent = `${Math.round(w.basinKm2).toLocaleString('en')} km²`;
  $('ovState').textContent = 'state';

  document.querySelectorAll('[data-mapov]').forEach((box) => {
    box.onchange = () => {
      for (const id of MASTERS[box.dataset.mapov] ?? []) {
        if (box.checked) visible.add(id); else visible.delete(id);
      }
      applyVisibility();
    };
  });
  L.DomEvent.disableClickPropagation(document.querySelector('.map-bl'));
}

/* ---------------- Bottom right: the legend, which is also the filter ------- */
function buildLegend() {
  const row = (id, swatch, label, note, title = '') => `
    <button class="ml-row" data-vis="${id}" aria-pressed="true"${title ? ` title="${esc(title)}"` : ''}>
      ${swatch}
      <span class="ml-t">${label}${note ? ` <span class="ml-rng">${note}</span>` : ''}</span>
    </button>`;

  $('mapLegendWqi').innerHTML = WQI_CLASSES.map((c) => row(
    `wqi:${c.id}`,
    `<span class="ml-chip" style="background:${c.color}">${c.id}</span>`,
    `<b>${c.status}</b>`,
    c.max > 100 ? '92.7 – 100' : `${c.min < 0 ? '0' : c.min} – ${c.max}`,
    c.use)).join('');

  const su = sourceSummary();
  $('mapLegendSources').innerHTML = Object.entries(su.cats)
    .filter(([k]) => su.groups[k]?.n)
    .map(([k, c]) => row(`src:${k}`, sourceSwatch(c.shape, c.color, 16),
      esc(c.label), su.groups[k].n, c.pol)).join('');

  const w = waterSummary();
  $('mapLegendWater').innerHTML = Object.entries(WATER_GROUPS)
    .filter(([k]) => w.groups[k].n)
    .map(([k, g]) => row(`water:${k}`,
      `<span class="ml-dot" style="background:${g.color}"></span>`,
      esc(g.label), w.groups[k].n, g.note)).join('');

  const line = (color, solid) =>
    `<span class="ml-line${solid ? ' solid' : ''}" style="--lc:${color}"></span>`;
  $('mapLegendBounds').innerHTML =
    row('bound:catchment', line('#f5e01c'), 'Langat catchment',
      `${Math.round(w.basinKm2).toLocaleString('en')} km²`)
    + row('bound:selangor', line('#ffffff'), 'Selangor', 'LUAS jurisdiction')
    + row('river:main', line('#0aa3d9', true), 'Sungai Langat', 'main channel')
    + row('river:trib', line('#45bfe0', true), 'Tributaries',
      `${riverLayers.trib?.getLayers().length ?? 0} reaches`);

  document.querySelectorAll('[data-vis]').forEach((b) => {
    b.onclick = () => toggle(b.dataset.vis);
  });

  /* The legend is the tallest thing on the map; let it fold out of the way */
  const card = $('mapLegend');
  const btn = $('legendMin');
  btn.onclick = () => {
    const min = card.classList.toggle('min');
    btn.setAttribute('aria-expanded', String(!min));
    btn.title = min ? 'Show the legend' : 'Minimise the legend';
  };
  L.DomEvent.disableClickPropagation(card);
  L.DomEvent.disableScrollPropagation(card);
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
