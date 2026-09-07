/* ============================================================
   report.js — Export a report for one location, with the map

   From Tools: pick a location, pick the sections, and get a self-contained
   HTML report — the station's assessment, its monitoring record, the TMDL
   on record and the licences counting at it — with the map captured around
   the station as a picture, and a JSON pack of the same figures.

   The picture is drawn here, not screenshotted: basemap tiles are fetched
   for the box around the station, then the catchment edge, the water
   bodies, the rivers, the premises coloured by licence status and the
   stations are drawn onto one canvas. Nothing depends on the map view
   being open, and the report opens the same on any machine.
   ============================================================ */
import {
  DATA, readingAt, latestIdx, complianceRecord, licencesAt, fmtMonth, WATER_GROUPS,
  sourceSummary, flowBasis,
} from './data.js';
import { PARAM_META, INWQS, wqiClass, classCompliance, checkStandard, WEIGHTS } from './wqi.js';
import {
  budgetAll, headroom, headroomInPE, licenceLoads, licenceCompliance, EFFLUENT_STANDARDS,
  fmtLoad, fmtVol, RIVER_FACTOR,
} from './loads.js';
import { store, download } from './store.js';
import { licenceStatus } from './licenceStatus.js';
import { kindLabel } from './locations.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = (n, d = 0) => (Number.isFinite(Number(n))
  ? Number(n).toLocaleString('en-MY', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const today = () => new Date().toISOString().slice(0, 10);

/* ============================================================
   The map, drawn
   ============================================================ */
const BASES = {
  imagery: {
    label: 'Satellite imagery',
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    credit: 'Imagery: Esri, Maxar, Earthstar Geographics',
  },
  street: {
    label: 'Street map',
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    credit: '© OpenStreetMap contributors',
  },
};

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => res(i);
    i.onerror = () => rej(new Error(src));
    i.src = src;
  });
}

/* Web Mercator at one zoom, in pixels; the box is centred on the station */
export async function captureMap(st, opts = {}) {
  const { base = 'imagery', zoom = 14, w = 1000, h = 600 } = opts;
  const B = BASES[base] ?? BASES.imagery;
  const z = zoom;
  const n = 2 ** z * 256;
  const proj = (lat, lon) => {
    const r = (lat * Math.PI) / 180;
    return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
  };
  const unproj = (x, y) => {
    const lon = (x / n) * 360 - 180;
    const yy = Math.PI - (2 * Math.PI * y) / n;
    return [(180 / Math.PI) * Math.atan(0.5 * (Math.exp(yy) - Math.exp(-yy))), lon];
  };
  const [cx, cy] = proj(st.lat, st.lon);
  const left = cx - w / 2, top = cy - h / 2;
  const px = (lat, lon) => { const [x, y] = proj(lat, lon); return [x - left, y - top]; };
  const [latN, lonW] = unproj(left, top);
  const [latS, lonE] = unproj(left + w, top + h);
  const inView = (lat, lon, pad = 0.005) =>
    lat <= latN + pad && lat >= latS - pad && lon >= lonW - pad && lon <= lonE + pad;

  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#dfe6ee';
  ctx.fillRect(0, 0, w, h);

  /* Tiles first, all of them, before anything is drawn over them */
  const jobs = [];
  for (let tx = Math.floor(left / 256); tx <= Math.floor((left + w) / 256); tx++) {
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + h) / 256); ty++) {
      if (ty < 0 || ty >= 2 ** z) continue;
      const wrap = ((tx % 2 ** z) + 2 ** z) % 2 ** z;
      jobs.push(loadImage(B.url(z, wrap, ty))
        .then((img) => ctx.drawImage(img, tx * 256 - left, ty * 256 - top))
        .catch(() => {}));
    }
  }
  await Promise.all(jobs);

  const path = (ring) => {
    ctx.beginPath();
    ring.forEach(([lon, lat], i) => { const [x, y] = px(lat, lon); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  };
  const rings = (geom) => (geom.type === 'Polygon' ? [geom.coordinates[0]]
    : geom.type === 'MultiPolygon' ? geom.coordinates.map((p) => p[0]) : []);
  const touches = (coords) => coords.some(([lon, lat]) => inView(lat, lon, 0.02));

  /* The catchment edge */
  for (const f of DATA.catchment?.features ?? []) {
    for (const ring of rings(f.geometry)) {
      if (!touches(ring)) continue;
      path(ring);
      ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.strokeStyle = '#f2c40c'; ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /* Water bodies, coloured by type */
  for (const f of DATA.water?.geo?.features ?? []) {
    const p = f.properties;
    if (!inView(p.lat, p.lon, 0.02)) continue;
    const g = WATER_GROUPS[p.group] ?? WATER_GROUPS.other;
    for (const ring of rings(f.geometry)) {
      path(ring); ctx.closePath();
      ctx.fillStyle = `${g.color}80`; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    }
  }

  /* The rivers, the main channel heavier, with a white halo so they read on imagery */
  for (const f of DATA.rivers?.features ?? []) {
    const c = f.geometry.coordinates;
    if (!touches(c)) continue;
    const main = !!f.properties.main;
    path(c);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = main ? 5 : 3.2; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
    ctx.lineWidth = main ? 3 : 1.6; ctx.strokeStyle = main ? '#0aa3d9' : '#45bfe0'; ctx.stroke();
  }

  /* Premises, coloured by licence status the way the map colours them */
  const su = sourceSummary();
  for (const f of su.features ?? []) {
    const [lon, lat] = f.geometry.coordinates;
    if (!inView(lat, lon)) continue;
    const [x, y] = px(lat, lon);
    ctx.beginPath(); ctx.arc(x, y, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = licenceStatus(f.properties.id).licensed ? '#17a04a' : '#d92d20'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
  /* Licences entered at a new location, with no premises symbol of their own */
  for (const l of store.licences()) {
    if (l.srcId != null || typeof l.lat !== 'number' || !inView(l.lat, l.lon)) continue;
    const [x, y] = px(l.lat, l.lon);
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#4a3aa7'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
  }

  /* The other stations in view, small; this one, large and named */
  const idx = latestIdx();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const s of DATA.stations) {
    if (s.code === st.code || !inView(s.lat, s.lon)) continue;
    const r = readingAt(s, idx);
    const [x, y] = px(s.lat, s.lon);
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = r ? wqiClass(r.wqi).color : '#8b93a8'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    label(ctx, s.code, x, y + 18, '600 11px system-ui, sans-serif');
  }
  {
    const r = readingAt(st, idx);
    const [x, y] = px(st.lat, st.lon);
    ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fillStyle = r ? wqiClass(r.wqi).color : '#8b93a8'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '700 12px ui-monospace, monospace';
    ctx.fillText(r ? String(Math.round(r.wqi)) : '–', x, y + 0.5);
    label(ctx, `${st.code} · ${st.name}`, x, y + 32, '700 12.5px system-ui, sans-serif');
  }

  /* Title, scale, north, credit */
  box(ctx, 12, 12, `${st.code} · ${st.name}`, `${st.river} · ${st.district} · ${st.lat.toFixed(5)}, ${st.lon.toFixed(5)} · zoom ${z}`);
  const mpp = (156543.03392 * Math.cos((st.lat * Math.PI) / 180)) / 2 ** z;
  const len = [50, 100, 200, 500, 1000, 2000, 5000].filter((m) => m / mpp <= 170).pop() ?? 50;
  const sx = 16, sy = h - 22, sw = len / mpp;
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(sx - 6, sy - 16, sw + 12, 26);
  ctx.fillStyle = '#16173f'; ctx.fillRect(sx, sy, sw, 4);
  ctx.fillRect(sx, sy - 6, 2, 10); ctx.fillRect(sx + sw - 2, sy - 6, 2, 10);
  ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, sx, sy - 9);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(w - 40, 12, 28, 40);
  ctx.fillStyle = '#16173f'; ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillText('N', w - 26, 22);
  ctx.beginPath(); ctx.moveTo(w - 26, 28); ctx.lineTo(w - 32, 46); ctx.lineTo(w - 26, 41); ctx.lineTo(w - 20, 46); ctx.closePath(); ctx.fill();
  ctx.font = '500 10px system-ui, sans-serif'; ctx.textAlign = 'right';
  const cw = ctx.measureText(B.credit).width + 12;
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(w - cw - 8, h - 22, cw, 16);
  ctx.fillStyle = '#3b4257'; ctx.fillText(B.credit, w - 14, h - 14);

  let url;
  try { url = cv.toDataURL('image/png'); } catch { return null; }   /* a tainted canvas cannot be read */
  return { url, credit: B.credit, base: B.label, zoom: z, w, h, scale: `${len >= 1000 ? `${len / 1000} km` : `${len} m`}` };
}

function label(ctx, text, x, y, font) {
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width + 12;
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.fillRect(x - tw / 2, y - 9, tw, 18);
  ctx.fillStyle = '#16173f';
  ctx.fillText(text, x, y + 0.5);
}
function box(ctx, x, y, title, sub) {
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = '700 13px system-ui, sans-serif';
  const w1 = ctx.measureText(title).width;
  ctx.font = '500 10.5px system-ui, sans-serif';
  const w2 = ctx.measureText(sub).width;
  const bw = Math.max(w1, w2) + 20;
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(x, y, bw, 40);
  ctx.fillStyle = '#16173f'; ctx.font = '700 13px system-ui, sans-serif'; ctx.fillText(title, x + 10, y + 13);
  ctx.fillStyle = '#3b4257'; ctx.font = '500 10.5px system-ui, sans-serif'; ctx.fillText(sub, x + 10, y + 29);
}

/* ============================================================
   The figures for one location, gathered once for both formats
   ============================================================ */
function gather(st) {
  const tmdl = store.activeTmdl(st.code);
  const target = tmdl?.targetClass ?? 'II';
  const latest = readingAt(st, latestIdx());
  const rec = complianceRecord(st, target);
  const here = licencesAt(st.code);
  const reading = {};
  for (const p of ['do', 'bod', 'cod', 'ss', 'an', 'ph']) {
    const vals = st.wqiSeries.slice(-12).map((r) => r.raw[p]).sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    reading[p] = !vals.length ? 0 : vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }
  const budgets = budgetAll(reading, here, tmdl);
  const head = headroom(budgets, 'A');
  return { st, tmdl, target, latest, rec, here, budgets, head, reading };
}

/* ============================================================
   The report
   ============================================================ */
const CSS = `
  body{font:13px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2030;margin:0;background:#f4f6fa}
  .page{max-width:1040px;margin:0 auto;padding:28px 32px 48px;background:#fff}
  h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;padding-bottom:6px;border-bottom:2px solid #e2e6ef}
  h3{font-size:13px;margin:16px 0 6px}
  .sub{color:#5f6880;font-size:12.5px}.meta{display:flex;gap:18px;flex-wrap:wrap;margin:10px 0 0;font-size:12px;color:#5f6880}
  .meta b{color:#1c2030}
  table{width:100%;border-collapse:collapse;font-size:12px;margin:6px 0 10px}
  th,td{padding:6px 9px;border:1px solid #e2e6ef;text-align:left;vertical-align:top}
  th{background:#f4f6fa;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#5f6880}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .ok{color:#0d7a3f;font-weight:600}.bad{color:#b42318;font-weight:600}.warn{color:#b54708;font-weight:600}.mut{color:#8b93a8}
  .verdict{padding:12px 14px;border-left:4px solid;border-radius:6px;margin:8px 0 12px;background:#fafbfd}
  .verdict.ok{border-color:#17a04a}.verdict.bad{border-color:#d92d20}.verdict.warn{border-color:#ef7d1a}
  .verdict b{font-size:15px;display:block;margin-bottom:2px}
  figure{margin:10px 0 0}figure img{width:100%;height:auto;border:1px solid #e2e6ef;border-radius:6px}
  figcaption{font-size:11px;color:#5f6880;margin-top:5px}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:8px 0 6px}
  .kpi{border:1px solid #e2e6ef;border-radius:8px;padding:10px 12px}.kpi .l{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#5f6880}
  .kpi .v{font-size:22px;font-weight:700;margin:2px 0}.kpi .s{font-size:11.5px;color:#5f6880}
  .note{font-size:11.5px;color:#5f6880;background:#fff8e8;border:1px solid #f6e0a8;border-radius:6px;padding:9px 12px;margin:12px 0}
  .foot{margin-top:28px;padding-top:12px;border-top:1px solid #e2e6ef;font-size:11px;color:#8b93a8}
  .bar{position:sticky;top:0;background:#16173f;color:#fff;padding:10px 32px;display:flex;gap:12px;align-items:center;font-size:12.5px}
  .bar button{margin-left:auto;background:#00b4d8;color:#fff;border:0;border-radius:6px;padding:7px 14px;font:600 12.5px system-ui,sans-serif;cursor:pointer}
  @media print{.bar{display:none}.page{padding:0;max-width:none}h2{break-after:avoid}table,figure,.verdict,.kpis{break-inside:avoid}}
`;

const fmtVal = (p, v) => (v == null ? '—' : p === 'an' ? v.toFixed(3) : p === 'ph' || p === 'do' || p === 'bod' ? v.toFixed(2) : v.toFixed(1));

function sectionStation(g) {
  const { st, target, latest, rec } = g;
  if (!latest) {
    return `<h2>Station assessment</h2>
      <div class="verdict warn"><b>No reading at this station yet</b>
      Nothing has been sampled here. Readings saved from the Station Assessment calculator become its record.</div>`;
  }
  const cls = wqiClass(latest.wqi);
  const comp = classCompliance(latest.raw, target);
  const failing = Object.entries(comp.checks).filter(([, c]) => c.pass === false).map(([p]) => PARAM_META[p].short);
  const worst = Object.entries(rec.byParam).sort((a, b) => b[1].rate - a[1].rate)[0];
  const last12 = st.wqiSeries.slice(-12).reverse();
  return `<h2>Station assessment</h2>
    <div class="sub">Latest reading · ${fmtMonth(latest.t)} · against INWQS Class ${target}</div>
    <div class="verdict ${comp.pass ? 'ok' : 'bad'}"><b>${comp.pass ? `Meets Class ${target}` : `Does not meet Class ${target}`}</b>
      ${comp.pass ? 'All six INWQS ambient standards are satisfied at this station.'
        : `${comp.failed} of 6 parameters exceed the Class ${target} standard: ${failing.join(', ')}.`}</div>
    <div class="kpis">
      <div class="kpi"><div class="l">Water Quality Index</div><div class="v" style="color:${cls.color}">${latest.wqi.toFixed(1)}</div><div class="s">${cls.label} — ${cls.status}</div></div>
      <div class="kpi"><div class="l">Months meeting Class ${target}</div><div class="v">${(rec.rate * 100).toFixed(0)}%</div><div class="s">${rec.passing} of ${rec.total} records</div></div>
      <div class="kpi"><div class="l">Binding parameter</div><div class="v">${worst && worst[1].rate > 0 ? PARAM_META[worst[0]].short : 'None'}</div>
        <div class="s">${worst && worst[1].rate > 0 ? `fails in ${worst[1].fails} of ${rec.total} months` : 'no parameter fails the standard'}</div></div>
      <div class="kpi"><div class="l">12-month mean WQI</div><div class="v">${nf(st.avg12, 1)}</div><div class="s">${st.prev12 ? `${st.delta >= 0 ? '+' : ''}${nf(st.delta, 1)} on the year before` : ''}</div></div>
    </div>
    <h3>Six parameters · ${fmtMonth(latest.t)}</h3>
    <table><thead><tr><th>Parameter</th><th class="num">Reading</th><th class="num">Class ${target} standard</th><th>Verdict</th><th class="num">% of limit</th><th class="num">Sub-index</th><th class="num">Weight</th><th class="num">Months failed</th></tr></thead>
    <tbody>${Object.entries(PARAM_META).map(([p, m]) => {
      const v = latest.raw[p]; const chk = checkStandard(p, v, target); const fail = chk.pass === false;
      return `<tr><td><b>${m.name}</b> <span class="mut">${m.short}${m.unit ? ` · ${m.unit}` : ''}</span></td>
        <td class="num ${fail ? 'bad' : ''}">${fmtVal(p, v)}</td><td class="num">${chk.limitText}</td>
        <td class="${fail ? 'bad' : 'ok'}">${fail ? 'Exceeds' : 'Meets'}</td>
        <td class="num">${chk.ratio != null ? `${(chk.ratio * 100).toFixed(0)}%` : chk.margin === 0 ? 'in range' : 'out of range'}</td>
        <td class="num">${latest.si[p].toFixed(0)}</td><td class="num">${(WEIGHTS[p] * 100).toFixed(0)}%</td>
        <td class="num">${rec.byParam[p].fails}/${rec.total}</td></tr>`;
    }).join('')}</tbody></table>
    <h3>Index record · last ${last12.length} months</h3>
    <table><thead><tr><th>Month</th><th class="num">WQI</th><th>Class</th><th>Class ${target}</th>${Object.values(PARAM_META).map((m) => `<th class="num">${m.short}</th>`).join('')}</tr></thead>
    <tbody>${last12.map((r) => { const c = wqiClass(r.wqi); const k = classCompliance(r.raw, target);
      return `<tr><td>${fmtMonth(r.t)}</td><td class="num">${r.wqi.toFixed(1)}</td><td style="color:${c.color};font-weight:600">${c.id} · ${c.status}</td>
        <td class="${k.pass ? 'ok' : 'bad'}">${k.pass ? 'Meets' : `Fails ${k.failed}`}</td>
        ${Object.keys(PARAM_META).map((p) => `<td class="num">${fmtVal(p, r.raw[p])}</td>`).join('')}</tr>`; }).join('')}</tbody></table>`;
}

function sectionQuality(g) {
  const { st, target, latest, rec } = g;
  if (!rec.total) return `<h2>Quality monitoring</h2><div class="sub">No record at this station yet.</div>`;
  return `<h2>Quality monitoring</h2>
    <div class="sub">How often each parameter breaches Class ${target} over the record · ${rec.months[0].t} to ${rec.months[rec.total - 1].t} · ${rec.total} months</div>
    <table><thead><tr><th>Parameter</th><th class="num">Months exceeding</th><th class="num">Share of record</th><th class="num">Latest</th><th class="num">Limit</th><th>Latest verdict</th></tr></thead>
    <tbody>${Object.entries(PARAM_META).map(([p, m]) => { const v = rec.byParam[p]; const cur = latest?.raw[p]; const chk = cur == null ? null : checkStandard(p, cur, target);
      const col = v.rate >= 0.5 ? 'bad' : v.rate > 0.1 ? 'warn' : 'ok';
      return `<tr><td><b>${m.name}</b> <span class="mut">${m.unit || ''}</span></td><td class="num">${v.fails}</td><td class="num ${col}">${(v.rate * 100).toFixed(0)}%</td>
        <td class="num">${fmtVal(p, cur)}</td><td class="num">${chk ? chk.limitText : '—'}</td><td class="${chk?.pass === false ? 'bad' : 'ok'}">${chk ? (chk.pass === false ? 'Exceeds' : 'Meets') : '—'}</td></tr>`; }).join('')}</tbody></table>
    <div class="sub">12-month mean WQI ${nf(st.avg12, 1)}${st.prev12 ? `, the 12 months before ${nf(st.prev12, 1)}` : ''}. The in-river concentration the TMDL below is built on is the 12-month median of each parameter.</div>`;
}

function sectionTmdl(g) {
  const { st, tmdl, budgets, head, here } = g;
  if (!tmdl) return `<h2>Total Maximum Daily Load</h2><div class="sub">No TMDL is written for this location.</div>`;
  const list = Object.values(budgets);
  const notFit = list.filter((b) => !b.fits), over = list.filter((b) => b.overCapacity), laOver = list.filter((b) => b.laRemaining < -0.5);
  const names = (a) => a.map((b) => PARAM_META[b.param].short).join(', ');
  const binding = head.binding ? PARAM_META[head.binding.param].short : '—';
  let tone, headline, sub;
  if (notFit.length) { tone = 'bad'; headline = `The TMDL does not fit the loading capacity on ${names(notFit)}`; sub = `ΣWLA + ΣLA + MOS comes to more than Class ${tmdl.targetClass} at ${tmdl.designFlow} m³/s can carry, by ${fmtLoad(notFit.reduce((s, b) => s + b.excess, 0))}.`; }
  else if (over.length) { tone = 'bad'; headline = `Over-committed on ${names(over)}`; sub = `The licences counting here already permit more than the wasteload allocation, by ${fmtLoad(over.reduce((s, b) => s + b.reductionNeeded, 0))}.`; }
  else if (laOver.length) { tone = 'warn'; headline = `Diffuse load beyond the ΣLA on ${names(laOver)}`; sub = `The river carries ${fmtLoad(laOver.reduce((s, b) => s - b.laRemaining, 0))} more background and diffuse load than the allocation allows for. ${fmtVol(Math.max(0, head.volume))} is left to licence at Standard A.`; }
  else { tone = 'ok'; headline = `Within allocation — ${binding} is binding`; sub = `${fmtVol(Math.max(0, head.volume))} of new effluent could still be licensed at Standard A, about ${nf(headroomInPE(head.volume))} population equivalent.`; }
  return `<h2>Total Maximum Daily Load</h2>
    <div class="sub">TMDL = ΣWLA + ΣLA + MOS · ${esc(tmdl.ref)}${tmdl.example ? ' · worked example' : ''}${tmdl.title ? ` · ${esc(tmdl.title)}` : ''}</div>
    <div class="meta"><span>Target <b>Class ${esc(tmdl.targetClass)}</b></span><span>Design flow <b>${esc(tmdl.designFlow)} m³/s</b> ${tmdl.flowVerified ? '(verified)' : '(estimate)'}</span><span>Written <b>${esc(tmdl.date ?? '')}</b></span><span>Licences counting here <b>${here.length}</b></span></div>
    ${tmdl.flowVerified ? '' : `<div class="note">${esc(flowBasis(st))}</div>`}
    <div class="verdict ${tone}"><b>${headline}</b>${sub}</div>
    <h3>The allocation, kg/day</h3>
    <table><thead><tr><th>Pollutant</th><th class="num">ΣWLA</th><th class="num">ΣLA</th><th class="num">MOS</th><th class="num">= TMDL</th><th class="num">Loading capacity</th><th>Fit</th></tr></thead>
    <tbody>${list.map((b) => `<tr><td><b>${PARAM_META[b.param].short}</b> <span class="mut">Class ${esc(tmdl.targetClass)} · ${b.standard} mg/L</span></td><td class="num">${nf(b.wla)}</td><td class="num">${nf(b.la)}</td><td class="num">${nf(b.mos)}</td><td class="num"><b>${nf(b.tmdl)}</b></td><td class="num">${nf(b.capacity)}</td>
      <td class="${b.fits ? 'ok' : 'bad'}">${b.fits ? `fits · ${nf(Math.max(0, b.capacity - b.tmdl))} spare` : `over by ${nf(b.excess)}`}</td></tr>`).join('')}</tbody></table>
    <h3>Load now against the allocation, kg/day</h3>
    <table><thead><tr><th>Pollutant</th><th class="num">In river mg/L</th><th class="num">ΣWLA</th><th class="num">ΣLA</th><th class="num">Licensed now</th><th class="num">Diffuse now</th><th class="num">Left to licence</th><th class="num">ΣWLA used</th></tr></thead>
    <tbody>${list.map((b) => { const pct = b.wla > 0 ? (b.licensed / b.wla) * 100 : (b.licensed > 0 ? Infinity : 0);
      return `<tr><td><b>${PARAM_META[b.param].short}</b></td><td class="num">${b.param === 'an' ? b.observedConc.toFixed(3) : b.observedConc.toFixed(2)}</td><td class="num">${nf(b.wla)}</td><td class="num">${nf(b.la)}</td>
      <td class="num">${nf(b.licensed)}</td><td class="num ${b.laRemaining < 0 ? 'bad' : ''}">${nf(b.diffuse)}</td>
      <td class="num ${b.overCapacity ? 'bad' : 'ok'}">${b.overCapacity ? '−' : ''}${nf(Math.abs(b.remaining))}</td><td class="num">${Number.isFinite(pct) ? `${pct.toFixed(0)}%` : '∞'}</td></tr>`; }).join('')}</tbody></table>
    <div class="sub">Loading capacity = standard × ${esc(tmdl.designFlow)} m³/s × ${RIVER_FACTOR}. River load = 12-month median × design flow × ${RIVER_FACTOR}. Licence wasteload = mg/L × m³/day ÷ 1000.</div>
    ${tmdl.note ? `<div class="note">${esc(tmdl.note)}</div>` : ''}`;
}

function sectionLicences(g) {
  const { here } = g;
  const active = here.filter((l) => l.active !== false);
  const tot = {};
  for (const p of ['bod', 'cod', 'ss', 'an']) tot[p] = active.reduce((t, l) => t + licenceLoads(l)[p], 0);
  return `<h2>Licences counting at this location</h2>
    <div class="sub">${here.length} licence${here.length === 1 ? '' : 's'}, ${active.length} active · the nearest monitoring station to each premises, unless the register says another</div>
    ${here.length ? `<table><thead><tr><th>Licence</th><th>Premises</th><th>Category</th><th>Std</th><th class="num">Flow m³/day</th><th class="num">BOD</th><th class="num">COD</th><th class="num">SS</th><th class="num">NH₃-N</th><th class="num">BOD kg/d</th><th class="num">COD kg/d</th><th class="num">SS kg/d</th><th class="num">NH₃-N kg/d</th><th>Status</th></tr></thead>
    <tbody>${here.map((l) => { const lo = licenceLoads(l); const c = licenceCompliance(l, 'A'); const off = l.active === false;
      return `<tr class="${off ? 'mut' : ''}"><td>${esc(l.ref)}${l.example ? ` <span class="mut">${l.bulk ? 'estimated' : 'example'}</span>` : ''}</td><td>${esc(l.premises)}</td><td>${esc(l.category ?? '')}</td><td>${esc(l.standard ?? '')}</td><td class="num">${nf(l.flow)}</td>
        ${['bod', 'cod', 'ss', 'an'].map((p) => `<td class="num">${l.conc?.[p] ?? 0}</td>`).join('')}${['bod', 'cod', 'ss', 'an'].map((p) => `<td class="num">${nf(lo[p], 1)}</td>`).join('')}
        <td class="${off ? 'mut' : c.pass ? 'ok' : 'bad'}">${off ? 'Inactive' : c.pass ? 'Within Std A' : `Exceeds Std A (${c.breaches.join(', ')})`}</td></tr>`; }).join('')}
      <tr><th colspan="9">Total · ${active.length} active</th>${['bod', 'cod', 'ss', 'an'].map((p) => `<th class="num">${nf(tot[p], 1)}</th>`).join('')}<th></th></tr></tbody></table>` : ''}`;
}

export function buildReport(g, sec, cap) {
  const { st } = g;
  const gen = new Date();
  const when = gen.toLocaleString('en-MY', { dateStyle: 'long', timeStyle: 'short' });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LUAS · ${esc(st.code)} · ${esc(st.name)} · location report</title><style>${CSS}</style></head><body>
<div class="bar"><span><b>LUAS System</b> · Sungai Langat · location report</span><button onclick="window.print()">Print / save as PDF</button></div>
<div class="page">
  <div class="sub">Lembaga Urus Air Selangor · Sungai Langat catchment</div>
  <h1>${esc(st.name)} <span class="mut" style="font-weight:500">· ${esc(st.code)}</span></h1>
  <div class="meta"><span>${esc(st.river)}</span><span>${esc(st.district)} district</span><span>${esc(st.segment ?? '')} reach</span>
    ${st.user ? `<span>${esc(kindLabel(st.kind))} · added from the app bar</span>` : ''}
    <span>${st.lat.toFixed(5)}, ${st.lon.toFixed(5)}</span><span>Generated <b>${esc(when)}</b></span></div>
  ${sec.map && cap ? `<figure><img src="${cap.url}" width="${cap.w}" height="${cap.h}" alt="Map around ${esc(st.name)}">
    <figcaption>${esc(cap.base)} at zoom ${cap.zoom}, scale bar ${esc(cap.scale)}. Rivers in blue, the catchment edge dashed yellow, water bodies by type, premises green with a licence and red without, stations by their latest WQI class. ${esc(cap.credit)}.</figcaption></figure>` : sec.map ? '<div class="note">The map could not be captured: the basemap tiles did not load.</div>' : ''}
  ${sec.station ? sectionStation(g) : ''}
  ${sec.quality ? sectionQuality(g) : ''}
  ${sec.tmdl ? sectionTmdl(g) : ''}
  ${sec.licences ? sectionLicences(g) : ''}
  <div class="foot">Station positions are real; the parameter values are sample readings, not measurements. No licence register is published as open data: licences marked example or estimated are placeholders. Design flows are estimates until replaced with the DID gauged record. Exported from the LUAS System prototype on ${esc(today())}.</div>
</div></body></html>`;
}

export function buildJson(g, sec) {
  const { st, tmdl, target, latest, rec, here, budgets, head, reading } = g;
  const out = {
    meta: { generated: new Date().toISOString(), system: 'LUAS · Sungai Langat · location report', targetClass: target },
    station: { code: st.code, name: st.name, river: st.river, district: st.district, segment: st.segment, kind: st.kind ?? null,
      lat: st.lat, lon: st.lon, addedHere: !!st.user, designFlowEstimate: st.flowEst ?? null, drainedChannelKm: st.drained ? Math.round(st.drained / 1000) : null },
  };
  if (sec.station || sec.quality) {
    out.latest = latest ? { month: latest.t, wqi: latest.wqi, class: wqiClass(latest.wqi).id, parameters: latest.raw, subIndices: latest.si } : null;
    out.record = { months: rec.total, meetingTarget: rec.passing, rate: rec.rate, byParameter: rec.byParam,
      series: st.wqiSeries.map((r) => ({ month: r.t, wqi: r.wqi, class: wqiClass(r.wqi).id, ...r.raw })) };
    out.designConcentration12m = reading;
  }
  if (sec.tmdl) {
    out.tmdl = tmdl ? { ...tmdl, budget: budgets, headroomStdA: { volume: head.volume, binding: head.binding?.param ?? null } } : null;
  }
  if (sec.licences) out.licences = here.map((l) => ({ ...l, loads: licenceLoads(l) }));
  return out;
}

/* ============================================================
   The dialog
   ============================================================ */
let lastUrl = null;

export function buildReportDialog() {
  $('rptClose').onclick = closeReport;
  $('rptBack').onclick = closeReport;
  $('rptCancel').onclick = closeReport;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('rptDialog').hidden) closeReport(); });
  $('rptGo').onclick = generate;
  $('rptStation').onchange = () => { $('rptResult').hidden = true; };
}

export function openReportDialog() {
  const byRiver = {};
  for (const st of DATA.stations) (byRiver[st.river] ??= []).push(st);
  $('rptStation').innerHTML = Object.entries(byRiver).map(([river, list]) => `
    <optgroup label="${esc(river)}">${list.map((st) => `<option value="${st.code}">${esc(st.name)} · ${st.code}</option>`).join('')}</optgroup>`).join('');
  $('rptStation').value = DATA.focus.code;
  $('rptResult').hidden = true;
  $('rptHint').textContent = '';
  $('rptDialog').hidden = false;
  document.body.classList.add('modal-open');
  $('rptStation').focus();
}

function closeReport() {
  $('rptDialog').hidden = true;
  document.body.classList.remove('modal-open');
}

async function generate() {
  const st = DATA.stations.find((s) => s.code === $('rptStation').value);
  if (!st) return;
  const sec = {
    map: $('rptSecMap').checked, station: $('rptSecStation').checked, quality: $('rptSecQuality').checked,
    tmdl: $('rptSecTmdl').checked, licences: $('rptSecLicences').checked,
  };
  const btn = $('rptGo');
  btn.disabled = true;
  $('rptResult').hidden = true;
  try {
    let cap = null;
    if (sec.map) {
      $('rptHint').textContent = 'Capturing the map around the station…';
      cap = await captureMap(st, { base: $('rptBase').value, zoom: Number($('rptZoom').value) });
    }
    $('rptHint').textContent = 'Writing the report…';
    const g = gather(st);
    const html = buildReport(g, sec, cap);
    const json = JSON.stringify(buildJson(g, sec), null, 2);
    const stamp = today();
    const name = `luas-report-${st.code}-${stamp}`;

    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    $('rptOpen').href = lastUrl;
    $('rptDl').onclick = () => download(`${name}.html`, html, 'text/html');
    $('rptJson').onclick = () => download(`${name}.json`, json);
    $('rptResultText').textContent = `${st.code} · ${st.name}${cap ? ` · map at zoom ${cap.zoom}` : sec.map ? ' · map not captured' : ''} · ${Math.round(html.length / 1024)} KB`;
    $('rptResult').hidden = false;
    $('rptHint').textContent = 'Ready.';
  } catch (e) {
    $('rptHint').textContent = `Could not build the report: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}
