/* share.js — social-carousel exporter.
 *
 * Reads a source content page (?page=pages/<cat>/<slug>.html), parses out
 * the structured chunks (hero glyph, scholar prose, vocab cards, chengyu,
 * related chips), and assembles a platform-tuned carousel.
 *
 * Each slide is drawn directly to a 2D canvas at the platform's native
 * export resolution. Canvas text APIs handle CJK glyphs via the OS font
 * stack, so no font-embedding gymnastics are needed; we await
 * document.fonts.ready before rasterizing so EB Garamond + Noto Serif SC
 * commit before drawing.
 *
 * Pure client-side, no server. JSZip is lazy-loaded for the bulk download.
 */

// ── Visual identity ─────────────────────────────────────────────────────
//
// Three palette themes, applied per platform:
//   parchment : the site's default warm cream (IG, XHS)
//   ink       : near-black background, parchment ink (Story/Reel —
//               higher contrast for tiny phone screens, no ad-overlay clash)
//   notebook  : white background, hairline rules, minimal color
//               (LinkedIn — reads as a document, not an ad)
//
// Each theme defines bg/ink/muted/accent so slides can share one renderer.
const THEMES = {
  parchment: { bg: '#f2e8d5', bg2: '#ebe0c8', ink: '#1c1208', ink2: '#2c1f10', muted: '#6b5535', accent: '#a06428', rule: 'rgba(60,40,20,0.18)' },
  ink:       { bg: '#1c1208', bg2: '#2a1c10', ink: '#f2e8d5', ink2: '#e0d4b8', muted: '#a8946a', accent: '#d4a458', rule: 'rgba(242,232,213,0.20)' },
  notebook:  { bg: '#fafaf6', bg2: '#f0efe8', ink: '#0f0d08', ink2: '#26221a', muted: '#615a4a', accent: '#8b1a1a', rule: 'rgba(15,13,8,0.16)' },
};

const CATEGORY = {
  characters: { glyph: '字', label: 'Character',  pinyin: 'zì',       color: '#8b1a1a' },
  vocab:      { glyph: '词', label: 'Vocabulary', pinyin: 'cí',       color: '#a06428' },
  grammar:    { glyph: '法', label: 'Grammar',    pinyin: 'yǔfǎ',     color: '#1a5050' },
  chengyu:    { glyph: '语', label: 'Chengyu',    pinyin: 'chéngyǔ',  color: '#6b1a2a' },
  religion:   { glyph: '宗', label: 'Religion',   pinyin: 'zōngjiào', color: '#5c3d7a' },
  philosophy: { glyph: '哲', label: 'Philosophy', pinyin: 'zhéxué',   color: '#3a5c3a' },
  history:    { glyph: '史', label: 'History',    pinyin: 'lìshǐ',    color: '#6b4420' },
  geography:  { glyph: '地', label: 'Geography',  pinyin: 'dìlǐ',     color: '#2a5c6b' },
  culture:    { glyph: '文', label: 'Culture',    pinyin: 'wénhuà',   color: '#8b3a1a' },
  culinary:   { glyph: '食', label: 'Culinary',   pinyin: 'měishí',   color: '#7a4a10' },
  arts:       { glyph: '艺', label: 'Arts',       pinyin: 'yìshù',    color: '#4a2878' },
  science:    { glyph: '科', label: 'Science',    pinyin: 'kēxué',    color: '#1a4a5c' },
  daily:      { glyph: '日', label: 'Daily',      pinyin: 'rìcháng',  color: '#5c4a1a' },
  hubs:       { glyph: '集', label: 'Reading',    pinyin: 'jí',       color: '#5a5a5a' },
};

const FONT_CN = '"Noto Serif SC", "PingFang SC", "Songti SC", "Hiragino Sans GB", serif';
const FONT_EN = '"EB Garamond", Georgia, "Times New Roman", serif';
const FONT_MONO = '"JetBrains Mono", "SF Mono", Menlo, monospace';

// Brand strings — populated from data/brand.json on boot. Hard-coded
// fallbacks match the build module so the page still renders sensibly
// if brand.json fetch fails (offline, mid-deploy). Edit at one source:
// build/lib/brand.mjs.
const BRAND = {
  cn: '角落書屋',
  en: 'Jiǎoluò Shūwū',
  domain: 'jiaoshoo.com',
  tagline: 'A reading nook for Chinese language and civilisation',
};
// Aliases retained for callsite readability.
let BRAND_CN = BRAND.cn;
let BRAND_EN = BRAND.en;

// ── Platforms ───────────────────────────────────────────────────────────
//
// Each platform bundles size + safe insets + theme + slide selection rules.
// `kinds` lists which slide kinds to include in order; the renderer fills
// each kind from the source until the budget runs out.
const PLATFORMS = [
  {
    key: 'ig-square', label: 'Instagram', sub: '1:1 square',
    w: 1080, h: 1080, ratio: 'square', theme: 'parchment',
    safeTop: 0, safeBottom: 0, indicator: true, maxBeats: 3, maxCards: 2,
    kinds: ['hook', 'beat', 'card', 'chengyu', 'related', 'closer'],
  },
  {
    key: 'ig-portrait', label: 'Instagram', sub: '4:5 portrait',
    w: 1080, h: 1350, ratio: 'portrait', theme: 'parchment',
    safeTop: 0, safeBottom: 0, indicator: true, maxBeats: 3, maxCards: 2,
    kinds: ['hook', 'beat', 'card', 'chengyu', 'related', 'closer'],
  },
  {
    key: 'story', label: 'Story / Reel', sub: '9:16 vertical',
    w: 1080, h: 1920, ratio: 'story', theme: 'ink',
    safeTop: 240, safeBottom: 340, indicator: true, maxBeats: 2, maxCards: 0,
    // Stories drop card/chengyu slides — no real estate inside the safe zone
    // for example sentences, and viewers swipe-tap fast.
    kinds: ['hook', 'beat', 'closer'],
  },
  {
    key: 'xhs', label: 'Xiaohongshu', sub: '3:4 native',
    w: 1080, h: 1440, ratio: 'xhs', theme: 'parchment',
    safeTop: 0, safeBottom: 0, indicator: true, maxBeats: 3, maxCards: 2,
    kinds: ['hook', 'beat', 'card', 'chengyu', 'related', 'closer'],
  },
  {
    key: 'linkedin', label: 'LinkedIn', sub: '4:5 document',
    w: 1080, h: 1350, ratio: 'portrait', theme: 'notebook',
    safeTop: 0, safeBottom: 0, indicator: true, maxBeats: 4, maxCards: 0,
    // LinkedIn swipes are read like a paper. No card/chengyu noise; more
    // beats; quieter hairline aesthetic instead of glyph watermarks.
    kinds: ['hook', 'beat', 'related', 'closer'],
  },
];

// ── State ───────────────────────────────────────────────────────────────
const state = {
  platform: PLATFORMS[0],
  source: null,
  slides: [],
  rendering: false,
};

// ── Boot ────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  // Pull brand strings + the share-cache (LLM-generated hooks/beats) in
  // parallel before anything renders. Both are small JSON files cached by
  // the SW after first request. Both fail through silently when missing
  // so the builder still works for offline / pre-cache-gen states.
  // Awaited because loadSource() reads _shareCache during page resolve.
  await Promise.all([loadBrand(), loadShareCache()]);
  renderPlatformPicker();
  bindControls();
  const params = new URLSearchParams(location.search);
  const pagePath = params.get('page');
  if (!pagePath) { showEmpty(); return; }
  setStatus('Loading source page…');
  try {
    state.source = await loadSource(pagePath);
    showSourceMeta(state.source);
    rebuild();
  } catch (err) {
    console.error(err);
    setStatus('Could not load that page. Check the URL and try again.', 'err');
  }
}

async function loadBrand() {
  try {
    const res = await fetch('../../data/brand.json');
    if (!res.ok) return;
    const data = await res.json();
    Object.assign(BRAND, data);
    BRAND_CN = BRAND.cn;
    BRAND_EN = BRAND.en;
  } catch (_) { /* keep defaults */ }
}

// LLM-generated share content keyed by entry path. Populated by
// `npm run share:generate` and committed to data/share-cache.json. The
// builder uses cache entries when frontmatter `share:` isn't authored,
// giving every page publication-quality hook + beats without per-page
// authoring effort. Authored frontmatter always wins.
let _shareCache = null;
async function loadShareCache() {
  try {
    const res = await fetch('../../data/share-cache.json');
    if (!res.ok) { _shareCache = {}; return; }
    _shareCache = await res.json();
  } catch (_) { _shareCache = {}; }
}

function getCachedShare(path) {
  return (_shareCache && _shareCache[path]) || null;
}

function showEmpty() {
  document.querySelector('[data-share-preview]').hidden = true;
  document.querySelector('.share-toolbar')?.setAttribute('hidden', '');
  document.querySelector('[data-share-empty]').hidden = false;
  document.querySelector('[data-share-status]').hidden = true;
}

function setStatus(msg, kind) {
  const el = document.querySelector('[data-share-status]');
  el.hidden = false;
  el.textContent = msg;
  el.dataset.kind = kind || '';
}

// ── Source loading ──────────────────────────────────────────────────────
//
// Path resolution accepts several typing-friendly forms, normalized to the
// canonical pages/<category>/<slug>.html before fetching. Examples that
// all resolve to pages/characters/ai4_爱.html:
//
//   ?page=pages/characters/ai4_%E7%88%B1.html  (canonical, what the
//                                               Carousel button emits)
//   ?page=characters/ai4_爱.html               (drop the pages/ prefix)
//   ?page=characters/ai4                       (drop the hanzi suffix)
//   ?page=ai4_爱                               (just the slug)
//   ?page=ai4                                  (slug ASCII prefix only)
//
// Resolution looks up data/entries.json once and caches it. Ambiguous
// short forms (multiple matches) fail fast with a helpful message.
let _entriesPromise = null;
function loadEntries() {
  if (_entriesPromise) return _entriesPromise;
  _entriesPromise = fetch('../../data/entries.json').then(r => r.json());
  return _entriesPromise;
}

async function resolvePagePath(input) {
  if (!input) return null;
  // Decode any URL-escaped CJK and trim whitespace.
  let raw = input.trim();
  try { raw = decodeURIComponent(raw); } catch (_) { /* already decoded */ }

  // Already a fully-qualified path? Use as-is.
  if (/^pages\/[^/]+\/.+\.html$/.test(raw)) return raw;

  // pages/X without leading "pages/" but with .html suffix.
  if (/^[^/]+\/.+\.html$/.test(raw)) return 'pages/' + raw;

  // No extension or partial slug — search entries.json.
  const entries = await loadEntries();
  const norm = raw.replace(/\.html$/, '');

  // Try exact path matches first (drop pages/ prefix variants).
  const candidates = entries.filter(e => {
    const path = e.path;                                  // pages/characters/ai4_爱.html
    const noExt = path.replace(/\.html$/, '');             // pages/characters/ai4_爱
    const noPages = noExt.replace(/^pages\//, '');         // characters/ai4_爱
    const slug = noPages.split('/').pop();                 // ai4_爱
    const ascii = slug.split('_')[0];                      // ai4
    const cat = noPages.split('/')[0];                     // characters
    const catAscii = `${cat}/${ascii}`;                    // characters/ai4
    return raw === path || raw === noExt || raw === noPages
        || norm === noPages || norm === slug || norm === ascii
        || norm === catAscii;
  });

  if (candidates.length === 1) return candidates[0].path;
  if (candidates.length > 1) {
    const list = candidates.slice(0, 4).map(e => e.path).join(', ');
    throw new Error(`Ambiguous page reference "${raw}" — matches ${candidates.length} entries (${list}…). Use the full path.`);
  }

  // Last resort: try as-is anyway. May still fetch successfully if the
  // user passed a path the matcher doesn't recognize.
  return raw;
}

async function loadSource(rawInput) {
  const pagePath = await resolvePagePath(rawInput);
  if (!pagePath) throw new Error('No page specified.');
  const url = '../../' + pagePath;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed for ${pagePath}: ${res.status}`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = readMeta(html);
  const category = (meta && meta.category) || 'characters';
  const cat = CATEGORY[category] || CATEGORY.characters;

  // Merge share content from three sources, in priority order:
  //   1. Authored frontmatter `share:` (per-entry handcraft, always wins).
  //   2. data/share-cache.json (LLM enrichment pass; covers every entry).
  //   3. Empty (the heuristic auto-extractor in collectBeats() takes over).
  const authoredShare = (meta && meta.share) || {};
  const cachedShare = getCachedShare(pagePath) || {};
  const share = {
    hook: authoredShare.hook || cachedShare.hook || '',
    beats: (authoredShare.beats && authoredShare.beats.length)
      ? authoredShare.beats
      : (cachedShare.beats || []),
    cta: authoredShare.cta || cachedShare.cta || '',
    _origin: authoredShare.hook ? 'authored'
           : cachedShare.hook   ? 'enriched'
           :                       'auto',
  };

  return {
    sourcePath: pagePath,
    sourceTitle: (doc.querySelector('title')?.textContent || '').split(' — ')[0].trim(),
    meta, category, cat, share,
    hero: parseHero(doc, meta),
    sections: parseScholars(doc),
    cards: parseCards(doc),
    chengyu: parseChengyu(doc),
    chips: parseChips(doc),
  };
}

function readMeta(html) {
  const m = html.match(/<!--\s*(\{[\s\S]*?\})\s*-->/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (_) { return null; }
}

function textOf(el) {
  if (!el) return '';
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

function parseHero(doc, meta) {
  const isChar = meta && meta.type === 'character';
  if (isChar) {
    // Trust the metadata comment over scraped DOM — character pages
    // contain inline stroke-order SVG markup that can confuse text scrapes.
    const glyph = (meta && meta.char) || '';
    const pinyin = (meta && meta.pinyin) || textOf(doc.querySelector('.hero-pinyin')).split(' ')[0] || '';
    const en = textOf(doc.querySelector('.hero-en'));
    return { kind: 'character', glyph, pinyin, en };
  }
  const cnSpan = doc.querySelector('.today-hero-title-cn');
  const cn = cnSpan ? textOf(cnSpan) : textOf(doc.querySelector('.topic-hero-title'));
  const py = textOf(doc.querySelector('.today-hero-title-py, .topic-hero-title-py'));
  const en = textOf(doc.querySelector('.today-hero-title-en, .topic-hero-en'));
  const desc = textOf(doc.querySelector('.topic-hero-desc'));
  return { kind: 'topic', glyph: cn, pinyin: py, en, desc };
}

function parseScholars(doc) {
  const out = [];
  doc.querySelectorAll('.scholar').forEach(el => {
    const label = textOf(el.querySelector('.scholar-label'));
    const paragraphs = Array.from(el.querySelectorAll('p')).map(p => textOf(p)).filter(Boolean);
    const body = paragraphs.join(' ');
    if (body.length < 40) return;
    out.push({ label, body, glyph: el.dataset.glyph || '' });
  });
  return out.slice(0, 4);
}

function parseCards(doc) {
  const out = [];
  doc.querySelectorAll('.card').forEach(el => {
    const cn = textOf(el.querySelector('.card-cn'));
    const py = textOf(el.querySelector('.card-py'));
    const en = textOf(el.querySelector('.card-en'));
    const def = textOf(el.querySelector('.card-def'));
    const ex = el.querySelector('.example');
    const example = ex ? {
      cn: textOf(ex.querySelector('.ex-cn')),
      py: textOf(ex.querySelector('.ex-py')),
      en: textOf(ex.querySelector('.ex-en')),
    } : null;
    if (!cn || !py) return;
    out.push({ cn, py, en, def, example });
  });
  return out.slice(0, 6);
}

function parseChengyu(doc) {
  const out = [];
  doc.querySelectorAll('.cy').forEach(el => {
    const cn = textOf(el.querySelector('.cy-cn'));
    const py = textOf(el.querySelector('.cy-py'));
    const lit = textOf(el.querySelector('.cy-lit'));
    const en = textOf(el.querySelector('.cy-en, .cy-meaning'));
    if (!cn) return;
    out.push({ cn, py, lit, en });
  });
  return out.slice(0, 6);
}

function parseChips(doc) {
  const out = [];
  doc.querySelectorAll('.adj-wrap .adj').forEach(el => {
    const cn = textOf(el.querySelector('.a-cn'));
    const py = textOf(el.querySelector('.a-py'));
    const en = textOf(el.querySelector('.a-en'));
    if (!cn) return;
    out.push({ cn, py, en });
  });
  return out.slice(0, 8);
}

function showSourceMeta(source) {
  const titleEl = document.querySelector('[data-share-source-title]');
  const linkEl = document.querySelector('[data-share-source-link]');
  const modeEl = document.querySelector('[data-share-source-mode]');
  const subEl = document.querySelector('[data-share-source-sub]');
  titleEl.textContent = source.sourceTitle || source.sourcePath;
  if (subEl) {
    const cat = source.cat;
    subEl.textContent = `${cat.label} · ${cat.glyph} ${cat.pinyin}`;
  }
  linkEl.href = '../../' + source.sourcePath;
  linkEl.hidden = false;
  if (modeEl) {
    const origin = source.share && source.share._origin;
    const label = origin === 'authored' ? 'Authored hook + beats'
               : origin === 'enriched' ? 'AI-enriched hook + beats'
               :                          'Auto-extracted from prose';
    modeEl.textContent = label;
    modeEl.dataset.kind = origin || 'auto';
  }
}

// ── UI: platform picker ────────────────────────────────────────────────
//
// Each card shows a true-shape ratio chip (filled with the bg color when
// active so you actually see the canvas shape change), the platform name,
// and the export dimensions in mono. Active state lifts and gains an
// accent border.
function renderPlatformPicker() {
  const host = document.querySelector('[data-share-formats]');
  host.innerHTML = PLATFORMS.map(p => {
    const on = p.key === state.platform.key ? ' is-on' : '';
    // Compact sub-line combines ratio shorthand with dimensions so the card
    // stays two lines tall ("Instagram" / "1:1 · 1080×1080") instead of
    // sprawling to three. Easier to scan + fits in narrow cells.
    const ratioLabel = p.sub.split(' ')[0];          // "1:1" / "4:5" / "9:16" / "3:4"
    const subLine = `${ratioLabel} · ${p.w}×${p.h}`;
    return `<button type="button" class="share-platform${on}" data-share-platform="${p.key}" aria-pressed="${p.key === state.platform.key}">
      <span class="share-platform-chip share-platform-chip--${p.ratio}" aria-hidden="true">
        <span class="share-platform-chip-fill"></span>
      </span>
      <span class="share-platform-text">
        <span class="share-platform-label">${p.label}</span>
        <span class="share-platform-sub">${subLine}</span>
      </span>
    </button>`;
  }).join('');
}

function bindControls() {
  document.querySelector('[data-share-formats]').addEventListener('click', e => {
    const btn = e.target.closest('[data-share-platform]');
    if (!btn) return;
    const next = PLATFORMS.find(p => p.key === btn.dataset.sharePlatform);
    if (!next || next.key === state.platform.key) return;
    state.platform = next;
    renderPlatformPicker();
    rebuild();
  });
  document.querySelector('[data-share-rebuild]').addEventListener('click', rebuild);
  document.querySelector('[data-share-download-zip]').addEventListener('click', downloadAll);
  document.querySelector('[data-share-preview]').addEventListener('click', e => {
    const btn = e.target.closest('[data-share-slide-index]');
    if (!btn) return;
    downloadSlide(parseInt(btn.dataset.shareSlideIndex, 10));
  });
}

// ── Slide assembly ──────────────────────────────────────────────────────
//
// Order is dictated by the platform's `kinds` array. Each kind pulls its
// content from `source` (authored share.* takes priority where applicable)
// and produces zero, one, or many slide objects.
function buildSlides(source, platform) {
  const slides = [];
  const beats = collectBeats(source, platform);
  const cards = source.cards.slice(0, platform.maxCards);
  const cyTotal = Math.max(0, platform.maxCards - cards.length);
  const chengyu = source.chengyu.slice(0, cyTotal);
  const showRelated = source.chips.length >= 3;

  for (const kind of platform.kinds) {
    if (kind === 'hook') {
      slides.push(makeHookSlide(source, platform));
    } else if (kind === 'beat') {
      beats.forEach((beat, i) => slides.push(makeBeatSlide(source, platform, beat, i + 1, beats.length)));
    } else if (kind === 'card') {
      cards.forEach((c, i) => slides.push(makeCardSlide(source, platform, c, i + 1, cards.length)));
    } else if (kind === 'chengyu') {
      chengyu.forEach((cy, i) => slides.push(makeChengyuSlide(source, platform, cy, i + 1, chengyu.length)));
    } else if (kind === 'related') {
      if (showRelated) slides.push(makeRelatedSlide(source, platform));
    } else if (kind === 'closer') {
      slides.push(makeCloserSlide(source, platform));
    }
  }
  return slides;
}

function collectBeats(source, platform) {
  const cap = platform.maxBeats;
  const authored = source.share && Array.isArray(source.share.beats) ? source.share.beats : null;
  if (authored && authored.length) {
    return authored.slice(0, cap).map(text => ({ kind: 'authored', text }));
  }
  const out = [];
  const first = source.sections[0];
  if (first && first.body) {
    const sentences = splitSentences(first.body).filter(s => s.length >= 30 && s.length <= 240);
    sentences.slice(0, cap).forEach(s => out.push({ kind: 'derived', text: s, label: first.label }));
  }
  if (out.length === 0 && source.hero && source.hero.en) {
    out.push({ kind: 'derived', text: source.hero.en });
  }
  return out;
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?。！？])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ── Canvas primitives ──────────────────────────────────────────────────
function ctxState(platform) {
  const theme = THEMES[platform.theme] || THEMES.parchment;
  return {
    platform, theme,
    safeTop: platform.safeTop || 0,
    safeBottom: platform.safeBottom || 0,
    indicator: platform.indicator,
  };
}

function fillBg(ctx, w, h, theme, cat) {
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);
  // Quiet vignette in the category color anchored top-center.
  const grad = ctx.createRadialGradient(w / 2, 0, 0, w / 2, 0, h * 0.95);
  grad.addColorStop(0, hexA(cat.color, 0.08));
  grad.addColorStop(1, hexA(theme.bg, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function topBand(ctx, w, h, color, thick) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, thick || Math.round(h * 0.008));
}

function bleedGlyph(ctx, w, h, glyph, color, opts) {
  // Watermark glyph anchored bottom-right and clamped INSIDE the canvas
  // (not bleeding off, which previously cropped to fragments that read as
  // unrelated characters). Big enough to feel like a deliberate stamp,
  // small enough to keep the full character shape visible.
  const opacity = (opts && opts.opacity) ?? 0.10;
  const size = (opts && opts.size) ?? Math.round(Math.min(w, h) * 0.55);
  const xRatio = (opts && opts.xRatio) ?? 0.97;
  const yRatio = (opts && opts.yRatio) ?? 0.7;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px ${FONT_CN}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, w * xRatio, h * yRatio);
  ctx.restore();
}

function leftMarginNumber(ctx, w, h, n, color, opts) {
  // Big numerical or stroke marginalia in the left gutter — gives beat
  // slides a "page in a manuscript" feel without dumping a watermark.
  const safeTop = (opts && opts.safeTop) || 0;
  const fs = Math.round(h * 0.18);
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = color;
  ctx.font = `700 ${fs}px ${FONT_EN}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(String(n), Math.round(w * 0.07), safeTop + Math.round(h * 0.18));
  ctx.restore();
}

function topEyebrow(ctx, w, h, leftText, rightText, theme, opts) {
  const fs = Math.round(h * 0.018);
  const safeTop = (opts && opts.safeTop) || 0;
  const y = safeTop + Math.round(h * 0.05);
  ctx.fillStyle = theme.muted;
  ctx.font = `500 ${fs}px ${FONT_MONO}`;
  ctx.textBaseline = 'middle';
  if (leftText) {
    ctx.textAlign = 'left';
    ctx.fillText(leftText, Math.round(w * 0.07), y);
  }
  if (rightText) {
    ctx.textAlign = 'right';
    ctx.fillText(rightText, w - Math.round(w * 0.07), y);
  }
  // Hairline under the eyebrow row so the slide has a clear masthead.
  ctx.fillStyle = theme.rule;
  ctx.fillRect(Math.round(w * 0.07), y + Math.round(h * 0.025),
               w - Math.round(w * 0.07) * 2, 1);
}

/**
 * Single-row footer combining brand + slide indicator on one strip so
 * the bottom doesn't waste a fifth of the slide on two stacked rows.
 *   left   : 角落書屋 · jiaoshoo.com
 *   right  : 1/8 · swipe →   (or)   ↓ save this
 */
function bottomStrip(ctx, w, h, idx, total, theme, opts) {
  const safeBottom = (opts && opts.safeBottom) || 0;
  const y = h - safeBottom - Math.round(h * 0.045);
  const padX = Math.round(w * 0.07);
  ctx.textBaseline = 'middle';

  ctx.fillStyle = theme.muted;
  ctx.font = `500 ${Math.round(h * 0.016)}px ${FONT_CN}`;
  ctx.textAlign = 'left';
  ctx.fillText(BRAND_CN, padX, y);

  ctx.font = `400 ${Math.round(h * 0.013)}px ${FONT_MONO}`;
  const brandWidth = ctx.measureText(BRAND_CN).width;
  ctx.fillStyle = theme.muted;
  ctx.fillText('· jiaoshoo.com', padX + brandWidth + Math.round(w * 0.012), y);

  if (opts && opts.indicator) {
    const isFinal = idx === total - 1;
    const text = isFinal ? '↓ save this' : `${idx + 1} / ${total}  swipe →`;
    ctx.fillStyle = isFinal ? (theme.accent) : theme.muted;
    ctx.font = `500 ${Math.round(h * 0.015)}px ${FONT_MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText(text, w - padX, y);
  }
}

function tokenize(text) {
  const out = [];
  let buf = '';
  let mode = 'none';
  for (const ch of text) {
    const isCjk = /[　-鿿＀-￯]/.test(ch);
    const isSpace = /\s/.test(ch);
    if (isCjk) {
      if (buf) out.push(buf);
      buf = '';
      out.push(ch);
      mode = 'cjk';
    } else if (isSpace) {
      buf += ' ';
      out.push(buf);
      buf = '';
      mode = 'space';
    } else {
      if (mode === 'cjk' && out.length && /[.,;:!?…]/.test(ch)) {
        out[out.length - 1] += ch;
        continue;
      }
      buf += ch;
      mode = 'ascii';
    }
  }
  if (buf) out.push(buf);
  return out;
}

function wrapLines(ctx, text, maxWidth) {
  const tokens = tokenize(text);
  const lines = [];
  let current = '';
  for (const tok of tokens) {
    const next = current ? current + tok : tok;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      if (ctx.measureText(tok).width > maxWidth) {
        let buf = '';
        for (const ch of tok) {
          if (ctx.measureText(buf + ch).width > maxWidth) {
            if (buf) lines.push(buf);
            buf = ch;
          } else {
            buf += ch;
          }
        }
        current = buf;
      } else {
        current = tok;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawWrapped(ctx, text, x, y, maxWidth, lineHeight, font, color, align = 'left') {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const lines = wrapLines(ctx, text, maxWidth);
  let cy = y;
  for (const line of lines) {
    ctx.fillText(line, x, cy);
    cy += lineHeight;
  }
  return cy;
}

function drawText(ctx, text, x, y, font, color, align = 'center', baseline = 'middle') {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexA(hex, a) {
  const m = hex.replace('#', '');
  const n = parseInt(m, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
}

// ── Slide makers ────────────────────────────────────────────────────────
//
// Hook slide — pull-quote treatment. Big bleed-glyph at the right edge,
// hook copy left-aligned occupying ~60% of the canvas. The single most
// important slide for swipe-through.
function makeHookSlide(source, platform) {
  return {
    id: 'hook', kind: 'hook', label: 'Hook',
    render(ctx, w, h, st) {
      const { theme } = st;
      const { cat, hero, share } = source;
      fillBg(ctx, w, h, theme, cat);
      topBand(ctx, w, h, cat.color, Math.round(h * 0.012));
      // Notebook theme keeps things quiet — no glyph bleed.
      if (platform.theme !== 'notebook') {
        bleedGlyph(ctx, w, h, hero.glyph || cat.glyph, cat.color,
          { opacity: platform.theme === 'ink' ? 0.15 : 0.12,
            size: Math.round(h * 0.95), xRatio: 1.08, yRatio: 0.6 });
      }
      topEyebrow(ctx, w, h,
        `${cat.label.toUpperCase()} · ${cat.glyph} ${cat.pinyin}`,
        BRAND_EN.toUpperCase(), theme, st);

      const padX = Math.round(w * 0.085);
      const top = st.safeTop + Math.round(h * 0.18);
      const maxW = Math.round(w * 0.78);  // leave room for the bleed glyph
      const hookText = share.hook || hero.en || (hero.glyph + ' ' + hero.pinyin);
      const len = hookText.length;
      const baseFs = len < 60  ? Math.round(h * 0.072)
                   : len < 110 ? Math.round(h * 0.058)
                   : len < 170 ? Math.round(h * 0.046)
                   :             Math.round(h * 0.038);
      const lh = Math.round(baseFs * 1.18);
      drawWrapped(ctx, hookText, padX, top, maxW, lh,
        `700 ${baseFs}px ${FONT_EN}`, theme.ink, 'left');

      // Subtle category-color underline below the hook to frame it.
      const underY = top + Math.min(wrapLines(ctx, hookText, maxW).length, 6) * lh + Math.round(h * 0.02);
      ctx.fillStyle = cat.color;
      ctx.fillRect(padX, underY, Math.round(w * 0.12), 3);

      // Tiny "a thread on 字" eyebrow at the bottom-left, above the strip.
      const tagY = h - st.safeBottom - Math.round(h * 0.11);
      ctx.fillStyle = theme.muted;
      ctx.font = `500 ${Math.round(h * 0.018)}px ${FONT_MONO}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`A thread on ${hero.glyph || cat.glyph}`, padX, tagY);

      bottomStrip(ctx, w, h, st.idx, st.total, theme, st);
    },
  };
}

// Beat slide — numbered marginalia in the left gutter, body type in the
// right column. Reads like an annotated page rather than a TOC entry.
function makeBeatSlide(source, platform, beat, idx, total) {
  return {
    id: 'beat-' + idx, kind: 'beat', label: `Beat ${idx}/${total}`,
    render(ctx, w, h, st) {
      const { theme } = st;
      const { cat } = source;
      fillBg(ctx, w, h, theme, cat);
      topBand(ctx, w, h, cat.color, Math.round(h * 0.006));
      topEyebrow(ctx, w, h,
        beat.label ? beat.label.toUpperCase() : `BEAT ${idx} / ${total}`,
        BRAND_EN.toUpperCase(), theme, st);

      // Big numeral in left gutter. Roman ordinals on notebook (editorial).
      // Size and weight scale per theme: ink (Story) gets a smaller ordinal
      // so the body type can carry the slide.
      const numeral = platform.theme === 'notebook'
        ? toRoman(idx)
        : String(idx);
      const padX = Math.round(w * 0.085);
      const numY = st.safeTop + Math.round(h * 0.16);
      const numFs = platform.theme === 'notebook' ? Math.round(h * 0.075)
                  : platform.theme === 'ink'      ? Math.round(h * 0.10)
                  :                                  Math.round(h * 0.16);
      ctx.fillStyle = cat.color;
      ctx.globalAlpha = platform.theme === 'notebook' ? 1
                      : platform.theme === 'ink'      ? 1
                      :                                  0.85;
      ctx.font = `700 ${numFs}px ${FONT_EN}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(numeral, padX, numY);
      ctx.globalAlpha = 1;

      // Body text — start below the numeral. Story (ink) gets bigger
      // body type since the canvas is 1920px tall.
      const bodyTop = numY + Math.round(numFs * 1.25);
      const maxW = w - padX * 2;
      const len = beat.text.length;
      const scale = platform.theme === 'ink' ? 1.4 : 1.0;
      const baseFs = len < 80  ? Math.round(h * 0.046 * scale)
                   : len < 160 ? Math.round(h * 0.038 * scale)
                   :             Math.round(h * 0.032 * scale);
      const lh = Math.round(baseFs * 1.42);
      drawWrapped(ctx, beat.text, padX, bodyTop, maxW, lh,
        `400 ${baseFs}px ${FONT_EN}`, theme.ink, 'left');

      bottomStrip(ctx, w, h, st.idx, st.total, theme, st);
    },
  };
}

function toRoman(n) {
  const map = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI' };
  return map[n] || String(n);
}

// Card slide — split layout. Hanzi takes the left half (huge, category
// color); pinyin + gloss + definition stack in the right column. When an
// example sentence is present, it tucks under the gloss in a soft block;
// when absent, the right column reclaims the space for the definition
// rather than leaving dead air.
function makeCardSlide(source, platform, card, idx, total) {
  return {
    id: 'card-' + idx, kind: 'card', label: `Card ${idx}/${total}`,
    render(ctx, w, h, st) {
      const { theme } = st;
      const { cat } = source;
      fillBg(ctx, w, h, theme, cat);
      topBand(ctx, w, h, cat.color, Math.round(h * 0.006));
      topEyebrow(ctx, w, h, `VOCAB · ${idx} / ${total}`, BRAND_EN.toUpperCase(), theme, st);

      // Left: hanzi block, vertically centered in the canvas body.
      const padX = Math.round(w * 0.07);
      const bodyTop = st.safeTop + Math.round(h * 0.13);
      const bodyBot = h - st.safeBottom - Math.round(h * 0.13);
      const bodyH = bodyBot - bodyTop;
      const leftColW = Math.round(w * 0.42);
      const rightColX = padX + leftColW + Math.round(w * 0.04);
      const rightColW = w - rightColX - padX;

      const hanzi = card.cn;
      const len = [...hanzi].length;
      // Size such that the full word fits inside leftColW with comfortable
      // padding. CJK glyphs render close to their font-size in width, so
      // budget = leftColW * 0.85, divided by char count.
      const widthBudget = leftColW * 0.85;
      const heightBudget = bodyH * 0.65;
      let hanziSize = Math.floor(widthBudget / Math.max(1, len));
      // But also clamp to a sane vertical proportion so a single char
      // doesn't tower or a 4-char word vanish.
      hanziSize = Math.min(hanziSize, Math.round(heightBudget));
      hanziSize = Math.max(hanziSize, Math.round(h * 0.06));
      const hanziCx = padX + leftColW / 2;
      const hanziCy = bodyTop + bodyH / 2;
      drawText(ctx, hanzi, hanziCx, hanziCy,
        `700 ${hanziSize}px ${FONT_CN}`, cat.color, 'center', 'middle');

      // Vertical hairline rule between columns.
      ctx.fillStyle = theme.rule;
      ctx.fillRect(padX + leftColW + Math.round(w * 0.02), bodyTop + Math.round(h * 0.04),
        1, bodyH - Math.round(h * 0.08));

      // Right column: pinyin > gloss > definition (or example).
      let ry = bodyTop + Math.round(h * 0.04);
      drawText(ctx, card.py, rightColX, ry,
        `500 ${Math.round(h * 0.028)}px ${FONT_MONO}`, theme.accent, 'left', 'top');
      ry += Math.round(h * 0.05);

      if (card.en) {
        const enFs = Math.round(h * 0.034);
        ry = drawWrapped(ctx, card.en, rightColX, ry, rightColW,
          Math.round(enFs * 1.3), `600 ${enFs}px ${FONT_EN}`, theme.ink, 'left');
        ry += Math.round(h * 0.025);
      }

      // Gloss/definition or example, whichever is present and richer.
      const detail = card.example && card.example.cn
        ? null
        : (card.def || '');
      if (detail) {
        const detailFs = Math.round(h * 0.022);
        ry = drawWrapped(ctx, truncate(detail, 320), rightColX, ry, rightColW,
          Math.round(detailFs * 1.45), `400 ${detailFs}px ${FONT_EN}`, theme.ink2, 'left');
      } else if (card.example && card.example.cn) {
        // Example block — soft inset sized to its content (not stretched
        // to the bottom of the canvas). Below it, an "example ·" marginalia
        // label pinned to the top-left of the block to ground it.
        const exPad = Math.round(h * 0.025);
        const cnFs = Math.round(h * 0.026);
        const enFs = Math.round(h * 0.020);
        const cnLines = wrapLines(ctx, card.example.cn, rightColW - Math.round(w * 0.02));
        const cnLineCount = Math.min(cnLines.length, 3);
        const enLines = card.example.en
          ? wrapLines(ctx, card.example.en, rightColW - Math.round(w * 0.02))
          : [];
        const enLineCount = Math.min(enLines.length, 3);
        const contentH = cnLineCount * Math.round(cnFs * 1.4)
                       + (enLineCount > 0 ? Math.round(h * 0.02) + enLineCount * Math.round(enFs * 1.4) : 0)
                       + exPad * 2 + Math.round(h * 0.02);
        const blockY = ry;
        const blockH = Math.min(contentH, bodyBot - blockY - Math.round(h * 0.02));

        ctx.fillStyle = hexA(cat.color, 0.07);
        roundRect(ctx, rightColX - Math.round(w * 0.018), blockY,
          rightColW + Math.round(w * 0.018), blockH, Math.round(h * 0.014));
        ctx.fill();

        // Tiny "EXAMPLE" tab on the block.
        ctx.fillStyle = cat.color;
        ctx.font = `500 ${Math.round(h * 0.013)}px ${FONT_MONO}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('EXAMPLE · 例句', rightColX, blockY + exPad - Math.round(h * 0.005));

        let ey = blockY + exPad + Math.round(h * 0.025);
        ey = drawWrapped(ctx, card.example.cn, rightColX, ey, rightColW - Math.round(w * 0.02),
          Math.round(cnFs * 1.4), `500 ${cnFs}px ${FONT_CN}`, theme.ink, 'left');
        if (card.example.en) {
          ey += Math.round(h * 0.018);
          drawWrapped(ctx, card.example.en, rightColX, ey, rightColW - Math.round(w * 0.02),
            Math.round(enFs * 1.4), `400italic ${enFs}px ${FONT_EN}`, theme.muted, 'left');
        }
      }

      bottomStrip(ctx, w, h, st.idx, st.total, theme, st);
    },
  };
}

// Chengyu slide — four-character display rendered as a square seal.
// Each cell carries a hairline border; the whole block reads as a stamp
// rather than four floating glyphs.
function makeChengyuSlide(source, platform, cy, idx, total) {
  return {
    id: 'cy-' + idx, kind: 'chengyu', label: `Chengyu ${idx}/${total}`,
    render(ctx, w, h, st) {
      const { theme } = st;
      const { cat } = source;
      fillBg(ctx, w, h, theme, cat);
      topBand(ctx, w, h, cat.color, Math.round(h * 0.006));
      topEyebrow(ctx, w, h, `CHENGYU · ${idx} / ${total}`, BRAND_EN.toUpperCase(), theme, st);

      const padX = Math.round(w * 0.085);
      const bodyTop = st.safeTop + Math.round(h * 0.16);
      const chars = [...cy.cn].slice(0, 4);

      // Compute cell size such that the whole 4-grid fits ~50% of body width.
      const gridW = Math.min(w - padX * 2, Math.round(w * 0.7));
      const cellSize = Math.floor(gridW / chars.length) - 4;
      const totalGridW = cellSize * chars.length + (chars.length - 1) * 4;
      const startX = (w - totalGridW) / 2;
      const gridY = bodyTop;

      // Cells.
      chars.forEach((ch, i) => {
        const cx = startX + i * (cellSize + 4);
        // Cell background: faint paper tint with category-color hairline.
        ctx.fillStyle = hexA(cat.color, 0.04);
        roundRect(ctx, cx, gridY, cellSize, cellSize, 4);
        ctx.fill();
        ctx.strokeStyle = hexA(cat.color, 0.5);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Glyph.
        ctx.fillStyle = cat.color;
        ctx.font = `700 ${Math.round(cellSize * 0.7)}px ${FONT_CN}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch, cx + cellSize / 2, gridY + cellSize / 2);
      });

      let ry = gridY + cellSize + Math.round(h * 0.04);
      if (cy.py) {
        drawText(ctx, cy.py, w / 2, ry,
          `500 ${Math.round(h * 0.026)}px ${FONT_MONO}`, theme.accent, 'center', 'top');
        ry += Math.round(h * 0.045);
      }
      if (cy.lit) {
        drawText(ctx, '"' + cy.lit + '"', w / 2, ry,
          `400italic ${Math.round(h * 0.022)}px ${FONT_EN}`, theme.muted, 'center', 'top');
        ry += Math.round(h * 0.04);
      }
      if (cy.en) {
        const fs = Math.round(h * 0.028);
        const lh = Math.round(fs * 1.4);
        const lines = wrapLines(ctx, cy.en, w - padX * 2);
        ctx.font = `400 ${fs}px ${FONT_EN}`;
        lines.slice(0, 4).forEach((ln, i) => {
          drawText(ctx, ln, w / 2, ry + i * lh,
            `400 ${fs}px ${FONT_EN}`, theme.ink, 'center', 'top');
        });
      }
      bottomStrip(ctx, w, h, st.idx, st.total, theme, st);
    },
  };
}

// Related slide — rows with category-color rule + clean meta. Tighter
// row height than before so 6 chips don't span the full canvas.
function makeRelatedSlide(source, platform) {
  return {
    id: 'related', kind: 'related', label: 'Related',
    render(ctx, w, h, st) {
      const { theme } = st;
      const { cat } = source;
      fillBg(ctx, w, h, theme, cat);
      topBand(ctx, w, h, cat.color, Math.round(h * 0.006));
      topEyebrow(ctx, w, h, '词族 · CÍZÚ · IN THIS FIELD', BRAND_EN.toUpperCase(), theme, st);

      const padX = Math.round(w * 0.07);
      const chips = source.chips.slice(0, 6);
      const blockTop = st.safeTop + Math.round(h * 0.16);
      const blockBot = h - st.safeBottom - Math.round(h * 0.13);
      const rowH = Math.floor((blockBot - blockTop) / chips.length);

      chips.forEach((chip, i) => {
        const y = blockTop + i * rowH;
        const innerH = rowH - Math.round(h * 0.012);
        // Row background.
        ctx.fillStyle = hexA(cat.color, 0.05);
        roundRect(ctx, padX, y, w - padX * 2, innerH, 6);
        ctx.fill();
        // Left rule.
        ctx.fillStyle = cat.color;
        ctx.fillRect(padX, y, Math.round(w * 0.006), innerH);

        const innerX = padX + Math.round(w * 0.025);
        const midY = y + innerH / 2;

        // CN hanzi.
        const cnFs = Math.round(h * 0.038);
        drawText(ctx, chip.cn, innerX, midY,
          `700 ${cnFs}px ${FONT_CN}`, cat.color, 'left', 'middle');
        ctx.font = `700 ${cnFs}px ${FONT_CN}`;
        const cnW = ctx.measureText(chip.cn).width;

        // Pinyin to the right of CN.
        if (chip.py) {
          drawText(ctx, chip.py, innerX + cnW + Math.round(w * 0.022), midY,
            `500 ${Math.round(h * 0.020)}px ${FONT_MONO}`, theme.accent, 'left', 'middle');
        }

        // English right-aligned.
        if (chip.en) {
          drawText(ctx, truncate(chip.en, 36),
            w - padX - Math.round(w * 0.025), midY,
            `400 ${Math.round(h * 0.022)}px ${FONT_EN}`, theme.ink, 'right', 'middle');
        }
      });
      bottomStrip(ctx, w, h, st.idx, st.total, theme, st);
    },
  };
}

// Closer — clean attribution slide. Big seal, brand wordmark, single
// CTA line. No watermark glyph (it would crowd the seal).
function makeCloserSlide(source, platform) {
  return {
    id: 'closer', kind: 'closer', label: 'Read more',
    render(ctx, w, h, st) {
      const { theme } = st;
      const { cat, share } = source;
      fillBg(ctx, w, h, theme, cat);
      topBand(ctx, w, h, cat.color, Math.round(h * 0.012));
      topEyebrow(ctx, w, h,
        `${cat.label.toUpperCase()} · ${cat.glyph} ${cat.pinyin}`,
        BRAND_EN.toUpperCase(), theme, st);

      // Tight composition — brand wordmark, seal directly below, then CTA.
      // Vertically centered around the canvas midpoint so there's no
      // bottom dead air.
      const cy = h * 0.5;
      const padX = Math.round(w * 0.1);

      // Top: tiny "read more →" prompt to set up the wordmark.
      drawText(ctx, 'Read the full entry', w / 2, cy - h * 0.18,
        `400italic ${Math.round(h * 0.024)}px ${FONT_EN}`, theme.muted, 'center', 'middle');

      // Brand wordmark.
      drawText(ctx, BRAND_CN, w / 2, cy - h * 0.10,
        `700 ${Math.round(h * 0.105)}px ${FONT_CN}`, cat.color, 'center', 'middle');
      drawText(ctx, BRAND_EN, w / 2, cy - h * 0.02,
        `500 ${Math.round(h * 0.024)}px ${FONT_MONO}`, theme.muted, 'center', 'middle');

      // Seal directly under the wordmark — small but present.
      const sealCy = cy + h * 0.05;
      if (platform.theme === 'notebook') {
        ctx.strokeStyle = cat.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(w / 2, sealCy, h * 0.035, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = cat.color;
      } else {
        ctx.fillStyle = cat.color;
        ctx.beginPath();
        ctx.arc(w / 2, sealCy, h * 0.038, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = theme.bg;
      }
      ctx.font = `700 ${Math.round(h * 0.042)}px ${FONT_CN}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('屋', w / 2, sealCy + h * 0.003);

      // CTA at the bottom of the composition — authored cta wins; fall
      // back to the brand tagline (single-source via build/lib/brand.mjs).
      const ctaText = share.cta || BRAND.tagline;
      const ctaY = cy + h * 0.16;
      const ctaFs = Math.round(h * 0.028);
      const ctaLines = wrapLines(ctx, ctaText, w - padX * 2);
      ctx.font = `400 ${ctaFs}px ${FONT_EN}`;
      ctaLines.slice(0, 2).forEach((ln, i) => {
        drawText(ctx, ln, w / 2, ctaY + i * Math.round(ctaFs * 1.4),
          `400 ${ctaFs}px ${FONT_EN}`, theme.ink, 'center', 'middle');
      });

      bottomStrip(ctx, w, h, st.idx, st.total, theme, st);
    },
  };
}

// ── Render pipeline ─────────────────────────────────────────────────────
async function rebuild() {
  if (!state.source || state.rendering) return;
  state.rendering = true;
  setStatus('Rendering slides…');
  try {
    await waitForFonts();
    state.slides = buildSlides(state.source, state.platform);
    await renderAllPreviews();
    document.querySelector('[data-share-download-zip]').disabled = false;
    setStatus(`${state.slides.length} slides rendered for ${state.platform.label} (${state.platform.sub}).`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('Rendering failed. Check the console for details.', 'err');
  } finally {
    state.rendering = false;
  }
}

async function waitForFonts() {
  if (!document.fonts) return;
  await Promise.all([
    document.fonts.load(`700 80px "Noto Serif SC"`),
    document.fonts.load(`500 32px "Noto Serif SC"`),
    document.fonts.load(`400 32px "EB Garamond"`),
    document.fonts.load(`700 64px "EB Garamond"`),
    document.fonts.load(`500 24px "JetBrains Mono"`),
  ]);
  await document.fonts.ready;
}

async function renderAllPreviews() {
  const host = document.querySelector('[data-share-preview]');
  host.hidden = false;
  host.innerHTML = '';
  host.dataset.ratio = state.platform.ratio;
  const platform = state.platform;
  const { w, h } = platform;
  const baseSt = ctxState(platform);

  for (let i = 0; i < state.slides.length; i++) {
    const slide = state.slides[i];
    const card = document.createElement('article');
    card.className = 'share-slide-card';
    card.dataset.format = platform.ratio;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.className = 'share-slide-canvas';
    canvas.setAttribute('aria-label', `Slide ${i + 1}: ${slide.label}`);
    const ctx = canvas.getContext('2d');
    slide.render(ctx, w, h, { ...baseSt, idx: i, total: state.slides.length });

    const meta = document.createElement('div');
    meta.className = 'share-slide-meta';
    meta.innerHTML = `
      <span class="share-slide-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="share-slide-label">${escapeHtml(slide.label)}</span>
      <button type="button" class="share-slide-dl" data-share-slide-index="${i}">PNG</button>
    `;
    card.appendChild(canvas);
    card.appendChild(meta);
    host.appendChild(card);
  }
}

// ── Downloads ───────────────────────────────────────────────────────────
function slugForSlide(i) {
  const slide = state.slides[i];
  const sourceSlug = (state.source.sourcePath.split('/').pop() || 'entry').replace(/\.html$/, '');
  return `shuwu-${sourceSlug}-${state.platform.key}-${String(i + 1).padStart(2, '0')}-${slide.id}.png`;
}

async function canvasForSlide(i) {
  const card = document.querySelectorAll('.share-slide-card')[i];
  return card ? card.querySelector('canvas') : null;
}

async function downloadSlide(i) {
  const canvas = await canvasForSlide(i);
  if (!canvas) return;
  canvas.toBlob(blob => {
    if (!blob) return;
    triggerDownload(blob, slugForSlide(i));
  }, 'image/png');
}

async function downloadAll() {
  if (!state.slides.length) return;
  setStatus('Bundling ZIP…');
  try {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    for (let i = 0; i < state.slides.length; i++) {
      const canvas = await canvasForSlide(i);
      if (!canvas) continue;
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      if (!blob) continue;
      const buf = await blob.arrayBuffer();
      zip.file(slugForSlide(i), buf);
    }
    const out = await zip.generateAsync({ type: 'blob' });
    const sourceSlug = (state.source.sourcePath.split('/').pop() || 'entry').replace(/\.html$/, '');
    triggerDownload(out, `shuwu-${sourceSlug}-${state.platform.key}.zip`);
    setStatus('ZIP downloaded. Drop the slides into your scheduler.', 'ok');
  } catch (err) {
    console.error(err);
    setStatus('ZIP build failed. Try again.', 'err');
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

let _jszipPromise = null;
function loadJSZip() {
  if (_jszipPromise) return _jszipPromise;
  _jszipPromise = import('../../scripts/anki-apkg-browser.mjs').then(mod => mod.ensureJSZip());
  return _jszipPromise;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
