/* ============================================================
   app.js — View routing and application bootstrap
   ============================================================ */
import { DATA, loadAll, basinStats } from './data.js';
import { WQI_CLASSES, PARAM_META, thresholdText } from './wqi.js';
import { initMap, getMonthIdx, refreshMapSize, focusStation, BASEMAPS } from './mapview.js';
import { renderDashboard, renderNational, renderSources, resizeCharts } from './dashboard.js';
import { WATER_INDICES } from './satellite.js';
import { initEntry, resizePickMap } from './entry.js';
import { initSearch } from './search.js';

const nf = (n) => n.toLocaleString('en-MY');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let dashReady = false, srcReady = false, guideReady = false;

/* Old deep links from when Sources and Satellite were separate views */
const VIEW_ALIAS = { sources: 'dashboard', satellite: 'map', peta: 'map', punca: 'dashboard' };

/* ---------------- Clock ---------------- */
function tick() {
  const d = new Date();
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'][d.getMonth()];
  document.getElementById('clock').textContent =
    `${day}, ${d.getDate()} ${month} ${d.getFullYear()} · ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------------- Navigation ---------------- */
function show(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('#nav button').forEach((b) => b.classList.remove('active'));
  document.getElementById(`v-${view}`).classList.add('active');
  document.querySelector(`#nav button[data-view="${view}"]`).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });

  if (view === 'map') refreshMapSize();
  if (view === 'dashboard') {
    if (!dashReady) { renderDashboard(getMonthIdx()); renderNational('bod5'); dashReady = true; }
    else resizeCharts();
  }
  if (view === 'entry') { initEntry(); resizePickMap(); }
  if (view === 'guide' && !guideReady) { renderGuide(); guideReady = true; }
  location.hash = view;
}

/* ---------------- Guide view ---------------- */
function renderGuide() {
  document.getElementById('classCards').innerHTML = WQI_CLASSES.map((c) => `
    <div class="class-card">
      <div class="cc-top" style="background:linear-gradient(125deg,${c.color},${dim(c.color)})">
        <div class="cc-id">${c.id}</div>
        <div class="cc-st">${c.status}</div>
        <div class="cc-rg">WQI ${c.max > 100 ? '92.7 – 100' : `${c.min < 0 ? '0' : c.min} – ${c.max}`}</div>
      </div>
      <div class="cc-body">${c.use}</div>
    </div>`).join('');

  document.getElementById('threshTable').innerHTML = Object.entries(PARAM_META).map(([k, m]) => {
    const t = thresholdText(k);
    return `<tr>
      <td><b>${m.name}</b></td>
      <td>${m.unit || '—'}</td>
      <td><span class="dot-st st-clean"></span>${t.clean}</td>
      <td><span class="dot-st st-slight"></span>${t.slight}</td>
      <td><span class="dot-st st-polluted"></span>${t.polluted}</td>
      <td style="color:var(--muted);font-size:11.5px">${m.role}</td>
    </tr>`;
  }).join('');

  document.getElementById('srcMetaCount').textContent =
    `${nf(DATA.sources.features.length)} locations in the 1.5 km riparian zone`;

  const covered = DATA.sewerage.features.filter((f) => f.properties.covered).length;
  document.getElementById('sewerMetaCount').textContent =
    `${nf(DATA.sewerage.features.length)} reaches · ${nf(covered)} culverted`;

  /* Satellite imagery layers available in the map's Base map menu */
  document.getElementById('satTable').innerHTML = Object.values(BASEMAPS)
    .filter((d) => d.group === 'sat')
    .map((d) => `<tr>
      <td><b>${esc(d.label)}</b></td>
      <td class="num">${esc(d.res)}</td>
      <td style="font-size:11.5px;color:var(--muted)">${esc(d.src)}</td>
    </tr>`).join('');

  document.getElementById('idxList').innerHTML = WATER_INDICES.map((x) => `
    <div class="idx-item">
      <div class="ii-h">${x.name}</div>
      <code style="display:inline-block;margin-top:5px">${x.formula}</code>
      <div class="ramp" style="background:${x.ramp}"></div>
      <div class="ramp-lbl"><span>${x.lo}</span><span>${x.hi}</span></div>
      <div class="ii-b">${x.body}</div>
    </div>`).join('');

  /* Parameter weight chart */
  const W = [
    ['Dissolved Oxygen (DO)', 0.22], ['BOD₅', 0.19], ['COD', 0.16],
    ['Suspended Solids (SS)', 0.16], ['NH₃-N', 0.15], ['pH', 0.12],
  ];
  new Chart(document.getElementById('cWeights'), {
    type: 'bar',
    data: {
      labels: W.map((w) => w[0]),
      datasets: [{
        data: W.map((w) => w[1] * 100), backgroundColor: '#2a78d6',
        borderRadius: 4, borderSkipped: false, barThickness: 16,
        borderWidth: 2, borderColor: '#fff',
      }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(22,23,63,.96)', padding: 9, cornerRadius: 8,
          callbacks: { label: (c) => ` Weight ${(c.parsed.x / 100).toFixed(2)} (${c.parsed.x}%)` },
        },
      },
      scales: {
        x: { min: 0, max: 25, grid: { color: '#eaedf3' }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: '#8b93a8', callback: (v) => `${v}%` } },
        y: { grid: { display: false }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: '#5f6880' } },
      },
    },
  });
}

function dim(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, v - 34);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/* ---------------- Bootstrap ---------------- */
(async function boot() {
  tick(); setInterval(tick, 30000);

  const bar = document.getElementById('lbar');
  const txt = document.getElementById('ltxt');
  try {
    await loadAll((p, msg) => {
      bar.style.width = `${(p * 100).toFixed(0)}%`;
      txt.textContent = msg;
    });
  } catch (e) {
    txt.innerHTML = `<span style="color:#ffb4a8">Could not load data:<br>${esc(e.message)}<br><br>
      Serve this site over HTTP (run <b>python serve.py</b>)<br>rather than opening the file directly.</span>`;
    return;
  }

  initMap();
  initSearch();
  const st = basinStats(getMonthIdx());
  document.getElementById('pillStations').textContent = DATA.stations.length;
  document.getElementById('pillWqi').textContent = st.mean.toFixed(1);
  document.getElementById('pillSources').textContent = nf(DATA.sources.features.length);
  document.getElementById('periodLabel').textContent =
    `${DATA.months[0]} to ${DATA.months[DATA.months.length - 1]}`;

  document.querySelectorAll('#nav button').forEach((b) => {
    b.onclick = () => show(b.dataset.view);
  });
  document.getElementById('measureSelect').onchange = (e) => renderNational(e.target.value);

  /* Dashboard sub-tabs: Water Quality / Pollution Sources */
  document.querySelectorAll('#dashTabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#dashTabs button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      document.querySelectorAll('#v-dashboard .tab-pane').forEach((x) => x.classList.remove('active'));
      document.getElementById(`dtab-${b.dataset.dtab}`).classList.add('active');
      if (b.dataset.dtab === 'sources') {
        if (!srcReady) { renderSources(1500); srcReady = true; } else resizeCharts();
      } else {
        resizeCharts();
      }
    };
  });

  /* The map's month slider refreshes the dashboard */
  document.addEventListener('monthchange', (e) => {
    if (dashReady) renderDashboard(e.detail);
    document.getElementById('pillWqi').textContent = basinStats(e.detail).mean.toFixed(1);
  });
  /* Table row click → open that station on the map */
  document.addEventListener('gotostation', (e) => { show('map'); focusStation(e.detail); });

  window.addEventListener('resize', () => { refreshMapSize(); resizePickMap(); });

  const h = VIEW_ALIAS[location.hash.slice(1)] ?? location.hash.slice(1);
  if (h && document.getElementById(`v-${h}`)) show(h);

  document.getElementById('loader').classList.add('hide');
  setTimeout(() => document.getElementById('loader').remove(), 500);
})();
