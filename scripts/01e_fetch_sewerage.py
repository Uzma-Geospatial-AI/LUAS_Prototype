"""Fetch the drainage and sewerage network for the Langat corridor from OpenStreetMap.

In Malaysia the reticulated sewer network is operated by IWK and is not open data,
so OpenStreetMap holds almost no `substance=sewage` pipelines. What it does hold —
and what actually carries domestic sewage, greywater and urban run-off into the
Langat River — is the surface drainage network: monsoon drains (`waterway=drain`)
and smaller ditches (`waterway=ditch`), plus the culverted reaches that run
underground. Those are the layer this script builds, together with whatever
sewer-specific assets are mapped.
"""
import json
import urllib.request
import urllib.parse

BBOX = "2.65,101.30,3.20,101.90"

QUERY = f"""
[out:json][timeout:300];
(
  way["waterway"="drain"]({BBOX});
  way["waterway"="ditch"]({BBOX});
  way["man_made"="pipeline"]["substance"~"sewage|wastewater|water",i]({BBOX});
  node["man_made"="pumping_station"]({BBOX});
  node["man_made"="manhole"]["manhole"~"sewer|drain",i]({BBOX});
);
out geom;
"""

data = urllib.parse.urlencode({'data': QUERY}).encode()
req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=data,
                             headers={'User-Agent': 'LUAS-WQI/1.0'})
result = json.load(urllib.request.urlopen(req, timeout=320))
json.dump(result, open('sewerage_raw.json', 'w'))

from collections import Counter                                    # noqa: E402
counts = Counter()
for e in result['elements']:
    t = e.get('tags', {})
    counts[t.get('waterway') or t.get('man_made') or 'other'] += 1
print('elements', len(result['elements']))
print(counts.most_common())
