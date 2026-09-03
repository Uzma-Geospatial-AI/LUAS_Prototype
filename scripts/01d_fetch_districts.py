import json,urllib.request,urllib.parse
q = '''
[out:json][timeout:180];
(
  relation["boundary"="administrative"]["admin_level"="6"]["name"~"Hulu Langat|Kuala Langat|Sepang",i](2.5,101.2,3.4,102.0);
);
out geom;
'''
data=urllib.parse.urlencode({'data':q}).encode()
req=urllib.request.Request('https://overpass-api.de/api/interpreter',data=data,headers={'User-Agent':'LUAS-WQI/1.0'})
r=json.load(urllib.request.urlopen(req,timeout=200))
json.dump(r,open('districts_raw.json','w'))
for e in r['elements']:
    t=e.get('tags',{})
    print(e['type'],e['id'],t.get('name'),'| members',len(e.get('members',[])))
