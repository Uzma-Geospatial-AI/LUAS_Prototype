# LUAS System — Sungai Langat

A three-phase water quality and discharge load management system for
**Lembaga Urus Air Selangor (LUAS)**, built around the Sungai Langat monitoring station at
**Dengkil**.

Fully static — no backend, no build step, no API keys.

| Phase | What it answers |
|---|---|
| **1 · Station Assessment** | Six DOE parameters → WQI → does the reach hold **Class II**? |
| **2 · Quality Monitoring** | How often does each parameter breach the standard, what does the receiving environment look like, and how does the reach appear from orbit? |
| **3 · LEDS · TMDL · SESAMS** | What load may the reach carry, what is it carrying now, and **how much is left to licence**? |

---

## Running it

JavaScript modules need the `http://` protocol, so opening `index.html` straight from disk
will not work.

```bash
python serve.py          # http://localhost:8000
python serve.py 8080     # a different port
```

---

## Phase 1 — Station assessment

`js/wqi.js` implements the **official DOE Malaysia formula** in full:

```
WQI = 0.22·SI_DO + 0.19·SI_BOD + 0.16·SI_COD
    + 0.15·SI_NH3N + 0.16·SI_SS + 0.12·SI_pH
```

Each sub-index uses the DOE best-fit equations, and DO is normalised to percent saturation
through a temperature-dependent solubility curve before being sub-indexed. Every WQI in the
system is recomputed in the browser from the six raw parameters — none is stored.

The index alone does not decide compliance, so each reading is also tested against the
**INWQS ambient standards** for the target class:

| Class | NH₃-N | BOD₅ | COD | SS | DO | pH |
|---|---|---|---|---|---|---|
| I | 0.1 | 1 | 10 | 25 | ≥ 7 | 6.5 – 8.5 |
| **II** | **0.3** | **3** | **25** | **50** | **≥ 5** | **6 – 9** |
| III | 0.9 | 6 | 50 | 150 | ≥ 3 | 5 – 9 |
| IV | 2.7 | 12 | 100 | 300 | — | 5 – 9 |

A **calculator** takes six parameters typed by hand and returns the index, its class, every
sub-index, and a pass/fail against Class II — parameter by parameter.

---

## Phase 2 — Quality monitoring and pollution

- **Exceedance frequency** per parameter across the record, worst first.
- **Receiving water bodies** — 449 lakes, ponds, treatment basins and wetlands within 15 km of
  the station, clipped from the Digital Earth national file, grouped by type with surface areas.
- **Satellite observation** — six imagery layers over the reach with those water bodies drawn on
  top, sized by area, plus the NDWI / NDTI / NDCI / LST reference.
- **Parameter trends** against the standard, the basin station table, the full monthly record,
  and the national basin context from data.gov.my.

### Imagery layers

| Layer | Resolution | Source |
|---|---|---|
| Esri World Imagery | ≈ 0.3 – 1 m | Esri · Maxar |
| Google Satellite / Hybrid | ≈ 0.15 – 1 m | Google |
| Sentinel-2 Cloudless | 10 m | EOX · ESA Copernicus (CC BY-NC-SA 4.0) |
| VIIRS true colour · MODIS false colour 7-2-1 | 250 m, daily | NASA EOSDIS GIBS |

> Google tiles are read from the public endpoint, which suits a prototype but is not a licensed
> integration. For production, move to the Google Maps Platform with an API key, or rely on the
> Esri and Sentinel-2 layers, which are openly licensed.

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

**Units.** River load `kg/day = C (mg/L) × Q (m³/s) × 86.4`.
Licence wasteload `kg/day = C (mg/L) × Q (m³/day) ÷ 1000`.

The in-river concentration is the **12-month median** at the Phase 1 station, which is steadier
than any single sample. Diffuse load is whatever the river carries that licensed point sources do
not account for. Remaining capacity is `TMDL − MOS − current load`, and is converted into the
**volume of new effluent that could still be licensed** at Standard A or B — the answer to
*berapa lagi yang tinggal*. The pollutant that runs out first is the binding one.

### Design conditions

Target class, **design river flow**, margin of safety and the effluent standard are all editable,
and every figure on the page recomputes from them.

> ⚠️ **The design flow ships as an unverified estimate (4.5 m³/s).** A TMDL must be written for a
> low-flow design condition — MAM7 or 7Q10 — because that is when the river has least capacity to
> assimilate a load. Replace it with the DID gauged record for Sungai Langat at Dengkil and tick
> **Verified**. Every load figure scales linearly with it.

### SESAMS register

Licence reference, premises, category, permitted flow and permitted concentration per pollutant.
The system computes each licence's wasteload, flags any that exceed the chosen effluent standard,
totals the committed load, and shows whether a proposed new licence fits the remaining capacity.
Add, edit, suspend, delete, export to JSON/CSV, import back.

> ⚠️ **No LUAS licence register is published as open data**, so five worked examples ship with the
> system to make the budget computable. Every one is badged **EXAMPLE**, and *Clear examples*
> removes them for good.

---

## Data

| Dataset | Source | Status |
|---|---|---|
| National river basin pollution, 198 records 2000–2021 | [`data.gov.my` · `water_pollution_basin`](https://api.data.gov.my/data-catalogue?id=water_pollution_basin) | **Real** |
| Water bodies, 449 within 15 km of Dengkil | [Digital Earth · `malaysia_water_bodies.geojson`](https://digitalearthgeojson.s3.ap-southeast-5.amazonaws.com/malaysia_water_bodies.geojson) | **Real** |
| Satellite imagery | Esri · Google · EOX Sentinel-2 cloudless · NASA GIBS | **Real** |
| Station parameter readings, 16 stations × 56 months | Generated for demonstration | ⚠️ **SAMPLE** |
| Effluent discharge licences | Five worked examples | ⚠️ **SAMPLE** |

### ⚠️ Data provenance

Station **positions** are real, snapped to the Langat channel at real localities. The **six
parameter readings** at them are sample data, generated along a plausible upstream-to-downstream
profile. They are not official readings and must not be used for decisions.

Replace `data/stations.json` with actual LUAS/DOE monitoring data using the same schema and the
whole system — index, class, exceedance, load budget, remaining capacity — recomputes with no
code changes.

```jsonc
{
  "meta": { "months": ["2021-01", "..."], "parameters": ["do","bod","cod","ss","an","ph"] },
  "stations": [{
    "code": "LGT06", "name": "Dengkil",
    "lat": 2.85971, "lon": 101.68380,
    "district": "Sepang", "segment": "tengah", "river": "Sungai Langat",
    "series": [{ "t": "2021-01", "do": 6.1, "bod": 4.01, "cod": 26.7,
                 "ss": 85.3, "an": 0.632, "ph": 6.95 }]
  }]
}
```

---

## Rebuilding the data

```bash
python scripts/01_fetch_waterbodies.py      # 121 MB Digital Earth national file
python scripts/02_build_waterbodies.py      # clip to the Dengkil reach, compute areas
python scripts/03_fetch_basin_pollution.py  # data.gov.my water_pollution_basin
python scripts/04_build_stations.py         # stations (REPLACE with real readings)
```

---

## Structure

```
index.html                three phases, one page
css/styles.css            design system (LUAS brand)
js/wqi.js                 DOE WQI formula + INWQS class standards
js/loads.js               load, TMDL, headroom and effluent-standard maths
js/data.js                loading, derivation, compliance record, water summary
js/store.js               localStorage: readings, SESAMS register, design conditions
js/phase1.js              station assessment + class calculator
js/phase2.js              monitoring, water bodies, national context
js/satellite.js           imagery layers + spectral index reference
js/phase3.js              TMDL budget + licence register
js/app.js                 routing and bootstrap
data/*.json               processed data
scripts/*.py              ETL pipeline
serve.py                  local development server
```

Dependencies load from CDN at runtime — no `npm install`:
[Leaflet](https://leafletjs.com/) 1.9.4 · [Chart.js](https://www.chartjs.org/) 4.5.0

---

## Credits

WQI formula and INWQS: Department of Environment Malaysia ·
Effluent standards: EQ (Industrial Effluent) Regulations 2009 ·
Open data: [data.gov.my](https://data.gov.my) ·
Water bodies: Digital Earth ·
Imagery: Esri, Google, EOX Sentinel-2 cloudless, NASA EOSDIS GIBS
