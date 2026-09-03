/* ============================================================
   satellite.js — Daily satellite layers and spectral index reference

   The daily NASA GIBS layers are consumed by mapview.js, which merges them
   into the Base map picker alongside the high-resolution mosaics. The spectral
   index table is reference material and is rendered in the WQI Guide.
   ============================================================ */

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

/* Daily, time-enabled imagery — free, no API key.
   `daily: true` tells mapview.js to show the acquisition-date picker. */
export const GIBS_LAYERS = {
  modis_terra: {
    label: 'MODIS Terra — True Colour', group: 'sat', icon: 'sat', daily: true,
    res: '250 m', src: 'NASA EOSDIS GIBS · daily, ~10:30 local time',
    note: 'Basin-scale monitoring: sediment plumes at the estuary, cloud cover and flood events. ' +
          'Too coarse for a single river reach.',
    id: 'MODIS_Terra_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg',
  },
  viirs: {
    label: 'VIIRS — True Colour', group: 'sat', icon: 'sat', daily: true,
    res: '250 m', src: 'NASA EOSDIS GIBS · NOAA-20, daily',
    note: 'The most current daily observation, sharper than MODIS. Best layer for watching ' +
          'estuary turbidity after heavy rain.',
    id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', max: 9, ext: 'jpg',
  },
  bands721: {
    label: 'False Colour (7-2-1)', group: 'sat', icon: 'sat', daily: true,
    res: '250 m', src: 'NASA EOSDIS GIBS · MODIS Terra, daily',
    note: 'Shortwave infrared composite. Water reads dark blue/black, which separates water from ' +
          'land cleanly and exposes flooding, bare soil and burn scars.',
    id: 'MODIS_Terra_CorrectedReflectance_Bands721', max: 9, ext: 'jpg',
  },
  nightlights: {
    label: 'Night Lights', group: 'sat', icon: 'sat', daily: true,
    res: '500 m', src: 'NASA EOSDIS GIBS · VIIRS day-night band, daily',
    note: 'A proxy for urban density and industrial activity, which tracks the domestic sewage ' +
          'load along the river corridor.',
    id: 'VIIRS_SNPP_DayNightBand_At_Sensor_Radiance', max: 8, ext: 'png',
  },
};

/* Build a Leaflet layer for a GIBS definition on a given date (YYYY-MM-DD). */
export function gibsLayer(def, date) {
  return L.tileLayer(
    `${GIBS}/${def.id}/default/${date}/GoogleMapsCompatible_Level${def.max}/{z}/{y}/{x}.${def.ext}`,
    {
      maxNativeZoom: def.max, maxZoom: 16, tileSize: 256,
      bounds: [[-85, -180], [85, 180]],
      attribution: 'NASA EOSDIS GIBS / Worldview',
    });
}

/* Spectral water indices — methodology reference shown in the WQI Guide */
export const WATER_INDICES = [
  { name: 'NDWI — Normalised Difference Water Index', formula: '(Green − NIR) / (Green + NIR)',
    ramp: 'linear-gradient(90deg,#8a6d3b,#e8e3d2,#45bfe0,#0a4a8a)',
    lo: 'Land (−1)', hi: 'Water (+1)',
    body: 'Delineates the extent of water bodies. Used to track changes in reservoir area, ' +
          'ex-mining ponds and river margins between the dry season and the monsoon.' },
  { name: 'NDTI — Normalised Difference Turbidity Index', formula: '(Red − Green) / (Red + Green)',
    ramp: 'linear-gradient(90deg,#0a4a8a,#45bfe0,#e8e3d2,#c98a3a,#7a4a12)',
    lo: 'Clear', hi: 'Very turbid',
    body: 'A proxy for suspended solids (SS). High values at the Langat estuary after heavy rain ' +
          'point to erosion from construction sites and bare ground upstream.' },
  { name: 'NDCI — Chlorophyll-a Index', formula: '(Red-Edge − Red) / (Red-Edge + Red)',
    ramp: 'linear-gradient(90deg,#1a3a6a,#2f8a4f,#b8d13a,#e8b81a,#d92d20)',
    lo: 'Low', hi: 'Algal bloom',
    body: 'Estimates algal biomass from nutrient enrichment (eutrophication). Requires the ' +
          'Sentinel-2 red-edge band. Closely tied to excess NH₃-N and phosphorus from sewage ' +
          'and agriculture.' },
  { name: 'LST — Land Surface Temperature', formula: 'Thermal sensing (TIR bands)',
    ramp: 'linear-gradient(90deg,#2a78d6,#45bfe0,#f5e01c,#ef7d1a,#d92d20)',
    lo: 'Cool', hi: 'Hot',
    body: 'Detects thermal discharge from factories and the urban heat island effect, both of ' +
          'which lower dissolved oxygen solubility in the river.' },
];
