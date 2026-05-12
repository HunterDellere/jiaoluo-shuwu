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
 * Stroke reveal — minimal, fade-in-per-stroke in correct stroke order.
 *
 * The "directional accuracy" comes from showing strokes in their
 * canonical makemeahanzi order. We deliberately do NOT animate within
 * each stroke (pen-sweep, mask-reveal, etc.) — every per-stroke approach
 * we tried produced jitter, font mismatches, or completion flashes.
 * Stroke order alone is enough to convey the writing rhythm, and the
 * filled shape is identical to the static glyph so there's nothing to
 * mismatch.
 *
 * Each stroke gets a CSS variable --stroke-i (0-based index) that drives
 * a staggered fade-in animation defined in style.css. The IntersectionObserver
 * in scripts/stroke-anim.js just adds .is-playing to start the animation
 * once when the hero scrolls into view; CSS does the rest.
 */
function renderStrokeSvg(char, form) {
  const data = loadStrokeData()[char];
  if (!data || !data.strokes || !data.strokes.length) return null;
  const total = data.strokes.length;
  const groups = data.strokes.map((d, i) => {
    return `<path class="stroke-shape" d="${escapeAttr(d)}" style="--stroke-i:${i};"/>`;
  }).join('');
  // Outer transform flips the makemeahanzi y-up coordinate system into
  // SVG y-down. translate(-100) nudges the visible glyph up; the original
  // -900 offset accounted for makemeahanzi's intended baseline.
  return `<svg class="stroke-svg" data-form="${form}" data-char="${escapeAttr(char)}" data-stroke-count="${total}" viewBox="0 0 1024 1024" role="img" aria-label="${escapeAttr(char)} (${total} strokes)"><g transform="scale(1,-1) translate(0,-900)">${groups}</g></svg>`;
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
