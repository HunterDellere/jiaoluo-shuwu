/**
 * HSK list renderer.
 *
 * Parses the raw reference markdown in content/hsk/_source/hsk-*.md into
 * structured HTML blocks — Characters, Vocabulary, Grammar — that can be
 * injected into an HSK level page body. Cross-references data/entries.json
 * so each row is linked when a full entry exists for that character/word.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CHAR_LINE = /^\s*-\s*(.+?)\s*$/;

function parseSection(src, heading) {
  const lines = src.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim().startsWith(`## ${heading}`)) i++;
  if (i >= lines.length) return [];
  i++;
  const rows = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('## ')) break;
    if (line.trim().startsWith('---')) { i++; continue; }
    const m = line.match(CHAR_LINE);
    if (m) rows.push(m[1]);
    i++;
  }
  return rows;
}

function splitSimpTrad(token) {
  // "爱 / 愛" → { simp: "爱", trad: "愛" }
  const parts = token.split('/').map(s => s.trim());
  return { simp: parts[0], trad: parts[1] || null };
}

function parseCharRow(raw) {
  return splitSimpTrad(raw);
}

function parseVocabRow(raw) {
  // Format: "simplified [/ trad] — pinyin — POS — English gloss"
  // Some rows have multiple em-dashes inside the gloss, so split on the first three occurrences.
  const parts = raw.split('—').map(s => s.trim());
  const head = parts[0] || '';
  const pinyin = parts[1] || '';
  const pos = parts[2] || '';
  const gloss = parts.slice(3).join(' — ').trim();
  const hz = splitSimpTrad(head);
  return { ...hz, pinyin, pos, gloss };
}

function parseGrammarRow(raw) {
  // Grammar entries are a free-form string; trim and keep as-is.
  return { text: raw.trim() };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildCharLookup(entries) {
  // char → entry path (character entries only)
  const map = new Map();
  for (const e of entries) {
    if (e.status !== 'complete') continue;
    if (e.type === 'character' && e.char) map.set(e.char, e);
  }
  return map;
}

function buildWordLookup(entries) {
  // Chinese word (extracted from title) → entry path (vocab/chengyu)
  const map = new Map();
  for (const e of entries) {
    if (e.status !== 'complete') continue;
    if (e.type !== 'vocab' && e.category !== 'chengyu') continue;
    if (!e.title) continue;
    const head = e.title.split('·')[0].trim();
    const hz = head.match(/^[\u4e00-\u9fff]+/);
    if (hz) map.set(hz[0], e);
  }
  return map;
}

function charLink(ch, lookup, basePath = '../../') {
  if (!ch) return '';
  const entry = lookup.get(ch);
  if (!entry) return `<span class="hsk-ch">${escapeHtml(ch)}</span>`;
  return `<a class="hsk-ch hsk-ch-linked" href="${basePath}${entry.path}">${escapeHtml(ch)}</a>`;
}

function wordLink(word, lookup, basePath = '../../') {
  if (!word) return '';
  const entry = lookup.get(word);
  if (!entry) return `<span class="hsk-wd">${escapeHtml(word)}</span>`;
  return `<a class="hsk-wd hsk-wd-linked" href="${basePath}${entry.path}">${escapeHtml(word)}</a>`;
}

/**
 * Sibling level prev/next nav at the bottom of every HSK page.
 */
function renderPrevNext(level, siblingLevels) {
  const order = siblingLevels.map(s => s.lvl);
  const i = order.indexOf(level);
  if (i < 0) return '';
  const prev = i > 0 ? siblingLevels[i - 1] : null;
  const next = i < order.length - 1 ? siblingLevels[i + 1] : null;
  const prevLink = prev
    ? `<a class="hsk-prev" href="hsk-${prev.lvl}.html" rel="prev"><span class="hsk-prev-label">← HSK ${prev.lvl === '7-9' ? '7–9' : prev.lvl}</span><span class="hsk-prev-cn">${prev.cn}</span></a>`
    : '<span class="hsk-prev-placeholder"></span>';
  const nextLink = next
    ? `<a class="hsk-next" href="hsk-${next.lvl}.html" rel="next"><span class="hsk-next-label">HSK ${next.lvl === '7-9' ? '7–9' : next.lvl} →</span><span class="hsk-next-cn">${next.cn}</span></a>`
    : '<span class="hsk-next-placeholder"></span>';
  return `<nav class="hsk-prev-next" aria-label="HSK level navigation">
      ${prevLink}
      ${nextLink}
    </nav>`;
}

/**
 * Render the body HTML for one HSK level page.
 *
 * @param {string} level   e.g. '1', '2', ..., '7-9'
 * @param {Array}  entries all complete entries (used to cross-link)
 * @param {string} rootDir project root
 */
export function renderHskBody(level, entries, rootDir) {
  const srcPath = join(rootDir, 'content', 'hsk', '_source', `hsk-${level}.md`);
  if (!existsSync(srcPath)) {
    return `<p>Source list not found for HSK ${level}.</p>`;
  }
  const src = readFileSync(srcPath, 'utf8');

  const charRowsRaw = parseSection(src, 'Characters');
  const vocabRowsRaw = parseSection(src, 'Vocabulary');
  const grammarRowsRaw = parseSection(src, 'Grammar');

  const chars = charRowsRaw.map(parseCharRow);
  const vocab = vocabRowsRaw.map(parseVocabRow);
  const grammar = grammarRowsRaw.map(parseGrammarRow);

  const charLookup = buildCharLookup(entries);
  const wordLookup = buildWordLookup(entries);

  let linkedChars = 0;
  for (const c of chars) if (charLookup.has(c.simp)) linkedChars++;
  let linkedVocab = 0;
  for (const v of vocab) if (wordLookup.has(v.simp) || charLookup.has(v.simp)) linkedVocab++;

  const levelLabel = level === '7-9' ? '7–9' : level;
  const titleCn = level === '7-9' ? '高级 · HSK 7-9' : `第${['', '一','二','三','四','五','六'][Number(level)]||level}级 · HSK ${level}`;

  // Sibling-level chips: cross-link every HSK page to the other six levels.
  // Renders as a `.adj-wrap` chip strip; the HSK extension in build/lib/adj-index.mjs
  // re-scans rendered HSK HTML so these chips count toward orphan-detector inbounds.
  const SIBLING_LEVELS = [
    { lvl: '1', cn: '第一级', py: 'dì-yī jí', en: 'HSK 1 — entry-level vocabulary list' },
    { lvl: '2', cn: '第二级', py: 'dì-èr jí', en: 'HSK 2 — elementary vocabulary list' },
    { lvl: '3', cn: '第三级', py: 'dì-sān jí', en: 'HSK 3 — intermediate vocabulary list' },
    { lvl: '4', cn: '第四级', py: 'dì-sì jí', en: 'HSK 4 — upper-intermediate vocabulary list' },
    { lvl: '5', cn: '第五级', py: 'dì-wǔ jí', en: 'HSK 5 — advanced vocabulary list' },
    { lvl: '6', cn: '第六级', py: 'dì-liù jí', en: 'HSK 6 — proficient vocabulary list' },
    { lvl: '7-9', cn: '高级', py: 'gāojí', en: 'HSK 7–9 — advanced/mastery vocabulary list' },
  ];
  const siblingChips = SIBLING_LEVELS
    .filter(s => s.lvl !== level)
    .map(s => `      <span class="adj"><span class="a-cn">${s.cn}</span><span class="a-py">${s.py}</span><span class="a-en">${escapeHtml(s.en)}</span></span>`)
    .join('\n');

  const charHtml = chars.map(c => {
    const simp = charLink(c.simp, charLookup);
    const trad = c.trad ? ` <span class="hsk-trad">/ ${escapeHtml(c.trad)}</span>` : '';
    const key = `c-${c.simp}`;
    const check = `<input type="checkbox" class="hsk-check" data-hsk-key="${escapeHtml(key)}" aria-label="Mark ${escapeHtml(c.simp)} reviewed">`;
    // Audio: only when we have a linked entry with a known pinyin reading
    const linkedEntry = charLookup.get(c.simp);
    const audioBtn = linkedEntry && linkedEntry.pinyin
      ? `<button type="button" class="audio-btn audio-btn--inline hsk-audio" data-audio="${escapeHtml(c.simp)}" data-pinyin="${escapeHtml(linkedEntry.pinyin)}" aria-label="Play pronunciation"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button>`
      : '';
    return `<li class="hsk-char-item" data-hsk-item="${escapeHtml(key)}">${check}${simp}${trad}${audioBtn}</li>`;
  }).join('\n        ');

  const vocabHtml = vocab.map(v => {
    const link = wordLookup.get(v.simp) ? wordLink(v.simp, wordLookup) : charLink(v.simp, charLookup);
    const trad = v.trad ? ` <span class="hsk-trad">/ ${escapeHtml(v.trad)}</span>` : '';
    const metaParts = [
      v.pinyin ? `<span class="hsk-vocab-py">${escapeHtml(v.pinyin)}</span>` : '',
      v.pos ? `<span class="hsk-vocab-pos">${escapeHtml(v.pos)}</span>` : '',
    ].filter(Boolean).join('');
    const key = `v-${v.simp}`;
    const check = `<input type="checkbox" class="hsk-check" data-hsk-key="${escapeHtml(key)}" aria-label="Mark ${escapeHtml(v.simp)} reviewed">`;
    // Audio button on vocab rows (uses inline-audio infra so play-all + per-row click both work)
    const audioBtn = v.pinyin && !/[\/…]/.test(v.simp) && !/[\/…]/.test(v.pinyin)
      ? `<button type="button" class="audio-btn audio-btn--inline hsk-audio" data-audio="${escapeHtml(v.simp)}" data-pinyin="${escapeHtml(v.pinyin)}" aria-label="Play pronunciation"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button>`
      : '';
    return `<li class="hsk-vocab-item" data-hsk-item="${escapeHtml(key)}">
          ${check}
          <span class="hsk-vocab-hz">${link}${trad}</span>
          ${audioBtn}
          ${metaParts ? `<span class="hsk-vocab-meta">${metaParts}</span>` : ''}
          ${v.gloss ? `<span class="hsk-vocab-gloss">${escapeHtml(v.gloss)}</span>` : ''}
        </li>`;
  }).join('\n        ');

  const grammarHtml = grammar.map(g => `<li class="hsk-grammar-item">${escapeHtml(g.text)}</li>`).join('\n        ');

  return `
<div class="shell">

  <aside class="sidebar" id="sidebar">
    <span class="toc-topic">HSK ${escapeHtml(levelLabel)}</span>
    <span class="toc-topic-en">Level list</span>
    <div class="toc-divider"></div>
    <span class="toc-label">On this page</span>
    <ul class="toc-list">
      <li><a href="#characters"><span class="toc-cn">汉字</span> Characters<span class="toc-sub">${chars.length} hànzì</span></a></li>
      <li><a href="#vocabulary"><span class="toc-cn">词汇</span> Vocabulary<span class="toc-sub">${vocab.length} cíhuì</span></a></li>
      <li><a href="#grammar"><span class="toc-cn">语法</span> Grammar<span class="toc-sub">${grammar.length} yǔfǎ</span></a></li>
    </ul>
  </aside>

  <main class="main" id="main-content">
    <header class="topic-hero">
      <span class="topic-hero-eyebrow">HSK · 汉语水平考试 Hànyǔ Shuǐpíng Kǎoshì</span>
      <h1 class="topic-hero-title">${escapeHtml(titleCn)}</h1>
      <span class="topic-hero-title-py">HSK ${escapeHtml(levelLabel)}</span>
      <p class="topic-hero-desc">The full vocabulary, character, and grammar list for HSK ${escapeHtml(levelLabel)}, sourced from the 2021 国际中文教育中文水平等级标准. Entries linked to a full Jiǎoluò Shūwū page when one exists.</p>
      <div class="hsk-stats">
        <span class="hsk-stat"><strong>${chars.length}</strong> characters${linkedChars ? ` · <em>${linkedChars} linked</em>` : ''}</span>
        <span class="hsk-stat"><strong>${vocab.length}</strong> words${linkedVocab ? ` · <em>${linkedVocab} linked</em>` : ''}</span>
        <span class="hsk-stat"><strong>${grammar.length}</strong> grammar points</span>
      </div>
    </header>

    <div class="hsk-review-bar" data-hsk-level="${escapeHtml(level)}" data-hsk-total="${chars.length + vocab.length}">
      <div class="hsk-tally">
        <span class="hsk-tally-count"><strong data-hsk-reviewed-count>0</strong> / ${chars.length + vocab.length}</span>
        <span class="hsk-tally-label">reviewed</span>
        <div class="hsk-tally-bar"><div class="hsk-tally-bar-fill" data-hsk-progress-fill style="width: 0%"></div></div>
      </div>
      <div class="hsk-review-actions">
        <button type="button" class="hsk-action" data-hsk-play-all aria-label="Play pronunciation of every item">▶ Play all</button>
        <button type="button" class="hsk-action" data-hsk-jump-next aria-label="Scroll to first unreviewed item">↓ Next unreviewed</button>
        <button type="button" class="hsk-action hsk-action-secondary" data-hsk-print aria-label="Print as flashcard sheet">⎙ Print</button>
        <button type="button" class="hsk-action hsk-action-secondary" data-hsk-reset aria-label="Reset progress for this level">↺ Reset</button>
      </div>
    </div>

    <span class="section-anchor" id="characters"></span>
    <div class="section-head"><h2>Characters · 汉字</h2></div>
    <ul class="hsk-char-grid">
      ${charHtml}
    </ul>

    <span class="section-anchor" id="vocabulary"></span>
    <div class="section-head"><h2>Vocabulary · 词汇</h2></div>
    <ul class="hsk-vocab-list">
      ${vocabHtml}
    </ul>

    <span class="section-anchor" id="grammar"></span>
    <div class="section-head"><h2>Grammar · 语法</h2></div>
    <ul class="hsk-grammar-list">
      ${grammarHtml}
    </ul>

    <div class="adj-wrap">
${siblingChips}
    </div>

    ${renderPrevNext(level, SIBLING_LEVELS)}
  </main>

</div>
`.trim();
}
