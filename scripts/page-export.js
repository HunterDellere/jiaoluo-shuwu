/* page-export.js — per-page "Add to Pleco / Anki" buttons.
 *
 * Loaded on every content page via the layout. Looks up the page's metadata
 * (from the doctype-comment JSON the build emits) plus the title, hero CN
 * glyph, hero pinyin, and hero English, and offers two single-card
 * downloads:
 *
 *   • Pleco — a one-line .txt (simplified TAB pinyin TAB definition)
 *     ready for Pleco's Custom Card import.
 *   • Anki — a one-line .tsv (Hanzi TAB Pinyin TAB English) ready for
 *     Anki's File → Import.
 *
 * For users who want a styled .apkg deck, the buttons also link to the
 * bulk /pages/exports/ page where the per-type .apkg files live.
 */
(function () {
  'use strict';
  if (window.__pageExportInit) return;
  window.__pageExportInit = true;

  // ── Metadata extraction ────────────────────────────────────────────────
  // Pull the page's metadata JSON (emitted by the build as a comment after
  // <!DOCTYPE html>). Match the build's allowlist: only export character,
  // vocab, chengyu pages — others don't have a clean atomic-card semantics.
  function readMeta() {
    var doc = document.documentElement;
    var prev = doc.previousSibling;
    if (!prev || prev.nodeType !== 8) return null;
    try { return JSON.parse(prev.data); } catch (e) { return null; }
  }

  function isExportable(meta) {
    if (!meta) return false;
    if (meta.status !== 'complete') return false;
    if (meta.type === 'character') return true;
    if (meta.type === 'vocab' && meta.category === 'vocab') return true;
    if (meta.category === 'chengyu') return true;
    return false;
  }

  // ── Pull display fields from the hero ──────────────────────────────────
  function textOf(sel) {
    var el = document.querySelector(sel);
    return el ? (el.textContent || '').trim() : '';
  }

  function readCard() {
    var heroCn   = textOf('.hero-glyph') || textOf('.topic-hero-title') || '';
    var hanzi    = (heroCn.match(/[一-鿿㐀-䶿]+/g) || []).join('');
    var pinyin   = textOf('.hero-pinyin') || textOf('.topic-hero-title-py') || '';
    // English gloss: prefer .hero-en (character), else hero-desc as a fallback.
    var english  = textOf('.hero-en') || '';
    var desc     = textOf('.topic-hero-desc') || textOf('p.topic-hero-desc') || '';
    return { hanzi: hanzi, pinyin: pinyin.replace(/\s+/g, ' ').trim(), english: english, desc: desc };
  }

  // ── Download helpers ───────────────────────────────────────────────────
  function tsvField(s) {
    return String(s == null ? '' : s).replace(/[\t\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  function plecoLine(card) {
    var defParts = [];
    if (card.english) defParts.push(card.english);
    if (card.desc) defParts.push(card.desc);
    return tsvField(card.hanzi) + '\t' + tsvField(card.pinyin) + '\t' + tsvField(defParts.join(' — '));
  }

  function ankiLine(card) {
    return '#fields:Hanzi\tPinyin\tEnglish\tNotes\n' +
      tsvField(card.hanzi) + '\t' + tsvField(card.pinyin) + '\t' + tsvField(card.english) + '\t' + tsvField(card.desc);
  }

  // ── UI injection ───────────────────────────────────────────────────────
  function buildButtons(card) {
    var fname = card.hanzi || 'entry';
    var wrap = document.createElement('div');
    wrap.className = 'page-export';
    wrap.innerHTML =
      '<span class="page-export-label">Save</span>' +
      '<button type="button" class="page-export-btn" data-export="pleco">' +
        '<span class="pe-cn">百</span> <span class="pe-en">Pleco</span>' +
      '</button>' +
      '<button type="button" class="page-export-btn" data-export="anki">' +
        '<span class="pe-cn">记</span> <span class="pe-en">Anki TSV</span>' +
      '</button>' +
      '<a class="page-export-link" href="/pages/exports/" title="More export options">all →</a>';

    wrap.querySelector('[data-export="pleco"]').addEventListener('click', function () {
      download('jiaoshu-' + fname + '.pleco.txt', plecoLine(card) + '\n');
    });
    wrap.querySelector('[data-export="anki"]').addEventListener('click', function () {
      download('jiaoshu-' + fname + '.anki.tsv', ankiLine(card) + '\n');
    });
    return wrap;
  }

  // Place the export controls just below the hero. We append to the same
  // parent the .topic-hero / .hero lives in (the .main column), right after
  // the hero, so the buttons sit in document order between hero and the
  // first content section.
  function inject() {
    var meta = readMeta();
    if (!isExportable(meta)) return;
    var hero = document.querySelector('.hero, .topic-hero');
    if (!hero) return;
    if (document.querySelector('.page-export')) return; // idempotent
    var card = readCard();
    if (!card.hanzi || !card.pinyin) return; // missing data — bail silently
    var wrap = buildButtons(card);
    hero.parentNode.insertBefore(wrap, hero.nextSibling);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
