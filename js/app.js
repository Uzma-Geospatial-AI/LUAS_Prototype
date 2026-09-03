/* ============================================================
   app.js — Kawalan paparan & permulaan aplikasi
   ============================================================ */
import { DATA, loadAll, basinStats } from './data.js';
import { WQI_CLASSES, PARAM_META } from './wqi.js';
import { initMap, getMonthIdx, refreshMapSize, focusStation } from './mapview.js';
import { renderDashboard, renderNational, renderSources, resizeCharts } from './dashboard.js';
import { initSat, resizeSat } from './satellite.js';

const nf = (n) => n.toLocaleString('ms-MY');
let satReady = false, dashReady = false, srcReady = false, guideReady = false;

/* ---------------- Jam ---------------- */
function tick() {
  const d = new Date();
  const hari = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'][d.getDay()];
  const bulan = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai',
    'Ogos', 'September', 'Oktober', 'November', 'Disember'][d.getMonth()];
  document.getElementById('clock').textContent =
    `${hari}, ${d.getDate()} ${bulan} ${d.getFullYear()} · ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------------- Navigasi ---------------- */
function show(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('#nav button').forEach((b) => b.classList.remove('active'));
  document.getElementById('v-' + view).classList.add('active');
  document.querySelector(`#nav button[data-view="${view}"]`).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });

  if (view === 'peta') refreshMapSize();
  if (view === 'dashboard') {
    if (!dashReady) { renderDashboard(getMonthIdx()); renderNational('bod5'); dashReady = true; }
    else resizeCharts();
  }
  if (view === 'punca') {
    if (!srcReady) { renderSources(1500); srcReady = true; } else resizeCharts();
  }
  if (view === 'satelit') {
    if (!satReady) { initSat(); satReady = true; } else resizeSat();
  }
  if (view === 'panduan' && !guideReady) { renderGuide(); guideReady = true; }
  location.hash = view;
}

/* ---------------- Paparan panduan ---------------- */
function renderGuide() {
  document.getElementById('classCards').innerHTML = WQI_CLASSES.map((c) => `
    <div class="class-card">
      <div class="cc-top" style="background:linear-gradient(125deg,${c.color},${dim(c.color)})">
        <div class="cc-id">${c.id}</div>
        <div class="cc-st">${c.status}</div>
        <div class="cc-rg">WQI ${c.max > 100 ? '92.7 – 100' : `${c.min < 0 ? '0' : c.min} – ${c.max}`}
          · ${c.statusEn}</div>
      </div>
      <div class="cc-body">${c.use}</div>
    </div>`).join('');

  const roles = {
    do: 'Menyokong hidupan akuatik. Menurun apabila bahan organik mereput — penunjuk tekanan paling langsung.',
    bod: 'Oksigen yang digunakan mikrob untuk mengurai bahan organik. Menandakan kumbahan dan sisa makanan.',
    cod: 'Jumlah bahan boleh teroksida termasuk sebatian kimia. Menandakan efluen industri.',
    ss: 'Zarah terampai yang mengeruhkan air, menghalang cahaya dan menyelaputi dasar sungai.',
    an: 'Ammonia daripada kumbahan, baja dan sisa ternakan. Toksik kepada ikan; punca eutrofikasi.',
    ph: 'Keasidan/kealkalian. Sisihan menandakan pelepasan industri atau saliran asid.',
  };
  document.getElementById('threshTable').innerHTML = Object.entries(PARAM_META).map(([k, m]) => {
    const f = (r) => (k === 'do' ? '≥ 5' : k === 'ph' ? '6 – 9' : `≤ ${r[1]}`);
    const s = (r) => (k === 'do' ? '3 – 5' : k === 'ph' ? '5 – 6 / 9 – 10' : `${r[0]} – ${r[1]}`);
    const p = () => (k === 'do' ? '< 3' : k === 'ph' ? '< 5 atau > 10' : `> ${m.slight[1]}`);
    return `<tr>
      <td><b>${m.name}</b></td>
      <td>${m.unit || '—'}</td>
      <td><span class="dot-st st-clean"></span>${f(m.clean)}</td>
      <td><span class="dot-st st-slight"></span>${s(m.slight)}</td>
      <td><span class="dot-st st-polluted"></span>${p()}</td>
      <td style="color:var(--muted);font-size:11.5px">${roles[k]}</td>
    </tr>`;
  }).join('');

  document.getElementById('srcMetaCount').textContent =
    `${nf(DATA.sources.features.length)} lokasi dalam zon riparian 1.5 km`;

  /* Carta pemberat */
  const W = [
    ['Oksigen Terlarut (DO)', 0.22], ['BOD₅', 0.19], ['COD', 0.16],
    ['Pepejal Terampai (SS)', 0.16], ['NH₃-N', 0.15], ['pH', 0.12],
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
          callbacks: { label: (c) => ` Pemberat ${(c.parsed.x / 100).toFixed(2)} (${c.parsed.x}%)` },
        },
      },
      scales: {
        x: { min: 0, max: 25, grid: { color: '#eaedf3' }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: '#8b93a8', callback: (v) => v + '%' } },
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

/* ---------------- Permulaan ---------------- */
(async function boot() {
  tick(); setInterval(tick, 30000);

  const bar = document.getElementById('lbar');
  const txt = document.getElementById('ltxt');
  try {
    await loadAll((p, msg) => {
      bar.style.width = (p * 100).toFixed(0) + '%';
      txt.textContent = msg;
    });
  } catch (e) {
    txt.innerHTML = `<span style="color:#ffb4a8">Gagal memuat data:<br>${e.message}<br><br>
      Pastikan laman ini dihidangkan melalui pelayan HTTP<br>(jalankan <b>python serve.py</b>),
      bukan dibuka terus sebagai fail.</span>`;
    return;
  }

  initMap();
  const st = basinStats(getMonthIdx());
  document.getElementById('pillStations').textContent = DATA.stations.length;
  document.getElementById('pillWqi').textContent = st.mean.toFixed(1);
  document.getElementById('pillSources').textContent = nf(DATA.sources.features.length);
  document.getElementById('periodLabel').textContent =
    `${DATA.months[0]} hingga ${DATA.months[DATA.months.length - 1]}`;

  document.querySelectorAll('#nav button').forEach((b) => {
    b.onclick = () => show(b.dataset.view);
  });
  document.getElementById('measureSelect').onchange = (e) => renderNational(e.target.value);

  /* Slider bulan pada peta menyegarkan papan pemuka */
  document.addEventListener('monthchange', (e) => {
    if (dashReady) renderDashboard(e.detail);
    const s = basinStats(e.detail);
    document.getElementById('pillWqi').textContent = s.mean.toFixed(1);
  });
  /* Klik baris jadual → buka stesen pada peta */
  document.addEventListener('gotostation', (e) => { show('peta'); focusStation(e.detail); });

  window.addEventListener('resize', () => { refreshMapSize(); resizeSat(); });

  const h = location.hash.slice(1);
  if (h && document.getElementById('v-' + h)) show(h);

  document.getElementById('loader').classList.add('hide');
  setTimeout(() => document.getElementById('loader').remove(), 500);
})();
