/**
 * stroke-anim.js — hero stroke-order animation.
 *
 * The build emits each stroke as a <g class="stroke"> containing two paths:
 *   .stroke-shape    the filled outline of the stroke (visible glyph ink)
 *   .stroke-median   a thin centerline polyline used as the animated pen
 *
 * Animation flow per stroke:
 *   1. Show the median (thin centerline) sweeping along its length via
 *      stroke-dashoffset — reads as a calligraphy pen drawing the stroke.
 *   2. When the sweep completes, mark the parent <g> .is-complete: CSS
 *      fades in the filled .stroke-shape and hides the .stroke-median.
 *
 * If two SVGs share a .hero ancestor (simp + trad pair), the first
 * animates to completion, holds briefly, then the second animates.
 *
 * Auto-plays once when the hero enters the viewport. Respects
 * prefers-reduced-motion: reduce by showing all shapes immediately.
 */
(function () {
  'use strict';

  // Tuned to ~half of the previous duration per Hunter's request.
  // Single-character animation now lands around 0.8–1.2s total; the
  // simp→trad pair sequence around 2s with the inter-figure pause.
  const PER_STROKE_BASE_MS = 140;
  const PER_STROKE_LENGTH_FACTOR = 0.7;   // ms per 100 path units
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
    svg.querySelectorAll('g.stroke').forEach(g => g.classList.add('is-complete'));
    svg.classList.add('is-complete');
  }

  function animatePath(p, durationMs) {
    return new Promise(resolve => {
      const len = parseFloat(p.dataset.len) || 1000;
      const start = performance.now();
      function tick(now) {
        const t = Math.min(1, (now - start) / durationMs);
        // Linear feels closer to actual writing than ease-out for short
        // strokes; halving duration also makes any easing imperceptible.
        p.style.strokeDashoffset = String(len * (1 - t));
        if (t < 1) requestAnimationFrame(tick);
        else { p.style.strokeDashoffset = '0'; resolve(); }
      }
      requestAnimationFrame(tick);
    });
  }

  function durationFor(len) {
    return PER_STROKE_BASE_MS + (len / 100) * PER_STROKE_LENGTH_FACTOR * 100;
  }

  /**
   * Animate a single SVG glyph: walk each <g class="stroke"> in document
   * order. For each group, sweep its median if present; otherwise just
   * fade in the shape directly.
   */
  async function animateSvg(svg) {
    svg.classList.remove('is-complete');
    const groups = Array.from(svg.querySelectorAll('g.stroke'));
    const hasMedians = svg.dataset.hasMedians === '1';

    // Reset all groups to hidden initial state.
    groups.forEach(g => {
      g.classList.remove('is-active', 'is-complete');
      const med = g.querySelector('.stroke-median');
      if (med) preparePath(med);
    });

    for (const g of groups) {
      const med = g.querySelector('.stroke-median');
      if (hasMedians && med) {
        g.classList.add('is-active');
        const len = parseFloat(med.dataset.len) || 1000;
        await animatePath(med, durationFor(len));
        g.classList.remove('is-active');
        g.classList.add('is-complete');
      } else {
        // Fallback: no median data, just reveal the shape.
        g.classList.add('is-complete');
      }
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

      // Prep median dasharrays so the initial paint is blank (not a
      // flash of completed strokes that then animate from full to empty).
      svgs.forEach(svg => {
        svg.querySelectorAll('.stroke-median').forEach(preparePath);
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
