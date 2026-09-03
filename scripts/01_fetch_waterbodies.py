"""Download the Digital Earth Malaysia water bodies file.

    https://digitalearthgeojson.s3.ap-southeast-5.amazonaws.com/malaysia_water_bodies.geojson

121 MB, 30,207 polygons covering the whole country. Run 02_build_waterbodies.py
afterwards to clip it to the Dengkil reach and reduce it to what the portal ships.
"""
import urllib.request

URL = ('https://digitalearthgeojson.s3.ap-southeast-5.amazonaws.com/'
       'malaysia_water_bodies.geojson')
OUT = 'waterbodies_raw.geojson'

print(f'downloading {URL}')
with urllib.request.urlopen(URL, timeout=600) as r, open(OUT, 'wb') as f:
    total = int(r.headers.get('Content-Length') or 0)
    done = 0
    while chunk := r.read(1 << 20):
        f.write(chunk)
        done += len(chunk)
        if total:
            print(f'\r  {done / 1e6:.1f} / {total / 1e6:.1f} MB', end='')
print(f'\nwrote {OUT}')
