/* ============================================================
   mapview.js — Interactive WQI map for the Langat River Basin
   ============================================================ */
import { DATA, readingAt, pressureAround } from './data.js';
import { computeWQI, wqiClass, wqiColor, WQI_CLASSES, PARAM_META, paramStatus, siColor } from './wqi.js';
import { store } from './store.js';
import { GIBS_LAYERS, gibsLayer } from './satellite.js';
import { sourceIcon, sourceSwatch } from './symbols.js';

let map, layers = {}, base = {}, stationLayer, riverLayer, srcCluster;
let myReadingLayer, mySourceLayer, riverSegs = null;
let monthIdx = 0, selected = null, sparkChart = null, currentBase = 'osm';

const LANGAT_CENTER = [2.955, 101.63];
const STATION_ZOOM = 14.5;   // zoom level a selected station opens at

/* Drainage & sewerage styling. Man-made channels are drawn in violet so they
   never read as a natural watercourse (tributaries are blue); culverted reaches
   are dashed because they run underground. */
const SEWER_STYLE = {
  drain:    { color: '#8d6cd8', weight: 1.9, opacity: 0.95, label: 'Monsoon drain' },
  ditch:    { color: '#a894e0', weight: 1.2, opacity: 0.8,  label: 'Ditch' },
  pipeline: { color: '#c0399f', weight: 2.4, opacity: 0.95, label: 'Sewage / water pipeline' },
};

const BASE_ICON = {
  street: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3z"/><path d="M9 3v15M15 6v15"/></svg>',
  topo:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 18 6-9 4 5 3-4 5 8z"/></svg>',
  dark:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  light:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/></svg>',
  sat:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>',
};

/* ---------------- Base maps & satellite imagery ---------------- */
export const BASEMAPS = {
  /* --- Cartographic --- */
  osm: {
    label: 'Street Map', group: 'map', icon: 'street',
    res: 'Vector', src: 'OpenStreetMap',
    note: 'Full street map — best for identifying place and road names.',
    make: () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
  },
  topo: {
    label: 'Topographic', group: 'map', icon: 'topo',
    res: 'Vector + contours', src: 'OpenTopoMap',
    note: 'Contour lines and drainage channels — useful for understanding flow direction and catchment.',
    make: () => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, attribution: '&copy; OpenTopoMap (CC-BY-SA)' }),
  },
  dark: {
    label: 'Dark', group: 'map', icon: 'dark',
    res: 'Vector', src: 'CARTO Dark Matter',
    note: 'Low-contrast ground so the WQI colours and source markers carry all the emphasis.',
    make: () => L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, attribution: '&copy; OpenStreetMap, &copy; CARTO' }),
  },
  light: {
    label: 'Light', group: 'map', icon: 'light',
    res: 'Vector', src: 'CARTO Positron',
    note: 'Minimal pale ground — suits printing and report figures.',
    make: () => L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, attribution: '&copy; OpenStreetMap, &copy; CARTO' }),
  },

  /* --- Satellite / aerial --- */
  esri: {
    label: 'Esri World Imagery', group: 'sat', icon: 'sat',
    res: '≈ 0.3 – 1 m', src: 'Esri · Maxar · Earthstar Geographics',
    note: 'The highest-resolution openly available mosaic. Individual buildings, factory roofs, ' +
          'retention ponds and river banks are all distinguishable.',
    make: () => L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics' }),
  },
  clarity: {
    label: 'Esri Clarity', group: 'sat', icon: 'sat',
    res: '≈ 0.3 – 1 m', src: 'Esri World Imagery (Clarity)',
    note: 'An alternative capture of the same area, often from a different date. Compare against ' +
          'Esri World Imagery to spot land-use change.',
    make: () => L.tileLayer(
      'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Imagery: Esri Clarity, Maxar' }),
  },
  gsat: {
    label: 'Google Satellite', group: 'sat', icon: 'sat',
    res: '≈ 0.15 – 1 m', src: 'Google',
    note: 'Google satellite and aerial imagery without labels — often the most recent coverage of ' +
          'the Klang Valley. For production use, move to the official Google Maps Platform.',
    make: () => L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'], maxZoom: 21, attribution: 'Imagery: &copy; Google' }),
  },
  ghyb: {
    label: 'Google Hybrid', group: 'sat', icon: 'sat',
    res: '≈ 0.15 – 1 m', src: 'Google',
    note: 'Google imagery with road and place names on top — the easiest way to confirm a ' +
          'specific premises beside the river.',
    make: () => L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'], maxZoom: 21, attribution: 'Imagery: &copy; Google' }),
  },
  s2: {
    label: 'Sentinel-2 Cloudless', group: 'sat', icon: 'sat',
    res: '10 m', src: 'EOX IT Services · ESA Copernicus (CC BY-NC-SA 4.0)',
    note: 'A cloud-free annual mosaic from Sentinel-2. Coarser, but radiometrically consistent — ' +
          'the correct basis for spectral indices such as NDWI.',
    make: () => L.tileLayer(
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/{z}/{y}/{x}.jpg',
      { maxZoom: 16,
        attribution: 'Sentinel-2 cloudless 2021 by EOX (modified Copernicus Sentinel data)' }),
  },
};

/* Daily NASA GIBS imagery joins the same picker; those layers are rebuilt on
   every date change, so they are constructed lazily in setBase(). */
Object.assign(BASEMAPS, GIBS_LAYERS);

let labelOverlay = null;
const makeLabelOverlay = () => L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19, opacity: 0.92, attribution: 'Labels: Esri' });

function makeBases() {
  for (const [k, def] of Object.entries(BASEMAPS)) {
    if (!def.daily) base[k] = def.make();
  }
  return base;
}

const pad2 = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

/* ---------------- Helpers ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtKm = (m) => (m >= 1000 ? (m / 1000).toFixed(2) + ' km' : m + ' m');
const riskColor = (r) => (r >= 4 ? '#d92d20' : r >= 3 ? '#ef7d1a' : r >= 2 ? '#f2c40c' : '#17a04a');

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtMonth = (m) => `${MONTHS_EN[+m.split('-')[1] - 1]} ${m.split('-')[0]}`;

/* ---------------- Colouring the river by WQI ---------------- */
function nearestStation(lon, lat, list) {
  let best = null, bd = Infinity;
  for (const s of list) {
    const d = (s.lon - lon) ** 2 + (s.lat - lat) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function buildRiver() {
  const mains = DATA.stations.filter((s) => s.river === 'Sungai Langat');
  const feats = [];
  for (const f of DATA.river.features) {
    const c = f.geometry.coordinates;
    const STEP = 6;   // short runs so the colour grades along the reach
    for (let i = 0; i < c.length - 1; i += STEP) {
      const part = c.slice(i, Math.min(c.length, i + STEP + 1));
      if (part.length < 2) continue;
      const mid = part[Math.floor(part.length / 2)];
      feats.push({ coords: part.map((p) => [p[1], p[0]]), st: nearestStation(mid[0], mid[1], mains) });
    }
  }
  return feats;
}

function paintRiver() {
  riverLayer.clearLayers();
  for (const s of riverSegs) {
    const wqi = readingAt(s.st, monthIdx).wqi;
    L.polyline(s.coords, { color: '#12305a', weight: 8, opacity: 0.28, interactive: false })
      .addTo(riverLayer);
    L.polyline(s.coords, { color: wqiColor(wqi), weight: 4.5, opacity: 0.98 })
      .bindTooltip(
        `<b>Sungai Langat</b><br>Reference station: ${s.st.code} — ${esc(s.st.name)}` +
        `<br>WQI ${wqi.toFixed(1)} · ${wqiClass(wqi).label} (${wqiClass(wqi).status})`,
        { sticky: true })
      .on('click', () => selectStation(s.st))
      .addTo(riverLayer);
  }
}

/* ---------------- Station markers ---------------- */
function stationIcon(wqi, active) {
  const sz = active ? 26 : 20;
  return L.divIcon({
    className: '',
    html: `<div class="stn-marker" style="width:${sz}px;height:${sz}px;background:${wqiColor(wqi)};
      ${active ? 'box-shadow:0 0 0 5px rgba(34,35,95,.28),0 1px 6px rgba(0,0,0,.45);' : ''}
      display:grid;place-items:center;color:#fff;font:700 ${active ? 10 : 9}px 'JetBrains Mono',monospace;
      ">${Math.round(wqi)}</div>`,
    iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
  });
}

function paintStations() {
  stationLayer.clearLayers();
  for (const s of DATA.stations) {
    const r = readingAt(s, monthIdx);
    L.marker([s.lat, s.lon], {
      icon: stationIcon(r.wqi, selected?.code === s.code), zIndexOffset: 500,
    })
      .bindTooltip(`<b>${s.code}</b> — ${esc(s.name)}<br>WQI ${r.wqi.toFixed(1)} · ${wqiClass(r.wqi).status}`,
        { direction: 'top', offset: [0, -12] })
      .on('click', () => selectStation(s))
      .addTo(stationLayer);
  }
}

/* ---------------- Pollution sources ---------------- */
let srcFilter = new Set();
let maxDistFilter = 1500;

function paintSources() {
  srcCluster.clearLayers();
  const cats = DATA.srcCats;
  const marks = [];
  for (const f of DATA.sources.features) {
    const p = f.properties;
    if (!srcFilter.has(p.cat) || p.dist > maxDistFilter) continue;
    const cat = cats[p.cat];
    /* Size carries the risk score; shape and colour carry the category. */
    const size = Math.round(15 + p.risk * 2.2);
    const m = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {
      icon: sourceIcon(p.cat, cat.color, size),
      riseOnHover: true,
    });
    m.bindTooltip(`<b>${p.name ? esc(p.name) : esc(cat.label)}</b><br>${cat.icon} ${esc(cat.label)}
      · ${p.dist} m from water`, { direction: 'top', offset: [0, -size / 2] });
    m.bindPopup(
      `<div class="pop-head" style="background:${cat.color}">${cat.icon} ${esc(cat.label)}</div>
       <div class="pop">
         <div class="pt">${p.name ? esc(p.name) : '(unnamed in OSM)'}</div>
         <div class="ps">${esc(p.district ?? '—')} district · OSM ID ${p.id}</div>
         <div class="pr"><span>Distance to watercourse</span><span>${p.dist} m</span></div>
         ${p.dist_langat != null
        ? `<div class="pr"><span>Distance to Sg. Langat</span><span>${fmtKm(p.dist_langat)}</span></div>` : ''}
         <div class="pr"><span>Risk score</span><span style="color:${riskColor(p.risk)}">${p.risk.toFixed(2)} / 5</span></div>
         <div class="pr" style="display:block;margin-top:7px;border-top:1px solid #eef0f5;padding-top:7px">
           <span style="color:#5f6880;font-size:10.5px">PRINCIPAL POLLUTANTS</span><br>
           <span style="font-family:inherit;font-weight:500;font-size:11.5px">${esc(cat.pol)}</span>
         </div>
       </div>`, { maxWidth: 262 });
    marks.push(m);
  }
  srcCluster.addLayers(marks);
  const cnt = document.getElementById('srcCount');
  if (cnt) cnt.textContent = marks.length.toLocaleString('en-MY');
}

/* ---------------- User-entered data ---------------- */
export function paintUserData() {
  if (!myReadingLayer) return;

  myReadingLayer.clearLayers();
  for (const r of store.readings()) {
    if (typeof r.lat !== 'number' || typeof r.lon !== 'number') continue;
    const { wqi, si } = computeWQI(r);
    const c = wqiClass(wqi);
    L.marker([r.lat, r.lon], {
      zIndexOffset: 700,
      icon: L.divIcon({
        className: '',
        html: `<div style="width:21px;height:21px;background:${c.color};border:2.5px solid #fff;
          transform:rotate(45deg);box-shadow:0 1px 5px rgba(0,0,0,.45);display:grid;place-items:center">
          <span style="transform:rotate(-45deg);color:#fff;font:700 8.5px 'JetBrains Mono',monospace">
          ${Math.round(wqi)}</span></div>`,
        iconSize: [21, 21], iconAnchor: [10.5, 10.5],
      }),
    }).bindPopup(
      `<div class="pop-head" style="background:${c.color}">My reading · ${esc(r.t)}</div>
       <div class="pop">
         <div class="pt">${esc(r.stationName ?? r.station)}</div>
         <div class="ps">${esc(r.station)} · saved in this browser</div>
         <div class="pr"><span>WQI</span><span style="color:${c.color}">${wqi.toFixed(1)} · ${c.label}</span></div>
         ${Object.keys(PARAM_META).map((k) => `<div class="pr"><span>${PARAM_META[k].short}</span>
            <span>${r[k]}<b style="color:${siColor(si[k])};margin-left:6px">${si[k].toFixed(0)}</b></span></div>`).join('')}
       </div>`, { maxWidth: 262 }).addTo(myReadingLayer);
  }

  mySourceLayer.clearLayers();
  for (const s of store.sources()) {
    const cat = DATA.srcCats[s.cat] ?? { color: '#5f6880', label: s.cat, icon: '📍', pol: '—' };
    L.marker([s.lat, s.lon], {
      icon: sourceIcon(s.cat, cat.color, 26), zIndexOffset: 650, riseOnHover: true,
    }).bindPopup(
      `<div class="pop-head" style="background:${cat.color}">${cat.icon} ${esc(cat.label)}</div>
       <div class="pop">
         <div class="pt">${esc(s.name || '(unnamed)')}</div>
         <div class="ps">Reported by you · ${esc((s.created ?? '').slice(0, 10))}</div>
         <div class="pr"><span>Distance to watercourse</span><span>${s.dist != null ? s.dist + ' m' : '—'}</span></div>
         <div class="pr"><span>District</span><span>${esc(s.district ?? '—')}</span></div>
         <div class="pr"><span>Risk score</span><span style="color:${riskColor(s.risk ?? 0)}">${(s.risk ?? 0).toFixed(2)} / 5</span></div>
         ${s.note ? `<div class="pr" style="display:block;margin-top:7px;border-top:1px solid #eef0f5;padding-top:7px">
            <span style="color:#5f6880;font-size:10.5px">NOTES</span><br>
            <span style="font-family:inherit;font-weight:500;font-size:11.5px">${esc(s.note)}</span></div>` : ''}
       </div>`, { maxWidth: 262 }).addTo(mySourceLayer);
  }

  for (const [key, layer] of [['myReadings', myReadingLayer], ['mySources', mySourceLayer]]) {
    const input = document.querySelector(`[data-layer="${key}"]`);
    const row = input?.closest('.layer-item');
    if (!row) continue;
    const n = layer.getLayers().length;
    row.style.display = n ? 'flex' : 'none';
    row.querySelector('.cnt').textContent = n;
  }
}

/* ---------------- Station detail panel ---------------- */
export function selectStation(s, opts = {}) {
  selected = s;
  paintStations();
  const r = readingAt(s, monthIdx);
  const cls = wqiClass(r.wqi);
  const pr = pressureAround(s, 3);
  const cats = DATA.srcCats;
  const topCats = Object.entries(pr.counts).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const rows = Object.keys(PARAM_META).map((k) => {
    const m = PARAM_META[k];
    const v = r.raw[k], si = r.si[k], st = paramStatus(k, v);
    return `<tr>
      <td class="pn">${m.name}${m.unit ? `<span class="pu">${m.unit}</span>` : ''}</td>
      <td><span class="dot-st st-${st}"></span><span class="pv">${v}</span></td>
      <td>
        <span class="pv" style="color:${siColor(si)}">${si.toFixed(0)}</span>
        <div class="si-bar"><i style="width:${si}%;background:${siColor(si)}"></i></div>
      </td></tr>`;
  }).join('');

  document.getElementById('detail').classList.add('open');
  document.getElementById('mapLegend')?.classList.add('collapsed');
  document.getElementById('detailHead').style.background =
    `linear-gradient(120deg,${cls.color},${shade(cls.color, -28)})`;
  document.getElementById('detailHead').innerHTML = `
    <button class="close" id="detailClose" aria-label="Close">×</button>
    <div class="code">${esc(s.code)} · ${esc(s.river)}</div>
    <h3>${esc(s.name)}</h3>
    <div class="loc">${esc(s.district)} district · ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</div>`;
  document.getElementById('detailClose').onclick = () => {
    document.getElementById('detail').classList.remove('open');
    document.getElementById('mapLegend')?.classList.remove('collapsed');
    selected = null;
    document.getElementById('stationCurrent').textContent = 'All stations';
    paintStations();
    renderStationList(document.getElementById('stationSearch').value);
  };

  document.getElementById('detailBody').innerHTML = `
    <div class="wqi-hero">
      <div class="wqi-big" style="color:${cls.color}">${r.wqi.toFixed(1)}</div>
      <div class="meta">
        <div class="cls" style="color:${cls.color}">${cls.label} — ${cls.status}</div>
        <div class="cu">${cls.use}</div>
      </div>
    </div>
    <table class="param-tbl">
      <thead><tr><th>Parameter</th><th>Reading</th><th>Sub-index</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="spark-box">
      <h4>WQI trend · ${DATA.months[0]} – ${DATA.months[DATA.months.length - 1]}</h4>
      <div style="height:112px"><canvas id="spark"></canvas></div>
      <div style="display:flex;justify-content:space-between;margin-top:9px;font-size:11.5px">
        <span style="color:var(--muted)">12-month mean</span>
        <span style="font-family:var(--fm);font-weight:600">${s.avg12.toFixed(1)}
          <span class="k-trend ${s.delta > 1 ? 'trend-up' : s.delta < -1 ? 'trend-down' : 'trend-flat'}"
            style="margin:0 0 0 5px">${s.delta >= 0 ? '▲' : '▼'} ${Math.abs(s.delta).toFixed(1)}</span></span>
      </div>
    </div>
    <div class="spark-box">
      <h4>Land-use pressure within 3 km</h4>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
        <span style="font-size:11.5px;color:var(--muted)">Cumulative load index</span>
        <span style="font-family:var(--fm);font-weight:700;font-size:16px;color:${pr.load > 900 ? '#d92d20' : pr.load > 400 ? '#ef7d1a' : '#17a04a'}">${pr.load.toLocaleString('en-MY')}</span>
      </div>
      ${topCats.map(([k, n]) => `
        <div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11.5px">
          <span style="width:9px;height:9px;border-radius:2px;background:${cats[k].color};flex:none"></span>
          <span style="flex:1">${esc(cats[k].label)}</span>
          <span style="font-family:var(--fm);font-weight:600">${n.toLocaleString('en-MY')}</span>
        </div>`).join('') || '<div style="font-size:11.5px;color:var(--muted)">No sources recorded nearby.</div>'}
    </div>`;

  drawSpark(s);
  closeMenus();

  /* Zoom to the station: explicitly when asked, and gently when the map is
     still zoomed out far enough that the marker would be hard to find.
     keepView leaves the viewport alone (used when only the month changed). */
  if (opts.keepView) return;
  const target = opts.zoom || (map.getZoom() < STATION_ZOOM ? STATION_ZOOM : null);
  if (target) map.flyTo([s.lat, s.lon], target, { duration: 0.85 });
  else map.panTo([s.lat, s.lon], { animate: true });
}

function shade(hex, p) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, v + p));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function drawSpark(s) {
  sparkChart?.destroy();
  const ctx = document.getElementById('spark');
  if (!ctx) return;
  const pts = s.wqiSeries.map((x) => x.wqi);
  sparkChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: DATA.months,
      datasets: [{
        data: pts, borderColor: '#2d2f7a', borderWidth: 2, tension: 0.32,
        pointRadius: DATA.months.map((_, i) => (i === monthIdx ? 4 : 0)),
        pointBackgroundColor: wqiColor(pts[monthIdx]), pointBorderColor: '#fff', pointBorderWidth: 1.5,
        fill: true,
        backgroundColor: (c) => {
          const { ctx: cc, chartArea: a } = c.chart;
          if (!a) return 'rgba(45,47,122,.1)';
          const g = cc.createLinearGradient(0, a.top, 0, a.bottom);
          g.addColorStop(0, 'rgba(45,47,122,.24)');
          g.addColorStop(1, 'rgba(45,47,122,0)');
          return g;
        },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `WQI ${c.parsed.y.toFixed(1)} · ${wqiClass(c.parsed.y).status}` } },
      },
      scales: {
        x: { display: false },
        y: { min: 0, max: 100, ticks: { stepSize: 25, font: { size: 9 }, color: '#8b93a8' },
          grid: { color: '#eef0f5' }, border: { display: false } },
      },
    },
  });
}

/* ---------------- Init ---------------- */
export function initMap() {
  makeBases();
  map = L.map('map', {
    center: LANGAT_CENTER, zoom: 11, zoomControl: false, preferCanvas: true,
  });
  L.control.zoom({ position: 'bottomleft' }).addTo(map);   // top-right = detail panel, bottom-right = legend
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  layers.districts = L.geoJSON(DATA.districts, {
    style: { color: '#22235f', weight: 1.8, opacity: 0.8, dashArray: '7 5',
      fill: true, fillColor: '#22235f', fillOpacity: 0.035 },
    onEachFeature: (f, l) => l.bindTooltip(
      `<b>${esc(f.properties.name)} district</b><br>Administrative boundary · OpenStreetMap`,
      { sticky: true }),
  });

  layers.waterLangat = L.geoJSON(DATA.waterLangat, {
    style: { color: '#0aa3d9', weight: 0.7, fillColor: '#45bfe0', fillOpacity: 0.45 },
    onEachFeature: (f, l) => l.bindTooltip(
      `<b>${f.properties.name ? esc(f.properties.name) : 'Water body'}</b><br>Type: ${esc(f.properties.kind)}`,
      { sticky: true }),
  });
  layers.waterSelangor = L.geoJSON(DATA.waterSelangor, {
    style: { color: '#7aa8c4', weight: 0.5, fillColor: '#9fc7dd', fillOpacity: 0.35 },
  });
  layers.tributaries = L.geoJSON(DATA.tributaries, {
    style: { color: '#3c8fb5', weight: 1.4, opacity: 0.7 },
    onEachFeature: (f, l) => { if (f.properties.name) l.bindTooltip(esc(f.properties.name), { sticky: true }); },
  });

  layers.sewerage = L.geoJSON(DATA.sewerage, {
    style: (f) => {
      const p = f.properties;
      const st = SEWER_STYLE[p.kind] ?? SEWER_STYLE.ditch;
      return {
        color: st.color, weight: st.weight, opacity: st.opacity,
        dashArray: p.covered ? '3 3' : null,
      };
    },
    pointToLayer: (f, latlng) => L.circleMarker(latlng, {
      radius: 3.6, fillColor: '#8d6cd8', color: '#fff', weight: 1.4, fillOpacity: 1,
    }),
    onEachFeature: (f, l) => {
      const p = f.properties;
      const st = SEWER_STYLE[p.kind];
      const title = p.kind === 'manhole' ? 'Sewer manhole'
        : p.kind === 'pumping_station' ? 'Pumping station'
        : (st?.label ?? 'Drain');
      l.bindTooltip(
        `<b>${p.name ? esc(p.name) : title}</b>` +
        (p.name ? `<br>${title}` : '') +
        (p.covered ? '<br>Culverted — runs underground' : '') +
        (p.substance ? `<br>Carries: ${esc(p.substance)}` : '') +
        (p.outfall != null
          ? `<br>Discharges ${p.outfall} m from a watercourse` : '') +
        `<br>${esc(p.district)} district`,
        { sticky: true });
    },
  });

  riverLayer = L.layerGroup();
  stationLayer = L.layerGroup();
  myReadingLayer = L.layerGroup();
  mySourceLayer = L.layerGroup();
  srcCluster = L.markerClusterGroup({
    maxClusterRadius: 46, disableClusteringAtZoom: 15,
    spiderfyOnMaxZoom: true, chunkedLoading: true,
  });
  Object.assign(layers, {
    river: riverLayer, stations: stationLayer, sources: srcCluster,
    myReadings: myReadingLayer, mySources: mySourceLayer,
  });

  riverSegs = buildRiver();
  paintRiver();
  paintStations();
  srcFilter = new Set(Object.keys(DATA.srcCats));

  buildToolbar();
  buildLegend();
  paintSources();

  layers.districts.addTo(map);
  layers.waterLangat.addTo(map);
  layers.sewerage.addTo(map);
  layers.tributaries.addTo(map);
  riverLayer.addTo(map);
  srcCluster.addTo(map);
  stationLayer.addTo(map);
  myReadingLayer.addTo(map);
  mySourceLayer.addTo(map);

  map.fitBounds(L.geoJSON(DATA.river).getBounds().pad(0.06));

  paintUserData();
  document.addEventListener('userdata', paintUserData);
  return map;
}

/* ---------------- Toolbar: dropdown menus ---------------- */
function closeMenus(except = null) {
  document.querySelectorAll('.tb-menu.open').forEach((m) => {
    if (m !== except) m.classList.remove('open');
  });
  document.querySelectorAll('.tb-btn.open').forEach((b) => {
    if (b.dataset.menu !== except?.id.replace('menu-', '')) b.classList.remove('open');
  });
}

function wireMenus() {
  document.querySelectorAll('.tb-btn[data-menu]').forEach((btn) => {
    const menu = document.getElementById(`menu-${btn.dataset.menu}`);
    btn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = !menu.classList.contains('open');
      closeMenus();
      menu.classList.toggle('open', willOpen);
      btn.classList.toggle('open', willOpen);
      if (willOpen && btn.dataset.menu === 'station') {
        const q = document.getElementById('stationSearch');
        q.value = ''; renderStationList('');
        setTimeout(() => q.focus(), 40);
      }
    };
  });

  /* Keep clicks inside a menu from closing it or reaching the map */
  document.querySelectorAll('.tb-menu').forEach((m) => {
    m.addEventListener('click', (e) => e.stopPropagation());
    L.DomEvent.disableClickPropagation(m);
    L.DomEvent.disableScrollPropagation(m);
  });
  L.DomEvent.disableClickPropagation(document.getElementById('toolbar'));

  document.addEventListener('click', () => closeMenus());
  map.on('click', () => closeMenus());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
}

/* ---------------- Toolbar contents ---------------- */
function buildToolbar() {
  const cats = DATA.srcCats;

  /* --- Base maps + satellite imagery --- */
  const btn = (k) => {
    const d = BASEMAPS[k];
    return `<button class="base-btn" data-base="${k}" title="${esc(d.note)}">
      ${BASE_ICON[d.icon]}${d.label}</button>`;
  };
  document.getElementById('baseGrid').innerHTML =
    Object.keys(BASEMAPS).filter((k) => BASEMAPS[k].group === 'map').map(btn).join('');
  document.getElementById('satGrid').innerHTML =
    Object.keys(BASEMAPS).filter((k) => BASEMAPS[k].group === 'sat').map(btn).join('');

  const dateInput = document.getElementById('satDate');
  dateInput.value = isoDate(new Date(Date.now() - 2 * 864e5));   // GIBS lags ~1-2 days
  dateInput.max = isoDate(new Date(Date.now() - 864e5));
  dateInput.min = '2012-01-01';

  const setBase = (k, close = false) => {
    document.querySelectorAll('[data-base]').forEach((x) =>
      x.classList.toggle('active', x.dataset.base === k));
    Object.values(base).forEach((l) => { if (l) map.removeLayer(l); });

    const d = BASEMAPS[k];
    /* Daily imagery is date-dependent, so rebuild it each time. */
    if (d.daily) base[k] = gibsLayer(d, dateInput.value);
    base[k].addTo(map);
    base[k].bringToBack();
    currentBase = k;

    document.getElementById('baseCurrent').textContent = d.label;
    document.getElementById('satDateRow').style.display = d.daily ? 'flex' : 'none';
    document.getElementById('baseInfo').innerHTML =
      `<div class="bi-t">${d.label} <span class="badge soft">${d.res}</span></div>
       <div class="bi-s">${esc(d.src)}</div>
       <div class="bi-n">${esc(d.note)}</div>`;

    const lblRow = document.getElementById('labelRow');
    const lblBox = document.getElementById('labelToggle');
    lblRow.style.display = d.group === 'sat' ? 'flex' : 'none';
    labelOverlay ??= makeLabelOverlay();
    if (d.group === 'sat' && lblBox.checked) labelOverlay.addTo(map);
    else if (map.hasLayer(labelOverlay)) map.removeLayer(labelOverlay);
    if (close) closeMenus();
  };
  document.querySelectorAll('[data-base]').forEach((b) => {
    b.onclick = () => setBase(b.dataset.base, !BASEMAPS[b.dataset.base].daily);
  });
  dateInput.onchange = () => { if (BASEMAPS[currentBase].daily) setBase(currentBase); };
  setBase('osm');

  document.getElementById('labelToggle').onchange = (e) => {
    labelOverlay ??= makeLabelOverlay();
    if (e.target.checked) labelOverlay.addTo(map);
    else map.removeLayer(labelOverlay);
  };

  /* --- Data layers --- */
  const defs = [
    ['districts', 'Basin district boundaries', '#22235f', 'line', DATA.districts.features.length],
    ['river', 'Langat River (WQI)', 'linear-gradient(90deg,#0aa3d9,#17a04a,#f2c40c,#ef7d1a,#d92d20)', 'line', DATA.river.features.length],
    ['stations', 'Monitoring stations', '#22235f', 'box', DATA.stations.length],
    ['sources', 'Pollution sources', '#4a3aa7', 'box', DATA.sources.features.length],
    ['tributaries', 'Tributaries & canals', '#3c8fb5', 'line', DATA.tributaries.features.length],
    ['sewerage', 'Drainage & sewerage', '#8d6cd8', 'line', DATA.sewerage.features.length],
    ['waterLangat', 'Water bodies — Langat', '#45bfe0', 'box', DATA.waterLangat.features.length],
    ['waterSelangor', 'Water bodies — rest of Selangor', '#9fc7dd', 'box', DATA.waterSelangor.features.length],
    ['myReadings', 'My readings (this browser)', '#22235f', 'box', 0],
    ['mySources', 'My reported sources', '#4a3aa7', 'box', 0],
  ];
  document.getElementById('layerList').innerHTML = defs.map(([k, lab, col, sh, n]) => `
    <label class="layer-item"${k.startsWith('my') ? ' style="display:none"' : ''}>
      <input type="checkbox" data-layer="${k}" ${k === 'waterSelangor' ? '' : 'checked'}>
      <span class="layer-swatch ${sh === 'line' ? 'line' : ''}" style="background:${col}"></span>
      <span>${lab}</span>
      <span class="cnt">${n.toLocaleString('en-MY')}</span>
    </label>`).join('');

  const refreshLayerCount = () => {
    document.getElementById('layerCount').textContent =
      document.querySelectorAll('input[data-layer]:checked').length;
  };
  document.querySelectorAll('input[data-layer]').forEach((i) => {
    i.onchange = () => {
      const l = layers[i.dataset.layer];
      if (i.checked) l.addTo(map); else map.removeLayer(l);
      refreshLayerCount();
    };
  });
  refreshLayerCount();

  /* --- Source categories --- */
  document.getElementById('catList').innerHTML = Object.entries(cats).map(([k, c]) => `
    <label class="layer-item">
      <input type="checkbox" data-cat="${k}" checked>
      ${sourceSwatch(k, c.color, 17)}
      <span>${esc(c.label)}</span>
    </label>`).join('');
  document.querySelectorAll('input[data-cat]').forEach((i) => {
    i.onchange = () => {
      if (i.checked) srcFilter.add(i.dataset.cat); else srcFilter.delete(i.dataset.cat);
      paintSources();
    };
  });

  /* --- Riparian distance filter --- */
  const dist = document.getElementById('distSlider');
  dist.oninput = () => {
    maxDistFilter = +dist.value;
    document.getElementById('distLabel').textContent =
      maxDistFilter >= 1000 ? `${(maxDistFilter / 1000).toFixed(1)} km` : `${maxDistFilter} m`;
    paintSources();
  };

  /* --- Station picker with search --- */
  document.getElementById('stationSearch').oninput = (e) => renderStationList(e.target.value);
  document.getElementById('stationSearch').onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const first = document.querySelector('#stationList .stn-opt');
    if (first) first.click();
  };
  renderStationList('');

  /* --- Month slider --- */
  const slider = document.getElementById('monthSlider');
  slider.max = DATA.months.length - 1;
  slider.value = monthIdx = DATA.months.length - 1;
  const label = document.getElementById('monthLabel');
  label.textContent = fmtMonth(DATA.months[monthIdx]);
  slider.oninput = () => {
    monthIdx = +slider.value;
    label.textContent = fmtMonth(DATA.months[monthIdx]);
    paintRiver();
    paintStations();
    renderStationList(document.getElementById('stationSearch').value);
    if (selected) selectStation(selected, { keepView: true });
    document.dispatchEvent(new CustomEvent('monthchange', { detail: monthIdx }));
  };

  wireMenus();
}

/* Station list, filtered by a free-text query */
function renderStationList(q) {
  const query = q.trim().toLowerCase();
  const hits = DATA.stations.filter((s) =>
    !query || `${s.code} ${s.name} ${s.river} ${s.district}`.toLowerCase().includes(query));

  const box = document.getElementById('stationList');
  if (!hits.length) {
    box.innerHTML = '<div class="stn-empty">No station matches that search.</div>';
    return;
  }
  box.innerHTML = hits.map((s) => {
    const r = readingAt(s, monthIdx);
    const c = wqiClass(r.wqi);
    return `<button class="stn-opt${selected?.code === s.code ? ' sel' : ''}" data-stn="${s.code}">
      <span class="sw" style="background:${c.color}">${Math.round(r.wqi)}</span>
      <span class="sn"><b>${esc(s.name)}</b><span>${s.code} · ${esc(s.district)}</span></span>
    </button>`;
  }).join('');

  box.querySelectorAll('.stn-opt').forEach((b) => {
    b.onclick = () => {
      const s = DATA.stations.find((x) => x.code === b.dataset.stn);
      if (!s) return;
      document.getElementById('stationCurrent').textContent = s.name;
      selectStation(s, { zoom: STATION_ZOOM });
    };
  });
}

/* ---------------- Floating legend (bottom right) ---------------- */
function buildLegend() {
  document.getElementById('legendList').innerHTML = WQI_CLASSES.map((c) => `
    <div class="ml-row" title="${esc(c.use)}">
      <span class="ml-chip" style="background:${c.color}">${c.id}</span>
      <span>
        <div class="ml-t">${c.status}</div>
        <div class="ml-s">${c.max > 100 ? '92.7 – 100' : `${c.min < 0 ? '0' : c.min} – ${c.max}`}</div>
      </span>
    </div>`).join('');

  document.getElementById('legendCats').innerHTML = Object.entries(DATA.srcCats).map(([k, c]) => `
    <div class="ml-cat" title="${esc(c.pol)}">
      ${sourceSwatch(k, c.color, 16)}${esc(c.label)}
    </div>`).join('');

  const lineSwatch = (color, w, dashed) =>
    `<span class="ml-line"><svg viewBox="0 0 20 6" width="18" height="6"><line x1="0" y1="3" x2="20" y2="3"
      stroke="${color}" stroke-width="${w}" ${dashed ? 'stroke-dasharray="3 3"' : ''}/></svg></span>`;
  document.getElementById('legendDrain').innerHTML = `
    <div class="ml-cat" title="Open monsoon drains and ditches that carry run-off and greywater">
      ${lineSwatch('#8d6cd8', 2.6, false)}Open drain / ditch</div>
    <div class="ml-cat" title="Culverted reaches running underground">
      ${lineSwatch('#8d6cd8', 2.6, true)}Culverted (underground)</div>
    <div class="ml-cat" title="Mapped sewage or water pipelines">
      ${lineSwatch('#c0399f', 3, false)}Sewage / water pipeline</div>`;

  const box = document.getElementById('mapLegend');
  document.getElementById('legendHead').onclick = () => box.classList.toggle('collapsed');
  L.DomEvent.disableClickPropagation(box);
  L.DomEvent.disableScrollPropagation(box);
}

export function getMonthIdx() { return monthIdx; }
export function refreshMapSize() { map?.invalidateSize(); }
export function focusStation(code) {
  const s = DATA.stations.find((x) => x.code === code);
  if (!s) return;
  document.getElementById('stationCurrent').textContent = s.name;
  selectStation(s, { zoom: STATION_ZOOM });
}
export function flyTo(lat, lon, zoom = 15) { map?.setView([lat, lon], zoom); }
