"""Push every dataset into the Firebase Realtime Database.

    https://luas-demo-website-default-rtdb.asia-southeast1.firebasedatabase.app

One node per dataset under `/luas`, plus a `/luas/meta` node saying when each
was written and where it came from, so the database can be read without
having to come back to this repository to find out what is in it.

    ACCESS

The database rules are closed by default, which is correct - an open Realtime
Database is writable by anyone who finds the URL. Give this script a
credential in one of two ways, neither of which puts the secret in the repo:

    setx FIREBASE_DB_SECRET "..."        # Windows, then reopen the shell
    export FIREBASE_DB_SECRET="..."      # bash
    python scripts/10_push_to_firebase.py

or pass it for one run:

    python scripts/10_push_to_firebase.py --auth <secret>

The secret is the legacy database secret, from the Firebase console under
Project settings -> Service accounts -> Database secrets. If the rules have
instead been opened for a moment, the script runs with no credential at all.

    --check   report what access there is and write nothing
    --node X  push one dataset only, by its node name

    A NOTE ON WHAT THIS IS FOR

Measured on the deployed site, throttled to 4 Mbps and a 4x slower CPU, the
eight files are 197 KB over the wire and now arrive in about 0.7 s. Moving
that same geometry to the Realtime Database does not make it smaller or
nearer - GitHub Pages serves it gzipped from a CDN, the database serves it
from one region - and it does nothing at all about the 2,081 SVG paths the
map draws, which is what actually costs time on a slow device.

What the database is genuinely good for here is the data that goes stale:
the JPS water levels, which are a build-time snapshot and could be refreshed
on a schedule without redeploying the site, and the licence register, which
today lives in each browser's localStorage and is therefore not shared
between users at all. Those two are the ones worth reading live.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, 'data')

DB = 'https://luas-demo-website-default-rtdb.asia-southeast1.firebasedatabase.app'
ROOT_NODE = 'luas'

# node name -> (file, what it is)
DATASETS = [
    ('stations', 'stations.json',
     'Monitoring stations, 16 x 56 months. Positions real, readings simulated.'),
    ('water_levels', 'water_levels.json',
     'JPS river water level, 21 stations. Snapshot, see scripts/09.'),
    ('basin_pollution', 'basin_pollution.json',
     'National river basin pollution, data.gov.my water_pollution_basin.'),
    ('catchment', 'langat_basin.geojson',
     'Sungai Langat catchment, HydroSHEDS HydroBASINS level 8.'),
    ('rivers', 'langat_rivers.geojson',
     'River network, 489 reaches, OpenStreetMap via Overpass.'),
    ('waterbodies', 'waterbodies_langat.geojson',
     'Water body outlines, 1,101, Digital Earth clipped to the catchment.'),
    ('sources', 'pollution_sources.geojson',
     'Point sources, 651 sites, OpenStreetMap via Overpass.'),
    ('selangor', 'selangor_boundary.geojson',
     'Selangor state boundary, DOSM.'),
]


def parse_args(argv):
    opts = {'auth': os.environ.get('FIREBASE_DB_SECRET', ''), 'check': False, 'node': None}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--check':
            opts['check'] = True
        elif a == '--auth' and i + 1 < len(argv):
            i += 1
            opts['auth'] = argv[i]
        elif a == '--node' and i + 1 < len(argv):
            i += 1
            opts['node'] = argv[i]
        else:
            sys.exit('unknown argument: %s' % a)
        i += 1
    return opts


def url_for(path, auth):
    u = '%s/%s.json' % (DB, path)
    return u + ('?auth=' + urllib.parse.quote(auth) if auth else '')


def call(method, path, auth, payload=None):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8') if payload is not None else None
    req = urllib.request.Request(url_for(path, auth), data=body, method=method)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')


def human(n):
    return '%.1f MB' % (n / 1048576.0) if n >= 1048576 else '%d KB' % (n // 1024)


def main():
    opts = parse_args(sys.argv[1:])
    auth = opts['auth']

    print('database : %s' % DB)
    print('credential: %s' % ('database secret supplied' if auth else 'none - relying on open rules'))

    status, text = call('GET', '%s/meta/checked' % ROOT_NODE, auth)
    if status == 401:
        print('')
        print('  Permission denied. The rules are closed and no working credential was given.')
        print('  Either supply the database secret:')
        print('')
        print('      python scripts/10_push_to_firebase.py --auth <secret>')
        print('')
        print('  (Firebase console -> Project settings -> Service accounts -> Database secrets)')
        print('')
        print('  or open the rules in the console for the length of one upload:')
        print('')
        print('      { "rules": { ".read": true, ".write": true } }')
        print('')
        print('  An open database is writable by anyone who has the URL, so set the')
        print('  resting rules straight afterwards. The site reads /%s, so that subtree' % ROOT_NODE)
        print('  has to be readable; nothing in the browser writes, so nothing needs write:')
        print('')
        print('      { "rules": { "%s": { ".read": true, ".write": false } } }' % ROOT_NODE)
        print('')
        print('  A database secret bypasses rules altogether, so this script keeps working')
        print('  with ".write": false - which is the point.')
        return 1
    if status != 200:
        print('  unexpected response %d: %s' % (status, text[:200]))
        return 1

    print('access   : ok')
    if opts['check']:
        status, text = call('GET', ROOT_NODE + '/meta', auth)
        print('meta     : %s' % (text[:400] if text.strip() != 'null' else 'nothing written yet'))
        return 0

    todo = [d for d in DATASETS if opts['node'] in (None, d[0])]
    if not todo:
        sys.exit('no dataset called %r' % opts['node'])

    meta = {}
    total = 0
    for node, filename, note in todo:
        path = os.path.join(DATA, filename)
        payload = json.load(open(path, encoding='utf-8'))
        size = os.path.getsize(path)
        t0 = time.time()
        status, text = call('PUT', '%s/%s' % (ROOT_NODE, node), auth, payload)
        if status != 200:
            print('  FAILED %-16s %d %s' % (node, status, text[:160]))
            return 1
        total += size
        print('  ok  %-16s %8s  %5.1fs' % (node, human(size), time.time() - t0))
        meta[node] = {'file': filename, 'bytes': size, 'note': note}

    stamp = time.strftime('%Y-%m-%dT%H:%M:%S')
    meta['checked'] = stamp
    meta['written'] = stamp
    meta['source'] = 'github.com/Uzma-Geospatial-AI/LUAS_Prototype'
    status, text = call('PATCH', '%s/meta' % ROOT_NODE, auth, meta)
    if status != 200:
        print('  FAILED meta %d %s' % (status, text[:160]))
        return 1

    print('')
    print('wrote %d node(s), %s, at %s' % (len(todo), human(total), stamp))
    print('read one back with:')
    print('  curl "%s/%s/water_levels.json"' % (DB, ROOT_NODE))
    print('')
    print('the site reads /%s, so the subtree has to be readable:' % ROOT_NODE)
    print('  { "rules": { "%s": { ".read": true, ".write": false } } }' % ROOT_NODE)
    return 0


if __name__ == '__main__':
    sys.exit(main())
