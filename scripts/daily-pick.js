/* daily-pick.js — shared seeded picks for the daily draw.
 *
 * Both the homepage (scripts/homepage.js) and the Today page
 * (pages/today/today.js) need to render the same character / vocab /
 * grammar / chengyu picks for the same UTC day, plus the same featured
 * thread for the same date. This module is the single source of that
 * logic so the two surfaces can never drift.
 *
 * Loaded as a plain script (no modules) on every page that needs it,
 * before the page's own homepage.js / today.js. Exposes window.shuwoDaily.
 *
 * Keep this file dependency-free. It is the bottom of the stack.
 */
(function () {
  'use strict';

  // ── Date helpers ────────────────────────────────────────────────────────
  function pad2(n) { return String(n).padStart(2, '0'); }
  function todayUtcKey() {
    var d = new Date();
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function dayOfYear(date) {
    var u = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var start = new Date(Date.UTC(u.getUTCFullYear(), 0, 1));
    return Math.floor((u - start) / 86400000);
  }

  // ── PRNG ────────────────────────────────────────────────────────────────
  // FNV-1a 32-bit hash → integer seed. Stable, fast, well-distributed.
  function seedFromString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  // mulberry32 — small, deterministic, 32-bit-seeded PRNG.
  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      var t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // Returns a deterministic permutation of arr seeded by seed.
  function seededShuffle(arr, seed) {
    var out = arr.slice();
    var rand = mulberry32(seed);
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  // ── Pool filtering ──────────────────────────────────────────────────────
  // Mirrors today.js: only complete entries, and skip meta categories that
  // don't render as a single-card subject (family hubs, hsk list pages,
  // reading-path hubs).
  var META_CAT = { families: 1, hsk: 1, hubs: 1 };
  function alivePool(entries) {
    return entries.filter(function (e) {
      return e && e.status === 'complete' && !META_CAT[e.category];
    });
  }

  // ── Daily picks (character / vocab / grammar / chengyu) ─────────────────
  // Each slot uses its own seed namespace so adding a new vocab entry
  // doesn't shift the character pick. The double-rng() advance per pick
  // matches today.js's existing behavior; we preserve it so the picks
  // match what visitors have already been seeing.
  function pickFromPool(pool, rng) {
    if (!pool.length) return null;
    rng();
    var idx = Math.floor(rng() * pool.length);
    return pool[idx];
  }
  function pickDaily(entries, utcKey) {
    var alive = alivePool(entries);
    var characters = alive.filter(function (e) { return e.type === 'character'; });
    var vocab      = alive.filter(function (e) { return e.type === 'vocab' && e.category !== 'chengyu'; });
    var grammar    = alive.filter(function (e) { return e.type === 'grammar'; });
    var chengyu    = alive.filter(function (e) { return e.category === 'chengyu'; });
    return {
      character: pickFromPool(characters, mulberry32(seedFromString('char-' + utcKey))),
      vocab:     pickFromPool(vocab,      mulberry32(seedFromString('vocab-' + utcKey))),
      grammar:   pickFromPool(grammar,    mulberry32(seedFromString('grammar-' + utcKey))),
      chengyu:   pickFromPool(chengyu,    mulberry32(seedFromString('chengyu-' + utcKey)))
    };
  }

  // ── Today's thread ──────────────────────────────────────────────────────
  // Year-seeded shuffle, picked by day-of-year, walks forward past any
  // theme whose lead page no longer exists. Mirrors what today.js and
  // homepage.js previously each implemented separately.
  function pickThread(themes, byPath, now) {
    if (!Array.isArray(themes) || !themes.length) return null;
    var n = now || new Date();
    var yearSeed = n.getFullYear() * 1000003;
    var shuffled = seededShuffle(themes, yearSeed);
    var day = dayOfYear(n);
    for (var offset = 0; offset < shuffled.length; offset++) {
      var t = shuffled[(day + offset) % shuffled.length];
      var lead = byPath[t.lead];
      if (lead) return { theme: t, lead: lead };
    }
    return null;
  }

  // Expose. Keep the surface small and explicit; today.js and homepage.js
  // pull only what they need.
  window.shuwoDaily = {
    todayUtcKey: todayUtcKey,
    dayOfYear: dayOfYear,
    seedFromString: seedFromString,
    mulberry32: mulberry32,
    seededShuffle: seededShuffle,
    alivePool: alivePool,
    pickDaily: pickDaily,
    pickThread: pickThread
  };
})();
