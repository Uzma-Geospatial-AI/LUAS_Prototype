/* ============================================================
   satellite.js — Satellite observation view
   Key-free open sources:
     · NASA GIBS (WMTS)            — daily imagery, full time series
     · Esri / Google / EOX mosaics — high resolution, not daily
   ============================================================ */
import { DATA } from './data.js';
import { wqiColor, wqiClass } from './wqi.js';

let smap, activeSat = null, overlays = {}, currentKey = 'esri';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export const SAT_LAYERS = {
  esri: {
    label: 'Esri World Imagery',
    res: '≈ 0.3 – 1 m',
    kind: 'High-resolution mosaic (not daily)',
    use: 'Identify individual buildings, factories, retention ponds and riverside land use.',
    daily: false,
    make: () => L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics' }),
  },
  google: {
    label: 'Google Satellite',
    res: '≈ 0.15 – 1 m',
    kind: 'High-resolution mosaic (not daily)',
    use: 'Often the most recent high-resolution coverage of the Klang Valley — useful for ' +
         'confirming new development beside the river.',
    daily: false,
    make: () => L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'], maxZoom: 21, attribution: '&copy; Google' }),
  },
  s2cloudless: {
    label: 'Sentinel-2 Cloudless',
    res: '10 m',
    kind: 'Annual cloud-free mosaic',
    use: 'Radiometrically consistent multispectral base — the correct starting point for ' +
         'computing NDWI, NDTI and other water indices.',
    daily: false,
    make: () => L.tileLayer(
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/{z}/{y}/{x}.jpg',
      { maxZoom: 16, attribution: 'Sentinel-2 cloudless 2021 by EOX (modified Copernicus Sentinel data)' }),
  },
  modis_terra: {
    label: 'MODIS Terra — True Colour',
    res: '250 m',
    kind: 'Daily · ~10:30 local time',
    use: 'Basin-scale monitoring: sediment plumes at the estuary, cloud cover, flood events.',
    daily: true, id: 'MODIS_Terra_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg',
  },
  modis_aqua: {
    label: 'MODIS Aqua — True Colour',
    res: '250 m',
    kind: 'Daily · ~13:30 local time',
    use: 'Midday pass — useful when the morning overpass is obscured by cloud.',
    daily: true, id: 'MODIS_Aqua_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg',
  },
  viirs: {
    label: 'VIIRS NOAA-20 — True Colour',
    res: '250 m',
    kind: 'Daily · sharper than MODIS',
    use: 'The most current daily observation of estuary turbidity and sediment plumes.',
    daily: true, id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg',
  },
  bands721: {
    label: 'MODIS — False Colour (7-2-1)',
    res: '250 m',
    kind: 'Daily · shortwave infrared composite',
    use: 'Water appears dark blue/black, making it easy to separate water from land, and to ' +
         'detect flooding, bare soil and burn scars.',
    daily: true, id: 'MODIS_Terra_CorrectedReflectance_Bands721', max: 9, ext: 'jpg',
  },
  nightlights: {
    label: 'VIIRS — Night Lights',
    res: '500 m',
    kind: 'Daily · day-night band',
    use: 'A proxy for urban density and industrial activity, which correlates with the domestic ' +
         'sewage load along the river corridor.',
    daily: true, id: 'VIIRS_SNPP_DayNightBand_At_Sensor_Radiance', max: 8, ext: 'png',
  },
};

/* Spectral water indices — methodology reference */
export const WATER_INDICES = [
  { name: 'NDWI — Normalised Difference Water Index', formula: '(Green − NIR) / (Green + NIR)',
    ramp: 'linear-gradient(90deg,#8a6d3b,#e8e3d2,#45bfe0,#0a4a8a)',
    lo: 'Land (−1)', hi: 'Water (+1)',
    body: 'Delineates the extent of water bodies. Used to track changes in reservoir area, ' +
          'ex-mining ponds and river margins between the dry season and the monsoon.' },
  { name: 'NDTI — Normalised Difference Turbidity Index', formula: '(Red − Green) / (Red + Green)',
    ramp: 'linear-gradient(90deg,#0a4a8a,#45bfe0,#e8e3d2,#c98a3a,#7a4a12)',
    lo: 'Clear', hi: 'Very turbid',
    body: 'A proxy for suspended solids (SS). High values at the Langat estuary after heavy rain ' +
          'point to erosion from construction sites and bare ground upstream.' },
  { name: 'NDCI — Chlorophyll-a Index', formula: '(Red-Edge − Red) / (Red-Edge + Red)',
    ramp: 'linear-gradient(90deg,#1a3a6a,#2f8a4f,#b8d13a,#e8b81a,#d92d20)',
    lo: 'Low', hi: 'Algal bloom',
    body: 'Estimates algal biomass from nutrient enrichment (eutrophication). Requires the ' +
          'Sentinel-2 red-edge band. Closely tied to excess NH₃-N and phosphorus from sewage ' +
          'and agriculture.' },
  { name: 'LST — Land Surface Temperature', formula: 'Thermal sensing (TIR bands)',
    ramp: 'linear-gradient(90deg,#2a78d6,#45bfe0,#f5e01c,#ef7d1a,#d92d20)',
    lo: 'Cool', hi: 'Hot',
    body: 'Detects thermal discharge from factories and the urban heat island effect, both of ' +
          'which lower dissolved oxygen solubility in the river.' },
];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function initSat() {
  smap = L.map('satmap', { center: [2.955, 101.63], zoom: 10, zoomControl: false });
  L.control.zoom({ position: 'bottomright' }).addTo(smap);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(smap);

  overlays.river = L.geoJSON(DATA.river, {
    style: { color: '#f5e01c', weight: 2.6, opacity: 0.95 },
  }).addTo(smap);

  overlays.stations = L.layerGroup(
    DATA.stations.map((s) => {
      const w = s.latest.wqi;
      return L.circleMarker([s.lat, s.lon], {
        radius: 6, fillColor: wqiColor(w), color: '#fff', weight: 2, fillOpacity: 1,
      }).bindTooltip(`<b>${s.code}</b> ${esc(s.name)}<br>WQI ${w.toFixed(1)} · ${wqiClass(w).status}`,
        { direction: 'top' });
    })).addTo(smap);

  overlays.sources = L.layerGroup(
    DATA.sources.features
      .filter((f) => f.properties.dist <= 300 && f.properties.risk >= 3.2)
      .map((f) => L.circleMarker(
        [f.geometry.coordinates[1], f.geometry.coordinates[0]],
        { radius: 3.4, fillColor: DATA.srcCats[f.properties.cat].color,
          color: '#fff', weight: 0.7, fillOpacity: 0.9 })));

  /* Layer buttons */
  document.getElementById('satBtns').innerHTML = Object.entries(SAT_LAYERS)
    .map(([k, d]) => `<button class="base-btn" data-sat="${k}"
      style="padding:5px 10px" title="${esc(d.use)}">${d.label}</button>`).join('');

  const dateInput = document.getElementById('satDate');
  dateInput.value = iso(new Date(Date.now() - 2 * 864e5));   // GIBS lags ~1–2 days
  dateInput.max = iso(new Date(Date.now() - 864e5));
  dateInput.min = '2012-01-01';
  dateInput.onchange = () => setSat(currentKey);

  document.querySelectorAll('[data-sat]').forEach((b) => {
    b.onclick = () => setSat(b.dataset.sat);
  });
  document.querySelectorAll('[data-satov]').forEach((i) => {
    i.onchange = () => {
      const l = overlays[i.dataset.satov];
      if (i.checked) l.addTo(smap); else smap.removeLayer(l);
    };
  });

  document.getElementById('idxList').innerHTML = WATER_INDICES.map((x) => `
    <div class="idx-item">
      <div class="ii-h">${x.name}</div>
      <code style="display:inline-block;margin-top:5px">${x.formula}</code>
      <div class="ramp" style="background:${x.ramp}"></div>
      <div class="ramp-lbl"><span>${x.lo}</span><span>${x.hi}</span></div>
      <div class="ii-b">${x.body}</div>
    </div>`).join('');

  setSat('esri');
  return smap;
}

function setSat(key) {
  currentKey = key;
  const def = SAT_LAYERS[key];
  document.querySelectorAll('[data-sat]').forEach((x) =>
    x.classList.toggle('active', x.dataset.sat === key));

  if (activeSat) smap.removeLayer(activeSat);
  if (def.daily) {
    const date = document.getElementById('satDate').value;
    activeSat = L.tileLayer(
      `${GIBS}/${def.id}/default/${date}/GoogleMapsCompatible_Level${def.max}/{z}/{y}/{x}.${def.ext}`,
      { maxNativeZoom: def.max, maxZoom: 16, tileSize: 256, bounds: [[-85, -180], [85, 180]],
        attribution: 'NASA EOSDIS GIBS / Worldview' });
  } else {
    activeSat = def.make();
  }
  activeSat.addTo(smap);
  activeSat.bringToBack();

  document.getElementById('satDateRow').style.display = def.daily ? 'flex' : 'none';
  document.getElementById('satInfo').innerHTML = `
    <div style="font-size:13px;font-weight:650;margin-bottom:3px">${def.label}</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin:7px 0 9px">
      <span class="badge soft">Resolution ${def.res}</span>
      <span class="badge soft">${def.kind}</span>
    </div>
    <div style="font-size:11.5px;color:var(--muted);line-height:1.55">${def.use}</div>`;
}

export function resizeSat() { smap?.invalidateSize(); }
