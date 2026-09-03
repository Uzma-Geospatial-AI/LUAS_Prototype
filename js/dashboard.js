/* ============================================================
   dashboard.js — Papan pemuka & carta
   ============================================================ */
import { DATA, readingAt, basinStats, basinTrend, sourceStats } from './data.js';
import { WQI_CLASSES, wqiClass, wqiColor, PARAM_META } from './wqi.js';

const INK = { primary: '#1a1d2b', secondary: '#5f6880', muted: '#8b93a8', grid: '#eaedf3', axis: '#cfd5e3' };
const charts = {};
const MONTH_MS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
const fmtMonth = (m) => `${MONTH_MS[+m.split('-')[1] - 1]} ${m.split('-')[0]}`;
const nf = (n, d = 0) => n.toLocaleString('ms-MY', { minimumFractionDigits: d, maximumFractionDigits: d });

/* Tetapan Chart.js sepunya */
const baseOpts = (over = {}) => ({
  responsive: true, maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      display: true, position: 'bottom', align: 'start',
      labels: {
        boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'rectRounded',
        font: { size: 11, family: 'Inter, sans-serif' }, color: INK.secondary, padding: 13,
      },
    },
    tooltip: {
      backgroundColor: 'rgba(22,23,63,.96)', padding: 10, cornerRadius: 8,
      titleFont: { size: 11.5, weight: '600' }, bodyFont: { size: 11.5 },
      bodySpacing: 4, boxWidth: 8, boxHeight: 8, usePointStyle: true, borderWidth: 0,
    },
  },
  scales: {
    x: { grid: { display: false }, border: { color: INK.axis },
      ticks: { font: { size: 10.5 }, color: INK.muted, maxRotation: 0, autoSkipPadding: 14 } },
    y: { grid: { color: INK.grid }, border: { display: false },
      ticks: { font: { size: 10.5 }, color: INK.muted } },
  },
  ...over,
});

const kill = (k) => { charts[k]?.destroy(); delete charts[k]; };

/* ============================================================
   Papan pemuka utama
   ============================================================ */
export function renderDashboard(monthIdx) {
  const st = basinStats(monthIdx);
  const src = sourceStats(1500);
  const near250 = Object.values(src).reduce((t, c) => t + c.near, 0);
  const total = Object.values(src).reduce((t, c) => t + c.n, 0);
  const worst = [...DATA.stations].sort(
    (a, b) => readingAt(a, monthIdx).wqi - readingAt(b, monthIdx).wqi)[0];
  const meanDelta = DATA.stations.reduce((t, s) => t + s.delta, 0) / DATA.stations.length;

  /* ---- KPI ---- */
  document.getElementById('kpis').innerHTML = [
    { lab: 'Purata WQI lembangan', val: st.mean.toFixed(1), color: st.cls.color,
      sub: `${st.cls.label} — ${st.cls.status}`,
      trend: meanDelta, trendLab: 'berbanding 12 bulan sebelum' },
    { lab: 'Stesen tercemar (Kelas IV–V)', val: `${st.polluted}`, color: st.polluted ? '#d92d20' : '#17a04a',
      sub: `daripada ${st.n} stesen dipantau` },
    { lab: 'Stesen paling kritikal', val: readingAt(worst, monthIdx).wqi.toFixed(1),
      color: wqiColor(readingAt(worst, monthIdx).wqi), sub: `${worst.code} · ${worst.name}` },
    { lab: 'Punca dalam 250 m alur air', val: nf(near250), color: '#22235f',
      sub: `daripada ${nf(total)} dalam zon riparian 1.5 km` },
  ].map((k) => `
    <div class="card kpi">
      <div class="k-lab">${k.lab}</div>
      <div class="k-val" style="color:${k.color}">${k.val}</div>
      <div class="k-sub">${k.sub}</div>
      ${k.trend !== undefined ? `<div class="k-trend ${k.trend > 0.5 ? 'trend-up' : k.trend < -0.5 ? 'trend-down' : 'trend-flat'}">
        ${k.trend >= 0 ? '▲' : '▼'} ${Math.abs(k.trend).toFixed(1)} mata · ${k.trendLab}</div>` : ''}
    </div>`).join('');

  drawSegmentTrend();
  drawProfile(monthIdx);
  drawClassBar(monthIdx);
  drawSubIndex(monthIdx);
  drawStationTable(monthIdx);
}

/* ---- 1. Arah aliran WQI mengikut segmen sungai (4 siri) ---- */
function drawSegmentTrend() {
  kill('segTrend');
  const SEGS = [
    { key: 'hulu',   label: 'Hulu (Hulu Langat)',       color: '#2a78d6' },
    { key: 'tengah', label: 'Tengah (Kajang–Dengkil)',  color: '#eda100' },
    { key: 'hilir',  label: 'Hilir (Banting–T.P. Garang)', color: '#eb6834' },
    { key: 'muara',  label: 'Muara (Kuala Langat)',     color: '#008300' },
  ];
  const ds = SEGS.map((sg) => {
    const stns = DATA.stations.filter((s) => s.segment === sg.key);
    return {
      label: sg.label, borderColor: sg.color, backgroundColor: sg.color,
      borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 4.5,
      pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
      data: DATA.months.map((_, i) =>
        Math.round((stns.reduce((t, s) => t + s.wqiSeries[i].wqi, 0) / stns.length) * 10) / 10),
    };
  });
  charts.segTrend = new Chart(document.getElementById('cSegTrend'), {
    type: 'line',
    data: { labels: DATA.months.map(fmtMonth), datasets: ds },
    options: baseOpts({
      plugins: {
        ...baseOpts().plugins,
        tooltip: { ...baseOpts().plugins.tooltip,
          callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)} (${wqiClass(c.parsed.y).status})` } },
        annotation: undefined,
      },
      scales: {
        ...baseOpts().scales,
        y: { ...baseOpts().scales.y, min: 20, max: 100,
          title: { display: true, text: 'Indeks Kualiti Air (WQI)', font: { size: 10.5 }, color: INK.muted } },
      },
    }),
  });
}

/* ---- 2. Profil hulu → hilir ---- */
function drawProfile(monthIdx) {
  kill('profile');
  const main = DATA.stations.filter((s) => s.river === 'Sungai Langat');
  const vals = main.map((s) => readingAt(s, monthIdx).wqi);
  charts.profile = new Chart(document.getElementById('cProfile'), {
    type: 'bar',
    data: {
      labels: main.map((s) => s.name.split(' (')[0].split(',')[0]),
      datasets: [{
        label: 'WQI', data: vals,
        backgroundColor: vals.map((v) => wqiColor(v)),
        borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 34,
        borderWidth: 2, borderColor: '#fff',
      }],
    },
    options: baseOpts({
      plugins: {
        legend: { display: false },
        tooltip: { ...baseOpts().plugins.tooltip,
          callbacks: {
            title: (c) => main[c[0].dataIndex].code + ' · ' + main[c[0].dataIndex].name,
            label: (c) => ` WQI ${c.parsed.y.toFixed(1)} — ${wqiClass(c.parsed.y).label} (${wqiClass(c.parsed.y).status})`,
          } },
      },
      scales: {
        x: { ...baseOpts().scales.x, ticks: { ...baseOpts().scales.x.ticks, maxRotation: 42, minRotation: 42, font: { size: 9.5 } } },
        y: { ...baseOpts().scales.y, min: 0, max: 100,
          title: { display: true, text: 'WQI (hulu → muara)', font: { size: 10.5 }, color: INK.muted } },
      },
    }),
  });
}

/* ---- 3. Taburan kelas (bar bertindan mendatar) ---- */
function drawClassBar(monthIdx) {
  kill('classBar');
  const st = basinStats(monthIdx);
  charts.classBar = new Chart(document.getElementById('cClassBar'), {
    type: 'bar',
    data: {
      labels: ['Stesen'],
      datasets: WQI_CLASSES.map((c) => ({
        label: `${c.label} — ${c.status}`, data: [st.dist[c.id]],
        backgroundColor: c.color, borderColor: '#fff', borderWidth: 2,
        borderRadius: 4, barThickness: 46,
      })),
    },
    options: baseOpts({
      indexAxis: 'y',
      plugins: {
        ...baseOpts().plugins,
        tooltip: { ...baseOpts().plugins.tooltip,
          callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.x} stesen` } },
      },
      scales: {
        x: { stacked: true, grid: { color: INK.grid }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: INK.muted, stepSize: 2 },
          title: { display: true, text: 'Bilangan stesen', font: { size: 10.5 }, color: INK.muted } },
        y: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { display: false } },
      },
    }),
  });
}

/* ---- 4. Sub-indeks purata lembangan ---- */
function drawSubIndex(monthIdx) {
  kill('subIdx');
  const keys = Object.keys(PARAM_META);
  const avg = keys.map((k) => {
    const v = DATA.stations.reduce((t, s) => t + readingAt(s, monthIdx).si[k], 0) / DATA.stations.length;
    return Math.round(v * 10) / 10;
  });
  const col = (v) => (v >= 76.5 ? '#17a04a' : v >= 51.9 ? '#f2c40c' : v >= 31 ? '#ef7d1a' : '#d92d20');
  charts.subIdx = new Chart(document.getElementById('cSubIdx'), {
    type: 'bar',
    data: {
      labels: keys.map((k) => PARAM_META[k].name.replace(/ \(.*\)/, '')),
      datasets: [{
        data: avg, backgroundColor: avg.map(col), borderRadius: 4,
        borderSkipped: false, barThickness: 17, borderWidth: 2, borderColor: '#fff',
      }],
    },
    options: baseOpts({
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { ...baseOpts().plugins.tooltip,
          callbacks: { label: (c) => ` Sub-indeks purata: ${c.parsed.x.toFixed(1)} / 100` } },
      },
      scales: {
        x: { min: 0, max: 100, grid: { color: INK.grid }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: INK.muted },
          title: { display: true, text: 'Nilai sub-indeks (0–100)', font: { size: 10.5 }, color: INK.muted } },
        y: { grid: { display: false }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: INK.secondary } },
      },
    }),
  });
}

/* ---- 5. Jadual stesen ---- */
function drawStationTable(monthIdx) {
  const rows = DATA.stations.map((s) => {
    const r = readingAt(s, monthIdx);
    const c = wqiClass(r.wqi);
    return `<tr class="clickable" data-code="${s.code}">
      <td><b>${s.code}</b></td>
      <td>${s.name}</td>
      <td>${s.river}</td>
      <td>${s.district}</td>
      <td class="num">${r.raw.do.toFixed(2)}</td>
      <td class="num">${r.raw.bod.toFixed(2)}</td>
      <td class="num">${r.raw.cod.toFixed(1)}</td>
      <td class="num">${r.raw.ss.toFixed(1)}</td>
      <td class="num">${r.raw.an.toFixed(3)}</td>
      <td class="num">${r.raw.ph.toFixed(2)}</td>
      <td class="num" style="font-weight:700;color:${c.color}">${r.wqi.toFixed(1)}</td>
      <td><span class="badge" style="background:${c.color}">${c.id}</span>
          <span style="font-size:11px;margin-left:4px;color:var(--muted)">${c.status}</span></td>
    </tr>`;
  }).join('');
  document.getElementById('stationTable').innerHTML = rows;
  document.querySelectorAll('#stationTable tr').forEach((tr) => {
    tr.onclick = () => document.dispatchEvent(
      new CustomEvent('gotostation', { detail: tr.dataset.code }));
  });
}

/* ============================================================
   Trend lembangan kebangsaan (data.gov.my)
   ============================================================ */
export function renderNational(measure = 'bod5') {
  kill('nat');
  const { years, byYear } = basinTrend();
  const S = [
    { k: 'clean', lab: 'Bersih', color: '#17a04a' },
    { k: 'slightly__polluted', lab: 'Sederhana tercemar', color: '#f2c40c' },
    { k: 'polluted', lab: 'Tercemar', color: '#d92d20' },
  ];
  charts.nat = new Chart(document.getElementById('cNational'), {
    type: 'line',
    data: {
      labels: years,
      datasets: S.map((s) => ({
        label: s.lab, data: years.map((y) => byYear[y][measure]?.[s.k] ?? null),
        borderColor: s.color, backgroundColor: s.color + '2e',
        borderWidth: 2, fill: true, tension: 0.28, pointRadius: 0, pointHoverRadius: 4.5,
        pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
      })),
    },
    options: baseOpts({
      plugins: {
        ...baseOpts().plugins,
        tooltip: { ...baseOpts().plugins.tooltip,
          callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y?.toFixed(1)}% lembangan` } },
      },
      scales: {
        ...baseOpts().scales,
        y: { ...baseOpts().scales.y, stacked: true, min: 0, max: 100,
          ticks: { ...baseOpts().scales.y.ticks, callback: (v) => v + '%' },
          title: { display: true, text: '% lembangan sungai dipantau', font: { size: 10.5 }, color: INK.muted } },
      },
    }),
  });
  const last = years[years.length - 1];
  document.getElementById('natNote').innerHTML =
    `Sumber: <b>data.gov.my</b> · katalog <code>water_pollution_basin</code> · ` +
    `${years[0]}–${last} · ${byYear[last].monitored} lembangan dipantau (${last}).`;
}

/* ============================================================
   Punca pencemaran
   ============================================================ */
export function renderSources(maxDist = 1500) {
  const src = sourceStats(maxDist);
  const entries = Object.entries(src).sort((a, b) => b[1].n - a[1].n);
  const total = entries.reduce((t, [, c]) => t + c.n, 0);

  document.getElementById('srcCards').innerHTML = entries.map(([k, c]) => `
    <div class="src-card" style="--sc:${c.color}">
      <div class="sc-ic" style="background:${c.color}1f">${c.icon}</div>
      <div class="sc-n">${c.label}</div>
      <div class="sc-v" style="color:${c.color}">${nf(c.n)}</div>
      <div class="sc-d">${((c.n / total) * 100).toFixed(1)}% daripada semua punca ·
        <b>${nf(c.near)}</b> dalam 250 m</div>
      <div class="sc-d" style="margin-top:6px;padding-top:6px;border-top:1px solid var(--line)">
        ${c.pol}</div>
    </div>`).join('');

  kill('srcBar');
  charts.srcBar = new Chart(document.getElementById('cSrcBar'), {
    type: 'bar',
    data: {
      labels: entries.map(([, c]) => c.label),
      datasets: [
        { label: 'Sangat hampir (≤ 250 m)', data: entries.map(([, c]) => c.near),
          backgroundColor: entries.map(([, c]) => c.color), borderRadius: 4,
          borderSkipped: false, borderWidth: 2, borderColor: '#fff', stack: 's' },
        { label: 'Zon riparian (250 m – 1.5 km)', data: entries.map(([, c]) => c.n - c.near),
          backgroundColor: entries.map(([, c]) => c.color + '4d'), borderRadius: 4,
          borderSkipped: false, borderWidth: 2, borderColor: '#fff', stack: 's' },
      ],
    },
    options: baseOpts({
      indexAxis: 'y',
      plugins: {
        ...baseOpts().plugins,
        legend: { ...baseOpts().plugins.legend,
          labels: { ...baseOpts().plugins.legend.labels,
            generateLabels: () => [
              { text: 'Sangat hampir (≤ 250 m)', fillStyle: '#5f6880', strokeStyle: '#5f6880', pointStyle: 'rectRounded' },
              { text: 'Zon riparian (250 m – 1.5 km)', fillStyle: '#c3c8d6', strokeStyle: '#c3c8d6', pointStyle: 'rectRounded' },
            ] } },
        tooltip: { ...baseOpts().plugins.tooltip,
          callbacks: { label: (c) => ` ${c.dataset.label}: ${nf(c.parsed.x)} lokasi` } },
      },
      scales: {
        x: { stacked: true, grid: { color: INK.grid }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: INK.muted },
          title: { display: true, text: 'Bilangan lokasi (OpenStreetMap)', font: { size: 10.5 }, color: INK.muted } },
        y: { stacked: true, grid: { display: false }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: INK.secondary } },
      },
    }),
  });

  /* Taburan jarak ke alur air */
  kill('srcDist');
  const W = 150, N = 10;                    // sepuluh jalur sama lebar 150 m
  const counts = new Array(N).fill(0);
  for (const f of DATA.sources.features) {
    const i = Math.min(N - 1, Math.floor(f.properties.dist / W));
    counts[i]++;
  }
  const bins = Array.from({ length: N }, (_, i) => (i + 1) * W);
  charts.srcDist = new Chart(document.getElementById('cSrcDist'), {
    type: 'bar',
    data: {
      labels: bins.map((b, i) => `${i * W}–${b}`),
      datasets: [{
        label: 'Lokasi', data: counts, backgroundColor: '#2a78d6',
        borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 40,
        borderWidth: 2, borderColor: '#fff',
      }],
    },
    options: baseOpts({
      plugins: {
        legend: { display: false },
        tooltip: { ...baseOpts().plugins.tooltip,
          callbacks: { label: (c) => ` ${nf(c.parsed.y)} lokasi dalam jalur ${c.label} m` } },
      },
      scales: {
        x: { ...baseOpts().scales.x,
          ticks: { ...baseOpts().scales.x.ticks, autoSkip: false, maxRotation: 38, minRotation: 38, font: { size: 9.5 } },
          title: { display: true, text: 'Jarak ke alur air terdekat (meter)', font: { size: 10.5 }, color: INK.muted } },
        y: { ...baseOpts().scales.y,
          title: { display: true, text: 'Bilangan lokasi', font: { size: 10.5 }, color: INK.muted } },
      },
    }),
  });

  /* Jadual punca berisiko tinggi */
  const top = DATA.sources.features
    .filter((f) => f.properties.dist <= maxDist)
    .slice(0, 120);
  document.getElementById('srcTable').innerHTML = top.map((f) => {
    const p = f.properties, c = DATA.srcCats[p.cat];
    const rc = p.risk >= 4 ? '#d92d20' : p.risk >= 3 ? '#ef7d1a' : p.risk >= 2 ? '#f2c40c' : '#17a04a';
    return `<tr>
      <td><span class="badge" style="background:${c.color}">${c.icon}</span>
          <span style="margin-left:6px">${c.label}</span></td>
      <td>${p.name ? p.name.replace(/[<>&]/g, '') : '<span style="color:var(--muted-2)">(tanpa nama)</span>'}</td>
      <td style="font-size:11.5px;color:var(--muted)">${p.district ?? '—'}</td>
      <td class="num">${p.dist}</td>
      <td class="num">${p.dist_langat != null ? nf(p.dist_langat) : '—'}</td>
      <td class="num" style="color:${rc};font-weight:700">${p.risk.toFixed(2)}</td>
      <td style="font-size:11.5px;color:var(--muted)">${c.pol}</td>
    </tr>`;
  }).join('');
  document.getElementById('srcTableNote').textContent =
    `Memaparkan 120 lokasi berisiko tertinggi daripada ${nf(DATA.sources.features.filter((f) => f.properties.dist <= maxDist).length)} dalam julat ${maxDist} m.`;
}

export function resizeCharts() {
  Object.values(charts).forEach((c) => c.resize());
}
