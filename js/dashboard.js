/* ============================================================
   dashboard.js — Dashboard, charts and tables
   ============================================================ */
import { DATA, readingAt, basinStats, basinTrend, sourceStats } from './data.js';
import { WQI_CLASSES, wqiClass, wqiColor, PARAM_META, siColor } from './wqi.js';
import { sourceSwatch } from './symbols.js';

const INK = { secondary: '#5f6880', muted: '#8b93a8', grid: '#eaedf3', axis: '#cfd5e3' };
const charts = {};
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (m) => `${MONTHS_EN[+m.split('-')[1] - 1]} ${m.split('-')[0]}`;
const nf = (n, d = 0) => n.toLocaleString('en-MY', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Shared Chart.js options */
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
   Dashboard
   ============================================================ */
export function renderDashboard(monthIdx) {
  const st = basinStats(monthIdx);
  const src = sourceStats(1500);
  const near250 = Object.values(src).reduce((t, c) => t + c.near, 0);
  const total = Object.values(src).reduce((t, c) => t + c.n, 0);
  const worst = [...DATA.stations].sort(
    (a, b) => readingAt(a, monthIdx).wqi - readingAt(b, monthIdx).wqi)[0];
  const meanDelta = DATA.stations.reduce((t, s) => t + s.delta, 0) / DATA.stations.length;

  document.getElementById('kpis').innerHTML = [
    { lab: 'Basin mean WQI', val: st.mean.toFixed(1), color: st.cls.color,
      sub: `${st.cls.label} — ${st.cls.status}`,
      trend: meanDelta, trendLab: 'vs the preceding 12 months' },
    { lab: 'Polluted stations (Class IV–V)', val: `${st.polluted}`,
      color: st.polluted ? '#d92d20' : '#17a04a',
      sub: `of ${st.n} stations monitored` },
    { lab: 'Most critical station', val: readingAt(worst, monthIdx).wqi.toFixed(1),
      color: wqiColor(readingAt(worst, monthIdx).wqi), sub: `${worst.code} · ${worst.name}` },
    { lab: 'Sources within 250 m of water', val: nf(near250), color: '#22235f',
      sub: `of ${nf(total)} in the 1.5 km riparian zone` },
  ].map((k) => `
    <div class="card kpi">
      <div class="k-lab">${k.lab}</div>
      <div class="k-val" style="color:${k.color}">${k.val}</div>
      <div class="k-sub">${esc(k.sub)}</div>
      ${k.trend !== undefined ? `<div class="k-trend ${k.trend > 0.5 ? 'trend-up' : k.trend < -0.5 ? 'trend-down' : 'trend-flat'}">
        ${k.trend >= 0 ? '▲' : '▼'} ${Math.abs(k.trend).toFixed(1)} points · ${k.trendLab}</div>` : ''}
    </div>`).join('');

  drawSegmentTrend();
  drawProfile(monthIdx);
  drawClassBar(monthIdx);
  drawSubIndex(monthIdx);
  drawStationTable(monthIdx);
}

/* ---- 1. WQI trend by river reach (4 series) ---- */
function drawSegmentTrend() {
  kill('segTrend');
  const SEGS = [
    { key: 'hulu',   label: 'Headwaters (Hulu Langat)',      color: '#2a78d6' },
    { key: 'tengah', label: 'Middle (Kajang–Dengkil)',       color: '#eda100' },
    { key: 'hilir',  label: 'Lower (Banting–T.P. Garang)',   color: '#eb6834' },
    { key: 'muara',  label: 'Estuary (Kuala Langat)',        color: '#008300' },
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
      },
      scales: {
        ...baseOpts().scales,
        y: { ...baseOpts().scales.y, min: 20, max: 100,
          title: { display: true, text: 'Water Quality Index (WQI)', font: { size: 10.5 }, color: INK.muted } },
      },
    }),
  });
}

/* ---- 2. Headwaters → estuary profile ---- */
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
            title: (c) => `${main[c[0].dataIndex].code} · ${main[c[0].dataIndex].name}`,
            label: (c) => ` WQI ${c.parsed.y.toFixed(1)} — ${wqiClass(c.parsed.y).label} (${wqiClass(c.parsed.y).status})`,
          } },
      },
      scales: {
        x: { ...baseOpts().scales.x,
          ticks: { ...baseOpts().scales.x.ticks, maxRotation: 42, minRotation: 42, font: { size: 9.5 } } },
        y: { ...baseOpts().scales.y, min: 0, max: 100,
          title: { display: true, text: 'WQI (headwaters → estuary)', font: { size: 10.5 }, color: INK.muted } },
      },
    }),
  });
}

/* ---- 3. Class distribution (stacked horizontal bar) ---- */
function drawClassBar(monthIdx) {
  kill('classBar');
  const st = basinStats(monthIdx);
  charts.classBar = new Chart(document.getElementById('cClassBar'), {
    type: 'bar',
    data: {
      labels: ['Stations'],
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
          callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.x} station${c.parsed.x === 1 ? '' : 's'}` } },
      },
      scales: {
        x: { stacked: true, grid: { color: INK.grid }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: INK.muted, stepSize: 2 },
          title: { display: true, text: 'Number of stations', font: { size: 10.5 }, color: INK.muted } },
        y: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { display: false } },
      },
    }),
  });
}

/* ---- 4. Basin mean sub-indices ---- */
function drawSubIndex(monthIdx) {
  kill('subIdx');
  const keys = Object.keys(PARAM_META);
  const avg = keys.map((k) => {
    const v = DATA.stations.reduce((t, s) => t + readingAt(s, monthIdx).si[k], 0) / DATA.stations.length;
    return Math.round(v * 10) / 10;
  });
  charts.subIdx = new Chart(document.getElementById('cSubIdx'), {
    type: 'bar',
    data: {
      labels: keys.map((k) => PARAM_META[k].name.replace(/ \(.*\)/, '')),
      datasets: [{
        data: avg, backgroundColor: avg.map(siColor), borderRadius: 4,
        borderSkipped: false, barThickness: 17, borderWidth: 2, borderColor: '#fff',
      }],
    },
    options: baseOpts({
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { ...baseOpts().plugins.tooltip,
          callbacks: { label: (c) => ` Mean sub-index: ${c.parsed.x.toFixed(1)} / 100` } },
      },
      scales: {
        x: { min: 0, max: 100, grid: { color: INK.grid }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: INK.muted },
          title: { display: true, text: 'Sub-index value (0–100)', font: { size: 10.5 }, color: INK.muted } },
        y: { grid: { display: false }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: INK.secondary } },
      },
    }),
  });
}

/* ---- 5. Station table ---- */
function drawStationTable(monthIdx) {
  document.getElementById('stationTable').innerHTML = DATA.stations.map((s) => {
    const r = readingAt(s, monthIdx);
    const c = wqiClass(r.wqi);
    return `<tr class="clickable" data-code="${s.code}">
      <td><b>${s.code}</b></td>
      <td>${esc(s.name)}</td>
      <td>${esc(s.river)}</td>
      <td>${esc(s.district)}</td>
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
  document.querySelectorAll('#stationTable tr').forEach((tr) => {
    tr.onclick = () => document.dispatchEvent(
      new CustomEvent('gotostation', { detail: tr.dataset.code }));
  });
}

/* ============================================================
   National basin trend (data.gov.my)
   ============================================================ */
export function renderNational(measure = 'bod5') {
  kill('nat');
  const { years, byYear } = basinTrend();
  const S = [
    { k: 'clean', lab: 'Clean', color: '#17a04a' },
    { k: 'slightly__polluted', lab: 'Slightly polluted', color: '#f2c40c' },
    { k: 'polluted', lab: 'Polluted', color: '#d92d20' },
  ];
  charts.nat = new Chart(document.getElementById('cNational'), {
    type: 'line',
    data: {
      labels: years,
      datasets: S.map((s) => ({
        label: s.lab, data: years.map((y) => byYear[y][measure]?.[s.k] ?? null),
        borderColor: s.color, backgroundColor: `${s.color}2e`,
        borderWidth: 2, fill: true, tension: 0.28, pointRadius: 0, pointHoverRadius: 4.5,
        pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
      })),
    },
    options: baseOpts({
      plugins: {
        ...baseOpts().plugins,
        tooltip: { ...baseOpts().plugins.tooltip,
          callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y?.toFixed(1)}% of basins` } },
      },
      scales: {
        ...baseOpts().scales,
        y: { ...baseOpts().scales.y, stacked: true, min: 0, max: 100,
          ticks: { ...baseOpts().scales.y.ticks, callback: (v) => `${v}%` },
          title: { display: true, text: '% of monitored river basins', font: { size: 10.5 }, color: INK.muted } },
      },
    }),
  });
  const last = years[years.length - 1];
  document.getElementById('natNote').innerHTML =
    `Source: <b>data.gov.my</b> · catalogue <code>water_pollution_basin</code> · ` +
    `${years[0]}–${last} · ${byYear[last].monitored} basins monitored in ${last}.`;
}

/* ============================================================
   Pollution sources
   ============================================================ */
export function renderSources(maxDist = 1500) {
  const src = sourceStats(maxDist);
  const entries = Object.entries(src).sort((a, b) => b[1].n - a[1].n);
  const total = entries.reduce((t, [, c]) => t + c.n, 0);

  document.getElementById('srcCards').innerHTML = entries.map(([k, c]) => `
    <div class="src-card" style="--sc:${c.color}">
      <div class="sc-ic" style="background:${c.color}1f">${sourceSwatch(k, c.color, 19)}</div>
      <div class="sc-n">${esc(c.label)}</div>
      <div class="sc-v" style="color:${c.color}">${nf(c.n)}</div>
      <div class="sc-d">${((c.n / total) * 100).toFixed(1)}% of all sources ·
        <b>${nf(c.near)}</b> within 250 m</div>
      <div class="sc-d" style="margin-top:6px;padding-top:6px;border-top:1px solid var(--line)">
        ${esc(c.pol)}</div>
    </div>`).join('');

  kill('srcBar');
  charts.srcBar = new Chart(document.getElementById('cSrcBar'), {
    type: 'bar',
    data: {
      labels: entries.map(([, c]) => c.label),
      datasets: [
        { label: 'Within 250 m', data: entries.map(([, c]) => c.near),
          backgroundColor: entries.map(([, c]) => c.color), borderRadius: 4,
          borderSkipped: false, borderWidth: 2, borderColor: '#fff', stack: 's' },
        { label: 'Riparian zone (250 m – 1.5 km)', data: entries.map(([, c]) => c.n - c.near),
          backgroundColor: entries.map(([, c]) => `${c.color}4d`), borderRadius: 4,
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
              { text: 'Within 250 m of a watercourse', fillStyle: '#5f6880', strokeStyle: '#5f6880', pointStyle: 'rectRounded' },
              { text: 'Riparian zone (250 m – 1.5 km)', fillStyle: '#c3c8d6', strokeStyle: '#c3c8d6', pointStyle: 'rectRounded' },
            ] } },
        tooltip: { ...baseOpts().plugins.tooltip,
          callbacks: { label: (c) => ` ${c.dataset.label}: ${nf(c.parsed.x)} locations` } },
      },
      scales: {
        x: { stacked: true, grid: { color: INK.grid }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: INK.muted },
          title: { display: true, text: 'Number of locations (OpenStreetMap)', font: { size: 10.5 }, color: INK.muted } },
        y: { stacked: true, grid: { display: false }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: INK.secondary } },
      },
    }),
  });

  /* Distance histogram — ten equal 150 m bands */
  kill('srcDist');
  const W = 150, N = 10;
  const counts = new Array(N).fill(0);
  for (const f of DATA.sources.features) {
    counts[Math.min(N - 1, Math.floor(f.properties.dist / W))]++;
  }
  charts.srcDist = new Chart(document.getElementById('cSrcDist'), {
    type: 'bar',
    data: {
      labels: Array.from({ length: N }, (_, i) => `${i * W}–${(i + 1) * W}`),
      datasets: [{
        label: 'Locations', data: counts, backgroundColor: '#2a78d6',
        borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 40,
        borderWidth: 2, borderColor: '#fff',
      }],
    },
    options: baseOpts({
      plugins: {
        legend: { display: false },
        tooltip: { ...baseOpts().plugins.tooltip,
          callbacks: { label: (c) => ` ${nf(c.parsed.y)} locations in the ${c.label} m band` } },
      },
      scales: {
        x: { ...baseOpts().scales.x,
          ticks: { ...baseOpts().scales.x.ticks, autoSkip: false, maxRotation: 38, minRotation: 38, font: { size: 9.5 } },
          title: { display: true, text: 'Distance to nearest watercourse (metres)', font: { size: 10.5 }, color: INK.muted } },
        y: { ...baseOpts().scales.y,
          title: { display: true, text: 'Number of locations', font: { size: 10.5 }, color: INK.muted } },
      },
    }),
  });

  /* Highest-risk locations table */
  const inRange = DATA.sources.features.filter((f) => f.properties.dist <= maxDist);
  document.getElementById('srcTable').innerHTML = inRange.slice(0, 120).map((f) => {
    const p = f.properties, c = DATA.srcCats[p.cat];
    const rc = p.risk >= 4 ? '#d92d20' : p.risk >= 3 ? '#ef7d1a' : p.risk >= 2 ? '#f2c40c' : '#17a04a';
    return `<tr>
      <td style="display:flex;align-items:center;gap:7px">
          ${sourceSwatch(p.cat, c.color, 16)}<span>${esc(c.label)}</span></td>
      <td>${p.name ? esc(p.name) : '<span style="color:var(--muted-2)">(unnamed)</span>'}</td>
      <td style="font-size:11.5px;color:var(--muted)">${esc(p.district ?? '—')}</td>
      <td class="num">${p.dist}</td>
      <td class="num">${p.dist_langat != null ? nf(p.dist_langat) : '—'}</td>
      <td class="num" style="color:${rc};font-weight:700">${p.risk.toFixed(2)}</td>
      <td style="font-size:11.5px;color:var(--muted)">${esc(c.pol)}</td>
    </tr>`;
  }).join('');
  document.getElementById('srcTableNote').textContent =
    `Showing the 120 highest-risk locations out of ${nf(inRange.length)} within ${maxDist} m.`;
}

export function resizeCharts() {
  Object.values(charts).forEach((c) => c.resize());
}
