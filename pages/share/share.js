/* share.js — social-carousel exporter.
 *
 * Reads a source content page (?page=pages/<cat>/<slug>.html), parses out the
 * structured chunks (hero, scholar boxes, cards, chengyu, related chips), and
 * assembles 6–10 slides. Renders each slide directly to a 2D canvas at
 * 1080×1080 / 1080×1350 / 1080×1920. Canvas text APIs handle CJK glyphs via
 * the OS font stack, so no font embedding gymnastics are needed; we just
 * await document.fonts.ready before rasterizing.
 *
 * Bundles all PNGs into a ZIP using the project's existing JSZip dep
 * (loaded via the same browser shim used by the exports builder).
 *
 * Pure client-side, no server. Idempotent: rebuilding does not mutate state.
 */

// ── category palette (mirrors build/lib/og-svg.mjs CATEGORY_META) ─────────
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

const PAPER = '#f2e8d5';
const PAPER_2 = '#ebe0c8';
const INK = '#2c1f10';
const MUTED = '#6b5535';

/**
 * Platforms bundle a canvas size with platform-specific slide treatment.
 *
 *   ratio     visual aid for the picker (purely cosmetic).
 *   w/h       export resolution.
 *   safeTop / safeBottom   reserved insets where platform UI overlays sit
 *                          (Story/Reel handles, captions). Position-indicator
 *                          and footer brand respect these so text stays clear.
 *   indicator whether to draw the "1 / 7  swipe →" position chip on the slide.
 *   maxSlides absolute cap on slide count for that platform.
 *   slant     'visual'  → glyph-forward, less prose (IG square/portrait, XHS)
 *             'textual' → text-forward, more beats (LinkedIn document)
 *             'story'   → vertical safe insets, fewer slides, larger glyphs
 */
const PLATFORMS = [
  { key: 'ig-square',  label: 'Instagram', sub: '1:1 square',     w: 1080, h: 1080, ratio: 'square',
    safeTop: 0, safeBottom: 0, indicator: true,  maxSlides: 8, slant: 'visual'  },
  { key: 'ig-portrait',label: 'Instagram', sub: '4:5 portrait',   w: 1080, h: 1350, ratio: 'portrait',
    safeTop: 0, safeBottom: 0, indicator: true,  maxSlides: 8, slant: 'visual'  },
  { key: 'story',      label: 'Story / Reel', sub: '9:16 vertical', w: 1080, h: 1920, ratio: 'story',
    safeTop: 220, safeBottom: 320, indicator: true, maxSlides: 6, slant: 'story' },
  { key: 'xhs',        label: 'Xiaohongshu', sub: '3:4 native',   w: 1080, h: 1440, ratio: 'xhs',
    safeTop: 0, safeBottom: 0, indicator: true,  maxSlides: 9, slant: 'visual'  },
  { key: 'linkedin',   label: 'LinkedIn',    sub: '4:5 document', w: 1080, h: 1350, ratio: 'portrait',
    safeTop: 0, safeBottom: 0, indicator: true,  maxSlides: 10, slant: 'textual' },
];

const FONT_CN = '"Noto Serif SC", "PingFang SC", "Songti SC", "Hiragino Sans GB", serif';
const FONT_EN = '"EB Garamond", Georgia, "Times New Roman", serif';
const FONT_MONO = '"JetBrains Mono", "SF Mono", Menlo, monospace';

const SITE_URL = 'https://jiaoshoo.com';
const BRAND_CN = '角落書屋';
const BRAND_EN = 'Jiǎoluò Shūwū';

// ── State ───────────────────────────────────────────────────────────────
const state = {
  platform: PLATFORMS[0],
  source: null,        // { meta, hero, sections, cards, chengyu, chips, sourcePath, share }
  slides: [],          // [{ id, kind, title, render(ctx, w, h, ctxOpts) }]
  rendering: false,
};

// ── Boot ────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  renderPlatformPicker();
  bindControls();

  const params = new URLSearchParams(location.search);
  const pagePath = params.get('page');
  if (!pagePath) {
    showEmpty();
    return;
  }
  setStatus('Loading source page…');
  try {
    const source = await loadSource(pagePath);
    state.source = source;
    showSourceMeta(source);
    rebuild();
  } catch (err) {
    console.error(err);
    setStatus('Could not load that page. Check the URL and try again.', 'err');
  }
}

function showEmpty() {
  document.querySelector('[data-share-preview]').hidden = true;
  document.querySelector('.share-toolbar')?.setAttribute('hidden', '');
  document.querySelector('[data-share-empty]').hidden = false;
  document.querySelector('[data-share-status]').hidden = true;
}

// ── Platform picker ─────────────────────────────────────────────────────
function renderPlatformPicker() {
  const host = document.querySelector('[data-share-formats]');
  host.innerHTML = PLATFORMS.map(p => {
    const on = p.key === state.platform.key ? ' is-on' : '';
    return `<button type="button" class="share-format${on}" data-share-platform="${p.key}">
      <span class="share-format-ratio share-format-ratio--${p.ratio}" aria-hidden="true"></span>
      <span class="share-format-label">${p.label}</span>
      <span class="share-format-sub">${p.sub}</span>
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
  document.querySelector('[data-share-preview]').addEventListener('click', onSlideAction);
}

// ── Source loading + parsing ────────────────────────────────────────────
async function loadSource(pagePath) {
  // pagePath is like "pages/characters/gan3_感.html"; the share builder lives
  // at /pages/share/, so two levels up plus the path resolves correctly.
  const url = '../../' + pagePath;
  const res = await fetch(url);
  if (!res.ok) throw new Error('fetch failed: ' + res.status);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const meta = readMeta(html);
  const category = (meta && meta.category) || 'characters';
  const cat = CATEGORY[category] || CATEGORY.characters;

  const hero = parseHero(doc, meta);
  const sections = parseScholars(doc);
  const cards = parseCards(doc);
  const chengyu = parseChengyu(doc);
  const chips = parseChips(doc);
  const titleText = doc.querySelector('title')?.textContent || '';

  // Authored carousel overrides — when present, use them instead of
  // auto-extracted prose so the post reads like an actual hook → payoff.
  // Schema: { hook?: string, beats?: string[], cta?: string }
  const share = (meta && meta.share) || {};

  return {
    sourcePath: pagePath,
    sourceTitle: titleText.split(' — ')[0].trim(),
    meta, category, cat, share,
    hero, sections, cards, chengyu, chips,
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
    const glyph = meta.char || textOf(doc.querySelector('.hero-glyph-fallback')) || '';
    const pinyin = textOf(doc.querySelector('.hero-pinyin'))
      .replace(/[A-Za-z]+$/, '').replace(/^[\s·]+|[\s·]+$/g, '').trim() || meta.pinyin || '';
    const en = textOf(doc.querySelector('.hero-en'));
    return { kind: 'character', glyph, pinyin, en };
  }
  const cn = textOf(doc.querySelector('.today-hero-title-cn, .topic-hero-title'))
    .split('\n')[0];
  // For topic pages built with the multi-span title, prefer .today-hero-title-cn.
  const cnSpan = doc.querySelector('.today-hero-title-cn');
  const cn2 = cnSpan ? textOf(cnSpan) : cn;
  const py = textOf(doc.querySelector('.today-hero-title-py, .topic-hero-title-py'));
  const en = textOf(doc.querySelector('.today-hero-title-en, .topic-hero-en'));
  const desc = textOf(doc.querySelector('.topic-hero-desc'));
  return { kind: 'topic', glyph: cn2, pinyin: py, en, desc };
}

function parseScholars(doc) {
  // .scholar boxes — each has a label + paragraphs. Take the first 3 with
  // meaningful prose so we don't end up with attribution stubs.
  const out = [];
  doc.querySelectorAll('.scholar').forEach(el => {
    const label = textOf(el.querySelector('.scholar-label'));
    const paragraphs = Array.from(el.querySelectorAll('p')).map(p => textOf(p)).filter(Boolean);
    const body = paragraphs.join(' ');
    if (body.length < 40) return;     // skip tiny stubs / mantra labels
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
  titleEl.textContent = source.sourceTitle || source.sourcePath;
  linkEl.href = '../../' + source.sourcePath;
  linkEl.hidden = false;
  if (modeEl) {
    const authored = !!(source.share && (source.share.hook || (source.share.beats && source.share.beats.length)));
    modeEl.textContent = authored ? 'authored hook + beats' : 'auto-extracted';
    modeEl.dataset.kind = authored ? 'authored' : 'auto';
  }
}

// ── Slide assembly ──────────────────────────────────────────────────────
//
// Slide order follows the "hook → payoff → CTA" arc that performs on
// carousel platforms, not the reading-order of the source page. When the
// author supplies share.hook + share.beats, they take precedence over
// auto-extracted etymology and card prose. Auto-mode still produces a
// usable carousel for every page, but authored entries read sharper.
//
// Platform "slant" tunes content density:
//   visual   : more visual slides, fewer prose beats (IG, XHS)
//   textual  : more beats slides, prose carries more weight (LinkedIn)
//   story    : fewer slides, larger glyphs, vertical safe insets respected
function buildSlides(source, platform) {
  const slant = platform.slant;
  const slides = [];
  const hasAuthoredHook = !!(source.share && source.share.hook);

  // 1. Opener — either an authored hook or a glyph-forward title.
  slides.push(hasAuthoredHook
    ? makeHookSlide(source)
    : makeTitleSlide(source));

  // 2. Payoff beats — authored when present, otherwise the etymology /
  //    overview prose synthesized from the first scholar box.
  const beats = collectBeats(source, slant);
  beats.forEach((beat, i) => {
    slides.push(makeBeatSlide(source, beat, i + 1, beats.length));
  });

  // 3. Concrete examples — vocab cards and chengyu both ride on the same
  //    visual treatment. Story slant takes fewer; textual takes more.
  const exampleBudget = slant === 'story'   ? 2
                      : slant === 'textual' ? 4
                      : 3;
  let exampleCount = 0;
  const exampleCards = source.cards.slice(0, exampleBudget);
  exampleCards.forEach((c, i) => {
    slides.push(makeCardSlide(source, c, i + 1, exampleCards.length));
    exampleCount++;
  });
  if (exampleCount < exampleBudget) {
    const remaining = exampleBudget - exampleCount;
    source.chengyu.slice(0, remaining).forEach((cy, i) => {
      slides.push(makeChengyuSlide(source, cy, i + 1, Math.min(source.chengyu.length, remaining)));
    });
  }

  // 4. Related chips slide — only when the page has a meaningful field.
  //    Story slant skips this (vertical real estate at a premium).
  if (slant !== 'story' && source.chips.length >= 3) {
    slides.push(makeChipsSlide(source));
  }

  // 5. CTA / attribution always closes.
  slides.push(makeAttributionSlide(source));

  return slides.slice(0, platform.maxSlides);
}

/**
 * Collect 1–4 payoff "beats" — one short statement per slide.
 * Priority:
 *   1. Authored share.beats   (curated, best)
 *   2. Etymology / overview paragraphs from the first scholar box
 *   3. The page's hero gloss as a single beat
 */
function collectBeats(source, slant) {
  const authored = source.share && Array.isArray(source.share.beats) ? source.share.beats : null;
  if (authored && authored.length) {
    const cap = slant === 'story' ? 2 : slant === 'textual' ? 4 : 3;
    return authored.slice(0, cap).map(text => ({ kind: 'authored', text }));
  }

  const out = [];
  const first = source.sections[0];
  if (first && first.body) {
    // Split the first scholar paragraph into sentence-ish beats so the
    // slide doesn't dump 600 chars at once. Keep beats short enough to
    // wrap cleanly at 36pt body type.
    const sentences = splitSentences(first.body).filter(s => s.length >= 30 && s.length <= 240);
    const cap = slant === 'story' ? 2 : slant === 'textual' ? 4 : 3;
    sentences.slice(0, cap).forEach(s => out.push({ kind: 'derived', text: s, label: first.label }));
  }

  if (out.length === 0 && source.hero && source.hero.en) {
    out.push({ kind: 'derived', text: source.hero.en });
  }
  return out;
}

function splitSentences(text) {
  // Handle both English (. ! ?) and Chinese (。!?) sentence boundaries.
  // Keep the terminator on the preceding sentence so the slide doesn't
  // end on a comma fragment.
  return text
    .split(/(?<=[.!?。！？])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ── Canvas drawing helpers ──────────────────────────────────────────────
function drawBackground(ctx, w, h, cat) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  // Subtle radial vignette in the category color, anchored at the top.
  const grad = ctx.createRadialGradient(w / 2, 0, 0, w / 2, 0, h * 0.85);
  grad.addColorStop(0, hexWithAlpha(cat.color, 0.07));
  grad.addColorStop(1, hexWithAlpha(PAPER, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // Top accent band.
  ctx.fillStyle = cat.color;
  ctx.fillRect(0, 0, w, Math.round(h * 0.008));
}

function drawWatermark(ctx, w, h, glyph, color) {
  const size = Math.round(h * 0.6);
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px ${FONT_CN}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, w - Math.round(w * 0.04), h * 0.4);
  ctx.restore();
}

function drawEyebrow(ctx, w, h, leftText, rightText, opts) {
  const fs = Math.round(h * 0.018);
  const safeTop = (opts && opts.safeTop) || 0;
  const yPad = safeTop + Math.round(h * 0.05);
  ctx.fillStyle = MUTED;
  ctx.font = `500 ${fs}px ${FONT_MONO}`;
  ctx.textBaseline = 'middle';
  if (leftText) {
    ctx.textAlign = 'left';
    ctx.fillText(leftText, Math.round(w * 0.07), yPad);
  }
  if (rightText) {
    ctx.textAlign = 'right';
    ctx.fillText(rightText, w - Math.round(w * 0.07), yPad);
  }
}

function drawFooterBrand(ctx, w, h, opts) {
  const fs = Math.round(h * 0.017);
  const safeBottom = (opts && opts.safeBottom) || 0;
  const y = h - safeBottom - Math.round(h * 0.045);
  ctx.fillStyle = MUTED;
  ctx.font = `500 ${fs}px ${FONT_CN}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(BRAND_CN, w - Math.round(w * 0.07), y);

  ctx.font = `500 ${Math.round(h * 0.014)}px ${FONT_MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText('jiaoshoo.com', Math.round(w * 0.07), y);
}

/**
 * Position chip drawn at the bottom-center of each slide (above the
 * platform-safe footer brand). Tells the reader where they are in the
 * deck and what to do next:
 *   non-final → "1 / 7   swipe →"
 *   final     → "↓ save this"
 * Skipped on platforms where `indicator: false` (none currently, but the
 * hook lives in the platform config for future single-image modes).
 */
function drawSlideIndicator(ctx, w, h, idx, total, opts) {
  if (!opts || !opts.indicator) return;
  const safeBottom = (opts.safeBottom) || 0;
  const y = h - safeBottom - Math.round(h * 0.085);
  const isFinal = idx === total - 1;
  const text = isFinal
    ? '↓ save this'
    : `${idx + 1} / ${total}   swipe →`;
  ctx.fillStyle = isFinal ? '#a06428' : MUTED;
  ctx.font = `500 ${Math.round(h * 0.016)}px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, y);
}

function drawCenteredText(ctx, text, x, y, font, color, align = 'center') {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function wrapLines(ctx, text, maxWidth) {
  // Word-wrap that handles CJK by breaking on any character boundary when
  // a "word" would overflow on its own. ASCII tokens stay intact.
  const tokens = tokenize(text);
  const lines = [];
  let current = '';
  for (const tok of tokens) {
    const next = current ? current + tok : tok;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      // If the single token still overflows (long ASCII word), hard-break it.
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

function tokenize(text) {
  // Split into ASCII words (with trailing space) and individual CJK chars.
  // Punctuation sticks to whatever it follows.
  const out = [];
  let buf = '';
  let mode = 'none';   // 'ascii' | 'cjk' | 'space'
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
      if (mode === 'cjk') {
        // Punctuation following CJK: stick to previous char.
        if (out.length && /[.,;:!?…]/.test(ch)) {
          out[out.length - 1] += ch;
          continue;
        }
      }
      buf += ch;
      mode = 'ascii';
    }
  }
  if (buf) out.push(buf);
  return out;
}

function drawWrapped(ctx, text, x, y, maxWidth, lineHeight, font, color, align = 'left') {
  ctx.font = font;
  const lines = wrapLines(ctx, text, maxWidth);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  let cy = y;
  for (const line of lines) {
    ctx.fillText(line, x, cy);
    cy += lineHeight;
  }
  return cy;
}

function hexWithAlpha(hex, a) {
  const m = hex.replace('#', '');
  const n = parseInt(m, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

// ── Slide makers ────────────────────────────────────────────────────────
//
// Hook slide — used when share.hook is authored. Glyph drops to a quiet
// background watermark; the question/claim takes the foreground. This is
// the single most important slide for swipe-through on social.
function makeHookSlide(source) {
  return {
    id: 'hook',
    kind: 'hook',
    label: 'Hook',
    render(ctx, w, h, ctxOpts) {
      const { cat, hero, share } = source;
      drawBackground(ctx, w, h, cat);
      drawWatermark(ctx, w, h, hero.glyph || cat.glyph, cat.color);
      drawEyebrow(ctx, w, h,
        `${cat.label.toUpperCase()} · ${cat.glyph} ${cat.pinyin}`,
        BRAND_EN.toUpperCase(), ctxOpts);

      const padX = Math.round(w * 0.085);
      const top = (ctxOpts.safeTop || 0) + Math.round(h * 0.18);
      const maxW = w - padX * 2;
      // Hook copy size scales with how much there is — a tight 8-word hook
      // can go large; a 30-word setup needs to step down so it doesn't
      // wrap into a wall.
      const len = share.hook.length;
      const baseFs = len < 70  ? Math.round(h * 0.062)
                   : len < 130 ? Math.round(h * 0.05)
                   :             Math.round(h * 0.04);
      const lh = Math.round(baseFs * 1.22);
      drawWrapped(ctx, share.hook, padX, top, maxW, lh,
        `700 ${baseFs}px ${FONT_EN}`, INK, 'left');

      // Quiet eyebrow tag below the hook so it reads as "this is a hook,
      // there's more if you swipe".
      ctx.font = `500 ${Math.round(h * 0.018)}px ${FONT_MONO}`;
      ctx.fillStyle = cat.color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('a thread on ' + (hero.glyph || cat.glyph), padX, h - (ctxOpts.safeBottom || 0) - Math.round(h * 0.11));

      drawFooterBrand(ctx, w, h, ctxOpts);
    },
  };
}

// Beat slide — one payoff statement per slide. Either an authored
// share.beats[i] or a derived sentence from the etymology paragraph.
function makeBeatSlide(source, beat, idx, total) {
  return {
    id: 'beat-' + idx,
    kind: 'beat',
    label: `Beat ${idx}/${total}`,
    render(ctx, w, h, ctxOpts) {
      const { cat, hero } = source;
      drawBackground(ctx, w, h, cat);
      drawWatermark(ctx, w, h, hero.glyph || cat.glyph, cat.color);
      drawEyebrow(ctx, w, h,
        beat.label ? beat.label.toUpperCase() : `${idx} OF ${total}`,
        BRAND_EN.toUpperCase(), ctxOpts);

      const padX = Math.round(w * 0.085);
      const top = (ctxOpts.safeTop || 0) + Math.round(h * 0.22);
      const maxW = w - padX * 2;
      const len = beat.text.length;
      const baseFs = len < 90  ? Math.round(h * 0.046)
                   : len < 180 ? Math.round(h * 0.038)
                   :             Math.round(h * 0.032);
      const lh = Math.round(baseFs * 1.4);
      drawWrapped(ctx, beat.text, padX, top, maxW, lh,
        `400 ${baseFs}px ${FONT_EN}`, INK, 'left');

      // Small accent rule under the eyebrow so beats feel like a series.
      ctx.fillStyle = cat.color;
      ctx.fillRect(padX, top - Math.round(h * 0.04), Math.round(w * 0.08), 2);

      drawFooterBrand(ctx, w, h, ctxOpts);
    },
  };
}

function makeTitleSlide(source) {
  return {
    id: 'title',
    kind: 'title',
    label: 'Title',
    render(ctx, w, h, ctxOpts) {
      const { cat, hero, category } = source;
      drawBackground(ctx, w, h, cat);
      drawWatermark(ctx, w, h, cat.glyph, cat.color);
      drawEyebrow(ctx, w, h,
        `${cat.label.toUpperCase()} · ${cat.glyph} ${cat.pinyin}`,
        BRAND_EN.toUpperCase());

      const cy = h * 0.5;
      const glyph = hero.glyph || cat.glyph;
      const len = [...glyph].length;
      const glyphSize = len === 1 ? Math.round(h * 0.36)
                       : len === 2 ? Math.round(h * 0.24)
                       : len === 3 ? Math.round(h * 0.18)
                       : len === 4 ? Math.round(h * 0.15)
                       : Math.max(Math.round(h * 0.08), Math.round(h * 0.15) - (len - 4) * Math.round(h * 0.012));
      drawCenteredText(ctx, glyph, w / 2, cy - h * 0.06,
        `700 ${glyphSize}px ${FONT_CN}`, cat.color);

      if (hero.pinyin) {
        drawCenteredText(ctx, hero.pinyin, w / 2, cy + h * 0.13,
          `500 ${Math.round(h * 0.038)}px ${FONT_MONO}`, '#a06428');
      }
      if (hero.en) {
        const maxW = w * 0.78;
        ctx.font = `400 ${Math.round(h * 0.028)}px ${FONT_EN}`;
        const lines = wrapLines(ctx, hero.en, maxW);
        const lh = Math.round(h * 0.035);
        const startY = cy + h * 0.19;
        lines.slice(0, 2).forEach((ln, i) => {
          drawCenteredText(ctx, ln, w / 2, startY + i * lh,
            `400 ${Math.round(h * 0.028)}px ${FONT_EN}`, INK);
        });
      }
      drawFooterBrand(ctx, w, h, ctxOpts);
    },
  };
}

function makeProseSlide(source, en, eyebrow, section) {
  return {
    id: 'prose-' + en.toLowerCase(),
    kind: 'prose',
    label: en,
    render(ctx, w, h, ctxOpts) {
      const { cat } = source;
      drawBackground(ctx, w, h, cat);
      const watermark = section.glyph || source.hero.glyph || cat.glyph;
      drawWatermark(ctx, w, h, watermark, cat.color);
      drawEyebrow(ctx, w, h, eyebrow.toUpperCase(), BRAND_EN.toUpperCase());

      const padX = Math.round(w * 0.085);
      let y = Math.round(h * 0.16);

      if (section.label) {
        drawCenteredText(ctx, section.label, w / 2, y,
          `500 ${Math.round(h * 0.022)}px ${FONT_MONO}`, cat.color);
        y += Math.round(h * 0.04);
      }

      // Title line.
      drawCenteredText(ctx, en, w / 2, y,
        `700 ${Math.round(h * 0.038)}px ${FONT_EN}`, INK);
      y += Math.round(h * 0.06);

      // Body paragraph.
      const fs = Math.round(h * 0.024);
      const lh = Math.round(fs * 1.55);
      ctx.font = `400 ${fs}px ${FONT_EN}`;
      const maxW = w - padX * 2;
      const truncated = truncateForLines(ctx, section.body, maxW, Math.floor((h * 0.6) / lh));
      drawWrapped(ctx, truncated, padX, y, maxW, lh,
        `400 ${fs}px ${FONT_EN}`, INK, 'left');

      drawFooterBrand(ctx, w, h, ctxOpts);
    },
  };
}

function makeCardSlide(source, card, idx, total) {
  return {
    id: 'card-' + idx,
    kind: 'card',
    label: `Card ${idx}/${total}`,
    render(ctx, w, h, ctxOpts) {
      const { cat } = source;
      drawBackground(ctx, w, h, cat);
      drawWatermark(ctx, w, h, card.cn[0] || cat.glyph, cat.color);
      drawEyebrow(ctx, w, h,
        `VOCAB · ${idx}/${total}`,
        BRAND_EN.toUpperCase());

      const padX = Math.round(w * 0.085);
      let y = Math.round(h * 0.22);

      // Hanzi title.
      const hanziSize = card.cn.length <= 2 ? Math.round(h * 0.16)
                       : card.cn.length <= 4 ? Math.round(h * 0.11)
                       : Math.round(h * 0.085);
      drawCenteredText(ctx, card.cn, w / 2, y,
        `700 ${hanziSize}px ${FONT_CN}`, cat.color);
      y += Math.round(hanziSize * 0.85);

      if (card.py) {
        drawCenteredText(ctx, card.py, w / 2, y,
          `500 ${Math.round(h * 0.03)}px ${FONT_MONO}`, '#a06428');
        y += Math.round(h * 0.05);
      }

      if (card.en) {
        const fs = Math.round(h * 0.026);
        ctx.font = `400 ${fs}px ${FONT_EN}`;
        const lines = wrapLines(ctx, card.en, w - padX * 2);
        lines.slice(0, 2).forEach((ln, i) => {
          drawCenteredText(ctx, ln, w / 2, y + i * Math.round(fs * 1.4),
            `400 ${fs}px ${FONT_EN}`, INK);
        });
        y += Math.min(2, lines.length) * Math.round(fs * 1.4) + Math.round(h * 0.025);
      }

      // Example block (if room).
      if (card.example && card.example.cn) {
        const blockY = Math.round(h * 0.62);
        const blockH = Math.round(h * 0.28);
        ctx.fillStyle = PAPER_2;
        roundRect(ctx, padX, blockY, w - padX * 2, blockH, Math.round(h * 0.018));
        ctx.fill();

        let ey = blockY + Math.round(h * 0.04);
        const exMax = w - padX * 2 - Math.round(w * 0.06);
        const cnFs = Math.round(h * 0.024);
        ctx.font = `500 ${cnFs}px ${FONT_CN}`;
        const cnLines = wrapLines(ctx, card.example.cn, exMax);
        cnLines.slice(0, 2).forEach((ln, i) => {
          drawCenteredText(ctx, ln, w / 2, ey + i * Math.round(cnFs * 1.4),
            `500 ${cnFs}px ${FONT_CN}`, INK);
        });
        ey += Math.min(2, cnLines.length) * Math.round(cnFs * 1.4) + Math.round(h * 0.018);

        if (card.example.en) {
          const enFs = Math.round(h * 0.018);
          ctx.font = `400italic ${enFs}px ${FONT_EN}`;
          const enLines = wrapLines(ctx, card.example.en, exMax);
          enLines.slice(0, 2).forEach((ln, i) => {
            drawCenteredText(ctx, ln, w / 2, ey + i * Math.round(enFs * 1.4),
              `400italic ${enFs}px ${FONT_EN}`, MUTED);
          });
        }
      }

      drawFooterBrand(ctx, w, h, ctxOpts);
    },
  };
}

function makeChengyuSlide(source, cy, idx, total) {
  return {
    id: 'cy-' + idx,
    kind: 'chengyu',
    label: `Chengyu ${idx}/${total}`,
    render(ctx, w, h, ctxOpts) {
      const { cat } = source;
      drawBackground(ctx, w, h, cat);
      drawWatermark(ctx, w, h, '语', cat.color);
      drawEyebrow(ctx, w, h, `CHENGYU · ${idx}/${total}`, BRAND_EN.toUpperCase());

      const padX = Math.round(w * 0.085);
      let y = Math.round(h * 0.26);

      // Four-char display, drawn character-by-character so it always reads
      // as a clean four-square regardless of how the source styled it.
      const chars = [...cy.cn].slice(0, 4);
      const cellSize = Math.round((w - padX * 2) / 4.5);
      const totalW = cellSize * chars.length + (chars.length - 1) * Math.round(w * 0.02);
      let cx = (w - totalW) / 2;
      ctx.fillStyle = cat.color;
      ctx.font = `700 ${Math.round(cellSize * 0.85)}px ${FONT_CN}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      chars.forEach(ch => {
        ctx.fillText(ch, cx + cellSize / 2, y + cellSize / 2);
        cx += cellSize + Math.round(w * 0.02);
      });
      y += cellSize + Math.round(h * 0.04);

      if (cy.py) {
        drawCenteredText(ctx, cy.py, w / 2, y,
          `500 ${Math.round(h * 0.026)}px ${FONT_MONO}`, '#a06428');
        y += Math.round(h * 0.045);
      }
      if (cy.lit) {
        drawCenteredText(ctx, '"' + cy.lit + '"', w / 2, y,
          `400italic ${Math.round(h * 0.022)}px ${FONT_EN}`, MUTED);
        y += Math.round(h * 0.04);
      }
      if (cy.en) {
        const fs = Math.round(h * 0.024);
        ctx.font = `400 ${fs}px ${FONT_EN}`;
        const lines = wrapLines(ctx, cy.en, w - padX * 2);
        lines.slice(0, 3).forEach((ln, i) => {
          drawCenteredText(ctx, ln, w / 2, y + i * Math.round(fs * 1.4),
            `400 ${fs}px ${FONT_EN}`, INK);
        });
      }

      drawFooterBrand(ctx, w, h, ctxOpts);
    },
  };
}

function makeChipsSlide(source) {
  return {
    id: 'related',
    kind: 'related',
    label: 'Related',
    render(ctx, w, h, ctxOpts) {
      const { cat } = source;
      drawBackground(ctx, w, h, cat);
      drawWatermark(ctx, w, h, '词', cat.color);
      drawEyebrow(ctx, w, h, '词族 · CÍZÚ · RELATED', BRAND_EN.toUpperCase());

      drawCenteredText(ctx, 'Vocabulary in this field', w / 2, Math.round(h * 0.16),
        `500 ${Math.round(h * 0.028)}px ${FONT_EN}`, INK);

      const padX = Math.round(w * 0.09);
      const chips = source.chips.slice(0, 6);
      const startY = Math.round(h * 0.26);
      const rowH = Math.round(h * 0.105);

      chips.forEach((chip, i) => {
        const y = startY + i * rowH;
        // Card row.
        ctx.fillStyle = PAPER_2;
        roundRect(ctx, padX, y, w - padX * 2, rowH - Math.round(h * 0.015), Math.round(h * 0.012));
        ctx.fill();
        // Left color band.
        ctx.fillStyle = cat.color;
        ctx.fillRect(padX, y, Math.round(w * 0.008), rowH - Math.round(h * 0.015));

        const innerX = padX + Math.round(w * 0.025);
        const midY = y + (rowH - Math.round(h * 0.015)) / 2;

        ctx.fillStyle = cat.color;
        ctx.font = `700 ${Math.round(h * 0.035)}px ${FONT_CN}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(chip.cn, innerX, midY);

        const cnW = ctx.measureText(chip.cn).width;
        ctx.fillStyle = '#a06428';
        ctx.font = `500 ${Math.round(h * 0.020)}px ${FONT_MONO}`;
        ctx.fillText(chip.py || '', innerX + cnW + Math.round(w * 0.02), midY);

        if (chip.en) {
          ctx.fillStyle = INK;
          ctx.font = `400 ${Math.round(h * 0.022)}px ${FONT_EN}`;
          ctx.textAlign = 'right';
          const enText = truncate(chip.en, 38);
          ctx.fillText(enText, w - padX - Math.round(w * 0.025), midY);
        }
      });

      drawFooterBrand(ctx, w, h, ctxOpts);
    },
  };
}

function makeAttributionSlide(source) {
  return {
    id: 'attribution',
    kind: 'attribution',
    label: 'Read more',
    render(ctx, w, h, ctxOpts) {
      const { cat, hero } = source;
      drawBackground(ctx, w, h, cat);
      drawWatermark(ctx, w, h, cat.glyph, cat.color);
      drawEyebrow(ctx, w, h,
        `${cat.label.toUpperCase()} · ${cat.glyph} ${cat.pinyin}`,
        BRAND_EN.toUpperCase());

      const cy = h * 0.42;
      drawCenteredText(ctx, BRAND_CN, w / 2, cy - h * 0.06,
        `700 ${Math.round(h * 0.085)}px ${FONT_CN}`, cat.color);
      drawCenteredText(ctx, BRAND_EN, w / 2, cy + h * 0.005,
        `500 ${Math.round(h * 0.025)}px ${FONT_MONO}`, MUTED);

      drawCenteredText(ctx, 'Read the full entry', w / 2, cy + h * 0.09,
        `400 ${Math.round(h * 0.028)}px ${FONT_EN}`, INK);

      // URL line. Truncate sensibly for stories where the path could overflow.
      const urlLine = 'jiaoshoo.com/' + source.sourcePath;
      const padX = Math.round(w * 0.07);
      ctx.font = `500 ${Math.round(h * 0.02)}px ${FONT_MONO}`;
      const urlText = truncateToWidth(ctx, urlLine, w - padX * 2);
      drawCenteredText(ctx, urlText, w / 2, cy + h * 0.14,
        `500 ${Math.round(h * 0.02)}px ${FONT_MONO}`, '#a06428');

      // Decorative seal-like stamp using the category glyph.
      const sealCy = cy + h * 0.24;
      ctx.save();
      ctx.fillStyle = cat.color;
      ctx.beginPath();
      ctx.arc(w / 2, sealCy, h * 0.04, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PAPER;
      ctx.font = `700 ${Math.round(h * 0.045)}px ${FONT_CN}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('屋', w / 2, sealCy + h * 0.002);
      ctx.restore();

      drawFooterBrand(ctx, w, h, ctxOpts);
    },
  };
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

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
}

function truncateToWidth(ctx, s, maxWidth) {
  if (ctx.measureText(s).width <= maxWidth) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(s.slice(0, mid) + '…').width <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return s.slice(0, lo).trim() + '…';
}

function truncateForLines(ctx, text, maxWidth, maxLines) {
  const lines = wrapLines(ctx, text, maxWidth);
  if (lines.length <= maxLines) return text;
  const kept = lines.slice(0, maxLines).join('');
  return truncate(kept, kept.length - 1) + '…';
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
    setStatus(`${state.slides.length} slides rendered. Download all or grab one at a time.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('Rendering failed. Check the console for details.', 'err');
  } finally {
    state.rendering = false;
  }
}

async function waitForFonts() {
  if (!document.fonts) return;
  // Touch the fonts we plan to use so the browser commits to loading them.
  await Promise.all([
    document.fonts.load(`700 80px "Noto Serif SC"`),
    document.fonts.load(`500 32px "Noto Serif SC"`),
    document.fonts.load(`400 32px "EB Garamond"`),
    document.fonts.load(`500 24px "JetBrains Mono"`),
  ]);
  await document.fonts.ready;
}

async function renderAllPreviews() {
  const host = document.querySelector('[data-share-preview]');
  host.hidden = false;
  host.innerHTML = '';
  const platform = state.platform;
  const { w, h } = platform;
  const ctxOpts = {
    safeTop: platform.safeTop,
    safeBottom: platform.safeBottom,
    indicator: platform.indicator,
    platform: platform.key,
  };

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
    slide.render(ctx, w, h, ctxOpts);
    // Position indicator drawn AFTER the slide body so it sits on top of
    // any background watermark and isn't overwritten by slide content.
    drawSlideIndicator(ctx, w, h, i, state.slides.length, ctxOpts);

    const meta = document.createElement('div');
    meta.className = 'share-slide-meta';
    meta.innerHTML = `
      <span class="share-slide-num">Slide ${i + 1}</span>
      <span class="share-slide-label">${escapeHtml(slide.label)}</span>
      <button type="button" class="share-slide-dl" data-share-slide-index="${i}">Download PNG</button>
    `;

    card.appendChild(canvas);
    card.appendChild(meta);
    host.appendChild(card);
  }
}

function onSlideAction(e) {
  const btn = e.target.closest('[data-share-slide-index]');
  if (!btn) return;
  const i = parseInt(btn.dataset.shareSlideIndex, 10);
  downloadSlide(i);
}

function setStatus(msg, kind) {
  const el = document.querySelector('[data-share-status]');
  el.hidden = false;
  el.textContent = msg;
  el.dataset.kind = kind || '';
}

// ── Downloads ───────────────────────────────────────────────────────────
function slugForSlide(i) {
  const slide = state.slides[i];
  const fmt = state.platform.key;
  const sourceSlug = (state.source.sourcePath.split('/').pop() || 'entry').replace(/\.html$/, '');
  return `shuwu-${sourceSlug}-${fmt}-${String(i + 1).padStart(2, '0')}-${slide.id}.png`;
}

async function canvasForSlide(i) {
  const card = document.querySelectorAll('.share-slide-card')[i];
  if (!card) return null;
  return card.querySelector('canvas');
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
  // The exports builder loads JSZip via the same browser shim. Reuse it so
  // we don't double-fetch the library when both pages are open.
  _jszipPromise = import('../../scripts/anki-apkg-browser.mjs').then(mod => mod.ensureJSZip());
  return _jszipPromise;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
