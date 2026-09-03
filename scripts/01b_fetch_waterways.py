import json,urllib.request,urllib.parse
BBOX="2.65,101.30,3.20,101.90"
q=f'[out:json][timeout:300];(way["waterway"~"^(river|stream|canal|drain)$"]({BBOX}););out geom;'
data=urllib.parse.urlencode({'data':q}).encode()
req=urllib.request.Request('https://overpass-api.de/api/interpreter',data=data,headers={'User-Agent':'LUAS-WQI/1.0'})
r=json.load(urllib.request.urlopen(req,timeout=320))
json.dump(r,open('waterways_raw.json','w'))
print('ways',len(r['elements']))
