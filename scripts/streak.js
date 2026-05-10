/* streak.js — site-wide visitor streak counter.
 *
 * Loaded on every page (homepage, content pages, today page, family pages).
 * Increments a per-device, local-day-keyed streak whenever the visitor opens
 * any page, so it tracks how the site fits into someone's week even if they
 * don't always click through to the Today page.
 *
 * Persistence shape (versioned for safe migration if a future sync layer
 * adopts the same key):
 *
 *   localStorage['shuwo.streak.v1'] = JSON.stringify({
 *     v: 1,                         // schema version
 *     current: <number>,            // current streak length, in days
 *     longest: <number>,            // longest streak ever recorded
 *     lastDayKey: 'YYYY-MM-DD',     // local-calendar last visit
 *     firstDayKey: 'YYYY-MM-DD',    // first visit ever
 *     totalDays: <number>,          // distinct days visited (lifetime)
 *     recentDays: ['YYYY-MM-DD',…], // last 60 distinct days visited (newest first)
 *     deviceId: '<rand>',           // generated once; future cloud sync handle
 *     updatedAt: '<ISO>'            // last write
 *   })
 *
 * The Today page renders this state into the streak chip. Other pages just
 * record the visit silently.
 *
 * Per-device by design — clearing storage or switching browsers resets the
 * streak. The deviceId is reserved for an optional future auth+sync layer
 * that would associate streak state with a logged-in account.
 */
(function () {
  'use strict';

  var STREAK_KEY = 'shuwo.streak.v1';
  var LEGACY_STREAK_KEY = 'shuwo-streak';
  var LEGACY_LAST_KEY = 'shuwo-last-visit';

  function pad2(n) { return String(n).padStart(2, '0'); }
  function localDayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function diffInLocalDays(a, b) {
    if (!a || !b) return Infinity;
    var ta = new Date(a + 'T00:00:00').getTime();
    var tb = new Date(b + 'T00:00:00').getTime();
    return Math.round((tb - ta) / 86400000);
  }
  function makeDeviceId() {
    return 'd_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  }

  function read() {
    try {
      var raw = localStorage.getItem(STREAK_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1) return parsed;
      }
    } catch (e) {}
    var legacyStreak = 0, legacyLast = '';
    try {
      legacyStreak = parseInt(localStorage.getItem(LEGACY_STREAK_KEY) || '0', 10) || 0;
      legacyLast = localStorage.getItem(LEGACY_LAST_KEY) || '';
    } catch (e) {}
    return {
      v: 1,
      current: legacyStreak,
      longest: legacyStreak,
      lastDayKey: legacyLast,
      firstDayKey: legacyLast,
      totalDays: legacyStreak > 0 ? legacyStreak : 0,
      recentDays: legacyLast ? [legacyLast] : [],
      deviceId: makeDeviceId(),
      updatedAt: new Date().toISOString()
    };
  }

  // Visit history kept as an array of distinct day keys, newest first,
  // capped at RECENT_CAP. We don't store more than this — the dot-grid
  // visualisation only needs the last 14–30 days, and a tighter cap keeps
  // the localStorage record small (~1 KB worst case).
  var RECENT_CAP = 60;
  function pushRecentDay(state, dayKey) {
    if (!Array.isArray(state.recentDays)) state.recentDays = [];
    if (state.recentDays[0] === dayKey) return;
    state.recentDays.unshift(dayKey);
    if (state.recentDays.length > RECENT_CAP) {
      state.recentDays.length = RECENT_CAP;
    }
  }

  function write(state) {
    try { localStorage.setItem(STREAK_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function tick(localKey) {
    var state = read();
    var diff = diffInLocalDays(state.lastDayKey, localKey);
    if (diff === 0) {
      // Already counted today — but make sure recentDays is populated for
      // sessions that pre-date this field (post-migration).
      pushRecentDay(state, localKey);
    } else if (diff === 1) {
      state.current = (state.current || 0) + 1;
      state.totalDays = (state.totalDays || 0) + 1;
      pushRecentDay(state, localKey);
    } else {
      state.current = 1;
      state.totalDays = (state.totalDays || 0) + 1;
      if (!state.firstDayKey) state.firstDayKey = localKey;
      pushRecentDay(state, localKey);
    }
    if (!state.firstDayKey) state.firstDayKey = localKey;
    if (state.current > (state.longest || 0)) state.longest = state.current;
    state.lastDayKey = localKey;
    state.updatedAt = new Date().toISOString();
    write(state);
    return state;
  }

  // Public API. Today page reads this to render the streak chip; other
  // pages just call tick() silently on load.
  window.shuwoStreak = {
    tick: tick,
    read: read,
    localDayKey: localDayKey
  };

  // Fire once per page load.
  try { tick(localDayKey()); } catch (e) {}
})();
