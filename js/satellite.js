/* ============================================================
   satellite.js — Imagery catalogue

   The basemap layers the main map offers, plus the spectral index
   reference. The viewer itself lives in mapview.js.
   ============================================================ */

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export const IMAGERY = {
  esri: {
    label: 'Esri World Imagery', res: '≈ 0.3 – 1 m',
    src: 'Esri · Maxar · Earthstar Geographics',
    use: 'The sharpest openly available mosaic. Individual oxidation ponds, factory roofs and '
       + 'the river bank are all resolvable.',
    make: () => L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics' }),
  },
  google: {
    label: 'Google Satellite', res: '≈ 0.15 – 1 m', src: 'Google',
    use: 'Often the most recent high-resolution coverage of the Klang Valley — useful for '
       + 'confirming new development in the catchment.',
    make: () => L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'], maxZoom: 21, attribution: 'Imagery: © Google' }),
  },
  ghyb: {
    label: 'Google Hybrid', res: '≈ 0.15 – 1 m', src: 'Google',
    use: 'The same imagery with place and road names, for locating a specific premises.',
    make: () => L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'], maxZoom: 21, attribution: 'Imagery: © Google' }),
  },
  s2: {
    label: 'Sentinel-2 Cloudless', res: '10 m',
    src: 'EOX IT Services · ESA Copernicus (CC BY-NC-SA 4.0)',
    use: 'A cloud-free annual mosaic. Coarser, but radiometrically consistent — the correct '
       + 'base for computing the spectral indices below.',
    make: () => L.tileLayer(
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/{z}/{y}/{x}.jpg',
      { maxZoom: 16, attribution: 'Sentinel-2 cloudless 2021 by EOX (modified Copernicus Sentinel data)' }),
  },
  viirs: {
    label: 'VIIRS — daily', res: '250 m', daily: true,
    src: 'NASA EOSDIS GIBS · NOAA-20, daily',
    use: 'A same-week look at the reach. Too coarse for a single channel, but this is the layer '
       + 'that shows sediment plumes and flooding after heavy rain.',
    id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg',
  },
  bands721: {
    label: 'False colour 7-2-1 — daily', res: '250 m', daily: true,
    src: 'NASA EOSDIS GIBS · MODIS Terra, daily',
    use: 'Shortwave infrared composite. Water reads dark, which separates open water from land '
       + 'cleanly and exposes flooding and bare soil in the catchment.',
    id: 'MODIS_Terra_CorrectedReflectance_Bands721', max: 9, ext: 'jpg',
  },
};

/* Spectral indices that relate imagery to the WQI parameters */
export const WATER_INDICES = [
  { name: 'NDWI — Normalised Difference Water Index', formula: '(Green − NIR) / (Green + NIR)',
    ramp: 'linear-gradient(90deg,#8a6d3b,#e8e3d2,#45bfe0,#0a4a8a)', lo: 'Land (−1)', hi: 'Water (+1)',
    body: 'Delineates open water. Tracks how pond and reservoir area changes between the dry '
        + 'season and the monsoon — the storage that buffers load.' },
  { name: 'NDTI — Normalised Difference Turbidity Index', formula: '(Red − Green) / (Red + Green)',
    ramp: 'linear-gradient(90deg,#0a4a8a,#45bfe0,#e8e3d2,#c98a3a,#7a4a12)', lo: 'Clear', hi: 'Very turbid',
    body: 'A proxy for suspended solids. SS is one of the four pollutants in the Phase 1 budget, '
        + 'and it is the one imagery estimates best.' },
  { name: 'NDCI — Chlorophyll-a Index', formula: '(Red-Edge − Red) / (Red-Edge + Red)',
    ramp: 'linear-gradient(90deg,#1a3a6a,#2f8a4f,#b8d13a,#e8b81a,#d92d20)', lo: 'Low', hi: 'Algal bloom',
    body: 'Algal biomass from nutrient enrichment. Tied directly to the NH₃-N load, which is the '
        + 'binding pollutant at this station.' },
  { name: 'LST — Land Surface Temperature', formula: 'Thermal sensing (TIR bands)',
    ramp: 'linear-gradient(90deg,#2a78d6,#45bfe0,#f5e01c,#ef7d1a,#d92d20)', lo: 'Cool', hi: 'Hot',
    body: 'Thermal discharge and the urban heat island both lower dissolved oxygen solubility, '
        + 'which feeds straight back into the index.' },
];


/* Plain cartography, for when place names matter more than the imagery */
export const REFERENCE_MAPS = {
  osm: {
    label: 'Street map', res: 'Vector', src: 'OpenStreetMap',
    use: 'Road and place names, for locating a station or a premises by address.',
    make: () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
  },
  topo: {
    label: 'Topographic', res: 'Vector + contours', src: 'OpenTopoMap',
    use: 'Contours and drainage lines, for reading flow direction and catchment.',
    make: () => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, attribution: '&copy; OpenTopoMap (CC-BY-SA)' }),
  },
};

/* Build a Leaflet layer for a daily GIBS definition on a given date. */
export function gibsLayer(def, date) {
  return L.tileLayer(
    `${GIBS}/${def.id}/default/${date}/GoogleMapsCompatible_Level${def.max}/{z}/{y}/{x}.${def.ext}`,
    { maxNativeZoom: def.max, maxZoom: 16, tileSize: 256,
      bounds: [[-85, -180], [85, 180]], attribution: 'NASA EOSDIS GIBS / Worldview' });
}
