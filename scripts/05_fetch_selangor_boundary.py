"""Fetch the Selangor state boundary and write it for the map.

Source: Department of Statistics Malaysia (DOSM), `administrative_1_state.geojson`
        https://github.com/dosm-malaysia/data-open — the same publisher as
        data.gov.my, so the boundary on the map is the official one.

LUAS is the state water authority, so the map needs the state it is responsible
for, not only the 15 km reach the load model is written for.

OSM's `admin_level=4` relation was the obvious alternative and is not used: it
includes Selangor's territorial waters, which puts a straight-edged wedge far out
into the Strait of Malacca and makes the state read as mostly sea. The DOSM file
is land only, and carries the islands — Pulau Ketam, Carey Island and the rest —
as separate parts.

Kuala Lumpur and Putrajaya are Federal Territories enclaved inside Selangor and
come through as interior rings. They are kept as holes: they are not under LUAS.
"""
import json
import math
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'data')

SRC = ('https://raw.githubusercontent.com/dosm-malaysia/data-open/main/'
       'datasets/geodata/administrative_1_state.geojson')
STATE = 'Selangor'
UA = 'LUAS-Prototype/1.0 (https://github.com/Uzma-Geospatial-AI/LUAS_Prototype)'

MPD = 111320.0
SIMPLIFY_DEG = 3.0e-4      # about 33 m at this latitude
COORD_DP = 5


def perp_distance(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(points, tol):
    """Douglas-Peucker, iterative — a coastline is too long to recurse over."""
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
    pts = [tuple(p[:2]) for p in ring]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        return None
    out = simplify(pts + [pts[0]], tol)
    if len(out) > 1 and out[0] == out[-1]:
        out = out[:-1]
    if len(out) < 3:
        out = pts                      # a small island: keep it whole
    out = [[round(x, COORD_DP), round(y, COORD_DP)] for x, y in out]
    dedup = [out[0]]
    for p in out[1:]:
        if p != dedup[-1]:
            dedup.append(p)
    if len(dedup) < 3:
        return None
    return dedup + [dedup[0]]


def count_coords(coords):
    return 1 if isinstance(coords[0], (int, float)) else sum(count_coords(c) for c in coords)


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


# ---------------- Fetch ----------------
print('downloading', SRC)
req = urllib.request.Request(SRC, headers={'User-Agent': UA})
fc = json.load(urllib.request.urlopen(req, timeout=180))
print('states in file:', len(fc['features']))

hit = next((f for f in fc['features']
            if (f.get('properties') or {}).get('state') == STATE), None)
if hit is None:
    raise SystemExit('%s not found in the DOSM file' % STATE)

raw = hit['geometry']
polys = [raw['coordinates']] if raw['type'] == 'Polygon' else raw['coordinates']

# ---------------- Simplify ----------------
out = []
for poly in polys:
    rings = [r for r in (clean_ring(ring, SIMPLIFY_DEG) for ring in poly) if r]
    if rings:
        out.append(rings)
if not out:
    raise SystemExit('nothing survived simplification')

geom = {'type': 'MultiPolygon', 'coordinates': out}
holes = sum(len(p) - 1 for p in out)

print('vertices : %d -> %d' % (count_coords(raw['coordinates']), count_coords(out)))
print('parts    : %d (mainland + islands)' % len(out))
print('enclaves : %d interior rings (KL, Putrajaya)' % holes)
print('bbox     :', bbox(out))

payload = {
    'type': 'FeatureCollection',
    'meta': {
        'source': 'Department of Statistics Malaysia · administrative_1_state.geojson',
        'url': 'https://github.com/dosm-malaysia/data-open',
        'state': STATE,
        'simplify_m': round(SIMPLIFY_DEG * MPD),
        'note': ('Official state boundary, land only, simplified to about %d m. '
                 'Interior rings are the Federal Territory enclaves of Kuala Lumpur '
                 'and Putrajaya, which are not under LUAS.'
                 % round(SIMPLIFY_DEG * MPD)),
    },
    'features': [{
        'type': 'Feature',
        'properties': {
            'state': STATE,
            'code_state': hit['properties'].get('code_state'),
            'parts': len(out),
            'bbox': bbox(out),
        },
        'geometry': geom,
    }],
}
path = os.path.join(OUT, 'selangor_boundary.geojson')
with open(path, 'w', encoding='utf-8') as f:
    json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
print('wrote', path, '-', round(os.path.getsize(path) / 1024, 1), 'KB')
