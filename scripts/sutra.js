/* sutra.js — toggleable pinyin gloss for sutra passage cards.
 *
 * Loaded only on sutra pages (心经, 阿弥陀经, 金刚经, 坛经, 无量寿经,
 * 观无量寿经). Each .sutra-frame has a <button class="sutra-toggle"
 * data-sutra-toggle="pinyin"> that flips a class on the frame to reveal
 * or hide all .passage-py blocks at once. Each passage also gets a
 * smaller per-passage toggle so a reader who wants pinyin on one verse
 * (eg. 揭谛揭谛) without flipping the whole page can do so.
 *
 * Pinyin preference per page is remembered in sessionStorage so navigation
 * away and back keeps the reader's choice; cross-page persistence would
 * be presumptuous since different sutras may want different defaults.
 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var frames = document.querySelectorAll('.sutra-frame');
    if (!frames.length) return;

    frames.forEach(function (frame) {
      var globalToggle = frame.querySelector('[data-sutra-toggle="pinyin"]');
      if (globalToggle) {
        var key = 'shuwo.sutra.pinyin.' + (frame.getAttribute('data-sutra-id') || location.pathname);
        var stored = null;
        try { stored = sessionStorage.getItem(key); } catch (e) { /* private mode */ }
        if (stored === '1') {
          frame.classList.add('is-pinyin-on');
          globalToggle.setAttribute('aria-pressed', 'true');
        } else {
          globalToggle.setAttribute('aria-pressed', 'false');
        }

        globalToggle.addEventListener('click', function () {
          var on = frame.classList.toggle('is-pinyin-on');
          globalToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
          try { sessionStorage.setItem(key, on ? '1' : '0'); } catch (e) { /* ignore */ }
          if (on) {
            frame.querySelectorAll('.passage.has-pinyin-open').forEach(function (p) {
              p.classList.remove('has-pinyin-open');
            });
          }
        });
      }

      // Per-passage toggles — one tiny button on each passage card that
      // flips just that card's pinyin row, independent of the global state.
      frame.querySelectorAll('.passage').forEach(function (passage) {
        var local = passage.querySelector('[data-passage-toggle="pinyin"]');
        if (!local) return;
        local.addEventListener('click', function () {
          var open = passage.classList.toggle('has-pinyin-open');
          local.setAttribute('aria-pressed', open ? 'true' : 'false');
        });
      });

      // Note toggles — collapsible commentary on each passage.
      frame.querySelectorAll('.passage-note-toggle').forEach(function (btn) {
        var noteId = btn.getAttribute('aria-controls');
        if (!noteId) return;
        var note = document.getElementById(noteId);
        if (!note) return;
        btn.addEventListener('click', function () {
          var hidden = note.hasAttribute('hidden');
          if (hidden) {
            note.removeAttribute('hidden');
            btn.setAttribute('aria-expanded', 'true');
            btn.textContent = '注 close';
          } else {
            note.setAttribute('hidden', '');
            btn.setAttribute('aria-expanded', 'false');
            btn.textContent = '注 open';
          }
        });
      });
    });
  });
})();
