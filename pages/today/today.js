/* today.js — daily picks page logic.
 *
 * Picks 1 character + 1 vocab + 1 grammar + 1 chengyu deterministically by
 * UTC date, so every visitor sees the same set on the same day. Picks rotate
 * at UTC midnight without any server rebuild.
 *
 * Streak counter (localStorage, this-device only): increments when a new UTC
 * day's pick is loaded, resets if the gap is more than one day.
 */
(function () {
  'use strict';

  // ── Date helpers ────────────────────────────────────────────────────────
  function todayUtcKey() {
    var d = new Date();
    var y = d.getUTCFullYear();
    var m = String(d.getUTCMonth() + 1).padStart(2, '0');
    var day = String(d.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
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
  function updateStreak(todayKey) {
    var STREAK_KEY = 'shuwo-streak';
    var LAST_KEY = 'shuwo-last-visit';
    var streak = 0;
    var last = '';
    try {
      streak = parseInt(localStorage.getItem(STREAK_KEY) || '0', 10) || 0;
      last = localStorage.getItem(LAST_KEY) || '';
    } catch (e) {}

    if (last === todayKey) {
      // Same day — don't double-count.
    } else if (last && diffInDaysUtc(last, todayKey) === 1) {
      streak += 1;
    } else {
      // First visit ever, or a gap of more than one day → start at 1.
      streak = 1;
    }

    try {
      localStorage.setItem(STREAK_KEY, String(streak));
      localStorage.setItem(LAST_KEY, todayKey);
    } catch (e) {}

    var el = document.querySelector('[data-streak-count]');
    if (el) el.textContent = String(streak);
    var box = document.querySelector('[data-today-streak]');
    if (box) {
      var label = box.querySelector('.today-streak-label');
      if (label) label.textContent = streak === 1 ? 'day' : 'days in a row';
      var hint = box.querySelector('.today-streak-hint');
      if (hint) {
        if (streak === 1) hint.textContent = 'Welcome — visit again tomorrow to keep it going.';
        else if (streak < 7) hint.textContent = 'Resets if you skip a day.';
        else if (streak < 30) hint.textContent = 'Nice — a week-plus rhythm.';
        else hint.textContent = 'A serious habit. 厲害.';
      }
    }
  }

  function diffInDaysUtc(aIso, bIso) {
    var a = new Date(aIso + 'T00:00:00Z').getTime();
    var b = new Date(bIso + 'T00:00:00Z').getTime();
    return Math.round((b - a) / 86400000);
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

  // ── Main ────────────────────────────────────────────────────────────────
  var todayKey = todayUtcKey();
  setDateLabels(todayKey);
  setGreeting();
  updateStreak(todayKey);

  fetch('../../data/entries.json', { cache: 'default' })
    .then(function (r) { return r.json(); })
    .then(function (entries) {
      var complete = entries.filter(function (e) { return e.status === 'complete'; });

      // Pools: a complete pinyin/CN body is the floor for being interesting;
      // exclude meta categories (families, hsk list pages, hubs by default
      // since hubs are reading-paths, not single-card subjects).
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
    })
    .catch(function (err) {
      console.warn('today: failed to load entries.json', err);
      document.querySelectorAll('[data-today-slot]').forEach(function (slot) {
        slot.innerHTML = '<div class="card today-empty">Couldn’t load today’s picks. <a href="../../">Browse all entries →</a></div>';
      });
    });
})();
