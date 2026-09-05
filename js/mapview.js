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
import { licenceStatus } from './licenceStatus.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ALL = { ...IMAGERY, ...REFERENCE_MAPS };

/* Leaflet keeps every pane inside one stacking context at z-index 400, so a
   popup cannot be lifted above the cards floating in the corners. Panning it
   clear of them is the fix: these paddings are the space the cards occupy. */
const POPUP = {
  maxWidth: 300,
  autoPanPaddingTopLeft: [20, 132],
  autoPanPaddingBottomRight: [250, 150],
};

let map = null, base = null, current = 'esri';
let stationLayer = null, basinLayer = null, stateLayer = null;
const waterLayers = {};       // water:<group>
let flowLayer = null;         // the animated direction overlay
let licenceLayer = null;      // premises with a discharge licence
let waterFlowLayer = null;    // water that drains out to a mapped channel
let stillLayer = null;        // standing water, ringed; drawn from zoom 13
const sourceLayers = {};      // src:<category>
const levelLayers = {};       // wl:<status> — JPS river water level
const riverLayers = {};       // river:main | river:trib

const stationMarkers = new Map();   // station code -> marker
const sourceIds = new Set();        // every point source id the map draws
const sourceMarkers = new Map();    // osm id -> marker
const licenceMarkers = [];          // standalone licence pins, with their position
const levelMarkers = new Map();     // JPS station id -> marker
let searchIndex = null;
let traceLayer = null;

const visible = new Set();
const MASTERS = {};           // layers-card switch -> the ids it commands
/* "river:<osm id>" / "water:<osm id>" -> the drawn feature, so a source can
   point at the water it actually reaches. */
const receiving = new Map();

let monthIdx = null, timer = null;
let openPopup = null;

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/* JPS sets four threshold levels for every water level station and publishes
   its own status against them. The wording and the colours are JPS's, so a
   reader who knows InfoBanjir reads this map without translating. Yellow needs
   dark text on it, which is what `ink` is for. */
const LEVEL_STATUS = {
  bahaya: { label: 'Bahaya', en: 'Danger', color: '#e01b1b' },
  amaran: { label: 'Amaran', en: 'Warning', color: '#ffa500', ink: '#23262e' },
  waspada: { label: 'Waspada', en: 'Alert', color: '#ffe600', ink: '#23262e' },
  normal: { label: 'Normal', en: 'Below the alert level', color: '#0b8f3d' },
  offline: { label: 'No reading', en: 'Offline or reporting an error', color: '#8d93a6' },
};
const LEVEL_ORDER = ['bahaya', 'amaran', 'waspada', 'normal', 'offline'];

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
  buildLevels();
  licenceLayer = L.layerGroup();
  visible.add('licence:all');
  MASTERS.licences = ['licence:all'];
  stationLayer = L.layerGroup().addTo(map);

  /* Delegated: paintKpis replaces the chips on every month step, so a
     handler bound to a chip would not survive. */
  const kpis = $('mapKpis');
  kpis.onclick = (e) => {
    const b = e.target.closest('[data-vis]');
    if (b) toggle(b.dataset.vis);
  };
  L.DomEvent.disableClickPropagation(kpis);

  buildBasemaps();
  buildLayerToggles();
  buildLegend();
  buildSearch();
  buildTimeline();
  setBase('esri');

  /* A 1 ha pond is sub-pixel across the whole basin, so the outline has to
     carry the colour itself until the zoom makes the shape readable. */
  map.on('zoomend', () => { restyleWater(); restyleRivers(); syncStill(); });

  applyVisibility();
  if (pendingFly) {
    const [lat, lon, z, srcId] = pendingFly;
    pendingFly = null;
    map.setView([lat, lon], z);
    setTimeout(() => {
      (sourceMarkers.get(srcId) ?? nearestLicenceMarker(lat, lon))?.openPopup();
    }, 250);
  } else {
    map.fitBounds(basinLayer.getBounds().pad(0.06));   // open on the catchment
  }
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
/* There is no measured width in the source — 3 of 1,182 ways carry a `width`
   tag — so the line is scaled by what the reach drains instead: the mapped
   channel length accumulated from every reach above it. A real river widens
   roughly with the square root of what it carries, and that is enough to make
   a confluence read as one: two thin tributaries meet and the channel below
   them is visibly heavier. It is an accumulation, not a measurement. */
let maxUp = 1;

function riverWeight(up) {
  const z = map?.getZoom() ?? 11;
  const zoom = Math.max(0.55, Math.min(2.2, (z - 8) / 5));
  return zoom * (1.1 + 5.5 * Math.sqrt((up ?? 0) / maxUp));
}

function riverStyle(f) {
  const r = f.properties;
  return {
    color: r.main ? '#0aa3d9' : '#45bfe0',
    weight: riverWeight(r.up),
    opacity: r.main ? 0.95 : 0.85,
    lineCap: 'round',            /* so a tributary blends into its trunk */
    lineJoin: 'round',
  };
}

function restyleRivers() {
  for (const l of Object.values(riverLayers)) l.setStyle(riverStyle);
  flowLayer?.setStyle(flowStyle);
  riverLayers.main?.bringToFront();
  flowLayer?.bringToFront();
}

function buildRivers() {
  const feats = DATA.rivers.features;
  maxUp = Math.max(1, ...feats.map((f) => f.properties.up ?? 0));

  /* Smallest first, so the trunk draws over the tributary joining it */
  const byUp = (a, b) => (a.properties.up ?? 0) - (b.properties.up ?? 0);
  const split = {
    trib: feats.filter((f) => !f.properties.main).sort(byUp),
    main: feats.filter((f) => f.properties.main).sort(byUp),
  };
  for (const [key, list] of Object.entries(split)) {
    riverLayers[key] = L.geoJSON({ type: 'FeatureCollection', features: list }, {
      style: riverStyle,
      onEachFeature: (f, layer) => {
        const r = f.properties;
        layer.bindTooltip(
          `<b>${r.name ? esc(r.name) : 'Unnamed river'}</b><br>`
          + `${(r.m / 1000).toFixed(1)} km of mapped channel`
          + (r.main ? '<br>Main channel' : '') + '<br><i>Click to trace downstream</i>',
          { sticky: true });
        layer.bindPopup(() => riverPopup(r), POPUP);
        layer.on('click', () => drawTrace(r.id));
        if (r.id != null) receiving.set(`river:${r.id}`, { layer, vis: `river:${key}` });
      },
    });
    visible.add(`river:${key}`);
  }
  MASTERS.rivers = ['river:main', 'river:trib'];

  /* A dashed pass drawn over the channels. OSM's coordinates already run
     downstream, so animating the dash offset along the line IS the flow
     direction — nothing has to be inferred at draw time. It carries no
     information the lines below do not, so it is never interactive and never
     takes a click away from them. */
  flowLayer = L.geoJSON(DATA.rivers, { style: flowStyle });
  visible.add('flow:anim');
  visible.add('flow:water');
  MASTERS.flow = ['flow:anim', 'flow:water'];
}

/* The moving dashes ride on top of the channel, at about half its width, so a
   big river reads as a broad flow and a headwater as a thread. */
function flowStyle(f) {
  const w = riverWeight(f.properties.up);
  return {
    color: '#ffffff',
    weight: Math.max(1, w * 0.5),
    opacity: 0.9,
    /* Both patterns repeat every 20px, so one keyframe distance animates
       every reach seamlessly. */
    dashArray: f.properties.main ? '6 14' : '4 16',
    className: 'flow-anim',
    interactive: false,
  };
}

/* ---------------- Water bodies ---------------- */
function buildWaterBodies() {
  const ids = [];
  /* Its own pane, above the fills: a ring drawn in the overlay pane would
     end up under whichever water layer was toggled on last. */
  map.createPane('waterflow').style.zIndex = 450;
  waterFlowLayer = L.layerGroup();
  stillLayer = L.layerGroup();
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
          + `${(b.area_m2 / 1e4).toFixed(2)} ha · ${b.km.toFixed(1)} km from the nearest river`
          + (b.flow ? `<br><i>${flowNote(b)}</i>` : ''),   /* older data has no flow */
          { sticky: true });
        drawWaterFlow(f, b);
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

/* What the data says about the water moving. `flow` is read off the mapped
   rivers by scripts/02: a reach that crosses the body, begins in it, ends in
   it, or none at all. Most bodies here are the last — ex-mining pits and
   detention ponds no mapped river touches — and the note says exactly that
   rather than pretending to know which way their water goes. */
function flowNote(b) {
  const via = b.via ? esc(b.via) : 'a mapped river';
  switch (b.flow) {
    case 'thru': return `Through-flow: ${via} passes through it`;
    case 'out':  return `Drains out to ${via}`;
    case 'in':   return `Fed by ${via}; where it drains is not mapped`;
    default:
      return b.group === 'channel'
        ? 'Channel surface: flows with the river'
        : 'Standing water: no mapped inflow or outflow';
  }
}

/* The moving picture of that.
     thru  — the river's own flow animation already crosses the body, so
             nothing is added: one flow, drawn once.
     out   — a dashed run from the body's centre to where the outlet reach
             begins, animated the same way as the channels, so the eye can
             follow the water out of the pond and down the river.
     still — dashed rings that turn in place, the outline and two shrunk
             copies of it towards the centre. Not a direction, because the
             data has none to give; it says "water, not moving through".
             Drawn from zoom 13 only: below that a pond is smaller than the
             ring would be, and a floodplain of them would just shimmer.
   A channel-surface polygon is the river itself, so it gets neither. */
function drawWaterFlow(f, b) {
  const opts = { pane: 'waterflow', interactive: false, color: '#ffffff' };
  if (b.flow === 'out' && b.outlet) {
    L.polyline([[b.lat, b.lon], [b.outlet[1], b.outlet[0]]], {
      ...opts, weight: 2, opacity: 0.9, dashArray: '5 15', className: 'flow-anim',
    }).addTo(waterFlowLayer);
  } else if (b.flow === 'still' && b.group !== 'channel') {
    /* Every ring turns the same way, so the winding of the source polygon
       is normalised: clockwise on the screen. */
    const ring = f.geometry.coordinates[0];
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      a += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
    }
    const cw = a > 0 ? ring : ring.slice().reverse();
    /* The outline, then the same shape shrunk towards the centre so the
       turning reads across the surface and not only at the bank. Only where
       there is a surface to speak of: under half a hectare the inner rings
       would sit on top of each other. */
    const scales = b.area_m2 >= 5000 ? [1, 0.66, 0.33] : [1];
    for (const k of scales) {
      L.polygon(cw.map(([lon, lat]) => [b.lat + (lat - b.lat) * k, b.lon + (lon - b.lon) * k]), {
        ...opts, weight: k === 1 ? 1.3 : 1, opacity: k === 1 ? 0.75 : 0.5, fill: false,
        dashArray: '3 7', className: 'still-anim',
      }).addTo(stillLayer);
    }
  }
}

/* The rings are worth drawing only once a pond is bigger than its ring */
function syncStill() {
  if (!stillLayer || !map) return;
  const on = visible.has('flow:water') && map.getZoom() >= 13;
  if (on) { if (!map.hasLayer(stillLayer)) stillLayer.addTo(map); }
  else if (map.hasLayer(stillLayer)) map.removeLayer(stillLayer);
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
      const marker = L.marker([lat, lon], {
        icon: sourceIcon(c.shape, c.color, size),
        zIndexOffset: Math.round(p.risk * 20),
      });
      sourceMarkers.set(p.id, marker);
      sourceIds.add(p.id);
      return marker
        .bindTooltip(
          `<b>${p.name ? esc(p.name) : esc(c.label)}</b><br>`
          + `${esc(c.label)}<br>${metres(p.dist)} from ${esc(overallNearest(p)?.n ?? 'water')}`,
          { direction: 'top', offset: [0, -size / 2 - 2] })
        /* A function, not a string: it is re-run on open and on every layer
           toggle, so the answer follows what is actually on the map. */
        .bindPopup(() => sourcePopup(p, c), POPUP);
    }));
    visible.add(`src:${key}`);
    ids.push(`src:${key}`);
  }
  MASTERS.sources = ids;
}

/* ---------------- JPS river water level ---------------- */
function buildLevels() {
  const list = DATA.levels?.stations ?? [];
  const ids = [];
  for (const key of LEVEL_ORDER) {
    const group = list.filter((s) => s.status === key);
    if (!group.length) continue;
    levelLayers[key] = L.layerGroup(group.map((st) => {
      const marker = L.marker([st.lat, st.lon], {
        icon: levelIcon(st),
        /* A station in flood has to be the one you see first */
        zIndexOffset: 600 + (LEVEL_ORDER.length - LEVEL_ORDER.indexOf(key)) * 40,
      });
      levelMarkers.set(st.id, marker);
      return marker
        .bindTooltip(`<b>${esc(st.name)}</b><br>${levelLine(st)}`,
          { direction: 'top', offset: [0, -22] })
        .bindPopup(() => levelPopup(st), POPUP);
    }));
    visible.add(`wl:${key}`);
    ids.push(`wl:${key}`);
  }
  MASTERS.levels = ids;
}

/* How far the reading stands between the normal level and the danger level.
   It only decides how much of the gauge is filled — it is never shown as a
   number, because a percentage between two thresholds is not a quantity
   anyone measures. Below normal reads empty, above danger reads full. */
function levelFill(st) {
  const lo = st.th?.normal;
  const hi = st.th?.bahaya;
  if (st.level == null || lo == null || hi == null || hi <= lo) return 0;
  return Math.max(0, Math.min(1, (st.level - lo) / (hi - lo)));
}

/* A staff gauge standing on its station: nothing else on this map is an
   upright bar, so the layer is tellable apart from the WQI circles and the
   source shapes without reading the colour. */
function levelIcon(st) {
  const c = LEVEL_STATUS[st.status] ?? LEVEL_STATUS.offline;
  const out = st.status === 'offline';
  return L.divIcon({
    className: '',
    html: `<div class="wl-gauge${out ? ' out' : ''}" style="--wc:${c.color}">`
      + `<i style="height:${out ? 0 : Math.round(levelFill(st) * 100)}%"></i></div>`,
    iconSize: [15, 24], iconAnchor: [7, 24],
  });
}

const wlM = (v) => `${v.toFixed(2)} m`;

function levelLine(st) {
  const c = LEVEL_STATUS[st.status] ?? LEVEL_STATUS.offline;
  return st.level == null ? c.label : `${wlM(st.level)} · ${c.label}`;
}

function levelPopup(st) {
  const c = LEVEL_STATUS[st.status] ?? LEVEL_STATUS.offline;
  const th = st.th ?? {};

  /* The ladder reads the way a gauge board does — danger at the top. The lit
     rung is the status JPS itself publishes, not one worked out here by
     comparing the reading against the numbers: "Normal" is a reference level
     rather than a line to be crossed, so a station sitting below it is still
     Normal and lighting nothing would say the opposite. */
  const rungs = ['bahaya', 'amaran', 'waspada', 'normal'].map((k) => {
    const v = th[k];
    if (v == null) return '';
    const on = st.status === k;
    const t = LEVEL_STATUS[k];
    return `<div class="wl-rung${on ? ' on' : ''}" style="--wc:${t.color}">
      <span>${t.label}</span><b>${wlM(v)}</b></div>`;
  }).join('');

  /* Plain subtraction against a published threshold, not a forecast */
  let gap = '';
  if (st.level != null && th.waspada != null) {
    const d = th.waspada - st.level;
    gap = d >= 0
      ? `${wlM(d)} below the Waspada level`
      : `${wlM(-d)} above the Waspada level`;
  }

  return `
    <div class="map-pop">
      <div class="pop-head" style="background:${c.color}${c.ink ? `;color:${c.ink}` : ''}">
        <div class="pop-code">Aras air sungai · ${esc(c.label)}</div>
        <div class="pop-name">${esc(st.name)}</div>
      </div>
      <div class="pop-body">
        <div class="wl-now">
          <b>${st.level == null ? '—' : wlM(st.level)}</b>
          <span>${st.level == null ? esc(c.en) : esc(gap)}</span>
        </div>
        <div class="wl-ladder">${rungs}</div>
        <table class="pop-tbl">
          <tr><td>Reading taken</td><td class="num">${esc(st.updated || '—')}</td></tr>
          ${st.trend ? `<tr><td>Trend</td><td class="num">${esc(st.trend)}</td></tr>` : ''}
          <tr><td>Sub-basin<div class="pop-sub">${esc(st.district)}</div></td>
            <td class="num">${esc(st.sub)}</td></tr>
          <tr><td>JPS station</td><td class="num">${esc(st.id)}</td></tr>
        </table>
        <div class="pop-hint">Snapshot from JPS InfoBanjir, not a live feed.${
          st.inCatchment ? '' : ' JPS files this station under the Langat basin;'
          + ' it sits outside the HydroSHEDS catchment this map is drawn to.'}</div>
      </div>
    </div>`;
}

/* The nearest receiving water among the layers currently switched on. With
   the ponds hidden this returns the nearest river, because naming a pond the
   reader cannot see would be answering a question they did not ask. */
function nearestVisible(p) {
  let best = null;
  for (const [key, v] of Object.entries(p.near ?? {})) {
    if (!visible.has(key)) continue;
    if (!best || v.d < best.d) best = { ...v, key };
  }
  return best;
}

/* The closest of all, regardless of what is shown. `near` comes out of the
   ETL sorted by distance, so the first entry is it. */
function overallNearest(p) {
  return Object.values(p.near ?? {})[0] ?? null;
}

/* Rivers are a receiving water as much as ponds are, so both count here. */
function anyWaterVisible() {
  return [...(MASTERS.water ?? []), ...(MASTERS.rivers ?? [])].some((k) => visible.has(k));
}

const metres = (m) => `${Math.round(m).toLocaleString('en')} m`;

const PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
  + ' stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/>'
  + '<circle cx="12" cy="10" r="2.8"/></svg>';

function sourcePopup(p, c) {
  const to = nearestVisible(p);
  const kind = to ? to.key.split(':')[0] : null;
  const flashKey = to ? `${kind}:${to.id}` : null;
  const hidden = to && to.d !== p.dist;     /* a nearer one is switched off */
  const buffer = DATA.sources?.meta?.buffer_m ?? 1500;

  let hint = '';
  if (!to) {
    hint = anyWaterVisible()
      ? 'Nothing on the layers shown is within reach of this site.'
      : `No water layer is switched on. The overall nearest is ${metres(p.dist)}.`;
  } else if (hidden) {
    hint = `Nearest among the layers shown. The overall nearest is `
      + `${metres(p.dist)}, on a layer that is hidden.`;
    if (to.d > buffer) {
      hint += ` This one is beyond the ${metres(buffer)} riparian zone.`;
    }
  }

  return `
    <div class="map-pop">
      <div class="pop-head" style="background:${c.color}">
        <div class="pop-code">${esc(c.label)}</div>
        <div class="pop-name">${p.name ? esc(p.name) : 'Unnamed site'}</div>
      </div>
      <div class="pop-body">
        <table class="pop-tbl">
          ${to ? `<tr>
            <td>Nearest water<div class="pop-sub">${esc(to.n)}</div></td>
            <td class="num">${metres(to.d)}
              ${receiving.has(flashKey)
                ? `<button class="pin-btn" data-flash="${flashKey}"
                     data-at="${p.at[1]},${p.at[0]}"
                     title="Show ${esc(to.n)} on the map">${PIN}</button>` : ''}
            </td></tr>`
          : ''}
          <tr><td>Screening risk</td>
            <td class="num" title="Scaled from the overall nearest water, ${metres(p.dist)}">
              ${p.risk.toFixed(2)} / 5</td></tr>
        </table>
        ${hint ? `<div class="pop-hint">${hint}</div>` : ''}
        ${licenceBlock(p.id)}
        <div class="pop-pol"><b>Typically carries</b><br>${esc(c.pol)}</div>
        <div class="pop-note">Screening only \u2014 no discharge here is metered</div>
      </div>
    </div>`;
}

/* What is known about the licence at this premises. Where the register has
   an entry the map must not disagree with the licence page about the same
   place; everywhere else the status is the estimate that coloured the
   symbol, and it says so. */
function licenceBlock(srcId) {
  const st = licenceStatus(srcId);
  const l = st.licence;
  if (!l || l.example) {
    const badge = l ? (l.bulk ? 'ESTIMATED' : 'EXAMPLE')
      : (st.estimated ? 'ESTIMATED' : 'NOT IN REGISTER');
    return `
    <div class="pop-lic ${st.licensed ? 'ok' : 'none'}">
      <b>${st.licensed ? 'Licensed' : 'No discharge licence'}
        <span class="est-dot">${badge}</span></b>
      ${l ? `${esc(l.ref)} · ${(l.flow ?? 0).toLocaleString('en')} m³/day permitted`
          : 'No licence register is published, so this status is an assumption, not a record.'}
    </div>`;
  }
  const total = ['bod', 'cod', 'ss', 'an']
    .reduce((t, k) => t + (l.conc?.[k] ?? 0) * (l.flow ?? 0) / 1000, 0);
  return `
    <div class="pop-lic ${st.licensed ? 'ok' : 'none'}">
      <b>${st.licensed ? 'Licensed' : 'Licence suspended'} · ${esc(l.ref)}${l.estimated ? ' <span class="est-dot">EST</span>' : ''}</b>
      ${(l.flow ?? 0).toLocaleString('en')} m³/day at Standard ${esc(l.standard ?? 'A')}
      · ${total.toFixed(1)} kg/day permitted
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

  /* The popup is anchored to the source and the water is within 1.5 km of
     it, so the water very often lies under the popup — and panning cannot
     help, because the two move together. For the length of the flash the
     popup steps aside without closing: the reader sees the water through it,
     keeps their place, and it comes back on its own. */
  const pop = openPopup?.getElement();
  if (pop) {
    pop.classList.add('peek');
    setTimeout(() => pop.classList.remove('peek'), 3300);
  }
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
  set(flowLayer, visible.has('flow:anim'));
  set(waterFlowLayer, visible.has('flow:water'));
  syncStill();
  set(licenceLayer, visible.has('licence:all'));
  riverLayers.main?.bringToFront();
  flowLayer?.bringToFront();
  for (const [k, l] of Object.entries(waterLayers)) set(l, visible.has(`water:${k}`));
  for (const [k, l] of Object.entries(sourceLayers)) set(l, visible.has(`src:${k}`));
  for (const [k, l] of Object.entries(levelLayers)) set(l, visible.has(`wl:${k}`));

  repaint();
  syncControls();

  /* An open source popup answers "nearest water" from the visible layers, so
     it has to be re-run when they change. update() re-invokes the content
     function; the buttons inside are new elements, so re-wire them. */
  if (openPopup) {
    openPopup.update();
    wirePopup(openPopup);
  }
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
  /* The legend group masters read back from their rows the same way */
  document.querySelectorAll('.ml-master').forEach((box) => {
    const rows = [...document.querySelectorAll(`#${box.dataset.group} [data-vis]`)];
    const on = rows.filter((r) => visible.has(r.dataset.vis)).length;
    box.checked = on > 0;
    box.indeterminate = on > 0 && on < rows.length;
  });
}

/* ---------------- Everything that depends on the month ---------------- */
function repaint() {
  paintStations();
  paintLicences();
  paintKpis();
}

/* Every licence that carries a position. A licence is granted to a place, and
   a place can be shown; one entered without coordinates simply is not drawn,
   and the register says so. */
function paintLicences() {
  if (!licenceLayer) return;
  licenceLayer.clearLayers();
  licenceMarkers.length = 0;

  for (const l of store.licences()) {
    if (typeof l.lat !== 'number' || typeof l.lon !== 'number') continue;
    if (l.bulk) continue;     /* the estimate is the symbol's colour, not a ring */
    const off = l.active === false;
    /* A premises taken from the map is already drawn as a point source, so the
       licence rings it rather than covering it with a second marker. */
    const onMap = l.srcId != null && receiving !== null && sourceIds.has(l.srcId);
    const icon = onMap
      ? L.divIcon({
        className: '',
        html: `<div class="lic-ring${off ? ' off' : ''}"><i>L</i></div>`,
        iconSize: [30, 30], iconAnchor: [15, 15],
      })
      : L.divIcon({
        className: '',
        html: `<div class="lic-pin${off ? ' off' : ''}${l.example ? ' eg' : ''}">L</div>`,
        iconSize: [22, 22], iconAnchor: [11, 11],
      });

    if (onMap) {
      /* The ring is a mark on a marker that is already there and already
         clickable. Taking the click would hide the source's own popup — which
         is where the licence is now shown. */
      L.marker([l.lat, l.lon], { zIndexOffset: 420, icon, interactive: false })
        .addTo(licenceLayer);
    } else {
      const m = L.marker([l.lat, l.lon], { zIndexOffset: 500, icon })
        .bindTooltip(`<b>${esc(l.premises)}</b><br>${esc(l.ref)}`,
          { direction: 'top', offset: [0, -12] })
        .bindPopup(() => licencePopup(l), POPUP)
        .addTo(licenceLayer);
      licenceMarkers.push({ lat: l.lat, lon: l.lon, marker: m });
    }
  }

  /* Every point source is coloured by whether it holds a licence: green with
     one, red without. The register decides where it has an entry; everywhere
     else the status is an estimate (see licenceStatus.js). The shape still
     says what the premises is. A class on the marker carries the colour, so
     all 651 recolour without one of them being redrawn. */
  let on = 0, off = 0;
  for (const [sid, m] of sourceMarkers) {
    const st = licenceStatus(sid);
    if (st.licensed) on += 1; else off += 1;
    m.options.icon.options.className = st.licensed ? 'src-sym lic' : 'src-sym';  /* for its next add */
    const el = m.getElement();
    if (el) el.classList.toggle('lic', st.licensed);
  }
  const a = $('legLicN'), b = $('legNoLicN');
  if (a) a.textContent = on.toLocaleString('en');
  if (b) b.textContent = off.toLocaleString('en');
  countLicences();
}

/* How many register entries are drawn: the rings and pins, not the estimate */
function countLicences() {
  const n = licenceLayer?.getLayers().length ?? 0;
  const a = $('ovLicences');
  if (a) a.textContent = n;
}

function licencePopup(l) {
  const load = (c) => ((c ?? 0) * (l.flow ?? 0) / 1000);
  const rows = [['BOD₅', 'bod'], ['COD', 'cod'], ['SS', 'ss'], ['NH₃-N', 'an']];
  return `
    <div class="map-pop">
      <div class="pop-head" style="background:#22235f">
        <div class="pop-code">Licence ${esc(l.ref)}${l.example ? ' · example' : ''}</div>
        <div class="pop-name">${esc(l.premises)}</div>
      </div>
      <div class="pop-body">
        <table class="pop-tbl">
          <tr><td>Category</td><td class="num">${esc(l.category ?? '—')}</td></tr>
          <tr><td>Permitted flow</td><td class="num">${(l.flow ?? 0).toLocaleString('en')} m³/day</td></tr>
          ${rows.map(([lab, k]) => `<tr><td>${lab} wasteload</td>
            <td class="num">${load(l.conc?.[k]).toFixed(1)} kg/day</td></tr>`).join('')}
        </table>
        <div class="pop-verdict ${l.active === false ? 'bad' : 'ok'}">
          ${l.active === false ? 'Inactive' : 'Active licence'}</div>
      </div>
    </div>`;
}

/* Take the map to a premises. Called after the view has switched, so the map
   exists by then; if it does not, the target is held until it does. */
let pendingFly = null;

/* Going to a premises means being shown it, not being left near it: the marker
   there is opened once the map has settled. */
export function flyToPoint(lat, lon, zoom = 16, srcId = null) {
  if (!map) { pendingFly = [lat, lon, zoom, srcId]; return; }

  /* A marker on a switched-off layer is not there to open */
  const src = srcId != null
    ? sourceSummary().features.find((f) => f.properties.id === srcId) : null;
  if (src && !visible.has(`src:${src.properties.cat}`)) {
    visible.add(`src:${src.properties.cat}`);
    applyVisibility();
  }

  map.flyTo([lat, lon], Math.max(map.getZoom(), zoom), { duration: 0.8 });

  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    const marker = sourceMarkers.get(srcId) ?? nearestLicenceMarker(lat, lon);
    marker?.openPopup();
  };
  /* flyTo fires moveend when it settles, but not if it had nowhere to go */
  map.once('moveend', open);
  setTimeout(open, 1000);
}

/* A licence entered by coordinate has no id to look up, so it is found by
   where it is — within about 20 m, which is closer than two premises get. */
function nearestLicenceMarker(lat, lon) {
  let best = null, bd = 20;
  for (const l of licenceMarkers) {
    const d = map.distance([lat, lon], [l.lat, l.lon]);
    if (d <= bd) { bd = d; best = l.marker; }
  }
  return best;
}

/* The form offers the map centre as a starting coordinate */
export function mapCentre() {
  if (!map) return null;
  const c = map.getCenter();
  return [c.lat, c.lng];
}

function paintStations() {
  if (!stationLayer) return;
  stationLayer.clearLayers();
  stationMarkers.clear();
  const target = store.conditions().targetClass;

  for (const st of DATA.stations) {
    const r = readingAt(st, monthIdx);
    const cls = wqiClass(r.wqi);
    if (!visible.has(`wqi:${cls.id}`)) continue;      /* filtered out in the legend */
    const comp = classCompliance(r.raw, target);
    const focus = st.code === DATA.focus.code;

    const marker = L.marker([st.lat, st.lon], {
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
      .bindPopup(stationPopup(st, r, cls, comp, target), POPUP)
      .addTo(stationLayer);
    stationMarkers.set(st.code, marker);
  }
}

/* The four chips describe the map as it stands, not the latest reading, so
   they move with the slider. */
/* The station total, then the count in each WQI class this month. Two cards,
   because the total is a fact about the network and the counts are a reading
   of one month — they answer different questions.

   The class boxes filter, like the legend rows they mirror. */
function paintKpis() {
  const counts = Object.fromEntries(WQI_CLASSES.map((c) => [c.id, 0]));
  for (const st of DATA.stations) {
    counts[wqiClass(readingAt(st, monthIdx).wqi).id]++;
  }
  const n = DATA.stations.length;

  const item = (c) => `
    <button class="cl-item${visible.has(`wqi:${c.id}`) ? '' : ' off'}"
      data-vis="wqi:${c.id}"
      title="Class ${c.id} — ${esc(c.status)}: ${counts[c.id]} of ${n} stations · ${esc(c.use)}">
      <span class="cl-b" style="background:${c.color}">${c.id}</span>
      <span class="cl-n">${counts[c.id]}</span>
    </button>`;

  $('mapKpis').innerHTML = `
    <div class="mkpi">
      <span class="mk-ic" style="background:#22235f">◉</span>
      <span><span class="mk-v">${n}</span><span class="mk-l">Stations</span></span>
    </div>
    <div class="mkpi classcard">
      ${WQI_CLASSES.map(item).join('')}
    </div>`;
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
        <button class="pop-btn" data-goto="${esc(st.code)}">
          ${st.code === DATA.focus.code
            ? 'Open the assessment →'
            : `Assess ${esc(st.name)} instead →`}</button>
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

  map.on('popupopen', (e) => { openPopup = e.popup; wirePopup(e.popup); });
  map.on('popupclose', () => { openPopup = null; clearTrace(); });
}

/* Popup markup is rebuilt on every open and on every layer toggle, so its
   buttons are fresh elements each time and have to be wired each time. */
function wirePopup(popup) {
  const root = popup.getElement();
  const goto = root?.querySelector('[data-goto]');
  if (goto) {
    goto.onclick = () => {
      map.closePopup();
      document.dispatchEvent(new CustomEvent('gotophase',
        { detail: { view: 'station', station: goto.dataset.goto } }));
    };
  }
  const pin = root?.querySelector('[data-flash]');
  if (pin) {
    pin.onclick = () => showReceiving(
      pin.dataset.flash,
      pin.dataset.at ? pin.dataset.at.split(',').map(Number) : null);
  }
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
  $('ovLevels').textContent = (DATA.levels?.stations ?? []).length;
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

  const lv = DATA.levels?.stations ?? [];
  $('mapLegendWhen').textContent = DATA.levels?.latest ? `as at ${DATA.levels.latest}` : '';
  $('mapLegendLevels').innerHTML = LEVEL_ORDER
    .map((k) => [k, lv.filter((x) => x.status === k).length])
    .filter(([, n]) => n)
    .map(([k, n]) => row(`wl:${k}`,
      `<span class="ml-gauge" style="--wc:${LEVEL_STATUS[k].color}"></span>`,
      esc(LEVEL_STATUS[k].label), n, LEVEL_STATUS[k].en)).join('');

  const su = sourceSummary();
  /* The shape is the category; the colour on the map is licence status, so
     the swatch is drawn neutral rather than in a colour no marker wears. */
  $('mapLegendSources').innerHTML = Object.entries(su.cats)
    .filter(([k]) => su.groups[k]?.n)
    .map(([k, c]) => row(`src:${k}`, sourceSwatch(c.shape, '#5c6480', 16),
      esc(c.label), su.groups[k].n, c.pol)).join('')
    + `<div class="ml-key" title="Where the register has an entry the colour follows it. Everywhere else it is an estimate: no licence register is published as open data.">
        <span><i class="ml-dot lic-on"></i>Licensed <b id="legLicN">0</b></span>
        <span><i class="ml-dot lic-off"></i>No licence <b id="legNoLicN">0</b></span>
        <span class="est-dot">ESTIMATED</span>
      </div>`;

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
      `${riverLayers.trib?.getLayers().length ?? 0} reaches`)
    + row('flow:anim', '<span class="ml-line flowkey"></span>', 'Flow direction',
      'downstream')
    + row('flow:water', '<span class="ml-ring stillkey"></span>', 'Water body flow',
      'still water turns in place',
      'Read off the mapped rivers. A body a river passes through carries the river\'s own '
      + 'flow; one that drains to a channel shows the run out to it; a turning ring marks '
      + 'standing water that no mapped river enters or leaves, so nothing in the data says '
      + 'its water moves. Rings are drawn from zoom 13.');

  countLicences();

  document.querySelectorAll('[data-vis]').forEach((b) => {
    b.onclick = () => toggle(b.dataset.vis);
  });

  /* Each group heading is a master for the rows under it: everything on, or
     everything off. It works off the rows actually rendered in the group, so
     Boundaries — which spans four of the layer-card masters — needs no map of
     its own, and a group that gains a row gains it here too. */
  document.querySelectorAll('.ml-master').forEach((box) => {
    box.onchange = () => {
      for (const r of document.querySelectorAll(`#${box.dataset.group} [data-vis]`)) {
        if (box.checked) visible.add(r.dataset.vis); else visible.delete(r.dataset.vis);
      }
      applyVisibility();
    };
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

/* ---------------- Where the water goes ----------------
   OSM draws a waterway in the direction it flows, and the ETL turned that into
   `next` (the reach below) and `nexti` (the vertex it joins at). Walking that
   chain answers the question a spill actually raises: where does this end up? */
function flowChain(startId) {
  const out = [];
  const seen = new Set();
  let id = startId, at = 0;

  while (id != null && !seen.has(id)) {
    seen.add(id);
    const t = receiving.get(`river:${id}`);
    if (!t?.layer?.feature) break;
    const r = t.layer.feature.properties;
    const part = t.layer.feature.geometry.coordinates.slice(at);
    if (part.length > 1) out.push({ name: r.name, main: !!r.main, part });
    at = r.nexti ?? 0;
    id = r.next;
  }
  return out;
}

const MPD = 111320;
function partKm(part) {
  let m = 0;
  for (let i = 1; i < part.length; i++) {
    const [x1, y1] = part[i - 1], [x2, y2] = part[i];
    const kx = Math.cos((y1 + y2) / 2 * Math.PI / 180) * MPD;
    m += Math.hypot((x2 - x1) * kx, (y2 - y1) * MPD);
  }
  return m / 1000;
}

function flowSummary(id) {
  const chain = flowChain(id);
  const names = [];
  for (const c of chain) {
    if (c.name && names[names.length - 1] !== c.name) names.push(c.name);
  }
  return {
    chain,
    names,
    km: chain.reduce((t, c) => t + partKm(c.part), 0),
    reaches: chain.length,
    toSea: chain.some((c) => c.main),
  };
}

function clearTrace() {
  if (traceLayer) { map.removeLayer(traceLayer); traceLayer = null; }
}

function drawTrace(id) {
  clearTrace();
  const { chain } = flowSummary(id);
  if (chain.length < 2) return;
  traceLayer = L.layerGroup(chain.map((c) => L.polyline(
    c.part.map(([x, y]) => [y, x]),
    { color: '#f5e01c', weight: 5, opacity: 0.9, interactive: false },
  ))).addTo(map);
  traceLayer.eachLayer((l) => l.bringToFront());
}

function riverPopup(r) {
  const f = flowSummary(r.id);
  const down = f.names.slice(1);            /* the first name is this reach */

  return `
    <div class="map-pop">
      <div class="pop-head" style="background:${r.main ? '#0aa3d9' : '#45bfe0'}">
        <div class="pop-code">${r.main ? 'Main channel' : 'Tributary'}</div>
        <div class="pop-name">${r.name ? esc(r.name) : 'Unnamed river'}</div>
      </div>
      <div class="pop-body">
        <table class="pop-tbl">
          <tr><td>This reach</td><td class="num">${(r.m / 1000).toFixed(1)} km</td></tr>
          <tr><td>Downstream</td><td class="num">${f.km.toFixed(1)} km</td></tr>
          <tr><td>Reaches crossed</td><td class="num">${f.reaches}</td></tr>
          <tr><td>Draining through here
            <div class="pop-sub">line width is scaled from this</div></td>
            <td class="num">${r.up < 1000 ? metres(r.up) : `${(r.up / 1000).toFixed(1)} km`}</td></tr>
        </table>
        ${down.length
          ? `<div class="pop-flow"><b>Flows into</b>
              <span>${down.map(esc).join(' → ')}</span></div>`
          : ''}
        <div class="pop-${f.toSea ? 'hint' : 'note'}">${f.toSea
          ? 'Joins Sungai Langat and on to the Strait of Malacca.'
          : 'The mapped network ends here — the reach below was not mapped, or falls outside the catchment.'}</div>
      </div>
    </div>`;
}

/* ---------------- Search ----------------
   One index over everything drawn, built once. Names are what people have to
   go on: a station code, a river, a factory. Anything unnamed is left out —
   an entry reading "Pond" 600 times is a worse list than a shorter one. */
function buildSearch() {
  const idx = [];

  for (const st of DATA.stations) {
    idx.push({
      kind: 'station', id: st.code, at: [st.lat, st.lon],
      label: `${st.name} · ${st.code}`,
      sub: `${st.river} · ${st.district}`,
      hay: `${st.name} ${st.code} ${st.river} ${st.district}`.toLowerCase(),
      ic: '◉', color: '#22235f',
    });
  }

  for (const f of DATA.rivers.features) {
    const r = f.properties;
    if (!r.name || r.id == null) continue;
    const c = f.geometry.coordinates;
    const mid = c[c.length >> 1];
    idx.push({
      kind: 'river', id: r.id, at: [mid[1], mid[0]],
      label: r.name,
      sub: `${(r.m / 1000).toFixed(1)} km${r.main ? ' · main channel' : ''}`,
      hay: r.name.toLowerCase(),
      ic: '~', color: r.main ? '#0aa3d9' : '#45bfe0',
    });
  }

  for (const b of DATA.water.bodies) {
    if (!b.name || b.id == null) continue;
    const g = WATER_GROUPS[b.group] ?? WATER_GROUPS.other;
    idx.push({
      kind: 'water', id: b.id, at: [b.lat, b.lon],
      label: b.name,
      sub: `${g.label} · ${(b.area_m2 / 1e4).toFixed(1)} ha`,
      hay: `${b.name} ${g.label}`.toLowerCase(),
      ic: '○', color: g.color,
    });
  }

  for (const st of DATA.levels?.stations ?? []) {
    const c = LEVEL_STATUS[st.status] ?? LEVEL_STATUS.offline;
    idx.push({
      kind: 'level', id: st.id, at: [st.lat, st.lon],
      label: st.name,
      sub: `Water level · ${levelLine(st)}`,
      hay: `${st.name} ${st.sub} ${st.district} ${st.id} aras air water level`.toLowerCase(),
      ic: '▮', color: c.color,
    });
  }

  const su = sourceSummary();
  for (const f of su.features) {
    const q = f.properties;
    if (!q.name) continue;
    const c = su.cats[q.cat];
    idx.push({
      kind: 'source', id: q.id, at: [f.geometry.coordinates[1], f.geometry.coordinates[0]],
      label: q.name,
      sub: c ? c.label : 'Point source',
      hay: `${q.name} ${c ? c.label : ''}`.toLowerCase(),
      ic: '■', color: c ? c.color : '#4a3aa7',
    });
  }

  searchIndex = idx;

  const box = $('mapSearch');
  const list = $('mapSearchList');
  let hits = [];
  let cursor = -1;

  const close = () => { list.hidden = true; cursor = -1; };

  const render = () => {
    if (!hits.length) {
      list.innerHTML = '<div class="ms-none">Nothing on the map matches that.</div>';
      list.hidden = false;
      return;
    }
    const shown = hits.slice(0, 12);
    list.innerHTML = shown.map((h, i) => `
      <button class="ms-item${i === cursor ? ' on' : ''}" data-i="${i}">
        <span class="ms-ic" style="background:${h.color}">${h.ic}</span>
        <span class="ms-t"><b>${esc(h.label)}</b><span>${esc(h.sub)}</span></span>
      </button>`).join('')
      + (hits.length > shown.length
        ? `<div class="ms-more">${hits.length - shown.length} more — keep typing</div>` : '');
    list.hidden = false;
  };

  const search = (q) => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) { hits = []; close(); return; }
    /* Stations first, then rivers, then the rest: a code or a river name is
       almost always what someone is after. */
    const rank = { station: 0, river: 1, water: 2, source: 3 };
    hits = searchIndex
      .filter((h) => h.hay.includes(t))
      .sort((a, b) => (rank[a.kind] - rank[b.kind])
        || (a.hay.indexOf(t) - b.hay.indexOf(t))
        || a.label.localeCompare(b.label));
    cursor = -1;
    render();
  };

  const pick = (h) => {
    if (!h) return;
    box.value = h.label;
    close();
    locate(h);
  };

  box.oninput = () => search(box.value);
  box.onfocus = () => { if (box.value.trim().length >= 2) search(box.value); };
  box.onkeydown = (e) => {
    if (e.key === 'Escape') { close(); box.blur(); return; }
    if (!hits.length) return;
    const last = Math.min(hits.length, 12) - 1;
    if (e.key === 'ArrowDown') { cursor = cursor >= last ? 0 : cursor + 1; render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { cursor = cursor <= 0 ? last : cursor - 1; render(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(hits[cursor < 0 ? 0 : cursor]); e.preventDefault(); }
  };
  list.onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (b) pick(hits[+b.dataset.i]);
  };
  document.addEventListener('click', (e) => {
    if (!$('mapSearchBox').contains(e.target)) close();
  });

  const wrap = $('mapSearchBox');
  L.DomEvent.disableClickPropagation(wrap);
  L.DomEvent.disableScrollPropagation(wrap);
}

/* Take the map to a search hit and make it obvious which one it is. If its
   layer has been filtered out, switch it back on — being shown the thing is
   the whole point of asking for it. */
function locate(h) {
  if (!map) return;

  if (h.kind === 'station') {
    const st = DATA.stations.find((x) => x.code === h.id);
    const cls = wqiClass(readingAt(st, monthIdx).wqi);
    if (!visible.has(`wqi:${cls.id}`)) { visible.add(`wqi:${cls.id}`); applyVisibility(); }
    map.flyTo(h.at, Math.max(map.getZoom(), 13), { duration: 0.7 });
    map.once('moveend', () => stationMarkers.get(h.id)?.openPopup());
    return;
  }

  if (h.kind === 'level') {
    const st = (DATA.levels?.stations ?? []).find((x) => x.id === h.id);
    const key = `wl:${st?.status}`;
    if (st && !visible.has(key)) { visible.add(key); applyVisibility(); }
    map.flyTo(h.at, Math.max(map.getZoom(), 14), { duration: 0.7 });
    map.once('moveend', () => levelMarkers.get(h.id)?.openPopup());
    return;
  }

  if (h.kind === 'source') {
    const f = sourceSummary().features.find((x) => x.properties.id === h.id);
    const key = `src:${f?.properties.cat}`;
    if (f && !visible.has(key)) { visible.add(key); applyVisibility(); }
    map.flyTo(h.at, Math.max(map.getZoom(), 15), { duration: 0.7 });
    map.once('moveend', () => sourceMarkers.get(h.id)?.openPopup());
    return;
  }

  showReceiving(`${h.kind}:${h.id}`, h.at);
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
