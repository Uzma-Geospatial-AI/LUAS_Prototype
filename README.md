# Water Quality Index (WQI) Portal — Langat River Basin

A Water Quality Index monitoring portal for the Langat River Basin, built for
**Lembaga Urus Air Selangor (LUAS)**. It brings together water body data, satellite observation
and land-use pollution source mapping along the river corridor.

Fully static — no backend, no build step, no API keys.

---

## Running the portal

JavaScript modules require the `http://` protocol, so opening `index.html` straight from disk
(`file://`) will **not** work.

```bash
python serve.py          # http://localhost:8000
python serve.py 8080     # a different port
```

Or any other static server:

```bash
npx serve .
php -S localhost:8000
```

---

## What's in the portal

| View | Contents |
|---|---|
| **Interactive Map** | A full-width map with one compact toolbar: **Base map** (13 layers — four cartographic, five high-resolution satellite mosaics, four daily NASA GIBS layers with a date picker), **Layers**, **Sources** (category filter + riparian distance), **Station** (searchable — picking one flies the map to it and opens its panel), and a 56-month **Period** slider. The station panel shows all six sub-indices, the WQI trend and 3 km land-use pressure. A collapsible legend sits at the bottom right. |
| **Dashboard** | Two tabs. *Water Quality*: basin KPIs, WQI trend across four river reaches, headwaters→estuary profile, five-class distribution, mean sub-indices, national basin trend (data.gov.my 2000–2021) and the full readings table. *Pollution Sources*: five land-use categories, counts by distance band, distance-to-watercourse histogram and the 120 highest-risk locations with their real OSM names. |
| **Data Entry** | Key in water quality readings with a live WQI calculation, or report a pollution source by clicking the map. Export to files that merge straight into the shipped datasets. |
| **WQI Guide** (📖 icon) | The five pollution index levels (INWQS), the full DOE formula, parameter weights, per-parameter thresholds, the satellite imagery and spectral index reference, and the provenance of every dataset. |

---

## The five pollution index levels (INWQS, DOE Malaysia)

| Class | WQI range | Status | Use |
|---|---|---|---|
| **I** | 92.7 – 100 | Excellent | Water supply with no treatment · sensitive habitat |
| **II** | 76.5 – 92.7 | Clean | Conventional treatment · body-contact recreation |
| **III** | 51.9 – 76.5 | Slightly Polluted | Extensive treatment · tolerant fisheries |
| **IV** | 31.0 – 51.9 | Polluted | Irrigation only |
| **V** | 0 – 31.0 | Very Polluted | No beneficial use |

This five-colour ramp passes colour-vision-deficiency separation checks (deutan/protan/tritan),
and every use of it also carries a text or numeric label — colour is never the sole carrier of
meaning. The five pollution source categories use a separate categorical palette validated
across all pairs, and each category also carries **its own map shape** — square for industry,
circle for eateries, house for housing, diamond for treatment plants, triangle for waste and
disturbed land — so they stay tellable apart on a busy satellite basemap and in greyscale.

---

## WQI calculation

`js/wqi.js` implements the **official Department of Environment (DOE) Malaysia formula** in
full — not an approximation:

```
WQI = 0.22·SI_DO + 0.19·SI_BOD + 0.16·SI_COD
    + 0.15·SI_NH3N + 0.16·SI_SS + 0.12·SI_pH
```

Each sub-index uses the DOE best-fit equations (branching by range), and DO is normalised to
percent saturation through a temperature-dependent oxygen solubility curve before being
sub-indexed. Every WQI value across the portal is recomputed in the browser from the six raw
parameters — no WQI value is stored in the data files. The GitHub Actions workflow verifies the
implementation against one reference case per class on every push.

---

## Data sources

| Dataset | Source | Status |
|---|---|---|
| River basin pollution (198 records, 2000–2021) | [`data.gov.my` · `water_pollution_basin`](https://api.data.gov.my/data-catalogue?id=water_pollution_basin) | **Real** |
| Malaysia water bodies (121 MB → clipped to Selangor) | [Digital Earth · `malaysia_water_bodies.geojson`](https://digitalearthgeojson.s3.ap-southeast-5.amazonaws.com/malaysia_water_bodies.geojson) | **Real** |
| Langat River geometry (24 segments, 2,157 vertices) | OpenStreetMap · Overpass API | **Real** |
| Tributaries & canals (960 watercourses) | OpenStreetMap · Overpass API | **Real** |
| Pollution sources (3,605 locations) | OpenStreetMap · Overpass API | **Real** |
| Basin district boundaries | OpenStreetMap · `admin_level=6` | **Real** |
| Satellite imagery | NASA EOSDIS GIBS · Esri · Google · EOX Sentinel-2 cloudless | **Real** |
| Parameter readings at 16 stations (56 months) | Generated for demonstration | ⚠️ **SAMPLE** |

### ⚠️ Data provenance notice

The 16 monitoring stations are snapped to the real Langat River geometry at real localities
(Sungai Lui, Kajang, Dengkil, Banting, the estuary, and the main tributaries).
**The six parameter readings at those stations are sample data**, generated along a plausible
clean-upstream → polluted-downstream profile with seasonal effects, purely to demonstrate the
portal.

They are **not official readings** and must not be used for decisions. Replace
`data/stations.json` with actual LUAS/DOE monitoring readings using the same schema; the whole
portal recomputes WQI, classes, trends and charts automatically with no code changes.

### `data/stations.json` schema

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

## Data entry

The **Data Entry** view lets anyone add data without touching the code.

**Water quality reading** — pick a station (or define a new one), enter the six DOE parameters,
and the WQI, its class and all six sub-indices are computed live as you type. Values outside the
plausible range are flagged, and each field reports which DOE band the value falls in.

**Pollution source report** — name a premises, choose a category, and click the map to place it.
The portal then computes, in the browser, the distance to the nearest watercourse (searching a
grid index over all 984 river and tributary lines), which basin district the point falls in, and
a risk score using the same formula as the main ETL pipeline.

**Storage.** There is no backend, so entries live in `localStorage` — this browser only, visible
to you alone. They appear immediately as their own map layers ("My readings", "My reported
sources") and in the records table.

**Making entries permanent.** Export produces files matching the shipped schemas:

- *Export readings (JSON)* → merge into `data/stations.json`
- *Export sources (GeoJSON)* → merge into `data/pollution_sources.geojson`
- *Export readings (CSV)* → for spreadsheets and reporting

Commit the merged file and the entry becomes part of the portal for everyone. Import accepts any
of those files back, so a set of entries can be moved between machines.

---

## Pollution source mapping method

1. Every land-use location in the Langat corridor bounding box is fetched from OpenStreetMap
   (`landuse`, `man_made`, `amenity`).
2. Scope is restricted to the three districts that make up the basin: **Hulu Langat, Sepang,
   Kuala Langat** (OSM `admin_level=6` polygons, point-in-polygon test).
3. For each location, the perpendicular distance to the **nearest watercourse** (42,519 river,
   canal and drain segments) is computed via a spatial grid index; only those inside the
   **1.5 km riparian zone** are kept.
4. Risk score `= category_load × (0.35 + 0.65 · proximity^1.6)`, where proximity falls linearly
   from 1 at the bank to 0 at 1.5 km.

The risk score is a **land-use pressure proxy, not a measurement of discharge**. It ranks
locations by how likely they are to contribute pollutants — it does not claim that any premises
is polluting the river.

| Category | Count | Principal pollutants |
|---|---|---|
| Housing & Domestic Sewage | 1,564 | Domestic sewage, NH₃-N, BOD, coliforms |
| Eateries & Restaurants | 1,321 | Oil & grease, BOD, food waste, detergents |
| Industry & Factories | 309 | COD, heavy metals, oil & grease, scheduled chemical waste |
| Waste, Quarry & Disturbed Land | 266 | Leachate, suspended solids, turbidity, soil erosion |
| Sewage & Water Treatment Plants | 145 | NH₃-N, BOD, suspended solids from effluent discharge |

---

## Base maps and satellite imagery

| Layer | Resolution | Source |
|---|---|---|
| Street Map / Topographic / Dark / Light | Vector | OpenStreetMap · OpenTopoMap · CARTO |
| Esri World Imagery | ≈ 0.3 – 1 m | Esri, Maxar, Earthstar Geographics |
| Esri Clarity | ≈ 0.3 – 1 m | Esri (alternative capture dates) |
| Google Satellite / Google Hybrid | ≈ 0.15 – 1 m | Google |
| Sentinel-2 Cloudless | 10 m | EOX IT Services · ESA Copernicus (CC BY-NC-SA 4.0) |
| MODIS Terra / Aqua, VIIRS, False Colour 7-2-1, Night Lights | 250 – 500 m, daily | NASA EOSDIS GIBS |

A place-and-boundary label overlay (Esri) can be switched on over any satellite layer.

> **Note on Google tiles.** The portal reads Google's tile endpoint directly, which is convenient
> for a prototype but is not a licensed integration. For a production deployment, move to the
> official Google Maps Platform with an API key, or rely on the Esri and Sentinel-2 layers, which
> are openly licensed.

---

## Sentinel-2 spectral indices (optional)

NASA GIBS daily layers are 250–500 m/pixel — enough for estuary sediment plumes and flood events,
too coarse for a single river reach. For NDWI/NDTI/NDCI at 10–20 m, register a free account at
[Copernicus Data Space](https://dataspace.copernicus.eu/) and add your WMTS layer to `SAT_LAYERS`
in `js/satellite.js`:

```js
sentinel2_ndwi: {
  label: 'Sentinel-2 L2A — NDWI',
  res: '10 m', kind: 'Every 5 days', use: '…',
  daily: false,
  make: () => L.tileLayer.wms('https://sh.dataspace.copernicus.eu/ogc/wms/<INSTANCE-ID>', {
    layers: 'NDWI', format: 'image/png', transparent: true, maxZoom: 16,
  }),
},
```

---

## Rebuilding the data

The ETL scripts in `scripts/` regenerate everything in `data/` (Python 3, standard library only):

```bash
python scripts/01a_fetch_langat_river.py        # Langat River geometry (Overpass)
python scripts/01b_fetch_waterways.py           # all corridor watercourses (Overpass)
python scripts/01c_fetch_pollution_sources.py   # land-use POIs (Overpass)
python scripts/01d_fetch_districts.py           # district boundaries (Overpass)
python scripts/02_clip_waterbodies.py           # clip the 121 MB geojson to Selangor
python scripts/03_build_sources.py              # categorise + distance + risk score
python scripts/04_build_stations.py             # stations (REPLACE with real data)
python scripts/05_build_districts.py            # district polygons + scope filter
```

The `01*` and `02` scripts need an internet connection and download into the current working
directory; run them from the directory holding the intermediate files.

---

## Project structure

```
index.html                  one page, six views
css/styles.css              design system (LUAS brand)
js/wqi.js                   DOE WQI formula + the five classes
js/data.js                  data loading, derivation, spatial queries
js/mapview.js               Leaflet map, base maps, layers, detail panel
js/dashboard.js             Chart.js charts and tables
js/satellite.js             daily GIBS layers + spectral index reference
js/symbols.js               per-category map shapes
js/store.js                 localStorage store, export/import
js/entry.js                 data entry forms with live computation
js/app.js                   routing + bootstrap
data/*.geojson, *.json      processed data (~4.5 MB)
scripts/*.py                ETL pipeline
serve.py                    local development server
.github/workflows/deploy.yml  validation + GitHub Pages deployment
```

---

## Dependencies

Loaded from CDN at runtime — no `npm install`:

- [Leaflet](https://leafletjs.com/) 1.9.4 + [MarkerCluster](https://github.com/Leaflet/Leaflet.markercluster) 1.5.3
- [Chart.js](https://www.chartjs.org/) 4.5.0

---

## Credits

WQI formula: Department of Environment Malaysia (DOE) ·
Open data: [data.gov.my](https://data.gov.my) ·
Maps: [© OpenStreetMap contributors](https://openstreetmap.org/copyright) ·
Imagery: NASA EOSDIS GIBS / Worldview, Esri, Google, EOX Sentinel-2 cloudless ·
Water bodies: Digital Earth
