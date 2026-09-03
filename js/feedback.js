/* ============================================================
   feedback.js — General feedback box

   One plain box at the foot of the page. It is deliberately not tied to a
   phase, a chart or a figure: whoever is reading can write whatever they
   want about the system as a whole.

   There is no backend, so entries are kept in localStorage and exported as
   a file when someone wants to send them on.
   ============================================================ */
import { store, download } from './store.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MAX = 4000;

export function initFeedback() {
  const text = $('fbText');
  const from = $('fbFrom');
  const send = $('fbSend');

  const sync = () => {
    const n = text.value.trim().length;
    send.disabled = n === 0;
    $('fbCount').textContent = `${n} / ${MAX}`;
    $('fbCount').classList.toggle('over', n > MAX);
    if (n > MAX) send.disabled = true;
  };
  text.addEventListener('input', sync);

  send.onclick = () => {
    const body = text.value.trim();
    if (!body || body.length > MAX) return;
    store.addFeedback({ body, from: from.value.trim() || null });
    text.value = '';
    from.value = '';
    sync();
    $('fbMsg').innerHTML = '<span class="saved-note">Thank you — saved</span>';
    setTimeout(() => { $('fbMsg').innerHTML = ''; }, 5000);
    renderList();
  };

  $('fbExport').onclick = () => {
    const rows = store.feedback();
    if (!rows.length) return;
    download('luas-feedback.json', JSON.stringify({
      generated: new Date().toISOString(),
      system: 'LUAS System — Sungai Langat',
      count: rows.length,
      feedback: rows,
    }, null, 2));
  };

  $('fbClear').onclick = () => {
    const n = store.feedback().length;
    if (!n) return;
    if (confirm(`Delete all ${n} saved feedback entr${n === 1 ? 'y' : 'ies'} from this browser?`)) {
      store.clearFeedback();
      renderList();
    }
  };

  document.addEventListener('storechange', renderList);
  sync();
  renderList();
}

function renderList() {
  const rows = [...store.feedback()].reverse();
  $('fbCountBadge').textContent = rows.length;
  $('fbTools').style.display = rows.length ? 'flex' : 'none';

  $('fbList').innerHTML = rows.length ? rows.map((f) => `
    <div class="fb-item">
      <div class="fb-meta">
        <b>${f.from ? esc(f.from) : 'Anonymous'}</b>
        <span>${new Date(f.created).toLocaleString('en-MY', {
          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })}</span>
        <button class="mini danger" data-fb="${f.id}">Delete</button>
      </div>
      <div class="fb-body">${esc(f.body)}</div>
    </div>`).join('') : '';

  $('fbList').querySelectorAll('[data-fb]').forEach((b) => {
    b.onclick = () => { store.removeFeedback(b.dataset.fb); renderList(); };
  });
}
