import json,urllib.request,urllib.parse,sys
# Sungai Langat corridor bbox (S,W,N,E)
BBOX="2.65,101.30,3.20,101.90"
q=f"""
[out:json][timeout:180];
(
  way["waterway"="river"]["name"~"Langat",i]({BBOX});
  relation["waterway"="river"]["name"~"Langat",i]({BBOX});
);
out geom;
"""
data=urllib.parse.urlencode({'data':q}).encode()
req=urllib.request.Request('https://overpass-api.de/api/interpreter',data=data,headers={'User-Agent':'LUAS-WQI/1.0'})
r=json.load(urllib.request.urlopen(req,timeout=200))
print('elements',len(r['elements']))
json.dump(r,open('langat_river.json','w'))
for e in r['elements'][:5]:
    print(e['type'],e['id'],e.get('tags',{}).get('name'),len(e.get('geometry',[]) or []))
