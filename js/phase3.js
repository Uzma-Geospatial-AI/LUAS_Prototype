/* ============================================================
   phase3.js — Phase 1: LEDS · TMDL · SESAMS

   How much load may this reach carry, how much is it carrying now, and how
   much is left to licence.

     TMDL = ΣWLA + ΣLA + MOS
   ============================================================ */
import { DATA, designReading, latestIdx, readingAt, waterSummary, setFocus,
         sourceSummary } from './data.js';
import { LOAD_PARAMS, PARAM_META, INWQS, TARGET_CLASSES } from './wqi.js';
import {
  budgetAll, headroom, headroomInPE, licenceLoads, licenceCompliance,
  EFFLUENT_STANDARDS, RIVER_FACTOR, fmtLoad, fmtVol, riverLoad,
} from './loads.js';
import { store, registerAsJson, registerAsCsv, download } from './store.js';
import { mapCentre } from './mapview.js';

/* ---------------- Prefilling from a mapped premises ----------------
   Deterministic, not random: the same site gives the same figures every time,
   so a number cannot change under someone between looking and saving. These
   are placeholders shaped by the category and the discharge standard — they
   are NOT permit values, and they are badged as invented wherever they go. */
const FLOW_BASE = {          // m3/day, a plausible middle for the category
  kumbahan: 12000,           // sewage and water treatment works
  industri: 1200,            // an industrial premises
  ternakan: 600,             // farms and aquaculture
  sisa: 400,                 // landfill, quarry, waste handling
  tanah: 250,                // construction and cleared land
};

function hash(seed, salt) {
  let h = (Number(seed) % 2147483647) ^ (salt * 2654435761);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;      /* 0..1 */
}

/* A permitted concentration sits under its limit, so the placeholder does too
   — 55% to 95% of it. One that breached its own standard on arrival would be
   a strange thing to hand someone. */
function prefillFor(props, stdKey) {
  const std = EFFLUENT_STANDARDS[stdKey] ?? EFFLUENT_STANDARDS.A;
  const base = FLOW_BASE[props.cat] ?? 1000;
  const flow = Math.round(base * (0.5 + 1.5 * hash(props.id, 1)) / 50) * 50;
  const conc = {};
  LOAD_PARAMS.forEach((param, i) => {
    conc[param] = Math.round(std[param] * (0.55 + 0.4 * hash(props.id, i + 2)) * 10) / 10;
  });
  return { flow, conc };
}

/* What the last prefill produced, so a licence saved untouched can be told
   apart from one someone actually typed. */
let prefilled = null;

/* Just the numbers the prefill sets, with no validation attached */
function currentFigures() {
  const conc = {};
  for (const param of LOAD_PARAMS) conc[param] = num($(`l_${param}`).value);
  return { flow: num($('lFlow').value), conc };
}

function isUntouched(l) {
  if (!prefilled || !l) return false;
  if (Number(l.flow) !== prefilled.flow) return false;
  return LOAD_PARAMS.every((param) => Number(l.conc?.[param]) === prefilled.conc[param]);
}

/* The explanation lives behind the marker, so the card shows the number */
const tipmark = (text) => {
  const t = String(text).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<button type="button" class="tipmark" tabindex="0" data-tip="${t}" aria-label="${t}">i</button>`;
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => (v === '' || v == null ? NaN : Number(v));
const nf = (n, d = 0) => Number(n).toLocaleString('en-MY',
  { minimumFractionDigits: d, maximumFractionDigits: d });

let chart = null, condInit = false, editing = null;

/* The river concentration the budget is built on: the median of the last
   12 monthly records, which is more stable than any single sample. */
function currentReading() {
  return designReading(DATA.focus, 12);
}

/* Two tabs: what the water can carry, and what has been licensed against it.
   They were one long page, and the register at the bottom read as an appendix
   to the budget rather than the other half of the job. */
/* Which way the premises is being given: an existing point source, or a new
   location by coordinate. */
let premMode = 'pick';

function setPremMode(mode) {
  premMode = mode;
  for (const b of document.querySelectorAll('[data-prem]')) {
    const on = b.dataset.prem === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
  $('premPick').classList.toggle('active', mode === 'pick');
  $('premNew').classList.toggle('active', mode === 'new');
  previewLicence();
}

/* The 238 named point sources, grouped the way the map groups them. The
   unnamed ones are left out: nothing in a list reading "Unnamed site" 400
   times can be picked deliberately. */
function buildSourcePicker() {
  const su = sourceSummary();
  const byCat = {};
  for (const f of su.features) {
    if (!f.properties.name) continue;
    (byCat[f.properties.cat] ??= []).push(f.properties);
  }
  const opts = Object.entries(byCat).map(([cat, list]) => `
    <optgroup label="${esc(su.cats[cat]?.label ?? cat)}">
      ${list.sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
    </optgroup>`).join('');
  $('lSource').innerHTML = `<option value="">Select a premises…</option>${opts}`;

  $('lSource').onchange = () => {
    const f = su.features.find((x) => String(x.properties.id) === $('lSource').value);
    if (!f) {
      prefilled = null;
      $('lSourceNote').textContent = 'Choose one of the point sources already mapped.';
      $('lPrefill').hidden = true;
      previewLicence();
      return;
    }

    const q = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const near = q.near ? Object.values(q.near)[0] : null;
    $('lSourceNote').innerHTML =
      `${esc(su.cats[q.cat]?.label ?? '')} · ${q.dist} m from `
      + `${near ? esc(near.n) : 'the nearest water'} · `
      + `<span class="mono">${lat.toFixed(5)}, ${lon.toFixed(5)}</span>`;

    /* The category follows the source, so the register groups sensibly */
    const CAT = { kumbahan: 'Sewage treatment', industri: 'Industrial',
      ternakan: 'Agro-industry', sisa: 'Waste', tanah: 'Construction' };
    if (CAT[q.cat]) $('lCategory').value = CAT[q.cat];

    prefilled = prefillFor(q, $('lStd').value);
    $('lFlow').value = prefilled.flow;
    for (const param of LOAD_PARAMS) $(`l_${param}`).value = prefilled.conc[param];
    $('lPrefill').hidden = false;
    previewLicence();
  };

  /* Changing the standard rescales an untouched prefill, because the figures
     are a fraction of that standard's own limits. */
  $('lStd').addEventListener('change', () => {
    if (premMode !== 'pick' || !prefilled) return;
    /* Read the fields directly: readForm() returns null until a licence
       reference is typed, and the rescale must work before that. */
    if (!isUntouched(currentFigures())) return;
    const f = su.features.find((x) => String(x.properties.id) === $('lSource').value);
    if (!f) return;
    prefilled = prefillFor(f.properties, $('lStd').value);
    $('lFlow').value = prefilled.flow;
    for (const param of LOAD_PARAMS) $(`l_${param}`).value = prefilled.conc[param];
    previewLicence();
  });

  for (const b of document.querySelectorAll('[data-prem]')) {
    b.onclick = () => setPremMode(b.dataset.prem);
  }
  $('lPickOnMap').onclick = () => {
    const c = mapCentre();
    if (!c) return;
    $('lLat').value = c[0].toFixed(5);
    $('lLon').value = c[1].toFixed(5);
    previewLicence();
  };
  for (const id of ['lLat', 'lLon']) $(id).addEventListener('input', previewLicence);
}

function buildTabs() {
  const panes = [...document.querySelectorAll('#v-tmdl .tabpane')];
  for (const b of document.querySelectorAll('#v-tmdl .tab')) {
    b.onclick = () => {
      for (const x of document.querySelectorAll('#v-tmdl .tab')) {
        const on = x === b;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', String(on));
      }
      for (const p of panes) p.classList.toggle('active', p.id === `tab-${b.dataset.tab}`);
      resizePhase3();          /* a chart sized while hidden comes out wrong */
    };
  }
}

/* The page says which water the budget is written for, and lets it be
   changed here rather than only from the app bar. */
function buildForPicker() {
  const sel = $('p3For');
  const byRiver = {};
  for (const st of DATA.stations) (byRiver[st.river] ??= []).push(st);
  sel.innerHTML = Object.entries(byRiver).map(([river, list]) => `
    <optgroup label="${esc(river)}">
      ${list.map((st) => `<option value="${st.code}">${esc(st.name)} · ${st.code}</option>`).join('')}
    </optgroup>`).join('');
  sel.onchange = () => setFocus(sel.value);
}

export function renderPhase3() {
  if (!condInit) { buildConditions(); condInit = true; }
  syncConditions();

  /* Name the water this budget is written for, and say where its numbers come
     from — a capacity with no stated subject invites being read as the whole
     river's. */
  const st = DATA.focus;
  const sel = $('p3For');
  if (sel) sel.value = st.code;
  const note = $('p3ForNote');
  if (note) {
    note.textContent = `${st.river} · ${st.district} · in-river concentration is `
      + `the 12-month median measured at this station`;
  }

  const cond = store.conditions();
  const licences = store.licences();
  const reading = currentReading();
  const budgets = budgetAll(reading, licences, cond);
  const stdKey = $('p3Std').value;
  const head = headroom(budgets, stdKey);

  renderHeadline(budgets, head, cond, reading);
  renderBudgetTable(budgets, cond, reading);
  renderChart(budgets);
  renderRegister(licences, stdKey, budgets);
}

/* ============================================================
   Design conditions
   ============================================================ */
function buildConditions() {
  $('p3Class').innerHTML = TARGET_CLASSES
    .map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  $('p3Std').innerHTML = Object.entries(EFFLUENT_STANDARDS)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

  $('p3Class').onchange = () => { store.setConditions({ targetClass: $('p3Class').value }); renderPhase3(); };
  $('p3Std').onchange = () => renderPhase3();

  const commitFlow = () => {
    const v = num($('p3Flow').value);
    if (Number.isNaN(v) || v <= 0) { syncConditions(); return; }
    store.setConditions({ designFlow: v, flowVerified: $('p3FlowVerified').checked });
    renderPhase3();
  };
  $('p3Flow').addEventListener('change', commitFlow);
  $('p3FlowVerified').addEventListener('change', commitFlow);

  $('p3Mos').addEventListener('change', () => {
    const v = num($('p3Mos').value);
    if (Number.isNaN(v) || v < 0 || v > 50) { syncConditions(); return; }
    store.setConditions({ mosPercent: v });
    renderPhase3();
  });

  $('p3ResetCond').onclick = () => { store.resetConditions(); renderPhase3(); };
}

function syncConditions() {
  const c = store.conditions();
  $('p3Class').value = c.targetClass;
  $('p3Flow').value = c.designFlow;
  $('p3Mos').value = c.mosPercent;
  $('p3FlowVerified').checked = !!c.flowVerified;
  const flag = $('p3FlowFlag');
  flag.textContent = c.flowVerified ? 'verified' : 'estimate';
  flag.classList.toggle('ok', !!c.flowVerified);
  flag.title = c.flowVerified
    ? 'Checked against the DID gauged low-flow record.'
    : 'Not yet checked against a gauged record. Every load figure on this page '
      + 'scales directly with this number, so replace it with the DID gauged '
      + 'low-flow record (MAM7 or 7Q10) and tick Verified.';
}

/* ============================================================
   Headline — how much is left
   ============================================================ */
function renderHeadline(budgets, head, cond, reading) {
  const over = Object.values(budgets).filter((b) => b.overCapacity);
  const binding = head.binding;
  const bindingParam = binding ? PARAM_META[binding.param].short : '—';

  const totalLicensed = Object.values(budgets).reduce((t, b) => t + b.licensed, 0);
  const w = waterSummary();
  const anyOver = over.length > 0;

  $('p3Headline').innerHTML = `
    <div class="card verdict ${anyOver ? 'bad' : 'ok'}" style="grid-column:1/-1">
      <div class="v-icon">${anyOver
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m20 6-11 11-5-5"/></svg>'}</div>
      <div class="v-body">
        <div class="v-lab">Assimilative capacity · Class ${cond.targetClass} at ${cond.designFlow} m³/s</div>
        <div class="v-head">${anyOver
          ? `Over capacity on ${over.map((b) => PARAM_META[b.param].short).join(', ')}`
          : `Capacity available — ${bindingParam} is binding`}</div>
        <div class="v-sub">${anyOver
          ? `The reach already carries more load than Class ${cond.targetClass} allows. `
            + `No further discharge can be licensed for ${over.length === 1 ? 'this pollutant' : 'these pollutants'} `
            + `until <b>${fmtLoad(over.reduce((t, b) => t + b.reductionNeeded, 0))}</b> is removed.`
          : `<b>${fmtVol(head.volume)}</b> of new effluent could still be licensed at `
            + `${esc(head.standard.label)}, limited by ${bindingParam}.`}</div>
      </div>
    </div>

    <div class="card kpi">
      <div class="k-lab">Remaining licensable volume</div>
      <div class="k-val" style="color:${anyOver ? '#d92d20' : '#17a04a'};font-size:25px">
        ${anyOver ? '0' : nf(Math.round(head.volume))}<span class="k-unit">m³/day</span></div>
      <div class="k-sub">at ${esc(head.standard.label)}</div>
      <div class="k-note">${anyOver
        ? 'Load reduction required before any new licence.'
        : `≈ ${nf(headroomInPE(head.volume))} population equivalent`}</div>
    </div>

    <div class="card kpi">
      <div class="k-lab">Receiving environment</div>
      <div class="k-val" style="font-size:25px">${(w.total / 1e6).toFixed(1)}<span class="k-unit">km²</span></div>
      <div class="k-sub">${w.groups.treatment.n} treatment &amp; oxidation basins</div>
      <div class="k-note">Across the catchment ${tipmark('Lakes, ponds, wetlands and treatment '
        + 'basins across the catchment. They receive and hold discharge before it reaches the '
        + 'channel, so they are the environment this budget discharges into.')}</div>
    </div>

    <div class="card kpi">
      <div class="k-lab">Licensed load committed</div>
      <div class="k-val" style="font-size:25px">${nf(totalLicensed, 0)}<span class="k-unit">kg/day</span></div>
      <div class="k-sub">${store.licences().filter((l) => l.active !== false).length} active licences</div>
      <div class="k-note">Four pollutants ${tipmark('The wasteload permitted by every active '
        + 'licence in the register, summed across BOD, COD, SS and NH₃-N.')}</div>
    </div>`;
}

/* ============================================================
   The budget table — the TMDL itself
   ============================================================ */
function renderBudgetTable(budgets, cond, reading) {
  $('p3Budget').innerHTML = LOAD_PARAMS.map((p) => {
    const b = budgets[p];
    if (!b) return '';
    const m = PARAM_META[p];
    const pct = Math.max(0, Math.min(100, (b.current / b.available) * 100));
    const col = b.overCapacity ? '#d92d20' : pct > 85 ? '#ef7d1a' : pct > 60 ? '#f2c40c' : '#17a04a';
    return `<tr class="${b.overCapacity ? 'row-fail' : ''}">
      <td><b>${m.short}</b><span class="sub">${m.name}</span></td>
      <td class="num">${b.standard} <span class="sub-inline">mg/L</span></td>
      <td class="num">${p === 'an' ? b.observedConc.toFixed(3) : b.observedConc.toFixed(2)}</td>
      <td class="num"><b>${nf(b.capacity, 0)}</b></td>
      <td class="num muted">−${nf(b.mos, 0)}</td>
      <td class="num">${nf(b.available, 0)}</td>
      <td class="num">${nf(b.current, 0)}</td>
      <td class="num">${nf(b.licensed, 0)}</td>
      <td class="num">${nf(b.diffuse, 0)}</td>
      <td class="num" style="color:${col};font-weight:750">
        ${b.overCapacity ? '−' : ''}${nf(Math.abs(b.remaining), 0)}</td>
      <td style="min-width:130px">
        <div class="cap-bar" title="${pct.toFixed(0)}% of the allocable load is used">
          <i style="width:${pct}%;background:${col}"></i>
        </div>
        <span class="cap-lab" style="color:${col}">${b.overCapacity
          ? `${(b.utilisation * 100).toFixed(0)}% — over`
          : `${pct.toFixed(0)}% used`}</span>
      </td>
    </tr>`;
  }).join('');

  $('p3BudgetNote').innerHTML =
    `Standard × ${cond.designFlow} m³/s × ${RIVER_FACTOR} · `
    + `12-month median at ${esc(DATA.focus.name)} · MOS ${cond.mosPercent}%`;
}

/* ============================================================
   Capacity chart
   ============================================================ */
function renderChart(budgets) {
  chart?.destroy();
  const labels = LOAD_PARAMS.map((p) => PARAM_META[p].short);
  const licensed = LOAD_PARAMS.map((p) => budgets[p]?.licensed ?? 0);
  const diffuse = LOAD_PARAMS.map((p) => budgets[p]?.diffuse ?? 0);
  const remaining = LOAD_PARAMS.map((p) => Math.max(0, budgets[p]?.remaining ?? 0));
  const over = LOAD_PARAMS.map((p) => (budgets[p]?.overCapacity ? budgets[p].reductionNeeded : 0));
  const mos = LOAD_PARAMS.map((p) => budgets[p]?.mos ?? 0);

  chart = new Chart($('p3Chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Licensed point sources (WLA)', data: licensed, backgroundColor: '#4a3aa7', stack: 'a' },
        { label: 'Background & non-point (LA)', data: diffuse, backgroundColor: '#8d6cd8', stack: 'a' },
        { label: 'Remaining capacity', data: remaining, backgroundColor: '#17a04a', stack: 'a' },
        { label: 'Over capacity', data: over, backgroundColor: '#d92d20', stack: 'a' },
        { label: 'Margin of safety', data: mos, backgroundColor: '#c3c8d6', stack: 'a' },
      ].map((d) => ({ ...d, borderRadius: 3, borderSkipped: false, borderWidth: 1.5, borderColor: '#fff' })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', align: 'start',
          labels: { boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'rectRounded',
            font: { size: 11 }, color: '#5f6880', padding: 12 } },
        tooltip: {
          backgroundColor: 'rgba(22,23,63,.96)', padding: 10, cornerRadius: 8,
          callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtLoad(c.parsed.y)}` },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, border: { color: '#cfd5e3' },
          ticks: { font: { size: 11 }, color: '#5f6880' } },
        y: { stacked: true, grid: { color: '#eaedf3' }, border: { display: false },
          ticks: { font: { size: 10 }, color: '#8b93a8' },
          title: { display: true, text: 'Load (kg/day)', font: { size: 10.5 }, color: '#8b93a8' } },
      },
    },
  });
}

/* ============================================================
   SESAMS licence register
   ============================================================ */
function renderRegister(licences, stdKey, budgets) {
  const active = licences.filter((l) => l.active !== false);
  const totals = {};
  for (const p of LOAD_PARAMS) {
    totals[p] = active.reduce((t, l) => t + licenceLoads(l)[p], 0);
  }

  $('p3Register').innerHTML = licences.length ? licences.map((l) => {
    const loads = licenceLoads(l);
    const comp = licenceCompliance(l, stdKey);
    const inactive = l.active === false;
    return `<tr class="${inactive ? 'row-off' : ''}">
      <td>
        <b>${esc(l.ref)}</b>
        ${l.example ? '<span class="tag-example">EXAMPLE</span>' : ''}
        <span class="sub">${esc(l.category ?? '—')}</span>
        ${l.estimated ? '<span class="badge soft est" title="Figures were prefilled from the category and never edited">EST</span>' : ''}
      </td>
      <td>${esc(l.premises)}${typeof l.lat === 'number'
        ? '<span class="loc-pin" title="Located — drawn on the map">◉</span>'
        : '<span class="loc-none" title="No coordinates, so it is not on the map">–</span>'}</td>
      <td><span class="badge soft">Std ${esc(l.standard ?? '—')}</span></td>
      <td class="num">${nf(l.flow)}</td>
      ${LOAD_PARAMS.map((p) => `<td class="num${comp.breaches.includes(p) ? ' over' : ''}">
        ${l.conc?.[p] ?? 0}</td>`).join('')}
      ${LOAD_PARAMS.map((p) => `<td class="num strong">${nf(loads[p], 1)}</td>`).join('')}
      <td>${inactive
        ? '<span class="pill-status st-off">Inactive</span>'
        : comp.pass
          ? '<span class="pill-status st-pass">Within Std ' + stdKey + '</span>'
          : `<span class="pill-status st-fail">Exceeds Std ${stdKey}</span>`}</td>
      <td class="act">
        <button class="mini" data-toggle="${l.id}">${inactive ? 'Activate' : 'Suspend'}</button>
        ${l.example ? '' : `<button class="mini" data-edit="${l.id}">Edit</button>
        <button class="mini danger" data-del="${l.id}">Delete</button>`}
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="15" class="empty-row">
      No licences in the register. Add one below, or restore the worked example.</td></tr>`;

  $('p3RegTotals').innerHTML = licences.length ? `
    <tr class="totals">
      <td colspan="3"><b>Total — ${active.length} active licence${active.length === 1 ? '' : 's'}</b></td>
      <td class="num"><b>${nf(active.reduce((t, l) => t + (l.flow || 0), 0))}</b></td>
      <td colspan="4" class="num muted">permitted concentration</td>
      ${LOAD_PARAMS.map((p) => `<td class="num strong">${nf(totals[p], 1)}</td>`).join('')}
      <td colspan="2"></td>
    </tr>` : '';

  /* Row actions */
  $('p3Register').querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.toggle;
      const l = licences.find((x) => x.id === id);
      if (l.example) {
        /* Examples are not stored, so materialise a copy the user owns */
        store.addLicence({ ...l, example: false, active: l.active === false });
        store.updateLicence(store.userLicences().at(-1).id, { active: !(l.active !== false) });
      } else {
        store.updateLicence(id, { active: l.active === false });
      }
      renderPhase3();
    };
  });
  $('p3Register').querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => { store.removeLicence(b.dataset.del); renderPhase3(); };
  });
  $('p3Register').querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => loadIntoForm(licences.find((l) => l.id === b.dataset.edit));
  });

  $('p3ExampleBar').style.display = store.hasExamples() ? 'flex' : 'none';
  $('p3RestoreBar').style.display = store.hasExamples() ? 'none' : 'flex';
}

/* ---------------- Add / edit form ---------------- */
export function buildLicenceForm() {
  buildTabs();
  buildForPicker();
  buildSourcePicker();
  $('p3ConcFields').innerHTML = LOAD_PARAMS.map((p) => `
    <div class="field">
      <label for="l_${p}">${PARAM_META[p].short} <span class="unit">mg/L</span></label>
      <input id="l_${p}" type="number" step="0.1" min="0" inputmode="decimal">
      <div class="hint" id="lh_${p}"></div>
    </div>`).join('');

  ['lRef', 'lPremises', 'lFlow', ...LOAD_PARAMS.map((p) => `l_${p}`)]
    .forEach((id) => $(id).addEventListener('input', previewLicence));
  $('lStd').addEventListener('change', previewLicence);

  $('p3Add').onclick = () => {
    const l = readForm();
    if (!l) return;
    if (editing) { store.updateLicence(editing, l); editing = null; $('p3Add').textContent = 'Add licence'; }
    else store.addLicence(l);
    clearForm();
    renderPhase3();
  };
  $('p3Cancel').onclick = () => { editing = null; $('p3Add').textContent = 'Add licence'; clearForm(); renderPhase3(); };

  $('p3ClearExamples').onclick = () => {
    if (confirm('Remove the worked example licences from the register?')) {
      store.clearExamples(); renderPhase3();
    }
  };
  $('p3RestoreExamples').onclick = () => { store.restoreExamples(); renderPhase3(); };

  $('p3ExportJson').onclick = () =>
    download('luas-leds-register.json', JSON.stringify(registerAsJson(), null, 2));
  $('p3ExportCsv').onclick = () =>
    download('luas-leds-register.csv', registerAsCsv(), 'text/csv');
  $('p3Import').onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const n = store.merge(JSON.parse(await f.text()));
      alert(n ? `Imported ${n} record${n === 1 ? '' : 's'}.` : 'No recognisable records in that file.');
    } catch (err) { alert(`Could not read that file: ${err.message}`); }
    e.target.value = '';
    renderPhase3();
  };

  previewLicence();
}

function readForm() {
  const ref = $('lRef').value.trim();
  const flow = num($('lFlow').value);
  const place = readPremises();
  if (!ref || !place || Number.isNaN(flow) || flow <= 0) return null;
  const conc = {};
  for (const p of LOAD_PARAMS) {
    const v = num($(`l_${p}`).value);
    conc[p] = Number.isNaN(v) ? 0 : v;
  }
  const out = {
    ref, ...place,
    category: $('lCategory').value, standard: $('lStd').value, flow, conc,
  };
  if (premMode === 'pick' && isUntouched(out)) out.estimated = true;
  return out;
}

/* Whichever mode is open, a licence comes out with a name and, where it is
   known, a position. Without one it simply cannot be drawn. */
function readPremises() {
  if (premMode === 'pick') {
    const id = $('lSource').value;
    if (!id) return null;
    const f = sourceSummary().features.find((x) => String(x.properties.id) === id);
    if (!f) return null;
    const [lon, lat] = f.geometry.coordinates;
    return { premises: f.properties.name, srcId: f.properties.id, lat, lon };
  }
  const premises = $('lPremises').value.trim();
  if (!premises) return null;
  const lat = num($('lLat').value);
  const lon = num($('lLon').value);
  const out = { premises };
  if (!Number.isNaN(lat) && !Number.isNaN(lon)) { out.lat = lat; out.lon = lon; }
  return out;
}

function clearForm() {
  prefilled = null;
  if ($('lPrefill')) $('lPrefill').hidden = true;
  ['lRef', 'lPremises', 'lFlow', 'lLat', 'lLon', ...LOAD_PARAMS.map((p) => `l_${p}`)]
    .forEach((id) => { $(id).value = ''; });
  $('lSource').value = '';
  previewLicence();
}

function loadIntoForm(l) {
  if (!l) return;
  editing = l.id;
  $('lRef').value = l.ref ?? '';
  /* A licence taken from the map reopens on the map; one entered by hand
     reopens with its coordinates. */
  if (l.srcId != null) {
    setPremMode('pick');
    $('lSource').value = String(l.srcId);
  } else {
    setPremMode('new');
    $('lPremises').value = l.premises ?? '';
    $('lLat').value = l.lat ?? '';
    $('lLon').value = l.lon ?? '';
  }
  $('lCategory').value = l.category ?? 'Industrial';
  $('lStd').value = l.standard ?? 'A';
  $('lFlow').value = l.flow ?? '';
  for (const p of LOAD_PARAMS) $(`l_${p}`).value = l.conc?.[p] ?? '';
  $('p3Add').textContent = 'Save changes';
  previewLicence();
  $('lRef').scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function previewLicence() {
  const l = readForm();
  $('p3Add').disabled = !l;

  const stdKey = $('lStd').value;
  const std = EFFLUENT_STANDARDS[stdKey];
  for (const p of LOAD_PARAMS) {
    const v = num($(`l_${p}`).value);
    const hint = $(`lh_${p}`);
    if (Number.isNaN(v)) { hint.textContent = `Std ${stdKey} limit ${std[p]}`; hint.className = 'hint'; continue; }
    const ok = v <= std[p];
    hint.textContent = ok ? `Within Std ${stdKey} (${std[p]})` : `Exceeds Std ${stdKey} (${std[p]})`;
    hint.className = `hint ${ok ? 'ok' : 'err'}`;
  }

  if (!l) {
    $('p3Preview').innerHTML = `<div class="pv-empty">
      <b>Load contribution</b>
      Enter a licence reference, the premises and a permitted discharge flow.
      The load each pollutant adds to the reach is computed here.</div>`;
    return;
  }

  const loads = licenceLoads(l);
  const cond = store.conditions();
  const budgets = budgetAll(currentReading(), store.licences(), cond);
  const total = LOAD_PARAMS.reduce((t, p) => t + loads[p], 0);

  $('p3Preview').innerHTML = `
    <div class="pv-head" style="background:linear-gradient(130deg,#2d2f7a,#16173f)">
      <div class="pv-lab">Load added by this licence</div>
      <div class="pv-val">${nf(total, 1)}<span style="font-size:15px;font-weight:600"> kg/day</span></div>
      <div class="pv-cls">${fmtVol(l.flow)} at Standard ${esc(l.standard)}</div>
    </div>
    <div class="si-list">
      ${LOAD_PARAMS.map((p) => {
        const b = budgets[p];
        const share = b && b.remaining > 0 ? Math.min(100, (loads[p] / b.remaining) * 100) : 100;
        const col = !b || b.overCapacity || loads[p] > b.remaining ? '#d92d20'
          : share > 60 ? '#ef7d1a' : '#17a04a';
        return `<div class="si-item">
          <span class="si-n">${PARAM_META[p].short}</span>
          <span class="si-b"><i style="width:${share}%;background:${col}"></i></span>
          <span class="si-v" style="color:${col}">${nf(loads[p], 1)}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="pv-foot">
      Bars show how much of the <b>remaining capacity</b> this licence would consume.
      Red means it would not fit within Class ${cond.targetClass}.
    </div>`;
}

export function resizePhase3() { chart?.resize(); }
