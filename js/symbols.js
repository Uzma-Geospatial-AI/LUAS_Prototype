/* ============================================================
   symbols.js — Map symbology for pollution source categories

   Each category gets its own SHAPE as well as its own colour, so the five
   categories stay tellable apart on a busy satellite basemap, in greyscale,
   and for viewers with colour-vision deficiency. Colour alone is never the
   only carrier of meaning.
   ============================================================ */

/* Outline shapes drawn in a 24×24 box, plus a white inner glyph. */
export const SHAPES = {
  industri: {
    name: 'Square',
    shape: '<rect x="3" y="3" width="18" height="18" rx="3.5"/>',
    glyph: '<path d="M7.4 16.6V11l3.4 2.3V11l3.4 2.3V8.2l2.4-.9v9.3z" fill="#fff" stroke="none"/>',
  },
  makanan: {
    name: 'Circle',
    shape: '<circle cx="12" cy="12" r="9.2"/>',
    glyph: '<path d="M9.1 7v4.1M10.7 7v4.1M9.9 11.1V17M14.6 7c-1 1.1-1 3.4 0 4.3V17"' +
           ' stroke="#fff" stroke-width="1.7" stroke-linecap="round" fill="none"/>',
  },
  perumahan: {
    name: 'House',
    shape: '<path d="M12 2.4 21.6 10v11.6H2.4V10z"/>',
    glyph: '<path d="M10.2 20.4v-5.2h3.6v5.2z" fill="#fff" stroke="none"/>',
  },
  kumbahan: {
    name: 'Diamond',
    shape: '<path d="M12 2.2 21.8 12 12 21.8 2.2 12z"/>',
    glyph: '<path d="M12 7.2c1.9 2.3 3.1 3.9 3.1 5.4a3.1 3.1 0 0 1-6.2 0c0-1.5 1.2-3.1 3.1-5.4z"' +
           ' fill="#fff" stroke="none"/>',
  },
  sisa: {
    name: 'Triangle',
    shape: '<path d="M12 2.6 22 20.8H2z"/>',
    glyph: '<path d="M12 10.4v4.1M12 17.4h.01" stroke="#fff" stroke-width="1.9"' +
           ' stroke-linecap="round" fill="none"/>',
  },
};

const FALLBACK = { shape: '<circle cx="12" cy="12" r="9"/>', glyph: '' };

/* Inline SVG for one category, sized in CSS pixels. */
export function sourceSvg(cat, color, size = 22, withGlyph = true) {
  const d = SHAPES[cat] ?? FALLBACK;
  const body = d.shape.replace('/>', ` fill="${color}" stroke="#fff" stroke-width="1.9"/>`);
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"
    style="display:block;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45))">
    ${body}${withGlyph && size >= 16 ? d.glyph : ''}</svg>`;
}

/* Leaflet marker icon for one source. */
export function sourceIcon(cat, color, size = 22) {
  return L.divIcon({
    className: 'src-sym',
    html: sourceSvg(cat, color, size),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/* Small inline swatch for legends, menus and tables. */
export function sourceSwatch(cat, color, size = 15) {
  return `<span class="src-swatch">${sourceSvg(cat, color, size, size >= 15)}</span>`;
}
