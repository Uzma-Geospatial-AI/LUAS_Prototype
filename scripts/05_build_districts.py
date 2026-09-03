"""Cantumkan ahli relation OSM menjadi poligon daerah lembangan Sungai Langat."""
import json, os

OUT = r"c:/Users/User/Desktop/WebsiteWQI_LUAS/data"
raw = json.load(open('districts_raw.json'))


def stitch(ways):
    """Sambung senarai laluan (senarai titik) menjadi gelang tertutup."""
    segs = [list(w) for w in ways if len(w) > 1]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]; segs.pop(i); changed = True; break
                if s[-1] == cur[-1]:
                    cur += s[::-1][1:]; segs.pop(i); changed = True; break
                if s[-1] == cur[0]:
                    cur = s[:-1] + cur; segs.pop(i); changed = True; break
                if s[0] == cur[0]:
                    cur = s[::-1][:-1] + cur; segs.pop(i); changed = True; break
        if len(cur) > 3:
            if cur[0] != cur[-1]:
                cur.append(cur[0])
            rings.append(cur)
    return rings


feats = []
for e in raw['elements']:
    name = e['tags'].get('name')
    outer = []
    for m in e.get('members', []):
        if m.get('role') not in ('outer', ''):
            continue
        g = m.get('geometry')
        if not g:
            continue
        outer.append([(round(p['lon'], 5), round(p['lat'], 5)) for p in g])
    rings = stitch(outer)
    rings.sort(key=len, reverse=True)
    polys = [[[list(p) for p in r]] for r in rings]
    feats.append({
        'type': 'Feature',
        'properties': {'name': name, 'admin_level': 6, 'osm_id': e['id']},
        'geometry': {'type': 'MultiPolygon', 'coordinates': polys},
    })
    print(name, '->', len(rings), 'gelang, bucu terbesar', len(rings[0]) if rings else 0)

json.dump({'type': 'FeatureCollection', 'name': 'daerah_lembangan_langat', 'features': feats},
          open(os.path.join(OUT, 'districts.geojson'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
print('size KB', round(os.path.getsize(os.path.join(OUT, 'districts.geojson')) / 1024, 1))


# ---- Tapis punca pencemaran kepada tiga daerah lembangan ----
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


rings_all = []
for f in feats:
    for poly in f['geometry']['coordinates']:
        r = poly[0]
        xs = [p[0] for p in r]; ys = [p[1] for p in r]
        rings_all.append((f['properties']['name'], r,
                          min(xs), min(ys), max(xs), max(ys)))


def district_of(lon, lat):
    for name, r, x0, y0, x1, y1 in rings_all:
        if x0 <= lon <= x1 and y0 <= lat <= y1 and in_ring(lon, lat, r):
            return name
    return None


src = json.load(open(os.path.join(OUT, 'pollution_sources.geojson'), encoding='utf-8'))
kept = []
for f in src['features']:
    lon, lat = f['geometry']['coordinates']
    d = district_of(lon, lat)
    if d is None:
        continue
    f['properties']['district'] = d
    kept.append(f)

from collections import Counter
print('\npunca sebelum', len(src['features']), '-> selepas tapisan daerah', len(kept))
print(Counter(f['properties']['district'] for f in kept).most_common())
print(Counter(f['properties']['cat'] for f in kept).most_common())
for b in (100, 250, 500, 1000, 1500):
    print(f'  <= {b}m :', sum(1 for f in kept if f['properties']['dist'] <= b))

src['features'] = kept
src['meta']['scope'] = ('Daerah Hulu Langat, Kuala Langat dan Sepang '
                        '(sempadan pentadbiran OpenStreetMap, admin_level=6)')
json.dump(src, open(os.path.join(OUT, 'pollution_sources.geojson'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
print('size KB', round(os.path.getsize(os.path.join(OUT, 'pollution_sources.geojson')) / 1024, 1))
