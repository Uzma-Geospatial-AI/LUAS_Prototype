"""Fetch the river network inside the Sungai Langat catchment.

Source: OpenStreetMap via Overpass API (ODbL 1.0 © OpenStreetMap contributors)

Every `waterway=river` whose course falls inside the catchment drains to Sungai
Langat — that is what a catchment is — so the basin polygon from
06_fetch_langat_basin.py is the filter, and no drainage topology has to be
worked out. Streams and drains are left out: at the zooms this map is read at
they would be noise, and the main channels are what the load budget is about.

Run 06_fetch_langat_basin.py first.
"""
import json
import math
import os
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'data')

BASIN = os.path.join(OUT, 'langat_basin.geojson')
OVERPASS = 'https://overpass-api.de/api/interpreter'
UA = 'LUAS-Prototype/1.0 (https://github.com/Uzma-Geospatial-AI/LUAS_Prototype)'

MAIN = 'Sungai Langat'
COORD_DP = 5
MIN_LEN_M = 400        # drop stubs that carry no name and no length
SIMPLIFY_DEG = 1.5e-4  # about 17 m — finer than the line is ever drawn

CACHE = os.path.join(os.path.dirname(HERE), 'langat_rivers_raw.json')


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


def in_basin(pt, polys):
    for rings in polys:
        if in_ring(pt, rings[0]) and not any(in_ring(pt, h) for h in rings[1:]):
            return True
    return False


def perp_distance(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(points, tol):
    """Douglas-Peucker, iterative."""
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


def length_m(coords):
    total = 0.0
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        kx = math.cos(math.radians((y1 + y2) / 2)) * 111320.0
        total += math.hypot((x2 - x1) * kx, (y2 - y1) * 111320.0)
    return total


# ---------------- The catchment is the filter ----------------
basin = json.load(open(BASIN, encoding='utf-8'))
geom = basin['features'][0]['geometry']
polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
bx = basin['features'][0]['properties']['bbox']
print('basin bbox:', bx)

# ---------------- Ask Overpass ----------------
QUERY = """
[out:json][timeout:240];
way["waterway"="river"](%f,%f,%f,%f);
out geom;
""" % (bx[1], bx[0], bx[3], bx[2])          # Overpass wants south,west,north,east

if os.path.exists(CACHE):
    print('reading cached Overpass response', CACHE)
    elements = json.load(open(CACHE, encoding='utf-8'))['elements']
else:
    print('querying Overpass for rivers in the basin bbox')
    req = urllib.request.Request(
        OVERPASS, data=urllib.parse.urlencode({'data': QUERY}).encode(),
        headers={'User-Agent': UA})
    raw = json.load(urllib.request.urlopen(req, timeout=300))
    json.dump(raw, open(CACHE, 'w', encoding='utf-8'))
    elements = raw['elements']
print('ways returned:', len(elements))

# ---------------- Keep what actually lies in the catchment ----------------
feats = []
dropped_outside = dropped_short = 0
raw_pts, kept_pts = [0], [0]
for el in elements:
    geo = el.get('geometry')
    if not geo or len(geo) < 2:
        continue
    line = [(round(p['lon'], COORD_DP), round(p['lat'], COORD_DP)) for p in geo]

    inside = [p for p in line if in_basin(p, polys)]
    if len(inside) < max(2, len(line) * 0.4):
        dropped_outside += 1
        continue

    name = (el.get('tags') or {}).get('name')
    metres = length_m(line)
    if metres < MIN_LEN_M and not name:
        dropped_short += 1
        continue

    thin = simplify(line, SIMPLIFY_DEG)
    dedup = [list(thin[0])]
    for p in thin[1:]:
        if list(p) != dedup[-1]:
            dedup.append(list(p))
    if len(dedup) < 2:
        continue
    raw_pts[0] += len(line)
    kept_pts[0] += len(dedup)

    props = {'id': el['id'], 'm': round(metres)}
    if name:
        props['name'] = name
        props['main'] = name.startswith(MAIN)
    feats.append({'type': 'Feature', 'properties': props,
                  'geometry': {'type': 'LineString', 'coordinates': dedup}})

feats.sort(key=lambda f: -f['properties']['m'])

named = sum(1 for f in feats if f['properties'].get('name'))
main_m = sum(f['properties']['m'] for f in feats if f['properties'].get('main'))
total_km = sum(f['properties']['m'] for f in feats) / 1000

print('kept %d ways (%d named) · dropped %d outside, %d unnamed stubs'
      % (len(feats), named, dropped_outside, dropped_short))
print('%s: %.1f km of main channel' % (MAIN, main_m / 1000))
print('total mapped river length: %.1f km' % total_km)
print('vertices: %d -> %d (%.0f%% kept)'
      % (raw_pts[0], kept_pts[0], 100.0 * kept_pts[0] / max(1, raw_pts[0])))

payload = {
    'type': 'FeatureCollection',
    'meta': {
        'source': 'OpenStreetMap via Overpass API',
        'url': 'https://www.openstreetmap.org',
        'licence': 'ODbL 1.0 © OpenStreetMap contributors',
        'filter': ('waterway=river, clipped to the Sungai Langat catchment '
                   '(HydroBASINS %s)' % basin['features'][0]['properties']['hybas_id']),
        'main_channel_km': round(main_m / 1000, 1),
        'total_km': round(total_km, 1),
        'simplify_m': round(SIMPLIFY_DEG * 111320.0),
        'note': ('Every river inside the catchment drains to Sungai Langat. '
                 'Streams and drains are excluded.'),
    },
    'features': feats,
}
path = os.path.join(OUT, 'langat_rivers.geojson')
with open(path, 'w', encoding='utf-8') as f:
    json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
print('wrote', path, '-', round(os.path.getsize(path) / 1024, 1), 'KB')
