/**
 * OG facade — re-exports SVG generation, PNG rasterization, and the
 * category favicon helper. Kept thin so callers (build/build.mjs) can
 * import one symbol set without coupling to the implementation modules.
 */

import { CATEGORY_META, renderOgSvg, renderHomepageOgSvg, ogAltText } from './og-svg.mjs';

export { renderOgSvg, renderHomepageOgSvg, ogAltText, CATEGORY_META };
export { rasterizeOgSvg, ogContentHash } from './og-png.mjs';

// Back-compat alias: old name used elsewhere.
export const CATEGORY_GLYPH = CATEGORY_META;

/**
 * Inline SVG data-URI favicon: consistent 書 glyph on papyrus background,
 * centered and padded so it reads at 16×16 tab size across all pages.
 */
export function categoryFaviconDataUri(_category) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>` +
    `<rect width='100' height='100' rx='18' fill='#f2e8d5'/>` +
    `<text x='50' y='50' text-anchor='middle' dominant-baseline='central'` +
    ` font-family='Noto Serif SC, serif' font-size='72' font-weight='700' fill='#8b1a1a'>書</text>` +
    `</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
