/* ============================================================
   app.js — Phase routing and bootstrap
   ============================================================ */
import { DATA, loadAll, readingAt, latestIdx, complianceRecord } from './data.js';
import { wqiClass } from './wqi.js';
import { store } from './store.js';
import { renderPhase1, resizePhase1 } from './phase1.js';
import { renderPhase2, renderNational, resizePhase2 } from './phase2.js';
import { renderPhase3, buildLicenceForm, resizePhase3 } from './phase3.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PHASES = ['phase1', 'phase2', 'phase3'];
const ready = { phase2: false, phase3: false };

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
  if (!PHASES.includes(view)) view = 'phase1';
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('#nav button').forEach((b) => b.classList.remove('active'));
  $(`v-${view}`).classList.add('active');
  document.querySelector(`#nav button[data-view="${view}"]`).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });

  if (view === 'phase1') { renderPhase1(); resizePhase1(); }
  if (view === 'phase2') {
    if (!ready.phase2) { renderPhase2(); ready.phase2 = true; } else resizePhase2();
  }
  if (view === 'phase3') {
    if (!ready.phase3) { buildLicenceForm(); ready.phase3 = true; }
    renderPhase3();
    resizePhase3();
  }
  location.hash = view;
}

/* ---------------- Header status pills ---------------- */
function updatePills() {
  const s = DATA.focus;
  const target = store.conditions().targetClass;
  const r = readingAt(s, latestIdx());
  const cls = wqiClass(r.wqi);
  const rec = complianceRecord(s, target);

  $('pillStation').textContent = s.name.split(' (')[0];
  $('pillWqi').textContent = r.wqi.toFixed(1);
  $('pillWqi').style.color = cls.color;
  $('pillClass').textContent = cls.id;
  $('pillClass').style.background = cls.color;
  $('pillTarget').textContent = `Class ${target}`;
  $('pillCompliance').textContent = `${(rec.rate * 100).toFixed(0)}%`;
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

  updatePills();
  document.querySelectorAll('#nav button').forEach((b) => {
    b.onclick = () => show(b.dataset.view);
  });
  $('p2Measure').onchange = (e) => renderNational(e.target.value);

  /* Changing the target class ripples through every phase */
  document.addEventListener('storechange', () => {
    updatePills();
    if (ready.phase2) renderPhase2();
    if ($('v-phase1').classList.contains('active')) renderPhase1();
  });

  window.addEventListener('resize', () => {
    resizePhase1(); resizePhase2(); resizePhase3();
  });

  show(location.hash.slice(1) || 'phase1');

  $('loader').classList.add('hide');
  setTimeout(() => $('loader').remove(), 500);
})();
