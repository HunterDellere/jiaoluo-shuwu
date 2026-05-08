/**
 * pinyin-index.mjs — group character entries by toneless base syllable
 * and render disambiguation pages at /pages/pinyin/<syllable>.html.
 *
 * Captures the long-tail "[pinyin] chinese character" search query — readers
 * who type "ai pinyin" or "gan3" land on a hub that lists every reading +
 * sample compounds, then funnels into the relevant character page.
 *
 * Toneless aggregation only this session: ai → 爱 ài / 哀 āi / 矮 ǎi /…
 * One page per distinct base syllable. Tone splits can come later if data
 * warrants it.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pinyinToNumericSyllables } from './pinyin.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const LAYOUT = readFileSync(join(ROOT, 'templates/_layout.html'), 'utf8');

const SITE_URL = 'https://jiaoshoo.com';

const TONE_MARK_MAP = {
  'ā':'a','á':'a','ǎ':'a','à':'a',
  'ē':'e','é':'e','ě':'e','è':'e',
  'ī':'i','í':'i','ǐ':'i','ì':'i',
  'ō':'o','ó':'o','ǒ':'o','ò':'o',
  'ū':'u','ú':'u','ǔ':'u','ù':'u',
  'ǖ':'u','ǘ':'u','ǚ':'u','ǜ':'u','ü':'u',
};

/**
 * Strip tone marks from a single pinyin syllable and lowercase it.
 * "Ài" → "ai", "lüè" → "lue", "zhōng" → "zhong"
 */
export function syllableBase(syllable) {
  if (!syllable) return '';
  let out = '';
  for (const ch of String(syllable)) {
    out += TONE_MARK_MAP[ch] ?? TONE_MARK_MAP[ch.toLowerCase?.()] ?? ch;
  }
  return out.toLowerCase().replace(/[^a-z]/g, '');
}

/** Tone number from a single toned syllable. Returns 5 (neutral) if untoned. */
export function syllableTone(syllable) {
  for (const ch of String(syllable || '')) {
    if ('āēīōūǖ'.includes(ch)) return 1;
    if ('áéíóúǘ'.includes(ch)) return 2;
    if ('ǎěǐǒǔǚ'.includes(ch)) return 3;
    if ('àèìòùǜ'.includes(ch)) return 4;
  }
  return 5;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Walk entries.json and group character pages by toneless base syllable.
 * Returns Map<baseSyllable, { entries: [...], compounds: [...] }>.
 *
 * - entries: character pages whose pinyin starts with this syllable.
 * - compounds: vocab/chengyu/grammar pages whose pinyin contains this
 *   syllable as one of its tokens. Capped at 24 per syllable in render.
 */
export function buildPinyinIndex(entries) {
  const index = new Map();

  for (const e of entries) {
    if (e.status !== 'complete') continue;
    if (!e.pinyin) continue;

    if (e.type === 'character') {
      const base = syllableBase(e.pinyin);
      if (!base) continue;
      if (!index.has(base)) index.set(base, { entries: [], compounds: [] });
      index.get(base).entries.push(e);
    } else if (e.type === 'vocab' || e.type === 'grammar' || e.category === 'chengyu') {
      // Tokenize multi-syllable pinyin (handles "zìrán" with no separator,
      // "lǎo shī" with whitespace, "Zhōng-guó" with hyphen). pinyin.mjs
      // already does this; numeric syllables look like "zi4" so strip the
      // trailing tone digit to get the toneless base.
      const seen = new Set();
      for (const numSyl of pinyinToNumericSyllables(e.pinyin)) {
        const base = numSyl.replace(/[1-5]$/, '');
        if (!base || seen.has(base)) continue;
        seen.add(base);
        if (!index.has(base)) index.set(base, { entries: [], compounds: [] });
        index.get(base).compounds.push(e);
      }
    }
  }

  // Sort character entries within each syllable: by tone, then by hsk (lower first), then by pinyin
  for (const [, group] of index) {
    group.entries.sort((a, b) => {
      const ta = a.tone ?? syllableTone(a.pinyin);
      const tb = b.tone ?? syllableTone(b.pinyin);
      if (ta !== tb) return ta - tb;
      const ha = typeof a.hsk === 'number' ? a.hsk : 99;
      const hb = typeof b.hsk === 'number' ? b.hsk : 99;
      if (ha !== hb) return ha - hb;
      return String(a.pinyin).localeCompare(String(b.pinyin));
    });
    // Compounds: by tone of matching syllable is hard — stable by pinyin/title
    group.compounds.sort((a, b) =>
      String(a.pinyin || '').localeCompare(String(b.pinyin || '')) ||
      String(a.title || '').localeCompare(String(b.title || ''))
    );
  }

  return index;
}

const TONE_LABEL = {
  1: { mark: '◌̄', name: 'first tone',  pinyin: 'high level' },
  2: { mark: '◌́', name: 'second tone', pinyin: 'rising' },
  3: { mark: '◌̌', name: 'third tone',  pinyin: 'low / dipping' },
  4: { mark: '◌̀', name: 'fourth tone', pinyin: 'falling' },
  5: { mark: '·',  name: 'neutral tone', pinyin: 'unstressed' },
};

function renderToneGroup(tone, items, syllableBaseStr) {
  const label = TONE_LABEL[tone] || TONE_LABEL[5];
  const cards = items.map(e => {
    const englishGloss = (() => {
      if (e.title && e.title.includes('·')) {
        const after = e.title.split('·').slice(1).join('·').trim();
        return after.split('—')[0].trim();
      }
      return '';
    })();
    const hskChip = (typeof e.hsk === 'number') ? `<span class="card-tag tag-n">HSK ${e.hsk}</span>` : '';
    const path = `../${e.path.replace(/^pages\//, '')}`;
    return `
        <a class="card c-teal" href="${path}">
          <div class="card-head">
            <span class="card-title" lang="zh">${escapeHtml(e.char)}</span>
            <span class="card-pinyin">${escapeHtml(e.pinyin)}</span>
            ${hskChip}
          </div>
          ${englishGloss ? `<div class="card-body">${escapeHtml(englishGloss)}</div>` : ''}
        </a>`;
  }).join('');

  return `
    <span class="section-anchor" id="tone-${tone}"></span>
    <div class="section-head">
      <span class="sh-cn">${label.mark} ${escapeHtml(label.name)}</span>
      <span class="sh-py">${escapeHtml(syllableBaseStr)}${tone <= 4 ? tone : ''}</span>
      <span class="sh-en">${escapeHtml(label.pinyin)}</span>
    </div>
    <div class="cards">${cards}
    </div>
`;
}

function renderCompoundList(compounds, syllableBaseStr) {
  if (!compounds.length) return '';
  const capped = compounds.slice(0, 24);
  const more = compounds.length > 24 ? `<p class="meta">…and ${compounds.length - 24} more on individual entry pages.</p>` : '';
  const items = capped.map(e => {
    const path = `../${e.path.replace(/^pages\//, '')}`;
    const cn = e.title?.split('·')[0]?.trim() || e.char || '';
    const en = (e.title && e.title.includes('·'))
      ? e.title.split('·').slice(1).join('·').trim().split('—')[0].trim()
      : '';
    return `      <li><a href="${path}"><span class="ref-cn" lang="zh">${escapeHtml(cn)}</span> <span class="ref-py">${escapeHtml(e.pinyin || '')}</span>${en ? `<span class="ref-en"> · ${escapeHtml(en)}</span>` : ''}</a></li>`;
  }).join('\n');

  return `
    <span class="section-anchor" id="compounds"></span>
    <div class="section-head">
      <span class="sh-cn">复合词</span>
      <span class="sh-py">fùhécí</span>
      <span class="sh-en">Words and phrases containing ${escapeHtml(syllableBaseStr)}</span>
    </div>
    <div class="scholar">
      <ul class="ref-list">
${items}
      </ul>
      ${more}
    </div>
`;
}

function renderBody(syllable, group, allSyllables) {
  const characters = group.entries;
  const compounds = group.compounds;

  // Group characters by tone
  const byTone = new Map();
  for (const e of characters) {
    const t = e.tone ?? syllableTone(e.pinyin);
    if (!byTone.has(t)) byTone.set(t, []);
    byTone.get(t).push(e);
  }
  const toneSections = [...byTone.keys()]
    .sort((a, b) => a - b)
    .map(t => renderToneGroup(t, byTone.get(t), syllable))
    .join('\n');

  // Sidebar: tone anchors + sibling pinyin pages (alpha-near)
  const tocItems = [...byTone.keys()].sort((a, b) => a - b).map(t => {
    const label = TONE_LABEL[t] || TONE_LABEL[5];
    return `      <li><a href="#tone-${t}"><span class="toc-cn">${label.mark}</span> ${escapeHtml(label.name)}</a></li>`;
  }).join('\n');

  // Find a small slice of nearby syllables alphabetically for browse-sideways
  const sortedSyl = [...allSyllables].sort();
  const idx = sortedSyl.indexOf(syllable);
  const window = sortedSyl.slice(Math.max(0, idx - 4), idx).concat(sortedSyl.slice(idx + 1, idx + 5));
  const nearbyHtml = window.map(s => `<a href="${s}.html" class="adj"><span class="a-cn" lang="zh">${escapeHtml(s)}</span></a>`).join('');

  const compoundsToc = compounds.length
    ? `      <li><a href="#compounds"><span class="toc-cn">词</span> Compounds</a></li>`
    : '';

  return `<div class="shell">

  <aside class="sidebar" id="sidebar">
    <span class="toc-topic">${escapeHtml(syllable)}</span>
    <span class="toc-topic-en">pinyin index</span>
    <div class="toc-divider"></div>
    <span class="toc-label">Readings</span>
    <ul class="toc-list">
${tocItems}
${compoundsToc}
    </ul>
    <div class="toc-divider"></div>
    <span class="toc-label">Browse pinyin</span>
    <ul class="toc-list">
      <li><a href="index.html"><span class="toc-cn">拼音</span> All syllables</a></li>
    </ul>
  </aside>

  <main class="main" id="main-content">

    <header class="topic-hero">
      <span class="topic-hero-eyebrow">Pinyin · 拼音 pīnyīn</span>
      <h1 class="topic-hero-title" lang="en">${escapeHtml(syllable)}</h1>
      <span class="topic-hero-title-py">${characters.length} reading${characters.length === 1 ? '' : 's'}</span>
      <p class="topic-hero-desc">Every character on Jiǎoluò Shūwū whose pinyin reading is <em>${escapeHtml(syllable)}</em> in any tone, plus compounds and phrases containing this syllable. Pinyin without tone marks is ambiguous — pick the tone you mean.</p>
    </header>

    ${toneSections}

    ${renderCompoundList(compounds, syllable)}

    ${nearbyHtml ? `
    <span class="section-anchor" id="nearby"></span>
    <div class="section-head">
      <span class="sh-cn">附近</span>
      <span class="sh-py">fùjìn</span>
      <span class="sh-en">Nearby pinyin syllables</span>
    </div>
    <div class="adj-wrap">${nearbyHtml}</div>
    ` : ''}

    <footer class="page-footer">
      <span class="footer-id">Jiǎoluò Shūwū · 角落書屋 · <span>pinyin / ${escapeHtml(syllable)}</span></span>
      <a href="../../index.html" class="footer-back">← All Entries</a>
    </footer>

  </main>

</div>
`;
}

function renderJsonLd(syllable, group) {
  const url = `${SITE_URL}/pages/pinyin/${syllable}.html`;
  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${syllable} — pinyin reading index`,
    description: `Every Chinese character read as ${syllable} in any tone, with compounds and phrases.`,
    url,
    inLanguage: 'en',
    isPartOf: { '@type': 'WebSite', name: 'Jiǎoluò Shūwū · 角落書屋', url: SITE_URL + '/' },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: group.entries.map((e, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_URL}/${e.path}`,
        name: `${e.char} ${e.pinyin}`,
      })),
    },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Jiǎoluò Shūwū', item: SITE_URL + '/' },
      { '@type': 'ListItem', position: 2, name: 'Pinyin index', item: SITE_URL + '/pages/pinyin/index.html' },
      { '@type': 'ListItem', position: 3, name: syllable, item: url },
    ],
  };
  return [
    `<script type="application/ld+json">${JSON.stringify(collection)}</script>`,
    `<script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>`,
  ].join('\n');
}

function renderOgTags(syllable, group) {
  const url = `${SITE_URL}/pages/pinyin/${syllable}.html`;
  const title = `${syllable} — pinyin index`;
  const desc = `Every character read as ${syllable} in any tone (${group.entries.length} reading${group.entries.length === 1 ? '' : 's'}).`;
  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(desc)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:site_name" content="Jiǎoluò Shūwū · 角落書屋">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(desc)}">`,
  ].join('\n');
}

const FAVICON = "data:image/svg+xml,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20viewBox%3D'0%200%20100%20100'%3E%3Crect%20width%3D'100'%20height%3D'100'%20rx%3D'18'%20fill%3D'%23f2e8d5'%2F%3E%3Ctext%20x%3D'50'%20y%3D'50'%20text-anchor%3D'middle'%20dominant-baseline%3D'central'%20font-family%3D'Noto%20Serif%20SC%2C%20serif'%20font-size%3D'72'%20font-weight%3D'700'%20fill%3D'%238b1a1a'%3E%E6%8B%BC%3C%2Ftext%3E%3C%2Fsvg%3E";

function renderPage(syllable, group, allSyllables) {
  const meta = { type: 'topic', category: 'pinyin', syllable, status: 'complete' };
  const metaComment = JSON.stringify(meta);
  const title = `${syllable} — pinyin index`;
  const desc = `Every Chinese character on Jiǎoluò Shūwū read as ${syllable} in any tone, plus compounds. ${group.entries.length} character reading${group.entries.length === 1 ? '' : 's'}.`;
  const canonicalUrl = `${SITE_URL}/pages/pinyin/${syllable}.html`;

  return LAYOUT
    .replace('{{{metaComment}}}', metaComment)
    .replace('{{{pageTitle}}}', title)
    .replace('{{{metaDesc}}}', desc)
    .replace('{{{jsonLd}}}', renderJsonLd(syllable, group))
    .replace('{{{ogTags}}}', renderOgTags(syllable, group))
    .replace('{{{favicon}}}', FAVICON)
    .replace('{{{canonicalUrl}}}', canonicalUrl)
    .replace('{{{pageBody}}}', renderBody(syllable, group, allSyllables));
}

function renderIndexBody(index) {
  const all = [...index.keys()].sort();
  // Group by initial letter
  const byLetter = new Map();
  for (const s of all) {
    const init = s[0] || '?';
    if (!byLetter.has(init)) byLetter.set(init, []);
    byLetter.get(init).push(s);
  }

  const sections = [...byLetter.keys()].sort().map(letter => {
    const items = byLetter.get(letter).map(s => {
      const count = index.get(s).entries.length;
      return `      <li><a class="adj" href="${s}.html"><span class="a-cn" lang="zh">${escapeHtml(s)}</span><span class="a-en">${count}</span></a></li>`;
    }).join('\n');
    return `
    <span class="section-anchor" id="letter-${letter}"></span>
    <div class="section-head">
      <span class="sh-cn">${letter.toUpperCase()}</span>
      <span class="sh-py">— ${byLetter.get(letter).length} syllable${byLetter.get(letter).length === 1 ? '' : 's'}</span>
    </div>
    <ul class="adj-wrap pinyin-letter-list">
${items}
    </ul>
`;
  }).join('\n');

  const letterToc = [...byLetter.keys()].sort()
    .map(l => `      <li><a href="#letter-${l}"><span class="toc-cn">${l.toUpperCase()}</span></a></li>`).join('\n');

  return `<div class="shell">

  <aside class="sidebar" id="sidebar">
    <span class="toc-topic">拼音</span>
    <span class="toc-topic-en">Pinyin index</span>
    <div class="toc-divider"></div>
    <span class="toc-label">By letter</span>
    <ul class="toc-list">
${letterToc}
    </ul>
  </aside>

  <main class="main" id="main-content">

    <header class="topic-hero">
      <span class="topic-hero-eyebrow">Pinyin · 拼音 pīnyīn</span>
      <h1 class="topic-hero-title">Pinyin index</h1>
      <span class="topic-hero-title-py">${all.length} syllables</span>
      <p class="topic-hero-desc">Every distinct pinyin reading on Jiǎoluò Shūwū. Click a syllable to see all characters that share it across the four tones — useful when you have the sound but not the character.</p>
    </header>

${sections}

    <footer class="page-footer">
      <span class="footer-id">Jiǎoluò Shūwū · 角落書屋 · <span>pinyin index</span></span>
      <a href="../../index.html" class="footer-back">← All Entries</a>
    </footer>

  </main>

</div>
`;
}

function renderIndexPage(index) {
  const all = [...index.keys()].sort();
  const meta = { type: 'topic', category: 'pinyin', status: 'complete' };
  const metaComment = JSON.stringify(meta);
  const title = `Pinyin index — ${all.length} syllables`;
  const desc = `Browse Chinese characters by pinyin reading. ${all.length} distinct syllables, every reading on Jiǎoluò Shūwū.`;
  const canonicalUrl = `${SITE_URL}/pages/pinyin/index.html`;

  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description: desc,
    url: canonicalUrl,
    inLanguage: 'en',
    isPartOf: { '@type': 'WebSite', name: 'Jiǎoluò Shūwū · 角落書屋', url: SITE_URL + '/' },
  })}</script>`;

  const ogTags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(desc)}">`,
    `<meta property="og:url" content="${canonicalUrl}">`,
    `<meta property="og:site_name" content="Jiǎoluò Shūwū · 角落書屋">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta name="twitter:card" content="summary">`,
  ].join('\n');

  return LAYOUT
    .replace('{{{metaComment}}}', metaComment)
    .replace('{{{pageTitle}}}', title)
    .replace('{{{metaDesc}}}', desc)
    .replace('{{{jsonLd}}}', jsonLd)
    .replace('{{{ogTags}}}', ogTags)
    .replace('{{{favicon}}}', FAVICON)
    .replace('{{{canonicalUrl}}}', canonicalUrl)
    .replace('{{{pageBody}}}', renderIndexBody(index));
}

/**
 * Generate all pinyin pages: pages/pinyin/<syllable>.html + pages/pinyin/index.html.
 * Returns an array of generated paths (relative to ROOT) for sitemap inclusion.
 */
export function emitPinyinPages(entries, pagesDir) {
  const index = buildPinyinIndex(entries);
  const pinyinDir = join(pagesDir, 'pinyin');
  mkdirSync(pinyinDir, { recursive: true });

  // Only emit syllables with at least one character entry — compounds-only
  // syllables would have no readings to display, and linking to them from
  // sibling lists would break.
  const emittedSyllables = [...index.keys()].filter(s => index.get(s).entries.length > 0);
  const generated = [];

  for (const syllable of emittedSyllables) {
    const group = index.get(syllable);
    const html = renderPage(syllable, group, emittedSyllables);
    writeFileSync(join(pinyinDir, `${syllable}.html`), html, 'utf8');
    generated.push(`pages/pinyin/${syllable}.html`);
  }

  // Index page lists only emitted syllables, for the same reason
  const emittedIndex = new Map();
  for (const s of emittedSyllables) emittedIndex.set(s, index.get(s));
  writeFileSync(join(pinyinDir, 'index.html'), renderIndexPage(emittedIndex), 'utf8');
  generated.push('pages/pinyin/index.html');

  return { generated, index };
}
