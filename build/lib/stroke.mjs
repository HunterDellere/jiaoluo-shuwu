/**
 * stroke.mjs — hero stroke-order injection.
 *
 * For character pages, replaces each `<span class="hero-glyph">CHAR</span>`
 * with an animated `<svg class="stroke-svg">` carrying the makemeahanzi
 * path data inline. Falls back to the original static glyph when stroke
 * data isn't available for the character (rare).
 *
 * If the page already authors a simp/trad pair (two hero-glyph spans inside
 * .hero-script-pair), each glyph is upgraded independently. The pair markup
 * around them is preserved so the existing simp/trad layout still applies.
 *
 * Animation timing is driven by scripts/stroke-anim.js on the client; this
 * module only emits the markup + inline path data.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let _strokeData = null;
function loadStrokeData() {
  if (_strokeData) return _strokeData;
  const fp = join(ROOT, 'data', '_reference', 'stroke-data.json');
  if (!existsSync(fp)) {
    _strokeData = {};
    return _strokeData;
  }
  _strokeData = JSON.parse(readFileSync(fp, 'utf8'));
  return _strokeData;
}

function escapeAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Render a single <svg> stroke figure for one character. makemeahanzi uses
 * a 1024×1024 coordinate system with the y-axis flipped vs. SVG's default,
 * so we apply `transform="scale(1,-1) translate(0,-900)"` on the inner
 * group to flip it back. The translate offset (-900) accounts for the
 * intended baseline used by makemeahanzi's CJK glyph outlines.
 */
/**
 * Convert a makemeahanzi median (an array of [x,y] points) into an SVG
 * path "d" attribute: "M x0,y0 L x1,y1 L x2,y2 …". Used as the animated
 * pen path for each stroke.
 */
function medianToPath(points) {
  if (!Array.isArray(points) || points.length === 0) return '';
  return points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt[0]} ${pt[1]}`).join(' ');
}

/**
 * Hanzi-writer–style stroke reveal.
 *
 * Each stroke is one filled shape (.stroke-shape) clipped by a clipPath
 * whose <path> is the median polyline drawn with a very wide stroke. By
 * animating that clip path's stroke-dashoffset from full → 0, the visible
 * area of the stroke shape expands along the median direction — the
 * brush is the stroke shape itself, not a separate thin centerline.
 *
 * Result: no swap-and-flash between a "pen" layer and an "ink" layer,
 * because there is only one layer. The filled glyph is identical at
 * every moment of the animation; we just unmask it progressively.
 *
 * Each clipPath needs a unique id; we namespace per character + form
 * so multiple SVGs on a page don't collide. Falls back to
 * reveal-without-mask if median data is missing.
 */
function renderStrokeSvg(char, form) {
  const data = loadStrokeData()[char];
  if (!data || !data.strokes || !data.strokes.length) return null;
  const medians = Array.isArray(data.medians) ? data.medians : [];
  // Stable id namespace — unique per (form, char) so simp + trad of the
  // same character (or the same character on multiple pages) don't share
  // clip ids. Random suffix avoids server-rendered HTML caching collisions.
  const ns = `${form === 'traditional' ? 't' : 's'}-${char.codePointAt(0).toString(16)}-${Math.random().toString(36).slice(2, 6)}`;

  const clipPaths = [];
  const groups = data.strokes.map((d, i) => {
    const med = medians[i];
    const clipId = `cp-${ns}-${i}`;
    if (med && med.length > 1) {
      const medPath = medianToPath(med);
      // The clip path uses a wide stroke that fully covers each stroke
      // shape's width. 200 is generous (strokes are ~80–120 wide) so the
      // mask never under-reveals the shape's edges.
      // Mask brush: 200px wide (fully covers any stroke's outline), butt
      // linecap (sharper leading edge as the brush sweeps — round caps
      // produce subpixel jitter at every median vertex), miter join
      // (cleaner corners than round at this width).
      clipPaths.push(`<clipPath id="${clipId}"><path class="stroke-mask" d="${escapeAttr(medPath)}" stroke-width="200" stroke-linecap="butt" stroke-linejoin="miter" fill="none" stroke="black"/></clipPath>`);
      return `<g class="stroke" data-stroke-index="${i}"><path class="stroke-shape" d="${escapeAttr(d)}" clip-path="url(#${clipId})"/></g>`;
    }
    // No median → reveal without mask (will pop in but still uses the
    // correct filled shape, so no font mismatch).
    return `<g class="stroke" data-stroke-index="${i}"><path class="stroke-shape" d="${escapeAttr(d)}"/></g>`;
  }).join('');

  // Defs go inside the SVG so clip refs resolve. Outer transform flips
  // the makemeahanzi y-up coordinate system into SVG y-down.
  const defs = clipPaths.length ? `<defs>${clipPaths.join('')}</defs>` : '';
  return `<svg class="stroke-svg" data-form="${form}" data-char="${escapeAttr(char)}" data-has-medians="${medians.length > 0 ? '1' : '0'}" viewBox="0 0 1024 1024" role="img" aria-label="Stroke order animation for ${escapeAttr(char)}">${defs}<g transform="scale(1,-1) translate(0,-900)">${groups}</g></svg>`;
}

/**
 * Replace a `<span class="hero-glyph">X</span>` with an interactive stroke
 * figure for X. If X has no stroke data, return the original span untouched.
 */
function upgradeHeroGlyph(span, char) {
  const svg = renderStrokeSvg(char, 'simplified');
  if (!svg) return span;
  // Keep the original glyph as the fallback display layer; the SVG sits on
  // top via CSS. Print stylesheet hides the SVG so the static glyph prints.
  return `<span class="hero-glyph hero-glyph--stroke" data-char="${escapeAttr(char)}">${svg}<span class="hero-glyph-fallback" aria-hidden="true">${char}</span></span>`;
}

/**
 * Inject stroke-order animation onto the hero of a character page.
 *
 * Two layouts are supported:
 *
 * 1. **Pair layout** (when the page authors `<div class="hero-script-pair">`):
 *    each `.hero-script--simp` / `.hero-script--trad` block already has its
 *    own `<span class="hero-glyph">`. We upgrade each independently with
 *    the correct character for its side. If simp === trad, both upgrade
 *    with the same char but the existing "traditional · same" label is
 *    preserved.
 *
 * 2. **Single layout** (no pair): one `<span class="hero-glyph">` is
 *    upgraded with the page's primary character. If the page's character
 *    has a distinct traditional counterpart and stroke data exists for
 *    both, a second figure is appended after the glyph for the trad form.
 *
 * Falls back to the static glyph for any character not in stroke-data.json.
 */
export function injectHeroStrokes(body, fm, simpTradMap) {
  if (fm.type !== 'character' || !fm.char) return body;

  // Pair layout: upgrade each authored glyph in place.
  if (body.includes('hero-script-pair')) {
    return body.replace(
      /<div class="hero-script hero-script--(simp|trad)">\s*<span class="hero-glyph">([^<]+)<\/span>/g,
      (m, form, char) => {
        const svg = renderStrokeSvg(char, form === 'simp' ? 'simplified' : 'traditional');
        if (!svg) return m;
        return `<div class="hero-script hero-script--${form}">\n              <span class="hero-glyph hero-glyph--stroke" data-char="${escapeAttr(char)}">${svg}<span class="hero-glyph-fallback" aria-hidden="true">${char}</span></span>`;
      }
    );
  }

  // Single layout: upgrade the lone .hero-glyph and optionally append a
  // trad counterpart if one exists.
  const simp = fm.char;
  const trad = simpTradMap?.simpToTrad?.(simp);
  const upgradedSimp = upgradeHeroGlyph('', simp);
  const replaced = body.replace(
    /<span class="hero-glyph">([^<]+)<\/span>/,
    () => upgradedSimp || `<span class="hero-glyph">${simp}</span>`
  );

  if (trad && trad !== simp) {
    const tradSvg = renderStrokeSvg(trad, 'traditional');
    if (tradSvg) {
      // Wrap the upgraded simp in a pair container with the trad alongside.
      // This is conservative: only triggers when the page is single-layout
      // AND stroke data exists for both forms.
      return replaced.replace(
        /(<span class="hero-glyph hero-glyph--stroke"[\s\S]*?<\/span>\s*<\/span>)/,
        `<div class="hero-script-pair hero-script-pair--injected">
              <div class="hero-script hero-script--simp">
                $1
                <span class="hero-script-label">simplified</span>
              </div>
              <div class="hero-script-divider"></div>
              <div class="hero-script hero-script--trad">
                <span class="hero-glyph hero-glyph--stroke" data-char="${escapeAttr(trad)}">${tradSvg}<span class="hero-glyph-fallback" aria-hidden="true">${trad}</span></span>
                <span class="hero-script-label">traditional</span>
              </div>
            </div>`
      );
    }
  }
  return replaced;
}

/**
 * Build a simp↔trad lookup map from data/_reference/simp-trad-pairs.json.
 * Returns helper closures so callers don't import the file.
 */
export function buildSimpTradMap() {
  const fp = join(ROOT, 'data', '_reference', 'simp-trad-pairs.json');
  if (!existsSync(fp)) return { simpToTrad: () => null, tradToSimp: () => null };
  const pairs = JSON.parse(readFileSync(fp, 'utf8'));
  const s2t = new Map();
  const t2s = new Map();
  for (const [trad, simp] of pairs) {
    if (!s2t.has(simp)) s2t.set(simp, trad);
    if (!t2s.has(trad)) t2s.set(trad, simp);
  }
  return {
    simpToTrad: (c) => s2t.get(c) || null,
    tradToSimp: (c) => t2s.get(c) || null,
  };
}
