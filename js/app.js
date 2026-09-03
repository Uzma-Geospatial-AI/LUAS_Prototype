/* ============================================================
   app.js — Phase routing and bootstrap
   ============================================================ */
import { DATA, loadAll, readingAt, latestIdx, complianceRecord, fmtMonth,
         setFocus } from './data.js';
import { wqiClass } from './wqi.js';
import { store, registerAsJson, registerAsCsv, download } from './store.js';
import { renderPhase1, resizePhase1 } from './phase1.js';
import { renderPhase2, renderNational, resizePhase2 } from './phase2.js';
import { renderPhase3, buildLicenceForm, resizePhase3 } from './phase3.js';
import { initMap, resizeMap, refreshMap, pauseMap } from './mapview.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const VIEWS = ['map', 'phase1', 'phase2', 'phase3'];
const ready = { map: false, phase2: false, phase3: false };

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
  if (view === 'phase1') { renderPhase1(); resizePhase1(); }
  if (view === 'phase2') {
    if (!ready.phase2) { renderPhase2(); ready.phase2 = true; } else resizePhase2();
  }
  if (view === 'phase3') {
    if (!ready.phase3) { buildLicenceForm(); ready.phase3 = true; }
    renderPhase3();
    resizePhase3();
  }
}

/* ---------------- App bar ---------------- */
function updatePills() {
  const s = DATA.focus;
  const target = store.conditions().targetClass;
  const r = readingAt(s, latestIdx());
  const cls = wqiClass(r.wqi);
  const rec = complianceRecord(s, target);

  $('stationPick').value = s.code;
  $('pillWqi').textContent = r.wqi.toFixed(1);
  $('pillWqi').style.color = cls.color;
  $('pillClass').textContent = cls.id;
  $('pillClass').style.background = cls.color;
  $('pillTarget').textContent = `Class ${target}`;
  $('pillCompliance').textContent = `${(rec.rate * 100).toFixed(0)}%`;
}

function buildStationPicker() {
  const byRiver = {};
  for (const st of DATA.stations) (byRiver[st.river] ??= []).push(st);

  $('stationPick').innerHTML = Object.entries(byRiver).map(([river, list]) => `
    <optgroup label="${esc(river)}">
      ${list.map((st) => `<option value="${st.code}">${esc(st.name)} · ${st.code}</option>`).join('')}
    </optgroup>`).join('');

  $('stationPick').onchange = (e) => {
    /* setFocus fires storechange, which re-renders whatever is built */
    if (!setFocus(e.target.value)) return;
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

  buildStationPicker();
  updatePills();
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
    + `${(DATA.water?.bodies?.length ?? 0)} water bodies · data.gov.my &amp; Digital Earth`;
  $('p2Measure').onchange = (e) => renderNational(e.target.value);

  /* Changing the target class ripples through every phase */
  document.addEventListener('storechange', () => {
    updatePills();
    if (ready.map) refreshMap();
    if (ready.phase2) renderPhase2();
    if (ready.phase3) renderPhase3();
    renderPhase1();
  });

  /* An info bubble is 236px wide; near the right edge it opens leftwards */
  const placeTips = () => {
    for (const el of document.querySelectorAll('.info')) {
      const r = el.getBoundingClientRect();
      el.classList.toggle('left', r.left + 248 > window.innerWidth);
    }
  };
  placeTips();
  document.addEventListener('storechange', placeTips);
  window.addEventListener('resize', placeTips);
  new MutationObserver(placeTips).observe($('v-phase3'), { childList: true, subtree: true });

  /* Back / forward and pasted links both land on the right view */
  window.addEventListener('hashchange', () => {
    const v = location.hash.slice(1);
    if (!$(`v-${v}`)?.classList.contains('active')) show(v);
  });

  window.addEventListener('resize', () => {
    resizeMap(); resizePhase1(); resizePhase2(); resizePhase3();
  });

  /* The Dengkil popup on the map jumps straight into the assessment */
  document.addEventListener('gotophase', (e) => {
    if (e.detail.station) setFocus(e.detail.station);
    show(e.detail.view);
  });

  show(location.hash.slice(1) || 'map');

  $('loader').classList.add('hide');
  setTimeout(() => $('loader').remove(), 500);
})();
