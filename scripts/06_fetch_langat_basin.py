"""Extract the Sungai Langat catchment — the focus area of the whole system.

Source: HydroSHEDS HydroBASINS, Asia, level 8 (`hybas_as_lev08_v1c`)
        https://www.hydrosheds.org/products/hydrobasins  (CC BY 4.0)

The catchment is what "related to Sungai Langat" actually means: every square
metre of land whose run-off reaches the river, and therefore the area whose
discharge the load budget has to account for. A radius around a station is a
convenience; a catchment is the hydrology.

At level 8 the Langat catchment comes out as a single basin — HYBAS_ID
4080020780, `NEXT_DOWN` 0, so it drains straight to the Strait of Malacca and
nothing upstream has to be gathered. The station at Dengkil is used only to
find it: whichever basin contains the station is the one taken, and its
`MAIN_BAS` family is included in case a future HydroBASINS release splits it.

HydroSHEDS delineates from 15 arc-second flow direction, so its 2,140 km²
differs a little from the ~2,350 km² usually quoted for the Langat basin by
DID. Replace this file with the DID delineation if you have it; nothing else
needs to change.

No shapefile library is used — the .shp and .dbf formats are read directly,
which keeps the pipeline to the standard library.
"""
import json
import math
import os
import struct
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'data')

URL = 'https://data.hydrosheds.org/file/hydrobasins/standard/hybas_as_lev08_v1c.zip'
ZIP = os.environ.get('HYBAS_ZIP', os.path.join(ROOT, 'hybas_as_lev08.zip'))
BASE = 'hybas_as_lev08_v1c'

# Sungai Langat at Dengkil — used only to identify the basin.
STATION = (101.68380, 2.85971)

MPD = 111320.0
SIMPLIFY_DEG = 2.0e-4      # about 22 m
COORD_DP = 5


# ---------------- Shapefile reading ----------------
def read_dbf(buf):
    nrec, hlen, rlen = struct.unpack('<I H H', buf[4:12])
    fields, off = [], 32
    while buf[off] != 0x0D:
        fd = buf[off:off + 32]
        fields.append((fd[:11].split(b'\0')[0].decode('latin-1'), chr(fd[11]), fd[16]))
        off += 32
    out = []
    for i in range(nrec):
        p = hlen + i * rlen + 1
        rec = {}
        for name, ftype, flen in fields:
            raw = buf[p:p + flen].decode('latin-1').strip()
            p += flen
            if ftype in 'NF':
                rec[name] = (float(raw) if '.' in raw else int(raw)) if raw else 0
            else:
                rec[name] = raw
        out.append(rec)
    return out


def read_polygons(buf):
    """Yield (record index, [ring, ...]) for every polygon in a .shp."""
    n, off, idx = len(buf), 100, 0
    while off < n:
        _num, clen = struct.unpack('>II', buf[off:off + 8])
        off += 8
        end = off + clen * 2
        if struct.unpack('<i', buf[off:off + 4])[0] == 5:
            nparts, npts = struct.unpack('<ii', buf[off + 36:off + 44])
            parts = struct.unpack('<%di' % nparts, buf[off + 44:off + 44 + 4 * nparts])
            ps = off + 44 + 4 * nparts
            pts = struct.unpack('<%dd' % (npts * 2), buf[ps:ps + 16 * npts])
            rings = []
            for k in range(nparts):
                a = parts[k]
                b = parts[k + 1] if k + 1 < nparts else npts
                rings.append([(pts[2 * j], pts[2 * j + 1]) for j in range(a, b)])
            yield idx, rings
        idx += 1
        off = end


def in_ring(pt, ring):
    x, y = pt
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


# ---------------- Geometry ----------------
def perp_distance(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(points, tol):
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        worst, worst_i = -1.0, i
        for k in range(i + 1, j):
            d = perp_distance(points[k], points[i], points[j])
            if d > worst:
                worst, worst_i = d, k
        if worst > tol:
            keep[worst_i] = True
            stack.append((i, worst_i))
            stack.append((worst_i, j))
    return [p for p, k in zip(points, keep) if k]


def clean_ring(ring, tol):
    pts = list(ring)
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        return None
    out = simplify(pts + [pts[0]], tol)
    if len(out) > 1 and out[0] == out[-1]:
        out = out[:-1]
    if len(out) < 3:
        out = pts
    out = [[round(x, COORD_DP), round(y, COORD_DP)] for x, y in out]
    dedup = [out[0]]
    for p in out[1:]:
        if p != dedup[-1]:
            dedup.append(p)
    return dedup + [dedup[0]] if len(dedup) >= 3 else None


def ring_area_m2(ring, lat0):
    kx = math.cos(math.radians(lat0)) * MPD
    a = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        a += (x1 * kx) * (y2 * MPD) - (x2 * kx) * (y1 * MPD)
    return abs(a) / 2.0


def bbox(coords):
    xs, ys = [], []

    def walk(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0]); ys.append(c[1])
        else:
            for p in c:
                walk(p)
    walk(coords)
    return [round(min(xs), 5), round(min(ys), 5), round(max(xs), 5), round(max(ys), 5)]


def count_coords(coords):
    return 1 if isinstance(coords[0], (int, float)) else sum(count_coords(c) for c in coords)


# ---------------- Fetch ----------------
if not os.path.exists(ZIP):
    print('downloading', URL)
    urllib.request.urlretrieve(URL, ZIP)
print('reading', ZIP)

z = zipfile.ZipFile(ZIP)
recs = read_dbf(z.read(BASE + '.dbf'))
print('sub-basins in file:', len(recs))

shp = z.read(BASE + '.shp')
geoms = {}
hit_idx = None
for idx, rings in read_polygons(shp):
    geoms[idx] = rings
    if hit_idx is None:
        outer = rings[0]
        xs = [p[0] for p in outer]; ys = [p[1] for p in outer]
        if (min(xs) <= STATION[0] <= max(xs)) and (min(ys) <= STATION[1] <= max(ys)):
            if any(in_ring(STATION, r) for r in rings):
                hit_idx = idx

if hit_idx is None:
    raise SystemExit('no sub-basin contains the Dengkil station')

seed = recs[hit_idx]
main = seed['MAIN_BAS']
family = [i for i, r in enumerate(recs) if r['MAIN_BAS'] == main]
print('seed HYBAS_ID %s · MAIN_BAS %s · %d basin(s) in the family'
      % (seed['HYBAS_ID'], main, len(family)))

# ---------------- Simplify ----------------
polys = []
raw_pts = 0
for i in family:
    rings = [r for r in (clean_ring(ring, SIMPLIFY_DEG) for ring in geoms[i]) if r]
    raw_pts += sum(len(r) for r in geoms[i])
    if rings:
        polys.append(rings)
if not polys:
    raise SystemExit('nothing survived simplification')

geom = {'type': 'MultiPolygon', 'coordinates': polys}
lat0 = (bbox(polys)[1] + bbox(polys)[3]) / 2
area_km2 = sum(ring_area_m2([tuple(p) for p in poly[0]], lat0)
               - sum(ring_area_m2([tuple(p) for p in h], lat0) for h in poly[1:])
               for poly in polys) / 1e6

reported = sum(recs[i]['SUB_AREA'] for i in family)
print('vertices : %d -> %d' % (raw_pts, count_coords(polys)))
print('area     : %.1f km2 measured · %.1f km2 reported by HydroBASINS' % (area_km2, reported))
print('bbox     :', bbox(polys))

payload = {
    'type': 'FeatureCollection',
    'meta': {
        'source': 'HydroSHEDS HydroBASINS · Asia level 8 (hybas_as_lev08_v1c)',
        'url': 'https://www.hydrosheds.org/products/hydrobasins',
        'licence': 'CC BY 4.0 · WWF / USGS',
        'basin': 'Sungai Langat',
        'hybas_id': seed['HYBAS_ID'],
        'main_bas': main,
        'area_km2': round(reported, 1),
        'simplify_m': round(SIMPLIFY_DEG * MPD),
        'note': ('Catchment of Sungai Langat: the land whose run-off reaches the '
                 'river. Delineated by HydroSHEDS from 15 arc-second flow direction, '
                 'so the area differs a little from the figure DID quotes. '
                 'Simplified to about %d m.' % round(SIMPLIFY_DEG * MPD)),
    },
    'features': [{
        'type': 'Feature',
        'properties': {
            'name': 'Sungai Langat',
            'hybas_id': seed['HYBAS_ID'],
            'area_km2': round(reported, 1),
            'bbox': bbox(polys),
        },
        'geometry': geom,
    }],
}
path = os.path.join(OUT, 'langat_basin.geojson')
with open(path, 'w', encoding='utf-8') as f:
    json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
print('wrote', path, '-', round(os.path.getsize(path) / 1024, 1), 'KB')
