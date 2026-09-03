"""Download the national river basin pollution series from data.gov.my.

    https://api.data.gov.my/data-catalogue?id=water_pollution_basin

Proportion of monitored river basins that are clean / slightly polluted /
polluted, by year and by parameter (BOD5, NH3-N, SS). Used as the national
context in Phase 2. The endpoint 301-redirects, so redirects must be followed.
"""
import json
import os
import urllib.request

URL = 'https://api.data.gov.my/data-catalogue?id=water_pollution_basin&limit=10000'
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'data', 'basin_pollution.json')

req = urllib.request.Request(URL, headers={'User-Agent': 'LUAS-System/1.0'})
rows = json.load(urllib.request.urlopen(req, timeout=120))

years = sorted({r['date'][:4] for r in rows})
print(f'{len(rows)} records · {years[0]}–{years[-1]}')
json.dump(rows, open(OUT, 'w', encoding='utf-8'), separators=(',', ':'))
print('wrote', OUT)
