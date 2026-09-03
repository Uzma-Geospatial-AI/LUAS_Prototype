/* ============================================================
   phase2.js — Phase 2: Quality monitoring and pollution

   How the reach behaves over time: parameter trends against the target
   standard, how often each one puts the river out of class, and where
   Dengkil sits against the rest of the basin and the national picture.
   ============================================================ */
import { DATA, readingAt, latestIdx, fmtMonth, complianceRecord, basinTrend,
         waterSummary, WATER_GROUPS } from './data.js';
import { PARAM_META, INWQS, wqiClass, checkStandard, paramStatus } from './wqi.js';
import { store } from './store.js';
import { initSatellite, resizeSatellite } from './satellite.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const charts = {};
const kill = (k) => { charts[k]?.destroy(); delete charts[k]; };

const INK = { secondary: '#5f6880', muted: '#8b93a8', grid: '#eaedf3', axis: '#cfd5e3' };

const baseOpts = (over = {}) => ({
  responsive: true, maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { position: 'bottom', align: 'start',
      labels: { boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'rectRounded',
        font: { size: 11 }, color: INK.secondary, padding: 12 } },
    tooltip: { backgroundColor: 'rgba(22,23,63,.96)', padding: 10, cornerRadius: 8,
      titleFont: { size: 11.5, weight: '600' }, bodyFont: { size: 11.5 },
      boxWidth: 8, boxHeight: 8, usePointStyle: true },
  },
  scales: {
    x: { grid: { display: false }, border: { color: INK.axis },
      ticks: { font: { size: 10 }, color: INK.muted, maxRotation: 0, autoSkipPadding: 16 } },
    y: { grid: { color: INK.grid }, border: { display: false },
      ticks: { font: { size: 10 }, color: INK.muted } },
  },
  ...over,
});

export function renderPhase2() {
  const s = DATA.focus;
  const target = store.conditions().targetClass;
  const rec = complianceRecord(s, target);

  renderExceedance(s, target, rec);
  renderWaterBodies();
  initSatellite();
  renderParamCharts(s, target);
  renderMonthTable(s, target, rec);
  renderStationTable(target);
  renderNational($('p2Measure')?.value ?? 'bod5');
}

/* ---------------- Exceedance summary ---------------- */
function renderExceedance(s, target, rec) {
  const rows = Object.entries(PARAM_META).map(([p, m]) => {
    const v = rec.byParam[p];
    const cur = readingAt(s, latestIdx()).raw[p];
    const chk = checkStandard(p, cur, target);
    return { p, m, ...v, cur, chk };
  }).sort((a, b) => b.rate - a.rate);

  $('p2Cards').innerHTML = rows.map(({ p, m, fails, rate, cur, chk }) => {
    const col = rate >= 0.5 ? '#d92d20' : rate > 0.1 ? '#ef7d1a' : rate > 0 ? '#f2c40c' : '#17a04a';
    return `<div class="card exc-card" style="--ec:${col}">
      <div class="exc-h">${m.short}<span>${m.unit || ''}</span></div>
      <div class="exc-v" style="color:${col}">${(rate * 100).toFixed(0)}<span>%</span></div>
      <div class="exc-s">of months exceed Class ${target}</div>
      <div class="exc-bar"><i style="width:${rate * 100}%;background:${col}"></i></div>
      <div class="exc-f">
        <span>Latest ${p === 'an' ? cur.toFixed(3) : cur.toFixed(2)}</span>
        <b style="color:${chk.pass === false ? '#d92d20' : '#17a04a'}">${chk.limitText}</b>
      </div>
    </div>`;
  }).join('');
}

/* ---------------- Receiving water bodies (Digital Earth) ---------------- */
function renderWaterBodies() {
  const w = waterSummary();
  const km2 = (m2) => (m2 / 1e6).toFixed(2);
  const order = ['treatment', 'storage', 'pond', 'wetland', 'channel', 'other']
    .filter((k) => w.groups[k].n);

  $('p2Water').innerHTML = order.map((k) => {
    const g = w.groups[k];
    const meta = WATER_GROUPS[k];
    return `<div class="card wb-card" style="--wc:${meta.color}">
      <div class="wb-n">${meta.label}</div>
      <div class="wb-v">${g.n}</div>
      <div class="wb-a">${km2(g.area)} km² &middot; ${((g.area / w.total) * 100).toFixed(0)}% of surface</div>
      <div class="wb-d">${meta.note}</div>
    </div>`;
  }).join('');

  $('p2WaterNote').textContent =
    `${w.count} water bodies within ${w.radiusKm} km of the station \u00b7 `
    + `${km2(w.total)} km\u00b2 total open water surface`;

  $('p2WaterTable').innerHTML = w.largest.map((b) => `
    <tr>
      <td>${b.name ? esc(b.name) : '<span class="sub">unnamed</span>'}</td>
      <td><span class="badge soft">${esc(b.kind)}</span></td>
      <td>${esc(WATER_GROUPS[b.group]?.label ?? b.group)}</td>
      <td class="num">${(b.area_m2 / 1e4).toFixed(1)}</td>
      <td class="num">${b.km.toFixed(1)}</td>
    </tr>`).join('');

  kill('water');
  charts.water = new Chart($('p2WaterChart'), {
    type: 'bar',
    data: {
      labels: order.map((k) => WATER_GROUPS[k].label),
      datasets: [{
        label: 'Surface area',
        data: order.map((k) => w.groups[k].area / 1e6),
        backgroundColor: order.map((k) => WATER_GROUPS[k].color),
        borderRadius: 4, borderSkipped: false, borderWidth: 2, borderColor: '#fff',
        barThickness: 22,
      }],
    },
    options: baseOpts({
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { ...baseOpts().plugins.tooltip,
          callbacks: { label: (c) => ` ${c.parsed.x.toFixed(2)} km² of open water` } },
      },
      scales: {
        x: { grid: { color: INK.grid }, border: { display: false },
          ticks: { font: { size: 10 }, color: INK.muted },
          title: { display: true, text: 'Surface area (km²)', font: { size: 10 }, color: INK.muted } },
        y: { grid: { display: false }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: INK.secondary } },
      },
    }),
  });
}

/* ---------------- One small chart per parameter ---------------- */
function renderParamCharts(s, target) {
  const box = $('p2Charts');
  if (!box.dataset.built) {
    box.innerHTML = Object.entries(PARAM_META).map(([p, m]) => `
      <div class="card pad0">
        <div class="card-head">
          <h3>${m.name}</h3>
          <div class="card-sub">${m.unit ? `${m.unit} · ` : ''}Class ${target} standard shown as a dashed line</div>
        </div>
        <div class="chart-box sm"><canvas id="pc_${p}"></canvas></div>
      </div>`).join('');
    box.dataset.built = '1';
  }

  for (const [p, m] of Object.entries(PARAM_META)) {
    kill(`pc_${p}`);
    const vals = s.wqiSeries.map((r) => r.raw[p]);
    const std = INWQS[target][p];
    const limit = Array.isArray(std) ? std[0] : std;
    const colours = vals.map((v) => {
      const st = paramStatus(p, v);
      return st === 'clean' ? '#17a04a' : st === 'slight' ? '#f2c40c' : '#d92d20';
    });

    const datasets = [{
      label: m.short, data: vals,
      borderColor: '#2d2f7a', borderWidth: 1.8, tension: 0.28,
      pointRadius: 2.2, pointBackgroundColor: colours, pointBorderWidth: 0,
      fill: false,
    }];
    if (limit != null) {
      datasets.push({
        label: `Class ${target} limit`, data: vals.map(() => limit),
        borderColor: '#17a04a', borderWidth: 1.6, borderDash: [6, 4],
        pointRadius: 0, fill: false,
      });
    }
    if (p === 'ph' && Array.isArray(std)) {
      datasets.push({
        label: 'Upper limit', data: vals.map(() => std[1]),
        borderColor: '#17a04a', borderWidth: 1.6, borderDash: [6, 4],
        pointRadius: 0, fill: false,
      });
    }

    charts[`pc_${p}`] = new Chart($(`pc_${p}`), {
      type: 'line',
      data: { labels: DATA.months.map(fmtMonth), datasets },
      options: baseOpts({
        plugins: {
          legend: { display: false },
          tooltip: { ...baseOpts().plugins.tooltip,
            callbacks: { label: (c) => (c.datasetIndex === 0
              ? ` ${m.short} ${c.parsed.y} ${m.unit}`
              : ` Class ${target} limit ${c.parsed.y} ${m.unit}`) } },
        },
        scales: {
          ...baseOpts().scales,
          y: { ...baseOpts().scales.y, beginAtZero: p !== 'ph' && p !== 'do',
            title: { display: true, text: m.unit || 'pH', font: { size: 10 }, color: INK.muted } },
        },
      }),
    });
  }
}

/* ---------------- Month-by-month record ---------------- */
function renderMonthTable(s, target, rec) {
  const rows = [...rec.months].reverse();
  $('p2Months').innerHTML = rows.map((mo, i) => {
    const r = s.wqiSeries[rec.months.length - 1 - i];
    const c = wqiClass(mo.wqi);
    const fails = Object.entries(mo.compliance.checks)
      .filter(([, x]) => x.pass === false).map(([p]) => PARAM_META[p].short);
    return `<tr>
      <td><b>${fmtMonth(mo.t)}</b></td>
      <td class="num">${r.raw.do.toFixed(2)}</td>
      <td class="num">${r.raw.bod.toFixed(2)}</td>
      <td class="num">${r.raw.cod.toFixed(1)}</td>
      <td class="num">${r.raw.ss.toFixed(1)}</td>
      <td class="num">${r.raw.an.toFixed(3)}</td>
      <td class="num">${r.raw.ph.toFixed(2)}</td>
      <td class="num" style="font-weight:700;color:${c.color}">${mo.wqi.toFixed(1)}</td>
      <td><span class="badge" style="background:${c.color}">${c.id}</span></td>
      <td>${fails.length
        ? `<span class="pill-status st-fail">${fails.join(', ')}</span>`
        : `<span class="pill-status st-pass">Meets Class ${target}</span>`}</td>
    </tr>`;
  }).join('');
  $('p2MonthNote').textContent =
    `${rec.total} monthly records · ${rec.passing} meet Class ${target}, ${rec.total - rec.passing} do not`;
}

/* ---------------- Basin stations ---------------- */
function renderStationTable(target) {
  const i = latestIdx();
  const rows = DATA.stations.map((s) => {
    const r = readingAt(s, i);
    const c = wqiClass(r.wqi);
    const rec = complianceRecord(s, target);
    return { s, r, c, rec };
  }).sort((a, b) => a.r.wqi - b.r.wqi);

  $('p2Stations').innerHTML = rows.map(({ s, r, c, rec }) => `
    <tr class="${s.code === DATA.focus.code ? 'row-focus' : ''}">
      <td><b>${s.code}</b>${s.code === DATA.focus.code
        ? '<span class="tag-focus">Phase 1 station</span>' : ''}</td>
      <td>${esc(s.name)}</td>
      <td>${esc(s.river)}</td>
      <td>${esc(s.district)}</td>
      <td class="num" style="font-weight:700;color:${c.color}">${r.wqi.toFixed(1)}</td>
      <td><span class="badge" style="background:${c.color}">${c.id}</span>
        <span class="sub-inline">${c.status}</span></td>
      <td class="num">${(rec.rate * 100).toFixed(0)}%</td>
      <td class="num ${s.delta >= 0 ? 'up' : 'down'}">${s.delta >= 0 ? '▲' : '▼'} ${Math.abs(s.delta).toFixed(1)}</td>
    </tr>`).join('');
}

/* ---------------- National context ---------------- */
export function renderNational(measure = 'bod5') {
  kill('nat');
  const { years, byYear } = basinTrend();
  const S = [
    { k: 'clean', lab: 'Clean', color: '#17a04a' },
    { k: 'slightly__polluted', lab: 'Slightly polluted', color: '#f2c40c' },
    { k: 'polluted', lab: 'Polluted', color: '#d92d20' },
  ];
  charts.nat = new Chart($('p2National'), {
    type: 'line',
    data: {
      labels: years,
      datasets: S.map((s) => ({
        label: s.lab, data: years.map((y) => byYear[y][measure]?.[s.k] ?? null),
        borderColor: s.color, backgroundColor: `${s.color}2e`,
        borderWidth: 2, fill: true, tension: 0.28, pointRadius: 0, pointHoverRadius: 4,
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
          title: { display: true, text: '% of monitored river basins', font: { size: 10 }, color: INK.muted } },
      },
    }),
  });
  const last = years[years.length - 1];
  $('p2NatNote').innerHTML =
    `Source: <b>data.gov.my</b> · <code>water_pollution_basin</code> · ${years[0]}–${last} · `
    + `${byYear[last].monitored} basins monitored in ${last}.`;
}

export function resizePhase2() {
  Object.values(charts).forEach((c) => c.resize());
  resizeSatellite();
}
