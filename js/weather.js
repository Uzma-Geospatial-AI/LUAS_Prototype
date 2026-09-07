/* ============================================================
   weather.js — Rainfall and humidity, drawn as a surface

   DID publishes rainfall at 98 telemetry stations in the Sungai Langat
   basin, as totals over four windows: the last hour, three, six and
   twenty-four. Those are points. What a reader wants to see is where the
   rain fell, which is a surface, so the points are interpolated into one.

       HOW THE SURFACE IS BUILT

   Inverse distance weighting on a coarse grid: each cell takes a weighted
   mean of the stations within 25 km, weighted by 1/d², so a cell beside a
   gauge reads that gauge and a cell between two reads between them. The
   grid is rendered small and scaled up with smoothing, which is both
   faster than drawing every pixel and softer than a blur over blobs. Away
   from every gauge the surface fades out rather than inventing a value.

   It is clipped to the catchment. Rain outside it is real but is not this
   map's subject, and a wash of colour over the whole state would say the
   gauges know more than they do.

       THE SCALE IS FIXED, NOT STRETCHED

   Rainfall is coloured against DID's own bands — light, moderate, heavy,
   very heavy — not against the day's maximum. A colour therefore means the
   same thing on every visit, and a dry day looks dry instead of being
   stretched until it looks like a storm. The legend says what was actually
   observed alongside the scale, so an empty map is legible rather than
   ambiguous.

       HUMIDITY IS SIMULATED

   Nothing this project can reach publishes humidity for these stations, so
   the humidity in data/rainfall.json is a deterministic invention (see
   scripts/12_fetch_rainfall.py). It is badged wherever it appears. The
   stations, their positions and their rainfall are real.
   ============================================================ */
import { DATA } from './data.js';

export const HEAT_MODES = {
  h1: { key: 'h1', label: '1 h', kind: 'rain', long: 'Rainfall · last hour' },
  h3: { key: 'h3', label: '3 h', kind: 'rain', long: 'Rainfall · last 3 hours' },
  h6: { key: 'h6', label: '6 h', kind: 'rain', long: 'Rainfall · last 6 hours' },
  h24: { key: 'h24', label: '24 h', kind: 'rain', long: 'Rainfall · last 24 hours' },
  humidity: { key: 'humidity', label: 'Humidity', kind: 'humidity', long: 'Relative humidity · simulated' },
};

/* Rainfall against DID's bands, in mm: 0, 1, 11, 31, 61 and up. The stops
   are placed where the bands change, so a colour boundary is a band
   boundary rather than a decoration. */
export const RAIN_MAX = 80;
const RAIN_STOPS = [
  [0, [56, 142, 214, 0]],
  [1, [120, 196, 240, 150]],
  [11, [46, 134, 222, 205]],
  [31, [250, 176, 5, 225]],
  [61, [214, 40, 40, 240]],
  [80, [155, 20, 60, 245]],
];
/* Humidity over the band the tropics actually sit in. Absolute, like the
   rainfall scale, so a colour means the same thing on every visit — but
   narrower than 0–100, which would leave every reading in one flat middle. */
export const HUM_MIN = 65, HUM_MAX = 95;
const HUM_STOPS = [
  [65, [235, 208, 138, 110]],
  [74, [186, 214, 168, 160]],
  [82, [120, 196, 190, 195]],
  [89, [46, 145, 190, 215]],
  [95, [22, 78, 150, 230]],
];

function ramp(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const t = (v - a) / (b - a || 1);
      return ca.map((c, j) => Math.round(c + (cb[j] - c) * t));
    }
  }
  return stops[stops.length - 1][1];
}

export const heatColour = (mode, v) => {
  const c = HEAT_MODES[mode]?.kind === 'humidity' ? ramp(HUM_STOPS, v) : ramp(RAIN_STOPS, v);
  return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`;
};

/* Every station that reported the value this mode asks for */
export function heatPoints(mode) {
  const m = HEAT_MODES[mode];
  if (!m) return [];
  return (DATA.rainfall?.stations ?? [])
    .map((s) => ({ s, v: m.kind === 'humidity' ? s.humidity : s[m.key] }))
    .filter((p) => typeof p.v === 'number')
    .map((p) => ({ lat: p.s.lat, lon: p.s.lon, v: p.v, name: p.s.name, district: p.s.district }));
}

/* What was actually observed, for the legend to say alongside the scale */
export function heatSummary(mode) {
  const pts = heatPoints(mode);
  if (!pts.length) return { n: 0 };
  const vals = pts.map((p) => p.v).sort((a, b) => a - b);
  const wet = HEAT_MODES[mode].kind === 'rain' ? pts.filter((p) => p.v > 0).length : null;
  return {
    n: pts.length,
    lo: vals[0],
    hi: vals[vals.length - 1],
    median: vals[Math.floor(vals.length / 2)],
    wet,
    silent: (DATA.rainfall?.stations?.length ?? 0) - pts.length,
  };
}

/* ============================================================
   The layer
   ============================================================ */
const CELL = 7;              /* px per grid cell before the smooth upscale */
const REACH_M = 25000;       /* a gauge speaks for 25 km and no further */
const POWER = 2;             /* 1/d², the usual inverse distance weighting */

export function makeHeatLayer(L, paneName) {
  return new (L.Layer.extend({
    initialize() { this._mode = null; this._clip = null; },

    onAdd(map) {
      this._map = map;
      this._cv = L.DomUtil.create('canvas', 'heat-cv');
      this._cv.style.pointerEvents = 'none';
      map.getPane(paneName).appendChild(this._cv);
      map.on('moveend zoomend resize', this._reset, this);
      this._reset();
      return this;
    },

    onRemove(map) {
      map.off('moveend zoomend resize', this._reset, this);
      this._cv?.remove();
      this._cv = null;
      return this;
    },

    setMode(mode) { this._mode = mode; this._reset(); },

    _reset() {
      const map = this._map, cv = this._cv;
      if (!map || !cv) return;
      const size = map.getSize();
      const tl = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(cv, tl);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(size.x * dpr);
      cv.height = Math.round(size.y * dpr);
      cv.style.width = `${size.x}px`;
      cv.style.height = `${size.y}px`;
      this._draw(size, dpr);
    },

    _draw(size, dpr) {
      const ctx = this._cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      const mode = this._mode;
      if (!mode) return;
      const pts = heatPoints(mode);
      if (!pts.length) return;
      const map = this._map;

      /* The gauges in screen space, once */
      const at = pts.map((p) => {
        const q = map.latLngToContainerPoint([p.lat, p.lon]);
        return { x: q.x, y: q.y, v: p.v };
      });
      /* How far 25 km is on this screen, from the map's own scale */
      const a = map.latLngToContainerPoint([pts[0].lat, pts[0].lon]);
      const b = map.latLngToContainerPoint([pts[0].lat, pts[0].lon + 0.1]);
      const mPerPx = (0.1 * 111320 * Math.cos((pts[0].lat * Math.PI) / 180)) / Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y));
      const reach = REACH_M / mPerPx;
      const reach2 = reach * reach;

      /* A coarse grid, drawn small and scaled up: cheaper than a blur and
         smoother than the blobs a blur would be smoothing. */
      const gw = Math.max(2, Math.ceil(size.x / CELL));
      const gh = Math.max(2, Math.ceil(size.y / CELL));
      const off = document.createElement('canvas');
      off.width = gw; off.height = gh;
      const octx = off.getContext('2d');
      const img = octx.createImageData(gw, gh);
      const hum = HEAT_MODES[mode].kind === 'humidity';

      for (let gy = 0; gy < gh; gy++) {
        const py = gy * CELL + CELL / 2;
        for (let gx = 0; gx < gw; gx++) {
          const px = gx * CELL + CELL / 2;
          let num = 0, den = 0, near = Infinity;
          for (const p of at) {
            const dx = p.x - px, dy = p.y - py;
            const d2 = dx * dx + dy * dy;
            if (d2 > reach2) continue;
            if (d2 < near) near = d2;
            const w = 1 / Math.pow(Math.max(d2, 4), POWER / 2);
            num += w * p.v;
            den += w;
          }
          const i = (gy * gw + gx) * 4;
          if (!den) continue;                         /* out of every gauge's reach */
          const v = num / den;
          const c = hum ? ramp(HUM_STOPS, v) : ramp(RAIN_STOPS, v);
          /* Fade out over the last third of the reach, so the surface ends
             where the gauges do rather than at a hard circle */
          const fade = Math.max(0, Math.min(1, (1 - Math.sqrt(near) / reach) * 3));
          img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
          img.data[i + 3] = Math.round(c[3] * fade);
        }
      }
      octx.putImageData(img, 0, 0);

      ctx.save();
      this._clipToCatchment(ctx, map);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, gw, gh, 0, 0, gw * CELL, gh * CELL);
      ctx.restore();
    },

    /* The catchment, so the surface stops where the subject does */
    _clipToCatchment(ctx, map) {
      const f = DATA.catchment?.features?.[0];
      if (!f) return;
      const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
      ctx.beginPath();
      for (const poly of polys) {
        for (const ring of poly) {
          ring.forEach(([lon, lat], i) => {
            const p = map.latLngToContainerPoint([lat, lon]);
            if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
          });
          ctx.closePath();
        }
      }
      ctx.clip('evenodd');
    },
  }))();
}
