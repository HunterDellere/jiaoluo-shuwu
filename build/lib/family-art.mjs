/**
 * family-art.mjs — Inline SVG illustrations for family-index pages.
 *
 * Two surfaces per family:
 *   familyHeroArt(family)  — full-bleed illustration for the page hero
 *   familyCardArt(family)  — compact glyph-and-flourish for cards
 *
 * Design language:
 *   - Single signature glyph per family in LXGW WenKai TC (matches the
 *     site's display-Chinese stack), oversized, in the family's signature
 *     color at low opacity so it reads as a watermark behind smaller
 *     supporting glyphs / motifs.
 *   - Supporting elements are small geometric figures in ink/ochre that
 *     suggest the family's domain without literal illustration:
 *       language    — three glyphs stacked (字 词 法), seal-stamp motif
 *       topics      — compass + horizon line (place/time + thought)
 *       collections — chengyu's four-character grid + a path line
 *       explore     — three small family glyphs orbiting a central 探
 *   - All colors via CSS custom properties, so the art themes naturally
 *     with any future palette tweak.
 *
 * Output is plain SVG (no external assets) ready to be inlined into
 * the page HTML. SSR-friendly, no JS required.
 */

const PALETTES = {
  language:    { primary: 'var(--cat-grammar)',    accent: 'var(--cat-vocab)',     glyph: '语' },
  topics:      { primary: 'var(--cat-philosophy)', accent: 'var(--cat-history)',   glyph: '话' },
  collections: { primary: 'var(--cat-chengyu)',    accent: 'var(--cat-hubs)',      glyph: '集' },
  explore:     { primary: 'var(--ochre)',          accent: 'var(--red)',           glyph: '探' },
};

// ── compact card art (used on family-cards, homepage hub, crosslinks) ──────

/**
 * Render a centered CJK glyph at the geometric center of a 200×200 viewBox.
 * `dominant-baseline="central"` + y at the visual midpoint compensates for
 * the way LXGW WenKai's typographic baseline sits below the visual center;
 * combined with `text-anchor="middle"` and x at the midpoint, the glyph
 * lands true center regardless of font metrics.
 */
function centeredGlyph(glyph, fontSize, fill) {
  // Combination of dominant-baseline="central" + y at the geometric viewBox
  // center is the most reliable way to center a CJK glyph across the LXGW
  // WenKai TC + Noto Serif SC fallback stack. Avoid offset nudges — they
  // tend to push glyphs visibly low.
  return `<text x="100" y="100" text-anchor="middle" dominant-baseline="central"
       font-family="LXGW WenKai TC, Noto Serif SC, serif"
       font-size="${fontSize}" font-weight="700" fill="${fill}">${glyph}</text>`;
}

export function familyCardArt(family) {
  const p = PALETTES[family];
  if (!p) return '';
  // A single oversized glyph + a small flourish, kept simple so the card
  // reads quickly. Sized via the parent .family-card-art container.
  switch (family) {
    case 'language':
      return `<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="36" y="36" width="128" height="128" fill="none" stroke="${p.accent}" stroke-width="2" opacity="0.5" rx="4"/>
        ${centeredGlyph(p.glyph, 110, p.primary)}
      </svg>`;
    case 'topics':
      return `<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="100" cy="100" r="78" fill="none" stroke="${p.primary}" stroke-width="1.4" opacity="0.45"/>
        <circle cx="100" cy="100" r="58" fill="none" stroke="${p.accent}" stroke-width="0.8" opacity="0.4"/>
        ${centeredGlyph(p.glyph, 100, p.primary)}
      </svg>`;
    case 'collections':
      return `<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="40" y="40" width="55" height="55" fill="none" stroke="${p.accent}" stroke-width="1.4" opacity="0.55" rx="3"/>
        <rect x="105" y="40" width="55" height="55" fill="none" stroke="${p.accent}" stroke-width="1.4" opacity="0.55" rx="3"/>
        <rect x="40" y="105" width="55" height="55" fill="none" stroke="${p.accent}" stroke-width="1.4" opacity="0.55" rx="3"/>
        <rect x="105" y="105" width="55" height="55" fill="none" stroke="${p.accent}" stroke-width="1.4" opacity="0.55" rx="3"/>
        ${centeredGlyph(p.glyph, 92, p.primary)}
      </svg>`;
    case 'explore':
      return `<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <ellipse cx="100" cy="100" rx="78" ry="42" fill="none" stroke="${p.primary}" stroke-width="0.9" opacity="0.35" transform="rotate(-12 100 100)"/>
        <ellipse cx="100" cy="100" rx="78" ry="42" fill="none" stroke="${p.accent}" stroke-width="0.7" opacity="0.3" transform="rotate(35 100 100)"/>
        ${centeredGlyph(p.glyph, 100, p.accent)}
      </svg>`;
    default:
      return '';
  }
}
