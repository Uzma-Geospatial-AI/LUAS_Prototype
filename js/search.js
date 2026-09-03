/* ============================================================
   search.js — One search box across everything on the map

   Searches the loaded datasets first (stations, named premises, rivers,
   water bodies, drains, districts). If the local index is thin, it falls
   back to OpenStreetMap's Nominatim geocoder, bounded to the basin, so
   a plain place name like "Bandar Baru Bangi" still works.
   ============================================================ */
import { DATA, readingAt } from './data.js';
import { wqiClass } from './wqi.js';
import { sourceSwatch } from './symbols.js';
import { getMap, getMonthIdx, selectStation, highlightAt, STATION_ZOOM } from './mapview.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Fold accents and case so "Sungai Lui" matches "sungai lui" and "SG LUI". */
const norm = (s) => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const GROUPS = {
  station:  { label: 'Monitoring stations', order: 1 },
  source:   { label: 'Premises & land use', order: 2 },
  river:    { label: 'Rivers & tributaries', order: 3 },
  water:    { label: 'Water bodies', order: 4 },
  drain:    { label: 'Drains & sewerage', order: 5 },
  district: { label: 'Districts', order: 6 },
  place:    { label: 'Places (OpenStreetMap)', order: 7 },
};

/* Type weights nudge the more useful answers up when scores tie. */
const TYPE_BOOST = { station: 220, district: 130, river: 90, water: 60, drain: 45, source: 0, place: 30 };

let index = null;
let activeRows = [], activeIdx = -1, geoTimer = null, geoSeq = 0, lastQuery = '';

/* ---------------- Index ---------------- */
function bboxOf(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]);
      y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]);
    } else for (const p of c) walk(p);
  };
  walk(geom.coordinates);
  return [x0, y0, x1, y1];
}

function buildIndex() {
  const idx = [];

  for (const s of DATA.stations) {
    idx.push({
      t: 'station', label: s.name, sub: `${s.code} · ${s.river} · ${s.district}`,
      lat: s.lat, lon: s.lon, ref: s,
      hay: norm(`${s.code} ${s.name} ${s.river} ${s.district}`),
    });
  }

  for (const f of DATA.sources.features) {
    const p = f.properties;
    if (!p.name) continue;
    const cat = DATA.srcCats[p.cat];
    idx.push({
      t: 'source', label: p.name, sub: `${cat?.label ?? p.cat} · ${p.dist} m from water`,
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], ref: p,
      hay: norm(`${p.name} ${cat?.label ?? ''} ${p.district ?? ''}`),
    });
  }

  const pushLines = (fc, type, subFn) => {
    const seen = new Map();
    for (const f of fc.features) {
      const p = f.properties;
      if (!p.name) continue;
      // One entry per name; keep the longest reach as its representative
      const prev = seen.get(p.name);
      const len = f.geometry.coordinates.length;
      if (prev && prev.len >= len) continue;
      const c = f.geometry.coordinates;
      const mid = c[Math.floor(c.length / 2)];
      seen.set(p.name, {
        len,
        entry: {
          t: type, label: p.name, sub: subFn(p),
          lat: mid[1], lon: mid[0], bbox: bboxOf(f.geometry), ref: p,
          hay: norm(p.name),
        },
      });
    }
    for (const v of seen.values()) idx.push(v.entry);
  };

  pushLines(DATA.river, 'river', () => 'Main channel · Sungai Langat');
  pushLines(DATA.tributaries, 'river', (p) => `Tributary · ${p.waterway ?? 'river'}`);
  pushLines(DATA.sewerage, 'drain', (p) =>
    `${p.covered ? 'Culverted' : 'Open'} ${p.kind} · ${p.district}`);

  for (const f of DATA.waterLangat.features) {
    const p = f.properties;
    if (!p.name) continue;
    const [x0, y0, x1, y1] = bboxOf(f.geometry);
    idx.push({
      t: 'water', label: p.name, sub: `Water body · ${p.kind ?? 'water'}`,
      lat: (y0 + y1) / 2, lon: (x0 + x1) / 2, bbox: [x0, y0, x1, y1], ref: p,
      hay: norm(p.name),
    });
  }

  for (const f of DATA.districts.features) {
    const p = f.properties;
    const [x0, y0, x1, y1] = bboxOf(f.geometry);
    idx.push({
      t: 'district', label: `${p.name} district`, sub: 'Basin administrative boundary',
      lat: (y0 + y1) / 2, lon: (x0 + x1) / 2, bbox: [x0, y0, x1, y1], ref: p,
      hay: norm(p.name),
    });
  }

  return idx;
}

/* ---------------- Scoring ---------------- */
function score(entry, q) {
  const h = entry.hay;
  const i = h.indexOf(q);
  if (i < 0) return -1;
  let s;
  if (h === q) s = 1000;
  else if (i === 0) s = 600;
  else if (h[i - 1] === ' ' || h[i - 1] === '(') s = 380;
  else s = 140;
  s += TYPE_BOOST[entry.t] ?? 0;
  s -= Math.min(60, entry.label.length);        // prefer the tighter name
  return s;
}

function localSearch(q, limit = 26) {
  index ??= buildIndex();
  const hits = [];
  for (const e of index) {
    const s = score(e, q);
    if (s >= 0) hits.push({ e, s });
  }
  hits.sort((a, b) => b.s - a.s);

  /* Cap each group so 2,400 premises cannot crowd out the stations */
  const perGroup = {};
  const out = [];
  for (const { e } of hits) {
    perGroup[e.t] = (perGroup[e.t] ?? 0) + 1;
    if (perGroup[e.t] > 6) continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/* ---------------- Nominatim fallback ---------------- */
async function geocode(q, seq) {
  const qNorm = norm(q);
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5'
    + '&viewbox=101.30,3.25,102.00,2.60&bounded=1'
    + `&q=${encodeURIComponent(q)}`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return;
    const rows = await r.json();
    /* Guard on both the sequence and the live query: a response can arrive
       after the user typed something that needed no geocode at all. */
    if (seq !== geoSeq || qNorm !== lastQuery) return;
    const extra = rows.map((x) => ({
      t: 'place', label: x.name || x.display_name.split(',')[0],
      sub: x.display_name.split(',').slice(1, 4).join(',').trim(),
      lat: +x.lat, lon: +x.lon,
      bbox: x.boundingbox
        ? [+x.boundingbox[2], +x.boundingbox[0], +x.boundingbox[3], +x.boundingbox[1]]
        : null,
    }));
    if (extra.length) render(localSearch(qNorm).concat(extra), q);
  } catch {
    /* offline or rate-limited — the local results already shown still stand */
  }
}

/* ---------------- Rendering ---------------- */
const ICON = {
  station: (e) => {
    const w = readingAt(e.ref, getMonthIdx()).wqi;
    return `<span class="sr-ic" style="background:${wqiClass(w).color};color:#fff">${Math.round(w)}</span>`;
  },
  source: (e) => sourceSwatch(e.ref.cat, DATA.srcCats[e.ref.cat]?.color ?? '#5f6880', 17),
  river: () => '<span class="sr-ic sr-line" style="background:#3c8fb5"></span>',
  drain: () => '<span class="sr-ic sr-line" style="background:#8d6cd8"></span>',
  water: () => '<span class="sr-ic" style="background:#45bfe0"></span>',
  district: () => '<span class="sr-ic" style="background:#22235f;color:#fff">▣</span>',
  place: () => '<span class="sr-ic" style="background:#eef0fb;color:#22235f">◎</span>',
};

function render(results, q) {
  const box = $('searchResults');
  if (!results.length) {
    box.innerHTML = `<div class="sr-empty">Nothing matches “${esc(q)}”.<br>
      <span>Try a station, a premises, a river, or a town.</span></div>`;
    activeRows = []; activeIdx = -1;
    box.classList.add('open');
    return;
  }

  const grouped = {};
  for (const e of results) (grouped[e.t] ??= []).push(e);

  const order = Object.keys(grouped).sort(
    (a, b) => (GROUPS[a]?.order ?? 9) - (GROUPS[b]?.order ?? 9));

  let n = 0;
  box.innerHTML = order.map((t) => `
    <div class="sr-group">
      <h5>${GROUPS[t]?.label ?? t}</h5>
      ${grouped[t].map((e) => {
        const i = n++;
        return `<button class="sr-row" data-i="${i}">
          ${(ICON[t] ?? ICON.place)(e)}
          <span class="sr-txt"><b>${esc(e.label)}</b><span>${esc(e.sub)}</span></span>
        </button>`;
      }).join('')}
    </div>`).join('');

  activeRows = results;
  activeIdx = -1;
  box.classList.add('open');
  box.querySelectorAll('.sr-row').forEach((btn) => {
    btn.onclick = () => choose(activeRows[+btn.dataset.i]);
    btn.onmouseenter = () => setActive(+btn.dataset.i, false);
  });
}

function setActive(i, scroll = true) {
  const rows = $('searchResults').querySelectorAll('.sr-row');
  rows.forEach((r) => r.classList.remove('active'));
  if (i < 0 || i >= rows.length) { activeIdx = -1; return; }
  activeIdx = i;
  rows[i].classList.add('active');
  if (scroll) rows[i].scrollIntoView({ block: 'nearest' });
}

/* ---------------- Acting on a result ---------------- */
function choose(e) {
  if (!e) return;
  close();
  $('searchInput').value = e.label;

  if (e.t === 'station') {
    selectStation(e.ref, { zoom: STATION_ZOOM });
    return;
  }

  const map = getMap();
  if (e.bbox) {
    const [x0, y0, x1, y1] = e.bbox;
    const b = L.latLngBounds([y0, x0], [y1, x1]);
    /* A single short reach gives a degenerate box — fall back to a point zoom */
    if (b.getNorth() - b.getSouth() < 0.0015 && b.getEast() - b.getWest() < 0.0015) {
      map.flyTo([e.lat, e.lon], 16, { duration: 0.85 });
    } else {
      map.flyToBounds(b.pad(0.25), { duration: 0.85, maxZoom: 16 });
    }
  } else {
    map.flyTo([e.lat, e.lon], e.t === 'source' ? 17 : 15, { duration: 0.85 });
  }

  highlightAt(e.lat, e.lon, `<div class="pop"><div class="pt">${esc(e.label)}</div>
    <div class="ps">${esc(e.sub)}</div></div>`);
}

/* ---------------- Open / close ---------------- */
function close() {
  $('searchResults').classList.remove('open');
  activeIdx = -1;
}

function run(raw) {
  const q = norm(raw.trim());
  lastQuery = q;
  if (q.length < 2) {
    close();
    return;
  }
  const local = localSearch(q);
  render(local, raw.trim());

  clearTimeout(geoTimer);
  if (local.length < 6 && q.length >= 3) {
    const seq = ++geoSeq;
    geoTimer = setTimeout(() => { if (lastQuery === q) geocode(raw.trim(), seq); }, 450);
  }
}

export function initSearch() {
  const input = $('searchInput');

  input.addEventListener('input', () => run(input.value));
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) run(input.value); });

  input.addEventListener('keydown', (ev) => {
    const rows = $('searchResults').querySelectorAll('.sr-row');
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setActive(activeIdx + 1 >= rows.length ? 0 : activeIdx + 1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setActive(activeIdx <= 0 ? rows.length - 1 : activeIdx - 1);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      choose(activeRows[activeIdx >= 0 ? activeIdx : 0]);
    } else if (ev.key === 'Escape') {
      close();
      input.blur();
    }
  });

  $('searchClear').onclick = () => {
    input.value = '';
    close();
    input.focus();
  };

  const wrap = $('searchBox');
  wrap.addEventListener('click', (ev) => ev.stopPropagation());
  L.DomEvent.disableClickPropagation(wrap);
  L.DomEvent.disableScrollPropagation(wrap);
  document.addEventListener('click', close);
  getMap().on('click', close);

  /* "/" focuses the search from anywhere on the map view */
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== '/' || ev.target.matches('input, textarea, select')) return;
    if (!document.getElementById('v-map').classList.contains('active')) return;
    ev.preventDefault();
    input.focus();
    input.select();
  });
}

/* The station WQI chips in results go stale when the month changes */
export function refreshSearchIcons() {
  if (lastQuery.length >= 2 && $('searchResults').classList.contains('open')) {
    run($('searchInput').value);
  }
}
