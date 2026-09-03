/* ============================================================
   satellite.js — Satellite observation of the Dengkil reach (Phase 2)

   A compact viewer, not a general map. It shows the reach the Phase 1
   station sits on, with the Digital Earth water bodies drawn over the
   imagery so the ponds and treatment basins that receive discharge can be
   seen from above. Daily NASA GIBS layers carry a date picker for watching
   sediment plumes and flood events.
   ============================================================ */
import { DATA, waterSummary, WATER_GROUPS } from './data.js';
import { wqiClass } from './wqi.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export const IMAGERY = {
  esri: {
    label: 'Esri World Imagery', res: '≈ 0.3 – 1 m',
    src: 'Esri · Maxar · Earthstar Geographics',
    use: 'The sharpest openly available mosaic. Individual oxidation ponds, factory roofs and '
       + 'the river bank are all resolvable.',
    make: () => L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics' }),
  },
  google: {
    label: 'Google Satellite', res: '≈ 0.15 – 1 m', src: 'Google',
    use: 'Often the most recent high-resolution coverage of the Klang Valley — useful for '
       + 'confirming new development in the catchment.',
    make: () => L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'], maxZoom: 21, attribution: 'Imagery: © Google' }),
  },
  ghyb: {
    label: 'Google Hybrid', res: '≈ 0.15 – 1 m', src: 'Google',
    use: 'The same imagery with place and road names, for locating a specific premises.',
    make: () => L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'], maxZoom: 21, attribution: 'Imagery: © Google' }),
  },
  s2: {
    label: 'Sentinel-2 Cloudless', res: '10 m',
    src: 'EOX IT Services · ESA Copernicus (CC BY-NC-SA 4.0)',
    use: 'A cloud-free annual mosaic. Coarser, but radiometrically consistent — the correct '
       + 'base for computing the spectral indices below.',
    make: () => L.tileLayer(
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/{z}/{y}/{x}.jpg',
      { maxZoom: 16, attribution: 'Sentinel-2 cloudless 2021 by EOX (modified Copernicus Sentinel data)' }),
  },
  viirs: {
    label: 'VIIRS — daily', res: '250 m', daily: true,
    src: 'NASA EOSDIS GIBS · NOAA-20, daily',
    use: 'A same-week look at the reach. Too coarse for a single channel, but this is the layer '
       + 'that shows sediment plumes and flooding after heavy rain.',
    id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg',
  },
  bands721: {
    label: 'False colour 7-2-1 — daily', res: '250 m', daily: true,
    src: 'NASA EOSDIS GIBS · MODIS Terra, daily',
    use: 'Shortwave infrared composite. Water reads dark, which separates open water from land '
       + 'cleanly and exposes flooding and bare soil in the catchment.',
    id: 'MODIS_Terra_CorrectedReflectance_Bands721', max: 9, ext: 'jpg',
  },
};

/* Spectral indices that relate imagery to the WQI parameters */
export const WATER_INDICES = [
  { name: 'NDWI — Normalised Difference Water Index', formula: '(Green − NIR) / (Green + NIR)',
    ramp: 'linear-gradient(90deg,#8a6d3b,#e8e3d2,#45bfe0,#0a4a8a)', lo: 'Land (−1)', hi: 'Water (+1)',
    body: 'Delineates open water. Tracks how pond and reservoir area changes between the dry '
        + 'season and the monsoon — the storage that buffers load.' },
  { name: 'NDTI — Normalised Difference Turbidity Index', formula: '(Red − Green) / (Red + Green)',
    ramp: 'linear-gradient(90deg,#0a4a8a,#45bfe0,#e8e3d2,#c98a3a,#7a4a12)', lo: 'Clear', hi: 'Very turbid',
    body: 'A proxy for suspended solids. SS is one of the four pollutants in the Phase 3 budget, '
        + 'and it is the one imagery estimates best.' },
  { name: 'NDCI — Chlorophyll-a Index', formula: '(Red-Edge − Red) / (Red-Edge + Red)',
    ramp: 'linear-gradient(90deg,#1a3a6a,#2f8a4f,#b8d13a,#e8b81a,#d92d20)', lo: 'Low', hi: 'Algal bloom',
    body: 'Algal biomass from nutrient enrichment. Tied directly to the NH₃-N load, which is the '
        + 'binding pollutant at this station.' },
  { name: 'LST — Land Surface Temperature', formula: 'Thermal sensing (TIR bands)',
    ramp: 'linear-gradient(90deg,#2a78d6,#45bfe0,#f5e01c,#ef7d1a,#d92d20)', lo: 'Cool', hi: 'Hot',
    body: 'Thermal discharge and the urban heat island both lower dissolved oxygen solubility, '
        + 'which feeds straight back into the index.' },
];

let map = null, active = null, current = 'esri', overlays = {};

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function initSatellite() {
  if (map) { map.invalidateSize(); return; }
  const s = DATA.focus;

  map = L.map('satMap', { center: [s.lat, s.lon], zoom: 13, zoomControl: false });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  /* --- Station marker --- */
  const cls = wqiClass(s.latest.wqi);
  overlays.station = L.layerGroup([
    L.circle([s.lat, s.lon], {
      radius: (DATA.water?.meta?.radius_km ?? 15) * 1000,
      color: '#f5e01c', weight: 1.6, dashArray: '7 6', fill: false, interactive: false,
    }),
    L.marker([s.lat, s.lon], {
      icon: L.divIcon({
        className: '',
        html: `<div class="sat-stn" style="background:${cls.color}">${Math.round(s.latest.wqi)}</div>`,
        iconSize: [30, 30], iconAnchor: [15, 15],
      }),
    }).bindTooltip(
      `<b>${esc(s.code)} — ${esc(s.name)}</b><br>WQI ${s.latest.wqi.toFixed(1)} · ${cls.status}`,
      { direction: 'top', offset: [0, -14] }),
  ]).addTo(map);

  /* --- Digital Earth water bodies, sized by surface area --- */
  const w = waterSummary();
  overlays.water = L.layerGroup(w.bodies.map((b) => {
    const g = WATER_GROUPS[b.group] ?? WATER_GROUPS.other;
    /* Radius from area, so a 10 ha pond reads bigger than a 1 ha one */
    const r = Math.max(2.5, Math.min(18, Math.sqrt(b.area_m2 / Math.PI) / 7));
    return L.circleMarker([b.lat, b.lon], {
      radius: r, fillColor: g.color, color: '#fff', weight: 1.1, fillOpacity: 0.34,
    }).bindTooltip(
      `<b>${b.name ? esc(b.name) : 'Unnamed water body'}</b><br>`
      + `${esc(g.label)} · ${esc(b.kind)}<br>`
      + `${(b.area_m2 / 1e4).toFixed(2)} ha · ${b.km.toFixed(1)} km from the station`,
      { sticky: true });
  })).addTo(map);

  /* --- Controls --- */
  $('satLayers').innerHTML = Object.entries(IMAGERY)
    .map(([k, d]) => `<button class="sat-btn" data-sat="${k}" title="${esc(d.use)}">${d.label}</button>`)
    .join('');
  document.querySelectorAll('[data-sat]').forEach((b) => {
    b.onclick = () => setLayer(b.dataset.sat);
  });

  const date = $('satDate');
  date.value = iso(new Date(Date.now() - 2 * 864e5));   // GIBS lags ~1–2 days
  date.max = iso(new Date(Date.now() - 864e5));
  date.min = '2012-01-01';
  date.onchange = () => { if (IMAGERY[current].daily) setLayer(current); };

  document.querySelectorAll('[data-satov]').forEach((i) => {
    i.onchange = () => {
      const l = overlays[i.dataset.satov];
      if (i.checked) l.addTo(map); else map.removeLayer(l);
    };
  });

  $('satIndices').innerHTML = WATER_INDICES.map((x) => `
    <div class="idx-item">
      <div class="idx-h">${x.name}</div>
      <code>${x.formula}</code>
      <div class="idx-ramp" style="background:${x.ramp}"></div>
      <div class="idx-lab"><span>${x.lo}</span><span>${x.hi}</span></div>
      <div class="idx-b">${x.body}</div>
    </div>`).join('');

  setLayer('esri');
}

function setLayer(key) {
  current = key;
  const d = IMAGERY[key];
  document.querySelectorAll('[data-sat]').forEach((b) =>
    b.classList.toggle('active', b.dataset.sat === key));

  if (active) map.removeLayer(active);
  active = d.daily
    ? L.tileLayer(
      `${GIBS}/${d.id}/default/${$('satDate').value}/GoogleMapsCompatible_Level${d.max}/{z}/{y}/{x}.${d.ext}`,
      { maxNativeZoom: d.max, maxZoom: 16, tileSize: 256,
        bounds: [[-85, -180], [85, 180]], attribution: 'NASA EOSDIS GIBS / Worldview' })
    : d.make();
  active.addTo(map);
  active.bringToBack();

  $('satDateRow').style.display = d.daily ? 'flex' : 'none';
  $('satInfo').innerHTML = `
    <div class="sat-t">${d.label}</div>
    <div class="sat-badges">
      <span class="badge soft">Resolution ${d.res}</span>
      <span class="badge soft">${d.daily ? 'Daily' : 'Mosaic'}</span>
    </div>
    <div class="sat-s">${esc(d.src)}</div>
    <div class="sat-n">${esc(d.use)}</div>`;
}

export function resizeSatellite() { map?.invalidateSize(); }
