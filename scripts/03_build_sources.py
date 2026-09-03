import json, math, os
from collections import Counter, defaultdict

OUT = r"c:/Users/User/Desktop/WebsiteWQI_LUAS/data"

# ---------- 1. Bina indeks spatial bagi semua alur air (waterway) ----------
ww = json.load(open('waterways_raw.json'))
langat_main = set()
seg = []          # (lon1,lat1,lon2,lat2, is_langat)
for e in ww['elements']:
    g = e.get('geometry') or []
    tags = e.get('tags', {})
    nm = (tags.get('name') or '')
    is_l = 'Langat' in nm
    for a, b in zip(g, g[1:]):
        seg.append((a['lon'], a['lat'], b['lon'], b['lat'], is_l))
print('waterway segments', len(seg))

CELL = 0.01  # ~1.1 km
grid = defaultdict(list)
for i, s in enumerate(seg):
    x0, y0, x1, y1 = min(s[0], s[2]), min(s[1], s[3]), max(s[0], s[2]), max(s[1], s[3])
    for gx in range(int(x0 / CELL), int(x1 / CELL) + 1):
        for gy in range(int(y0 / CELL), int(y1 / CELL) + 1):
            grid[(gx, gy)].append(i)

MPD = 111320.0  # meter per darjah latitud


def pt_seg_m(px, py, s):
    """Jarak (meter) titik ke segmen, dalam satah tempatan."""
    kx = math.cos(math.radians(py)) * MPD
    ax, ay = (s[0] - px) * kx, (s[1] - py) * MPD
    bx, by = (s[2] - px) * kx, (s[3] - py) * MPD
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    if L == 0:
        t = 0.0
    else:
        t = max(0.0, min(1.0, -(ax * dx + ay * dy) / L))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(cx, cy)


def nearest_river(lon, lat, rings=3):
    gx0, gy0 = int(lon / CELL), int(lat / CELL)
    best, best_l = 1e12, 1e12
    for r in range(rings + 1):
        found = False
        for gx in range(gx0 - r, gx0 + r + 1):
            for gy in range(gy0 - r, gy0 + r + 1):
                if r > 0 and abs(gx - gx0) != r and abs(gy - gy0) != r:
                    continue
                for i in grid.get((gx, gy), ()):
                    s = seg[i]
                    d = pt_seg_m(lon, lat, s)
                    if d < best:
                        best = d
                    if s[4] and d < best_l:
                        best_l = d
                    found = True
        if found and best < r * CELL * MPD:
            break
    return best, best_l


# ---------- 2. Kategorikan POI ----------
# beban: anggaran relatif sumbangan pencemar (1-5) + pencemar utama
CATS = {
    'industri':  dict(label='Industry & Factories', color='#4a3aa7', icon='🏭', load=5,
                      pol='COD, heavy metals, oil & grease, scheduled chemical waste'),
    'makanan':   dict(label='Eateries & Restaurants', color='#e34948', icon='🍽', load=2,
                      pol='Oil & grease, BOD, food waste, detergents'),
    'perumahan': dict(label='Housing & Domestic Sewage', color='#eda100', icon='🏘', load=3,
                      pol='Domestic sewage, NH₃-N, BOD, coliforms'),
    'kumbahan':  dict(label='Sewage & Water Treatment Plants', color='#2a78d6', icon='🚰', load=4,
                      pol='NH₃-N, BOD, suspended solids from effluent discharge'),
    'sisa':      dict(label='Waste, Quarry & Disturbed Land', color='#1baf7a', icon='🚧', load=4,
                      pol='Leachate, suspended solids, turbidity, soil erosion'),
}

MAP = {
    ('landuse', 'industrial'): 'industri', ('man_made', 'works'): 'industri',
    ('man_made', 'factory'): 'industri', ('landuse', 'brownfield'): 'industri',
    ('man_made', 'wastewater_plant'): 'kumbahan', ('man_made', 'water_works'): 'kumbahan',
    ('landuse', 'landfill'): 'sisa', ('landuse', 'quarry'): 'sisa',
    ('amenity', 'waste_transfer_station'): 'sisa', ('landuse', 'construction'): 'sisa',
    ('landuse', 'farmyard'): 'sisa',
    ('landuse', 'residential'): 'perumahan',
    ('amenity', 'restaurant'): 'makanan', ('amenity', 'cafe'): 'makanan',
    ('amenity', 'food_court'): 'makanan',
}

raw = json.load(open('sources_raw.json'))
BUFFER_M = 1500     # zon riparian yang dianalisis

feats = []
skipped = 0
for e in raw['elements']:
    t = e.get('tags', {})
    cat = None
    for k, v in MAP.items():
        if t.get(k[0]) == k[1]:
            cat = v
            break
    if not cat:
        skipped += 1
        continue
    if e['type'] == 'node':
        lon, lat = e.get('lon'), e.get('lat')
    else:
        c = e.get('center') or {}
        lon, lat = c.get('lon'), c.get('lat')
    if lon is None:
        skipped += 1
        continue
    d_any, d_langat = nearest_river(lon, lat)
    if d_any > BUFFER_M:
        continue
    # Skor risiko: beban kategori × kedekatan dengan alur air
    prox = max(0.0, 1.0 - d_any / BUFFER_M)          # 1 di tebing, 0 di 1.5 km
    risk = round(CATS[cat]['load'] * (0.35 + 0.65 * prox ** 1.6), 2)
    feats.append({
        'type': 'Feature',
        'properties': {
            'id': e['id'],
            'cat': cat,
            'name': t.get('name') or t.get('operator') or None,
            'dist': round(d_any),
            'dist_langat': round(d_langat) if d_langat < 1e11 else None,
            'risk': risk,
        },
        'geometry': {'type': 'Point', 'coordinates': [round(lon, 5), round(lat, 5)]},
    })

for f in feats:
    f['properties'] = {k: v for k, v in f['properties'].items() if v is not None}

feats.sort(key=lambda f: -f['properties']['risk'])
print('POI dalam zon riparian 1.5 km:', len(feats), '| dibuang:', skipped)
print(Counter(f['properties']['cat'] for f in feats).most_common())
for b in (100, 250, 500, 1000, 1500):
    print(f'  <= {b}m :', sum(1 for f in feats if f['properties']['dist'] <= b))

json.dump({'type': 'FeatureCollection', 'name': 'punca_pencemaran',
           'meta': {'buffer_m': BUFFER_M, 'source': 'OpenStreetMap (Overpass API)',
                    'categories': CATS},
           'features': feats},
          open(os.path.join(OUT, 'pollution_sources.geojson'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
print('size KB', round(os.path.getsize(os.path.join(OUT, 'pollution_sources.geojson')) / 1024, 1))

# ---------- 3. Eksport rangkaian alur air kecil (anak sungai) ----------
trib = []
for e in ww['elements']:
    g = e.get('geometry') or []
    t = e.get('tags', {})
    if len(g) < 2:
        continue
    if t.get('waterway') not in ('river', 'canal'):
        continue
    if 'Langat' in (t.get('name') or ''):
        continue
    trib.append({'type': 'Feature',
                 'properties': {'name': t.get('name'), 'waterway': t.get('waterway')},
                 'geometry': {'type': 'LineString',
                              'coordinates': [[round(p['lon'], 5), round(p['lat'], 5)] for p in g]}})
json.dump({'type': 'FeatureCollection', 'name': 'anak_sungai', 'features': trib},
          open(os.path.join(OUT, 'tributaries.geojson'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
print('anak sungai', len(trib), 'size KB',
      round(os.path.getsize(os.path.join(OUT, 'tributaries.geojson')) / 1024, 1))
