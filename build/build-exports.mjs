#!/usr/bin/env node
/**
 * build-exports.mjs — emit Pleco + Anki flashcard exports of the corpus.
 *
 * Generated artifacts (under data/exports/):
 *   pleco-characters.txt   tab-separated: simplified TAB pinyin TAB definition
 *   pleco-vocab.txt        same shape
 *   pleco-chengyu.txt      same shape
 *   pleco-all.txt          concat of the three
 *   anki-characters.tsv    columns: hanzi pinyin english hsk radical tags
 *   anki-vocab.tsv         columns: hanzi pinyin english hsk tags
 *   anki-chengyu.tsv       columns: hanzi pinyin literal figurative tags
 *   anki-all.apkg          one combined Anki deck (apkg = zipped sqlite + media)
 *   characters.apkg        per-type Anki decks
 *   vocab.apkg
 *   chengyu.apkg
 *
 * Card extraction rules:
 *   - characters: one card per content/characters/*.md (status:complete)
 *   - vocab:      one card per content/vocab/*.md where category === 'vocab'
 *   - chengyu:    one card per content/{vocab,chengyu}/*.md where category === 'chengyu'
 *
 * Pleco import: open Pleco → Settings → Flashcards → Import → choose
 * pleco-*.txt → field order "Simplified, Pinyin, Definition", separator
 * "Tab".
 *
 * Anki TSV import: File → Import → choose anki-*.tsv → set Type to Basic
 * (or a custom note type) → map columns to fields → Import.
 *
 * Anki .apkg import: double-click *.apkg or File → Import. The deck will
 * appear under "角落書屋 · <type>".
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApkg } from './lib/anki-apkg.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = JSON.parse(readFileSync(join(ROOT, 'data/entries.json'), 'utf8'));
const OUT_DIR = join(ROOT, 'data/exports');
mkdirSync(OUT_DIR, { recursive: true });

// ────────────────────── Card extraction ──────────────────────

// Parse the CN form out of "X · Y" titles. Vocab/chengyu pages don't carry
// a `char` field — the title has the canonical form first.
function cnFromTitle(title) {
  if (!title) return '';
  const sep = title.indexOf('·');
  if (sep < 0) return title.trim();
  return title.slice(0, sep).trim();
}
function enFromTitle(title) {
  if (!title) return '';
  const sep = title.indexOf('·');
  if (sep < 0) return '';
  return title.slice(sep + 1).trim();
}

// Pleco's "definition" field accepts plain text. We keep it short enough to
// flash-card naturally: English gloss + one-line desc. Strip newlines and
// flatten whitespace so the field stays one line per Pleco's TSV expectation.
function plecoDefinition(card) {
  const parts = [];
  if (card.english) parts.push(card.english);
  if (card.desc) parts.push(card.desc);
  return parts.join(' — ').replace(/\s+/g, ' ').trim();
}

function extractCards() {
  const characters = [];
  const vocab = [];
  const chengyu = [];

  for (const e of ENTRIES) {
    if (e.status !== 'complete') continue;

    if (e.type === 'character') {
      characters.push({
        hanzi: e.char || cnFromTitle(e.title),
        pinyin: e.pinyin || '',
        english: enFromTitle(e.title),
        desc: e.desc || '',
        hsk: e.hsk || '',
        radical: e.radical || '',
        tone: e.tone || '',
        tags: e.tags || [],
        path: e.path
      });
    } else if (e.type === 'vocab' && e.category === 'vocab') {
      vocab.push({
        hanzi: cnFromTitle(e.title),
        pinyin: e.pinyin || '',
        english: enFromTitle(e.title),
        desc: e.desc || '',
        hsk: e.hsk || '',
        tags: e.tags || [],
        path: e.path
      });
    } else if (e.category === 'chengyu') {
      chengyu.push({
        hanzi: cnFromTitle(e.title),
        pinyin: e.pinyin || '',
        english: enFromTitle(e.title),
        desc: e.desc || '',
        tags: e.tags || [],
        path: e.path
      });
    }
  }

  // Stable sort by hanzi so day-to-day rebuilds produce diffable exports.
  const byHanzi = (a, b) => a.hanzi.localeCompare(b.hanzi, 'zh');
  characters.sort(byHanzi);
  vocab.sort(byHanzi);
  chengyu.sort(byHanzi);
  return { characters, vocab, chengyu };
}

// ────────────────────── Pleco TSV ──────────────────────
// Format: simplified[TAB]pinyin[TAB]definition\n
// Pleco accepts UTF-8 with no BOM. No header row.

function tsvEscape(s) {
  // Pleco's TSV doesn't support escaped tabs/newlines — strip them.
  return String(s || '').replace(/[\t\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

function emitPleco(cards, file) {
  const lines = cards
    .filter(c => c.hanzi && c.pinyin)
    .map(c => `${tsvEscape(c.hanzi)}\t${tsvEscape(c.pinyin)}\t${tsvEscape(plecoDefinition(c))}`);
  writeFileSync(join(OUT_DIR, file), lines.join('\n') + '\n', 'utf8');
  return lines.length;
}

// ────────────────────── Anki TSV ──────────────────────
// Anki accepts TSV via File → Import; users map columns to fields. We emit
// a header comment row Anki ignores (lines starting with '#' are treated as
// pragmas/comments) so the file is self-documenting.

function emitAnkiTsv(cards, file, columns) {
  // columns: [{key, header, derive?}]. `derive` always wins when present —
  // otherwise we'd accidentally `String(array)` truthy fields like c.tags
  // and end up with comma-joined output instead of space-separated.
  const header = '#fields:' + columns.map(c => c.header).join('\t');
  const rows = cards.map(c =>
    columns.map(col => {
      const v = col.derive ? col.derive(c) : c[col.key];
      return tsvEscape(v == null ? '' : v);
    }).join('\t')
  );
  writeFileSync(join(OUT_DIR, file), header + '\n' + rows.join('\n') + '\n', 'utf8');
  return rows.length;
}

// ────────────────────── Main ──────────────────────

const { characters, vocab, chengyu } = extractCards();

const plecoCharCount  = emitPleco(characters, 'pleco-characters.txt');
const plecoVocabCount = emitPleco(vocab,      'pleco-vocab.txt');
const plecoCyCount    = emitPleco(chengyu,    'pleco-chengyu.txt');

// pleco-all is the concat of the three section files, sorted within each
// category. Pleco's import doesn't have a "category" column, so we use
// the order to group: characters first, then vocab, then chengyu.
emitPleco([...characters, ...vocab, ...chengyu], 'pleco-all.txt');

const ankiTagify = c => (c.tags || []).join(' ');
const ankiCharCount = emitAnkiTsv(characters, 'anki-characters.tsv', [
  { key: 'hanzi', header: 'Hanzi' },
  { key: 'pinyin', header: 'Pinyin' },
  { key: 'english', header: 'English', derive: c => c.english || c.desc },
  { key: 'hsk', header: 'HSK' },
  { key: 'radical', header: 'Radical' },
  { key: 'desc', header: 'Notes' },
  { key: 'tags', header: 'Tags', derive: ankiTagify }
]);
const ankiVocabCount = emitAnkiTsv(vocab, 'anki-vocab.tsv', [
  { key: 'hanzi', header: 'Hanzi' },
  { key: 'pinyin', header: 'Pinyin' },
  { key: 'english', header: 'English', derive: c => c.english || c.desc },
  { key: 'hsk', header: 'HSK' },
  { key: 'desc', header: 'Notes' },
  { key: 'tags', header: 'Tags', derive: ankiTagify }
]);
const ankiCyCount = emitAnkiTsv(chengyu, 'anki-chengyu.tsv', [
  { key: 'hanzi', header: 'Hanzi' },
  { key: 'pinyin', header: 'Pinyin' },
  { key: 'english', header: 'Literal', derive: c => c.english || '' },
  { key: 'desc', header: 'Figurative' },
  { key: 'tags', header: 'Tags', derive: ankiTagify }
]);

// ────────────────────── Anki .apkg decks ──────────────────────
// Builds proper Anki deck packages (zipped sqlite + media). Uses our own
// build/lib/anki-apkg.mjs (better-sqlite3 + jszip) to dodge the 16 MB
// WASM-heap cap of the older sql.js-based libraries.
async function emitApkg(cards, deckName, file, formatBack) {
  const ankiCards = cards
    .filter(c => c.hanzi)
    .map(c => ({
      front: `<div style="font-size:42px;font-family:'Noto Serif SC',serif;">${escapeHtml(c.hanzi)}</div>`,
      back: formatBack(c),
      tags: (c.tags || []).filter(t => t && /^[\w-]+$/.test(t))
    }));
  const buf = await buildApkg({ deckName, cards: ankiCards });
  writeFileSync(join(OUT_DIR, file), buf);
  return ankiCards.length;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function backCharacter(c) {
  return [
    `<div style="font-family:monospace;color:#a06428;font-size:18px;">${escapeHtml(c.pinyin)}</div>`,
    c.english ? `<div style="margin:8px 0 4px;font-weight:600;">${escapeHtml(c.english)}</div>` : '',
    c.desc ? `<div style="font-style:italic;color:#5c3821;">${escapeHtml(c.desc)}</div>` : '',
    `<div style="margin-top:10px;font-size:12px;color:#888;">` +
      [c.hsk ? `HSK ${c.hsk}` : '', c.radical ? `radical ${c.radical}` : ''].filter(Boolean).join(' · ') +
    `</div>`
  ].filter(Boolean).join('');
}
function backVocab(c) {
  return [
    `<div style="font-family:monospace;color:#a06428;font-size:18px;">${escapeHtml(c.pinyin)}</div>`,
    c.english ? `<div style="margin:8px 0 4px;font-weight:600;">${escapeHtml(c.english)}</div>` : '',
    c.desc ? `<div style="font-style:italic;color:#5c3821;">${escapeHtml(c.desc)}</div>` : '',
    c.hsk ? `<div style="margin-top:10px;font-size:12px;color:#888;">HSK ${c.hsk}</div>` : ''
  ].filter(Boolean).join('');
}
function backChengyu(c) {
  return [
    `<div style="font-family:monospace;color:#a06428;font-size:18px;">${escapeHtml(c.pinyin)}</div>`,
    c.english ? `<div style="margin:8px 0 4px;font-weight:600;">${escapeHtml(c.english)}</div>` : '',
    c.desc ? `<div style="font-style:italic;color:#5c3821;">${escapeHtml(c.desc)}</div>` : ''
  ].filter(Boolean).join('');
}

// Per-type apkg decks plus a combined deck for users who want one import.
const apkgCharCount  = await emitApkg(characters, '角落書屋 · Characters', 'characters.apkg', backCharacter);
const apkgVocabCount = await emitApkg(vocab,      '角落書屋 · Vocabulary', 'vocab.apkg',      backVocab);
const apkgCyCount    = await emitApkg(chengyu,    '角落書屋 · Chengyu',    'chengyu.apkg',    backChengyu);

// Combined deck — same cards, single deck. Uses the per-type back formatters
// via a tag-routed _back, plus a content-type tag so Anki users can filter
// or sub-deck after import.
const allCards = [
  ...characters.map(c => ({ ...c, tags: [...(c.tags || []), 'character'], _back: backCharacter })),
  ...vocab.map(c =>      ({ ...c, tags: [...(c.tags || []), 'vocab'],     _back: backVocab })),
  ...chengyu.map(c =>    ({ ...c, tags: [...(c.tags || []), 'chengyu'],   _back: backChengyu }))
];
const apkgAllCount = await (async () => {
  const ankiCards = allCards
    .filter(c => c.hanzi)
    .map(c => ({
      front: `<div style="font-size:42px;font-family:'Noto Serif SC',serif;">${escapeHtml(c.hanzi)}</div>`,
      back: c._back(c),
      tags: (c.tags || []).filter(t => t && /^[\w-]+$/.test(t))
    }));
  const buf = await buildApkg({ deckName: '角落書屋 · All', cards: ankiCards });
  writeFileSync(join(OUT_DIR, 'all.apkg'), buf);
  return ankiCards.length;
})();

// Manifest summarizing counts so the bulk page can render dynamically.
const manifest = {
  generated: new Date().toISOString(),
  files: [
    { file: 'pleco-characters.txt', format: 'pleco', type: 'characters', count: plecoCharCount },
    { file: 'pleco-vocab.txt',      format: 'pleco', type: 'vocab',      count: plecoVocabCount },
    { file: 'pleco-chengyu.txt',    format: 'pleco', type: 'chengyu',    count: plecoCyCount },
    { file: 'pleco-all.txt',        format: 'pleco', type: 'all',        count: plecoCharCount + plecoVocabCount + plecoCyCount },
    { file: 'anki-characters.tsv',  format: 'anki-tsv', type: 'characters', count: ankiCharCount },
    { file: 'anki-vocab.tsv',       format: 'anki-tsv', type: 'vocab',      count: ankiVocabCount },
    { file: 'anki-chengyu.tsv',     format: 'anki-tsv', type: 'chengyu',    count: ankiCyCount },
    { file: 'characters.apkg',      format: 'anki-apkg', type: 'characters', count: apkgCharCount },
    { file: 'vocab.apkg',           format: 'anki-apkg', type: 'vocab',      count: apkgVocabCount },
    { file: 'chengyu.apkg',         format: 'anki-apkg', type: 'chengyu',    count: apkgCyCount },
    { file: 'all.apkg',             format: 'anki-apkg', type: 'all',        count: apkgAllCount }
  ]
};
writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log('build-exports:');
console.log(`  Pleco — characters: ${plecoCharCount}, vocab: ${plecoVocabCount}, chengyu: ${plecoCyCount}`);
console.log(`  Anki TSV — characters: ${ankiCharCount}, vocab: ${ankiVocabCount}, chengyu: ${ankiCyCount}`);
console.log(`  Anki .apkg — characters: ${apkgCharCount}, vocab: ${apkgVocabCount}, chengyu: ${apkgCyCount}, all: ${apkgAllCount}`);
console.log(`  Manifest: data/exports/manifest.json`);
