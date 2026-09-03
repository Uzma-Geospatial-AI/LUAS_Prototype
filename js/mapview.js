/* ============================================================
   mapview.js — Peta interaktif WQI Lembangan Sungai Langat
   ============================================================ */
import { DATA, readingAt, pressureAround } from './data.js';
import { wqiClass, wqiColor, WQI_CLASSES, PARAM_META, paramStatus } from './wqi.js';

let map, layers = {}, base = {}, stationLayer, riverLayer, srcCluster;
let monthIdx = 0, selected = null, sparkChart = null;

const LANGAT_CENTER = [2.955, 101.63];

/* ---------------- Basemaps ---------------- */
function makeBases() {
  base.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; Penyumbang OpenStreetMap',
  });
  base.sat = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Imej satelit: Esri, Maxar, Earthstar Geographics' });
  base.topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, attribution: '&copy; OpenTopoMap (CC-BY-SA)',
  });
  base.dark = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { maxZoom: 20, attribution: '&copy; OpenStreetMap, &copy; CARTO' });
  return base;
}

/* ---------------- Pewarnaan sungai mengikut WQI ---------------- */
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
    // pecah kepada sub-segmen ~8 titik supaya warna berperingkat
    const STEP = 6;
    for (let i = 0; i < c.length - 1; i += STEP) {
      const part = c.slice(i, Math.min(c.length, i + STEP + 1));
      if (part.length < 2) continue;
      const mid = part[Math.floor(part.length / 2)];
      const st = nearestStation(mid[0], mid[1], mains);
      feats.push({ coords: part.map((p) => [p[1], p[0]]), st });
    }
  }
  return feats;
}

function paintRiver(segs) {
  riverLayer.clearLayers();
  for (const s of segs) {
    const wqi = readingAt(s.st, monthIdx).wqi;
    const c = wqiColor(wqi);
    L.polyline(s.coords, {
      color: '#12305a', weight: 8, opacity: 0.28, interactive: false,
    }).addTo(riverLayer);
    L.polyline(s.coords, { color: c, weight: 4.5, opacity: 0.98 })
      .bindTooltip(
        `<b>Sungai Langat</b><br>Stesen rujukan: ${s.st.code} — ${s.st.name}` +
        `<br>WQI ${wqi.toFixed(1)} · ${wqiClass(wqi).label} (${wqiClass(wqi).status})`,
        { sticky: true })
      .on('click', () => selectStation(s.st))
      .addTo(riverLayer);
  }
}

/* ---------------- Penanda stesen ---------------- */
function stationIcon(wqi, active) {
  const c = wqiColor(wqi);
  const sz = active ? 26 : 20;
  return L.divIcon({
    className: '',
    html: `<div class="stn-marker" style="width:${sz}px;height:${sz}px;background:${c};
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
    const m = L.marker([s.lat, s.lon], {
      icon: stationIcon(r.wqi, selected?.code === s.code),
      zIndexOffset: 500,
    });
    m.bindTooltip(
      `<b>${s.code}</b> — ${s.name}<br>WQI ${r.wqi.toFixed(1)} · ${wqiClass(r.wqi).status}`,
      { direction: 'top', offset: [0, -12] });
    m.on('click', () => selectStation(s));
    m.addTo(stationLayer);
  }
}

/* ---------------- Punca pencemaran ---------------- */
let srcFilter = new Set(Object.keys({}));
let maxDistFilter = 1500;

function paintSources() {
  srcCluster.clearLayers();
  const cats = DATA.srcCats;
  const marks = [];
  for (const f of DATA.sources.features) {
    const p = f.properties;
    if (!srcFilter.has(p.cat)) continue;
    if (p.dist > maxDistFilter) continue;
    const cat = cats[p.cat];
    const rad = 3 + p.risk * 1.1;
    const m = L.circleMarker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {
      radius: rad, fillColor: cat.color, color: '#fff', weight: 1,
      fillOpacity: 0.85, opacity: 0.9,
    });
    m.bindPopup(
      `<div class="pop-head" style="background:${cat.color}">${cat.icon} ${cat.label}</div>
       <div class="pop">
         <div class="pt">${p.name ? esc(p.name) : '(tiada nama dalam OSM)'}</div>
         <div class="ps">Daerah ${esc(p.district ?? '—')} · OSM ID ${p.id}</div>
         <div class="pr"><span>Jarak ke alur air</span><span>${p.dist} m</span></div>
         ${p.dist_langat != null
        ? `<div class="pr"><span>Jarak ke Sg. Langat</span><span>${fmtKm(p.dist_langat)}</span></div>` : ''}
         <div class="pr"><span>Skor risiko</span><span style="color:${riskColor(p.risk)}">${p.risk.toFixed(2)} / 5</span></div>
         <div class="pr" style="display:block;margin-top:7px;border-top:1px solid #eef0f5;padding-top:7px">
           <span style="color:#5f6880;font-size:10.5px">PENCEMAR UTAMA</span><br>
           <span style="font-family:inherit;font-weight:500;font-size:11.5px">${cat.pol}</span>
         </div>
       </div>`, { maxWidth: 260 });
    marks.push(m);
  }
  srcCluster.addLayers(marks);
  const cnt = document.getElementById('srcCount');
  if (cnt) cnt.textContent = marks.length.toLocaleString('ms-MY');
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtKm = (m) => (m >= 1000 ? (m / 1000).toFixed(2) + ' km' : m + ' m');
const riskColor = (r) => (r >= 4 ? '#d92d20' : r >= 3 ? '#ef7d1a' : r >= 2 ? '#f2c40c' : '#17a04a');

/* ---------------- Panel butiran stesen ---------------- */
export function selectStation(s) {
  selected = s;
  paintStations();
  const r = readingAt(s, monthIdx);
  const cls = wqiClass(r.wqi);
  const pr = pressureAround(s, 3);
  const cats = DATA.srcCats;
  const topCats = Object.entries(pr.counts).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const rows = Object.keys(PARAM_META).map((k) => {
    const m = PARAM_META[k];
    const v = r.raw[k];
    const si = r.si[k];
    const st = paramStatus(k, v);
    return `<tr>
      <td class="pn">${m.name}${m.unit ? `<span class="pu">${m.unit}</span>` : ''}</td>
      <td><span class="dot-st st-${st}"></span><span class="pv">${v}</span></td>
      <td>
        <span class="pv" style="color:${si >= 76 ? '#17a04a' : si >= 52 ? '#f2c40c' : '#d92d20'}">${si.toFixed(0)}</span>
        <div class="si-bar"><i style="width:${si}%;background:${si >= 76 ? '#17a04a' : si >= 52 ? '#f2c40c' : '#d92d20'}"></i></div>
      </td></tr>`;
  }).join('');

  document.getElementById('detail').classList.add('open');
  document.getElementById('detailHead').style.background =
    `linear-gradient(120deg,${cls.color},${shade(cls.color, -28)})`;
  document.getElementById('detailHead').innerHTML = `
    <button class="close" onclick="document.getElementById('detail').classList.remove('open')">×</button>
    <div class="code">${s.code} · ${s.river}</div>
    <h3>${esc(s.name)}</h3>
    <div class="loc">Daerah ${s.district} · ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</div>`;

  document.getElementById('detailBody').innerHTML = `
    <div class="wqi-hero">
      <div class="wqi-big" style="color:${cls.color}">${r.wqi.toFixed(1)}</div>
      <div class="meta">
        <div class="cls" style="color:${cls.color}">${cls.label} — ${cls.status}</div>
        <div class="cu">${cls.use}</div>
      </div>
    </div>
    <table class="param-tbl">
      <thead><tr><th>Parameter</th><th>Bacaan</th><th>Sub-indeks</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="spark-box">
      <h4>Arah aliran WQI · ${DATA.months[0]} – ${DATA.months[DATA.months.length - 1]}</h4>
      <div style="height:112px"><canvas id="spark"></canvas></div>
      <div style="display:flex;justify-content:space-between;margin-top:9px;font-size:11.5px">
        <span style="color:var(--muted)">Purata 12 bulan</span>
        <span style="font-family:var(--fm);font-weight:600">${s.avg12.toFixed(1)}
          <span class="k-trend ${s.delta > 1 ? 'trend-up' : s.delta < -1 ? 'trend-down' : 'trend-flat'}"
            style="margin:0 0 0 5px">${s.delta >= 0 ? '▲' : '▼'} ${Math.abs(s.delta).toFixed(1)}</span></span>
      </div>
    </div>
    <div class="spark-box">
      <h4>Tekanan guna tanah dalam radius 3 km</h4>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
        <span style="font-size:11.5px;color:var(--muted)">Indeks beban terkumpul</span>
        <span style="font-family:var(--fm);font-weight:700;font-size:16px;color:${pr.load > 900 ? '#d92d20' : pr.load > 400 ? '#ef7d1a' : '#17a04a'}">${pr.load.toLocaleString('ms-MY')}</span>
      </div>
      ${topCats.map(([k, n]) => `
        <div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11.5px">
          <span style="width:9px;height:9px;border-radius:2px;background:${cats[k].color};flex:none"></span>
          <span style="flex:1">${cats[k].label}</span>
          <span style="font-family:var(--fm);font-weight:600">${n.toLocaleString('ms-MY')}</span>
        </div>`).join('') || '<div style="font-size:11.5px;color:var(--muted)">Tiada punca direkod berhampiran.</div>'}
    </div>`;

  drawSpark(s);
  map.panTo([s.lat, s.lon], { animate: true });
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
        tooltip: {
          callbacks: {
            label: (c) => `WQI ${c.parsed.y.toFixed(1)} · ${wqiClass(c.parsed.y).status}`,
          },
        },
      },
      scales: {
        x: { display: false },
        y: {
          min: 0, max: 100, ticks: { stepSize: 25, font: { size: 9 }, color: '#8b93a8' },
          grid: { color: '#eef0f5' }, border: { display: false },
        },
      },
    },
  });
}

/* ---------------- Init ---------------- */
export function initMap() {
  makeBases();
  map = L.map('map', {
    center: LANGAT_CENTER, zoom: 11, layers: [base.osm],
    zoomControl: false, preferCanvas: true,
  });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  /* --- Badan air --- */
  layers.waterLangat = L.geoJSON(DATA.waterLangat, {
    style: { color: '#0aa3d9', weight: 0.7, fillColor: '#45bfe0', fillOpacity: 0.45 },
    onEachFeature: (f, l) => {
      const p = f.properties;
      l.bindTooltip(`<b>${p.name ? esc(p.name) : 'Badan air'}</b><br>Jenis: ${p.kind}`,
        { sticky: true });
    },
  });
  layers.waterSelangor = L.geoJSON(DATA.waterSelangor, {
    style: { color: '#7aa8c4', weight: 0.5, fillColor: '#9fc7dd', fillOpacity: 0.35 },
  });
  layers.districts = L.geoJSON(DATA.districts, {
    style: { color: '#22235f', weight: 1.8, opacity: 0.8, dashArray: '7 5',
      fill: true, fillColor: '#22235f', fillOpacity: 0.035 },
    onEachFeature: (f, l) => l.bindTooltip(
      `<b>Daerah ${esc(f.properties.name)}</b><br>Sempadan pentadbiran · OpenStreetMap`,
      { sticky: true }),
  });

  layers.tributaries = L.geoJSON(DATA.tributaries, {
    style: { color: '#3c8fb5', weight: 1.4, opacity: 0.7 },
    onEachFeature: (f, l) => {
      if (f.properties.name) l.bindTooltip(esc(f.properties.name), { sticky: true });
    },
  });

  riverLayer = L.layerGroup();
  stationLayer = L.layerGroup();
  srcCluster = L.markerClusterGroup({
    maxClusterRadius: 46, disableClusteringAtZoom: 15,
    spiderfyOnMaxZoom: true, chunkedLoading: true,
  });
  layers.river = riverLayer;
  layers.stations = stationLayer;
  layers.sources = srcCluster;

  const segs = buildRiver();
  paintRiver(segs);
  paintStations();

  srcFilter = new Set(Object.keys(DATA.srcCats));
  paintSources();

  // susunan lalai
  layers.districts.addTo(map);
  layers.waterLangat.addTo(map);
  layers.tributaries.addTo(map);
  riverLayer.addTo(map);
  srcCluster.addTo(map);
  stationLayer.addTo(map);

  map.fitBounds(L.geoJSON(DATA.river).getBounds().pad(0.06));

  buildSidebar(segs);
  return map;
}

/* ---------------- Sidebar / kawalan ---------------- */
function buildSidebar(segs) {
  const cats = DATA.srcCats;

  /* Basemap */
  document.querySelectorAll('[data-base]').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('[data-base]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      Object.values(base).forEach((l) => map.removeLayer(l));
      base[b.dataset.base].addTo(map);
      base[b.dataset.base].bringToBack();
    };
  });

  /* Lapisan */
  const layerBox = document.getElementById('layerList');
  const defs = [
    ['districts', 'Sempadan daerah lembangan', '#22235f', 'line', DATA.districts.features.length],
    ['river', 'Sungai Langat (WQI)', 'linear-gradient(90deg,#0aa3d9,#17a04a,#f2c40c,#ef7d1a,#d92d20)', 'line', DATA.river.features.length],
    ['stations', 'Stesen pemantauan', '#22235f', 'box', DATA.stations.length],
    ['sources', 'Punca pencemaran', '#d92d20', 'box', DATA.sources.features.length],
    ['tributaries', 'Anak sungai & terusan', '#3c8fb5', 'line', DATA.tributaries.features.length],
    ['waterLangat', 'Badan air — Langat', '#45bfe0', 'box', DATA.waterLangat.features.length],
    ['waterSelangor', 'Badan air — Selangor lain', '#9fc7dd', 'box', DATA.waterSelangor.features.length],
  ];
  layerBox.innerHTML = defs.map(([k, lab, col, sh, n]) => `
    <label class="layer-item">
      <input type="checkbox" data-layer="${k}" ${k === 'waterSelangor' ? '' : 'checked'}>
      <span class="layer-swatch ${sh === 'line' ? 'line' : ''}" style="background:${col}"></span>
      <span>${lab}</span>
      <span class="cnt" ${k === 'sources' ? 'id="srcCount"' : ''}>${n.toLocaleString('ms-MY')}</span>
    </label>`).join('');
  layerBox.querySelectorAll('input[data-layer]').forEach((i) => {
    i.onchange = () => {
      const l = layers[i.dataset.layer];
      i.checked ? l.addTo(map) : map.removeLayer(l);
    };
  });

  /* Legenda WQI */
  document.getElementById('legendList').innerHTML = WQI_CLASSES.map((c) => `
    <div class="legend-row" title="${c.use}">
      <span class="legend-chip" style="background:${c.color}">${c.id}</span>
      <span>
        <div class="lr-t">${c.status}</div>
        <div class="lr-s">${c.max > 100 ? '92.7 – 100' : `${c.min < 0 ? '0' : c.min} – ${c.max}`}</div>
      </span>
    </div>`).join('');

  /* Kategori punca */
  document.getElementById('catList').innerHTML = Object.entries(cats).map(([k, c]) => `
    <label class="layer-item">
      <input type="checkbox" data-cat="${k}" checked>
      <span class="layer-swatch" style="background:${c.color}"></span>
      <span>${c.icon} ${c.label}</span>
    </label>`).join('');
  document.querySelectorAll('input[data-cat]').forEach((i) => {
    i.onchange = () => {
      i.checked ? srcFilter.add(i.dataset.cat) : srcFilter.delete(i.dataset.cat);
      paintSources();
    };
  });

  /* Slider bulan */
  const slider = document.getElementById('monthSlider');
  slider.max = DATA.months.length - 1;
  slider.value = monthIdx = DATA.months.length - 1;
  const label = document.getElementById('monthLabel');
  const fmtMonth = (m) => {
    const [y, mm] = m.split('-');
    return `${['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'][+mm - 1]} ${y}`;
  };
  label.textContent = fmtMonth(DATA.months[monthIdx]);
  slider.oninput = () => {
    monthIdx = +slider.value;
    label.textContent = fmtMonth(DATA.months[monthIdx]);
    paintRiver(segs);
    paintStations();
    if (selected) selectStation(selected);
    document.dispatchEvent(new CustomEvent('monthchange', { detail: monthIdx }));
  };

  /* Slider jarak riparian */
  const dist = document.getElementById('distSlider');
  dist.oninput = () => {
    maxDistFilter = +dist.value;
    document.getElementById('distLabel').textContent =
      maxDistFilter >= 1000 ? (maxDistFilter / 1000).toFixed(1) + ' km' : maxDistFilter + ' m';
    paintSources();
  };

  /* Pilih stesen dari senarai */
  document.getElementById('stationSelect').innerHTML =
    '<option value="">— Pilih stesen —</option>' +
    DATA.stations.map((s) => `<option value="${s.code}">${s.code} · ${s.name}</option>`).join('');
  document.getElementById('stationSelect').onchange = (e) => {
    const s = DATA.stations.find((x) => x.code === e.target.value);
    if (s) { map.setView([s.lat, s.lon], 14); selectStation(s); }
  };
}

export function getMonthIdx() { return monthIdx; }
export function refreshMapSize() { map?.invalidateSize(); }
export function focusStation(code) {
  const s = DATA.stations.find((x) => x.code === code);
  if (s) { map.setView([s.lat, s.lon], 14); selectStation(s); }
}
