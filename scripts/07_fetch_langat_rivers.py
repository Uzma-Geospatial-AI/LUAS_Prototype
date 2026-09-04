"""Fetch the river network inside the Sungai Langat catchment.

Source: OpenStreetMap via Overpass API (ODbL 1.0 © OpenStreetMap contributors)

Every `waterway=river` whose course falls inside the catchment drains to Sungai
Langat — that is what a catchment is — so the basin polygon from
06_fetch_langat_basin.py is the filter. Streams and drains are left out: at the
zooms this map is read at they would be noise, and the main channels are what
the load budget is about.

Flow direction
--------------
OSM draws a waterway in the direction it flows, so a way's coordinates already
run downstream. That is the only real signal available for "where does this go".

Matching one way's end against another way's START is not enough: a tributary
joins the middle of the river it feeds, not its head, so almost every
confluence is missed that way and traces die after one reach. The end node is
therefore matched against ANY vertex of another way. Each reach gets `next`,
the reach below it, and `nexti`, the vertex it joins at — so the distance
downstream counts only the part of the next reach that is actually below the
junction, not the whole of it.

Run 06_fetch_langat_basin.py first.
"""
import json
import math
import os
import sys
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

# ---------------- Flow direction ----------------
# Every vertex of every reach, so a confluence anywhere along a river is found.
SNAP_M = 75.0            # a confluence displaced by simplification and clipping
#                          75 m takes reaches that trace to Sungai Langat from
#                          117 to 394 of 489; 150 m reaches 454 but starts
#                          linking across to parallel channels, so it is not
#                          worth the wrong answers.

vertices = {}
for i, f in enumerate(feats):
    for k, c in enumerate(f['geometry']['coordinates']):
        vertices.setdefault((round(c[0], 5), round(c[1], 5)), []).append((i, k))

vertex_pts = list(vertices.items())


def downstream_of(i, key):
    """The reach this one flows into, and the vertex it joins at.

    Prefer a junction with channel left below it; a match on another reach's
    very last vertex is still a link, just one with nothing of its own to
    contribute."""
    best = None
    for j, k in vertices.get(key, ()):
        if j == i:
            continue
        room = len(feats[j]['geometry']['coordinates']) - 1 - k
        if best is None or room > best[2]:
            best = (j, k, room)
    if best:
        return best[0], best[1]

    kx = math.cos(math.radians(key[1])) * 111320.0
    near, nd = None, SNAP_M
    for (x, y), jk in vertex_pts:
        d = math.hypot((x - key[0]) * kx, (y - key[1]) * 111320.0)
        if d <= nd:
            hit = next(((j, k) for j, k in jk if j != i), None)
            if hit:
                near, nd = hit, d
    return near if near else (None, None)


linked = ends = 0
for i, f in enumerate(feats):
    c = f['geometry']['coordinates'][-1]
    j, k = downstream_of(i, (round(c[0], 5), round(c[1], 5)))
    if j is None:
        ends += 1
        continue
    f['properties']['next'] = feats[j]['properties']['id']
    f['properties']['nexti'] = k
    linked += 1

print('flow: %d reaches link downstream, %d are ends' % (linked, ends))

# ---------------- Accumulated channel ----------------
# How much mapped channel drains through each reach. There is no measured
# width in the source — 3 of 1,182 ways carry a `width` tag — so this is what
# is honestly available: the trunk carries everything above it, a headwater
# carries only itself. A river's width goes roughly with the square root of
# what it drains, which is enough to draw a confluence that looks like one.
by_id = {f['properties']['id']: i for i, f in enumerate(feats)}
children = {}
for i, f in enumerate(feats):
    nx = f['properties'].get('next')
    if nx is not None and nx in by_id:
        children.setdefault(by_id[nx], []).append(i)

up = [None] * len(feats)


def upstream_m(i, guard):
    if up[i] is not None:
        return up[i]
    if i in guard:                      # a direction error would loop forever
        return feats[i]['properties']['m']
    guard.add(i)
    total = feats[i]['properties']['m']
    for c in children.get(i, ()):
        total += upstream_m(c, guard)
    guard.discard(i)
    up[i] = total
    return total


sys.setrecursionlimit(5000)
for i in range(len(feats)):
    upstream_m(i, set())
for i, f in enumerate(feats):
    f['properties']['up'] = round(up[i])

print('accumulated channel: %.1f km at the largest reach, %.1f km median'
      % (max(up) / 1000, sorted(up)[len(up) // 2] / 1000))

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
                 'Streams and drains are excluded. "next" is the reach this one '
                 'flows into, taken from the direction OSM draws a waterway in; '
                 'a reach without it is the mouth, or the edge of the mapped '
                 'network. "nexti" is the vertex of that reach the junction sits '
                 'at, so only the channel below the junction counts as downstream. '
                 '"up" is the mapped channel length draining through the reach; the '
                 'map scales line width by its square root. It is an accumulation, '
                 'NOT a measured width — the source has almost none.'),
    },
    'features': feats,
}
path = os.path.join(OUT, 'langat_rivers.geojson')
with open(path, 'w', encoding='utf-8') as f:
    json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
print('wrote', path, '-', round(os.path.getsize(path) / 1024, 1), 'KB')
