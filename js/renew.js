/* ============================================================
   renew.js — Recording a licence renewal

   A discharge licence is not re-issued from nothing: it is renewed, and the
   register should be able to say when, from what term to what term, and by
   whose reference. Overwriting the two dates would answer "until when" and
   lose "since when", which is the question an inspection asks.

   So a renewal pushes the term it replaces onto the entry's own history and
   writes the new one over the top:

     renewals: [{ from, to, ref, on, note }]   oldest first

   `from`/`to` are the term that was superseded, `on` is the day the renewal
   was recorded, and `ref` is the reference that term ran under — a renewal
   sometimes brings a new one, and the old rows should keep the old.

   A continuous renewal starts the day after the previous term ends. One
   recorded after the licence has already lapsed starts today instead: the
   register may not quietly assert that a premises was covered on days when
   nobody said it was.
   ============================================================ */
import { store } from './store.js';
import { parseDay, todayISO, expiryOf, countdown, termProblem } from './expiry.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addYears = (d, n) => { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x; };

/* The term a renewal would naturally take: carrying straight on from the one
   it replaces, or starting today if that one has already run out. */
export function nextTerm(l) {
  const end = parseDay(l?.expires);
  const today = parseDay(todayISO());
  const start = end && end >= today ? addDays(end, 1) : today;
  return { issued: iso(start), expires: iso(addYears(start, 1)) };
}

export const renewalsOf = (l) => (Array.isArray(l?.renewals) ? l.renewals : []);

/* Every renewal on the register, newest first, with the licence it belongs
   to — the section that answers "what has been renewed lately". */
export function renewalLog(licences) {
  const out = [];
  for (const l of licences ?? []) {
    for (const r of renewalsOf(l)) out.push({ ...r, licence: l });
  }
  return out.sort((a, b) => String(b.on ?? '').localeCompare(String(a.on ?? '')));
}

/* ---------------- The dialog ---------------- */
/* What is open, and what to do once it is saved. `adopt` is handed in by the
   page: an estimated entry has to become the user's own before it can carry
   a history, and only phase3 knows how that is done there. */
let open = null;
let adoptFn = (l) => l;

export function buildRenewDialog(opts = {}) {
  adoptFn = opts.adopt ?? ((l) => l);
  $('rnClose').onclick = close;
  $('rnBack').onclick = close;
  $('rnCancel').onclick = close;
  $('rnSave').onclick = save;
  for (const id of ['rnIssued', 'rnExpires', 'rnRef']) $(id).addEventListener('input', check);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('renewDialog').hidden) close();
  });
}

export function openRenewDialog(l) {
  if (!l) return;
  open = l;
  const e = expiryOf(l);
  const t = nextTerm(l);
  const hist = renewalsOf(l);

  $('rnHead').textContent = `Renew ${l.ref ?? 'licence'}`;
  $('rnWho').innerHTML = `<b>${esc(l.premises)}</b>`
    + `<span>${esc(l.category ?? '')}${l.bulk ? ' · estimated entry' : l.example ? ' · worked example' : ''}`
    + ` · ${(l.flow ?? 0).toLocaleString('en')} m³/day at Standard ${esc(l.standard ?? 'A')}</span>`;
  $('rnNow').innerHTML = e.has
    ? `<span class="rn-lab">Term on record</span><b>${esc(l.issued ?? '—')} → ${esc(l.expires)}</b>`
      + `<span class="rn-state" style="color:${e.colour}">${esc(e.label)}</span>`
    : '<span class="rn-lab">Term on record</span><b>None</b>'
      + '<span class="rn-state" style="color:#9a4b00">No expiry date has been entered for this licence</span>';

  $('rnRef').value = l.ref ?? '';
  $('rnIssued').value = t.issued;
  $('rnExpires').value = t.expires;
  $('rnNote').value = '';

  $('rnHist').innerHTML = hist.length
    ? `<h4 class="ar-h">Previous terms <span>${hist.length}</span></h4>
       <ul class="rn-hist">${hist.slice().reverse().map((r) => `
         <li><b>${esc(r.from ?? '—')} → ${esc(r.to ?? '—')}</b>
           <span>${esc(r.ref ?? '')}${r.on ? ` · renewed ${esc(r.on)}` : ''}</span>
           ${r.note ? `<i>${esc(r.note)}</i>` : ''}</li>`).join('')}</ul>`
    : '';

  $('renewDialog').hidden = false;
  document.body.classList.add('modal-open');
  check();
  $('rnExpires').focus();
}

function close() {
  open = null;
  $('renewDialog').hidden = true;
  document.body.classList.remove('modal-open');
}

function read() {
  const issued = $('rnIssued').value || null;
  const expires = $('rnExpires').value || null;
  const ref = $('rnRef').value.trim();
  if (!expires) return { why: 'Enter the date the renewed licence runs to.' };
  if (!ref) return { why: 'Enter the licence reference.' };
  const bad = termProblem(issued, expires);
  if (bad) return { why: bad };
  /* A renewal that ends before the term it replaces is not a renewal */
  const prev = parseDay(open?.expires);
  const end = parseDay(expires);
  if (prev && end && end <= prev) {
    return { why: `The renewed term has to run past the current one, which ends ${open.expires}.` };
  }
  return { rec: { issued, expires, ref, note: $('rnNote').value.trim() } };
}

function check() {
  const r = read();
  $('rnSave').disabled = !r.rec;
  const h = $('rnHint');
  if (!r.rec) { h.textContent = r.why; h.className = 'hint err'; return; }
  const e = expiryOf({ expires: r.rec.expires });
  h.textContent = `Renewed to ${r.rec.expires} — ${e.label.toLowerCase()}.`;
  h.className = 'hint ok';
}

function save() {
  const r = read();
  if (!r.rec || !open) return;
  // Renewing the dates does not verify the example's discharge figures.
  const estimated = !!(open.example || open.estimated);
  /* An estimated entry cannot carry a history until it is the user's own */
  const l = open.example ? adoptFn(open) : open;
  if (!l) { close(); return; }

  const history = renewalsOf(l).slice();
  /* Only a term that existed is worth keeping; an entry that never had one
     is being given its first, not renewed away from nothing. */
  if (l.expires) {
    history.push({ from: l.issued ?? null, to: l.expires, ref: l.ref ?? null, on: todayISO(),
      note: r.rec.note || null });
  }
  close();
  store.updateLicence(l.id, {
    ref: r.rec.ref,
    issued: r.rec.issued,
    expires: r.rec.expires,
    renewals: history,
    estimated,
    /* A renewal puts a suspended licence back in force: that is what it is for */
    active: true,
  });
}
