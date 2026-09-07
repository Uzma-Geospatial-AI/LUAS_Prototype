"""Build the rainfall layer for the Sungai Langat catchment.

Source: Jabatan Pengairan dan Saliran (JPS/DID) - Public InfoBanjir
        https://publicinfobanjir.water.gov.my/hujan/data-hujan/?state=SEL&type=NEGERI

    WHERE THE NUMBERS COME FROM

The rainfall page renders its table in the browser, so there is nothing to
scrape from its HTML. The readings are in the same map feed the water level
layer already uses - `latestreadingstrendabc.json` - which carries every DID
telemetry station in the country with both its water level and its rainfall.
A station's `i` field lists what it measures: `RF` for rainfall, `WL` for
water level, often both.

The four rainfall fields are cumulative totals over increasing windows, in
millimetres:

    t = 1 hour     u = 3 hours     v = 6 hours     w = 24 hours

They are monotonic (each window contains the shorter ones), which is checked
here rather than assumed. `-9999` is DID's missing marker and becomes null,
not zero: a station that did not report is not a station that recorded no
rain, and on a heatmap the difference is the whole point.

    WHY THIS IS A SNAPSHOT AND NOT LIVE

The feed sends no `Access-Control-Allow-Origin`, so a static page served from
GitHub Pages cannot read it from the browser. The readings are fetched here,
at build time, and carry the station clock they were read at. The map says
that time plainly, because rainfall shown without its timestamp reads as
current, and during a storm an hour-old total presented as current is worse
than no total at all.

    HUMIDITY

DID does not publish humidity, and neither does anything else this project
can reach. The humidity written here is SIMULATED: a deterministic value per
station, drawn from its position and the rainfall it recorded, so a wet
station reads damper than a dry one and the same station always reads the
same. It is flagged `simulated: true` in the file, badged in the legend, and
is there to show the layer working, not to be believed. Every station's
position, name, district and rainfall are real.

    WHICH STATIONS

DID's own basin attribution (`Lembangan = Sungai Langat`), the same rule the
water level layer follows, rather than the HydroSHEDS polygon the rest of the
map is clipped to. Stations outside that polygon are kept and flagged, since
rain falling just outside the delineation still fell.

Run:  python scripts/12_fetch_rainfall.py
"""
import json
import math
import os
import ssl
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'data')

BASIN = os.path.join(OUT, 'langat_basin.geojson')
DEST = os.path.join(OUT, 'rainfall.json')

SITE = 'https://publicinfobanjir.water.gov.my'
FEED = SITE + '/wp-content/themes/enlighten/data/latestreadingstrendabc.json'
UA = 'LUAS-Prototype/1.0 (https://github.com/Uzma-Geospatial-AI/LUAS_Prototype)'

BASIN_NAME = 'langat'
MISSING = -9999

# DID's own rainfall bands, off the legend on the source page (mm in 24 h)
BANDS = [
    ('none', 'Tiada hujan', 'No rain', 0),
    ('light', 'Renyai', 'Light', 1),
    ('moderate', 'Sederhana', 'Moderate', 11),
    ('heavy', 'Lebat', 'Heavy', 31),
    ('very', 'Sangat lebat', 'Very heavy', 61),
]

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE          # the portal's chain is incomplete


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': SITE})
    return urllib.request.urlopen(req, timeout=120, context=CTX).read().decode('utf-8', 'replace')


def mm(v):
    """A millimetre reading, or None where the station did not report."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f <= MISSING or f < 0:
        return None
    return round(f, 1)


def sortable(stamp):
    """DID writes dd/mm/yyyy hh:mm, which does not sort as text."""
    try:
        d, t = stamp.split(' ')
        dd, mm_, yy = d.split('/')
        return '%s-%s-%s %s' % (yy, mm_, dd, t)
    except (ValueError, AttributeError):
        return ''


def band(v):
    if v is None:
        return None
    key = 'none'
    for k, _ms, _en, lo in BANDS:
        if v >= lo:
            key = k
    return key


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
    for poly in BPOLYS:
        if in_ring(pt, poly[0]) and not any(in_ring(pt, h) for h in poly[1:]):
            return True
    return False


# ---------------- simulated humidity ----------------
def humidity(sid, lat, lon, rain24):
    """Deterministic, and never presented as measured.

    Built so it reads the way humidity actually behaves rather than as noise:
    it rises with the rain the station recorded, is a little higher towards
    the coast in the west and the forested hills in the east, and carries a
    small fixed wobble per station so no two read alike. The station id seeds
    the wobble, so the same station always gives the same figure.
    """
    h = 0
    for ch in str(sid):
        h = (h * 31 + ord(ch)) % 2147483647
    wobble = ((h * 2654435761) % 1000) / 1000.0          # 0..1, fixed per station
    base = 72 + 8 * wobble
    wet = 14 * (1 - math.exp(-(rain24 or 0) / 12.0))     # damp after rain, tapering off
    coast = 4 * max(0.0, (101.55 - lon) / 0.5)           # the estuary end is muggier
    hills = 3 * max(0.0, (lon - 101.85) / 0.3)           # so is the forest above Hulu Langat
    return round(min(99.0, base + wet + min(4.0, coast) + min(3.0, hills)), 1)


# ---------------- read ----------------
print('reading the DID telemetry feed...')
feed = json.loads(get(FEED))
print('  %d stations nationwide' % len(feed))

rows = [x for x in feed
        if BASIN_NAME in str(x.get('h', '')).lower() and 'RF' in str(x.get('i', ''))]
print('  %d rainfall stations attributed to Sungai Langat' % len(rows))

stations = []
latest = ''
non_monotonic = []
reporting = 0
for x in rows:
    try:
        lat, lon = float(x['c']), float(x['d'])
    except (TypeError, ValueError, KeyError):
        continue
    if not (2.0 < lat < 4.5 and 100.0 < lon < 102.5):
        continue

    win = {'h1': mm(x.get('t')), 'h3': mm(x.get('u')), 'h6': mm(x.get('v')), 'h24': mm(x.get('w'))}
    got = [v for v in win.values() if v is not None]
    seq = [win[k] for k in ('h1', 'h3', 'h6', 'h24') if win[k] is not None]
    if seq != sorted(seq):
        non_monotonic.append(x.get('b', x.get('a')))
    if got:
        reporting += 1

    when = str(x.get('y') or '').strip()
    if sortable(when) > sortable(latest):
        latest = when

    stations.append({
        'id': str(x.get('a', '')),
        'name': str(x.get('b', '')).strip(),
        'district': str(x.get('e', '')).strip(),
        'sub': str(x.get('g', '')).strip(),
        'lat': round(lat, 6),
        'lon': round(lon, 6),
        **win,
        'band': band(win['h24']),
        'humidity': humidity(x.get('a'), lat, lon, win['h24']),
        'updated': when,
        'inCatchment': in_basin([lon, lat]),
    })

stations.sort(key=lambda s: (s['district'], s['name']))
wet = [s for s in stations if (s['h24'] or 0) > 0]
inside = sum(1 for s in stations if s['inCatchment'])

print('')
print('%d rainfall stations' % len(stations))
print('  %d reporting a reading, %d silent' % (reporting, len(stations) - reporting))
print('  %d inside the HydroSHEDS catchment, %d outside it' % (inside, len(stations) - inside))
print('  %d recorded rain in the last 24 h%s' % (
    len(wet), (': ' + ', '.join('%s %s mm' % (s['name'][:28], s['h24']) for s in wet[:6])) if wet else ''))
if non_monotonic:
    print('  windows not monotonic, kept as read: %s' % ', '.join(str(n)[:28] for n in non_monotonic[:4]))
print('  latest station clock: %s' % (latest or 'unknown'))

json.dump({
    'source': 'Jabatan Pengairan dan Saliran (JPS) - Public InfoBanjir',
    'url': SITE + '/hujan/data-hujan/?state=SEL&type=NEGERI',
    'basin': 'Sungai Langat',
    'latest': latest,
    'windows': {'h1': '1 hour', 'h3': '3 hours', 'h6': '6 hours', 'h24': '24 hours'},
    'bands': [{'key': k, 'ms': ms, 'en': en, 'from': lo} for k, ms, en, lo in BANDS],
    'note': 'Rainfall is a snapshot taken when this file was built, not a live feed. '
            'Humidity is SIMULATED per station and is not a measurement: DID does not publish it.',
    'humiditySimulated': True,
    'stations': stations,
}, open(DEST, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('')
print('wrote %s' % os.path.relpath(DEST, ROOT))
