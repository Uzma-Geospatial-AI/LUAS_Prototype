/* ============================================================
   attach.js — Photographs attached to a record

   A sampling round, a TMDL and a licence are all things someone stands in
   front of with a camera. This is the field that lets those photographs be
   attached to the record they belong to, so the report carries them.

       WHY THEY ARE RESIZED

   There is no backend: a record lives in this browser's localStorage,
   which holds about 5 MB for the whole site. A phone photograph is 3–6 MB
   before it is encoded, and base64 adds a third again — two of them would
   fill the store and the next save would fail silently. So every picture
   is drawn onto a canvas at no more than 1600 px on its long side and
   re-encoded as JPEG, which brings a typical photograph under 400 KB, and
   the field says how much of the store is spoken for.

   The originals are never uploaded anywhere. They are read in the browser,
   resized in the browser, and kept in the browser.
   ============================================================ */
import { store, storageOk, storageBytes } from './store.js';

const MAX_SIDE = 1600;
const QUALITY = 0.72;
export const MAX_PER_RECORD = 8;
const BUDGET = 4.5 * 1024 * 1024;      /* what localStorage will hold, near enough */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB`
  : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

/* One picture, read and shrunk. Rotation is left to the browser: it applies
   the EXIF orientation when it decodes, and the canvas takes what it is
   given. */
function shrink(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('could not be read'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('is not an image this browser can read'));
      img.onload = () => {
        const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * k));
        const h = Math.max(1, Math.round(img.height * k));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);   /* a transparent PNG keeps its shape */
        ctx.drawImage(img, 0, 0, w, h);
        const url = cv.toDataURL('image/jpeg', QUALITY);
        res({ id: uid(), name: file.name || 'photograph.jpg', caption: '', url, w, h,
          bytes: Math.round((url.length - 23) * 0.75), added: new Date().toISOString() });
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* ---------------- The field ---------------- */
/* Mounts into an element and hands back a handle on what it holds. The
   record is not written here: the form that owns the field reads get()
   when it saves. */
export function mountAttach(hostId, opts = {}) {
  const host = document.getElementById(hostId);
  if (!host) return { get: () => [], set: () => {}, clear: () => {} };
  const label = opts.label ?? 'Photographs';
  const hint = opts.hint ?? 'Site photographs, a field sheet, a meter reading. Kept in this browser with the record.';
  let list = [];

  host.classList.add('att');
  host.innerHTML = `
    <label>${esc(label)}</label>
    <div class="att-drop" tabindex="0" role="button" aria-label="Add photographs">
      <input type="file" accept="image/*" multiple hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L8 6H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-4z"/><circle cx="12" cy="13" r="3.5"/></svg>
      <div><b>Add photographs</b><span>or drop them here</span></div>
    </div>
    <div class="att-list"></div>
    <div class="hint att-hint">${esc(hint)}</div>`;

  const input = host.querySelector('input');
  const drop = host.querySelector('.att-drop');
  const box = host.querySelector('.att-list');
  const note = host.querySelector('.att-hint');

  const say = (msg, bad) => {
    note.textContent = msg ?? hint;
    note.className = `hint att-hint${bad ? ' err' : ''}`;
  };

  const render = () => {
    box.innerHTML = list.map((a) => `
      <figure class="att-item" data-id="${a.id}">
        <img src="${a.url}" alt="${esc(a.caption || a.name)}" loading="lazy">
        <div class="att-body">
          <input class="att-cap" value="${esc(a.caption)}" placeholder="Caption — what this shows, where, when"
            aria-label="Caption for ${esc(a.name)}">
          <div class="att-meta">${esc(a.name)} · ${a.w}×${a.h} · ${fmtBytes(a.bytes)}</div>
        </div>
        <button type="button" class="att-x" title="Remove this photograph" aria-label="Remove">×</button>
      </figure>`).join('');
    if (list.length) {
      const used = list.reduce((t, a) => t + a.bytes, 0);
      say(`${list.length} photograph${list.length === 1 ? '' : 's'} · ${fmtBytes(used)} · ${hint}`);
    } else say(null);
    opts.onchange?.(list);
  };

  const add = async (files) => {
    const room = MAX_PER_RECORD - list.length;
    if (room <= 0) { say(`A record holds at most ${MAX_PER_RECORD} photographs.`, true); return; }
    const take = [...files].filter((f) => f.type.startsWith('image/')).slice(0, room);
    if (!take.length) { say('Only image files can be attached.', true); return; }
    say(`Reading ${take.length} photograph${take.length === 1 ? '' : 's'}…`);
    for (const f of take) {
      try {
        const a = await shrink(f);
        /* Room in the store, counting what is already written and what this
           form is holding but has not saved */
        const pending = list.reduce((t, x) => t + x.bytes, 0) * 1.37;
        if (storageBytes() + pending + a.bytes * 1.37 > BUDGET) {
          say('This browser\'s storage is nearly full. Remove a photograph, or export and clear some records first.', true);
          return;
        }
        list.push(a);
      } catch (e) { say(`${f.name} ${e.message}.`, true); }
    }
    render();
  };

  drop.onclick = () => input.click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
  input.onchange = () => { add(input.files); input.value = ''; };
  for (const ev of ['dragenter', 'dragover']) {
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  }
  drop.addEventListener('drop', (e) => add(e.dataTransfer?.files ?? []));

  box.addEventListener('input', (e) => {
    const f = e.target.closest('.att-item');
    if (f && e.target.classList.contains('att-cap')) {
      const a = list.find((x) => x.id === f.dataset.id);
      if (a) a.caption = e.target.value;
    }
  });
  box.addEventListener('click', (e) => {
    const f = e.target.closest('.att-item');
    if (!f) return;
    if (e.target.closest('.att-x')) {
      list = list.filter((a) => a.id !== f.dataset.id);
      render();
    } else if (e.target.tagName === 'IMG') {
      openLightbox(list, list.findIndex((a) => a.id === f.dataset.id));
    }
  });

  render();
  return {
    get: () => list.map((a) => ({ ...a })),
    set: (v) => { list = Array.isArray(v) ? v.map((a) => ({ ...a })) : []; render(); },
    clear: () => { list = []; render(); },
    say,
  };
}

/* What a form says after saving, when the store would not take it */
export function saveWarning() {
  return storageOk() ? '' : ' — but this browser\'s storage was full, so the photographs were not kept.';
}

/* ---------------- Showing what is attached ---------------- */
export function attachGallery(list, opts = {}) {
  if (!list?.length) return '';
  return `<div class="att-gal${opts.small ? ' sm' : ''}">
    ${list.map((a, i) => `
      <figure data-gal="${i}" title="${esc(a.caption || a.name)}">
        <img src="${a.url}" alt="${esc(a.caption || a.name)}" loading="lazy">
        ${a.caption ? `<figcaption>${esc(a.caption)}</figcaption>` : ''}
      </figure>`).join('')}
  </div>`;
}

/* Wire a rendered gallery so a click opens it full size */
export function wireGallery(root, list) {
  const el = typeof root === 'string' ? document.getElementById(root) : root;
  el?.querySelectorAll('[data-gal]').forEach((f) => {
    f.onclick = () => openLightbox(list, Number(f.dataset.gal));
  });
}

let lb = null;
export function openLightbox(list, i = 0) {
  if (!list?.length) return;
  let at = Math.max(0, Math.min(list.length - 1, i));
  if (!lb) {
    lb = document.createElement('div');
    lb.className = 'lbox';
    lb.innerHTML = `<div class="lbox-back"></div>
      <figure><img alt=""><figcaption></figcaption></figure>
      <button class="lbox-x" aria-label="Close">×</button>
      <button class="lbox-p" aria-label="Previous">‹</button>
      <button class="lbox-n" aria-label="Next">›</button>`;
    document.body.appendChild(lb);
    lb.querySelector('.lbox-back').onclick = closeLightbox;
    lb.querySelector('.lbox-x').onclick = closeLightbox;
    document.addEventListener('keydown', (e) => {
      if (lb.hidden) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') lb.querySelector('.lbox-p').click();
      if (e.key === 'ArrowRight') lb.querySelector('.lbox-n').click();
    });
  }
  const show = () => {
    const a = list[at];
    lb.querySelector('img').src = a.url;
    lb.querySelector('figcaption').textContent =
      `${a.caption || a.name}${list.length > 1 ? `  ·  ${at + 1} of ${list.length}` : ''}`;
    lb.querySelector('.lbox-p').hidden = list.length < 2;
    lb.querySelector('.lbox-n').hidden = list.length < 2;
  };
  lb.querySelector('.lbox-p').onclick = () => { at = (at - 1 + list.length) % list.length; show(); };
  lb.querySelector('.lbox-n').onclick = () => { at = (at + 1) % list.length; show(); };
  show();
  lb.hidden = false;
  document.body.classList.add('modal-open');
}
function closeLightbox() {
  if (lb) lb.hidden = true;
  document.body.classList.remove('modal-open');
}

/* Every photograph attached to anything at one station, for the report */
export function photosAt(code, licences) {
  const out = [];
  const t = store.activeTmdl(code);
  for (const a of t?.attachments ?? []) out.push({ ...a, from: `TMDL ${t.ref}` });
  for (const r of store.readings()) {
    if (r.station !== code) continue;
    for (const a of r.attachments ?? []) out.push({ ...a, from: `Reading ${r.t}` });
  }
  for (const l of licences ?? []) {
    for (const a of l.attachments ?? []) out.push({ ...a, from: `Licence ${l.ref}` });
  }
  return out;
}
