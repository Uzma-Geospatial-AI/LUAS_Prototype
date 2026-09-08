/* ============================================================
   around.js — What is around a station

   Pick a distance and see what sits within it: the premises the map
   already carries, the water it would discharge into, and the other
   stations that would see it. The register decides which premises are
   licensed, so the panel says at a glance how much of what is nearby is
   accounted for.

       TWO SOURCES, SAID APART

   The premises come from the bundled point-source file: industry, sewage
   and water treatment, landfill and quarry, construction, farms — the
   things a pollution-source survey looks for. Shops, workshops, car washes
   and restaurants are not in it, and they matter: a row of car repair
   shops discharges oil and grease to the same drain as a factory.

   So there is a second, opt-in lookup that asks OpenStreetMap for them
   live. It is behind a button because it is a network call to a service
   this site does not control, it is not part of the record, and the page
   has to work without it. What comes back is labelled as looked up rather
   than surveyed, and is never written into the register.
   ============================================================ */
import { DATA, sourceSummary, licencesAt, WATER_GROUPS } from './data.js';
import { licenceStatus } from './licenceStatus.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = (n, d = 0) => Number(n).toLocaleString('en-MY',
  { minimumFractionDigits: d, maximumFractionDigits: d });

export const RADII = [500, 1000, 1500, 2000, 3000, 5000, 10000];
let radius = 1000;
let showAll = false;

/* Metres between two points, and the compass point one lies on from the
   other. Good to a metre or two at this latitude, which is finer than the
   positions themselves. */
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
export function metresBetween(aLat, aLon, bLat, bLon) {
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon) * Math.cos(rad((aLat + bLat) / 2));
  return Math.hypot(dLat, dLon) * R;
}
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compass(aLat, aLon, bLat, bLon) {
  const y = (bLon - aLon) * Math.cos(rad((aLat + bLat) / 2));
  const x = bLat - aLat;
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return POINTS[Math.round(((deg + 360) % 360) / 45) % 8];
}
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const fmtRadius = (m) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);

/* Whatever is opened from this panel is shown inside the ring it was found
   within, so the distance that was asked for is on the map too. */
const showOn = (st, at, srcId = null) => document.dispatchEvent(new CustomEvent('showonmap', {
  detail: {
    around: {
      from: { lat: st.lat, lon: st.lon, label: st.name },
      radius, radiusLabel: fmtRadius(radius), srcId,
      at: { ...at, note: `${fmtDist(at.d)} ${at.dir} of ${st.name}` },
    },
  },
}));

/* ============================================================
   What the bundled map already carries, within the radius
   ============================================================ */
export function around(st, m = radius) {
  const su = sourceSummary();
  const cats = su.cats ?? {};

  const premises = [];
  for (const f of su.features ?? []) {
    const [lon, lat] = f.geometry.coordinates;
    const d = metresBetween(st.lat, st.lon, lat, lon);
    if (d > m) continue;
    const p = f.properties;
    premises.push({
      id: p.id, name: p.name, cat: p.cat, catLabel: cats[p.cat]?.label ?? p.cat,
      colour: cats[p.cat]?.color ?? '#5c6480', risk: p.risk, toWater: p.dist,
      lat, lon, d, dir: compass(st.lat, st.lon, lat, lon),
      licensed: licenceStatus(p.id).licensed,
    });
  }
  premises.sort((a, b) => a.d - b.d);

  const byCat = {};
  for (const p of premises) {
    (byCat[p.cat] ??= { cat: p.cat, label: p.catLabel, colour: p.colour, n: 0, licensed: 0, nearest: null })
      .n += 1;
    if (p.licensed) byCat[p.cat].licensed += 1;
    byCat[p.cat].nearest ??= p;
  }

  const water = [];
  for (const b of DATA.water?.bodies ?? []) {
    const d = metresBetween(st.lat, st.lon, b.lat, b.lon);
    if (d <= m) water.push({ ...b, d });
  }
  const stations = DATA.stations
    .filter((s) => s.code !== st.code)
    .map((s) => ({ s, d: metresBetween(st.lat, st.lon, s.lat, s.lon) }))
    .filter((x) => x.d <= m)
    .sort((a, b) => a.d - b.d);

  const licences = licencesAt(st.code)
    .filter((l) => typeof l.lat === 'number'
      && metresBetween(st.lat, st.lon, l.lat, l.lon) <= m);

  return {
    radius: m,
    premises,
    byCat: Object.values(byCat).sort((a, b) => b.n - a.n),
    licensed: premises.filter((p) => p.licensed).length,
    water: water.sort((a, b) => a.d - b.d),
    waterArea: water.reduce((t, b) => t + (b.area_m2 || 0), 0),
    stations,
    licences,
  };
}

/* ============================================================
   Shops and businesses, looked up live
   ============================================================ */
const OVERPASS = 'https://overpass-api.de/api/interpreter';
/* Grouped by what they put down a drain rather than by OSM's own tagging:
   a tyre shop and a car wash belong together whatever the tag says. */
const GROUPS = [
  { id: 'vehicle', label: 'Vehicles, fuel & workshops', colour: '#4a3aa7',
    note: 'Oil, grease and detergent to the drain',
    is: (k) => /^(car_repair|car_parts|tyres|motorcycle|car|truck|fuel|car_wash|motorcycle_repair|agrarian|trade)$/.test(k) },
  { id: 'food', label: 'Food, drink & markets', colour: '#ef7d1a',
    note: 'Grease, organic load and washwater',
    is: (k) => /^(restaurant|fast_food|cafe|food_court|bar|pub|marketplace|butcher|seafood|bakery|deli|greengrocer)$/.test(k) },
  { id: 'shop', label: 'Shops', colour: '#0aa3d9',
    note: 'General retail',
    is: (k, t) => !!t.shop },
  { id: 'service', label: 'Services, crafts & offices', colour: '#2a78d6',
    note: 'Laundries, printers, workshops',
    is: (k, t) => !!t.craft || !!t.office || /^(laundry|dry_cleaning|bank|veterinary)$/.test(k) },
  { id: 'public', label: 'Schools, clinics & community', colour: '#17a04a',
    note: 'Sewage to the public system, where there is one',
    is: (k) => /^(school|kindergarten|college|university|hospital|clinic|doctors|place_of_worship|community_centre)$/.test(k) },
];
const AMENITIES = 'restaurant|fast_food|cafe|food_court|bar|pub|marketplace|fuel|car_wash|'
  + 'laundry|dry_cleaning|bank|veterinary|school|kindergarten|college|university|hospital|'
  + 'clinic|doctors|place_of_worship|community_centre';

const cache = new Map();
const kindOf = (t) => t.shop || t.amenity || t.craft || t.office || 'place';
const pretty = (k) => String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export async function lookupPlaces(st, m) {
  const key = `${st.lat.toFixed(5)},${st.lon.toFixed(5)}:${m}`;
  if (cache.has(key)) return cache.get(key);
  const at = `(around:${m},${st.lat},${st.lon})`;
  const q = `[out:json][timeout:50];(nwr${at}[shop];nwr${at}[craft];nwr${at}[office];`
    + `nwr${at}[amenity~"^(${AMENITIES})$"];);out center tags;`;

  const ctl = new AbortController();
  const bell = setTimeout(() => ctl.abort(), 60000);
  let json;
  try {
    const res = await fetch(OVERPASS, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: q }),
    });
    if (!res.ok) throw new Error(res.status === 429 || res.status === 504
      ? 'OpenStreetMap is busy — try again in a moment' : `OpenStreetMap answered HTTP ${res.status}`);
    json = await res.json();
  } finally { clearTimeout(bell); }

  const out = [];
  for (const el of json.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const t = el.tags ?? {};
    const kind = kindOf(t);
    const g = GROUPS.find((x) => x.is(kind, t)) ?? GROUPS[2];
    out.push({
      id: `${el.type}/${el.id}`,
      name: t.name || t.operator || t['name:en'] || null,
      kind: kind === 'yes' ? pretty(t.shop ? 'shop' : kind) : pretty(kind),
      group: g.id, lat, lon,
      d: metresBetween(st.lat, st.lon, lat, lon),
      dir: compass(st.lat, st.lon, lat, lon),
    });
  }
  out.sort((a, b) => a.d - b.d);
  cache.set(key, out);
  return out;
}

/* ============================================================
   The panel
   ============================================================ */
export function renderAround(st) {
  const box = $('p1Around');
  if (!box || !st) return;
  const a = around(st, radius);
  const within = fmtRadius(radius);
  const shown = showAll ? a.premises : a.premises.slice(0, 12);

  box.innerHTML = `
    <div class="section-title">
      <h2>What is around this station</h2>
      <span class="st-sub">Everything the map carries within <b>${within}</b> of ${esc(st.name)}
        <button type="button" class="tipmark" tabindex="0" data-tip="Straight-line distance from the station. The premises are the bundled point-source survey: industry, sewage and water treatment, landfill and quarry, construction, farms. Shops and workshops are not in that survey — look them up separately below." aria-label="Straight-line distance from the station, over the bundled point-source survey.">i</button></span>
      <div class="rad-pick" role="group" aria-label="Distance from the station">
        ${RADII.map((r) => `<button class="mc-btn sm${r === radius ? ' active' : ''}" data-rad="${r}">${fmtRadius(r)}</button>`).join('')}
      </div>
    </div>

    <div class="grid three ar-kpis">
      <div class="card kpi">
        <div class="k-lab">Premises on the map</div>
        <div class="k-val">${nf(a.premises.length)}</div>
        <div class="k-sub">${a.licensed} licensed · ${a.premises.length - a.licensed} without a licence</div>
        <div class="k-note">Within ${within} of the station</div>
      </div>
      <div class="card kpi">
        <div class="k-lab">Water it can reach</div>
        <div class="k-val">${nf(a.water.length)}</div>
        <div class="k-sub">${(a.waterArea / 1e4).toFixed(1)} ha of open water</div>
        <div class="k-note">Ponds, basins and lakes within ${within}</div>
      </div>
      <div class="card kpi">
        <div class="k-lab">Other stations near by</div>
        <div class="k-val">${nf(a.stations.length)}</div>
        <div class="k-sub">${a.stations.length
          ? a.stations.slice(0, 2).map((x) => `${esc(x.s.code)} at ${fmtDist(x.d)}`).join(' · ')
          : 'None within ' + within}</div>
        <div class="k-note">The next station that would see a discharge here</div>
      </div>
    </div>

    ${a.byCat.length ? `<div class="ar-cats">
      ${a.byCat.map((c) => `
        <div class="ar-cat" style="--ac:${c.colour}">
          <div class="ar-cat-n">${c.n}</div>
          <div class="ar-cat-b">
            <b>${esc(c.label)}</b>
            <span>${c.licensed} licensed · nearest ${fmtDist(c.nearest.d)} ${c.nearest.dir}</span>
          </div>
        </div>`).join('')}
    </div>` : ''}

    ${a.premises.length ? `
      <div class="card pad0 tbl-scroll" style="margin-top:12px">
        <table class="data">
          <thead><tr>
            <th>Premises</th><th>Kind</th><th class="num">From the station</th>
            <th class="num">From water</th><th class="num">Screening risk</th><th>Licence</th><th></th>
          </tr></thead>
          <tbody>${shown.map((p) => `
            <tr>
              <td><b>${p.name ? esc(p.name) : `Unnamed ${esc(p.catLabel.toLowerCase())} site`}</b></td>
              <td><span class="ar-dot" style="background:${p.colour}"></span>${esc(p.catLabel)}</td>
              <td class="num">${fmtDist(p.d)} <span class="sub-inline">${p.dir}</span></td>
              <td class="num">${p.toWater != null ? `${nf(p.toWater)} m` : '—'}</td>
              <td class="num">${p.risk != null ? p.risk.toFixed(2) : '—'}</td>
              <td>${p.licensed
                ? '<span class="pill-status st-pass">Licensed</span>'
                : '<span class="pill-status st-fail">No licence</span>'}</td>
              <td class="act"><button class="mini" data-prem="${p.id}"
                data-lat="${p.lat}" data-lon="${p.lon}" data-d="${Math.round(p.d)}" data-dir="${p.dir}"
                data-label="${p.name ? esc(p.name) : `Unnamed ${esc(p.catLabel.toLowerCase())} site`}"
                title="Show it on the map, inside the ${fmtRadius(radius)} ring">Map</button></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
      ${a.premises.length > 12 ? `<div class="btn-row" style="margin-top:10px">
        <button class="btn btn-ghost" id="arMore">${showAll
          ? 'Show the twelve nearest only'
          : `Show all ${a.premises.length} within ${within}`}</button></div>` : ''}
    ` : `<div class="card" style="margin-top:12px"><div class="empty-row">
        No surveyed premises within ${within} of this station. Try a wider distance.</div></div>`}

    <div class="section-title" style="margin-top:22px">
      <h2>Shops and businesses</h2>
      <span class="st-sub">Not in the survey — looked up from OpenStreetMap when you ask
        <button type="button" class="tipmark" tabindex="0" data-tip="The bundled survey covers industry, sewage, waste, construction and farms. Shops, workshops, car washes and restaurants are not in it, and they discharge to the same drains. This asks OpenStreetMap for them live. It is a lookup, not a record: nothing here is written into the register." aria-label="A live lookup from OpenStreetMap. It is not part of the record and is never written into the register.">i</button></span>
    </div>
    <div class="card">
      <div class="btn-row" style="margin-top:0">
        <button class="btn btn-primary" id="arLookup">Look up what is within ${within}</button>
        <span class="hint" id="arHint">OpenStreetMap, live. Shops, workshops, food, services and
          community places.${radius >= 5000 ? ' A wide search takes a few seconds.' : ''}</span>
      </div>
      <div id="arPlaces"></div>
    </div>`;

  box.querySelectorAll('[data-rad]').forEach((b) => {
    b.onclick = () => { radius = Number(b.dataset.rad); showAll = false; renderAround(st); };
  });
  const more = $('arMore');
  if (more) more.onclick = () => { showAll = !showAll; renderAround(st); };
  box.querySelectorAll('[data-prem]').forEach((b) => {
    b.onclick = () => showOn(st, {
      lat: Number(b.dataset.lat), lon: Number(b.dataset.lon),
      label: b.dataset.label, d: Number(b.dataset.d), dir: b.dataset.dir,
    }, Number(b.dataset.prem));
  });
  $('arLookup').onclick = () => runLookup(st);

  /* A lookup already made for this station and distance comes straight back */
  const key = `${st.lat.toFixed(5)},${st.lon.toFixed(5)}:${radius}`;
  if (cache.has(key)) renderPlaces(st, cache.get(key));
}

async function runLookup(st) {
  const btn = $('arLookup');
  const hint = $('arHint');
  btn.disabled = true;
  hint.textContent = 'Asking OpenStreetMap…';
  hint.className = 'hint';
  try {
    const list = await lookupPlaces(st, radius);
    hint.textContent = `${list.length} found within ${fmtRadius(radius)} · OpenStreetMap contributors`;
    hint.className = 'hint ok';
    renderPlaces(st, list);
  } catch (e) {
    hint.textContent = e.name === 'AbortError'
      ? 'OpenStreetMap did not answer in time. It is a public service and can be busy; try again in a moment.'
      : `Could not look it up: ${e.message}.`;
    hint.className = 'hint err';
  } finally { btn.disabled = false; }
}

function renderPlaces(st, list) {
  const box = $('arPlaces');
  if (!box) return;
  if (!list.length) {
    box.innerHTML = `<div class="empty-row">OpenStreetMap has nothing mapped within
      ${fmtRadius(radius)} of this station.</div>`;
    return;
  }
  const byGroup = GROUPS.map((g) => ({ ...g, list: list.filter((p) => p.group === g.id) }))
    .filter((g) => g.list.length);

  box.innerHTML = `
    <div class="ar-cats" style="margin-top:12px">
      ${byGroup.map((g) => `
        <div class="ar-cat" style="--ac:${g.colour}">
          <div class="ar-cat-n">${g.list.length}</div>
          <div class="ar-cat-b"><b>${esc(g.label)}</b><span>${esc(g.note)}</span></div>
        </div>`).join('')}
    </div>
    ${byGroup.map((g) => `
      <h4 class="ar-h">${esc(g.label)} <span>${g.list.length}</span></h4>
      <div class="ar-places">
        ${g.list.slice(0, 40).map((p) => `
          <button class="ar-place" data-lat="${p.lat}" data-lon="${p.lon}"
            data-label="${esc(p.name || p.kind)}" data-d="${Math.round(p.d)}" data-dir="${p.dir}"
            title="${esc(p.name || p.kind)} · ${esc(p.kind)} · ${fmtDist(p.d)} ${p.dir} of the station — show it on the map, inside the ${fmtRadius(radius)} ring">
            <span class="ar-dot" style="background:${g.colour}"></span>
            <span class="ar-place-n">${p.name ? esc(p.name) : `<i>${esc(p.kind)}</i>`}</span>
            <span class="ar-place-k">${esc(p.kind)}</span>
            <span class="ar-place-d">${fmtDist(p.d)} ${p.dir}</span>
          </button>`).join('')}
      </div>
      ${g.list.length > 40 ? `<div class="hint">and ${g.list.length - 40} more</div>` : ''}`).join('')}
    <div class="hint" style="margin-top:10px">Looked up from OpenStreetMap, © OpenStreetMap
      contributors, ODbL. A lookup, not part of the record: nothing here is written into the
      licence register.</div>`;

  box.querySelectorAll('.ar-place').forEach((b) => {
    b.onclick = () => showOn(st, {
      lat: Number(b.dataset.lat), lon: Number(b.dataset.lon),
      label: b.dataset.label, d: Number(b.dataset.d), dir: b.dataset.dir,
    });
  });
}
