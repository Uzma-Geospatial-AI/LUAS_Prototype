"""Give every unnamed feature a name.

Most of the catchment's ponds, a third of its premises and a handful of its
river reaches carry no name in the source data. Three passes, in order of
how real the name is:

  1. OSM name      — the feature's own name, or an alternative name tag
                     (official_name, brand, operator, alt_name, name:ms,
                     name:en, addr:housename). Real.
  2. OSM water     — for a water body, a named OSM water area whose centre
                     lies inside the outline (Digital Earth outlines carry no
                     names; OSM often does). Real.
  3. Given         — a name made from what the feature is and the nearest
                     OSM locality: "Kolam Bandar Baru Bangi 2", "Kilang
                     Semenyih 4", "Anak Sungai Langat 3". A label, not a
                     record: it says where the feature is and what kind of
                     thing it is, and nothing more. Flagged `name_src:
                     "given"` so the portal can say so.

Every feature keeps `name_src`: "osm" or "given". The files are annotated in
place; re-running is idempotent because given names are recomputed, never
read back.

Needs osm_names_raw.json (named water areas and place nodes for the box),
fetched by this script on first run, and sources_raw.json / langat_rivers_raw.json
from scripts/08 and 07 for the alternative name tags.

    python scripts/11_name_features.py
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data')
NAMES_RAW = os.path.join(ROOT, 'osm_names_raw.json')
BBOX = '2.68,101.38,3.28,101.996'          # south, west, north, east
UA = 'LUAS-WQI-portal/1.0 (open data ETL)'

# ---------------- OSM names and places ----------------
if not os.path.exists(NAMES_RAW):
    def overpass(q):
        req = urllib.request.Request('https://overpass-api.de/api/interpreter',
                                     data=urllib.parse.urlencode({'data': q}).encode(),
                                     headers={'User-Agent': UA})
        return json.load(urllib.request.urlopen(req, timeout=300))['elements']
    water_q = ('[out:json][timeout:180];(way["natural"="water"]["name"](%s);'
               'relation["natural"="water"]["name"](%s);way["landuse"="reservoir"]["name"](%s);'
               'way["landuse"="basin"]["name"](%s););out center tags;' % ((BBOX,) * 4))
    place_q = ('[out:json][timeout:180];node["place"~"^(village|suburb|neighbourhood|hamlet|'
               'town|quarter|locality|city)$"]["name"](%s);out;' % BBOX)
    raw = {'water': overpass(water_q), 'places': overpass(place_q)}
    json.dump(raw, open(NAMES_RAW, 'w', encoding='utf-8'), ensure_ascii=False)
    time.sleep(1)
raw = json.load(open(NAMES_RAW, encoding='utf-8'))
print('OSM named water areas: %d · localities: %d' % (len(raw['water']), len(raw['places'])))

MPD = 111_320.0
def dist_m(lon1, lat1, lon2, lat2):
    dx = (lon2 - lon1) * MPD * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat2 - lat1) * MPD
    return math.hypot(dx, dy)

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

# Localities, finest first: a neighbourhood names a pond better than the town
RANK = {'neighbourhood': 0, 'quarter': 1, 'hamlet': 1, 'village': 1, 'suburb': 2,
        'locality': 2, 'town': 3, 'city': 4}
PLACES = [(p['lon'], p['lat'], p['tags']['name'].strip(), RANK.get(p['tags']['place'], 5))
          for p in raw['places'] if 'lon' in p]

def locality(lon, lat):
    """The nearest fine-grained locality within 3 km, else the nearest of any rank."""
    best, bd = None, 1e18
    for plon, plat, name, rank in PLACES:
        d = dist_m(lon, lat, plon, plat)
        score = d + rank * 800          # a suburb 1 km off loses to a neighbourhood 1.5 km off
        if score < bd:
            bd, best = score, name
    return best or 'Langat'

def alt_name(tags):
    for k in ('name', 'official_name', 'name:ms', 'name:en', 'brand', 'operator',
              'alt_name', 'addr:housename'):
        v = (tags or {}).get(k)
        if v and v.strip():
            return v.strip()
    return None

# A given name is "<what it is> <where it is>", numbered when the locality has
# more than one of that kind, biggest first so "1" is the one people know.
def number_duplicates(items):
    """items: list of (key, base, feature, setter). Names shared within a key get 1, 2, 3…"""
    groups = defaultdict(list)
    for it in items:
        groups[(it[0], it[1])].append(it)
    for (_, base), group in groups.items():
        if len(group) == 1:
            group[0][3](base)
        else:
            for i, it in enumerate(group, 1):
                it[3]('%s %d' % (base, i))

# ---------------- Water bodies ----------------
path = os.path.join(OUT, 'waterbodies_langat.geojson')
W = json.load(open(path, encoding='utf-8'))
osm_water = [(w['center']['lon'], w['center']['lat'], w['tags']['name'].strip())
             for w in raw['water'] if 'center' in w]
KIND_WORD = {'pond': 'Kolam', 'lake': 'Tasik', 'reservoir': 'Empangan', 'basin': 'Kolam Takungan',
             'wastewater': 'Kolam Oksidasi', 'river': 'Alur', 'stream': 'Alur', 'drain': 'Parit',
             'stream pool': 'Lubuk', 'water': 'Kolam'}
counts = Counter()
pending = []
feats = sorted(W['features'], key=lambda f: -f['properties']['area_m2'])
for f in feats:
    p = f['properties']
    if p.get('name') and p.get('name_src') != 'given':
        p['name_src'] = 'osm'
        counts['kept'] += 1
        continue
    ring = f['geometry']['coordinates'][0]
    hit = [n for lon, lat, n in osm_water if in_ring((lon, lat), ring)]
    if hit:
        p['name'] = hit[0]
        p['name_src'] = 'osm'
        counts['osm water'] += 1
        continue
    word = KIND_WORD.get(p['kind'], 'Kolam')
    loc = locality(p['lon'], p['lat'])
    def setter(name, p=p):
        p['name'] = name
        p['name_src'] = 'given'
    pending.append((loc, '%s %s' % (word, loc), f, setter))
    counts['given'] += 1
number_duplicates(pending)
json.dump(W, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('water bodies :', dict(counts))

# ---------------- Point sources ----------------
path = os.path.join(OUT, 'pollution_sources.geojson')
S = json.load(open(path, encoding='utf-8'))
tags_by_id = {}
src_raw = os.path.join(ROOT, 'sources_raw.json')
if os.path.exists(src_raw):
    for e in json.load(open(src_raw, encoding='utf-8'))['elements']:
        tags_by_id[e['id']] = e.get('tags', {})
CAT_WORD = {'industri': 'Kilang', 'kumbahan': 'Loji Rawatan', 'sisa': 'Tapak Sisa',
            'tanah': 'Tapak Pembinaan', 'ternakan': 'Ladang'}
counts = Counter()
pending = []
for f in sorted(S['features'], key=lambda f: -f['properties']['risk']):
    p = f['properties']
    if p.get('name') and p.get('name_src') != 'given':
        p['name_src'] = 'osm'
        counts['kept'] += 1
        continue
    alt = alt_name(tags_by_id.get(p['id']))
    if alt:
        p['name'] = alt
        p['name_src'] = 'osm'
        counts['osm tag'] += 1
        continue
    lon, lat = f['geometry']['coordinates']
    loc = locality(lon, lat)
    def setter(name, p=p):
        p['name'] = name
        p['name_src'] = 'given'
    pending.append((loc, '%s %s' % (CAT_WORD.get(p['cat'], 'Premis'), loc), f, setter))
    counts['given'] += 1
number_duplicates(pending)
json.dump(S, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('point sources:', dict(counts))

# ---------------- Rivers ----------------
path = os.path.join(OUT, 'langat_rivers.geojson')
R = json.load(open(path, encoding='utf-8'))
named = [f for f in R['features'] if f['properties'].get('name') and f['properties'].get('name_src') != 'given']
for f in named:
    f['properties']['name_src'] = 'osm'
counts = Counter({'kept': len(named)})
pending = []
for f in R['features']:
    p = f['properties']
    if p.get('name') and p.get('name_src') != 'given':
        continue
    c = f['geometry']['coordinates']
    end = c[-1]
    # The reach it flows into: a named reach with a vertex within 40 m of this one's end
    parent, bd = None, 40
    for g in named:
        for q in g['geometry']['coordinates']:
            d = dist_m(end[0], end[1], q[0], q[1])
            if d < bd:
                bd, parent = d, g['properties']['name']
    mid = c[len(c) // 2]
    base = ('Anak %s' % parent) if parent else ('Sungai %s' % locality(mid[0], mid[1]))
    def setter(name, p=p):
        p['name'] = name
        p['name_src'] = 'given'
    pending.append((base, base, f, setter))
    counts['given'] += 1
number_duplicates(pending)
json.dump(R, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('rivers       :', dict(counts))
print('done — push with: python scripts/10_push_to_firebase.py --node waterbodies --node sources --node rivers')
