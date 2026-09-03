/* ============================================================
   satellite.js — Paparan pencerapan satelit
   Sumber terbuka tanpa kunci API:
     · NASA GIBS (WMTS)  — imej harian, siri masa penuh
     · Esri World Imagery — mozek resolusi tinggi
   ============================================================ */
import { DATA } from './data.js';
import { wqiColor, wqiClass } from './wqi.js';

let smap, activeSat = null, overlays = {};

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export const SAT_LAYERS = {
  esri: {
    label: 'Esri World Imagery',
    res: '≈ 0.3 – 1 m',
    kind: 'Mozek resolusi tinggi (bukan harian)',
    use: 'Mengenal pasti bangunan, kilang, kolam takungan & guna tanah tepi sungai secara individu.',
    daily: false,
    make: () => L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics' }),
  },
  modis_terra: {
    label: 'MODIS Terra — Warna Sebenar',
    res: '250 m',
    kind: 'Harian · ~10:30 pagi waktu tempatan',
    use: 'Pemantauan skala lembangan: kepulan sedimen di muara, litupan awan, kejadian banjir.',
    daily: true, id: 'MODIS_Terra_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg',
  },
  modis_aqua: {
    label: 'MODIS Aqua — Warna Sebenar',
    res: '250 m',
    kind: 'Harian · ~1:30 petang waktu tempatan',
    use: 'Pandangan tengah hari — berguna apabila cerapan pagi ditutup awan.',
    daily: true, id: 'MODIS_Aqua_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg',
  },
  viirs: {
    label: 'VIIRS NOAA-20 — Warna Sebenar',
    res: '250 m',
    kind: 'Harian · resolusi lebih tajam daripada MODIS',
    use: 'Cerapan harian terkini bagi kekeruhan muara dan kepulan sedimen.',
    daily: true, id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg',
  },
  bands721: {
    label: 'MODIS Terra — Warna Palsu (7-2-1)',
    res: '250 m',
    kind: 'Harian · gabungan inframerah gelombang pendek',
    use: 'Air kelihatan biru gelap/hitam — memudahkan pengasingan air daripada daratan, ' +
         'mengesan banjir, tanah terdedah dan kawasan terbakar.',
    daily: true, id: 'MODIS_Terra_CorrectedReflectance_Bands721', max: 9, ext: 'jpg',
  },
  nightlights: {
    label: 'VIIRS — Cahaya Malam',
    res: '500 m',
    kind: 'Harian · jalur siang-malam',
    use: 'Proksi ketumpatan pembandaran & aktiviti industri — berkorelasi dengan beban ' +
         'kumbahan domestik di sepanjang koridor sungai.',
    daily: true, id: 'VIIRS_SNPP_DayNightBand_At_Sensor_Radiance', max: 8, ext: 'png',
  },
};

/* Indeks spektrum air — rujukan metodologi */
export const WATER_INDICES = [
  { name: 'NDWI — Indeks Air Ternormal', formula: '(Hijau − NIR) / (Hijau + NIR)',
    ramp: 'linear-gradient(90deg,#8a6d3b,#e8e3d2,#45bfe0,#0a4a8a)',
    lo: 'Daratan (−1)', hi: 'Air (+1)',
    body: 'Memetakan lingkungan badan air. Digunakan untuk mengesan perubahan luas kolam takungan, ' +
          'kolam bekas lombong dan sempadan sungai antara musim kemarau dan monsun.' },
  { name: 'NDTI — Indeks Kekeruhan Ternormal', formula: '(Merah − Hijau) / (Merah + Hijau)',
    ramp: 'linear-gradient(90deg,#0a4a8a,#45bfe0,#e8e3d2,#c98a3a,#7a4a12)',
    lo: 'Jernih', hi: 'Sangat keruh',
    body: 'Proksi bagi pepejal terampai (SS). Nilai tinggi di muara Sungai Langat selepas hujan lebat ' +
          'menandakan hakisan dari tapak pembinaan dan tanah terdedah di hulu.' },
  { name: 'NDCI — Indeks Klorofil-a', formula: '(Red-Edge − Merah) / (Red-Edge + Merah)',
    ramp: 'linear-gradient(90deg,#1a3a6a,#2f8a4f,#b8d13a,#e8b81a,#d92d20)',
    lo: 'Rendah', hi: 'Mekar alga',
    body: 'Menganggar biojisim alga daripada pengayaan nutrien (eutrofikasi). Memerlukan jalur red-edge ' +
          'Sentinel-2. Berkait rapat dengan lebihan NH₃-N dan fosforus dari kumbahan serta pertanian.' },
  { name: 'LST — Suhu Permukaan Daratan', formula: 'Penderiaan terma (jalur TIR)',
    ramp: 'linear-gradient(90deg,#2a78d6,#45bfe0,#f5e01c,#ef7d1a,#d92d20)',
    lo: 'Sejuk', hi: 'Panas',
    body: 'Mengesan pelepasan air panas dari kilang dan kesan pulau haba bandar, yang menurunkan ' +
          'kelarutan oksigen terlarut (DO) di dalam sungai.' },
];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

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
      }).bindTooltip(`<b>${s.code}</b> ${s.name}<br>WQI ${w.toFixed(1)} · ${wqiClass(w).status}`,
        { direction: 'top' });
    })).addTo(smap);

  overlays.sources = L.layerGroup(
    DATA.sources.features
      .filter((f) => f.properties.dist <= 300 && f.properties.risk >= 3.2)
      .map((f) => L.circleMarker(
        [f.geometry.coordinates[1], f.geometry.coordinates[0]],
        { radius: 3.4, fillColor: DATA.srcCats[f.properties.cat].color,
          color: '#fff', weight: 0.7, fillOpacity: 0.9 })));

  const dateInput = document.getElementById('satDate');
  const d = new Date(Date.now() - 2 * 864e5);       // GIBS lag ~1–2 hari
  dateInput.value = iso(d);
  dateInput.max = iso(new Date(Date.now() - 864e5));
  dateInput.min = '2012-01-01';
  dateInput.onchange = () => setSat(currentKey);

  document.querySelectorAll('[data-sat]').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('[data-sat]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      setSat(b.dataset.sat);
    };
  });
  document.querySelectorAll('[data-satov]').forEach((i) => {
    i.onchange = () => {
      const l = overlays[i.dataset.satov];
      i.checked ? l.addTo(smap) : smap.removeLayer(l);
    };
  });

  /* Panel indeks spektrum */
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

let currentKey = 'esri';
function setSat(key) {
  currentKey = key;
  const def = SAT_LAYERS[key];
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
      <span class="badge soft">Resolusi ${def.res}</span>
      <span class="badge soft">${def.kind}</span>
    </div>
    <div style="font-size:11.5px;color:var(--muted);line-height:1.55">${def.use}</div>`;
}

export function resizeSat() { smap?.invalidateSize(); }
