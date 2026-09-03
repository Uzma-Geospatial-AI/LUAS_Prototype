import json,urllib.request,urllib.parse
BBOX="2.65,101.30,3.20,101.90"
q=f"""
[out:json][timeout:300];
(
  nwr["landuse"="industrial"]({BBOX});
  nwr["man_made"="wastewater_plant"]({BBOX});
  nwr["landuse"="landfill"]({BBOX});
  nwr["amenity"="waste_transfer_station"]({BBOX});
  nwr["amenity"="restaurant"]({BBOX});
  nwr["amenity"="food_court"]({BBOX});
  nwr["amenity"="cafe"]({BBOX});
  nwr["landuse"="residential"]({BBOX});
  nwr["landuse"="farmyard"]({BBOX});
  nwr["landuse"="quarry"]({BBOX});
  nwr["man_made"="works"]({BBOX});
  nwr["landuse"="construction"]({BBOX});
);
out center tags;
"""
data=urllib.parse.urlencode({'data':q}).encode()
req=urllib.request.Request('https://overpass-api.de/api/interpreter',data=data,headers={'User-Agent':'LUAS-WQI/1.0'})
r=json.load(urllib.request.urlopen(req,timeout=320))
json.dump(r,open('sources_raw.json','w'))
print('elements',len(r['elements']))
