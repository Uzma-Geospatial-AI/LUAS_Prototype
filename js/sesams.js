/* ============================================================
   sesams.js — SESAMS · Selangor Earth Surface Activity Monitoring System

   SESAMS is the application MYSA (Agensi Angkasa Malaysia) built for LUAS
   to monitor land-use activity — above all activity on and around water
   bodies, and activity that could put a load into the state's water. This
   page is that function on the Langat catchment, built from what the
   portal already holds:

     · the 651 mapped premises and land-use sites, each with the water it
       is nearest to and how far (scripts/08);
     · the water bodies and rivers those distances were measured against;
     · the quarterly Sentinel-2 products, which are what SESAMS would look
       at to see an activity change.

   The zoning is a screening rule, not the Enactment. Selangor's river
   reserves under the Waters Management Enactment 1999 vary with the width
   of the river; 50 m is used here as one width for every reach, so that
   "inside the reserve" means "close enough to need a look", and no more.
   ============================================================ */
import { DATA, sourceSummary } from './data.js';
import { licenceStatus } from './licenceStatus.js';
import { WQ_PRODUCTS, WQ_QUARTERS, wqUrl } from './satellite.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = (n) => Number(n).toLocaleString('en');
const metres = (m) => `${nf(Math.round(m))} m`;

/* The three zones a distance falls in */
export const ZONES = [
  { id: 'reserve', label: 'River reserve', max: 50, color: '#d92d20',
    note: 'Within 50 m of mapped water — the screening width for a river reserve.' },
  { id: 'riparian', label: 'Riparian', max: 250, color: '#ef7d1a',
    note: 'Within 250 m — run-off reaches the water in one rain event.' },
  { id: 'buffer', label: 'Buffer', max: 1500, color: '#f2c40c',
    note: 'Within the 1.5 km riparian buffer the sources were clipped to.' },
];
const zoneOf = (d) => ZONES.find((z) => d <= z.max) ?? ZONES.at(-1);

/* SESAMS speaks of land-use activity; the source categories map onto it */
const ACTIVITY = {
  tanah:    { label: 'Pembersihan tanah & pembinaan', en: 'Land clearing & construction' },
  sisa:     { label: 'Kuari, pelupusan & sisa', en: 'Quarry, landfill & waste' },
  ternakan: { label: 'Pertanian & ternakan', en: 'Farming & aquaculture' },
  industri: { label: 'Perindustrian', en: 'Industry' },
  kumbahan: { label: 'Rawatan kumbahan & air', en: 'Sewage & water treatment' },
};

const charts = {};
const PAGE = 15;
let page = 1;
let search = '';
let sort = { key: 'dist', dir: 1 };
let built = false;

/* Every activity, with the fields the page sorts and searches on */
function activities() {
  const su = sourceSummary();
  return su.features.map((f) => {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const near = Object.values(p.near ?? {})[0] ?? null;    /* overall nearest */
    const st = licenceStatus(p.id);
    const cat = su.cats[p.cat] ?? {};
    return {
      id: p.id, name: p.name ?? null, cat: p.cat, catLabel: cat.label ?? p.cat,
      color: cat.color, act: ACTIVITY[p.cat] ?? { label: p.cat, en: p.cat },
      dist: p.dist, risk: p.risk, zone: zoneOf(p.dist),
      water: near?.n ?? 'water', waterId: near?.id ?? null, waterKey: near ? Object.keys(p.near)[0] : null,
      licensed: st.licensed, lat, lon,
    };
  });
}

export function renderSesams() {
  const list = activities();
  if (!built) { buildControls(); buildScan(); built = true; }
  renderKpis(list);
  renderZoneChart(list);
  renderWatchList(list);
  renderPressure(list);
  renderSatellite();
}

/* ---------------- KPIs ---------------- */
function renderKpis(list) {
  const inReserve = list.filter((a) => a.zone.id === 'reserve');
  const near250 = list.filter((a) => a.dist <= 250);
  const unlic = near250.filter((a) => !a.licensed);
  const waters = new Set(near250.filter((a) => a.waterKey).map((a) =>
    a.waterKey.startsWith('river') ? `river:${a.water}` : `${a.waterKey}:${a.waterId}`)).size;
  $('ssKpis').innerHTML = `
    <div class="card kpi">
      <div class="k-lab">Activities monitored</div>
      <div class="k-val">${nf(list.length)}</div>
      <div class="k-sub">land-use sites within 1.5 km of water</div>
      <div class="k-note">Every mapped premises and cleared site in the Langat catchment, from OpenStreetMap.</div>
    </div>
    <div class="card kpi">
      <div class="k-lab">Inside the river reserve</div>
      <div class="k-val" style="color:#d92d20">${nf(inReserve.length)}</div>
      <div class="k-sub">within 50 m of mapped water</div>
      <div class="k-note">${nf(inReserve.filter((a) => a.cat === 'tanah').length)} of them are cleared or construction land, the activity a reserve exists to keep out.</div>
    </div>
    <div class="card kpi">
      <div class="k-lab">Riparian, no licence</div>
      <div class="k-val" style="color:#ef7d1a">${nf(unlic.length)}</div>
      <div class="k-sub">of ${nf(near250.length)} within 250 m</div>
      <div class="k-note">Close enough for run-off to reach the water in one storm, with no discharge licence in the register.</div>
    </div>
    <div class="card kpi">
      <div class="k-lab">Water under pressure</div>
      <div class="k-val">${nf(waters)}</div>
      <div class="k-sub">rivers and water bodies with activity within 250 m</div>
      <div class="k-note">Ranked below by how much sits beside each.</div>
    </div>`;
}

/* ---------------- Activities by zone ---------------- */
function renderZoneChart(list) {
  const cats = Object.keys(ACTIVITY).filter((c) => list.some((a) => a.cat === c));
  const su = sourceSummary();
  charts.zone?.destroy();
  charts.zone = new Chart($('ssZoneChart'), {
    type: 'bar',
    data: {
      labels: cats.map((c) => ACTIVITY[c].en),
      datasets: ZONES.map((z) => ({
        label: z.label,
        data: cats.map((c) => list.filter((a) => a.cat === c && a.zone.id === z.id).length),
        backgroundColor: z.color, stack: 'z', borderRadius: 3,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 9, boxHeight: 9, usePointStyle: true,
          pointStyle: 'rectRounded', font: { size: 11 }, color: '#5f6880', padding: 12 } },
        tooltip: { backgroundColor: 'rgba(22,23,63,.96)', padding: 10, cornerRadius: 8,
          callbacks: { afterTitle: (items) => su.cats[cats[items[0].dataIndex]]?.pol ?? '' } },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10.5 }, color: '#8b93a8' } },
        y: { stacked: true, grid: { color: '#eaedf3' }, border: { display: false },
          ticks: { font: { size: 10 }, color: '#8b93a8', precision: 0 } },
      },
    },
  });
}

/* ---------------- Watch list ---------------- */
function buildControls() {
  const box = $('ssSearch');
  let t = null;
  box.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { search = box.value.trim().toLowerCase(); page = 1; renderWatchList(activities()); }, 120);
  });
  document.querySelectorAll('#ssTable th.sortable').forEach((th) => {
    th.onclick = () => {
      const key = th.dataset.sort;
      if (sort.key !== key) sort = { key, dir: 1 };
      else if (sort.dir === 1) sort = { key, dir: -1 };
      else sort = { key: 'dist', dir: 1 };
      renderWatchList(activities());
    };
  });
  $('ssZone').onchange = () => { page = 1; renderWatchList(activities()); };
  $('ssTable').querySelector('tbody').onclick = (e) => {
    const b = e.target.closest('[data-go]');
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const a = activities().find((x) => String(x.id) === tr.dataset.id);
    if (!a) return;
    document.dispatchEvent(new CustomEvent('showonmap', {
      detail: { lat: a.lat, lon: a.lon, srcId: a.id, wq: b?.dataset.go === 'ndti' ? 'ndti' : null },
    }));
  };
}

function renderWatchList(all) {
  const zone = $('ssZone').value;
  let list = all.filter((a) => zone === 'all' || a.zone.id === zone);
  if (search) {
    list = list.filter((a) => [a.name, a.catLabel, a.act.label, a.act.en, a.water, a.zone.label,
      a.licensed ? 'licensed' : 'no licence unlicensed'].join(' ').toLowerCase().includes(search));
  }
  const val = (a) => ({
    name: a.name ?? '~', cat: a.act.en, water: a.water, dist: a.dist, risk: a.risk,
    lic: a.licensed ? 1 : 0,
  })[sort.key];
  list = list.map((a, i) => [a, i]).sort(([a, ai], [b, bi]) => {
    const va = val(a), vb = val(b);
    const c = typeof va === 'string' ? va.localeCompare(vb, 'en', { sensitivity: 'base' }) : va - vb;
    return (c || ai - bi) * (c ? sort.dir : 1);
  }).map(([a]) => a);

  document.querySelectorAll('#ssTable th.sortable').forEach((th) => {
    th.classList.toggle('asc', th.dataset.sort === sort.key && sort.dir === 1);
    th.classList.toggle('desc', th.dataset.sort === sort.key && sort.dir === -1);
  });

  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  page = Math.min(Math.max(1, page), pages);
  const shown = list.slice((page - 1) * PAGE, page * PAGE);

  $('ssTable').querySelector('tbody').innerHTML = shown.length ? shown.map((a) => `
    <tr data-id="${a.id}" class="row-go" title="Open this site on the map">
      <td><b>${a.name ? esc(a.name) : `Unnamed ${esc(a.catLabel.toLowerCase())} site`}</b>
        <span class="sub">${esc(a.act.label)}</span></td>
      <td><span class="ss-cat" style="--c:${a.color}"></span>${esc(a.act.en)}</td>
      <td>${esc(a.water)}<span class="sub">${a.waterKey?.startsWith('river') ? 'river' : 'water body'}</span></td>
      <td class="num">${metres(a.dist)}</td>
      <td><span class="ss-zone" style="--c:${a.zone.color}">${a.zone.label}</span></td>
      <td><span class="pill-status ${a.licensed ? 'st-pass' : 'st-fail'}">${a.licensed ? 'Licensed' : 'No licence'}</span></td>
      <td class="num">${a.risk.toFixed(2)}</td>
      <td class="act"><button class="mini" data-go="map">Map</button>
        <button class="mini" data-go="ndti" title="Open the map here with the turbidity index on">NDTI</button></td>
    </tr>`).join('')
    : `<tr><td colspan="8" class="empty-row">No activity matches.</td></tr>`;

  const pg = $('ssPager');
  if (list.length <= PAGE) { pg.innerHTML = ''; return; }
  const nums = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 2) nums.push(i);
    else if (nums.at(-1) !== '…') nums.push('…');
  }
  pg.innerHTML = `
    <span class="pager-info">Showing ${(page - 1) * PAGE + 1}–${Math.min(list.length, page * PAGE)} of ${nf(list.length)}</span>
    <span class="pager-nav">
      <button class="pg" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹ Prev</button>
      ${nums.map((n) => n === '…' ? '<span class="pg-gap">…</span>'
        : `<button class="pg num${n === page ? ' on' : ''}" data-page="${n}">${n}</button>`).join('')}
      <button class="pg" data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>Next ›</button>
    </span>`;
  pg.querySelectorAll('[data-page]').forEach((b) => {
    b.onclick = () => { page = Number(b.dataset.page); renderWatchList(activities()); };
  });
}

/* ---------------- Water under pressure ---------------- */
function renderPressure(list) {
  const by = new Map();
  for (const a of list) {
    if (a.dist > 250 || !a.waterKey) continue;
    /* A river by its name — its reaches are one river — and a water body
       by its id, because most ponds have no name and would merge into one */
    const k = a.waterKey.startsWith('river') ? `river:${a.water}` : `${a.waterKey}:${a.waterId}`;
    const e = by.get(k) ?? { water: a.water, id: a.waterId, key: a.waterKey, n: 0, reserve: 0, unlic: 0, cats: new Set(), a: null };
    e.n += 1;
    if (a.zone.id === 'reserve') e.reserve += 1;
    if (!a.licensed) e.unlic += 1;
    e.cats.add(a.act.en);
    if (!e.a || a.dist < e.a.dist) e.a = a;
    by.set(k, e);
  }
  const top = [...by.values()].sort((x, y) => y.n - x.n || y.reserve - x.reserve).slice(0, 8);
  $('ssPressure').innerHTML = top.map((e) => `
    <button class="ss-press" data-lat="${e.a.lat}" data-lon="${e.a.lon}" data-src="${e.a.id}"
      title="Open the map at the closest activity">
      <div class="ss-press-h"><b>${esc(e.water)}</b>
        <span class="ml-rng">${e.key.startsWith('river') ? 'river' : 'water body'}${/^(Pond|Lake or reservoir|Open water|Channel|Treatment pond)$/.test(e.water) ? ` · #${e.id}` : ''}</span></div>
      <div class="ss-press-n"><b>${e.n}</b> ${e.n === 1 ? 'activity' : 'activities'} within 250 m
        · <span style="color:#d92d20">${e.reserve} in the reserve</span> · ${e.unlic} unlicensed</div>
      <div class="ss-press-c">${[...e.cats].map(esc).join(' · ')}</div>
    </button>`).join('') || '<div class="empty-row">Nothing within 250 m of any water.</div>';
  $('ssPressure').querySelectorAll('.ss-press').forEach((b) => {
    b.onclick = () => document.dispatchEvent(new CustomEvent('showonmap', {
      detail: { lat: Number(b.dataset.lat), lon: Number(b.dataset.lon), srcId: Number(b.dataset.src) },
    }));
  });
}

/* ---------------- Satellite check ---------------- */
function renderSatellite() {
  $('ssSat').innerHTML = Object.entries(WQ_PRODUCTS).map(([k, d]) => `
    <button class="ss-sat" data-wq="${k}">
      <div class="ss-sat-h"><b>${d.label}</b> · ${esc(d.long)}</div>
      <div class="idx-ramp" style="background:${d.ramp}"></div>
      <div class="idx-lab"><span>${esc(d.lo)}</span><span>${esc(d.hi)}</span></div>
      <div class="ss-sat-n">${esc(d.note)}${d.caveat ? ' <b>Uncalibrated.</b>' : ''}</div>
    </button>`).join('');
  $('ssSat').querySelectorAll('[data-wq]').forEach((b) => {
    b.onclick = () => document.dispatchEvent(new CustomEvent('showonmap', { detail: { wq: b.dataset.wq } }));
  });
}

export function resizeSesams() { Object.values(charts).forEach((c) => c.resize()); }


/* ============================================================
   Earth surface change — the satellite scan

   The function SESAMS exists for: look at the surface from orbit on two
   dates and say where it changed near water. Two quarters of a product are
   read tile by tile at zoom 13 and turned back into numbers through the
   product's colour ramp (0–100, relative). For every water body of half a
   hectare or more, two means are taken on each date: inside the water, and
   on a 250 m ring of land around it. Turbidity rising on the ring is
   ground newly exposed — clearing, earthworks, a pit opening; rising in
   the water is that activity arriving. The catchment's rivers are a pixel
   wide at this zoom and are not scanned; the ponds and lakes are where
   the surface change shows first.
   ============================================================ */
const SCAN_Z = 13;
const MIN_AREA = 5000;          /* m²: half a hectare, ≈ 14 pixels at zoom 13 */
const RING_M = 250;
const FLAG = 8;                 /* points of the 0–100 scale that count as a change in the water */
const FLAG_LAND = 10;           /* percentage points of bare ground gained around it */
const rasters = new Map();      /* `${product}:${quarter}` → { x0, y0, w, h, val } */
let scanResult = null;

function buildScan() {
  $('scanProduct').innerHTML = Object.entries(WQ_PRODUCTS)
    .map(([k, d]) => `<option value="${k}">${d.label} · ${esc(d.long)}</option>`).join('');
  const q = (sel, def) => {
    $(sel).innerHTML = WQ_QUARTERS.map((x) => `<option value="${x.id}">${x.label}</option>`).join('');
    $(sel).value = def;
  };
  q('scanFrom', WQ_QUARTERS[0].id);
  q('scanTo', WQ_QUARTERS.at(-1).id);
  if (typeof pmtiles === 'undefined') {
    $('scanRun').disabled = true;
    $('scanNote').textContent = 'The tile reader did not load, so the scan is unavailable.';
  }
  $('scanRun').onclick = runScan;
  $('scanTable').querySelector('tbody').onclick = (e) => {
    const b = e.target.closest('[data-show]');
    if (!b) return;
    document.dispatchEvent(new CustomEvent('showonmap', {
      detail: { lat: Number(b.dataset.lat), lon: Number(b.dataset.lon),
        wq: $('scanProduct').value, quarter: $('scanTo').value },
    }));
  };
}

/* Web Mercator pixel of a lon/lat at the scan zoom */
function toPx(lon, lat) {
  const n = 2 ** SCAN_Z * 256;
  const r = lat * Math.PI / 180;
  return { x: (lon + 180) / 360 * n, y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n };
}
const metresPerPx = (lat) => 156543.03 * Math.cos(lat * Math.PI / 180) / 2 ** SCAN_Z;

/* Colour back to a 0–1 position on the product's ramp. The ramp is sampled
   at 256 steps and each pixel colour takes the nearest; quantised to 5 bits
   a channel so a scene of a few hundred colours costs a few hundred looks. */
function lutFor(product) {
  const stops = WQ_PRODUCTS[product].stops.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  const samples = [];
  for (let i = 0; i < 256; i++) {
    const t = i / 255 * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
    samples.push(stops[k].map((c, j) => c + (stops[k + 1][j] - c) * f));
  }
  const cache = new Map();
  return (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let v = cache.get(key);
    if (v === undefined) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < 256; i++) {
        const s = samples[i];
        const d = (s[0] - r) ** 2 + (s[1] - g) ** 2 + (s[2] - b) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      v = best / 255;
      cache.set(key, v);
    }
    return v;
  };
}

/* One quarter of one product over the catchment, as a value grid */
async function loadRaster(product, quarter, box, onProgress) {
  const key = `${product}:${quarter}`;
  if (rasters.has(key)) { onProgress(1); return rasters.get(key); }
  const src = new pmtiles.PMTiles(wqUrl(product, quarter));
  const a = toPx(box.w, box.n), b = toPx(box.e, box.s);
  const tx0 = Math.floor(a.x / 256), ty0 = Math.floor(a.y / 256);
  const tx1 = Math.floor(b.x / 256), ty1 = Math.floor(b.y / 256);
  const w = (tx1 - tx0 + 1) * 256, h = (ty1 - ty0 + 1) * 256;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const todo = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) todo.push([tx, ty]);
  let done = 0;
  const worker = async () => {
    while (todo.length) {
      const [tx, ty] = todo.shift();
      try {
        const t = await src.getZxy(SCAN_Z, tx, ty);
        if (t?.data) {
          const bmp = await createImageBitmap(new Blob([t.data], { type: 'image/png' }));
          ctx.drawImage(bmp, (tx - tx0) * 256, (ty - ty0) * 256);
        }
      } catch (e) { /* a missing tile is no data, not a failure */ }
      done += 1;
      onProgress(done / ((tx1 - tx0 + 1) * (ty1 - ty0 + 1)));
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  const img = ctx.getImageData(0, 0, w, h).data;
  const lut = lutFor(product);
  const val = new Float32Array(w * h);
  for (let i = 0, n = w * h; i < n; i++) {
    val[i] = img[i * 4 + 3] ? lut(img[i * 4], img[i * 4 + 1], img[i * 4 + 2]) : NaN;
  }
  const r = { x0: tx0 * 256, y0: ty0 * 256, w, h, val };
  rasters.set(key, r);
  return r;
}

/* Mean of a raster over a mask, or NaN with too few pixels to trust */
function meanOver(r, mask, min) {
  let t = 0, n = 0;
  for (const i of mask) { const v = r.val[i]; if (!Number.isNaN(v)) { t += v; n += 1; } }
  return n >= min ? t / n : NaN;
}

/* Share of a mask that reads as bare ground: past the ramp's midpoint,
   where vegetation never sits. A mean over a 250 m ring would hide a
   single cleared plot in it; the share of bare pixels does not. */
const BARE = 0.5;
function bareShare(r, mask, min) {
  let b = 0, n = 0;
  for (const i of mask) { const v = r.val[i]; if (!Number.isNaN(v)) { n += 1; if (v >= BARE) b += 1; } }
  return n >= min ? b / n : NaN;
}

/* The two pixel sets for one water body: inside it, and the ring of land
   around it. Drawn on a small canvas the size of the body's box plus the
   ring, so the browser does the point-in-polygon. */
function masksFor(f, r) {
  const ring = f.geometry.coordinates[0].map(([lon, lat]) => {
    const p = toPx(lon, lat); return [p.x - r.x0, p.y - r.y0];
  });
  const pad = Math.ceil(RING_M / metresPerPx(f.properties.lat)) + 1;
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const bx0 = Math.max(0, Math.floor(Math.min(...xs)) - pad), by0 = Math.max(0, Math.floor(Math.min(...ys)) - pad);
  const bx1 = Math.min(r.w - 1, Math.ceil(Math.max(...xs)) + pad), by1 = Math.min(r.h - 1, Math.ceil(Math.max(...ys)) + pad);
  const w = bx1 - bx0 + 1, h = by1 - by0 + 1;
  if (w <= 0 || h <= 0) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const path = () => {
    ctx.beginPath();
    ring.forEach(([x, y], i) => (i ? ctx.lineTo(x - bx0, y - by0) : ctx.moveTo(x - bx0, y - by0)));
    ctx.closePath();
  };
  path(); ctx.fillStyle = '#fff'; ctx.fill();
  const fill = ctx.getImageData(0, 0, w, h).data;
  ctx.clearRect(0, 0, w, h);
  path(); ctx.lineWidth = pad * 2; ctx.strokeStyle = '#fff'; ctx.stroke();
  const stroke = ctx.getImageData(0, 0, w, h).data;
  const inside = [], around = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4 + 3, gi = (by0 + y) * r.w + (bx0 + x);
    if (fill[i] > 127) inside.push(gi);
    else if (stroke[i] > 127) around.push(gi);
  }
  return { inside, around };
}

async function runScan() {
  const product = $('scanProduct').value, from = $('scanFrom').value, to = $('scanTo').value;
  const d = WQ_PRODUCTS[product];
  if (from === to) { $('scanNote').textContent = 'Pick two different quarters.'; return; }
  const btn = $('scanRun'); btn.disabled = true;
  const prog = $('scanProg'); prog.hidden = false;
  const bar = prog.querySelector('i'), lab = prog.querySelector('span');
  const step = (what, f) => { bar.style.width = `${Math.round(f * 100)}%`; lab.textContent = what; };

  const feats = DATA.water.geo.features.filter((f) => f.properties.area_m2 >= MIN_AREA);
  const box = {
    w: Math.min(...feats.map((f) => f.properties.lon)) - 0.02, e: Math.max(...feats.map((f) => f.properties.lon)) + 0.02,
    s: Math.min(...feats.map((f) => f.properties.lat)) - 0.02, n: Math.max(...feats.map((f) => f.properties.lat)) + 0.02,
  };
  try {
    const A = await loadRaster(product, from, box, (f) => step(`Reading ${from.replace('_', ' ')} tiles…`, f * 0.45));
    const B = await loadRaster(product, to, box, (f) => step(`Reading ${to.replace('_', ' ')} tiles…`, 0.45 + f * 0.45));
    step('Comparing every water body…', 0.92);
    await new Promise((r) => setTimeout(r, 20));

    const rows = [];
    for (const f of feats) {
      const m = masksFor(f, A);
      if (!m) continue;
      const wA = meanOver(A, m.inside, 4), wB = meanOver(B, m.inside, 4);
      const lA = bareShare(A, m.around, 8), lB = bareShare(B, m.around, 8);
      if (Number.isNaN(wA) && Number.isNaN(lA)) continue;
      const p = f.properties;
      rows.push({
        id: p.id, name: p.name ?? null, group: p.group, kind: p.kind, area: p.area_m2, lat: p.lat, lon: p.lon,
        water: [wA * 100, wB * 100], land: [lA * 100, lB * 100],
        dWater: (wB - wA) * 100, dLand: (lB - lA) * 100,
      });
    }
    scanResult = { product, from, to, rows };
    renderScan();
  } catch (e) {
    $('scanNote').textContent = `The scan could not read the tiles: ${e.message}`;
  } finally {
    btn.disabled = false;
    prog.hidden = true;
  }
}

function verdict(r, q) {
  const land = !Number.isNaN(r.dLand) && r.dLand >= FLAG_LAND;
  const water = !Number.isNaN(r.dWater) && r.dWater >= FLAG;
  const calmed = !Number.isNaN(r.dLand) && r.dLand <= -FLAG_LAND;
  if (land && water) return { t: `Ground exposed, ${q} up in the water`, c: 'st-fail' };
  if (land) return { t: 'Ground newly exposed around it', c: 'st-fail' };
  if (water) return { t: `${q[0].toUpperCase()}${q.slice(1)} up in the water`, c: 'st-warn' };
  if (calmed) return { t: 'Surroundings revegetated', c: 'st-pass' };
  return { t: 'No change of note', c: 'st-off' };
}

function renderScan() {
  const { product, from, to, rows } = scanResult;
  const d = WQ_PRODUCTS[product];
  const q = d.quantity;
  const fl = (v) => (Number.isNaN(v) ? '—' : v.toFixed(0));
  const dl = (v, flag = FLAG) => Number.isNaN(v) ? '<span class="muted">—</span>'
    : `<b style="color:${v >= flag ? '#b42318' : v <= -flag ? '#0d7a3f' : 'var(--muted)'}">${v > 0 ? '+' : ''}${v.toFixed(0)}</b>`;
  const flagged = rows.filter((r) => r.dLand >= FLAG_LAND || r.dWater >= FLAG);
  const landUp = rows.filter((r) => r.dLand >= FLAG_LAND).length;
  const waterUp = rows.filter((r) => r.dWater >= FLAG).length;
  const ranked = rows.slice().sort((a, b) =>
    Math.max(b.dLand || -99, b.dWater || -99) - Math.max(a.dLand || -99, a.dWater || -99));
  const show = ranked.slice(0, 40);
  const fromL = from.replace('_', ' '), toL = to.replace('_', ' ');

  $('scanOut').hidden = false;
  $('scanKpis').innerHTML = `
    <div class="card kpi">
      <div class="k-lab">Water bodies compared</div>
      <div class="k-val">${nf(rows.length)}</div>
      <div class="k-sub">${d.label} · ${fromL} → ${toL}</div>
      <div class="k-note">Half a hectare and up, with tiles on both dates.</div>
    </div>
    <div class="card kpi">
      <div class="k-lab">Ground newly exposed</div>
      <div class="k-val" style="color:#b42318">${nf(landUp)}</div>
      <div class="k-sub">bare ground around it up ${FLAG_LAND}+ points</div>
      <div class="k-note">Clearing, earthworks or a pit opening within 250 m of the water.</div>
    </div>
    <div class="card kpi">
      <div class="k-lab">${q[0].toUpperCase()}${q.slice(1)} up in the water</div>
      <div class="k-val" style="color:#ef7d1a">${nf(waterUp)}</div>
      <div class="k-sub">water rose ${FLAG}+ points</div>
      <div class="k-note">${flagged.length} bodies flagged on either count; the ${Math.min(40, ranked.length)} largest changes are listed.</div>
    </div>`;

  $('scanTable').querySelector('tbody').innerHTML = show.map((r) => {
    const v = verdict(r, q);
    return `<tr>
      <td><b>${r.name ? esc(r.name) : `Unnamed ${esc(r.kind)}`}</b><span class="sub">${r.name ? esc(r.kind) : `#${r.id}`}</span></td>
      <td>${esc(r.group)}</td>
      <td class="num">${(r.area / 1e4).toFixed(1)} ha</td>
      <td class="num">${fl(r.land[0])}% → ${fl(r.land[1])}% &nbsp;${dl(r.dLand, FLAG_LAND)}</td>
      <td class="num">${fl(r.water[0])} → ${fl(r.water[1])} &nbsp;${dl(r.dWater)}</td>
      <td><span class="pill-status ${v.c}">${v.t}</span></td>
      <td class="act"><button class="mini" data-show data-lat="${r.lat}" data-lon="${r.lon}"
        title="Open the map here with ${d.label} ${toL} on">Map</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="empty-row">Nothing could be compared: no tiles on both dates.</td></tr>';

  $('scanFoot').innerHTML = `The water column is the ${d.label} colour ramp read back as 0–100 at 19 m per pixel; a
    change is in points of that scale, not in physical units${d.caveat ? ', and this product is uncalibrated' : ''}.
    The land column is the share of the 250 m ring that reads as bare ground — past the ramp's midpoint, where
    vegetation never sits; up ${FLAG_LAND}+ points means ground that was covered in ${fromL} was open in ${toL}.
    The map button opens the ${toL} layer there so the change can be seen against the imagery.`;
}
