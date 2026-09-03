"""Build the receiving-water-body dataset for the Dengkil reach.

Source: Digital Earth `malaysia_water_bodies.geojson` (121 MB, 30,207 polygons),
        https://digitalearthgeojson.s3.ap-southeast-5.amazonaws.com/malaysia_water_bodies.geojson

The full national file is far too large to ship to a browser, so it is clipped
to the Sungai Langat reach around the Dengkil monitoring station and reduced to
what the load model needs: type, name, surface area and distance to the station.

Wastewater and oxidation ponds matter most here — they are treatment assets that
sit between a licensed discharge and the river, and their surface area is a
first-order proxy for retention capacity.

Run 01_fetch_waterbodies.py first to download the source file.
"""
import json
import math
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'data')

SRC = os.environ.get('WATERBODIES_SRC', 'waterbodies_raw.geojson')

# Sungai Langat at Dengkil (the Phase 1 station) and the reach radius kept.
STATION = (101.68380, 2.85971)
RADIUS_KM = 15.0

MPD = 111320.0


def ring_area_m2(ring, lat0):
    """Planar shoelace area in m², good enough at this latitude and scale."""
    kx = math.cos(math.radians(lat0)) * MPD
    a = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        a += (x1 * kx) * (y2 * MPD) - (x2 * kx) * (y1 * MPD)
    return abs(a) / 2.0


def geom_area_m2(geom, lat0):
    if geom['type'] == 'Polygon':
        rings = [geom['coordinates']]
    elif geom['type'] == 'MultiPolygon':
        rings = geom['coordinates']
    else:
        return 0.0
    total = 0.0
    for poly in rings:
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
            xs.append(c[0]); ys.append(c[1])
        else:
            for p in c:
                walk(p)
    walk(geom['coordinates'])
    return sum(xs) / len(xs), sum(ys) / len(ys)


def km_from_station(lon, lat):
    kx = math.cos(math.radians(lat)) * MPD
    return math.hypot((lon - STATION[0]) * kx, (lat - STATION[1]) * MPD) / 1000.0


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

out = []
for ft in feats_in:
    g = ft.get('geometry')
    p = ft.get('properties', {})
    if not g:
        continue
    lon, lat = centroid(g)
    d = km_from_station(lon, lat)
    if d > RADIUS_KM:
        continue
    kind = p.get('kind') or p.get('water') or p.get('natural') or 'water'
    area = geom_area_m2(g, lat)
    if area < 400 and not p.get('name'):
        continue                     # drop slivers with no identity
    rec = {
        'id': p.get('id') or p.get('osm_id'),
        'kind': kind,
        'group': KIND_GROUPS.get(kind, 'other'),
        'area_m2': round(area),
        'km': round(d, 2),
        'lon': round(lon, 5),
        'lat': round(lat, 5),
    }
    if p.get('name'):
        rec['name'] = p['name']
    out.append({k: v for k, v in rec.items() if v is not None})

out.sort(key=lambda r: -r['area_m2'])

print('within', RADIUS_KM, 'km of Dengkil:', len(out))
print('by group :', Counter(r['group'] for r in out).most_common())
print('by kind  :', Counter(r['kind'] for r in out).most_common(10))
print('total surface area: %.2f km2' % (sum(r['area_m2'] for r in out) / 1e6))
print('treatment ponds   : %.2f km2' %
      (sum(r['area_m2'] for r in out if r['group'] == 'treatment') / 1e6))

payload = {
    'meta': {
        'source': 'Digital Earth · malaysia_water_bodies.geojson',
        'url': 'https://digitalearthgeojson.s3.ap-southeast-5.amazonaws.com/malaysia_water_bodies.geojson',
        'station': 'LGT06 Sungai Langat at Dengkil',
        'radius_km': RADIUS_KM,
        'note': ('Clipped from the 30,207-polygon national file to the Dengkil reach. '
                 'Geometry is reduced to centroid, surface area and type — the portal '
                 'needs the areas, not the outlines.'),
    },
    'bodies': out,
}
path = os.path.join(OUT, 'waterbodies_dengkil.json')
json.dump(payload, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('size KB', round(os.path.getsize(path) / 1024, 1))
