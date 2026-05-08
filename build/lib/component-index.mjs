/**
 * component-index.mjs — reverse index of "which pages mention this hanzi".
 *
 * Walks every content/**.md body (after frontmatter) and records the set of
 * distinct CJK characters that appear. Inverts that to produce:
 *
 *   Map<hanzi, Array<{ path, type, category, title, pinyin, char, hsk, desc }>>
 *
 * Intended use: on a character page for 心, surface every vocab/grammar/topic/
 * chengyu/character page where 心 also appears. Doubles the internal-link
 * graph density without new content. Self-references are excluded.
 *
 * Volume > precision — we don't try to disambiguate "appears as semantic
 * component" vs "appears coincidentally in body prose." A reader on 心 should
 * see 心情, 关心, 心安理得, etc., regardless of whether 心 is the
 * structural radical or just shows up.
 */

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const CJK_RE = /[一-鿿]/g;

function walkMd(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('_')) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walkMd(full));
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * Strip HTML tags / attribute bodies from a content string before extracting
 * hanzi. Without this, attribute values like `<a href="...感.html">` would
 * inflate the count by counting the filename hanzi as a body mention.
 */
function stripHtmlForCount(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/**
 * Build the reverse component index.
 *
 * @param {string} contentRoot absolute path to /content
 * @param {Array}  entries     data/entries.json contents
 * @returns {Map<string, Array<entry>>}
 */
export function buildComponentIndex(contentRoot, entries) {
  // pagePath → entry meta lookup
  const entryByPath = new Map();
  for (const e of entries) {
    if (e.status !== 'complete') continue;
    entryByPath.set(e.path, e);
  }

  // hanzi → set of pagePaths
  const hanziToPaths = new Map();

  for (const fp of walkMd(contentRoot)) {
    const src = fs.readFileSync(fp, 'utf8');
    const { data: fm, content } = matter(src);
    if (fm.status !== 'complete') continue;

    const rel = path.relative(contentRoot, fp).replace(/\\/g, '/');
    const pagePath = `pages/${rel.replace(/\.md$/, '.html')}`;
    if (!entryByPath.has(pagePath)) continue;

    const text = stripHtmlForCount(content);
    const seen = new Set();
    let m;
    CJK_RE.lastIndex = 0;
    while ((m = CJK_RE.exec(text)) !== null) {
      const ch = m[0];
      if (seen.has(ch)) continue;
      seen.add(ch);
      if (!hanziToPaths.has(ch)) hanziToPaths.set(ch, new Set());
      hanziToPaths.get(ch).add(pagePath);
    }

    // Also count title CN phrase characters — short titles that don't repeat
    // in body would otherwise be missed (e.g. a vocab page titled
    // "心情 · mood" might not repeat 心 in the prose).
    if (fm.title) {
      const titleCn = String(fm.title).split('·')[0].trim();
      for (const ch of titleCn) {
        if (!CJK_RE.test(ch)) { CJK_RE.lastIndex = 0; continue; }
        CJK_RE.lastIndex = 0;
        if (!hanziToPaths.has(ch)) hanziToPaths.set(ch, new Set());
        hanziToPaths.get(ch).add(pagePath);
      }
    }
    if (fm.char) {
      // The page's own primary character — every char page lists itself,
      // we'll exclude self-references at lookup time.
      if (!hanziToPaths.has(fm.char)) hanziToPaths.set(fm.char, new Set());
      hanziToPaths.get(fm.char).add(pagePath);
    }
  }

  // Materialize: hanzi → sorted array of full entry objects
  const result = new Map();
  for (const [hz, set] of hanziToPaths) {
    const list = [];
    for (const p of set) {
      const e = entryByPath.get(p);
      if (e) list.push(e);
    }
    // Sort by category then by title — predictable, deterministic order.
    list.sort((a, b) => {
      const ca = String(a.category || '');
      const cb = String(b.category || '');
      if (ca !== cb) return ca.localeCompare(cb);
      const ta = String(a.title || a.char || '');
      const tb = String(b.title || b.char || '');
      return ta.localeCompare(tb);
    });
    result.set(hz, list);
  }
  return result;
}

/**
 * Render the "Appears in" section HTML for a character page. Returns ''
 * when there are no matches (so the build can skip TOC injection too).
 *
 * @param {string} hanzi   the page's primary char
 * @param {Array}  matches entries that contain this hanzi (excluding self)
 * @param {string} fromPath this page's own path (so links resolve correctly)
 * @returns {string} HTML
 */
export function renderAppearsInHtml(hanzi, matches, fromPath) {
  if (!matches || !matches.length) return '';

  // Group by category for visual scanning. Order matters: the most
  // structurally illuminating categories first.
  const ORDER = ['vocab', 'chengyu', 'grammar', 'characters', 'philosophy', 'religion', 'history', 'geography', 'culture', 'culinary', 'arts', 'science', 'daily', 'hubs'];
  const CAT_LABEL = {
    vocab:      { cn: '词',    en: 'Vocabulary' },
    chengyu:    { cn: '成语',  en: 'Chengyu' },
    grammar:    { cn: '语法',  en: 'Grammar' },
    characters: { cn: '字',    en: 'Other characters' },
    philosophy: { cn: '哲学',  en: 'Philosophy' },
    religion:   { cn: '宗教',  en: 'Religion' },
    history:    { cn: '历史',  en: 'History' },
    geography:  { cn: '地理',  en: 'Geography' },
    culture:    { cn: '文化',  en: 'Culture' },
    culinary:   { cn: '饮食',  en: 'Culinary' },
    arts:       { cn: '艺文',  en: 'Arts & Literature' },
    science:    { cn: '科学',  en: 'Science' },
    daily:      { cn: '日常',  en: 'Daily life' },
    hubs:       { cn: '阅读',  en: 'Reading paths' },
  };

  // Bucket
  const byCat = new Map();
  for (const e of matches) {
    const k = e.category || 'other';
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(e);
  }

  // Order categories per ORDER, then any unknown cats alphabetically
  const cats = [...byCat.keys()];
  cats.sort((a, b) => {
    const ia = ORDER.indexOf(a); const ib = ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });

  // Cap total at 24 with overflow note. Distribute the cap proportionally
  // by largest-bucket-first so a 200-entry vocab pile doesn't crowd out a
  // single chengyu with this character in it.
  const TOTAL_CAP = 24;
  let remaining = TOTAL_CAP;
  const totalMatches = matches.length;
  const renderedByCat = new Map();
  for (const cat of cats) {
    const bucket = byCat.get(cat);
    if (remaining <= 0) break;
    // Each category gets at least its proportional share, clamped to bucket size and remaining.
    const proportional = Math.max(1, Math.round(TOTAL_CAP * bucket.length / totalMatches));
    const take = Math.min(bucket.length, proportional, remaining);
    renderedByCat.set(cat, bucket.slice(0, take));
    remaining -= take;
  }
  // Fill any leftover slots from categories that still have items
  if (remaining > 0) {
    for (const cat of cats) {
      if (remaining <= 0) break;
      const bucket = byCat.get(cat);
      const already = renderedByCat.get(cat) || [];
      const more = bucket.slice(already.length, already.length + remaining);
      if (more.length) {
        renderedByCat.set(cat, already.concat(more));
        remaining -= more.length;
      }
    }
  }

  function relTo(targetPath) {
    // fromPath is e.g. 'pages/characters/xin1_心.html'; target is 'pages/vocab/xinqing_心情.html'.
    // Both share the 'pages/' prefix → relative is '../<rest of target>'.
    return '../' + targetPath.replace(/^pages\//, '');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function entryLine(e) {
    const cn = e.char || (e.title ? e.title.split('·')[0].trim() : '');
    const en = (e.title && e.title.includes('·'))
      ? e.title.split('·').slice(1).join('·').trim().split('—')[0].trim()
      : '';
    const py = e.pinyin || '';
    return `<li><a class="appears-in-item" href="${escapeHtml(relTo(e.path))}" data-category="${escapeHtml(e.category || '')}">` +
             `<span class="appears-cn" lang="zh">${escapeHtml(cn)}</span>` +
             (py ? `<span class="appears-py">${escapeHtml(py)}</span>` : '') +
             (en ? `<span class="appears-en">${escapeHtml(en)}</span>` : '') +
           `</a></li>`;
  }

  const groupHtml = cats.map(cat => {
    const items = renderedByCat.get(cat);
    if (!items || !items.length) return '';
    const total = byCat.get(cat).length;
    const overflow = total > items.length ? ` <span class="appears-overflow">+${total - items.length} more</span>` : '';
    const label = CAT_LABEL[cat] || { cn: cat, en: cat };
    return `      <div class="appears-group" data-category="${escapeHtml(cat)}">
        <div class="appears-group-head"><span class="appears-cn-label" lang="zh">${escapeHtml(label.cn)}</span><span class="appears-en-label">${escapeHtml(label.en)}</span><span class="appears-count">${total}${overflow}</span></div>
        <ul class="appears-list">
${items.map(entryLine).map(s => '          ' + s).join('\n')}
        </ul>
      </div>`;
  }).filter(Boolean).join('\n');

  const totalShown = [...renderedByCat.values()].reduce((n, a) => n + a.length, 0);
  const overflowCount = matches.length - totalShown;
  const overflowNote = overflowCount > 0
    ? `<p class="appears-foot">…and ${overflowCount} more page${overflowCount === 1 ? '' : 's'} containing <span lang="zh">${escapeHtml(hanzi)}</span>.</p>`
    : '';

  return `
    <span class="section-anchor" id="appears-in"></span>
    <div class="section-head">
      <span class="sh-cn">出现于</span>
      <span class="sh-py">chūxiànyú</span>
      <span class="sh-en">Appears in — pages containing <span lang="zh">${escapeHtml(hanzi)}</span></span>
    </div>
    <div class="appears-in">
${groupHtml}
      ${overflowNote}
    </div>
`;
}
