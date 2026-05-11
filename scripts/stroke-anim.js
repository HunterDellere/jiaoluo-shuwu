/**
 * stroke-anim.js — hero stroke-order entrance animation.
 *
 * Quiet, one-shot reveal: when an .hero containing one or more
 * <svg.stroke-svg> elements scrolls into view, add .is-playing to each
 * SVG to trigger the staggered fade-in defined in style.css. Once the
 * full stagger duration has elapsed, swap to .is-complete to pin every
 * stroke at full opacity (so they don't fade out).
 *
 * No replay button. No interactive controls. The animation is a small
 * delight that plays once on first scroll-in; subsequent visits or
 * reloads play it once again. That's it.
 *
 * Respects prefers-reduced-motion: reduce by jumping straight to
 * .is-complete with no animation.
 */
(function () {
  'use strict';

  // Per-stroke stagger (must match style.css animation-delay multiplier).
  const STAGGER_MS = 55;
  // Per-stroke fade duration (must match style.css animation duration).
  const FADE_MS = 110;
  // Pause between simp and trad in a pair so the simp finishes settling
  // before the trad starts writing.
  const PAIR_GAP_MS = 160;

  const prefersReduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function totalRunMs(svg) {
    const n = parseInt(svg.dataset.strokeCount || '0', 10) || 0;
    if (!n) return FADE_MS;
    return (n - 1) * STAGGER_MS + FADE_MS;
  }

  async function play(svg) {
    if (prefersReduced) {
      svg.classList.add('is-complete');
      return;
    }
    svg.classList.add('is-playing');
    await new Promise(r => setTimeout(r, totalRunMs(svg) + 30));
    // Add is-complete BEFORE removing is-playing so there's no frame
    // where neither class is present (which would let opacity snap to 0
    // because the base .stroke-shape rule sets opacity: 0).
    svg.classList.add('is-complete');
    svg.classList.remove('is-playing');
  }

  async function playGroup(svgs) {
    for (let i = 0; i < svgs.length; i++) {
      await play(svgs[i]);
      if (i < svgs.length - 1) {
        await new Promise(r => setTimeout(r, PAIR_GAP_MS));
      }
    }
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
        svgs.forEach(s => s.classList.add('is-complete'));
        return;
      }
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
