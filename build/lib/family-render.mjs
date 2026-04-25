/**
 * family-render.mjs — Build-time rendering for family-index pages.
 *
 * A "family" is a top-level grouping of categories shown on a dedicated
 * index page (pages/families/<family>.html). Three families today plus a
 * master "explore" page:
 *
 *   language     → characters, vocab, grammar
 *   topics       → philosophy, religion, history, geography, culture,
 *                  daily, culinary, arts, science
 *   collections  → chengyu, hubs
 *   explore      → master hub: shows the three family cards, then a
 *                  flat browseable list of every category at the bottom
 *
 * Adding a new category to a family: append its key to the family's
 * member array in FAMILY_MEMBERS below. Adding a new family: add an entry
 * to FAMILY_MEMBERS, FAMILY_META, and create content/families/<key>.md.
 *
 * Output is injected into family pages by build.mjs via marker replacement:
 *   <!--FAMILY_HERO_ART-->   → renderFamilyHeroArt(family)
 *   <!--FAMILY_CONTENT-->    → renderFamilyContent(family, entries)
 *   <!--FAMILY_CROSSLINKS--> → renderFamilyCrosslinks(family)
 */

import { renderFamilyHeroArt } from './family-art.mjs';

// ── family configuration ────────────────────────────────────────────────────

export const FAMILY_MEMBERS = {
  language:    ['characters', 'vocab', 'grammar'],
  topics:      ['philosophy', 'religion', 'history', 'geography', 'culture', 'daily', 'culinary', 'arts', 'science'],
  collections: ['chengyu', 'hubs'],
  // explore renders the three family cards itself; no member categories here.
  explore:     [],
};

export const FAMILY_META = {
  explore:     { cn: '探',   py: 'tàn',     en: 'Explore',     desc: 'The master entry point — three families, every category.' },
  language:    { cn: '语言', py: 'yǔyán',   en: 'Language',    desc: 'Characters, vocabulary, grammar — the building blocks.' },
  topics:      { cn: '话题', py: 'huàtí',   en: 'Topics',      desc: 'Thought, place, time, lived life — what the language is used to say.' },
  collections: { cn: '集锦', py: 'jíjǐn',   en: 'Collections', desc: 'Idioms and curated reading paths — entries grouped to be read together.' },
};

// Per-category metadata (kept in sync with scripts/homepage.js CATEGORY_META).
// Single source of truth would be ideal; for now we duplicate so the build
// renderer doesn't need to parse JS. If you change one, change the other.
const CATEGORY_META = {
  characters: { cn: '字',   py: 'zì',       en: 'Characters',         desc: 'Single glyphs. Etymology, decomposition, daily use.' },
  vocab:      { cn: '词',   py: 'cí',       en: 'Vocabulary',         desc: 'Words and concepts that carry cultural weight.' },
  grammar:    { cn: '法',   py: 'fǎ',       en: 'Grammar',            desc: 'Particles, structures, and the joints of the language.' },
  religion:   { cn: '宗教', py: 'zōngjiào', en: 'Religion',           desc: 'Buddhism, Daoism, folk practice, ancestor rites.' },
  philosophy: { cn: '哲学', py: 'zhéxué',   en: 'Philosophy',         desc: 'The hundred schools and what they argued about.' },
  history:    { cn: '历史', py: 'lìshǐ',    en: 'History',            desc: 'Dynasties, ruptures, and the long arc.' },
  geography:  { cn: '地理', py: 'dìlǐ',     en: 'Geography',          desc: 'Places, dialects, and the shape of the land.' },
  culture:    { cn: '文化', py: 'wénhuà',   en: 'Culture',            desc: 'What people make and how they live with it.' },
  culinary:   { cn: '饮食', py: 'yǐnshí',   en: 'Culinary',           desc: 'What is cooked, drunk, and shared at the table.' },
  arts:       { cn: '艺文', py: 'yìwén',    en: 'Arts & Literature',  desc: 'Poetry, painting, calligraphy, opera.' },
  science:    { cn: '科技', py: 'kējì',     en: 'Science & Medicine', desc: 'Astronomy, medicine, and technology before modernity.' },
  daily:      { cn: '日常', py: 'rìcháng',  en: 'Everyday Life',      desc: 'Names, numbers, gifts, gestures, taboos.' },
  chengyu:    { cn: '成语', py: 'chéngyǔ',  en: 'Chengyu',            desc: 'Four-character idioms. Compressed wisdom from classical texts.' },
  hubs:       { cn: '读径', py: 'dú jìng',  en: 'Reading Paths',      desc: 'Curated reading paths through thematic clusters.' },
};

// ── helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Path from a family page (pages/families/<key>.html) to a content page.
 * Family pages live one level deep inside pages/, so all entry paths
 * (already 'pages/<cat>/<slug>.html') resolve via '../<cat>/<slug>.html'.
 */
function familyHref(entryPath) {
  return entryPath.replace(/^pages\//, '../');
}

/** Pull the leading Chinese phrase from a title ("感 · to feel" → "感"). */
function leadCn(entry) {
  if (entry.char) return entry.char;
  if (entry.title) return entry.title.split('·')[0].trim();
  return '';
}

/** English part of "X · Y" → "Y". Falls back to title. */
function trailEn(entry) {
  if (!entry.title) return '';
  const parts = entry.title.split('·');
  if (parts.length < 2) return entry.title;
  return parts.slice(1).join('·').trim();
}

// ── card rendering ──────────────────────────────────────────────────────────

/**
 * Render one entry card. Mirrors the .entry-card markup that
 * scripts/homepage.js produces at runtime, so styling is shared.
 */
function renderEntryCard(entry) {
  const glyph = leadCn(entry);
  const len = glyph.length;
  const sizeClass = len >= 4 ? ' glyph-4' : len === 3 ? ' glyph-3' : len === 2 ? ' glyph-2' : '';
  const titleNoCn = trailEn(entry);
  const py = entry.pinyin || '';
  const desc = entry.desc || '';
  return `<a class="entry-card" href="${escapeHtml(familyHref(entry.path))}" data-category="${escapeHtml(entry.category || '')}">` +
           (glyph ? `<span class="entry-glyph${sizeClass}">${escapeHtml(glyph)}</span>` : '') +
           `<span class="entry-pinyin">${escapeHtml(py)}</span>` +
           `<span class="entry-title">${escapeHtml(titleNoCn)}</span>` +
           `<span class="entry-desc">${escapeHtml(desc)}</span>` +
         `</a>`;
}

/**
 * Render one category section: head + entry grid. Static HTML — no
 * collapse JS, since on family pages every category is expanded by default
 * (the page's purpose is browsing).
 */
function renderCategorySection(catKey, entries) {
  const meta = CATEGORY_META[catKey];
  if (!meta) return '';
  const cards = entries.map(renderEntryCard).join('\n        ');
  const count = entries.length;
  return `
    <section class="cat-group fam-cat-group" id="cat-${catKey}" data-category="${catKey}">
      <div class="cat-head fam-cat-head">
        <span class="sh-cn" style="color: var(--cat-${catKey})">${escapeHtml(meta.cn)}</span>
        <span class="sh-py">${escapeHtml(meta.py)}</span>
        <span class="sh-en">${escapeHtml(meta.en)}</span>
        <span class="sh-rule"></span>
        <span class="cat-count">${count} ${count === 1 ? 'entry' : 'entries'}</span>
      </div>
      <p class="fam-cat-desc">${escapeHtml(meta.desc)}</p>
      <div class="entry-grid">
        ${cards}
      </div>
    </section>`;
}

// ── family content (the entry-grids tier) ──────────────────────────────────

/**
 * Render the per-family entry-grid block. For non-explore families this is
 * the full set of category sections. For explore it's the three family
 * cards followed by a flat link list of every category.
 */
export function renderFamilyContent(family, entries) {
  if (family === 'explore') return renderExploreContent(entries);

  const memberKeys = FAMILY_MEMBERS[family];
  if (!memberKeys || memberKeys.length === 0) return '';

  // Group complete entries by category (stable order matches CAT_ORDER intent
  // because we iterate memberKeys in declaration order).
  const byCategory = new Map();
  for (const e of entries) {
    if (e.status !== 'complete') continue;
    if (!byCategory.has(e.category)) byCategory.set(e.category, []);
    byCategory.get(e.category).push(e);
  }
  // Sort each category's entries by title (locale-aware).
  for (const list of byCategory.values()) {
    list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'en'));
  }

  const sections = memberKeys
    .map(k => renderCategorySection(k, byCategory.get(k) || []))
    .join('\n');

  // A small intro strip above the categories, summarising the family.
  const meta = FAMILY_META[family];
  const totalEntries = memberKeys.reduce((n, k) => n + (byCategory.get(k)?.length || 0), 0);
  const intro = `
    <div class="fam-intro">
      <span class="fam-intro-stat">${totalEntries} entries · ${memberKeys.length} categor${memberKeys.length === 1 ? 'y' : 'ies'}</span>
      <p class="fam-intro-text">${escapeHtml(meta.desc)}</p>
    </div>`;

  return intro + sections;
}

/**
 * Explore page: three big family cards + a reference-style "all categories"
 * link list. Designed to be the master entry point and a good landing for
 * /#browse redirects.
 */
function renderExploreContent(entries) {
  // Family cards (large, image-driven; mirrors .families-card on homepage).
  const families = ['language', 'topics', 'collections'];
  const totalsByCategory = new Map();
  for (const e of entries) {
    if (e.status !== 'complete') continue;
    totalsByCategory.set(e.category, (totalsByCategory.get(e.category) || 0) + 1);
  }

  const familyCards = families.map(f => {
    const meta = FAMILY_META[f];
    const memberKeys = FAMILY_MEMBERS[f];
    const total = memberKeys.reduce((n, k) => n + (totalsByCategory.get(k) || 0), 0);
    const memberLabels = memberKeys.map(k => CATEGORY_META[k]?.en).filter(Boolean).join(' · ');
    return `<a class="family-card" href="${f}.html" data-family="${f}">
        <div class="family-card-art" aria-hidden="true">${familyCardArt(f)}</div>
        <div class="family-card-meta">
          <span class="family-card-eyebrow">${escapeHtml(meta.cn)} ${escapeHtml(meta.py)}</span>
          <h3 class="family-card-title">${escapeHtml(meta.en)}</h3>
          <p class="family-card-desc">${escapeHtml(meta.desc)}</p>
          <span class="family-card-stat">${total} entries · ${memberKeys.length} categories</span>
          <span class="family-card-members">${escapeHtml(memberLabels)}</span>
        </div>
      </a>`;
  }).join('\n      ');

  // Flat all-categories list (reference-style: glyph + name + count).
  const allCats = Object.keys(CATEGORY_META).filter(k => totalsByCategory.has(k));
  const catLinks = allCats.map(k => {
    const m = CATEGORY_META[k];
    const family = Object.entries(FAMILY_MEMBERS).find(([, ks]) => ks.includes(k))?.[0];
    const familyHref = family ? `${family}.html#cat-${k}` : `${k}.html`;
    const count = totalsByCategory.get(k) || 0;
    return `<a class="all-cat-link" href="${familyHref}" data-category="${k}">
          <span class="acl-cn" style="color: var(--cat-${k})">${escapeHtml(m.cn)}</span>
          <span class="acl-en">${escapeHtml(m.en)}</span>
          <span class="acl-count">${count}</span>
        </a>`;
  }).join('\n        ');

  return `
    <div class="families-grid">
      ${familyCards}
    </div>

    <span class="section-anchor" id="all-categories"></span>
    <div class="section-head">
      <span class="sh-cn">分类</span>
      <span class="sh-py">fēnlèi</span>
      <span class="sh-en">All categories</span>
      <span class="sh-rule"></span>
    </div>

    <div class="all-cats-grid">
        ${catLinks}
    </div>`;
}

// ── crosslinks (bottom-of-page navigation between families) ────────────────

/**
 * The "Continue exploring" strip at the bottom of each non-explore family
 * page. Surfaces the other two families + a master Explore card.
 */
export function renderFamilyCrosslinks(family) {
  if (family === 'explore') return '';
  const others = ['language', 'topics', 'collections'].filter(f => f !== family);
  const cards = others.map(f => {
    const meta = FAMILY_META[f];
    const memberLabels = FAMILY_MEMBERS[f].map(k => CATEGORY_META[k]?.en).filter(Boolean).join(' · ');
    return `<a class="family-card family-card-sm" href="${f}.html" data-family="${f}">
        <div class="family-card-art" aria-hidden="true">${familyCardArt(f)}</div>
        <div class="family-card-meta">
          <span class="family-card-eyebrow">${escapeHtml(meta.cn)} ${escapeHtml(meta.py)}</span>
          <h3 class="family-card-title">${escapeHtml(meta.en)}</h3>
          <span class="family-card-members">${escapeHtml(memberLabels)}</span>
        </div>
      </a>`;
  }).join('\n      ');

  // Plus the master Explore card
  const exploreMeta = FAMILY_META.explore;
  const exploreCard = `<a class="family-card family-card-sm family-card-explore" href="explore.html" data-family="explore">
        <div class="family-card-art" aria-hidden="true">${familyCardArt('explore')}</div>
        <div class="family-card-meta">
          <span class="family-card-eyebrow">${escapeHtml(exploreMeta.cn)} ${escapeHtml(exploreMeta.py)}</span>
          <h3 class="family-card-title">${escapeHtml(exploreMeta.en)}</h3>
          <span class="family-card-members">All families · all categories</span>
        </div>
      </a>`;

  return `
    <span class="section-anchor" id="continue"></span>
    <div class="section-head">
      <span class="sh-cn">继续</span>
      <span class="sh-py">jìxù</span>
      <span class="sh-en">Continue exploring</span>
      <span class="sh-rule"></span>
    </div>
    <div class="family-crosslinks">
      ${cards}
      ${exploreCard}
    </div>`;
}

// ── re-exports & art accessors ─────────────────────────────────────────────

export { renderFamilyHeroArt };

/**
 * SVG art for a family-card (smaller variant used on Explore + crosslinks
 * + homepage 3-card hub). Keep these compact — full hero art lives in
 * family-art.mjs and is used inline in the family page hero.
 */
import { familyCardArt } from './family-art.mjs';
export { familyCardArt };
