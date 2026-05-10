/* today.js — daily picks page logic.
 *
 * Renders five slots:
 *   - Today's thread (theme + lead + related entries, mirroring the homepage)
 *   - Character of the day
 *   - Word of the day
 *   - Grammar point of the day
 *   - Chengyu of the day
 *
 * The four single-entry slots use UTC-keyed seeded RNGs so every visitor sees
 * the same set on the same UTC day. The thread uses a year-seeded shuffle
 * (mirroring scripts/homepage.js) so today's thread on the homepage and
 * today's thread on this page agree.
 *
 * Streak counter: local-day keyed (so a visit at 11pm and another at 7am
 * tomorrow correctly count as two consecutive days). LocalStorage is the
 * sole persistence today; the data shape is versioned and structured so a
 * future auth+sync layer can adopt it without migration. Per-device by
 * design — clearing storage or switching browsers resets the streak.
 */
(function () {
  'use strict';

  // ── Date helpers ────────────────────────────────────────────────────────
  // todayUtcKey is used for picking content (so every visitor sees the same
  // entries on the same UTC calendar day, regardless of timezone). The
  // streak counter uses local-day keying (handled by scripts/streak.js) so
  // a streak follows the user's perception of "a day," not UTC.
  function pad2(n) { return String(n).padStart(2, '0'); }
  function todayUtcKey() {
    var d = new Date();
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  // FNV-1a 32-bit hash → integer seed
  function seedFromString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // mulberry32 — small fast deterministic PRNG
  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      var t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Pick one entry from `pool` with `rng`, advancing it twice per pick so
  // the four slots don't share state.
  function pickFrom(pool, rng) {
    if (!pool.length) return null;
    rng();
    var idx = Math.floor(rng() * pool.length);
    return pool[idx];
  }

  // ── Card rendering ──────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderCard(entry, colorClass) {
    if (!entry) return '<div class="card ' + colorClass + ' today-empty">No entry available yet for this slot.</div>';
    var href = '../' + entry.path.replace(/^pages\//, '');
    var glyph = entry.char || (entry.title ? entry.title.split('·')[0].trim() : '');
    var pinyin = entry.pinyin || '';
    var en = '';
    if (entry.title && entry.title.indexOf('·') >= 0) {
      en = entry.title.split('·').slice(1).join('·').split('—')[0].trim();
    }
    var desc = entry.desc || '';
    return (
      '<a class="card ' + colorClass + ' today-card" href="' + escapeHtml(href) + '">' +
        '<div class="card-head">' +
          '<span class="card-title" lang="zh">' + escapeHtml(glyph) + '</span>' +
          (pinyin ? '<span class="card-pinyin">' + escapeHtml(pinyin) + '</span>' : '') +
        '</div>' +
        (en ? '<div class="card-body"><strong>' + escapeHtml(en) + '</strong></div>' : '') +
        (desc ? '<div class="card-body">' + escapeHtml(desc) + '</div>' : '') +
      '</a>'
    );
  }

  function fillSlot(slotName, entry, colorClass) {
    var slot = document.querySelector('[data-today-slot="' + slotName + '"]');
    if (!slot) return;
    slot.innerHTML = renderCard(entry, colorClass);
  }

  // ── Streak counter ──────────────────────────────────────────────────────
  // Backed by scripts/streak.js, which loads on every page and ticks the
  // streak silently on load. This page is the only surface that *renders*
  // it — other pages just record the visit. We always read; we don't tick
  // here, since streak.js already did.
  function renderStreak() {
    var state = (window.shuwoStreak && window.shuwoStreak.read())
      || { current: 0 };
    var streak = state.current || 0;
    var el = document.querySelector('[data-streak-count]');
    if (el) el.textContent = String(streak);
    var box = document.querySelector('[data-today-streak]');
    if (!box) return;
    var label = box.querySelector('.today-streak-label');
    if (label) label.textContent = streak === 1 ? 'day' : 'days in a row';
    var hint = box.querySelector('.today-streak-hint');
    if (!hint) return;
    if (streak === 0)        hint.textContent = 'Visit daily to start a streak.';
    else if (streak === 1)   hint.textContent = 'Welcome. Visit tomorrow to keep it going.';
    else if (streak < 7)     hint.textContent = 'Resets if you skip a day.';
    else if (streak < 30)    hint.textContent = 'A week-plus rhythm. Keep going.';
    else if (streak < 100)   hint.textContent = 'A serious habit. 厲害 lìhài.';
    else                     hint.textContent = streak + ' days. 持之以恒 chízhī yǐhéng.';
  }

  // ── Date label ──────────────────────────────────────────────────────────
  function setDateLabels(todayKey) {
    var short = todayKey;
    var long = '';
    try {
      var d = new Date(todayKey + 'T00:00:00Z');
      long = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    } catch (e) { long = short; }
    document.querySelectorAll('[data-today-date]').forEach(function (el) { el.textContent = short; });
    document.querySelectorAll('[data-today-date-long]').forEach(function (el) { el.textContent = long; });
    setChineseDateStamp(todayKey);
  }

  // Render a small calligraphic date stamp on the hero — year, month/day,
  // weekday — using Chinese numerals so the page reads as a Chinese almanac
  // (黄历 huánglì) rather than a generic dashboard. Year uses zodiac /
  // numeral-by-digit formatting (二〇二六年), month/day use plain numerals,
  // weekday uses 周X (周一 … 周日).
  var CN_DIGITS = ['〇','一','二','三','四','五','六','七','八','九'];
  function cnNumber(n) {
    // Small positive integers written with the simple compound form
    // (e.g. 12 → 十二, 25 → 二十五). Used for month/day values 1–31.
    n = Math.max(0, Math.floor(n));
    if (n === 0) return '〇';
    if (n < 10) return CN_DIGITS[n];
    if (n === 10) return '十';
    if (n < 20) return '十' + CN_DIGITS[n - 10];
    if (n < 100) {
      var tens = Math.floor(n / 10);
      var ones = n % 10;
      return CN_DIGITS[tens] + '十' + (ones ? CN_DIGITS[ones] : '');
    }
    return String(n);
  }
  function cnYearDigits(year) {
    // 2026 → 二〇二六 (digit-by-digit, the standard year form).
    return String(year).split('').map(function (d) {
      return CN_DIGITS[parseInt(d, 10)] || d;
    }).join('');
  }
  function setChineseDateStamp(todayKey) {
    var box = document.querySelector('[data-today-cn-date]');
    if (!box) return;
    try {
      var d = new Date(todayKey + 'T00:00:00Z');
      var year = d.getUTCFullYear();
      var month = d.getUTCMonth() + 1;
      var day = d.getUTCDate();
      // 0 = Sun, 1 = Mon, …, 6 = Sat. Chinese week labels start with Mon.
      var dowMap = ['日','一','二','三','四','五','六']; // index by getUTCDay
      var dow = dowMap[d.getUTCDay()];
      var yEl = box.querySelector('.tds-year');
      var mdEl = box.querySelector('.tds-md');
      var dowEl = box.querySelector('.tds-dow');
      if (yEl) yEl.textContent = cnYearDigits(year) + '年';
      if (mdEl) mdEl.textContent = cnNumber(month) + '月' + cnNumber(day) + '日';
      if (dowEl) dowEl.textContent = '周' + dow;
    } catch (e) { /* leave empty */ }
  }

  // ── Time-of-day greeting ────────────────────────────────────────────────
  // A small piece of personality on the hero: "good morning" / "good evening"
  // in the reader's local time, paired with a Chinese phrase for the same.
  function setGreeting() {
    var hr = new Date().getHours();
    var greeting;
    if (hr < 5)       greeting = { en: 'late hours',     cn: '夜深',  py: 'yèshēn' };
    else if (hr < 12) greeting = { en: 'good morning',   cn: '早上好', py: 'zǎoshang hǎo' };
    else if (hr < 14) greeting = { en: 'midday',         cn: '中午',  py: 'zhōngwǔ' };
    else if (hr < 18) greeting = { en: 'good afternoon', cn: '下午好', py: 'xiàwǔ hǎo' };
    else if (hr < 22) greeting = { en: 'good evening',   cn: '晚上好', py: 'wǎnshang hǎo' };
    else              greeting = { en: 'night reading',  cn: '夜读',  py: 'yèdú' };
    var el = document.querySelector('[data-today-greeting]');
    if (!el) return;
    el.innerHTML = '<span class="greeting-cn" lang="zh">' +
      escapeHtml(greeting.cn) + '</span> <span class="greeting-py">' +
      escapeHtml(greeting.py) + '</span> <span class="greeting-en">· ' +
      escapeHtml(greeting.en) + '</span>';
  }

  // ── Today's thread ──────────────────────────────────────────────────────
  // Mirrors scripts/homepage.js renderFeatured: year-seeded shuffle of the
  // featured.json themes, picked by day-of-year, with a forward walk past
  // any theme whose lead page no longer exists. Same seed = same theme on
  // both pages on the same day.
  function dayOfYear(d) {
    var u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var start = new Date(Date.UTC(u.getUTCFullYear(), 0, 1));
    return Math.floor((u - start) / 86400000);
  }
  function seededShuffle(arr, seed) {
    var out = arr.slice();
    var rand = mulberry32(seed);
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }
  function leadCn(entry) {
    if (!entry) return '';
    if (entry.char) return entry.char;
    if (entry.title && entry.title.indexOf('·') >= 0) return entry.title.split('·')[0].trim();
    return entry.title || '';
  }
  function relPathFromToday(p) {
    // Today page lives at pages/today/. Entry paths in entries.json are
    // 'pages/<cat>/<slug>.html'. From here that's '../<cat>/<slug>.html'.
    return '../' + String(p).replace(/^pages\//, '');
  }
  function renderThread(themes, byPath) {
    var card = document.getElementById('today-thread-card');
    if (!card) return;
    if (!Array.isArray(themes) || !themes.length) {
      card.removeAttribute('aria-busy');
      card.innerHTML = '<div class="today-empty">No thread available today.</div>';
      return;
    }
    var now = new Date();
    var yearSeed = now.getFullYear() * 1000003;
    var shuffled = seededShuffle(themes, yearSeed);
    var day = dayOfYear(now);
    var theme = null, lead = null;
    for (var offset = 0; offset < shuffled.length; offset++) {
      var t = shuffled[(day + offset) % shuffled.length];
      var e = byPath[t.lead];
      if (e) { theme = t; lead = e; break; }
    }
    if (!theme || !lead) {
      card.removeAttribute('aria-busy');
      card.innerHTML = '<div class="today-empty">No thread available today.</div>';
      return;
    }
    var related = (theme.related || []).map(function (p) { return byPath[p]; }).filter(Boolean).slice(0, 4);
    var glyph = leadCn(lead);
    var glyphLen = glyph.length;
    var glyphSize = glyphLen >= 4 ? ' glyph-4' : glyphLen === 3 ? ' glyph-3' : glyphLen === 2 ? ' glyph-2' : '';
    var leadTitleEn = lead.title ? (lead.title.split('·').slice(1).join('·').trim() || lead.title) : theme.title;
    card.dataset.watermark = glyph || '';
    if (lead.category) card.dataset.category = lead.category;
    card.removeAttribute('aria-busy');
    card.innerHTML =
      '<a class="featured-glyph' + glyphSize + '" href="' + escapeHtml(relPathFromToday(lead.path)) + '" aria-label="' + escapeHtml(theme.title) + '">' + escapeHtml(glyph) + '</a>' +
      '<div class="featured-body">' +
        '<span class="featured-week">' + escapeHtml(theme.title) + '</span>' +
        '<h3 class="featured-title"><a href="' + escapeHtml(relPathFromToday(lead.path)) + '">' + escapeHtml(leadTitleEn) + '</a></h3>' +
        (lead.pinyin ? '<span class="featured-py">' + escapeHtml(lead.pinyin) + '</span>' : '') +
        '<p class="featured-hook">' + escapeHtml(theme.hook) + '</p>' +
        (related.length ?
          '<div class="featured-links" role="list">' +
            '<span class="featured-links-label">Follow on</span>' +
            related.map(function (e) {
              var cn = leadCn(e);
              var en = e.title ? (e.title.split('·').slice(1).join('·').trim() || e.title) : '';
              return '<a class="featured-link" href="' + escapeHtml(relPathFromToday(e.path)) + '" role="listitem">' +
                (cn ? '<span class="cn">' + escapeHtml(cn) + '</span>' : '') +
                escapeHtml(en) + '</a>';
            }).join('') +
          '</div>'
        : '') +
      '</div>';
  }

  // ── Main ────────────────────────────────────────────────────────────────
  var todayKey = todayUtcKey();    // for content picks (shared across visitors)
  setDateLabels(todayKey);
  setGreeting();
  // streak.js (loaded earlier) already ticked the streak. Render once now,
  // and again on next animation frame in case streak.js loaded after us
  // (the script tags are both `defer`, so we're at the end of the queue —
  // but be safe).
  renderStreak();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(renderStreak);
  }

  Promise.all([
    fetch('../../data/entries.json', { cache: 'default' }).then(function (r) { return r.json(); }),
    fetch('../../data/featured.json', { cache: 'default' }).then(function (r) { return r.json(); }).catch(function () { return []; })
  ])
    .then(function (results) {
      var entries = results[0];
      var featured = results[1];
      var complete = entries.filter(function (e) { return e.status === 'complete'; });
      var byPath = {};
      complete.forEach(function (e) { byPath[e.path] = e; });

      // Pools: a complete pinyin/CN body is the floor for being interesting;
      // exclude meta categories (families, hsk list pages, hubs — hubs are
      // reading-paths, not single-card subjects).
      var META_CAT = { families: 1, hsk: 1, hubs: 1 };
      var alive = complete.filter(function (e) { return !META_CAT[e.category]; });

      var characters = alive.filter(function (e) { return e.type === 'character'; });
      var vocab      = alive.filter(function (e) { return e.type === 'vocab' && e.category !== 'chengyu'; });
      var grammar    = alive.filter(function (e) { return e.type === 'grammar'; });
      var chengyu    = alive.filter(function (e) { return e.category === 'chengyu'; });

      // Each slot gets its own seeded RNG so adding a new entry to vocab
      // doesn't shift the character pick.
      var rngChar = mulberry32(seedFromString('char-' + todayKey));
      var rngVocab = mulberry32(seedFromString('vocab-' + todayKey));
      var rngGrammar = mulberry32(seedFromString('grammar-' + todayKey));
      var rngChengyu = mulberry32(seedFromString('chengyu-' + todayKey));

      fillSlot('character', pickFrom(characters, rngChar), 'c-red');
      fillSlot('vocab',     pickFrom(vocab,      rngVocab), 'c-teal');
      fillSlot('grammar',   pickFrom(grammar,    rngGrammar), 'c-violet');
      fillSlot('chengyu',   pickFrom(chengyu,    rngChengyu), 'c-ochre');

      renderThread(featured, byPath);
    })
    .catch(function (err) {
      console.warn('today: failed to load entries.json', err);
      document.querySelectorAll('[data-today-slot]').forEach(function (slot) {
        slot.innerHTML = '<div class="card today-empty">Couldn’t load today’s picks. <a href="../../">Browse all entries →</a></div>';
      });
      var card = document.getElementById('today-thread-card');
      if (card) {
        card.removeAttribute('aria-busy');
        card.innerHTML = '<div class="today-empty">Couldn’t load today’s thread. <a href="../../">Browse all entries →</a></div>';
      }
    });
})();
