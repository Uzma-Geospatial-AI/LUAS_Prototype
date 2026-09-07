/* ============================================================
   app.js — Phase routing and bootstrap
   ============================================================ */
import { DATA, loadAll, readingAt, latestIdx, complianceRecord, fmtMonth,
         setFocus, refreshUserStations } from './data.js';
import { wqiClass } from './wqi.js';
import { sourceLabel } from './firebase.js';
import { store, registerAsJson, registerAsCsv, download } from './store.js';
import { buildExamples, buildTmdlExamples } from './examples.js';
import { buildGlossary } from './glossary.js';
import { renderSesams, resizeSesams } from './sesams.js';
import { renderPhase1, resizePhase1 } from './phase1.js';
import { renderPhase2, renderNational, resizePhase2 } from './phase2.js';
import { renderPhase3, buildLicenceForm, resizePhase3, buildRegisterControls } from './phase3.js';
import { initMap, resizeMap, refreshMap, pauseMap, flyToPoint, showWqProduct, selectWaterBody,
         showStation, mapStationsChanged, refreshTimeline } from './mapview.js';
import { buildLocationDialog, openLocationDialog } from './locations.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const VIEWS = ['map', 'station', 'quality', 'tmdl', 'sesams'];
const ready = { map: false, quality: false, tmdl: false, sesams: false };

/* ---------------- Clock ---------------- */
function tick() {
  const d = new Date();
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'][d.getMonth()];
  $('clock').textContent = `${day}, ${d.getDate()} ${month} ${d.getFullYear()} · `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------------- Navigation ---------------- */
function show(view) {
  if (!VIEWS.includes(view)) view = 'map';
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('#nav button').forEach((b) => b.classList.remove('active'));
  $(`v-${view}`).classList.add('active');
  document.querySelector(`#nav button[data-view="${view}"]`).classList.add('active');
  if (location.hash.slice(1) !== view) location.hash = view;
  document.body.dataset.view = view;
  document.querySelector('.content')?.scrollTo({ top: 0, behavior: 'instant' });

  if (view === 'map') {
    if (!ready.map) { initMap(); ready.map = true; } else resizeMap();
  } else if (ready.map) {
    pauseMap();          /* nothing to see while the map is hidden */
  }
  if (view === 'station') { renderPhase1(); resizePhase1(); }
  if (view === 'quality') {
    if (!ready.quality) { renderPhase2(); ready.quality = true; } else resizePhase2();
  }
  if (view === 'tmdl') {
    if (!ready.tmdl) { buildLicenceForm();
  buildRegisterControls(); ready.tmdl = true; }
    renderPhase3();
    resizePhase3();
  }
  if (view === 'sesams') { renderSesams(); ready.sesams = true; resizeSesams(); }
}

/* ---------------- App bar ---------------- */
function updatePills() {
  const s = DATA.focus;
  const target = store.conditions().targetClass;
  const r = readingAt(s, latestIdx());
  const rec = complianceRecord(s, target);

  $('stationPick').value = s.code;
  /* A location with nothing sampled yet has no index to show */
  $('pillWqi').textContent = r ? r.wqi.toFixed(1) : '—';
  $('pillWqi').style.color = r ? wqiClass(r.wqi).color : 'var(--muted-2)';
  $('pillClass').textContent = r ? wqiClass(r.wqi).id : '—';
  $('pillClass').style.background = r ? wqiClass(r.wqi).color : '#8b93a8';
  $('pillTarget').textContent = `Class ${target}`;
  $('pillCompliance').textContent = `${(rec.rate * 100).toFixed(0)}%`;
}

/* The one location picker. Its last group is not a station but a door: add
   a location, and — when the one picked was added here — edit it. */
let pickerHadEdit = null;
function buildStationPicker() {
  const byRiver = {};
  for (const st of DATA.stations) (byRiver[st.river] ??= []).push(st);
  const own = !!DATA.focus?.user;
  pickerHadEdit = own;

  /* Adding comes first, where it is seen without scrolling the list */
  const sel = $('stationPick');
  sel.innerHTML = `<optgroup label="Locations">
        <option value="__add" class="pick-add">＋ Add a new location…</option>
        ${own ? '<option value="__edit" class="pick-edit">✎ Edit this location…</option>' : ''}
      </optgroup>`
    + Object.entries(byRiver).map(([river, list]) => `
    <optgroup label="${esc(river)}">
      ${list.map((st) => `<option value="${st.code}">${esc(st.name)} · ${st.code}${st.user ? ' · added' : ''}</option>`).join('')}
    </optgroup>`).join('');
  sel.value = DATA.focus.code;

  sel.onchange = (e) => {
    const v = e.target.value;
    if (v === '__add' || v === '__edit') {
      sel.value = DATA.focus.code;
      openLocationDialog(v === '__edit' ? DATA.focus : null);
      return;
    }
    /* setFocus fires storechange, which re-renders whatever is built */
    setFocus(v);
  };
}

/* ---------------- Bootstrap ---------------- */
(async function boot() {
  tick();
  setInterval(tick, 30000);

  const bar = $('lbar');
  const txt = $('ltxt');
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

  /* The worked examples are premises taken off the map, so they cannot be
     built until the sources are in. Before any phase renders. */
  store.setExamples(buildExamples());
  /* And a worked TMDL for every station, from the record and the register */
  store.setTmdlExamples(buildTmdlExamples());

  buildStationPicker();
  updatePills();
  buildLocationDialog();
  /* A location added, edited or removed: the picker and the map follow */
  document.addEventListener('stationschange', () => {
    buildStationPicker();
    if (ready.map) mapStationsChanged();
  });
  document.querySelectorAll('#nav button[data-view]').forEach((b) => {
    b.onclick = () => show(b.dataset.view);
  });

  $('sbExportJson').onclick = () =>
    download('luas-sesams-register.json', JSON.stringify(registerAsJson(), null, 2));
  $('sbExportCsv').onclick = () =>
    download('luas-sesams-register.csv', registerAsCsv(), 'text/csv');

  /* What the app is actually running on, said once, at the top */
  const basin = DATA.catchment?.features?.[0]?.properties ?? {};
  $('tbStatus').innerHTML =
    `Sungai Langat catchment · ${Math.round(basin.area_km2 ?? 0).toLocaleString('en')} km² · `
    + `${DATA.stations.length} stations · `
    + `record ${fmtMonth(DATA.months[0])} – ${fmtMonth(DATA.months[latestIdx()])} · `
    + `${(DATA.water?.bodies?.length ?? 0)} water bodies · data.gov.my &amp; Digital Earth`
    /* Where the numbers were actually served from. It earns a clause in the
       status line: which of the two sources answered is not something a
       reader should have to open the network tab to find out. */
    + ` · served from ${esc(sourceLabel())}`;
  $('p2Measure').onchange = (e) => renderNational(e.target.value);

  /* A change to the store — the station, a licence, a TMDL — ripples through every phase */
  document.addEventListener('storechange', () => {
    /* Readings saved for a location added here are its record, and can
       stretch the month range every page walks */
    const months = DATA.months.length;
    refreshUserStations();
    if (DATA.months.length !== months && ready.map) refreshTimeline();
    if (!!DATA.focus.user !== pickerHadEdit) buildStationPicker();
    updatePills();
    if (ready.map) refreshMap();
    if (ready.quality) renderPhase2();
    if (ready.tmdl) renderPhase3();
    if (ready.sesams) renderSesams();
    renderPhase1();
  });

  /* ---- Info bubbles ----
     The bubble is fixed, so nothing clips it and the viewport is the only
     thing it has to fit inside. It is placed when it is asked for rather than
     for every mark up front, which also means marks rendered later need no
     announcement. Anchoring by `bottom` upward and `top` downward keeps the
     bubble's own height out of it — a pseudo element's height cannot be read
     from script. */
  const TIP_W = 236;
  const TIP_GAP = 7;
  let liveTip = null;

  const placeTip = (el) => {
    const r = el.getBoundingClientRect();
    const l = Math.max(8, Math.min(r.left - 8, window.innerWidth - TIP_W - 8));
    el.style.setProperty('--tip-l', `${Math.round(l)}px`);
    /* Above the halfway line there is more room below, and the other way
       round. Either way the bubble opens into the larger gap. */
    if (r.top < window.innerHeight / 2) {
      el.style.setProperty('--tip-t', `${Math.round(r.bottom + TIP_GAP)}px`);
      el.style.setProperty('--tip-b', 'auto');
    } else {
      el.style.setProperty('--tip-t', 'auto');
      el.style.setProperty('--tip-b', `${Math.round(window.innerHeight - r.top + TIP_GAP)}px`);
    }
    liveTip = el;
  };

  for (const ev of ['pointerenter', 'focus']) {
    document.addEventListener(ev, (e) => {
      const el = e.target instanceof Element ? e.target.closest?.('.tipmark') : null;
      if (el) placeTip(el);
    }, true);
  }
  /* Fixed coordinates go stale the moment the page moves under them */
  const refresh = () => { if (liveTip?.isConnected) placeTip(liveTip); };
  document.addEventListener('scroll', refresh, true);
  window.addEventListener('resize', refresh);

  /* Back / forward and pasted links both land on the right view */
  window.addEventListener('hashchange', () => {
    const v = location.hash.slice(1);
    if (!$(`v-${v}`)?.classList.contains('active')) show(v);
  });

  window.addEventListener('resize', () => {
    resizeMap(); resizePhase1(); resizePhase2(); resizePhase3(); resizeSesams();
  });

  /* The Dengkil popup on the map jumps straight into the assessment */
  document.addEventListener('gotophase', (e) => {
    if (e.detail.station) setFocus(e.detail.station);
    show(e.detail.view);
  });

  /* "Show on map" from the licence form: switch first, then fly — show('map')
     builds the map on its first visit, and flying before that has nothing to
     fly. */
  document.addEventListener('showonmap', (e) => {
    show('map');
    if (e.detail.station) {
      showStation(e.detail.station);
    } else if (e.detail.waterId != null) {
      /* A water body is shown as itself: fitted, picked out and named */
      selectWaterBody(e.detail.waterId);
    } else if (typeof e.detail.lat === 'number') {
      flyToPoint(e.detail.lat, e.detail.lon, 16, e.detail.srcId ?? null);
    }
    /* A satellite product asked for along with the place, or on its own */
    if (e.detail.wq) showWqProduct(e.detail.wq, e.detail.quarter ?? null);
  });

  buildGlossary();

  show(location.hash.slice(1) || 'map');

  $('loader').classList.add('hide');
  setTimeout(() => $('loader').remove(), 500);
})();
