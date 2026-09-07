/* ============================================================
   phase3.js — Phase 3: LEDS · TMDL · licence register

   A TMDL is written for one location. The location is picked once, in the
   app bar, and every page follows it; here the TMDLs on record for it are
   listed, one is loaded, and a new one can be written. Each record is the
   formula as inputs:

     TMDL = ΣWLA + ΣLA + MOS

   in kg/day for each pollutant, against the loading capacity the reach has
   at its target class and design low flow. The register then says how much
   of the ΣWLA the licences have taken, and how much is left to licence.
   ============================================================ */
import { DATA, designReading, sourceSummary, licencesAt, stationForLicence, flowBasis } from './data.js';
import { LOAD_PARAMS, PARAM_META, TARGET_CLASSES } from './wqi.js';
import {
  budgetAll, headroom, headroomInPE, licenceLoads, licenceCompliance, loadingCapacity,
  suggestAllocation, EFFLUENT_STANDARDS, RIVER_FACTOR, DEFAULT_CONDITIONS, fmtLoad, fmtVol,
} from './loads.js';
import { store, registerAsJson, registerAsCsv, download } from './store.js';
import { prefillFor, CAT_LABEL } from './examples.js';
import { mapCentre } from './mapview.js';
import { mountAttach, attachGallery, wireGallery, saveWarning } from './attach.js';

/* One premises, one licence. Picking a premises that already has one must load
   it, not offer a second — two licences on the same site would count its
   wasteload twice in the budget. */
function licenceForSource(srcId) {
  return store.licences().find((l) => l.srcId === srcId && !l.example);
}

/* A mapped premises is a record being updated; a new location is one being
   added. The button says which. */
function setAddLabel() {
  $('p3Add').textContent = (editing || premMode === 'pick') ? 'Update licence' : 'Add licence';
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
const today = () => new Date().toISOString().slice(0, 10);
/* When a meter was read, written out rather than left as an ISO stamp */
const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).replace('T', ' ');
  return `${d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}, `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
/* A gauging can run over two hours or over a month, so hours alone stops
   being readable at some point and the days are said as well */
const fmtPeriod = (h) => (h >= 48
  ? `${nf(h, 2)} h · ${nf(h / 24, 1)} days`
  : `${nf(h, 2)} h`);
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
};

let chart = null, editing = null;
/* The photographs the two forms are holding, until the record is saved */
let tfAtt = null, lAtt = null;
/* The effluent standard the headroom is shown at; the page's choice, not the record's */
let stdKey = 'A';
/* The TMDL form: open or not, which record it edits (null while writing a
   new one), and for which station — the form closes if the station moves
   under it, because its figures belong to the other one. */
let formOpen = false, formEditing = null, formStation = null;

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
  setAddLabel();
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
      $('lShowPick').disabled = true;
      previewLicence();
      return;
    }
    $('lShowPick').disabled = false;

    const q = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const near = q.near ? Object.values(q.near)[0] : null;
    $('lSourceNote').innerHTML =
      `${esc(su.cats[q.cat]?.label ?? '')} · ${q.dist} m from `
      + `${near ? esc(near.n) : 'the nearest water'} · `
      + `<span class="mono">${lat.toFixed(5)}, ${lon.toFixed(5)}</span>`;

    /* The category follows the source, so the register groups sensibly */
    if (CAT_LABEL[q.cat]) $('lCategory').value = CAT_LABEL[q.cat];

    const existing = licenceForSource(q.id);
    if (existing) {
      /* Its real figures, not invented ones */
      prefilled = null;
      $('lPrefill').hidden = true;
      loadIntoForm(existing);
      return;
    }

    prefilled = prefillFor(q, $('lStd').value);
    $('lRef').value = prefilled.ref;
    $('lFlow').value = prefilled.flow;
    for (const param of LOAD_PARAMS) $(`l_${param}`).value = prefilled.conc[param];
    $('lPrefill').hidden = false;
    $('lShowPick').disabled = false;
    editing = null;
    setAddLabel();
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
    $('lRef').value = prefilled.ref;
    $('lFlow').value = prefilled.flow;
    for (const param of LOAD_PARAMS) $(`l_${param}`).value = prefilled.conc[param];
    previewLicence();
  });

  for (const b of document.querySelectorAll('[data-prem]')) {
    b.onclick = () => {
      if (b.dataset.prem === premMode) return;
      /* The two modes describe different premises. Carrying an edit across
         would let a new location silently overwrite the licence that was open
         — the fields change, the record being written does not. */
      editing = null;
      setPremMode(b.dataset.prem);
      clearForm();
    };
  }
  const goTo = (lat, lon, srcId = null) => document.dispatchEvent(
    new CustomEvent('showonmap', { detail: { lat, lon, srcId } }));

  $('lShowPick').onclick = () => {
    const f = su.features.find((x) => String(x.properties.id) === $('lSource').value);
    if (f) goTo(f.geometry.coordinates[1], f.geometry.coordinates[0], f.properties.id);
  };
  $('lShowNew').onclick = () => {
    const lat = num($('lLat').value);
    const lon = num($('lLon').value);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) goTo(lat, lon);
  };

  $('lPickOnMap').onclick = () => {
    const c = mapCentre();
    if (!c) return;
    $('lLat').value = c[0].toFixed(5);
    $('lLon').value = c[1].toFixed(5);
    previewLicence();
  };
  for (const id of ['lLat', 'lLon']) {
    $(id).addEventListener('input', () => {
      $('lShowNew').disabled = Number.isNaN(num($('lLat').value))
        || Number.isNaN(num($('lLon').value));
      previewLicence();
    });
  }
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

/* ============================================================
   The page
   ============================================================ */
export function renderPhase3() {
  const st = DATA.focus;
  if (formOpen && formStation !== st.code) closeForm();
  const tmdl = store.activeTmdl(st.code);
  renderBar(st, tmdl);

  /* Only the licences that count at this station: the nearest station to
     each premises, unless the register says another */
  const here = licencesAt(st.code);
  const reading = currentReading();
  const budgets = budgetAll(reading, here, tmdl);
  const head = headroom(budgets, stdKey);

  if (!tmdl) {
    $('p3Tmdl').innerHTML = `
      <div class="notice info">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <div style="flex:1">No TMDL is written for <b>${esc(st.name)}</b> yet. Write one: it starts
          written to the loading capacity, and every term can be changed.</div>
        <button class="btn btn-primary" id="p3NewTmdl2">+ New TMDL</button>
      </div>`;
    $('p3NewTmdl2').onclick = () => openForm(null);
    $('p3Body').hidden = true;
  } else {
    renderTmdlCard(tmdl, budgets);
    $('p3Body').hidden = false;
    renderHeadline(budgets, head, tmdl);
    renderBudgetTable(budgets, tmdl, st);
    renderChart(budgets);
  }
  renderRegister(store.licences(), stdKey, budgets);
  if (formOpen) refreshFormCalc();
  previewLicence();
}

/* ============================================================
   The bar: the location, said once, and the records for it
   ============================================================ */
function renderBar(st, tmdl) {
  $('p3LocName').textContent = `${st.name} · ${st.code}`;
  $('p3LocNote').textContent = `${st.river} · ${st.district} · in-river concentration is the `
    + '12-month median measured at this station';

  const list = store.tmdlsFor(st.code);
  const sel = $('p3Rec');
  sel.innerHTML = list.length
    ? list.map((t) => `<option value="${t.id}">${esc(t.ref)} · ${fmtDate(t.date)}`
      + `${t.example ? ' · worked example' : ''}</option>`).join('')
    : '<option value="">No TMDL written for this location</option>';
  sel.value = tmdl?.id ?? '';
  sel.disabled = !list.length;
  $('p3EditTmdl').disabled = !tmdl || !!tmdl.example;
  $('p3DelTmdl').disabled = !tmdl || !!tmdl.example;

  const mine = list.filter((t) => !t.example).length;
  $('p3RecNote').textContent = !tmdl
    ? 'Write one with New TMDL. It starts written to the loading capacity.'
    : tmdl.example
      ? 'A worked example, written to capacity from the monitoring record and the register. '
        + 'It cannot be edited; New TMDL starts a copy you own.'
      : `Yours · ${mine} on record for this location · last saved ${fmtDate(tmdl.updated)}`;
}

function buildTmdlControls() {
  /* The location is picked once, in the app bar. The button takes the eye
     there rather than offering a second picker here. */
  $('p3ChangeLoc').onclick = () => {
    const pick = $('stationPick');
    const pill = pick.closest('.pill');
    pick.focus();
    if (pill) {
      pill.classList.remove('nudge');
      void pill.offsetWidth;
      pill.classList.add('nudge');
      setTimeout(() => pill.classList.remove('nudge'), 2000);
    }
  };
  /* Picking a record stores the pick, and the store's change re-renders */
  $('p3Rec').onchange = () => {
    if ($('p3Rec').value) store.pickTmdl(DATA.focus.code, $('p3Rec').value);
  };
  $('p3NewTmdl').onclick = () => openForm(null);
  $('p3EditTmdl').onclick = () => {
    const t = store.activeTmdl(DATA.focus.code);
    if (t && !t.example) openForm(t);
  };
  $('p3DelTmdl').onclick = () => {
    const t = store.activeTmdl(DATA.focus.code);
    if (!t || t.example) return;
    if (confirm(`Delete ${t.ref}? The record is removed from this browser.`)) {
      if (formEditing === t.id) closeForm();
      store.removeTmdl(t.id);
    }
  };

  $('tfClass').innerHTML = TARGET_CLASSES
    .map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  $('tfAlloc').innerHTML = LOAD_PARAMS.map((p) => `
    <tr>
      <td><b>${PARAM_META[p].short}</b><span class="sub">${PARAM_META[p].name}</span></td>
      ${['wla', 'la', 'mos'].map((k) => `<td class="num">
        <input id="tf_${k}_${p}" type="number" min="0" step="1" inputmode="decimal" aria-label="${k} ${PARAM_META[p].short}"></td>`).join('')}
      <td class="num eq" id="tfT_${p}">—</td>
      <td class="num muted" id="tfC_${p}">—</td>
      <td id="tfF_${p}"></td>
    </tr>`).join('');

  for (const id of ['tfRef', 'tfFlow', ...LOAD_PARAMS.flatMap((p) => ['wla', 'la', 'mos'].map((k) => `tf_${k}_${p}`))]) {
    $(id).addEventListener('input', refreshFormCalc);
  }
  $('tfClass').addEventListener('change', refreshFormCalc);
  /* The meter readings drive the flow, so they write into it rather than
     sitting beside it. Typing in the flow itself still works: nothing here
     touches it until one of these four changes. */
  for (const id of ['tfQ0', 'tfQ1', 'tfT0', 'tfT1']) {
    $(id).addEventListener('input', () => { readGauge(true); refreshFormCalc(); });
  }
  $('tfFill').onclick = fillToCapacity;
  tfAtt = mountAttach('tfAttach', {
    label: 'Photographs',
    hint: 'The reach, the gauge, the field sheet the flow was read off. Attached to this TMDL and carried into its report.',
  });
  $('tfSave').onclick = saveForm;
  $('tfCancel').onclick = closeForm;
  /* The dialog closes the ways a dialog does: the cross, the backdrop, Escape */
  $('tfClose').onclick = closeForm;
  $('tfBack').onclick = closeForm;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && formOpen) closeForm(); });
}

/* ---------------- The flow, read off a meter ----------------
   A totalising meter counts the volume that has gone past it, so two
   readings and the hours between them are a flow. Written into the design
   flow when all four are given, and kept with the record so the figure can
   be checked against the field sheet later.

   A gauging that runs past midnight is often written with the same date on
   both readings; rather than reject it, a negative period under a day is
   taken as the next morning. */
function readGauge(apply = false) {
  const q0 = num($('tfQ0').value), q1 = num($('tfQ1').value);
  const t0 = $('tfT0').value, t1 = $('tfT1').value;
  const some = [$('tfQ0').value, $('tfQ1').value, t0, t1].some((v) => v !== '');
  const out = $('tfGauge');
  const say = (msg, cls = '') => { out.textContent = msg; out.className = `hint${cls}`; };

  if (!some) { say('Leave this empty to enter the design flow directly above.'); return null; }
  if (Number.isNaN(q0) || Number.isNaN(q1) || !t0 || !t1) {
    say('Give both readings and both times, and the flow is worked out from them.');
    return null;
  }
  const vol = q1 - q0;
  if (vol < 0) { say('The final reading is below the initial one. A totaliser only counts up.', ' err'); return null; }
  let hours = (new Date(t1) - new Date(t0)) / 3600000;
  let overnight = false;
  if (hours < 0 && hours > -24) { hours += 24; overnight = true; }
  if (!(hours > 0)) { say('The second reading has to be taken after the first.', ' err'); return null; }
  const flow = vol / hours;
  if (!(flow > 0)) { say('The two readings are the same, so no volume passed the meter.', ' err'); return null; }

  const g = { initial: q0, final: q1, from: t0, to: t1, hours: Math.round(hours * 1000) / 1000,
    volume: Math.round(vol * 1000) / 1000, flow: Math.round(flow) };
  if (apply) $('tfFlow').value = g.flow;
  say(`${nf(vol, vol < 100 ? 2 : 0)} m³ over ${fmtPeriod(hours)}${overnight ? ' (read the next morning)' : ''}`
    + ` = ${nf(g.flow)} m³/h${apply ? ' — written into the design flow above' : ''}`, ' ok');
  return g;
}

/* ---------------- Writing a TMDL ---------------- */
function nextRef(code) {
  const n = store.userTmdls().filter((t) => t.station === code).length + 1;
  return `TMDL/${code}/${new Date().getFullYear()}/${String(n).padStart(2, '0')}`;
}

/* A new record starts from the one on screen, so writing a revision is a
   matter of changing what changed. With nothing on screen it starts written
   to capacity. Editing loads the record itself. */
function openForm(t) {
  const st = DATA.focus;
  formOpen = true;
  formStation = st.code;
  formEditing = t ? t.id : null;
  const base = t ?? store.activeTmdl(st.code);

  $('tfHead').textContent = t ? `Edit ${t.ref}` : 'New TMDL';
  $('tfRef').value = t ? t.ref : nextRef(st.code);
  $('tfTitle').value = t ? (t.title ?? '') : `${st.name} · ${st.river}`;
  $('tfDate').value = t ? (t.date ?? today()) : today();
  $('tfClass').value = base?.targetClass ?? DEFAULT_CONDITIONS.targetClass;
  /* With nothing to copy, the station's own estimated low flow */
  $('tfFlow').value = base?.designFlow ?? st.flowEst ?? DEFAULT_CONDITIONS.designFlow;
  $('tfFlowVerified').checked = !!base?.flowVerified;
  const g = t ? t.gauging : null;      /* a new record starts its own gauging */
  $('tfQ0').value = g?.initial ?? '';
  $('tfQ1').value = g?.final ?? '';
  $('tfT0').value = g?.from ?? '';
  $('tfT1').value = g?.to ?? '';
  readGauge(false);
  $('tfNote').value = t ? (t.note ?? '') : '';
  tfAtt?.set(t?.attachments ?? []);
  for (const p of LOAD_PARAMS) {
    for (const k of ['wla', 'la', 'mos']) $(`tf_${k}_${p}`).value = base?.alloc?.[p]?.[k] ?? '';
  }
  $('p3TmdlForm').hidden = false;
  document.body.classList.add('modal-open');
  if (!base) fillToCapacity(); else refreshFormCalc();
  $('tfRef').focus();
}

function closeForm() {
  formOpen = false;
  formEditing = null;
  formStation = null;
  $('p3TmdlForm').hidden = true;
  document.body.classList.remove('modal-open');
}

function fillToCapacity() {
  const cond = {
    targetClass: $('tfClass').value,
    designFlow: num($('tfFlow').value),
    mosPercent: Math.min(50, Math.max(0, num($('tfMos').value) || 0)),
  };
  if (!(cond.designFlow > 0)) { refreshFormCalc(); return; }
  const alloc = suggestAllocation(currentReading(), licencesAt(DATA.focus.code), cond);
  for (const p of LOAD_PARAMS) {
    for (const k of ['wla', 'la', 'mos']) $(`tf_${k}_${p}`).value = alloc[p]?.[k] ?? 0;
  }
  refreshFormCalc();
}

function readTmdlForm() {
  const ref = $('tfRef').value.trim();
  const flow = num($('tfFlow').value);
  const alloc = {};
  let bad = false;
  for (const p of LOAD_PARAMS) {
    alloc[p] = {};
    for (const k of ['wla', 'la', 'mos']) {
      const raw = $(`tf_${k}_${p}`).value;
      const v = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(v) || v < 0) bad = true;
      alloc[p][k] = v;
    }
  }
  if (!ref || Number.isNaN(flow) || flow <= 0 || bad) return null;
  return {
    ref,
    title: $('tfTitle').value.trim(),
    date: $('tfDate').value || today(),
    targetClass: $('tfClass').value,
    designFlow: flow,
    flowVerified: $('tfFlowVerified').checked,
    alloc,
    /* Written always, even as null: updateTmdl merges, so a gauging that was
       cleared has to clear on the record too */
    gauging: readGauge(false),
    note: $('tfNote').value.trim(),
    attachments: tfAtt?.get() ?? [],
  };
}

/* The sum and the fit, live, as the terms are typed */
function refreshFormCalc() {
  const cls = $('tfClass').value;
  const flow = num($('tfFlow').value);
  const overs = [];
  for (const p of LOAD_PARAMS) {
    const g = (k) => Number($(`tf_${k}_${p}`).value) || 0;
    const total = g('wla') + g('la') + g('mos');
    const cap = flow > 0 ? loadingCapacity(p, cls, flow) : null;
    $(`tfT_${p}`).textContent = nf(total);
    $(`tfC_${p}`).textContent = cap ? nf(cap.capacity) : '—';
    const f = $(`tfF_${p}`);
    if (!cap) { f.textContent = ''; continue; }
    const over = total - cap.capacity;
    if (over > 0.5) {
      overs.push(PARAM_META[p].short);
      f.innerHTML = `<span class="fit-bad">over by ${nf(over)}</span>`;
    } else {
      f.innerHTML = `<span class="fit-ok">fits · ${nf(Math.max(0, -over))} spare</span>`;
    }
  }
  const rec = readTmdlForm();
  $('tfSave').disabled = !rec;
  const hint = $('tfHint');
  if (!rec) {
    hint.textContent = 'A reference and a design flow above zero are needed; an allocation cannot be negative.';
    hint.className = 'hint';
  } else if (overs.length) {
    hint.textContent = `ΣWLA + ΣLA + MOS is more than the loading capacity on ${overs.join(', ')}. `
      + 'It can be saved, and the page will say so.';
    hint.className = 'hint err';
  } else {
    hint.textContent = 'Every pollutant fits within the loading capacity.';
    hint.className = 'hint ok';
  }
}

function saveForm() {
  const rec = readTmdlForm();
  if (!rec) return;
  const station = formStation;
  const id = formEditing;
  closeForm();
  /* The store's change re-renders the page */
  if (id) store.updateTmdl(id, rec);
  else store.addTmdl({ ...rec, station });
  const w = saveWarning();
  if (w) alert(`Saved${w}`);
}

/* ============================================================
   The record as written
   ============================================================ */
function renderTmdlCard(t, budgets) {
  const rows = LOAD_PARAMS.map((p) => {
    const b = budgets[p];
    if (!b) return '';
    const m = PARAM_META[p];
    /* The bar is the larger of the two, so an over-allocation overflows the
       capacity mark rather than being squeezed to fit it */
    const scale = Math.max(b.capacity, b.tmdl, 1);
    const w = (x) => `${((x / scale) * 100).toFixed(2)}%`;
    return `<tr>
      <td><b>${m.short}</b><span class="sub">${m.name}</span></td>
      <td class="num">${nf(b.wla)}</td>
      <td class="num">${nf(b.la)}</td>
      <td class="num muted">${nf(b.mos)}</td>
      <td class="num eq">${nf(b.tmdl)}</td>
      <td class="num">${nf(b.capacity)}<span class="sub">Class ${esc(t.targetClass)} · ${b.standard} mg/L</span></td>
      <td style="min-width:200px">
        <div class="alloc-bar" style="--cap:${w(b.capacity)}" title="ΣWLA, ΣLA and MOS against the loading capacity mark">
          <i style="width:${w(b.wla)};background:#4a3aa7"></i>
          <i style="width:${w(b.la)};background:#8d6cd8"></i>
          <i style="width:${w(b.mos)};background:#c3c8d6"></i>
        </div>
        <div class="alloc-lab ${b.fits ? 'fit-ok' : 'fit-bad'}">${b.fits
          ? `fits · ${nf(Math.max(0, b.capacity - b.tmdl))} kg/day spare`
          : `over the capacity by ${nf(b.excess)} kg/day`}</div>
      </td>
    </tr>`;
  }).join('');

  $('p3Tmdl').innerHTML = `
    <div class="card tmdl-card">
      <div class="tc-head">
        <div>
          <div class="tc-ref">${esc(t.ref)}
            <span class="badge soft${t.example ? ' est' : ''}">${t.example ? 'Worked example' : 'On record'}</span>
            <button class="mini" id="p3ShowReach"
              title="Open the map on the reach this TMDL is written for">Show on map</button></div>
          <div class="tc-title">${esc(t.title || '')}</div>
        </div>
        <div class="tc-meta">
          <span>Target <b>Class ${esc(t.targetClass)}</b></span>
          <span>Design flow <b>${nf(t.designFlow)} m³/h</b><i class="flag${t.flowVerified ? ' ok' : ''}"
            title="${t.flowVerified ? 'Checked against the DID gauged low-flow record.'
              : esc(flowBasis(DATA.focus)) + ' Every load figure scales with this number.'}">${t.flowVerified ? 'verified' : 'estimate'}</i></span>
          <span>Written <b>${fmtDate(t.date)}</b></span>
        </div>
      </div>
      ${gaugeStrip(t)}
      <div class="tbl-scroll">
        <table class="data alloc">
          <thead><tr>
            <th>Pollutant</th>
            <th class="num">ΣWLA ${tipmark('Wasteload allocation: the part of the TMDL given to licensed point sources, in kg/day.')}</th>
            <th class="num">ΣLA ${tipmark('Load allocation: the part for background and diffuse sources with no permit, in kg/day.')}</th>
            <th class="num">MOS ${tipmark('Margin of safety, held back for what the estimate does not know, in kg/day.')}</th>
            <th class="num">= TMDL</th>
            <th class="num">Loading capacity ${tipmark('What the reach can carry at the target class and design flow: standard concentration × design flow × 0.024, with the flow in m³/h. The TMDL has to fit inside it.')}</th>
            <th>How the capacity is allocated</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="tc-foot">
        <span class="tc-key"><i style="background:#4a3aa7"></i>ΣWLA licensed point sources</span>
        <span class="tc-key"><i style="background:#8d6cd8"></i>ΣLA background &amp; diffuse</span>
        <span class="tc-key"><i style="background:#c3c8d6"></i>MOS</span>
        <span class="tc-key"><i class="mark"></i>loading capacity</span>
        ${t.note ? `<span class="tc-note">${esc(t.note)}</span>` : ''}
      </div>
      ${t.attachments?.length ? `<div class="tc-att">
        <div class="tc-att-h">${t.attachments.length} photograph${t.attachments.length === 1 ? '' : 's'} attached</div>
        ${attachGallery(t.attachments, { small: true })}</div>` : ''}
    </div>`;
  if (t.attachments?.length) wireGallery($('p3Tmdl'), t.attachments);
  /* The water it is written for, on the map and flashing */
  $('p3ShowReach').onclick = () => document.dispatchEvent(new CustomEvent('showonmap', {
    detail: { reach: { station: t.station } },
  }));
}

/* Where the design flow came from, on the record rather than only in the
   form that wrote it: both meter readings, when each was taken, and the
   arithmetic between them. */
function gaugeStrip(t) {
  const g = t.gauging;
  if (!g) return '';
  const cell = (lab, sub, val, note) => `
    <div><span class="g-k">${lab}${sub ? ` <i>${sub}</i>` : ''}</span>
      <b>${val}</b>${note ? `<span class="g-n">${note}</span>` : ''}</div>`;
  return `<div class="tc-gauge">
    <div class="tc-att-h">Flow gauging · the design flow is worked out from these readings</div>
    <div class="g-row">
      ${cell('Initial reading', 'bacaan awal', `${nf(g.initial, 3)} m³`, fmtWhen(g.from))}
      ${cell('Final reading', 'bacaan akhir', `${nf(g.final, 3)} m³`, fmtWhen(g.to))}
      ${cell('Volume past the meter', '', `${nf(g.volume, g.volume < 100 ? 2 : 0)} m³`, `over ${fmtPeriod(g.hours)}`)}
      ${cell('Design flow', '', `${nf(g.flow)} m³/h`, `${nf(g.volume, 0)} ÷ ${nf(g.hours, 2)}`)}
    </div>
  </div>`;
}

/* ============================================================
   Headline — how much is left
   ============================================================ */
function renderHeadline(budgets, head, t) {
  const list = Object.values(budgets);
  const notFit = list.filter((b) => !b.fits);
  const over = list.filter((b) => b.overCapacity);
  const names = (arr) => arr.map((b) => PARAM_META[b.param].short).join(', ');
  const binding = head.binding ? PARAM_META[head.binding.param].short : '—';
  const laOver = list.filter((b) => b.laRemaining < -0.5);
  const bad = notFit.length > 0 || over.length > 0;
  const tone = bad ? 'bad' : laOver.length ? 'warn' : 'ok';

  let headline, sub;
  if (notFit.length) {
    headline = `The TMDL does not fit the loading capacity on ${names(notFit)}`;
    sub = `ΣWLA + ΣLA + MOS comes to more than Class ${esc(t.targetClass)} at ${nf(t.designFlow)} m³/h `
      + `can carry, by <b>${fmtLoad(notFit.reduce((s, b) => s + b.excess, 0))}</b>. `
      + 'Edit the record until every pollutant fits.';
  } else if (over.length) {
    headline = `Over-committed on ${names(over)}`;
    sub = 'The licences in the register already permit more than the wasteload allocation. '
      + `Nothing further can be licensed for ${over.length === 1 ? 'this pollutant' : 'these pollutants'} `
      + `until <b>${fmtLoad(over.reduce((s, b) => s + b.reductionNeeded, 0))}</b> is taken back.`;
  } else if (laOver.length) {
    headline = `Diffuse load beyond the ΣLA on ${names(laOver)}`;
    sub = `The river carries <b>${fmtLoad(laOver.reduce((s, b) => s - b.laRemaining, 0))}</b> more `
      + `background and diffuse load than the load allocation allows for, so the reach holds `
      + `Class ${esc(t.targetClass)} only once that comes down. The licences sit inside the ΣWLA, `
      + `with <b>${fmtVol(Math.max(0, head.volume))}</b> left to licence at ${esc(head.standard.label)}.`;
  } else {
    headline = `Within allocation — ${binding} is binding`;
    sub = `<b>${fmtVol(head.volume)}</b> of new effluent could still be licensed at `
      + `${esc(head.standard.label)} before the ΣWLA for ${binding} is used up.`;
  }

  const bb = head.binding ? budgets[head.binding.param] : null;
  const used = bb && bb.wla > 0 ? (bb.licensed / bb.wla) * 100 : null;
  const totalLicensed = list.reduce((s, b) => s + b.licensed, 0);

  $('p3Headline').innerHTML = `
    <div class="card verdict ${tone}" style="grid-column:1/-1">
      <div class="v-icon">${tone !== 'ok'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m20 6-11 11-5-5"/></svg>'}</div>
      <div class="v-body">
        <div class="v-lab">${esc(t.ref)} · Class ${esc(t.targetClass)} at ${nf(t.designFlow)} m³/h</div>
        <div class="v-head">${headline}</div>
        <div class="v-sub">${sub}</div>
      </div>
    </div>

    <div class="card kpi">
      <div class="k-lab">Left to licence</div>
      <div class="k-val" style="color:${bad ? '#d92d20' : tone === 'warn' ? '#b54708' : '#17a04a'};font-size:25px">
        ${bad ? '0' : nf(Math.round(head.volume))}<span class="k-unit">m³/day</span></div>
      <div class="k-sub">at <select id="p3Std" aria-label="Effluent standard for new licences">
        ${Object.entries(EFFLUENT_STANDARDS).map(([k, v]) =>
          `<option value="${k}"${k === stdKey ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}
      </select></div>
      <div class="k-note">${bad
        ? 'Nothing more until the record fits and the licences sit inside the ΣWLA.'
        : `≈ ${nf(headroomInPE(head.volume))} population equivalent`}</div>
    </div>

    <div class="card kpi">
      <div class="k-lab">ΣWLA used</div>
      <div class="k-val" style="font-size:25px">${used == null ? '—'
        : `${nf(Math.min(999, used))}<span class="k-unit">%</span>`}</div>
      <div class="k-sub">${bb ? `${binding}: ${nf(bb.licensed)} of ${nf(bb.wla)} kg/day` : '—'}</div>
      <div class="k-note">The pollutant whose allocation runs out first ${tipmark('The licences '
        + 'in the register, summed, as a share of the wasteload allocation written for this '
        + 'pollutant. Over 100% means the licences already exceed it.')}</div>
    </div>

    <div class="card kpi">
      <div class="k-lab">Licensed load committed</div>
      <div class="k-val" style="font-size:25px">${nf(totalLicensed, 0)}<span class="k-unit">kg/day</span></div>
      <div class="k-sub">${licencesAt(DATA.focus.code).filter((l) => l.active !== false).length} active licences count here</div>
      <div class="k-note">Four pollutants ${tipmark('The wasteload permitted by every active '
        + 'licence that counts at this station — the nearest station to each premises, unless '
        + 'the register says another — summed across BOD, COD, SS and NH₃-N.')}</div>
    </div>`;

  $('p3Std').onchange = () => { stdKey = $('p3Std').value; renderPhase3(); };
}

/* ============================================================
   Load now against the allocation
   ============================================================ */
function renderBudgetTable(budgets, t, st) {
  $('p3Budget').innerHTML = LOAD_PARAMS.map((p) => {
    const b = budgets[p];
    if (!b) return '';
    const m = PARAM_META[p];
    const pct = b.wla > 0 ? Math.max(0, Math.min(100, (b.licensed / b.wla) * 100)) : (b.licensed > 0 ? 100 : 0);
    const col = b.overCapacity ? '#d92d20' : pct > 85 ? '#ef7d1a' : pct > 60 ? '#f2c40c' : '#17a04a';
    const laOver = b.laRemaining < 0;
    return `<tr class="${b.overCapacity ? 'row-fail' : ''}">
      <td><b>${m.short}</b><span class="sub">${m.name}</span></td>
      <td class="num">${b.standard} <span class="sub-inline">mg/L</span></td>
      <td class="num">${p === 'an' ? b.observedConc.toFixed(3) : b.observedConc.toFixed(2)}</td>
      <td class="num"><b>${nf(b.wla)}</b></td>
      <td class="num">${nf(b.la)}</td>
      <td class="num">${nf(b.licensed)}</td>
      <td class="num${laOver ? ' over' : ''}" title="${laOver
        ? `The river carries ${nf(-b.laRemaining)} kg/day more diffuse load than the ΣLA allows for`
        : `${nf(b.laRemaining)} kg/day of the ΣLA is unused`}">${nf(b.diffuse)}</td>
      <td class="num" style="color:${col};font-weight:750">
        ${b.overCapacity ? '−' : ''}${nf(Math.abs(b.remaining))}</td>
      <td style="min-width:130px">
        <div class="cap-bar" title="${pct.toFixed(0)}% of the wasteload allocation is licensed">
          <i style="width:${pct}%;background:${col}"></i>
        </div>
        <span class="cap-lab" style="color:${col}">${b.overCapacity
          ? `${Number.isFinite(b.utilisation) ? (b.utilisation * 100).toFixed(0) : '∞'}% — over`
          : `${pct.toFixed(0)}% used`}</span>
      </td>
    </tr>`;
  }).join('');

  $('p3BudgetNote').innerHTML =
    `Allocation from ${esc(t.ref)} · loading capacity = Class ${esc(t.targetClass)} standard × `
    + `${nf(t.designFlow)} m³/h × ${RIVER_FACTOR} · in-river concentration is the 12-month median at ${esc(st.name)}`
    + ` · ${licencesAt(st.code).length} licences count at this station`;
}

/* ============================================================
   Capacity chart
   ============================================================ */
function renderChart(budgets) {
  chart?.destroy();
  const labels = LOAD_PARAMS.map((p) => PARAM_META[p].short);
  const get = (fn) => LOAD_PARAMS.map((p) => (budgets[p] ? fn(budgets[p]) : 0));
  const within = get((b) => Math.min(b.licensed, b.wla));
  const overWla = get((b) => Math.max(0, b.licensed - b.wla));
  const left = get((b) => Math.max(0, b.wla - b.licensed));
  const la = get((b) => b.la);
  const mos = get((b) => b.mos);
  const capacity = get((b) => b.capacity);

  const bar = (d) => ({ ...d, type: 'bar', stack: 'a', borderRadius: 3, borderSkipped: false, borderWidth: 1.5, borderColor: '#fff' });
  chart = new Chart($('p3Chart'), {
    data: {
      labels,
      datasets: [
        bar({ label: 'Licensed, within ΣWLA', data: within, backgroundColor: '#4a3aa7' }),
        bar({ label: 'Licensed beyond ΣWLA', data: overWla, backgroundColor: '#d92d20' }),
        bar({ label: 'ΣWLA left to licence', data: left, backgroundColor: '#17a04a' }),
        bar({ label: 'ΣLA background & diffuse', data: la, backgroundColor: '#8d6cd8' }),
        bar({ label: 'MOS', data: mos, backgroundColor: '#c3c8d6' }),
        {
          type: 'line', label: 'Loading capacity', data: capacity, showLine: false,
          pointStyle: 'line', pointRadius: 22, pointHoverRadius: 22, pointBorderWidth: 3,
          pointBorderColor: '#16173f', borderColor: '#16173f', order: -1,
        },
      ],
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
   Licence register
   ============================================================ */
/* The register runs to a few hundred rows, so it is read a page at a time.
   The page survives a re-render — suspending a row must not throw the reader
   back to page one — but is clamped when the register shrinks under it. */
const PAGE = 20;
let regPage = 1;
let regSearch = '';                       /* lower-cased, trimmed */
let regSort = { key: null, dir: 1 };      /* column key and +1 / -1 */

/* What a column sorts on. Loads are computed, not stored, so they go
   through licenceLoads like the cells do; status ranks a breach above a
   pass so "what needs looking at" is one click. */
function sortValue(l, key, stdKey) {
  if (key === 'ref') return l.ref ?? '';
  if (key === 'premises') return l.premises ?? '';
  if (key === 'at') return stationForLicence(l) ?? '';
  if (key === 'standard') return l.standard ?? '';
  if (key === 'flow') return l.flow ?? 0;
  if (key.startsWith('conc.')) return l.conc?.[key.slice(5)] ?? 0;
  if (key.startsWith('load.')) return licenceLoads(l)[key.slice(5)] ?? 0;
  if (key === 'status') {
    if (l.active === false) return 0;
    return licenceCompliance(l, stdKey).pass ? 1 : 2;
  }
  return 0;
}

/* The register as the reader has narrowed and ordered it. The search looks
   at the reference, the premises and the category — the things a reader
   would type — and the sort is stable, so ties keep the register's order. */
function arrangeRegister(licences, stdKey) {
  let list = licences;
  if (regSearch) {
    list = list.filter((l) => [l.ref, l.premises, l.category, stationForLicence(l) ?? '', l.bulk ? 'estimated' : '',
      l.example && !l.bulk ? 'example' : '', l.active === false ? 'inactive suspended' : '']
      .join(' ').toLowerCase().includes(regSearch));
  }
  if (regSort.key) {
    const k = regSort.key;
    list = list.map((l, i) => [l, i]).sort(([a, ai], [b, bi]) => {
      const va = sortValue(a, k, stdKey), vb = sortValue(b, k, stdKey);
      const c = typeof va === 'string'
        ? va.localeCompare(vb, 'en', { sensitivity: 'base', numeric: true })
        : va - vb;
      return (c || ai - bi) * (c ? regSort.dir : 1);
    }).map(([l]) => l);
  }
  return list;
}

function renderRegister(all, stdKey, budgets) {
  const licences = arrangeRegister(all, stdKey);
  const active = licences.filter((l) => l.active !== false);
  const totals = {};
  for (const p of LOAD_PARAMS) {
    totals[p] = active.reduce((t, l) => t + licenceLoads(l)[p], 0);
  }

  const pages = Math.max(1, Math.ceil(licences.length / PAGE));
  regPage = Math.min(Math.max(1, regPage), pages);
  const shown = licences.slice((regPage - 1) * PAGE, regPage * PAGE);

  /* The header shows which column the order is on, and which way */
  document.querySelectorAll('table.register th.sortable').forEach((th) => {
    th.classList.toggle('asc', th.dataset.sort === regSort.key && regSort.dir === 1);
    th.classList.toggle('desc', th.dataset.sort === regSort.key && regSort.dir === -1);
    th.setAttribute('aria-sort', th.dataset.sort !== regSort.key ? 'none'
      : regSort.dir === 1 ? 'ascending' : 'descending');
  });

  $('p3Register').innerHTML = licences.length ? shown.map((l) => {
    const loads = licenceLoads(l);
    const comp = licenceCompliance(l, stdKey);
    const inactive = l.active === false;
    const located = typeof l.lat === 'number' && typeof l.lon === 'number';
    return `<tr class="${inactive ? 'row-off' : ''}${located ? ' row-go' : ''}"${located
      ? ` data-lat="${l.lat}" data-lon="${l.lon}"${l.srcId != null ? ` data-src="${l.srcId}"` : ''}
         title="Open this premises on the map"` : ''}>
      <td>
        <b>${esc(l.ref)}</b>
        <span class="sub">${esc(l.category ?? '—')}${l.bulk ? ' · estimated'
          : l.example ? ' · worked example' : l.estimated ? ' · prefilled' : ''}</span>
      </td>
      <td>${esc(l.premises)}${typeof l.lat === 'number'
        ? '<span class="loc-pin" title="Located — drawn on the map">◉</span>'
        : '<span class="loc-none" title="No coordinates, so it is not on the map">–</span>'}</td>
      <td class="mono" title="${l.station ? 'Set in the register' : 'The nearest monitoring station'}">${esc(stationForLicence(l) ?? '—')}</td>
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
  }).join('') : `<tr><td colspan="16" class="empty-row">${regSearch
      ? `Nothing in the register matches “${esc(regSearch)}”.`
      : 'No licences in the register. Add one below, or restore the worked example.'}</td></tr>`;

  $('p3RegTotals').innerHTML = licences.length ? `
    <tr class="totals">
      <td colspan="4"><b>Total — ${active.length} active licence${active.length === 1 ? '' : 's'}${regSearch
        ? ` <span class="muted">matching, of ${all.filter((l) => l.active !== false).length}</span>` : ''}</b></td>
      <td class="num"><b>${nf(active.reduce((t, l) => t + (l.flow || 0), 0))}</b></td>
      <td colspan="4" class="num muted">permitted concentration</td>
      ${LOAD_PARAMS.map((p) => `<td class="num strong">${nf(totals[p], 1)}</td>`).join('')}
      <td colspan="2"></td>
    </tr>` : '';

  renderPager(licences.length, pages);

  /* A row is the premises: clicking it opens the map there, zoomed in. The
     buttons at the end of the row keep their own job, so a click on one of
     them does not also fly off. Rows without a position have nowhere to go
     and are not made to look as if they do. */
  $('p3Register').onclick = (e) => {
    if (e.target.closest('button')) return;
    const tr = e.target.closest('tr.row-go');
    if (!tr) return;
    document.dispatchEvent(new CustomEvent('showonmap', {
      detail: {
        lat: Number(tr.dataset.lat), lon: Number(tr.dataset.lon),
        srcId: tr.dataset.src != null ? Number(tr.dataset.src) : null,
      },
    }));
  };

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

  /* Counted, not written: an example superseded by a real licence leaves
     the register, and the button is only worth showing while any remain. */
  const nEx = store.licences().filter((l) => l.example).length;
  $('p3ClearExamples').style.display = store.hasExamples() && nEx ? '' : 'none';
  $('p3RestoreBar').style.display = store.hasExamples() ? 'none' : 'flex';
}

/* Previous, the page numbers, next. With many pages the numbers thin out to
   the first, the last and a window around the current one. */
function renderPager(total, pages) {
  const el = $('p3Pager');
  if (total <= PAGE) { el.innerHTML = ''; return; }
  const from = (regPage - 1) * PAGE + 1;
  const to = Math.min(total, regPage * PAGE);

  const nums = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - regPage) <= 2) nums.push(i);
    else if (nums.at(-1) !== '…') nums.push('…');
  }
  el.innerHTML = `
    <span class="pager-info">Showing ${from}–${to} of ${total.toLocaleString('en')}${regSearch ? ' matching' : ''}</span>
    <span class="pager-nav">
      <button class="pg" data-page="${regPage - 1}" ${regPage === 1 ? 'disabled' : ''}>‹ Prev</button>
      ${nums.map((n) => n === '…'
        ? '<span class="pg-gap">…</span>'
        : `<button class="pg num${n === regPage ? ' on' : ''}" data-page="${n}"
             ${n === regPage ? 'aria-current="page"' : ''}>${n}</button>`).join('')}
      <button class="pg" data-page="${regPage + 1}" ${regPage === pages ? 'disabled' : ''}>Next ›</button>
    </span>`;
  el.querySelectorAll('[data-page]').forEach((b) => {
    b.onclick = () => {
      regPage = Number(b.dataset.page);
      renderPhase3();
      el.scrollIntoView({ block: 'end', behavior: 'smooth' });
    };
  });
}

/* ---------------- Add / edit form ---------------- */
/* Search box and column headers, wired once. A new search starts from page
   one; a sort keeps the page, because the reader is looking at the same
   register in a different order. Clicking the sorted column again flips it,
   a third click clears it. */
export function buildRegisterControls() {
  const box = $('p3Search');
  let timer = null;
  box.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      regSearch = box.value.trim().toLowerCase();
      regPage = 1;
      renderPhase3();
    }, 120);
  });
  document.querySelectorAll('table.register th.sortable').forEach((th) => {
    th.tabIndex = 0;
    const go = () => {
      const key = th.dataset.sort;
      if (regSort.key !== key) regSort = { key, dir: 1 };
      else if (regSort.dir === 1) regSort = { key, dir: -1 };
      else regSort = { key: null, dir: 1 };
      renderPhase3();
    };
    th.onclick = go;
    th.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
}

export function buildLicenceForm() {
  buildTabs();
  buildTmdlControls();
  buildSourcePicker();
  $('p3ConcFields').innerHTML = LOAD_PARAMS.map((p) => `
    <div class="field">
      <label for="l_${p}">${PARAM_META[p].short} <span class="unit">mg/L</span></label>
      <input id="l_${p}" type="number" step="0.1" min="0" inputmode="decimal">
      <div class="hint" id="lh_${p}"></div>
    </div>`).join('');

  lAtt = mountAttach('lAttach', {
    label: 'Photographs',
    hint: 'The outfall, the premises, the permit. Attached to this licence and carried into the report for the station it counts at.',
  });
  ['lRef', 'lPremises', 'lFlow', ...LOAD_PARAMS.map((p) => `l_${p}`)]
    .forEach((id) => $(id).addEventListener('input', previewLicence));
  $('lStd').addEventListener('change', previewLicence);
  /* Which station the licence counts at: the nearest unless said otherwise */
  $('lStation').innerHTML = '<option value="">Nearest station (automatic)</option>'
    + DATA.stations.map((st) => `<option value="${st.code}">${esc(st.name)} · ${st.code}</option>`).join('');
  $('lStation').addEventListener('change', previewLicence);

  $('p3Add').onclick = () => {
    const l = readForm();
    if (!l) return;
    /* Create or replace, so a premises never ends up with two */
    const dup = !editing && l.srcId != null ? licenceForSource(l.srcId) : null;
    if (editing) { store.updateLicence(editing, l); editing = null; }
    else if (dup) store.updateLicence(dup.id, l);
    else store.addLicence(l);
    const w = saveWarning();
    if (w) alert(`Saved${w}`);
    clearForm();
    renderPhase3();
  };
  $('p3Cancel').onclick = () => { editing = null; clearForm(); renderPhase3(); };

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
    /* Written always: updateLicence merges, and a cleared choice must clear */
    station: $('lStation').value || null,
    attachments: lAtt?.get() ?? [],
  };
  /* Always written, never omitted: updateLicence merges, so leaving the key
     out would let a stale `estimated: true` survive an edit. */
  out.estimated = premMode === 'pick' && isUntouched(out);
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
  /* Written explicitly, never omitted: updateLicence merges, so leaving srcId
     out would let a previous premises' id survive onto this one. */
  const out = { premises, srcId: null, lat: null, lon: null };
  if (!Number.isNaN(lat) && !Number.isNaN(lon)) { out.lat = lat; out.lon = lon; }
  return out;
}

function clearForm() {
  prefilled = null;
  if ($('lPrefill')) $('lPrefill').hidden = true;
  /* The form is empty, so there is nowhere to be shown */
  for (const id of ['lShowPick', 'lShowNew']) if ($(id)) $(id).disabled = true;
  setAddLabel();
  ['lRef', 'lPremises', 'lFlow', 'lLat', 'lLon', ...LOAD_PARAMS.map((p) => `l_${p}`)]
    .forEach((id) => { $(id).value = ''; });
  $('lSource').value = '';
  $('lStation').value = '';
  lAtt?.clear();
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
  $('lStation').value = l.station ?? '';
  $('lFlow').value = l.flow ?? '';
  lAtt?.set(l.attachments ?? []);
  for (const p of LOAD_PARAMS) $(`l_${p}`).value = l.conc?.[p] ?? '';
  setAddLabel();
  previewLicence();
  $('lRef').scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function previewLicence() {
  if (!$('p3Preview')) return;
  const l = readForm();
  $('p3Add').disabled = !l;

  const lStd = $('lStd').value;
  const std = EFFLUENT_STANDARDS[lStd];
  for (const p of LOAD_PARAMS) {
    const v = num($(`l_${p}`).value);
    const hint = $(`lh_${p}`);
    if (Number.isNaN(v)) { hint.textContent = `Std ${lStd} limit ${std[p]}`; hint.className = 'hint'; continue; }
    const ok = v <= std[p];
    hint.textContent = ok ? `Within Std ${lStd} (${std[p]})` : `Exceeds Std ${lStd} (${std[p]})`;
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
  const tmdl = store.activeTmdl(DATA.focus.code);
  const budgets = budgetAll(currentReading(), licencesAt(DATA.focus.code), tmdl);
  const total = LOAD_PARAMS.reduce((t, p) => t + loads[p], 0);
  const at = stationForLicence(l);

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
        const col = !tmdl ? '#c3c8d6'
          : !b || b.overCapacity || loads[p] > b.remaining ? '#d92d20'
            : share > 60 ? '#ef7d1a' : '#17a04a';
        return `<div class="si-item">
          <span class="si-n">${PARAM_META[p].short}</span>
          <span class="si-b"><i style="width:${tmdl ? share : 0}%;background:${col}"></i></span>
          <span class="si-v" style="color:${col}">${nf(loads[p], 1)}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="pv-foot">${at && at !== DATA.focus.code
      ? `This licence counts at <b>${esc(at)}</b>, the nearest station to the premises, not at
         ${esc(DATA.focus.code)}; pick that station to see it against its TMDL. `
      : !at ? 'Without a position this licence counts at no station. ' : ''}${tmdl
      ? `Bars show how much of what is <b>left to licence</b> under ${esc(tmdl.ref)} this licence
         would take. Red means it would not fit within the ΣWLA.`
      : `No TMDL is written for ${esc(DATA.focus.name)}, so there is nothing to judge the fit
         against. Write one on the TMDL tab.`}</div>`;
}

export function resizePhase3() { chart?.resize(); }
