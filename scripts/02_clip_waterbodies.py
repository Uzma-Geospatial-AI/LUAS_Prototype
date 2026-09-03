import json,re,sys
# Selangor + Langat basin bbox
W,S,E,N = 100.60, 2.40, 102.10, 3.95
LW,LS,LE,LN = 101.20, 2.60, 102.00, 3.35
def bbox_of(geom):
    xs=[];ys=[]
    def walk(c):
        if isinstance(c[0],(int,float)):
            xs.append(c[0]);ys.append(c[1])
        else:
            for x in c: walk(x)
    walk(geom['coordinates'])
    return min(xs),min(ys),max(xs),max(ys)
out=[];kept=0;total=0
with open('waterbodies_raw.geojson',encoding='utf-8') as f:
    for line in f:
        line=line.strip()
        if not line.startswith('{ "type": "Feature"'): continue
        total+=1
        s=line.rstrip(',')
        try: ft=json.loads(s)
        except Exception: continue
        g=ft.get('geometry')
        if not g: continue
        x0,y0,x1,y1=bbox_of(g)
        if x1<W or x0>E or y1<S or y0>N: continue
        p=ft['properties']
        keep={k:p.get(k) for k in ('osm_id','name','name:ms','water','natural','waterway','landuse','basin','wikipedia') if p.get(k)}
        cx,cy=(x0+x1)/2,(y0+y1)/2
        keep['in_langat'] = LW<=cx<=LE and LS<=cy<=LN
        area=(x1-x0)*(y1-y0)
        keep['bbox_area']=round(area,8)
        out.append({'type':'Feature','properties':keep,'geometry':g})
        kept+=1
print('total features scanned',total,'kept',kept)
fc={'type':'FeatureCollection','name':'selangor_water_bodies','features':out}
json.dump(fc,open('waterbodies_selangor.geojson','w'))
import os;print('size MB',round(os.path.getsize('waterbodies_selangor.geojson')/1e6,2))
from collections import Counter
print(Counter(f['properties'].get('water') or f['properties'].get('natural') for f in out).most_common(10))
print('langat',sum(1 for f in out if f['properties']['in_langat']))
