# Portal Indeks Kualiti Air (WQI) — Lembangan Sungai Langat

Portal pemantauan **Indeks Kualiti Air (WQI)** bagi Lembangan Sungai Langat, dibina untuk
**Lembaga Urus Air Selangor (LUAS)**. Menggabungkan data badan air, pencerapan satelit dan
pemetaan punca pencemaran guna tanah di sepanjang koridor sungai.

Laman statik sepenuhnya — tiada pelayan belakang, tiada langkah binaan, tiada kunci API.

---

## Menjalankan portal

Modul JavaScript memerlukan protokol `http://`, jadi membuka `index.html` terus daripada fail
(`file://`) **tidak** akan berfungsi.

```bash
python serve.py          # http://localhost:8000
python serve.py 8080     # port lain
```

Atau mana-mana pelayan statik lain:

```bash
npx serve .
php -S localhost:8000
```

---

## Kandungan portal

| Paparan | Apa yang ada |
|---|---|
| **Peta Interaktif** | Sungai Langat diwarnakan mengikut WQI, 16 stesen pemantauan, 3,605 punca pencemaran berkelompok, badan air, anak sungai, sempadan daerah lembangan. Peluncur masa 56 bulan mewarnakan semula sungai dan stesen. Klik stesen → panel penuh sub-indeks + arah aliran + tekanan guna tanah radius 3 km. |
| **Papan Pemuka** | KPI lembangan, arah aliran WQI mengikut empat segmen sungai, profil hulu→muara, taburan lima kelas, sub-indeks purata, trend lembangan kebangsaan (data.gov.my 2000–2021), jadual bacaan penuh. |
| **Punca Pencemaran** | Lima kategori guna tanah, kiraan mengikut jalur jarak, taburan jarak ke alur air, senarai 120 lokasi berisiko tertinggi dengan nama sebenar OSM. |
| **Pencerapan Satelit** | Enam lapisan satelit (Esri resolusi tinggi + lima lapisan harian NASA GIBS dengan pemilih tarikh), tindanan sungai/stesen/punca, rujukan indeks spektrum air (NDWI, NDTI, NDCI, LST). |
| **Panduan WQI** | Lima aras indeks pencemaran (INWQS), formula DOE penuh, pemberat parameter, ambang setiap parameter, jadual asal-usul semua data. |

---

## Lima aras indeks pencemaran (INWQS, DOE Malaysia)

| Kelas | Julat WQI | Status | Kegunaan |
|---|---|---|---|
| **I** | 92.7 – 100 | Sangat Bersih | Bekalan air tanpa rawatan · habitat sensitif |
| **II** | 76.5 – 92.7 | Bersih | Rawatan konvensional · rekreasi kontak badan |
| **III** | 51.9 – 76.5 | Sederhana Tercemar | Rawatan lanjutan · perikanan toleran |
| **IV** | 31.0 – 51.9 | Tercemar | Pengairan pertanian sahaja |
| **V** | 0 – 31.0 | Sangat Tercemar | Tiada kegunaan bermanfaat |

Palet lima kelas ini lulus semakan keterbezaan warna untuk buta warna (deutan/protan/tritan),
dan setiap penggunaannya turut membawa label teks atau angka — warna tidak pernah menjadi
satu-satunya pembawa maklumat.

---

## Pengiraan WQI

`js/wqi.js` melaksanakan **formula rasmi Jabatan Alam Sekitar (DOE) Malaysia** sepenuhnya —
bukan anggaran:

```
WQI = 0.22·SI_DO + 0.19·SI_BOD + 0.16·SI_COD
    + 0.15·SI_NH3N + 0.16·SI_SS + 0.12·SI_pH
```

Setiap sub-indeks menggunakan persamaan *best-fit* DOE (bercabang mengikut julat), dan DO
dinormalkan kepada peratus ketepuan melalui kelarutan oksigen bergantung suhu sebelum
disubkan. Semua nilai WQI di seluruh portal dikira semula dalam pelayar daripada enam
parameter mentah — tiada nilai WQI disimpan dalam fail data.

---

## Sumber data

| Set data | Sumber | Status |
|---|---|---|
| Pencemaran lembangan sungai (198 rekod, 2000–2021) | [`data.gov.my` · `water_pollution_basin`](https://api.data.gov.my/data-catalogue?id=water_pollution_basin) | **Sebenar** |
| Badan air Malaysia (121 MB → dipangkas ke Selangor) | [Digital Earth · `malaysia_water_bodies.geojson`](https://digitalearthgeojson.s3.ap-southeast-5.amazonaws.com/malaysia_water_bodies.geojson) | **Sebenar** |
| Geometri Sungai Langat (24 segmen, 2,157 bucu) | OpenStreetMap · Overpass API | **Sebenar** |
| Anak sungai & terusan (960 alur) | OpenStreetMap · Overpass API | **Sebenar** |
| Punca pencemaran (3,605 lokasi) | OpenStreetMap · Overpass API | **Sebenar** |
| Sempadan daerah lembangan | OpenStreetMap · `admin_level=6` | **Sebenar** |
| Imej satelit | NASA EOSDIS GIBS · Esri World Imagery | **Sebenar** |
| Bacaan parameter 16 stesen (56 bulan) | Dijana untuk demonstrasi | ⚠️ **CONTOH** |

### ⚠️ Notis ketulenan data

Kedudukan 16 stesen pemantauan di-*snap* kepada geometri Sungai Langat yang sebenar di
lokaliti sebenar (Sungai Lui, Kajang, Dengkil, Banting, muara, dan anak sungai utama).
**Bacaan enam parameter di stesen tersebut adalah data contoh**, dijana mengikut profil
hulu-bersih → hilir-tercemar yang munasabah dengan kesan bermusim, semata-mata untuk
menunjukkan fungsi portal.

Ia **bukan bacaan rasmi** dan tidak boleh digunakan untuk membuat keputusan. Gantikan
`data/stations.json` dengan bacaan pemantauan sebenar LUAS/DOE mengikut skema yang sama;
seluruh portal akan mengira semula WQI, kelas, arah aliran dan carta secara automatik tanpa
sebarang perubahan kod.

### Skema `data/stations.json`

```jsonc
{
  "meta": { "months": ["2021-01", "..."], "parameters": ["do","bod","cod","ss","an","ph"] },
  "stations": [{
    "code": "LGT04",
    "name": "Kajang (Jambatan Sungai Langat)",
    "lat": 2.98932, "lon": 101.78734,
    "district": "Hulu Langat",
    "segment": "tengah",              // hulu | tengah | hilir | muara
    "river": "Sungai Langat",
    "series": [{
      "t": "2021-01",
      "do": 5.35,    // mg/L
      "bod": 5.62,   // mg/L
      "cod": 29.3,   // mg/L
      "ss": 56.0,    // mg/L
      "an": 1.294,   // mg/L (NH3-N)
      "ph": 7.27
    }]
  }]
}
```

---

## Kaedah pemetaan punca pencemaran

1. Semua lokasi guna tanah dalam kotak sempadan koridor Langat diambil daripada OpenStreetMap
   (`landuse`, `man_made`, `amenity`).
2. Skopnya dihadkan kepada tiga daerah yang membentuk lembangan: **Hulu Langat, Sepang,
   Kuala Langat** (poligon `admin_level=6` OSM, ujian titik-dalam-poligon).
3. Bagi setiap lokasi, jarak tegak ke **alur air terdekat** (42,519 segmen sungai/terusan/parit)
   dikira dengan indeks grid spatial; hanya yang berada dalam **zon riparian 1.5 km** disimpan.
4. Skor risiko `= beban_kategori × (0.35 + 0.65 · kedekatan^1.6)`, di mana kedekatan menyusut
   secara linear dari 1 di tebing kepada 0 pada 1.5 km.

Skor risiko ialah **proksi tekanan guna tanah**, bukan ukuran pelepasan sebenar. Ia menyusun
lokasi mengikut kebarangkalian menyumbang pencemar — bukan mendakwa mana-mana premis
mencemarkan sungai.

| Kategori | Bilangan | Pencemar utama |
|---|---|---|
| Perumahan & Kumbahan Domestik | 1,564 | Kumbahan domestik, NH₃-N, BOD, koliform |
| Kedai Makan & Restoran | 1,321 | Minyak & gris, BOD, sisa makanan, detergen |
| Industri & Kilang | 309 | COD, logam berat, minyak & gris, sisa kimia terjadual |
| Sisa, Kuari & Tanah Terganggu | 266 | Larut lesap, SS, kekeruhan, hakisan tanah |
| Loji Kumbahan & Rawatan Air | 145 | NH₃-N, BOD, pepejal terampai dari efluen |

---

## Sentinel-2 (pilihan)

Lapisan harian NASA GIBS ialah 250–500 m/piksel — cukup untuk kepulan sedimen di muara dan
kejadian banjir, tetapi terlalu kasar untuk satu segmen sungai. Untuk NDWI/NDTI/NDCI pada
10–20 m, daftar akaun percuma di
[Copernicus Data Space](https://dataspace.copernicus.eu/) dan tambah lapisan WMTS anda dalam
`SAT_LAYERS` (`js/satellite.js`):

```js
sentinel2: {
  label: 'Sentinel-2 L2A — NDWI',
  res: '10 m', kind: 'Setiap 5 hari', use: '…',
  daily: false,
  make: () => L.tileLayer.wms('https://sh.dataspace.copernicus.eu/ogc/wms/<INSTANCE-ID>', {
    layers: 'NDWI', format: 'image/png', transparent: true, maxZoom: 16,
  }),
},
```

---

## Membina semula data

Skrip ETL dalam `scripts/` menjana semula segala-galanya dalam `data/` (Python 3, pustaka
standard sahaja):

```bash
python scripts/01a_fetch_langat_river.py        # geometri Sungai Langat (Overpass)
python scripts/01b_fetch_waterways.py           # semua alur air koridor (Overpass)
python scripts/01c_fetch_pollution_sources.py   # POI guna tanah (Overpass)
python scripts/01d_fetch_districts.py           # sempadan daerah (Overpass)
python scripts/02_clip_waterbodies.py           # pangkas geojson 121 MB → Selangor
python scripts/03_build_sources.py              # kategori + jarak + skor risiko
python scripts/04_build_stations.py             # stesen (GANTIKAN dengan data sebenar)
python scripts/05_build_districts.py            # poligon daerah + tapisan skop
```

Skrip `01*` dan `02` memerlukan sambungan internet dan memuat turun ke direktori kerja semasa;
jalankannya dari direktori yang mengandungi fail perantaraan.

---

## Struktur projek

```
index.html                  satu laman, lima paparan
css/styles.css              sistem reka bentuk (jenama LUAS)
js/wqi.js                   formula WQI DOE + lima kelas
js/data.js                  pemuatan data + terbitan
js/mapview.js               peta Leaflet, lapisan, panel butiran
js/dashboard.js             carta Chart.js
js/satellite.js             lapisan satelit + indeks spektrum
js/app.js                   navigasi + permulaan
data/*.geojson, *.json      data yang telah diproses (~4.5 MB)
scripts/*.py                saluran ETL
serve.py                    pelayan pembangunan tempatan
```

---

## Pergantungan

Dimuatkan daripada CDN pada masa jalan — tiada `npm install`:

- [Leaflet](https://leafletjs.com/) 1.9.4 + [MarkerCluster](https://github.com/Leaflet/Leaflet.markercluster) 1.5.3
- [Chart.js](https://www.chartjs.org/) 4.5.0

---

## Penghargaan

Formula WQI: Jabatan Alam Sekitar Malaysia (DOE) ·
Data terbuka: [data.gov.my](https://data.gov.my) ·
Peta: [© Penyumbang OpenStreetMap](https://openstreetmap.org/copyright) ·
Imej: NASA EOSDIS GIBS / Worldview, Esri World Imagery ·
Badan air: Digital Earth
