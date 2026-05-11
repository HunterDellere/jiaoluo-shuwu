/**
 * stroke-anim.js — hero stroke-order animation.
 *
 * Each <svg.stroke-svg> has a <defs><clipPath> per stroke whose <path>
 * (.stroke-mask) is the median polyline drawn with a very wide stroke.
 * The corresponding visible <path.stroke-shape> is clip-pathed by it.
 *
 * Animating each .stroke-mask's stroke-dashoffset from full → 0 grows
 * the clipped area along the median direction, so the filled stroke
 * shape appears swept into existence. There's only one visual layer per
 * stroke (the shape itself), so no flash on completion and no font
 * mismatch with the static fallback.
 *
 * Auto-plays once on viewport entry. Replay button injected at the .hero
 * level so a single button drives the simp/trad pair.
 */
(function () {
  'use strict';

  // Per-stroke duration is roughly half what it was before this rewrite.
  // Single character lands ~0.8–1.2s; simp→trad pair ~2s with the gap.
  const PER_STROKE_BASE_MS = 140;
  const PER_STROKE_LENGTH_FACTOR = 0.7;
  const INTER_STROKE_GAP_MS = 30;
  const INTER_FIGURE_GAP_MS = 320;

  const prefersReduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function preparePath(p) {
    let len;
    try { len = p.getTotalLength(); } catch (e) { len = 1000; }
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
    p.dataset.len = String(len);
    return len;
  }

  function showInstant(svg) {
    // Drop all clip masks so every stroke shows fully.
    svg.classList.add('is-ready');
    svg.classList.add('is-complete');
  }

  /**
   * Animate via CSS transition rather than per-frame rAF. The browser
   * compositor handles dashoffset interpolation natively — much smoother
   * than per-frame JS updates that force a clip-path recomputation each
   * tick. Also eliminates the jitter at median polyline vertices that
   * a stuttering rAF loop made visible.
   */
  function animatePath(p, durationMs) {
    return new Promise(resolve => {
      // Two RAFs to ensure the initial offset paints before the transition
      // kicks in. Without this the browser may collapse "set offset = L,
      // transition to 0" into "transition from current to 0" with no
      // intermediate paint, producing an instant snap on some browsers.
      p.style.transition = 'none';
      p.style.strokeDashoffset = String(parseFloat(p.dataset.len) || 1000);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        p.style.transition = `stroke-dashoffset ${durationMs}ms linear`;
        p.style.strokeDashoffset = '0';
        let resolved = false;
        const onEnd = (e) => {
          if (e.propertyName && e.propertyName !== 'stroke-dashoffset') return;
          if (resolved) return;
          resolved = true;
          p.removeEventListener('transitionend', onEnd);
          resolve();
        };
        p.addEventListener('transitionend', onEnd);
        // Fallback timer in case transitionend doesn't fire (browser quirks).
        setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, durationMs + 80);
      }));
    });
  }

  function durationFor(len) {
    return PER_STROKE_BASE_MS + (len / 100) * PER_STROKE_LENGTH_FACTOR * 100;
  }

  /**
   * Animate one SVG glyph: walk each stroke in document order and animate
   * its corresponding clip-mask path (the .stroke-mask inside the
   * matching <clipPath>). Strokes without a mask (rare — old data) just
   * fade in.
   */
  async function animateSvg(svg) {
    svg.classList.remove('is-complete');
    const groups = Array.from(svg.querySelectorAll('g.stroke'));

    // Map stroke index → its clip-mask path. clipPath ids look like
    // "cp-<ns>-<i>" — but rather than parse, we just match each group's
    // clip-path attr to its referenced clipPath in defs.
    const masksByIndex = new Map();
    groups.forEach(g => {
      const idx = g.dataset.strokeIndex;
      const shape = g.querySelector('.stroke-shape');
      const clipUrl = shape && shape.getAttribute('clip-path');
      if (!clipUrl) return;
      const clipId = clipUrl.replace(/^url\(#?/, '').replace(/\)$/, '');
      const mask = svg.querySelector(`#${CSS.escape(clipId)} .stroke-mask`);
      if (mask) masksByIndex.set(idx, mask);
    });

    // Reset all masks to fully hidden.
    masksByIndex.forEach(m => preparePath(m));

    // Now that masks are prepped, mark SVG ready so shapes become opaque
    // (they remain invisible because their clip-mask is at full offset).
    svg.classList.add('is-ready');

    for (const g of groups) {
      const idx = g.dataset.strokeIndex;
      const mask = masksByIndex.get(idx);
      if (mask) {
        const len = parseFloat(mask.dataset.len) || 1000;
        await animatePath(mask, durationFor(len));
      }
      // Else: no mask (clip-less stroke); shape is already visible because
      // .stroke-shape with no clip-path attr renders unconditionally.
      if (groups.indexOf(g) < groups.length - 1) {
        await new Promise(r => setTimeout(r, INTER_STROKE_GAP_MS));
      }
    }
    svg.classList.add('is-complete');
  }

  async function playGroup(svgs) {
    for (let i = 0; i < svgs.length; i++) {
      await animateSvg(svgs[i]);
      if (i < svgs.length - 1) {
        await new Promise(r => setTimeout(r, INTER_FIGURE_GAP_MS));
      }
    }
  }

  function injectControls(hero, svgs) {
    if (hero.querySelector('.stroke-controls')) return;
    const dual = svgs.length > 1;
    const wrap = document.createElement('div');
    wrap.className = 'stroke-controls';
    wrap.innerHTML =
      '<button type="button" class="stroke-replay" aria-label="Replay stroke animation">' +
      '<span class="stroke-replay-ico" aria-hidden="true">↻</span> <span class="stroke-replay-label">Replay</span>' +
      '</button>' +
      (dual ? '<span class="stroke-pair-label" aria-hidden="true">简 ↔ 繁</span>' : '');
    hero.appendChild(wrap);
    wrap.querySelector('.stroke-replay').addEventListener('click', () => {
      playGroup(svgs);
    });
  }

  function findHeroGroups() {
    const groups = new Map();
    document.querySelectorAll('svg.stroke-svg').forEach(svg => {
      const hero = svg.closest('.hero') || svg.parentElement;
      if (!groups.has(hero)) groups.set(hero, []);
      groups.get(hero).push(svg);
    });
    return groups;
  }

  function init() {
    const groups = findHeroGroups();
    if (!groups.size) return;

    groups.forEach((svgs, hero) => {
      if (prefersReduced) {
        svgs.forEach(showInstant);
        injectControls(hero, svgs);
        return;
      }

      // Prep every clip mask to its full dashoffset BEFORE adding is-ready.
      // is-ready makes the stroke shapes opaque; if masks aren't prepped
      // first, the shapes paint fully visible for one frame.
      svgs.forEach(svg => {
        svg.querySelectorAll('.stroke-mask').forEach(preparePath);
        svg.classList.add('is-ready');
      });
      injectControls(hero, svgs);

      const io = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            io.disconnect();
            playGroup(svgs);
            break;
          }
        }
      }, { threshold: 0.25 });
      io.observe(hero);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
