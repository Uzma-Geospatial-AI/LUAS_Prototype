# LUAS System — Sungai Langat

A water quality and discharge load management system for **Lembaga Urus Air Selangor
(LUAS)**, covering the **Sungai Langat catchment** — the 2,140 km² of Selangor whose run-off
reaches the river. Built by Geospatial AI Sdn Bhd, an Uzma Group company.

Live: https://uzma-geospatial-ai.github.io/LUAS_Prototype/

1. **Map** — satellite imagery, the catchment and its rivers, 16 stations, 21 JPS water level
   gauges, 1,089 water bodies and 651 point sources, all filterable and steppable through 56
   months.
2. **Phase 1 · Station Assessment** — six DOE parameters → WQI → does the reach hold Class II?
3. **Phase 2 · Quality Monitoring** — how often each parameter breaches, and how it trends.
4. **Phase 3 · Total Maximum Daily Load** — what the reach can carry, what it carries now, and
   how much is left to licence. This is still the function the system is built around; the
   number follows the LUAS phase order rather than its prominence.

Each view has its own URL fragment — `#map`, `#tmdl`, `#station`, `#quality` — named for what it
is rather than for its position, so a renumbering cannot make the label and the link disagree.

No build step and no API keys. The datasets are read from a **Firebase Realtime Database**,
falling back to the copies bundled with the site when the database cannot answer — so the page
still works with the database closed, empty or unreachable, and the app bar always says which of
the two served it. Any station can be selected from the app bar and every phase follows it.

---

## Tech stack

- **Vanilla ES modules** — no framework, no bundler, no `npm install`
- **Leaflet 1.9.4** — the map, eight basemaps, vector overlays
- **Chart.js 4.5.0** — trends and the load budget chart
- **Python 3 standard library** — the whole ETL, including a shapefile reader
- **Firebase Realtime Database** — the datasets, read over REST with no SDK
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
│   ├── firebase.js            reads the datasets from the Realtime Database
│   ├── examples.js            worked-example licences built from mapped premises
│   ├── wqi.js                 DOE WQI formula + INWQS class standards
│   ├── loads.js               load, TMDL, headroom and effluent-standard maths
│   ├── store.js               localStorage: readings, SESAMS register, conditions
│   ├── mapview.js             the map, its four corners and the legend filter
│   ├── symbols.js             one shape per point source category
│   ├── satellite.js           imagery catalogue + spectral index reference
│   ├── phase1.js              Phase 1 — station assessment + class calculator
│   ├── phase2.js              Phase 2 — monitoring, water bodies, national context
│   └── phase3.js              Phase 3 — TMDL budget + licence register
├── data/
│   ├── langat_basin.geojson       the catchment
│   ├── langat_rivers.geojson      489 river reaches
│   ├── waterbodies_langat.geojson 1,089 water body outlines
│   ├── pollution_sources.geojson  651 sites in the riparian zone
│   ├── selangor_boundary.geojson  state boundary
│   ├── water_levels.json          21 JPS river water level stations
│   ├── stations.json              16 stations x 56 months
│   └── basin_pollution.json       national basin pollution, data.gov.my
└── scripts/                   the ETL, one step per file
```

---

## On a phone

Everything a desktop has, read by scrolling rather than by looking round the edges of the map.
Below 700px the floating cards leave the overlay and stack under the map in the order they are
needed — class counts, search, basemap, layers, month, legend — and the map keeps a workable
56vh. The station picker moves to its own line in the app bar rather than being dropped: it
decides what every phase is written for, so a phone without it would be a different product.

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

## The database

The eight datasets live in a **Firebase Realtime Database**, one node each under `/luas`, plus a
`/luas/meta` node recording when each was written and what it is — so the database can be read
without coming back to this repository to find out what is in it.

| Node | Holds |
|---|---|
| `stations` | 16 monitoring stations × 56 months |
| `water_levels` | 21 JPS river water level stations |
| `basin_pollution` | national basin pollution, data.gov.my |
| `catchment` | the Sungai Langat catchment |
| `rivers` | 489 river reaches |
| `waterbodies` | 1,089 water body outlines |
| `sources` | 651 point sources |
| `selangor` | the state boundary |

`scripts/10_push_to_firebase.py` writes them. The credential comes from `FIREBASE_DB_SECRET` or
`--auth`, never from the repository; `--check` reports access and writes nothing; `--node X`
pushes one dataset. The browser reads over REST — a node is one GET returning JSON, which is all
this needs, and pulling in the Firebase SDK would cost more bytes than the data it fetches.

**The bundled files are the fallback, not dead weight.** Every node falls back to the file of the
same content in `data/` if the database cannot answer for it — rules closed, node missing, network
gone. The site is deployed as static files anyway, so those copies are already there and already
cached; keeping them means an unreachable database degrades to the site working exactly as it did
before, rather than to a blank page. One short probe of `/luas/meta` decides for all eight, so a
closed database costs one round trip rather than eight timeouts.

> ⚠️ **The database does not compress its responses.** Asked for the water body outlines with
> `Accept-Encoding: gzip` it returns 370,645 bytes; the same file from GitHub Pages arrives
> gzipped at 75,745 — 4.9× less. Across all eight, throttled to 4 Mbps and a 4× slower CPU, the
> site takes about **2.2 s** from the database against **0.7 s** from the bundled files. That is
> the price of a single source of truth, accepted knowingly. Neither figure touches the 2,081 SVG
> paths the map draws, which is the larger cost on a slow device and is the same either way.

Which source actually answered is shown in the app bar — *served from Firebase · written …*, or
*served from bundled files · database unavailable (rules closed)*. Where a number came from is not
something a reader should have to open the network tab to find out.

**Nothing in the browser writes.** A database a public page can write to is a database anyone who
reads the page source can write to, and this one is on a government portal. Rules cascade
downward, so a `false` at the root does not stop a `true` deeper in and only the subtree the site
reads has to be opened. This is where the rules should rest:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "luas": { ".read": true, ".write": false }
  }
}
```

Uploading without a credential needs `"luas": { ".write": true }` for the length of one run, then
put it back. Setting security rules is the kind of step that gets marked done and turns out to be
wrong months later, so it is checkable rather than assumed:

```bash
python scripts/10_push_to_firebase.py --verify
```

Two unauthenticated requests, which is exactly what a visitor is: the read of `/luas` must
succeed, or every reader silently falls back to the bundled files; the write must be refused, or
anyone who views the page source can rewrite the data behind a government portal. If a write does
get through, the test node is removed again and the failure is reported loudly.

> ⚠️ The licence register still lives in each browser's `localStorage`, so it is **not shared
> between users**. Moving it to the database would fix that, but it needs authentication first —
> a register the public can write to is not a register.

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
| Top left | The station total, and the count in each WQI class this month |
| Top right | Search, and the basemap in use with all eight behind it |
| Bottom left | Layer masters, each with its own count |
| Bottom centre | The month on show — a slider across all 56, with play |
| Bottom right | The legend, which is also the filter |

**The legend is the filter.** Every row is a switch: turn off *Slightly Polluted* and those
stations leave the map, turn off *Ponds* and the ponds go. Twenty-three rows across six groups. The
layer masters command a group of rows — switching one off clears the group, and it reads back as
on, off or part-on from its members, so the two panels cannot disagree. Each legend group heading
carries the same master switch for the rows under it, working off the rows actually rendered
there rather than a list of its own — so *Boundaries*, which spans four of the layer-card
masters, needs no special case, and a group that gains a row gains it in the switch too. The
legend folds to a single pill when it is in the way.

**The class counts** across the top: the station total in one box, then how many stations sit in
each WQI class this month in another. They carry the same colour and roman numeral as the markers
and the legend, and they filter the same way: click *Slightly Polluted* and those stations leave
the map.

**Search** sits beside the basemap button and finds anything the map draws — a station code, a river, a named
water body, a named point source — then takes you to it: a station or a source opens its popup, a
river or a water body flashes. If what you picked has been filtered out, its layer is switched
back on, since being shown the thing is the point of asking for it. Unnamed features are left out;
a list reading "Pond" six hundred times is worse than a shorter one.

**Channel width carries the load.** There is no measured width in the source — 3 of 1,182 OSM
ways have a `width` tag, and the mapped riverbank polygons cover 0.31 km² of a 682 km network — so
the line is scaled by what the reach *drains* instead: the mapped channel length accumulated from
every reach above it, 16 m at a headwater stub and 540 km at the trunk. A river widens roughly
with the square root of what it carries, which is enough to make a confluence read as one: two
thin tributaries meet and the channel below them is visibly heavier. Width also grows with zoom,
the trunk draws over the tributary joining it, and the ends are rounded so they blend.

> ⚠️ It is an **accumulation, not a measurement**. The popup shows the figure it was scaled from.

**Flow direction is always on.** OSM draws a waterway in the direction it flows, so animating a
dash pattern along the line *is* the direction — nothing has to be inferred at draw time, and no
arrows have to be placed. A dashed pass sits over the channels and moves downstream; it is never
interactive, so it never takes a click away from the river beneath it. It can be switched off, and
it respects `prefers-reduced-motion`.

**Click a river to see where it goes.** The same directed geometry becomes `next` — the reach
below — and `nexti`, the vertex it joins at. Clicking a reach walks that chain to the sea, lights
the route, and says how far and through what:

> Sungai Pajam → Sungai Beranang → Sungai Semenyih → Sungai Langat · 142.8 km · 18 reaches

Matching one way's end against another's *start* is not enough — a tributary joins the middle of
the river it feeds, so almost every confluence is missed and traces die after one reach. Ends are
matched against any vertex, and only the channel below the junction counts as downstream.
Confluences displaced by clipping and simplification are snapped within 75 m, which takes reaches
that trace to Sungai Langat from 117 to **394 of 489**. The remaining 95 stop where the mapped
network stops, and the popup says so rather than implying the water ends there.

**The month slider** moves the whole map through the record: every station marker and every chip
repaints, so the reach can be watched changing rather than read one month at a time. The class
counts move with it, which is the quickest read of whether the basin is improving.

### Layers

| Layer | What it is |
|---|---|
| Monitoring stations | 16 stations, drawn as their WQI and coloured by DOE class |
| River water level | 21 JPS gauges, drawn as a staff gauge and coloured by JPS status |
| Water bodies | 1,089 Digital Earth outlines, coloured by type |
| Point sources | 651 sites that can put a load into the river, one shape per category; the outline is **green** with an active licence in the register and **red** without |
| Licence status | two switches — *Licensed* and *Not in register* — that hide sources by status across every category |
| Sungai Langat & tributaries | 682 km of mapped channel, drawn at a width scaled by what it carries |
| Flow direction | the same channels, dashed and animated downstream |
| Langat catchment | 2,140 km², the clip for everything else |
| Selangor boundary | the state LUAS is responsible for, Federal Territories excluded |

> ⚠️ **The wetland class is not carried.** The Digital Earth classification covers seasonally
> inundated and converted land, so on this catchment it resolved to twelve unnamed polygons — two
> of them 374 ha and 111 ha — lying over what the imagery plainly shows as planted estate. Drawing
> 554 ha of that as a water body claims a receiving water where there is no open water, and at the
> zoom the map is read at it covered the features that are real. Dropped from `scripts/02`, from
> the built file, and from the app, so the three cannot drift. Eleven point sources had a wetland
> as their nearest water; `scripts/08` was re-run, so their distances and screening scores now
> measure to water that exists.

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

## River water level

The 21 JPS stations in the Langat basin, from [Public
InfoBanjir](https://publicinfobanjir.water.gov.my/aras-air/data-paras-air/?state=SEL&type=NEGERI).
Each one draws as an upright **staff gauge** — nothing else on this map is a vertical bar, so the
layer is tellable apart from the WQI circles and the point source shapes without reading the
colour. The colours and the wording are JPS's own: Normal, Waspada, Amaran, Bahaya.

The gauge fills from the bottom by how far the reading stands between the station's normal level
and its danger level. That fraction is never shown as a number, because a percentage between two
thresholds is not a quantity anyone measures — it only decides how much of the bar is coloured.
The rim carries the status too, so a station reading below its normal level still says which
status it is with nothing filled in.

The popup gives the reading, the plain distance to the level that would raise an alert, the
station's four threshold levels as a gauge board with the current one lit, the trend, and the
minute the reading was taken.

Two endpoints are joined to build it, because neither is enough alone: the state table carries
the four thresholds and the reading but **no coordinates at all**, and the map feed carries the
coordinates, the trend and JPS's status. They join on the station id in the table's graph link,
so all 21 are matched by id and none by name.

> ⚠️ **It is a snapshot, not a live feed.** Neither endpoint sends
> `Access-Control-Allow-Origin`, so a static page cannot read InfoBanjir from the browser — the
> request is blocked before it is made. The readings are fetched by `scripts/09` at build time and
> the legend states the station clock they were read at. Re-run the script to refresh them. **For
> anything operational, read InfoBanjir itself.**

The lit rung is the status JPS publishes, not one worked out here by comparing the reading against
the thresholds. "Normal" is a reference level rather than a line to be crossed, so a station
sitting below it is still Normal, and lighting nothing would say the opposite. Where a station is
offline or erroring JPS leaves the status blank; those read **No reading** rather than being given
a level of their own — several report `0.00` while offline, and 0.00 against a 76.80 m normal level
would publish as "far below normal" when what it means is "no reading".

Stations are filtered on **JPS's own basin attribution**, not on the catchment polygon: these are
JPS's stations and it is JPS's basin definition. One of the 21 — *RS Batu 8*, on the coastal plain
— falls outside the HydroSHEDS polygon the rest of the map is clipped to, because the two
delineations disagree along the coast. It is kept, it draws where it actually is, and its popup
says why it is outside the dashed outline.

---

## Point sources

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

**The answer follows what is switched on.** Rivers are a receiving water as much as ponds are,
so the nearest is recorded per layer — `river:main`, `river:trib`, `water:pond` and the rest —
and the popup names the closest among the layers currently visible:

| Shown | This site answers |
|---|---|
| everything | Pond · 371 m |
| water bodies off | Sungai Langat · 2,638 m |
| rivers off | Pond · 371 m |
| nothing | no water layer is switched on |

`near` reaches **5 km**, well past the 1.5 km riparian buffer. The buffer decides which sites are
listed; it must not decide what a listed site is allowed to say, or a site whose only visible
layer is a river 1.6 km off goes blank — which it did for 165 of the 651 sites before this.

When the shown answer is not the overall nearest the popup says so, and it flags an answer that
falls outside the riparian zone. The risk score does not move: it is scaled from the overall
nearest, because how close a site sits to water is a property of the site, not of the view.

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

Two tabs, because they are two jobs:

| Tab | What it does |
|---|---|
| **Loading capacity** | What this water can carry, and how much of it is left |
| **Licences** | What is permitted to discharge into it — the SESAMS register |

The capacity tab opens by naming the water it is **written for**, and lets it be changed there
rather than only from the app bar. A loading capacity with no stated subject invites being read
as the whole river's.

A licence is granted to a place, so the form asks **which place first**, then the reference and
everything else. Two ways in:

| Mode | What it does |
|---|---|
| **On the map** | Pick one of the 238 named point sources already mapped. The record arrives complete — reference, category, flow and all four concentrations — and the button reads **Update licence**, because a mapped premises holds one licence and saving replaces it. |
| **New location** | Name it and give a latitude and longitude, or take the map centre. |

One premises holds one licence. Picking a premises that already has one loads that record
rather than offering a second, because two licences on the same site would count its wasteload
twice in the budget.

> ⚠️ **The prefilled figures are placeholders, not permit values.** They are derived from the
> category and the discharge standard — 55–95% of the standard's own limits, and a flow typical
> of the category — so the form has something to compute with before the real permit is to hand.
> They are deterministic, so the same premises always gives the same numbers rather than new noise
> on every click, and they rescale if the discharge standard is changed. A licence saved with them
> untouched is stored as `estimated` and carries an **EST** badge in the register; editing any
> figure clears it. The whole wasteload allocation is computed from these numbers, so a register
> that invented them silently would be dangerous.

Either way the licence carries a position, and anything with a position is drawn:

- a premises **already on the map** is ringed where it stands, not covered by a second marker,
  and its own popup gains the licence — reference, permitted flow, wasteload. Two markers for one
  place would be the map disagreeing with itself.
- a **new location** gets its own pin, since nothing else draws it.

**Show on map** beside either mode opens the map at that premises **and opens its popup** —
the point is to be shown the place, not left near it. If its layer had been switched off, it is
switched back on first. The register marks which rows
are located and which are not, so a register of six against a map of two is not a puzzle.

> ⚠️ The register is not partitioned by receiving water — every licence in it counts against
> whichever water is selected. Tying a licence to the reach it discharges into is a change to the
> record, not the interface.

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
> the system to make the budget computable. They are built from **premises that are actually on
> the map** — the highest-risk named site in each licensable category, with its real name and
> position — so each one draws as a ring on the map and the budget adds up against something a
> reader can go and look at. The **licence reference, flow and concentrations are invented**,
> deterministically from the premises id, and the same function fills the form when that premises
> is picked, so register and form can never disagree about the same licence. Every row is badged
> **EXAMPLE**; nothing adverse is asserted about any named business; entering a real licence
> against a premises supersedes its example rather than counting alongside it; *Clear examples*
> removes them all. Construction land gets no example: it is a diffuse, load-allocation problem,
> not an outfall with a meter on it.

---

## Data

| Dataset | Source | Status |
|---|---|---|
| National river basin pollution, 198 records 2000–2021 | [`data.gov.my` · `water_pollution_basin`](https://api.data.gov.my/data-catalogue?id=water_pollution_basin) | **Real** |
| Water bodies, 1,089 outlines | [Digital Earth · `malaysia_water_bodies.geojson`](https://digitalearthgeojson.s3.ap-southeast-5.amazonaws.com/malaysia_water_bodies.geojson) | **Real** |
| Sungai Langat catchment, 2,140 km² | [HydroSHEDS · HydroBASINS Asia level 8](https://www.hydrosheds.org/products/hydrobasins) | **Real** |
| River network, 489 reaches, 682 km | [OpenStreetMap](https://www.openstreetmap.org) via Overpass | **Real** |
| Point sources, 651 sites | [OpenStreetMap](https://www.openstreetmap.org) via Overpass | **Real** (risk score ⚠️ derived) |
| Selangor state boundary | [DOSM · `administrative_1_state.geojson`](https://github.com/dosm-malaysia/data-open) | **Real** |
| River water level, 21 stations | [JPS · Public InfoBanjir](https://publicinfobanjir.water.gov.my/aras-air/data-paras-air/?state=SEL&type=NEGERI) | **Real** (⚠️ snapshot, not live) |
| Satellite imagery | Esri · Google · EOX · NASA GIBS | **Real** |
| Station parameter readings, 16 × 56 months | Generated for demonstration | ⚠️ **SAMPLE** |
| Effluent discharge licences | Five worked examples on real mapped premises | ⚠️ **SAMPLE** (premises real, figures invented) |

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
python scripts/09_fetch_water_levels.py         # JPS water levels (re-run to refresh)
python scripts/10_push_to_firebase.py          # push all eight to the database
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
- Rivers and point sources — [OpenStreetMap](https://www.openstreetmap.org) contributors (ODbL)
- Water bodies — Digital Earth
- River water level — [Jabatan Pengairan dan Saliran · Public InfoBanjir](https://publicinfobanjir.water.gov.my/)
- Imagery — Esri, Google, [EOX Sentinel-2 cloudless](https://s2maps.eu), NASA EOSDIS GIBS
- Map library — [Leaflet](https://leafletjs.com/) · Charts — [Chart.js](https://www.chartjs.org/)
