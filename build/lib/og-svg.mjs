import { BRAND } from './brand.mjs';

/**
 * Per-entry 1200×630 OG SVG card.
 *
 * Layout (top → bottom):
 *   - 8px color band (category color)
 *   - eyebrow row (top-left: "Character · 字 zì", top-right: brand wordmark)
 *   - hero glyph (centred, dominant; watermark glyph faintly behind)
 *   - pinyin row
 *   - English gloss / title
 *   - footer wordmark (bottom-right)
 *
 * Background is the site's parchment tone with a faint watermark.
 *
 * Exports `renderOgSvg(entry)` and the category metadata.
 */

export const CATEGORY_META = {
  characters: { glyph: '字', label: 'Character',  pinyin: 'zì'        , color: '#8b1a1a' },
  vocab:      { glyph: '词', label: 'Vocabulary', pinyin: 'cí'        , color: '#a06428' },
  grammar:    { glyph: '法', label: 'Grammar'   , pinyin: 'yǔfǎ'      , color: '#1a5050' },
  chengyu:    { glyph: '语', label: 'Chengyu'   , pinyin: 'chéngyǔ'   , color: '#6b1a2a' },
  religion:   { glyph: '宗', label: 'Religion'  , pinyin: 'zōngjiào'  , color: '#5c3d7a' },
  philosophy: { glyph: '哲', label: 'Philosophy', pinyin: 'zhéxué'    , color: '#3a5c3a' },
  history:    { glyph: '史', label: 'History'   , pinyin: 'lìshǐ'     , color: '#6b4420' },
  geography:  { glyph: '地', label: 'Geography' , pinyin: 'dìlǐ'      , color: '#2a5c6b' },
  culture:    { glyph: '文', label: 'Culture'   , pinyin: 'wénhuà'    , color: '#8b3a1a' },
  culinary:   { glyph: '食', label: 'Culinary'  , pinyin: 'měishí'    , color: '#7a4a10' },
  arts:       { glyph: '艺', label: 'Arts'      , pinyin: 'yìshù'     , color: '#4a2878' },
  science:    { glyph: '科', label: 'Science'   , pinyin: 'kēxué'     , color: '#1a4a5c' },
  daily:      { glyph: '日', label: 'Daily'     , pinyin: 'rìcháng'   , color: '#5c4a1a' },
  families:   { glyph: '集', label: 'Family'    , pinyin: 'jí'        , color: '#5a5a5a' }
};

const PAPER = '#f2e8d5';
const INK = '#2e2010';
const MUTED = '#6b5535';

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function deriveGlyph(entry, cat) {
  if (entry.char) return entry.char;
  if (entry.title) {
    const cn = entry.title.split('·')[0].trim();
    if (cn) return cn;
  }
  return cat.glyph;
}

function deriveGloss(entry) {
  if (entry.title && entry.title.includes('·')) {
    const after = entry.title.split('·').slice(1).join('·').trim();
    const cut = after.split('—')[0].trim();
    if (cut && cut.length <= 60) return cut;
    if (after.length <= 60) return after;
  }
  if (entry.desc) {
    const firstClause = entry.desc.split(/[.;]/)[0].trim();
    if (firstClause && firstClause.length <= 60) return firstClause;
  }
  return '';
}

function glyphSizeFor(glyph) {
  const len = [...glyph].length;
  if (len === 1) return 320;
  if (len === 2) return 230;
  if (len === 3) return 180;
  if (len === 4) return 150;
  return Math.max(100, 150 - (len - 4) * 14);
}

/**
 * Render a 1200×630 OG SVG card for a built entry.
 * Pure function — given the same entry, returns the same SVG bytes.
 */
export function renderOgSvg(entry) {
  const cat = CATEGORY_META[entry.category] || CATEGORY_META.characters;
  const glyph = deriveGlyph(entry, cat);
  const pinyin = entry.pinyin || '';
  const gloss = deriveGloss(entry);
  const glyphSize = glyphSizeFor(glyph);

  // Watermark glyph: category glyph behind the hero ink, very low opacity.
  const wm = cat.glyph;

  // Vertical rhythm.
  const glyphY = 320;
  const pinyinY = 480;
  const glossY = 540;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <radialGradient id="vignette" cx="50%" cy="0%" r="80%">
      <stop offset="0%" stop-color="${cat.color}" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="${PAPER}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${PAPER}"/>
  <rect width="1200" height="630" fill="url(#vignette)"/>
  <rect x="0" y="0" width="1200" height="8" fill="${cat.color}"/>
  <text x="1080" y="225" font-family="Noto Serif SC" font-size="540" font-weight="700"
        fill="${cat.color}" opacity="0.08" text-anchor="end" dominant-baseline="middle">${escXml(wm)}</text>
  <text x="60" y="68" font-family="Inconsolata" font-size="22" letter-spacing="4" fill="${MUTED}">${escXml(cat.label.toUpperCase())} · ${escXml(cat.glyph)} ${escXml(cat.pinyin)}</text>
  <text x="1140" y="68" font-family="Inconsolata" font-size="22" letter-spacing="4" fill="${MUTED}" text-anchor="end">JIǍOLUÒ SHŪWŪ</text>
  <text x="600" y="${glyphY}" font-family="Noto Serif SC" font-size="${glyphSize}" font-weight="700"
        fill="${cat.color}" text-anchor="middle" dominant-baseline="middle">${escXml(glyph)}</text>
  ${pinyin ? `<text x="600" y="${pinyinY}" font-family="Inconsolata" font-size="40" letter-spacing="3" fill="#a06428" text-anchor="middle" dominant-baseline="middle">${escXml(pinyin)}</text>` : ''}
  ${gloss ? `<text x="600" y="${glossY}" font-family="EB Garamond" font-size="32" fill="${INK}" text-anchor="middle" dominant-baseline="middle">${escXml(gloss)}</text>` : ''}
  <text x="1140" y="600" font-family="Noto Serif SC" font-size="22" letter-spacing="2" fill="${MUTED}" text-anchor="end">角落書屋</text>
</svg>`;
}

/**
 * OG alt text for the entry — human-readable, used by screen readers.
 */
export function ogAltText(entry) {
  const cat = CATEGORY_META[entry.category] || CATEGORY_META.characters;
  const glyph = deriveGlyph(entry, cat);
  const pinyin = entry.pinyin ? ` (${entry.pinyin})` : '';
  const gloss = deriveGloss(entry);
  const tail = gloss ? ` — ${gloss}` : '';
  return `${glyph}${pinyin}${tail} · ${cat.label} entry`;
}

/**
 * Site-wide / homepage OG card. Watermark glyph: 書. Tagline below.
 */
export function renderHomepageOgSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <radialGradient id="vignette" cx="50%" cy="0%" r="80%">
      <stop offset="0%" stop-color="#8b1a1a" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="${PAPER}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${PAPER}"/>
  <rect width="1200" height="630" fill="url(#vignette)"/>
  <rect x="0" y="0" width="1200" height="8" fill="#8b1a1a"/>
  <text x="1080" y="225" font-family="Noto Serif SC" font-size="540" font-weight="700"
        fill="#8b1a1a" opacity="0.08" text-anchor="end" dominant-baseline="middle">書</text>
  <text x="60" y="68" font-family="Inconsolata" font-size="22" letter-spacing="4" fill="${MUTED}">JIǍOLUÒ SHŪWŪ · 角落書屋</text>
  <text x="1140" y="68" font-family="Inconsolata" font-size="22" letter-spacing="4" fill="${MUTED}" text-anchor="end">SHŪWŪ.IO</text>
  <text x="600" y="310" font-family="Noto Serif SC" font-size="200" font-weight="700"
        fill="#8b1a1a" text-anchor="middle" dominant-baseline="middle">角落書屋</text>
  <text x="600" y="430" font-family="EB Garamond" font-size="38" fill="${INK}" text-anchor="middle" dominant-baseline="middle">${escXml(BRAND.tagline)}</text>
  <text x="600" y="500" font-family="EB Garamond" font-size="24" fill="${MUTED}" text-anchor="middle" dominant-baseline="middle">characters · vocabulary · grammar · philosophy · history · culture</text>
  <text x="1140" y="600" font-family="Noto Serif SC" font-size="22" letter-spacing="2" fill="${MUTED}" text-anchor="end">jiǎoluò shūwū</text>
</svg>`;
}
