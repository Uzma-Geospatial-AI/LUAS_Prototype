"""Build the receiving-water-body dataset for the Sungai Langat catchment.

Source: Digital Earth `malaysia_water_bodies.geojson` (121 MB, 30,207 polygons),
        https://digitalearthgeojson.s3.ap-southeast-5.amazonaws.com/malaysia_water_bodies.geojson

The full national file is far too large to ship to a browser, so it is clipped
to the catchment — every water body whose run-off reaches Sungai Langat. That is
the boundary that means something hydrologically; the radius around a station
this used to use was only ever a convenience.

Outlines are KEPT — the map draws the actual water surface rather than a symbol
standing in for it — but simplified to roughly the width of a Sentinel-2 pixel,
which is finer than anything the eye separates at the zooms this is viewed at.

Wastewater and oxidation ponds matter most here — they are treatment assets that
sit between a licensed discharge and the river, and their surface area is a
first-order proxy for retention capacity. Each body also carries its distance to
the nearest mapped river, which says how directly it drains to a channel.

Run in order:
    01_fetch_waterbodies.py     the national source file
    06_fetch_langat_basin.py    the catchment, used here as the clip
    07_fetch_langat_rivers.py   the river network, used here for distances
"""
import json
import math
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'data')

SRC = os.environ.get('WATERBODIES_SRC', 'waterbodies_raw.geojson')
BASIN = os.path.join(OUT, 'langat_basin.geojson')
RIVERS = os.path.join(OUT, 'langat_rivers.geojson')

MPD = 111320.0

# Douglas-Peucker tolerance in degrees. 1e-4 deg is about 11 m at this latitude,
# roughly a Sentinel-2 pixel. Areas are measured before this runs.
SIMPLIFY_DEG = 1.0e-4
COORD_DP = 5          # 5 decimal places is about 1.1 m


def ring_area_m2(ring, lat0):
    """Planar shoelace area in m2, good enough at this latitude and scale."""
    kx = math.cos(math.radians(lat0)) * MPD
    a = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        a += (x1 * kx) * (y2 * MPD) - (x2 * kx) * (y1 * MPD)
    return abs(a) / 2.0


def geom_area_m2(geom, lat0):
    if geom['type'] == 'Polygon':
        polys = [geom['coordinates']]
    elif geom['type'] == 'MultiPolygon':
        polys = geom['coordinates']
    else:
        return 0.0
    total = 0.0
    for poly in polys:
        if not poly:
            continue
        total += ring_area_m2([tuple(p) for p in poly[0]], lat0)
        for hole in poly[1:]:
            total -= ring_area_m2([tuple(p) for p in hole], lat0)
    return max(0.0, total)


def centroid(geom):
    xs, ys = [], []

    def walk(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0])
            ys.append(c[1])
        else:
            for p in c:
                walk(p)
    walk(geom['coordinates'])
    return sum(xs) / len(xs), sum(ys) / len(ys)


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


def km_to_river(lon, lat, segments):
    """Distance to the nearest mapped river, in km.

    Planar at this latitude, which is good to well under a metre over the few
    kilometres that ever matter here."""
    kx = math.cos(math.radians(lat)) * MPD
    px, py = lon * kx, lat * MPD
    best = float("inf")
    for ax, ay, bx, by in segments:
        ax, ay, bx, by = ax * kx, ay * MPD, bx * kx, by * MPD
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            d = (px - ax) ** 2 + (py - ay) ** 2
        else:
            t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
            t = 0.0 if t < 0 else (1.0 if t > 1 else t)
            d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
        if d < best:
            best = d
    return math.sqrt(best) / 1000.0


# ---------------- Geometry simplification ----------------
def perp_distance(p, a, b):
    """Perpendicular distance from p to segment ab, in degrees."""
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(points, tol):
    """Douglas-Peucker, iterative — recursion overflows on the long river rings."""
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
    """Simplify one ring, keeping it closed and still an area."""
    pts = [tuple(p[:2]) for p in ring]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        return None

    out = simplify(pts + [pts[0]], tol)
    if len(out) > 1 and out[0] == out[-1]:
        out = out[:-1]
    if len(out) < 3:
        out = pts                      # too small to survive — keep the outline

    out = [[round(x, COORD_DP), round(y, COORD_DP)] for x, y in out]

    # Rounding can collapse neighbouring vertices onto each other.
    dedup = [out[0]]
    for p in out[1:]:
        if p != dedup[-1]:
            dedup.append(p)
    if len(dedup) < 3:
        return None
    return dedup + [dedup[0]]


def clean_geom(geom, tol):
    if geom['type'] == 'Polygon':
        polys = [geom['coordinates']]
    elif geom['type'] == 'MultiPolygon':
        polys = geom['coordinates']
    else:
        return None
    out = []
    for poly in polys:
        rings = [r for r in (clean_ring(ring, tol) for ring in poly) if r]
        if rings:
            out.append(rings)
    if not out:
        return None
    if geom['type'] == 'Polygon':
        return {'type': 'Polygon', 'coordinates': out[0]}
    return {'type': 'MultiPolygon', 'coordinates': out}


def count_coords(geom):
    n = 0

    def walk(c):
        nonlocal n
        if isinstance(c[0], (int, float)):
            n += 1
        else:
            for p in c:
                walk(p)
    walk(geom['coordinates'])
    return n


# ---------------- The catchment is the clip, the rivers give the distances ----------------
basin = json.load(open(BASIN, encoding='utf-8'))
bgeom = basin['features'][0]['geometry']
BPOLYS = (bgeom['coordinates'] if bgeom['type'] == 'MultiPolygon'
          else [bgeom['coordinates']])
BBOX = basin['features'][0]['properties']['bbox']
print('catchment: %s km2 - bbox %s'
      % (basin['features'][0]['properties']['area_km2'], BBOX))

rivers = json.load(open(RIVERS, encoding='utf-8'))
SEGMENTS = []
for ft in rivers['features']:
    c = ft['geometry']['coordinates']
    for (x1, y1), (x2, y2) in zip(c, c[1:]):
        SEGMENTS.append((x1, y1, x2, y2))
print('river segments for distance: %d over %s km'
      % (len(SEGMENTS), rivers['meta']['total_km']))

# ---------------- Read ----------------
# Accepts either the raw national file (one Feature per line) or an already
# clipped FeatureCollection.
feats_in = []
with open(SRC, encoding='utf-8') as f:
    head = f.read(400)
    f.seek(0)
    if '"features": [\n{' in head or head.lstrip().startswith('{\n"type"'):
        try:
            feats_in = json.load(f)['features']
        except json.JSONDecodeError:
            f.seek(0)
            for line in f:
                line = line.strip().rstrip(',')
                if line.startswith('{ "type": "Feature"') or line.startswith('{"type":"Feature"'):
                    feats_in.append(json.loads(line))
    else:
        feats_in = json.load(f)['features']

print('source features:', len(feats_in))

# ---------------- Clip and reduce ----------------
KIND_GROUPS = {
    'wastewater': 'treatment',
    'basin': 'treatment',
    'reservoir': 'storage',
    'lake': 'storage',
    'pond': 'pond',
    'stream_pool': 'pond',
    'water': 'other',
    'wetland': 'wetland',
    'river': 'channel',
    'stream': 'channel',
    'canal': 'channel',
    'oxbow': 'channel',
}

feats_out = []
raw_pts = simp_pts = 0

for ft in feats_in:
    g = ft.get('geometry')
    p = ft.get('properties', {})
    if not g or g.get('type') not in ('Polygon', 'MultiPolygon'):
        continue
    lon, lat = centroid(g)
    if not (BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]):
        continue
    if not in_basin((lon, lat), BPOLYS):
        continue
    kind = p.get('kind') or p.get('water') or p.get('natural') or 'water'
    area = geom_area_m2(g, lat)          # measured at full resolution
    if area < 400 and not p.get('name'):
        continue                         # drop slivers with no identity

    geom = clean_geom(g, SIMPLIFY_DEG)
    if geom is None:
        continue
    raw_pts += count_coords(g)
    simp_pts += count_coords(geom)

    props = {
        'id': p.get('id') or p.get('osm_id'),
        'kind': kind,
        'group': KIND_GROUPS.get(kind, 'other'),
        'area_m2': round(area),
        'km': round(km_to_river(lon, lat, SEGMENTS), 2),   # to the nearest river
        'lon': round(lon, 5),
        'lat': round(lat, 5),
    }
    if p.get('name'):
        props['name'] = p['name']
    feats_out.append({
        'type': 'Feature',
        'properties': {k: v for k, v in props.items() if v is not None},
        'geometry': geom,
    })

# Largest first, so a small pond still draws on top of the wetland it sits in.
feats_out.sort(key=lambda ft: -ft['properties']['area_m2'])

total_area = sum(ft['properties']['area_m2'] for ft in feats_out)

print('inside the Langat catchment:', len(feats_out))
print('by group :', Counter(ft['properties']['group'] for ft in feats_out).most_common())
print('by kind  :', Counter(ft['properties']['kind'] for ft in feats_out).most_common(10))
print('total surface area: %.2f km2' % (total_area / 1e6))
print('treatment ponds   : %.2f km2' %
      (sum(ft['properties']['area_m2'] for ft in feats_out
           if ft['properties']['group'] == 'treatment') / 1e6))
print('vertices: %d -> %d (%.0f%% kept)' % (raw_pts, simp_pts, 100.0 * simp_pts / max(1, raw_pts)))

payload = {
    'type': 'FeatureCollection',
    'meta': {
        'source': 'Digital Earth · malaysia_water_bodies.geojson',
        'url': 'https://digitalearthgeojson.s3.ap-southeast-5.amazonaws.com/malaysia_water_bodies.geojson',
        'clip': ('Sungai Langat catchment (HydroBASINS %s)'
                 % basin['features'][0]['properties']['hybas_id']),
        'basin_km2': basin['features'][0]['properties']['area_km2'],
        'simplify_m': round(SIMPLIFY_DEG * MPD),
        'note': ('Clipped from the 30,207-polygon national file to the Sungai Langat '
                 'catchment. Outlines are kept and simplified to about %d m, so the map '
                 'draws the water surface itself. Surface areas are computed from the '
                 'full-resolution geometry, before simplification. "km" is the distance '
                 'to the nearest mapped river, not to any station.'
                 % round(SIMPLIFY_DEG * MPD)),
    },
    'features': feats_out,
}
path = os.path.join(OUT, 'waterbodies_langat.geojson')
with open(path, 'w', encoding='utf-8') as f:
    json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
print('wrote', path, '-', round(os.path.getsize(path) / 1024, 1), 'KB')
