/* ============================================================
   firebase.js — Reading the datasets from the Realtime Database

   The eight datasets live in the Firebase Realtime Database, one node each
   under /luas, written by scripts/10_push_to_firebase.py. This module reads
   them back over the REST interface. No SDK: a node is one GET returning
   JSON, which is all this needs, and pulling in the Firebase client library
   would cost more bytes than the data it fetches.

       THE FILES IN data/ ARE STILL THE FALLBACK

   Every node falls back to the bundled file of the same content if the
   database cannot answer for it — rules closed, node missing, network gone.
   The site is deployed as static files on GitHub Pages, so those files are
   already there and already cached; keeping them as the fallback means a
   database that is unreachable, or has not been loaded yet, degrades to the
   site working exactly as it did before rather than to a blank page.

   Which one actually served the data is recorded in SOURCE and shown in the
   app bar, because "where did this number come from" is not a question a
   reader should have to open the network tab to answer.

       WRITING

   Nothing here writes. A database a public page can write to is a database
   anyone who reads the page source can write to, and this one is on a
   government portal. The upload runs from the ETL with a credential; the
   browser only ever reads.
   ============================================================ */

export const FB = {
  db: 'https://luas-demo-website-default-rtdb.asia-southeast1.firebasedatabase.app',
  root: 'luas',
  enabled: true,
  /* One short probe decides for all eight, so a closed or unreachable
     database costs one timeout rather than eight. */
  probeMs: 3500,
  nodeMs: 20000,
};

/* What the app bar reports. `from` is set once loading is done. */
export const SOURCE = {
  from: 'files',        // 'database' | 'files' | 'mixed'
  fellBack: [],         // nodes the database could not answer for
  written: null,        // when the database was last written, from /luas/meta
  reason: '',           // why the database was not used, when it was not
};

function get(path, ms) {
  const url = `${FB.db}/${path}.json`;
  const ctl = new AbortController();
  const bell = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { signal: ctl.signal })
    .then((r) => {
      if (r.status === 401) throw new Error('rules closed');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .finally(() => clearTimeout(bell));
}

/* Is the database readable, and does it hold anything? A node that has never
   been written comes back as 200 with a body of `null`, which is not an
   error and must not be treated as data. */
export async function probe() {
  if (!FB.enabled) { SOURCE.reason = 'switched off in js/firebase.js'; return false; }
  try {
    const meta = await get(`${FB.root}/meta`, FB.probeMs);
    if (meta == null) { SOURCE.reason = 'database is empty — run scripts/10'; return false; }
    SOURCE.written = meta.written ?? null;
    return true;
  } catch (e) {
    SOURCE.reason = e.name === 'AbortError' ? 'database did not answer in time'
      : `database unavailable (${e.message})`;
    return false;
  }
}

export async function readNode(name) {
  const d = await get(`${FB.root}/${name}`, FB.nodeMs);
  if (d == null) throw new Error(`node ${name} is empty`);
  return d;
}

/* One line saying where the data came from, for the app bar. */
export function sourceLabel() {
  if (SOURCE.from === 'database') {
    return `Firebase${SOURCE.written ? ` · written ${SOURCE.written.replace('T', ' ')}` : ''}`;
  }
  if (SOURCE.from === 'mixed') {
    return `Firebase · ${SOURCE.fellBack.length} node(s) from bundled files`;
  }
  return `bundled files${SOURCE.reason ? ` · ${SOURCE.reason}` : ''}`;
}
