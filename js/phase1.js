/* ============================================================
   phase1.js — Phase 1: Station assessment

   Six parameters in, WQI out, and the verdict that matters operationally:
   does this reach hold its target class? Written for whichever station is
   picked in the app bar. A station added there has no official record, so
   until a reading is saved for it from the calculator the page says so
   rather than showing a number it does not have.
   ============================================================ */
import { DATA, readingAt, readingIn, latestIdx, fmtMonth, complianceRecord } from './data.js';
import {
  computeWQI, wqiClass, PARAM_META, checkStandard, classCompliance,
  siColor, WEIGHTS, INWQS,
} from './wqi.js';
import { store } from './store.js';
import { kindLabel } from './locations.js';
import { mountAttach, attachGallery, wireGallery, saveWarning } from './attach.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => (v === '' || v == null ? NaN : Number(v));

let monthIdx = null, chart = null, calcInit = false;
/* The photographs the calculator is holding, until the reading is saved */
let att = null;

export function renderPhase1() {
  monthIdx ??= latestIdx();
  monthIdx = Math.min(monthIdx, latestIdx());
  const s = DATA.focus;
  const target = store.conditions().targetClass;

  /* The page names whichever station is selected, not a fixed one */
  const head = document.getElementById('p1Head2');
  if (head) {
    head.textContent = `${s.river} at ${s.name} · six parameters → WQI `
      + `→ does it hold Class ${target}?`;
  }

  renderHeader(s, target);
  renderPhotos(s);
  renderVerdict(s, target);
  renderParamTable(s, target);
  renderTrend(s, target);
  if (!calcInit) { buildCalculator(); calcInit = true; }
  updateCalculator();
}

/* ---------------- Station header + month stepper ---------------- */
function renderHeader(s, target) {
  const n = s.wqiSeries.length;
  $('p1Head').innerHTML = `
    <div class="stn-head">
      <div>
        <div class="stn-code">${esc(s.code)} · ${esc(s.river)}${s.user ? ` · ${esc(kindLabel(s.kind))}` : ''}</div>
        <h2>${esc(s.name)}</h2>
        <div class="stn-loc">${esc(s.district)} district · ${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}
          · ${n} monthly record${n === 1 ? '' : 's'}${s.user ? ' · added from the app bar' : ''}</div>
      </div>
      <div class="stn-month">
        <button class="btn btn-ghost" id="p1Prev" ${monthIdx === 0 ? 'disabled' : ''}>‹</button>
        <div class="stn-month-val">
          <span>Sampling month</span>
          <b>${fmtMonth(DATA.months[monthIdx])}</b>
        </div>
        <button class="btn btn-ghost" id="p1Next"
          ${monthIdx >= DATA.months.length - 1 ? 'disabled' : ''}>›</button>
        <button class="btn btn-ghost" id="p1Latest">Latest</button>
      </div>
    </div>`;

  $('p1Prev').onclick = () => { monthIdx = Math.max(0, monthIdx - 1); renderPhase1(); };
  $('p1Next').onclick = () => { monthIdx = Math.min(DATA.months.length - 1, monthIdx + 1); renderPhase1(); };
  $('p1Latest').onclick = () => { monthIdx = latestIdx(); renderPhase1(); };
}

/* What has already been attached to a reading at this station, newest month
   first, so a round can be looked back at rather than only filed. */
function renderPhotos(s) {
  const box = $('p1Photos');
  if (!box) return;
  const rounds = store.readings()
    .filter((r) => r.station === s.code && r.attachments?.length)
    .sort((a, b) => String(b.t).localeCompare(String(a.t)));
  if (!rounds.length) { box.hidden = true; box.innerHTML = ''; return; }
  const all = rounds.flatMap((r) => r.attachments.map((a) => ({ ...a, t: r.t })));
  box.hidden = false;
  box.innerHTML = `
    <div class="section-title"><h2>Photographs on record</h2>
      <span class="st-sub">${all.length} attached to ${rounds.length} sampling round${rounds.length === 1 ? '' : 's'} at ${esc(s.name)}</span></div>
    <div class="card">${attachGallery(all)}</div>`;
  wireGallery(box, all);
}

/* ---------------- The class verdict ---------------- */
function renderVerdict(s, target) {
  const r = readingAt(s, monthIdx);
  const rec = complianceRecord(s, target);
  const month = fmtMonth(DATA.months[monthIdx]);

  if (!r) {
    $('p1Verdict').innerHTML = `
      <div class="card verdict warn" style="grid-column:1/-1">
        <div class="v-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg></div>
        <div class="v-body">
          <div class="v-lab">Class ${target} compliance · ${month}</div>
          <div class="v-head">No reading at this station yet</div>
          <div class="v-sub">Nothing has been sampled here at or before ${month}. Enter its six
            parameters in the calculator below and save them; each saved month becomes this
            station's record, and the map colours it once it has one.</div>
        </div>
      </div>
      <div class="card kpi">
        <div class="k-lab">Water Quality Index</div>
        <div class="k-val" style="color:var(--muted-2)">—</div>
        <div class="k-sub">No reading</div>
      </div>
      <div class="card kpi">
        <div class="k-lab">Months meeting Class ${target}</div>
        <div class="k-val" style="color:var(--muted-2)">—</div>
        <div class="k-sub">${rec.passing} of ${rec.total} records</div>
      </div>
      <div class="card kpi">
        <div class="k-lab">Binding parameter</div>
        <div class="k-val" style="color:var(--muted-2);font-size:22px">—</div>
        <div class="k-sub">Nothing to judge yet</div>
      </div>`;
    return;
  }

  const cls = wqiClass(r.wqi);
  const comp = classCompliance(r.raw, target);
  const failing = Object.entries(comp.checks)
    .filter(([, c]) => c.pass === false)
    .map(([p]) => PARAM_META[p].short);
  /* A reading carried forward from an earlier month says so */
  const taken = r.t !== DATA.months[monthIdx] ? ` · reading of ${fmtMonth(r.t)}` : '';

  $('p1Verdict').innerHTML = `
    <div class="card verdict ${comp.pass ? 'ok' : 'bad'}">
      <div class="v-icon">${comp.pass
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m20 6-11 11-5-5"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>'}</div>
      <div class="v-body">
        <div class="v-lab">Class ${target} compliance · ${month}${taken}</div>
        <div class="v-head">${comp.pass
          ? `Meets Class ${target}`
          : `Does not meet Class ${target}`}</div>
        <div class="v-sub">${comp.pass
          ? 'All six INWQS ambient standards are satisfied at this station.'
          : `${comp.failed} of 6 parameters exceed the Class ${target} standard: <b>${failing.join(', ')}</b>.`}</div>
      </div>
    </div>

    <div class="card kpi">
      <div class="k-lab">Water Quality Index</div>
      <div class="k-val" style="color:${cls.color}">${r.wqi.toFixed(1)}</div>
      <div class="k-sub">${cls.label} — ${cls.status}</div>
      <div class="k-note">${cls.use}</div>
    </div>

    <div class="card kpi">
      <div class="k-lab">Months meeting Class ${target}</div>
      <div class="k-val" style="color:${rec.rate >= 0.5 ? '#17a04a' : rec.rate > 0 ? '#ef7d1a' : '#d92d20'}">
        ${(rec.rate * 100).toFixed(0)}<span class="k-unit">%</span></div>
      <div class="k-sub">${rec.passing} of ${rec.total} records</div>
      <div class="k-note">${rec.total ? `${rec.months[0].t} – ${rec.months[rec.total - 1].t}` : ''}</div>
    </div>

    <div class="card kpi">
      <div class="k-lab">Binding parameter</div>
      ${bindingCard(rec)}
    </div>`;
}

function bindingCard(rec) {
  const worst = Object.entries(rec.byParam)
    .sort((a, b) => b[1].rate - a[1].rate)[0];
  if (!worst || worst[1].rate === 0) {
    return `<div class="k-val" style="color:#17a04a;font-size:22px">None</div>
      <div class="k-sub">No parameter fails the standard</div>`;
  }
  const [p, v] = worst;
  return `<div class="k-val" style="color:#d92d20;font-size:26px">${PARAM_META[p].short}</div>
    <div class="k-sub">Fails in ${v.fails} of ${rec.total} months (${(v.rate * 100).toFixed(0)}%)</div>`;
}

/* ---------------- Six-parameter table ---------------- */
function renderParamTable(s, target) {
  const r = readingAt(s, monthIdx);
  const rec = complianceRecord(s, target);

  $('p1TargetNote').innerHTML =
    `INWQS Class ${target} ambient standards · NH₃-N ≤ ${INWQS[target].an} · BOD ≤ ${INWQS[target].bod}
     · COD ≤ ${INWQS[target].cod} · SS ≤ ${INWQS[target].ss} mg/L`;

  if (!r) {
    $('p1Params').innerHTML = `<tr><td colspan="8" class="empty-row">No reading at
      ${esc(s.name)} for ${fmtMonth(DATA.months[monthIdx])} or before. Enter six values in the
      calculator below and save them.</td></tr>`;
    return;
  }

  $('p1Params').innerHTML = Object.entries(PARAM_META).map(([p, m]) => {
    const v = r.raw[p];
    const chk = checkStandard(p, v, target);
    const si = r.si[p];
    const fail = chk.pass === false;
    return `<tr class="${fail ? 'row-fail' : ''}">
      <td><b>${m.name}</b><span class="sub">${m.short}${m.unit ? ` · ${m.unit}` : ''}</span></td>
      <td class="num big" style="color:${fail ? '#d92d20' : 'var(--text)'}">${fmtVal(p, v)}</td>
      <td class="num">${chk.limitText}</td>
      <td>
        <span class="pill-status ${fail ? 'st-fail' : 'st-pass'}">
          ${fail ? 'EXCEEDS' : 'MEETS'}</span>
      </td>
      <td class="num">${chk.ratio != null
        ? `${(chk.ratio * 100).toFixed(0)}%`
        : (chk.margin === 0 ? 'in range' : 'out of range')}</td>
      <td>
        <span class="num" style="color:${siColor(si)};font-weight:700">${si.toFixed(0)}</span>
        <div class="si-bar"><i style="width:${si}%;background:${siColor(si)}"></i></div>
      </td>
      <td class="num">${(WEIGHTS[p] * 100).toFixed(0)}%</td>
      <td class="num">${rec.byParam[p].fails}/${rec.total}</td>
    </tr>`;
  }).join('');
}

const fmtVal = (p, v) => (p === 'an' ? v.toFixed(3) : p === 'ph' || p === 'do' || p === 'bod'
  ? v.toFixed(2) : v.toFixed(1));

/* ---------------- WQI trend with the class band ----------------
   One point per month of the record. A station sampled in some months and
   not others leaves gaps, and the line steps over them rather than
   inventing a value between. */
function renderTrend(s, target) {
  chart?.destroy();
  const pts = DATA.months.map((t) => readingIn(s, t)?.wqi ?? null);
  const rec = complianceRecord(s, target);
  const byMonth = new Map(rec.months.map((m) => [m.t, m]));
  const sparse = s.wqiSeries.length < DATA.months.length;

  chart = new Chart($('p1Chart'), {
    type: 'line',
    data: {
      labels: DATA.months.map(fmtMonth),
      datasets: [{
        label: 'WQI', data: pts, spanGaps: true,
        borderColor: '#2d2f7a', borderWidth: 2, tension: 0.3,
        pointRadius: DATA.months.map((t, i) => (i === monthIdx ? 5 : sparse && pts[i] != null ? 3 : 0)),
        pointBackgroundColor: pts.map((v) => (v == null ? '#fff' : wqiClass(v).color)),
        pointBorderColor: '#fff', pointBorderWidth: 2,
        fill: true,
        backgroundColor: (c) => {
          const { ctx, chartArea: a } = c.chart;
          if (!a) return 'rgba(45,47,122,.1)';
          const g = ctx.createLinearGradient(0, a.top, 0, a.bottom);
          g.addColorStop(0, 'rgba(45,47,122,.22)');
          g.addColorStop(1, 'rgba(45,47,122,0)');
          return g;
        },
      }, {
        label: `Class ${target} threshold (WQI 76.5)`,
        data: pts.map(() => 76.5),
        borderColor: '#17a04a', borderWidth: 1.8, borderDash: [6, 4],
        pointRadius: 0, fill: false,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      onClick: (e, els) => {
        if (!els.length) return;
        monthIdx = els[0].index;
        renderPhase1();
      },
      plugins: {
        legend: {
          position: 'bottom', align: 'start',
          labels: { boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'rectRounded',
            font: { size: 11 }, color: '#5f6880', padding: 13 },
        },
        tooltip: {
          backgroundColor: 'rgba(22,23,63,.96)', padding: 10, cornerRadius: 8,
          callbacks: {
            label: (c) => (c.datasetIndex === 0
              ? (c.parsed.y == null ? ' No reading' : ` WQI ${c.parsed.y.toFixed(1)} · ${wqiClass(c.parsed.y).status}`)
              : ` Class ${target} threshold`),
            afterBody: (items) => {
              const m = byMonth.get(DATA.months[items[0].dataIndex]);
              if (!m) return '';
              return m.compliance.pass
                ? `Meets Class ${target}`
                : `Fails: ${Object.entries(m.compliance.checks)
                    .filter(([, c]) => c.pass === false)
                    .map(([p]) => PARAM_META[p].short).join(', ')}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: '#cfd5e3' },
          ticks: { font: { size: 10.5 }, color: '#8b93a8', maxRotation: 0, autoSkipPadding: 16 } },
        y: { min: 0, max: 100, grid: { color: '#eaedf3' }, border: { display: false },
          ticks: { font: { size: 10.5 }, color: '#8b93a8', stepSize: 20 },
          title: { display: true, text: 'Water Quality Index', font: { size: 10.5 }, color: '#8b93a8' } },
      },
    },
  });
}

/* ============================================================
   Calculator — six parameters in, WQI and class out
   ============================================================ */
function buildCalculator() {
  $('p1Calc').innerHTML = Object.entries(PARAM_META).map(([p, m]) => `
    <div class="field">
      <label for="c_${p}">${m.name} <span class="unit">${m.unit || '—'}</span></label>
      <input id="c_${p}" type="number" step="${m.step}" min="${m.min}" max="${m.max}"
             inputmode="decimal">
      <div class="hint" id="ch_${p}"></div>
    </div>`).join('');

  att = mountAttach('p1Attach', {
    label: 'Photographs of this round',
    hint: 'The sampling point, the field sheet, the meter. Attached to the reading and carried into the location report.',
  });
  Object.keys(PARAM_META).forEach((p) =>
    $(`c_${p}`).addEventListener('input', updateCalculator));
  $('cTemp').addEventListener('input', updateCalculator);

  $('p1Load').onclick = () => {
    const r = readingAt(DATA.focus, monthIdx);
    for (const p of Object.keys(PARAM_META)) $(`c_${p}`).value = r ? r.raw[p] : '';
    $('cTemp').value = r?.raw.temp ?? 27;
    $('cMonth').value = DATA.months[monthIdx];
    updateCalculator();
  };
  $('p1Reset').onclick = () => {
    for (const p of Object.keys(PARAM_META)) $(`c_${p}`).value = '';
    updateCalculator();
  };
  $('p1Save').onclick = () => {
    const vals = readCalc();
    if (!vals) return;
    const { wqi } = computeWQI(vals);
    const s = DATA.focus;
    const t = $('cMonth').value || DATA.months[monthIdx];
    store.addReading({
      station: s.code, stationName: s.name,
      t, ...vals, wqi, wqiClass: wqiClass(wqi).id,
      attachments: att?.get() ?? [],
    });
    att?.clear();
    /* For a location added here the saved reading IS its record, and the
       store's change has already redrawn the page with it in; the page then
       goes to that month, so the saving is seen */
    if (s.user) {
      const i = DATA.months.indexOf(t);
      if (i >= 0) { monthIdx = i; renderPhase1(); }
    }
    $('p1Msg').innerHTML = `<span class="saved-note">Saved · WQI ${wqi.toFixed(1)} · ${wqiClass(wqi).label}`
      + `${s.user ? ` · now on ${esc(s.code)}'s record for ${fmtMonth(t)}` : ''}${esc(saveWarning())}</span>`;
    setTimeout(() => { $('p1Msg').innerHTML = ''; }, 6000);
  };

  $('cMonth').value = DATA.months[DATA.months.length - 1];
  $('p1Load').click();
}

function readCalc() {
  const vals = {};
  for (const [p, m] of Object.entries(PARAM_META)) {
    const el = $(`c_${p}`);
    const v = num(el.value);
    const bad = Number.isNaN(v) || v < m.min || v > m.max;
    el.classList.toggle('bad', el.value !== '' && bad);
    if (bad) return null;
    vals[p] = v;
  }
  const t = num($('cTemp').value);
  vals.temp = Number.isNaN(t) ? 27 : t;
  return vals;
}

function updateCalculator() {
  const target = store.conditions().targetClass;
  const vals = readCalc();
  $('p1Save').disabled = !vals;

  /* Per-field hint: which INWQS band the typed value lands in */
  for (const [p, m] of Object.entries(PARAM_META)) {
    const v = num($(`c_${p}`).value);
    const hint = $(`ch_${p}`);
    if (Number.isNaN(v)) { hint.textContent = ''; hint.className = 'hint'; continue; }
    const chk = checkStandard(p, v, target);
    hint.textContent = chk.pass
      ? `Meets Class ${target} (${chk.limitText})`
      : `Exceeds Class ${target} (${chk.limitText})`;
    hint.className = `hint ${chk.pass ? 'ok' : 'err'}`;
  }

  if (!vals) {
    $('p1Result').innerHTML = `<div class="pv-empty">
      <b>Class identification</b>
      Enter all six parameters. The index, its class, and the Class ${target}
      verdict are computed as you type.</div>`;
    return;
  }

  const { wqi, si, saturation } = computeWQI(vals);
  const cls = wqiClass(wqi);
  const comp = classCompliance(vals, target);

  $('p1Result').innerHTML = `
    <div class="pv-head" style="background:linear-gradient(130deg,${cls.color},${shade(cls.color, -30)})">
      <div class="pv-lab">Water Quality Index</div>
      <div class="pv-val">${wqi.toFixed(1)}</div>
      <div class="pv-cls">${cls.label} — ${cls.status}</div>
    </div>
    <div class="pv-verdict ${comp.pass ? 'ok' : 'bad'}">
      ${comp.pass
        ? `✓ Meets Class ${target} on all six INWQS standards`
        : `✕ Fails Class ${target} on ${comp.failed}: ` + Object.entries(comp.checks)
            .filter(([, c]) => c.pass === false).map(([p]) => PARAM_META[p].short).join(', ')}
    </div>
    <div class="si-list">
      ${Object.keys(PARAM_META).map((p) => `
        <div class="si-item">
          <span class="si-n">${PARAM_META[p].short}
            <b style="color:var(--muted-2);font-weight:500">×${WEIGHTS[p]}</b></span>
          <span class="si-b"><i style="width:${si[p]}%;background:${siColor(si[p])}"></i></span>
          <span class="si-v" style="color:${siColor(si[p])}">${si[p].toFixed(0)}</span>
        </div>`).join('')}
    </div>
    <div class="pv-foot">
      DO saturation <b>${saturation.toFixed(1)}%</b> at ${vals.temp} °C.<br>
      WQI = 0.22·SI<sub>DO</sub> + 0.19·SI<sub>BOD</sub> + 0.16·SI<sub>COD</sub>
      + 0.15·SI<sub>NH₃-N</sub> + 0.16·SI<sub>SS</sub> + 0.12·SI<sub>pH</sub>
    </div>`;
}

function shade(hex, p) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, v + p));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function resizePhase1() { chart?.resize(); }
export function getMonthIdx() { return monthIdx ?? latestIdx(); }
