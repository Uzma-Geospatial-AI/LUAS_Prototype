"""Build the pollution source layer for the Sungai Langat catchment.

Source: OpenStreetMap via Overpass API (ODbL 1.0 © OpenStreetMap contributors)

What can put a load into the river: industrial land and factories, sewage and
water treatment plants, landfill, quarry and waste handling, cleared and
construction land, farms and aquaculture.

Two filters, in this order:

  1. inside the Sungai Langat catchment — anything outside it drains somewhere
     else and is not LUAS's problem on this river;
  2. within 1.5 km of the nearest receiving water — the riparian zone. A
     factory 8 km from any water still discharges somewhere, but it does so
     through a drain this dataset does not have, and putting it on the map as
     though its load arrives at the river would be a claim the data cannot
     support.

"Receiving water" is a river OR a water body. Half the sites here sit beside a
pond, an oxidation basin or an ex-mining lake, and that is what actually
receives them; the river only gets it afterwards. Measuring to the channel
alone overstates the distance and names the wrong feature.

Which one to name, though, depends on what the reader has switched on. So the
nearest is recorded for EVERY layer the map can toggle — `river:main`,
`river:trib`, `water:pond` and the rest — under `near`, keyed exactly as the
map keys its layers. The map picks the closest among the layers currently
visible, and with the ponds hidden it names the nearest river instead of a pond
nobody can see. `dist` stays the overall nearest, because the risk score is a
property of the site and must not move when a layer is toggled.

Each source carries a risk score: the category's relative load weight scaled by
how close it sits to water. It is a screening aid for prioritising inspection,
NOT a measured discharge — nothing here is metered.

Run 02, 06 and 07 first: the catchment is the clip, and the rivers and water
bodies are what distances are measured to.
"""
import json
import math
import os
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'data')

BASIN = os.path.join(OUT, 'langat_basin.geojson')
RIVERS = os.path.join(OUT, 'langat_rivers.geojson')
WATER = os.path.join(OUT, 'waterbodies_langat.geojson')
CACHE = os.path.join(ROOT, 'sources_raw.json')

OVERPASS = 'https://overpass-api.de/api/interpreter'
UA = 'LUAS-Prototype/1.0 (https://github.com/Uzma-Geospatial-AI/LUAS_Prototype)'

BUFFER_M = 1500
MPD = 111320.0

# What to call an unnamed water body in the popup
WATER_LABEL = {
    'treatment': 'Treatment basin', 'storage': 'Lake or reservoir',
    'pond': 'Pond', 'wetland': 'Wetland', 'channel': 'Channel', 'other': 'Open water',
}

# Relative load weight (1-5) and the pollutants each category is known for.
# The weights are judgement, not measurement, and they only order the screening.
CATS = {
    'industri': dict(
        label='Industry & factories', shape='square', color='#4a3aa7', load=5,
        pol='COD, heavy metals, oil & grease, scheduled chemical waste'),
    'kumbahan': dict(
        label='Sewage & water treatment', shape='diamond', color='#2a78d6', load=4,
        pol='NH₃-N, BOD, suspended solids in the effluent'),
    'sisa': dict(
        label='Landfill, quarry & waste', shape='triangle', color='#1baf7a', load=4,
        pol='Leachate, suspended solids, turbidity'),
    'tanah': dict(
        label='Construction & cleared land', shape='pentagon', color='#eda100', load=3,
        pol='Suspended solids, soil erosion, turbidity'),
    'ternakan': dict(
        label='Farms & aquaculture', shape='circle', color='#e34948', load=3,
        pol='BOD, NH₃-N, nutrients, animal waste'),
}

TAGS = {
    ('landuse', 'industrial'): 'industri',
    ('man_made', 'works'): 'industri',
    ('man_made', 'factory'): 'industri',
    ('landuse', 'brownfield'): 'industri',
    ('man_made', 'wastewater_plant'): 'kumbahan',
    ('man_made', 'water_works'): 'kumbahan',
    ('landuse', 'landfill'): 'sisa',
    ('landuse', 'quarry'): 'sisa',
    ('amenity', 'waste_transfer_station'): 'sisa',
    ('landuse', 'construction'): 'tanah',
    ('landuse', 'farmyard'): 'ternakan',
    ('landuse', 'aquaculture'): 'ternakan',
}


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


# ---------------- Catchment and rivers ----------------
basin = json.load(open(BASIN, encoding='utf-8'))
bgeom = basin['features'][0]['geometry']
BPOLYS = bgeom['coordinates'] if bgeom['type'] == 'MultiPolygon' else [bgeom['coordinates']]
BBOX = basin['features'][0]['properties']['bbox']

# Every edge of every receiving water goes into one list, each tagged with the
# LAYER KEY it belongs to — the same key the map toggles it under — so one
# sweep can answer "nearest among these layers" for any combination.
SEG = []          # (x1, y1, x2, y2, viskey, id, name, main)

rivers = json.load(open(RIVERS, encoding='utf-8'))
for ft in rivers['features']:
    pr = ft['properties']
    fid = pr.get('id')
    name = pr.get('name') or 'Unnamed river'
    main = bool(pr.get('main'))
    viskey = 'river:main' if main else 'river:trib'
    c = ft['geometry']['coordinates']
    for (x1, y1), (x2, y2) in zip(c, c[1:]):
        SEG.append((x1, y1, x2, y2, viskey, fid, name, main))

water = json.load(open(WATER, encoding='utf-8'))
for ft in water['features']:
    pr = ft['properties']
    fid = pr.get('id')
    if fid is None:
        continue
    group = pr.get('group') or 'other'
    name = pr.get('name') or WATER_LABEL.get(group, 'Water body')
    viskey = 'water:' + group
    g = ft['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for poly in polys:
        for ring in poly:
            for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
                SEG.append((x1, y1, x2, y2, viskey, fid, name, False))

# A grid so each source only tests the segments near it — 3,400 sources against
# 4,100 segments is 14 million distance tests otherwise.
CELL = 0.01                                   # about 1.1 km
grid = defaultdict(list)
for i, s in enumerate(SEG):
    x0, x1 = sorted((s[0], s[2]))
    y0, y1 = sorted((s[1], s[3]))
    for gx in range(int(math.floor(x0 / CELL)), int(math.floor(x1 / CELL)) + 1):
        for gy in range(int(math.floor(y0 / CELL)), int(math.floor(y1 / CELL)) + 1):
            grid[(gx, gy)].append(i)
print('receiving-water edges %d in %d grid cells' % (len(SEG), len(grid)))


def pt_seg_m(px, py, s):
    kx = math.cos(math.radians(py)) * MPD
    ax, ay = (s[0] - px) * kx, (s[1] - py) * MPD
    bx, by = (s[2] - px) * kx, (s[3] - py) * MPD
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L))
    return math.hypot(ax + t * dx, ay + t * dy)


def nearest_water(lon, lat, rings=2):
    """The nearest edge per layer key, plus the overall nearest main channel.

    Returns {viskey: (distance, id, name)} for every layer with something
    inside the search, and the distance to the nearest main channel."""
    gx0, gy0 = int(math.floor(lon / CELL)), int(math.floor(lat / CELL))
    per = {}
    best, best_main = 1e12, 1e12
    for r in range(rings + 1):
        for gx in range(gx0 - r, gx0 + r + 1):
            for gy in range(gy0 - r, gy0 + r + 1):
                if r and abs(gx - gx0) != r and abs(gy - gy0) != r:
                    continue
                for i in grid.get((gx, gy), ()):
                    s = SEG[i]
                    d = pt_seg_m(lon, lat, s)
                    key = s[4]
                    if key not in per or d < per[key][0]:
                        per[key] = (d, s[5], s[6])
                    if d < best:
                        best = d
                    if s[7] and d < best_main:
                        best_main = d
        if best < r * CELL * MPD:
            break
    return per, best, best_main


# ---------------- Ask Overpass ----------------
if os.path.exists(CACHE):
    print('reading cached Overpass response', CACHE)
    elements = json.load(open(CACHE, encoding='utf-8'))['elements']
else:
    bb = '%f,%f,%f,%f' % (BBOX[1], BBOX[0], BBOX[3], BBOX[2])
    clauses = '\n  '.join('nwr["%s"="%s"](%s);' % (k, v, bb) for k, v in TAGS)
    query = '[out:json][timeout:300];\n(\n  %s\n);\nout center tags;' % clauses
    print('querying Overpass')
    req = urllib.request.Request(
        OVERPASS, data=urllib.parse.urlencode({'data': query}).encode(),
        headers={'User-Agent': UA})
    raw = json.load(urllib.request.urlopen(req, timeout=320))
    json.dump(raw, open(CACHE, 'w'))
    elements = raw['elements']
print('elements returned:', len(elements))

# ---------------- Categorise, clip, score ----------------
feats = []
n_uncategorised = n_outside_basin = n_far = 0

for el in elements:
    tags = el.get('tags') or {}
    cat = next((c for k, c in TAGS.items() if tags.get(k[0]) == k[1]), None)
    if cat is None:
        n_uncategorised += 1
        continue

    if el['type'] == 'node':
        lon, lat = el.get('lon'), el.get('lat')
    else:
        c = el.get('center') or {}
        lon, lat = c.get('lon'), c.get('lat')
    if lon is None:
        n_uncategorised += 1
        continue

    if not in_basin((lon, lat), BPOLYS):
        n_outside_basin += 1
        continue

    per, d_any, d_main = nearest_water(lon, lat)
    if d_any > BUFFER_M:
        n_far += 1
        continue

    # Closeness to water, 1 at the bank and 0 at the buffer edge.
    prox = max(0.0, 1.0 - d_any / BUFFER_M)
    risk = round(CATS[cat]['load'] * (0.35 + 0.65 * prox ** 1.6), 2)

    props = {
        'id': el['id'],
        'cat': cat,
        'dist': round(d_any),
        'risk': risk,
    }
    name = tags.get('name') or tags.get('operator')
    if name:
        props['name'] = name
    # One entry per layer, so the map can answer for any combination of them.
    # Anything past the buffer is dropped: it is not a receiving water for this
    # site, it is just the closest thing of that type somewhere out there.
    near = {}
    for key, (d, fid, wname) in sorted(per.items(), key=lambda kv: kv[1][0]):
        if d <= BUFFER_M:
            near[key] = {'id': fid, 'n': wname, 'd': round(d)}
    if near:
        props['near'] = near
    if d_main < 1e11:
        props['dist_langat'] = round(d_main)
    feats.append({
        'type': 'Feature',
        'properties': props,
        'geometry': {'type': 'Point', 'coordinates': [round(lon, 5), round(lat, 5)]},
    })

feats.sort(key=lambda f: -f['properties']['risk'])

counts = Counter(f['properties']['cat'] for f in feats)
print('dropped: %d uncategorised, %d outside the catchment, %d beyond %d m of a river'
      % (n_uncategorised, n_outside_basin, n_far, BUFFER_M))
print('kept %d sources in the riparian zone' % len(feats))
for c, n in counts.most_common():
    print('  %-10s %4d  %s' % (c, n, CATS[c]['label']))
kinds = Counter(
    next(iter(f['properties'].get('near', {})), 'none').split(':')[0] for f in feats)
print('overall nearest receiving water is a: %s' % dict(kinds))
layers = Counter(k for f in feats for k in f['properties'].get('near', {}))
print('sites with each layer inside the buffer:')
for k, n in layers.most_common():
    print('  %-18s %4d' % (k, n))
print('layers per site: %.1f average'
      % (sum(len(f['properties'].get('near', {})) for f in feats) / max(1, len(feats))))
for b in (100, 250, 500, 1000, 1500):
    print('  within %5d m of water: %d'
          % (b, sum(1 for f in feats if f['properties']['dist'] <= b)))

payload = {
    'type': 'FeatureCollection',
    'meta': {
        'source': 'OpenStreetMap via Overpass API',
        'url': 'https://www.openstreetmap.org',
        'licence': 'ODbL 1.0 © OpenStreetMap contributors',
        'buffer_m': BUFFER_M,
        'clip': ('Sungai Langat catchment (HydroBASINS %s), then %d m of the nearest '
                 'receiving water' % (basin['features'][0]['properties']['hybas_id'], BUFFER_M)),
        'categories': CATS,
        'note': ('"near" holds the closest receiving water per map layer, keyed as '
                 'the map keys its layers, so the answer can follow what is switched '
                 'on. "dist" is the overall nearest and does not move when a layer is '
                 'toggled, because the risk score is scaled from it. Risk is the '
                 'category load weight scaled by closeness to water: a screening aid '
                 'for prioritising inspection, not a measured discharge — none of '
                 'these sources is metered.'),
    },
    'features': feats,
}
path = os.path.join(OUT, 'pollution_sources.geojson')
with open(path, 'w', encoding='utf-8') as f:
    json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
print('wrote', path, '-', round(os.path.getsize(path) / 1024, 1), 'KB')
