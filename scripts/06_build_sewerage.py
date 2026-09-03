"""Clip the drainage / sewerage network to the Langat basin districts.

Reads sewerage_raw.json (see 01e_fetch_sewerage.py) and the district polygons
produced by 05_build_districts.py, and writes data/sewerage.geojson.

Each feature is tagged with:
  kind      drain | ditch | pipeline | pumping_station | manhole
  covered   true when the reach is culverted or otherwise underground
  district  which basin district it falls in
  outfall   metres to the nearest river/canal, for the reaches that end at one
"""
import json
import math
import os
from collections import Counter, defaultdict

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')

raw = json.load(open('sewerage_raw.json', encoding='utf-8'))
districts = json.load(open(os.path.join(OUT, 'districts.geojson'), encoding='utf-8'))

# ---------------- Point in district ----------------
rings = []
for f in districts['features']:
    for poly in f['geometry']['coordinates']:
        ring = poly[0]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        rings.append((f['properties']['name'], ring, min(xs), min(ys), max(xs), max(ys)))


def in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-18) + xi:
            inside = not inside
        j = i
    return inside


def district_of(lon, lat):
    for name, ring, x0, y0, x1, y1 in rings:
        if x0 <= lon <= x1 and y0 <= lat <= y1 and in_ring(lon, lat, ring):
            return name
    return None


# ---------------- Distance to the receiving watercourse ----------------
# A drain matters most where it discharges, so measure each reach's endpoint
# against the river/canal network the portal already ships.
MPD = 111320.0
CELL = 0.01
seg = []
for fname in ('langat_river.geojson', 'tributaries.geojson'):
    fc = json.load(open(os.path.join(OUT, fname), encoding='utf-8'))
    for f in fc['features']:
        c = f['geometry']['coordinates']
        for a, b in zip(c, c[1:]):
            seg.append((a[0], a[1], b[0], b[1]))

grid = defaultdict(list)
for i, s in enumerate(seg):
    x0, x1 = min(s[0], s[2]), max(s[0], s[2])
    y0, y1 = min(s[1], s[3]), max(s[1], s[3])
    for gx in range(int(x0 / CELL), int(x1 / CELL) + 1):
        for gy in range(int(y0 / CELL), int(y1 / CELL) + 1):
            grid[(gx, gy)].append(i)


def pt_seg_m(px, py, s):
    kx = math.cos(math.radians(py)) * MPD
    ax, ay = (s[0] - px) * kx, (s[1] - py) * MPD
    bx, by = (s[2] - px) * kx, (s[3] - py) * MPD
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L))
    return math.hypot(ax + t * dx, ay + t * dy)


def nearest_watercourse(lon, lat, rings_out=3):
    gx0, gy0 = int(lon / CELL), int(lat / CELL)
    best = 1e12
    for r in range(rings_out + 1):
        found = False
        for gx in range(gx0 - r, gx0 + r + 1):
            for gy in range(gy0 - r, gy0 + r + 1):
                if r > 0 and abs(gx - gx0) != r and abs(gy - gy0) != r:
                    continue
                for i in grid.get((gx, gy), ()):
                    d = pt_seg_m(lon, lat, seg[i])
                    best = min(best, d)
                    found = True
        if found and best < r * CELL * MPD:
            break
    return round(best) if best < 1e11 else None


# ---------------- Build features ----------------
lines, points = [], []
skipped = 0

for e in raw['elements']:
    t = e.get('tags', {})

    if e['type'] == 'node':
        lon, lat = e.get('lon'), e.get('lat')
        if lon is None:
            continue
        d = district_of(lon, lat)
        if d is None:
            skipped += 1
            continue
        kind = 'pumping_station' if t.get('man_made') == 'pumping_station' else 'manhole'
        props = {'kind': kind, 'district': d}
        if t.get('name'):
            props['name'] = t['name']
        if t.get('operator'):
            props['operator'] = t['operator']
        points.append({'type': 'Feature', 'properties': props,
                       'geometry': {'type': 'Point', 'coordinates': [round(lon, 5), round(lat, 5)]}})
        continue

    g = e.get('geometry') or []
    if len(g) < 2:
        continue
    mid = g[len(g) // 2]
    d = district_of(mid['lon'], mid['lat'])
    if d is None:
        skipped += 1
        continue

    kind = t.get('waterway') or ('pipeline' if t.get('man_made') == 'pipeline' else 'drain')
    covered = t.get('tunnel') in ('culvert', 'yes', 'building_passage') or t.get('covered') == 'yes'

    coords = [[round(p['lon'], 5), round(p['lat'], 5)] for p in g]
    props = {'kind': kind, 'district': d}
    if covered:
        props['covered'] = True
    if t.get('name'):
        props['name'] = t['name']
    if t.get('substance'):
        props['substance'] = t['substance']

    # Where does this reach discharge?
    ends = [d for d in (nearest_watercourse(*coords[0]), nearest_watercourse(*coords[-1]))
            if d is not None]
    if ends:
        props['outfall'] = min(ends)

    lines.append({'type': 'Feature', 'properties': props,
                  'geometry': {'type': 'LineString', 'coordinates': coords}})

feats = lines + points
print('in basin districts:', len(feats), '| outside:', skipped)
print(Counter(f['properties']['kind'] for f in feats).most_common())
print('culverted reaches:', sum(1 for f in lines if f['properties'].get('covered')))
print('discharging within 100 m of a river:',
      sum(1 for f in lines if (f['properties'].get('outfall') or 9999) <= 100))

meta = {
    'source': 'OpenStreetMap (Overpass API)',
    'scope': 'Hulu Langat, Sepang and Kuala Langat districts',
    'note': ('Malaysia\'s reticulated sewer network (IWK) is not open data, so almost no '
             'sewage pipelines are mapped in OpenStreetMap. This layer is the surface '
             'drainage network that actually conveys domestic sewage, greywater and urban '
             'run-off to the Langat River, plus the few mapped sewer assets.'),
}
path = os.path.join(OUT, 'sewerage.geojson')
json.dump({'type': 'FeatureCollection', 'name': 'sewerage_drainage', 'meta': meta,
           'features': feats},
          open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('size KB', round(os.path.getsize(path) / 1024, 1))
