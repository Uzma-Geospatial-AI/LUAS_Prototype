"""Build the river water level layer for the Sungai Langat catchment.

Source: Jabatan Pengairan dan Saliran (JPS/DID) - Public InfoBanjir
        https://publicinfobanjir.water.gov.my/aras-air/data-paras-air/?state=SEL

Two endpoints are needed, because neither one alone is enough:

  1. the state water level table, which carries the four official threshold
     levels (Normal, Waspada, Amaran, Bahaya) and the current reading, but no
     coordinates at all;
  2. the map feed `latestreadingstrendabc.json`, which carries the coordinates,
     the trend, and DID's own status for each station.

They are joined on the station id in the table's graph link
(`/wl-graph/?stationid=2816041_`), which is the feed's own key. All 21 Langat
stations join, so nothing here is matched by name.

    WHY THIS IS A SNAPSHOT AND NOT LIVE

Neither endpoint sends `Access-Control-Allow-Origin`, so a static page served
from GitHub Pages cannot read them from the browser - the request is blocked
before it is made. The readings are therefore fetched here, at build time, and
carry the station clock they were read at. The map says that time plainly. A
water level shown without its timestamp would read as current, and during a
flood an hour-old level presented as current is worse than no level at all.

    WHICH STATIONS

Filtered on DID's own basin attribution (`Lembangan = Sungai Langat`), not on
the catchment polygon. These are DID's stations and it is DID's basin
definition; overruling their attribution with a different delineation would be
us second-guessing the source. One of the 21 - RS Batu 8, on the coastal plain
- falls outside the HydroSHEDS polygon the rest of this map is clipped to,
because the two delineations disagree along the coast (the same known
difference behind 2,140 km2 here versus the ~2,350 km2 DID quotes). It is kept,
flagged `inCatchment: false`, and it draws where it actually is.

    STATUS

DID publishes its own status per station, and that is what is used. Where a
station is offline or erroring, DID leaves the status blank or says "Error";
those become `offline` rather than being given a level of their own. A reading
is NOT reclassified against the thresholds here even though the thresholds are
present - several stations report 0.00 while offline, and a 0.00 measured
against a 76.80 m normal level would be published as "far below normal" when
what it means is "no reading".

Run 06 first: the catchment polygon is what the `inCatchment` flag is tested
against.
"""
import json
import os
import re
import ssl
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'data')

BASIN = os.path.join(OUT, 'langat_basin.geojson')
DEST = os.path.join(OUT, 'water_levels.json')

SITE = 'https://publicinfobanjir.water.gov.my'
TABLE = SITE + '/index.php/aras-air/data-paras-air/aras-air-data/?state=SEL&district=ALL&station=ALL'
FEED = SITE + '/wp-content/themes/enlighten/data/latestreadingstrendabc.json'
UA = 'LUAS-Prototype/1.0 (https://github.com/Uzma-Geospatial-AI/LUAS_Prototype)'

BASIN_NAME = 'Langat'          # DID's own attribution, matched loosely

# DID's status wording -> our key. Anything else, including blank, is offline.
STATUS = {
    'normal': 'normal', 'alert': 'waspada', 'waspada': 'waspada',
    'warning': 'amaran', 'amaran': 'amaran',
    'danger': 'bahaya', 'bahaya': 'bahaya',
}

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE          # the portal's chain is incomplete


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': SITE})
    return urllib.request.urlopen(req, timeout=120, context=CTX).read().decode('utf-8', 'replace')


def txt(html):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', html)).strip()


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ---------------- catchment, for the flag only ----------------
bgeom = json.load(open(BASIN, encoding='utf-8'))['features'][0]['geometry']
BPOLYS = bgeom['coordinates'] if bgeom['type'] == 'MultiPolygon' else [bgeom['coordinates']]


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


def in_basin(pt):
    for rings in BPOLYS:
        if in_ring(pt, rings[0]) and not any(in_ring(pt, h) for h in rings[1:]):
            return True
    return False


# ---------------- the feed: coordinates, trend, status ----------------
print('fetching the map feed ...')
feed = {x['a']: x for x in json.loads(get(FEED))}
print('  %d stations nationwide' % len(feed))

# ---------------- the table: readings and thresholds ----------------
print('fetching the Selangor water level table ...')
html = get(TABLE)
body = html[html.find('<tbody'):]
rows = re.findall(r'<tr[^>]*>(.*?)</tr>', body, re.S)
print('  %d rows for Selangor' % len(rows))

stations = []
latest = ''
unmatched = []

for row in rows:
    cell = [txt(c) for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S)]
    if len(cell) < 12:
        continue
    sid, name, district, basin, sub, updated, level = cell[1:8]
    if BASIN_NAME not in basin:
        continue

    link = re.search(r"stationid=([^'\"&]+)", row)
    f = feed.get(link.group(1)) if link else None
    if f is None:
        unmatched.append(name)
        continue

    lat, lon = num(f.get('c')), num(f.get('d'))
    if lat is None or lon is None:
        unmatched.append(name)
        continue

    status = STATUS.get((f.get('n') or '').strip().lower(), 'offline')
    reading = num(level)
    th = {
        'normal': num(cell[8]), 'waspada': num(cell[9]),
        'amaran': num(cell[10]), 'bahaya': num(cell[11]),
    }

    stations.append({
        'id': sid,
        'key': link.group(1),
        'name': name,
        'district': district,
        'basin': basin,
        'sub': sub,
        'lat': round(lat, 6),
        'lon': round(lon, 6),
        'level': reading if status != 'offline' else None,
        'updated': updated,
        'trend': (f.get('s') or '').strip() or None,
        'th': th,
        'status': status,
        'inCatchment': in_basin((lon, lat)),
    })
    latest = max(latest, updated)

stations.sort(key=lambda s: -s['lat'])

by = {}
for s in stations:
    by[s['status']] = by.get(s['status'], 0) + 1
out_of = [s['name'] for s in stations if not s['inCatchment']]

print('')
print('%d Langat stations' % len(stations))
for k in ('normal', 'waspada', 'amaran', 'bahaya', 'offline'):
    if by.get(k):
        print('  %-8s %d' % (k, by[k]))
if unmatched:
    print('  no coordinates, dropped: %s' % ', '.join(unmatched))
if out_of:
    print('  outside the HydroSHEDS catchment: %s' % ', '.join(out_of))

json.dump({
    'source': 'Jabatan Pengairan dan Saliran (JPS) - Public InfoBanjir',
    'url': SITE + '/aras-air/data-paras-air/?state=SEL&type=NEGERI',
    'basin': 'Sungai Langat',
    'latest': latest,
    'note': 'Snapshot taken when this file was built. Not a live feed.',
    'stations': stations,
}, open(DEST, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('')
print('wrote %s' % os.path.relpath(DEST, ROOT))
