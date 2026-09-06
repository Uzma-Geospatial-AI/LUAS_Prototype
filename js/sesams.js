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
import { WQ_PRODUCTS } from './satellite.js';

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
  if (!built) { buildControls(); built = true; }
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
