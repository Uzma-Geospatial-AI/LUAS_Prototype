/* ============================================================
   symbols.js — Symbology for the point source categories

   Each category gets its own SHAPE as well as its own colour, so the five
   stay tellable apart on a busy satellite basemap, in greyscale, and for
   viewers with colour-vision deficiency. Colour is never the only carrier
   of meaning. Every symbol carries a white inner glyph and a white outline
   so it reads over dark imagery.

   The same function draws the marker and the legend swatch, so one symbol
   means one thing everywhere.
   ============================================================ */

export const SHAPES = {
  /* Industry — square, with a factory roofline */
  square: {
    outline: '<rect x="3.2" y="3.2" width="17.6" height="17.6" rx="3.4"/>',
    glyph: '<path d="M7.2 16.8V11l3.5 2.3V11l3.5 2.3V8l2.6-.9v9.7z" fill="#fff" stroke="none"/>',
  },
  /* Sewage & water treatment — diamond, with a droplet */
  diamond: {
    outline: '<path d="M12 2.2 21.8 12 12 21.8 2.2 12z"/>',
    glyph: '<path d="M12 7.1c1.9 2.4 3.1 4 3.1 5.5a3.1 3.1 0 0 1-6.2 0c0-1.5 1.2-3.1 3.1-5.5z"'
         + ' fill="#fff" stroke="none"/>',
  },
  /* Landfill, quarry & waste — triangle, with a warning bar */
  triangle: {
    outline: '<path d="M12 2.8 22 20.6H2z"/>',
    glyph: '<path d="M12 10.6v4M12 17.2h.01" stroke="#fff" stroke-width="2"'
         + ' stroke-linecap="round" fill="none"/>',
  },
  /* Construction & cleared land — pentagon, with bare ground contours */
  pentagon: {
    outline: '<path d="M12 2.4 21.6 9.4 17.9 20.8H6.1L2.4 9.4z"/>',
    glyph: '<path d="M7.6 15.6h8.8M9.2 12.2h5.6" stroke="#fff" stroke-width="1.9"'
         + ' stroke-linecap="round" fill="none"/>',
  },
  /* Farms & aquaculture — circle, with a sprout */
  circle: {
    outline: '<circle cx="12" cy="12" r="9.2"/>',
    glyph: '<path d="M12 17.4v-5.2M12 12.2c-2.6 0-3.9-1.6-3.9-4 2.6 0 3.9 1.6 3.9 4z'
         + 'M12 12.6c2.6 0 3.9-1.7 3.9-4.1-2.6 0-3.9 1.7-3.9 4.1z" stroke="#fff"'
         + ' stroke-width="1.5" stroke-linejoin="round" fill="none"/>',
  },
};

const FALLBACK = { outline: '<circle cx="12" cy="12" r="9"/>', glyph: '' };

/* Inline SVG for one category, sized in CSS pixels. Below 15 px the glyph is
   dropped — it turns to mud at that size and the shape still carries it. */
export function sourceSvg(shape, color, size = 20, withGlyph = true) {
  const d = SHAPES[shape] ?? FALLBACK;
  const body = d.outline.replace('/>', ` fill="${color}" stroke="#fff" stroke-width="1.9"/>`);
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"
    style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">`
    + `${body}${withGlyph && size >= 15 ? d.glyph : ''}</svg>`;
}

/* Leaflet marker icon. */
export function sourceIcon(shape, color, size = 20) {
  return L.divIcon({
    className: 'src-sym',
    html: sourceSvg(shape, color, size),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/* Swatch for the legend and the popup header. */
export function sourceSwatch(shape, color, size = 15) {
  return `<span class="src-swatch">${sourceSvg(shape, color, size)}</span>`;
}
