/**
 * stroke-anim.js — hero stroke-order animation.
 *
 * Finds every <svg class="stroke-svg"> on the page, hides its <path class="stroke">
 * children via stroke-dasharray/stroke-dashoffset, then animates them in
 * order using requestAnimationFrame. Per-stroke duration is proportional to
 * the stroke's path length, so short strokes don't feel rushed.
 *
 * If two SVGs share a .hero-script-pair, the first animates to completion,
 * holds briefly, then the second animates — viewer sees a simp → trad walk-
 * through rather than parallel motion.
 *
 * Auto-plays once when the hero enters the viewport. Respects
 * prefers-reduced-motion: reduce by skipping animation and rendering all
 * strokes immediately. The replay button is injected by this script (so
 * pages without working JS show the static fallback glyph cleanly).
 */
(function () {
  'use strict';

  const PER_STROKE_BASE_MS = 320;     // floor per stroke
  const PER_STROKE_LENGTH_FACTOR = 1.4; // additional ms per 100 path units
  const INTER_STROKE_GAP_MS = 60;
  const INTER_FIGURE_GAP_MS = 600;

  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function preparePath(p) {
    let len;
    try { len = p.getTotalLength(); } catch (e) { len = 1000; }
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
    p.dataset.len = String(len);
    return len;
  }

  function showInstant(svg) {
    const paths = svg.querySelectorAll('path.stroke');
    paths.forEach(p => {
      p.style.strokeDasharray = '';
      p.style.strokeDashoffset = '0';
    });
    svg.classList.add('is-complete');
  }

  function animatePath(p, durationMs) {
    return new Promise(resolve => {
      const len = parseFloat(p.dataset.len) || 1000;
      const start = performance.now();
      function tick(now) {
        const t = Math.min(1, (now - start) / durationMs);
        // Ease out cubic for a calmer settle on each stroke.
        const eased = 1 - Math.pow(1 - t, 3);
        p.style.strokeDashoffset = String(len * (1 - eased));
        if (t < 1) requestAnimationFrame(tick);
        else { p.style.strokeDashoffset = '0'; resolve(); }
      }
      requestAnimationFrame(tick);
    });
  }

  function durationFor(len) {
    return PER_STROKE_BASE_MS + (len / 100) * PER_STROKE_LENGTH_FACTOR * 100;
  }

  async function animateSvg(svg) {
    svg.classList.remove('is-complete');
    const paths = Array.from(svg.querySelectorAll('path.stroke'));
    paths.forEach(preparePath);
    for (const p of paths) {
      const len = parseFloat(p.dataset.len) || 1000;
      await animatePath(p, durationFor(len));
      await new Promise(r => setTimeout(r, INTER_STROKE_GAP_MS));
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
    // Group SVGs by their nearest .hero ancestor so the simp + trad pair
    // animates as a unit. Pages without a .hero (shouldn't happen for
    // character pages, but guard anyway) fall back to one-figure groups.
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
      // Prep paths immediately so initial paint is blank strokes (not a
      // flash of fully-rendered strokes that then animate from full to
      // empty and back). On reduced-motion we skip prep entirely.
      if (prefersReduced) {
        svgs.forEach(showInstant);
        injectControls(hero, svgs);
        return;
      }

      svgs.forEach(svg => svg.querySelectorAll('path.stroke').forEach(preparePath));
      injectControls(hero, svgs);

      // Auto-play once on first viewport entry.
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
