# LUAS System — Sungai Langat

A water quality and discharge load management system for **Lembaga Urus Air Selangor
(LUAS)**, covering the **Sungai Langat catchment** — the 2,140 km² of Selangor whose run-off
reaches the river. Built by Geospatial AI Sdn Bhd, an Uzma Group company.

Live: https://uzma-geospatial-ai.github.io/LUAS_Prototype/

1. **Map** — satellite imagery, the catchment and its rivers, 16 stations, 1,101 water bodies
   and 651 pollution sources, all filterable and steppable through 56 months.
2. **Phase 1 · Station Assessment** — six DOE parameters → WQI → does the reach hold Class II?
3. **Phase 2 · Quality Monitoring** — how often each parameter breaches, and how it trends.
4. **Phase 3 · LEDS · TMDL · SESAMS** — what the reach can carry, what it carries now, and
   how much is left to licence.

Fully static — no backend, no build step, no API keys. Any station can be selected from the
app bar and every phase follows it.

---

## Tech stack

- **Vanilla ES modules** — no framework, no bundler, no `npm install`
- **Leaflet 1.9.4** — the map, eight basemaps, vector overlays
- **Chart.js 4.5.0** — trends and the load budget chart
- **Python 3 standard library** — the whole ETL, including a shapefile reader
- **GitHub Actions → Pages** — validates JS, JSON and the WQI formula, then deploys

---

## Folder structure

```
LUAS_Prototype/
├── index.html                 sidebar shell: map + three phases, one page
├── serve.py                   local development server
├── css/
│   └── styles.css             design system (LUAS brand)
├── js/
│   ├── app.js                 routing, app bar, station picker
│   ├── data.js                loading, derivation, compliance record
│   ├── wqi.js                 DOE WQI formula + INWQS class standards
│   ├── loads.js               load, TMDL, headroom and effluent-standard maths
│   ├── store.js               localStorage: readings, SESAMS register, conditions
│   ├── mapview.js             the map, its four corners and the legend filter
│   ├── symbols.js             one shape per pollution source category
│   ├── satellite.js           imagery catalogue + spectral index reference
│   ├── phase1.js              station assessment + class calculator
│   ├── phase2.js              monitoring, water bodies, national context
│   └── phase3.js              TMDL budget + licence register
├── data/
│   ├── langat_basin.geojson       the catchment
│   ├── langat_rivers.geojson      489 river reaches
│   ├── waterbodies_langat.geojson 1,101 water body outlines
│   ├── pollution_sources.geojson  651 sites in the riparian zone
│   ├── selangor_boundary.geojson  state boundary
│   ├── stations.json              16 stations x 56 months
│   └── basin_pollution.json       national basin pollution, data.gov.my
└── scripts/                   the ETL, one step per file
```

---

## Local development

JavaScript modules need `http://`, so opening `index.html` from disk will not work.

```bash
# 1. serve
python serve.py            # → http://localhost:8000
python serve.py 8080       # a different port

# 2. rebuild the data (optional, see below)
python scripts/01_fetch_waterbodies.py
```

> Python 3.10+ recommended. No dependencies.

---

## The focus area

Everything is clipped to the **Sungai Langat catchment**: the land whose run-off reaches the
river, and therefore the area whose discharge the load budget has to account for. It comes from
HydroSHEDS HydroBASINS level 8, where the Langat resolves to a single basin (HYBAS_ID
4080020780) draining straight to the Strait of Malacca, so nothing upstream has to be gathered.

Every `waterway=river` inside that catchment drains to Sungai Langat — that is what a catchment
is — so the polygon is the only filter the river network needs.

> HydroSHEDS delineates from 15 arc-second flow direction, so its 2,140 km² differs a little
> from the ~2,350 km² DID usually quotes. Replace `data/langat_basin.geojson` with the DID
> delineation if you have it and re-run the water body build.

---

## The map

The map fills the window and every corner says what it is counting.

| Corner | What it holds |
|---|---|
| Top left | Four chips: stations, WQI at the selected station, how many meet the target class, pollution sources |
| Top right | The basemap in use, with all eight behind it |
| Bottom left | Layer masters, each with its own count |
| Bottom centre | The month on show — a slider across all 56, with play |
| Bottom right | The legend, which is also the filter |

**The legend is the filter.** Every row is a switch: turn off *Slightly Polluted* and those
stations leave the map, turn off *Ponds* and the ponds go. Twenty rows across four groups. The
layer masters command a group of rows — switching one off clears the group, and it reads back as
on, off or part-on from its members, so the two panels cannot disagree. The legend folds to a
single pill when it is in the way.

**The month slider** moves the whole map through the record: every station marker and every chip
repaints, so the reach can be watched changing rather than read one month at a time.

### Layers

| Layer | What it is |
|---|---|
| Monitoring stations | 16 stations, drawn as their WQI and coloured by DOE class |
| Water bodies | 1,101 Digital Earth outlines, coloured by type |
| Pollution sources | 651 sites that can put a load into the river, one shape per category |
| Sungai Langat & tributaries | 682 km of mapped channel, main channel drawn heavier |
| Langat catchment | 2,140 km², the clip for everything else |
| Selangor boundary | the state LUAS is responsible for, Federal Territories excluded |

### Basemaps

| Layer | Resolution | Source |
|---|---|---|
| Esri World Imagery | ≈ 0.3 – 1 m | Esri · Maxar |
| Google Satellite / Hybrid | ≈ 0.15 – 1 m | Google |
| Sentinel-2 Cloudless | 10 m | EOX · ESA Copernicus (CC BY-NC-SA 4.0) |
| VIIRS · MODIS false colour 7-2-1 | 250 m, daily | NASA EOSDIS GIBS |
| OpenStreetMap · OpenTopoMap | vector | OSM contributors |

> Google tiles are read from the public endpoint, which suits a prototype but is not a licensed
> integration. For production, move to the Google Maps Platform with an API key, or rely on the
> Esri and Sentinel-2 layers, which are openly licensed.

---

## Pollution sources

What can put a load into the river, from OpenStreetMap. Each category has its own **shape** as
well as its own colour, so the five stay tellable apart on a busy satellite basemap, in
greyscale, and for viewers with colour-vision deficiency. Marker size carries the screening risk.

| Symbol | Category | Count | Typically carries |
|---|---|---|---|
| ■ square | Industry & factories | 244 | COD, heavy metals, oil & grease, scheduled chemical waste |
| ◆ diamond | Sewage & water treatment | 142 | NH₃-N, BOD, suspended solids in the effluent |
| ▲ triangle | Landfill, quarry & waste | 16 | Leachate, suspended solids, turbidity |
| ⬟ pentagon | Construction & cleared land | 228 | Suspended solids, soil erosion, turbidity |
| ● circle | Farms & aquaculture | 21 | BOD, NH₃-N, nutrients, animal waste |

Two filters, in order: inside the catchment, then **within 1.5 km of the nearest receiving
water**. The second one matters — a factory 8 km from any water still discharges somewhere, but
through a drain this dataset does not have. That cut takes 3,441 candidates down to 651.

**Receiving water is not only the river.** A pond, an oxidation basin or an ex-mining lake is
what many of these sites actually discharge into; the river only gets it afterwards. Distances
are measured to rivers *and* water bodies, and **410 of the 651 sites are nearer a water body
than a channel**. Clicking a source names the water it reaches, and the pin beside the distance
flies to the site and flashes that river or pond.

> ⚠️ **The risk score is a screening aid, not a measurement.** It is the category's load weight
> — judgement, not metering — scaled by closeness to water. Use it to order inspections, never to
> attribute a load. Nothing in this layer is metered.

---

## Phase 1 — Station assessment

`js/wqi.js` implements the **official DOE Malaysia formula** in full:

```
WQI = 0.22·SI_DO + 0.19·SI_BOD + 0.16·SI_COD
    + 0.15·SI_NH3N + 0.16·SI_SS + 0.12·SI_pH
```

DO is normalised to percent saturation through a temperature-dependent solubility curve before
being sub-indexed. Every WQI in the system is recomputed in the browser from the six raw
parameters — none is stored.

The index alone does not decide compliance, so each reading is also tested against the **INWQS
ambient standards**:

| Class | NH₃-N | BOD₅ | COD | SS | DO | pH |
|---|---|---|---|---|---|---|
| I | 0.1 | 1 | 10 | 25 | ≥ 7 | 6.5 – 8.5 |
| **II** | **0.3** | **3** | **25** | **50** | **≥ 5** | **6 – 9** |
| III | 0.9 | 6 | 50 | 150 | ≥ 3 | 5 – 9 |
| IV | 2.7 | 12 | 100 | 300 | — | 5 – 9 |

A calculator takes six parameters typed by hand and returns the index, its class, every
sub-index, and a pass/fail — parameter by parameter.

---

## Phase 2 — Quality monitoring

- **Exceedance frequency** per parameter across the record, worst first
- **Receiving water bodies** grouped by type, with surface areas
- **Parameter trends** against the standard, one chart each
- **National context** — basin pollution status from data.gov.my, by parameter and year

---

## Phase 3 — LEDS · TMDL · SESAMS

```
TMDL = ΣWLA + ΣLA + MOS
```

| Term | Meaning | Where it comes from |
|---|---|---|
| **TMDL** | Loading capacity of the reach | standard × design flow × 86.4 |
| **WLA** | Wasteload allocation | the SESAMS licence register |
| **LA** | Load allocation | background and non-point, inferred as the balance |
| **MOS** | Margin of safety | a set percentage of capacity |

**Units.** River load `kg/day = C (mg/L) × Q (m³/s) × 86.4`. Licence wasteload
`kg/day = C (mg/L) × Q (m³/day) ÷ 1000`.

The in-river concentration is the **12-month median** at the selected station, which is steadier
than any single sample. Remaining capacity is `TMDL − MOS − current load`, converted into the
volume of new effluent that could still be licensed. The pollutant that runs out first is the
binding one.

Target class, design river flow, margin of safety and the effluent standard are all editable,
and every figure recomputes from them.

> ⚠️ **The design flow ships as an unverified estimate (4.5 m³/s).** A TMDL must be written for a
> low-flow design condition — MAM7 or 7Q10 — because that is when the river has least capacity to
> assimilate a load. Replace it with the DID gauged record and tick **Verified**. Every load
> figure scales linearly with it.

> ⚠️ **No LUAS licence register is published as open data**, so five worked examples ship with
> the system to make the budget computable. Every one is badged **EXAMPLE**, and *Clear examples*
> removes them for good.

---

## Data

| Dataset | Source | Status |
|---|---|---|
| National river basin pollution, 198 records 2000–2021 | [`data.gov.my` · `water_pollution_basin`](https://api.data.gov.my/data-catalogue?id=water_pollution_basin) | **Real** |
| Water bodies, 1,101 outlines | [Digital Earth · `malaysia_water_bodies.geojson`](https://digitalearthgeojson.s3.ap-southeast-5.amazonaws.com/malaysia_water_bodies.geojson) | **Real** |
| Sungai Langat catchment, 2,140 km² | [HydroSHEDS · HydroBASINS Asia level 8](https://www.hydrosheds.org/products/hydrobasins) | **Real** |
| River network, 489 reaches, 682 km | [OpenStreetMap](https://www.openstreetmap.org) via Overpass | **Real** |
| Pollution sources, 651 sites | [OpenStreetMap](https://www.openstreetmap.org) via Overpass | **Real** (risk score ⚠️ derived) |
| Selangor state boundary | [DOSM · `administrative_1_state.geojson`](https://github.com/dosm-malaysia/data-open) | **Real** |
| Satellite imagery | Esri · Google · EOX · NASA GIBS | **Real** |
| Station parameter readings, 16 × 56 months | Generated for demonstration | ⚠️ **SAMPLE** |
| Effluent discharge licences | Five worked examples | ⚠️ **SAMPLE** |

> ⚠️ **Station positions are real**, snapped to the Langat channel at real localities. **The six
> parameter readings at them are not** — they are generated along a plausible
> upstream-to-downstream profile, and must not be used for decisions.

Replace `data/stations.json` with actual LUAS/DOE data using the same schema and the whole
system — index, class, exceedance, load budget, remaining capacity — recomputes with no code
changes:

```jsonc
{
  "meta": { "months": ["2021-01", "..."], "parameters": ["do","bod","cod","ss","an","ph"] },
  "stations": [{
    "code": "LGT06", "name": "Dengkil",
    "lat": 2.85971, "lon": 101.68380,
    "district": "Sepang", "river": "Sungai Langat",
    "series": [{ "t": "2021-01", "do": 6.1, "bod": 4.01, "cod": 26.7,
                 "ss": 85.3, "an": 0.632, "ph": 6.95 }]
  }]
}
```

---

## Rebuilding the data

Run in this order — later steps read what earlier ones write.

```bash
python scripts/01_fetch_waterbodies.py         # 121 MB Digital Earth national file
python scripts/06_fetch_langat_basin.py        # HydroSHEDS catchment
python scripts/07_fetch_langat_rivers.py       # OSM rivers inside the catchment
python scripts/02_build_waterbodies.py         # clip to the catchment, simplify outlines
python scripts/08_build_pollution_sources.py   # OSM sources in the riparian zone
python scripts/03_fetch_basin_pollution.py     # data.gov.my water_pollution_basin
python scripts/04_build_stations.py            # stations (REPLACE with real readings)
python scripts/05_fetch_selangor_boundary.py   # DOSM state boundary
```

Intermediate downloads (`*_raw.geojson`, `*_raw.json`, `hybas_*.zip`) are gitignored and
re-fetched on demand.

---

## Deployment

`.github/workflows/deploy.yml` runs on every push to `main`:

1. `node --check` every JS module
2. parse every JSON and GeoJSON, and report its record count
3. verify the WQI formula against one reference case per class
4. verify every local file the app references exists
5. publish the repository as-is to GitHub Pages

The site is static, so there is nothing to build — any static host works:

```bash
# GitHub Pages, S3, Cloudflare Pages, Netlify …
# upload the repository directory as-is
```

---

## Credits

- WQI formula and INWQS — Department of Environment Malaysia (DOE)
- Effluent standards — EQ (Industrial Effluent) Regulations 2009
- Open data — [data.gov.my](https://data.gov.my)
- State boundary — [Department of Statistics Malaysia](https://github.com/dosm-malaysia/data-open)
- Catchment — [HydroSHEDS HydroBASINS](https://www.hydrosheds.org/) (CC BY 4.0, WWF / USGS)
- Rivers and pollution sources — [OpenStreetMap](https://www.openstreetmap.org) contributors (ODbL)
- Water bodies — Digital Earth
- Imagery — Esri, Google, [EOX Sentinel-2 cloudless](https://s2maps.eu), NASA EOSDIS GIBS
- Map library — [Leaflet](https://leafletjs.com/) · Charts — [Chart.js](https://www.chartjs.org/)
