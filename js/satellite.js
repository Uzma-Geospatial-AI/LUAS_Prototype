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
    use: 'Detailed imagery for viewing ponds, buildings and river banks.',
    make: () => L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics' }),
  },
  google: {
    label: 'Google Satellite', res: '≈ 0.15 – 1 m', src: 'Google',
    use: 'Detailed satellite imagery for exploring the catchment.',
    make: () => L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'], maxZoom: 21, attribution: 'Imagery: © Google' }),
  },
  ghyb: {
    label: 'Google Hybrid', res: '≈ 0.15 – 1 m', src: 'Google',
    use: 'Satellite imagery with road and place names.',
    make: () => L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'], maxZoom: 21, attribution: 'Imagery: © Google' }),
  },
  s2: {
    label: 'Sentinel-2 Cloudless', res: '10 m',
    src: 'EOX IT Services · ESA Copernicus (CC BY-NC-SA 4.0)',
    use: 'Cloud-free Sentinel-2 imagery from 2021.',
    make: () => L.tileLayer(
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/{z}/{y}/{x}.jpg',
      { maxZoom: 16, attribution: 'Sentinel-2 cloudless 2021 by EOX (modified Copernicus Sentinel data)' }),
  },
  viirs: {
    label: 'VIIRS — daily', res: '250 m', daily: true,
    src: 'NASA EOSDIS GIBS · NOAA-20, daily',
    use: 'Daily regional imagery. Too coarse to show individual river channels.',
    id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg',
  },
  bands721: {
    label: 'False colour 7-2-1 — daily', res: '250 m', daily: true,
    src: 'NASA EOSDIS GIBS · MODIS Terra, daily',
    use: 'Daily false-colour imagery. Water appears dark; useful for viewing floods and bare soil.',
    id: 'MODIS_Terra_CorrectedReflectance_Bands721', max: 9, ext: 'jpg',
  },
};

/* ============================================================
   Satellite water quality — quarterly Sentinel-2 products

   Three rasters over Selangor, computed in Google Earth Engine and served as
   PMTiles (PNG, zoom 8–14) from the Digital Earth bucket. The whole scene is
   painted — land sits at the low end of the ramp — so the map clips them to
   the mapped rivers and water bodies unless asked not to.

   The colour ramps below were read back off the tiles: the two indices use
   the RdYlGn scheme reversed (green low, red high) and SS is greyscale. The
   numeric range each ramp spans was not supplied with the files, so the
   legend reads low → high rather than quoting values.
   ============================================================ */
export const WQ_BASE = 'https://digitalearthbasemap.s3.ap-southeast-1.amazonaws.com/gee-waterquality/';

export const WQ_QUARTERS = [
  { id: 'Q1_2026', label: 'Q1 2026', span: 'Jan – Mar 2026' },
  { id: 'Q2_2026', label: 'Q2 2026', span: 'Apr – Jun 2026' },
  { id: 'Q3_2026', label: 'Q3 2026', span: 'Jul – Sep 2026' },
];

const RDYLGN = ['#006837', '#1a9850', '#66bd63', '#a6d96a', '#d9ef8b', '#ffffbf',
  '#fee08b', '#fdae61', '#f46d43', '#d73027', '#a50026'];
const ramp = (cols) => `linear-gradient(90deg,${cols.join(',')})`;

export const WQ_PRODUCTS = {
  ndti: {
    label: 'NDTI', control: 'Turbidity', long: 'Turbidity index', file: 'NDTI', quantity: 'turbidity',
    stops: RDYLGN, ramp: ramp(RDYLGN), lo: 'Clear', hi: 'Turbid',
    note: 'Highlights possible sediment in the water.',
  },
  ndci: {
    label: 'NDCI', control: 'Algae', long: 'Chlorophyll-a index', file: 'NDCI', quantity: 'chlorophyll',
    stops: RDYLGN, ramp: ramp(RDYLGN), lo: 'Low chlorophyll', hi: 'Bloom',
    note: 'Highlights possible algae growth in slower water.',
  },
  ss: {
    label: 'SS', control: 'Sediment (est.)', long: 'Suspended solids, estimated', file: 'SS_mgL', unit: 'mg/L', quantity: 'sediment',
    stops: ['#000000', '#ffffff'], ramp: ramp(['#000000', '#ffffff']), lo: 'Low', hi: 'High',
    note: 'Uncalibrated estimate; compare relative patterns only.',
    caveat: true,
    /* Shown across the whole scene, never clipped to the mapped water: the
       sediment pattern reads as a surface, not as a set of outlines. */
    full: true,
  },
};

export const wqUrl = (product, quarter) =>
  `${WQ_BASE}selangor_${WQ_PRODUCTS[product].file}_${quarter}.pmtiles`;

/* Spectral indices that relate imagery to the WQI parameters. The three
   with a `product` are on the map as quarterly layers. */
export const WATER_INDICES = [
  { short: 'Open water · NDWI', name: 'NDWI — Normalised Difference Water Index', formula: '(Green − NIR) / (Green + NIR)',
    bands: 'Sentinel-2 B3, B8',
    ramp: 'linear-gradient(90deg,#8a6d3b,#e8e3d2,#45bfe0,#0a4a8a)', lo: 'Land (−1)', hi: 'Water (+1)',
    body: 'Shows open water and changes in pond or reservoir area.' },
  { short: 'Turbidity · NDTI', name: 'NDTI — Normalised Difference Turbidity Index', formula: '(Red − Green) / (Red + Green)',
    bands: 'Sentinel-2 B4, B3', product: 'ndti',
    ramp: WQ_PRODUCTS.ndti.ramp, lo: 'Clear (≤ 0)', hi: 'Turbid (+)',
    body: 'Higher values may indicate more suspended sediment, including runoff after rain.' },
  { short: 'Algae · NDCI', name: 'NDCI — Normalised Difference Chlorophyll Index', formula: '(Red-Edge − Red) / (Red-Edge + Red)',
    bands: 'Sentinel-2 B5, B4', product: 'ndci',
    ramp: WQ_PRODUCTS.ndci.ramp, lo: 'Low chlorophyll (≤ 0)', hi: 'Bloom (+)',
    body: 'Higher values may indicate algae growth in reservoirs and slow-moving rivers.' },
  { short: 'Sediment · SS estimate', name: 'SS — Suspended solids, estimated', formula: 'SS (mg/L) = a × (Red ÷ Green) + b',
    bands: 'Sentinel-2 B4 ÷ B3', product: 'ss',
    ramp: WQ_PRODUCTS.ss.ramp, lo: 'Low', hi: 'High mg/L',
    body: 'Compares sediment patterns. Local water samples are needed to calibrate concentration estimates.',
    caveat: 'Uncalibrated — qualitative only' },
  { short: 'Surface temperature · LST', name: 'LST — Land Surface Temperature', formula: 'Thermal sensing (TIR bands)',
    bands: 'Landsat 8/9 B10',
    ramp: 'linear-gradient(90deg,#2a78d6,#45bfe0,#f5e01c,#ef7d1a,#d92d20)', lo: 'Cool', hi: 'Hot',
    body: 'Shows surface heat patterns that can help investigate warm-water discharges.' },
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
