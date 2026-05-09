#!/usr/bin/env node
/**
 * validate-formatting.mjs — structural and formatting quality checks.
 *
 * Checks (all emit category:'formatting'):
 *   - Character pages missing the 'etymology' section-anchor (WARN)
 *   - Topic/vocab/grammar/chengyu pages missing <header class="topic-hero"> (WARN)
 *   - complete pages missing any section-anchor at all (WARN)
 *   - Inconsistent tone markers: hero pinyin diacritic ≠ frontmatter tone number (ERROR)
 *   - Entries with content_review:verified but no visible sources block (WARN)
 *   - Vocab-card examples with Chinese text but no pinyin span (INFO)
 *
 * Reads pages/**\/*.html (generated) + content/**\/*.md (frontmatter).
 * Writes findings into data/_admin/findings.json via mergeFindings().
 */

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { createFinding, mergeFindings, reportFindings } from './lib/findings.mjs';

const ROOT    = path.resolve(new URL('.', import.meta.url).pathname, '..');
const PAGES   = path.join(ROOT, 'pages');
const CONTENT = path.join(ROOT, 'content');

const findings = [];
function emit(level, file, msg, extra = {}) {
  findings.push(createFinding({ level, category: 'formatting', file, msg, ...extra }));
}

// ── tone helpers (mirror validate-facts.mjs) ──────────────────────────────

const TONE_MARKS = { '̄': 1, '́': 2, '̌': 3, '̀': 4 };
function toneFromPinyin(py) {
  if (!py) return null;
  const nfd = py.normalize('NFD');
  for (const ch of nfd) {
    if (TONE_MARKS[ch] !== undefined) return TONE_MARKS[ch];
  }
  return 5; // neutral
}

// ── file walkers ─────────────────────────────────────────────────────────────

function walkPages(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('_')) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walkPages(full));
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

// ── main check loop ───────────────────────────────────────────────────────────

for (const pageFull of walkPages(PAGES)) {
  const pageRel = path.relative(ROOT, pageFull); // e.g. "pages/characters/gan3_感.html"
  const contentRel = pageRel.replace(/^pages\//, 'content/').replace(/\.html$/, '.md');
  const contentFull = path.join(ROOT, contentRel);

  // Skip pages with no corresponding content source (e.g. hsk/ synthesized pages)
  if (!fs.existsSync(contentFull)) continue;

  const html = fs.readFileSync(pageFull, 'utf8');
  const src  = fs.readFileSync(contentFull, 'utf8');
  const { data: fm } = matter(src);

  // Only check complete pages — stubs are intentionally thin
  if (fm.status !== 'complete') continue;

  const type = fm.type;
  const relFile = contentRel;

  // ── 1. Character page: must have etymology section ───────────────────────
  if (type === 'character') {
    if (!html.includes('id="etymology"')) {
      emit('WARN', relFile, 'character page missing section-anchor id="etymology"', {
        fix: 'Add <span class="section-anchor" id="etymology"></span> before the etymology section head',
      });
    }
  }

  // ── 2. Non-character types: must have topic-hero header ─────────────────
  if (['topic', 'vocab', 'grammar', 'chengyu'].includes(type)) {
    if (!/<header class="topic-hero"/.test(html)) {
      emit('WARN', relFile, `${type} page missing <header class="topic-hero">`, {
        fix: 'Wrap the page header in <header class="topic-hero"> per the content page spec',
      });
    }
  }

  // ── 3. All complete pages: must have at least one section-anchor ─────────
  if (!html.includes('class="section-anchor"')) {
    emit('WARN', relFile, 'no section-anchor elements found — TOC scroll-spy will not work', {
      fix: 'Add <span class="section-anchor" id="..."></span> before each major section',
    });
  }

  // ── 4. Tone marker / tone number consistency ─────────────────────────────
  // Only for character pages with both pinyin and tone in frontmatter.
  // validate-facts already checks this, but that validator skips non-character
  // pages. Here we catch vocab/grammar/topic pages that embed pinyin in the hero.
  if (type !== 'character' && fm.pinyin && fm.tone) {
    const derived = toneFromPinyin(fm.pinyin);
    if (derived !== null && derived !== fm.tone) {
      emit('ERROR', relFile,
        `tone: ${fm.tone} but pinyin '${fm.pinyin}' has tone mark = ${derived}`,
        { fix: `Fix either the 'tone' or 'pinyin' frontmatter field so they agree` });
    }
  }

  // ── 5. Verified entries: sources block should be present ─────────────────
  if (fm.content_review === 'verified') {
    const hasSources = /class="sources|id="sources|<div[^>]+sources/.test(html) ||
                       (fm.content_sources && fm.content_sources.length > 0);
    if (!hasSources) {
      emit('WARN', relFile, `content_review:verified but no sources block found`, {
        fix: 'Add a Sources section to the page body listing the reference works consulted',
      });
    }
  }

  // ── 6. Em-dash hygiene ───────────────────────────────────────────────────
  // Em-dashes in tooltip/summary fields (frontmatter desc/metaDesc/title/pageTitle)
  // are visible in Google search snippets, social shares, and homepage cards. They
  // should be zero. Body prose has a per-page budget — many em-dashes in body =
  // voice regression even after the 2026-04 rewrite pass.
  const FRONTMATTER_TEXT_FIELDS = ['desc', 'metaDesc', 'title', 'pageTitle'];
  for (const field of FRONTMATTER_TEXT_FIELDS) {
    const v = fm[field];
    if (typeof v === 'string' && v.includes('—')) {
      emit('ERROR', relFile,
        `frontmatter '${field}' contains em-dash (—) — these surface in tooltips, search snippets, and card summaries`,
        { fix: `Rewrite frontmatter ${field} without em-dash. Use a comma, colon, parenthetical, or split into two sentences.` });
    }
  }

  // Body em-dash budget: count em-dashes in user-authored prose. Allow a small
  // budget per page (3) before warning. Never count em-dashes that are
  // legitimate typographic conventions: gloss separators (.sh-en/.card-en/
  // .cy-en/.a-en), HTML attribute values (e.g. data-distinct="…—…"), Chinese
  // example/title text where —— is the standard 破折号 punctuation, or fenced
  // code. The remaining count reflects only English prose em-dashes — the
  // voice-regression risk we actually care about.
  const bodyForCount = src
    .replace(/^---[\s\S]*?\n---\n/, '')                       // strip frontmatter
    .replace(/```[\s\S]*?```/g, '')                           // strip fenced code
    .replace(/<!--[\s\S]*?-->/g, '')                          // strip HTML comments
    .replace(/<span class="sh-en">[\s\S]*?<\/span>/g, '')     // strip section gloss
    .replace(/<span class="card-en">[\s\S]*?<\/span>/g, '')   // strip card gloss
    .replace(/<span class="cy-en">[\s\S]*?<\/span>/g, '')     // strip chengyu gloss
    .replace(/<span class="a-en">[\s\S]*?<\/span>/g, '')      // strip adj chip gloss
    .replace(/<div class="ex-cn">[\s\S]*?<\/div>/g, '')       // strip Chinese examples (— is 破折号)
    .replace(/<span class="sh-cn">[\s\S]*?<\/span>/g, '')     // strip Chinese section title
    .replace(/<span class="card-cn">[\s\S]*?<\/span>/g, '')   // strip Chinese card title
    .replace(/<span class="cy-cn">[\s\S]*?<\/span>/g, '')     // strip Chinese chengyu
    .replace(/<span class="a-cn">[\s\S]*?<\/span>/g, '')      // strip Chinese adj chip
    .replace(/<span class="[^"]*td-py-sm[^"]*">[\s\S]*?<\/span>/g, '') // strip table inline gloss
    .replace(/<[^>]*>/g, '');                                 // strip remaining HTML tags (incl. attributes)
  // Em-dashes that follow sentence-ending punctuation (with optional close
  // quote) are gloss separators ("Chinese sentence. — English translation"),
  // a stable typographic convention, not voice em-dashes. Don't count them.
  const proseEmDashes = bodyForCount.match(/—/g) || [];
  const emDashCount = proseEmDashes.length - (bodyForCount.match(/[.!?。！？][\s"'”’)\]]*—\s/g) || []).length;
  const EM_DASH_BUDGET = 3;
  if (emDashCount > EM_DASH_BUDGET) {
    emit('WARN', relFile,
      `${emDashCount} em-dashes in body prose (budget ${EM_DASH_BUDGET}). Voice regression risk.`,
      { fix: `Rewrite to use commas, colons, parentheticals, or sentence splits. Keep em-dashes only for sharp interruptions a comma cannot carry.` });
  }

  // ── 7. Card examples: Chinese text without pinyin sibling ────────────────
  // Look for .card elements that contain CJK characters but no .card-py or
  // .card-rd span. This is a common authoring gap.
  const cardRe = /<(?:div|article)[^>]*class="card[^"]*"[^>]*>([\s\S]*?)<\/(?:div|article)>/g;
  let cardMatch;
  let missingPinyinCount = 0;
  while ((cardMatch = cardRe.exec(html)) !== null) {
    const cardBody = cardMatch[1];
    // Check if this card has CJK content
    const hasCjk = /[一-鿿㐀-䶿]/.test(cardBody);
    // Check if it has a pinyin span (.card-py or .card-rd)
    const hasPinyin = /class="card-py|class="card-rd/.test(cardBody);
    if (hasCjk && !hasPinyin) missingPinyinCount++;
  }
  if (missingPinyinCount > 0) {
    emit('INFO', relFile,
      `${missingPinyinCount} vocab card${missingPinyinCount > 1 ? 's' : ''} contain Chinese text but no pinyin span (.card-py)`,
      { fix: 'Add <span class="card-py">…</span> to each card entry' });
  }
}

// ── persist ──────────────────────────────────────────────────────────────────
reportFindings('validate-formatting', findings);
mergeFindings(ROOT, findings, ['formatting']);

const errorCount = findings.filter(f => f.level === 'ERROR').length;
process.exit(errorCount > 0 ? 1 : 0);
