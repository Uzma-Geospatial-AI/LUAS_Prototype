import json,math,random,os
OUT=r"c:/Users/User/Desktop/WebsiteWQI_LUAS/data"
riv=json.load(open('langat_river.geojson'))
pts=[c for f in riv['features'] for c in f['geometry']['coordinates']]
def snap(lat,lon):
    best=min(pts,key=lambda c:(c[0]-lon)**2+(c[1]-lat)**2)
    return best[1],best[0]

# Lokaliti sebenar di sepanjang Lembangan Sungai Langat (hulu -> muara)
LOC=[
 ("LGT01","Sungai Lui, Hulu Langat",            3.1900,101.8300,"Hulu Langat","hulu"),
 ("LGT02","Batu 18, Hulu Langat",               3.1450,101.8200,"Hulu Langat","hulu"),
 ("LGT03","Kampung Sungai Serai",               3.0600,101.8050,"Hulu Langat","tengah"),
 ("LGT04","Kajang (Jambatan Sungai Langat)",    2.9900,101.7900,"Hulu Langat","tengah"),
 ("LGT05","Bandar Baru Bangi",                  2.9400,101.7700,"Sepang","tengah"),
 ("LGT06","Dengkil",                            2.8600,101.6800,"Sepang","tengah"),
 ("LGT07","Sungai Labu (pertemuan)",            2.8300,101.6100,"Sepang","tengah"),
 ("LGT08","Jenjarom",                           2.8700,101.5100,"Kuala Langat","hilir"),
 ("LGT09","Banting",                            2.8100,101.5000,"Kuala Langat","hilir"),
 ("LGT10","Telok Panglima Garang",              2.9000,101.4500,"Kuala Langat","hilir"),
 ("LGT11","Muara Sungai Langat",                2.7950,101.3700,"Kuala Langat","muara"),
]
random.seed(7)
# Profil realistik: hulu bersih -> hilir tercemar (beban bandar/industri terkumpul)
PROF={
 "hulu":   dict(do=(7.2,8.4),bod=(1.0,2.2),cod=(6,14),ss=(8,28),an=(0.02,0.14),ph=(6.6,7.2)),
 "tengah": dict(do=(4.2,6.2),bod=(3.0,6.5),cod=(20,42),ss=(40,110),an=(0.5,1.6),ph=(6.3,7.4)),
 "hilir":  dict(do=(2.6,4.6),bod=(5.0,9.5),cod=(35,68),ss=(90,240),an=(1.2,2.8),ph=(6.2,7.6)),
 "muara":  dict(do=(3.4,5.4),bod=(3.5,7.0),cod=(28,55),ss=(120,320),an=(0.8,2.0),ph=(6.8,7.9)),
}
def rv(r,j=0.0):
    a,b=r; return a+(b-a)*random.random()+j

MONTHS=[]
for y in range(2021,2026):
    for m in range(1,13):
        if y==2025 and m>8: break
        MONTHS.append(f"{y}-{m:02d}")

stations=[]
for code,name,lat,lon,daerah,seg in LOC:
    slat,slon=snap(lat,lon)
    p=PROF[seg]
    series=[]
    for mk in MONTHS:
        mon=int(mk[5:7])
        # monsun: hujan Nov-Jan -> SS naik, BOD sedikit dilute
        wet = 1.0 + (0.55 if mon in (11,12,1) else (0.2 if mon in (3,4,10) else 0.0))
        series.append({
            "t": mk,
            "do":  round(max(0.4,rv(p['do'])* (1.05 if mon in (11,12,1) else 1.0)),2),
            "bod": round(max(0.3,rv(p['bod'])/ (1.15 if mon in (11,12,1) else 1.0)),2),
            "cod": round(max(2,rv(p['cod'])),1),
            "ss":  round(max(3,rv(p['ss'])*wet),1),
            "an":  round(max(0.01,rv(p['an'])),3),
            "ph":  round(rv(p['ph']),2),
        })
    stations.append({"code":code,"name":name,"lat":round(slat,5),"lon":round(slon,5),
                     "district":daerah,"segment":seg,"river":"Sungai Langat","series":series})

# Anak sungai utama (tributari) - stesen tambahan
TRIB=[
 ("SMY01","Sungai Semenyih, Semenyih",   2.9550,101.8430,"Hulu Langat","tengah","Sungai Semenyih"),
 ("BRG01","Sungai Beranang, Beranang",   2.9150,101.8600,"Hulu Langat","tengah","Sungai Beranang"),
 ("LBU01","Sungai Labu, Labu",           2.8000,101.7300,"Sepang","tengah","Sungai Labu"),
 ("JLH01","Sungai Jelok, Kajang",        2.9980,101.7860,"Hulu Langat","hilir","Sungai Jelok"),
 ("BLK01","Sungai Balak, Kajang",        3.0100,101.7600,"Hulu Langat","hilir","Sungai Balak"),
]
for code,name,lat,lon,daerah,seg,river in TRIB:
    p=PROF[seg]; series=[]
    for mk in MONTHS:
        mon=int(mk[5:7]); wet=1.0+(0.5 if mon in (11,12,1) else 0.15)
        series.append({"t":mk,"do":round(max(0.4,rv(p['do'])),2),"bod":round(max(0.3,rv(p['bod'])),2),
                       "cod":round(max(2,rv(p['cod'])),1),"ss":round(max(3,rv(p['ss'])*wet),1),
                       "an":round(max(0.01,rv(p['an'])),3),"ph":round(rv(p['ph']),2)})
    stations.append({"code":code,"name":name,"lat":lat,"lon":lon,"district":daerah,
                     "segment":seg,"river":river,"series":series})

meta={"generated":"2025-09-03","note":"Kedudukan stesen di-snap kepada geometri Sungai Langat (OpenStreetMap). Nilai parameter adalah DATA CONTOH bagi tujuan demonstrasi - gantikan dengan bacaan rasmi DOE/LUAS.","parameters":["do","bod","cod","ss","an","ph"],"months":MONTHS}
json.dump({"meta":meta,"stations":stations},open(os.path.join(OUT,'stations.json'),'w'),separators=(',',':'))
print('stations',len(stations),'months',len(MONTHS),'size KB',round(os.path.getsize(os.path.join(OUT,'stations.json'))/1024,1))
for s in stations[:12]: print(s['code'],s['name'],s['lat'],s['lon'])
