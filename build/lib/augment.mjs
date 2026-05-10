/**
 * Page-body augmentations applied at build time:
 *   - injectStrokeOrder: adds a Hanzi Writer mount point on character pages
 *   - autoLinkBody: links the first occurrence of other entries' chars/titles
 *   - addPinyinAudio: wraps pinyin spans with an audio trigger
 */

const HZ_RE = /[\u4e00-\u9fff]/;


/**
 * Render a small Sources block from frontmatter. Merges fm.sources (general page
 * sources) with fm.content_sources (sources consulted for content review).
 * Returns HTML block or empty string.
 */
export function renderSourcesHtml(fm) {
  const general = Array.isArray(fm.sources) ? fm.sources : [];
  const factual = Array.isArray(fm.content_sources) ? fm.content_sources : [];
  if (general.length === 0 && factual.length === 0) return '';
  // Render as a single list; factual-specific sources get a subtle prefix.
  const seen = new Set();
  const items = [];
  for (const s of general) {
    const k = String(s).trim();
    if (seen.has(k) || !k) continue;
    seen.add(k);
    items.push(`<li>${escapeHtmlInline(k)}</li>`);
  }
  for (const s of factual) {
    const k = String(s).trim();
    if (seen.has(k) || !k) continue;
    seen.add(k);
    items.push(`<li>${escapeHtmlInline(k)}</li>`);
  }
  return `
    <aside class="sources" aria-label="Sources">
      <span class="sources-label">Sources</span>
      <ul class="sources-list">
        ${items.join('\n        ')}
      </ul>
    </aside>`;
}

function escapeHtmlInline(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Inject the full unified footer before </main>.
 * Removes any authored <footer class="page-footer">…</footer> stub first
 * (back-compat while content is being swept), then appends the canonical footer.
 */
export function buildPageFooter(body, fm, slug, category) {
  const corrTitle = encodeURIComponent(`Correction: ${category}/${slug}`);
  const corrBody = encodeURIComponent(
    `Page: pages/${category}/${slug}.html\n\n` +
    `Describe the correction (quote the exact sentence or claim):\n\n`
  );
  const corrUrl = `https://github.com/HunterDellere/jiaoluo-shuwu/issues/new?title=${corrTitle}&body=${corrBody}&labels=correction`;
  const reqTitle = encodeURIComponent('Request: ');
  const reqUrl = `https://github.com/HunterDellere/jiaoluo-shuwu/issues/new?template=content-request.yml&title=${reqTitle}`;

  const idLabel = fm.char
    ? `${fm.char} ${fm.pinyin || ''} · ${slug}`
    : (fm.title ? `${fm.title.split('·')[0].trim()} · ${slug}` : slug);

  const footer = `<footer class="page-footer">
      <div class="page-footer-actions">
        <div class="page-footer-buttons">
          <a class="pf-btn pf-btn-donate" href="https://ko-fi.com/hdellere" target="_blank" rel="noopener" aria-label="Donate — buy me a tea">Pour me a cup of <span class="pf-btn-cn-inline">茶</span></a>
          <button type="button" class="pf-btn pf-btn-share" data-share aria-label="Share this page">
            <svg class="pf-btn-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            <span data-share-label>Share</span>
          </button>
        </div>
        <div class="page-footer-links">
          <a href="${corrUrl}" class="pf-link" target="_blank" rel="noopener noreferrer">Corrections</a>
          <a href="${reqUrl}" class="pf-link" target="_blank" rel="noopener noreferrer">Request an entry</a>
          <a href="../../feed.xml" class="pf-link" rel="alternate" type="application/rss+xml">RSS</a>
        </div>
      </div>
      <div class="page-footer-row">
        <span class="footer-id">角落書屋 · Jiǎoluò Shūwū · <span>${idLabel}</span></span>
        <a href="../../index.html" class="footer-back">← All entries</a>
      </div>
    </footer>`;

  // Remove any authored footer stub
  body = body.replace(/[ \t]*<!--\s*FOOTER\s*-->\s*\n?/g, '');
  body = body.replace(/<footer class="page-footer">[\s\S]*?<\/footer>\s*/g, '');

  // Inject before closing </main>
  return body.replace('</main>', `\n    ${footer}\n  </main>`);
}

/**
 * Ensure <main class="main"> carries id="main-content" so the layout's
 * skip-link (<a class="skip-link" href="#main-content">) resolves. Idempotent:
 * pages that already author the id are left alone.
 */
export function ensureMainContentId(body) {
  if (/\bid="main-content"/.test(body)) return body;
  return body.replace('<main class="main">', '<main class="main" id="main-content">');
}

export function injectStrokeOrder(body, fm) {
  if (fm.type !== 'character' || !fm.char) return body;
  if (!body.includes('</header>')) {
    throw new Error(`injectStrokeOrder: character page "${fm.char}" has no </header> — the .hero block is required on character pages.`);
  }

  // Color legend.
  //
  // Hanzi Writer splits a character's strokes into two groups: those that
  // form the radical (painted in radicalColor / ochre) and those that
  // don't (painted in strokeColor / cinnabar). When the radical IS the
  // whole character (心, 水, 木, 日, …), every stroke is painted in the
  // radical color and the visual split disappears. We surface that
  // distinction honestly:
  //   - distinct radical → show "radical" + "component" entries
  //   - whole-character radical → show one combined "radical (whole char)"
  //
  // The teal "your drawing" entry only matters in quiz mode but is always
  // shown so readers aren't surprised by a new color when they try it.
  const hasDistinctRadical = fm.radical && fm.radical !== fm.char;

  const splitLegend = hasDistinctRadical
    ? `<span class="so-legend-item"><span class="so-swatch so-swatch--radical" aria-hidden="true"></span><span class="so-legend-cn">部首</span> <span class="so-legend-en">radical (${escapeAttr(fm.radical)})</span></span>
          <span class="so-legend-item"><span class="so-swatch so-swatch--stroke" aria-hidden="true"></span><span class="so-legend-cn">部件</span> <span class="so-legend-en">component (rest of character)</span></span>`
    : `<span class="so-legend-item"><span class="so-swatch so-swatch--radical" aria-hidden="true"></span><span class="so-legend-cn">部首</span> <span class="so-legend-en">radical (whole character)</span></span>`;

  const legend = `
        <div class="so-legend" aria-label="Stroke colour legend">
          ${splitLegend}
          <span class="so-legend-item so-legend-item--quiz"><span class="so-swatch so-swatch--drawing" aria-hidden="true"></span><span class="so-legend-cn">书写</span> <span class="so-legend-en">your drawing</span></span>
        </div>`;

  const block = `
    <!-- STROKE ORDER -->
    <section class="stroke-order" aria-label="Stroke order animation">
      <div class="so-head">
        <span class="so-label">笔顺 bǐshùn · Stroke order</span>
        <div class="so-controls">
          <button type="button" class="so-btn" data-so-action="play" aria-label="Play stroke animation">▶ Play</button>
          <button type="button" class="so-btn" data-so-action="step" aria-label="Step through strokes">Step</button>
          <button type="button" class="so-btn" data-so-action="quiz" aria-label="Try drawing the character">✎ Try drawing</button>
          <button type="button" class="so-btn" data-so-action="reset" aria-label="Reset">↻</button>
        </div>
      </div>
      <div class="so-stage" id="so-stage" data-char="${escapeAttr(fm.char)}"></div>${legend}
      <p class="so-hint" id="so-hint">Click the character to replay. Press <strong>Try drawing</strong> to write it yourself.</p>
    </section>`;
  return body.replace('</header>', `</header>\n${block}`);
}

/**
 * Build a lookup of strings → entry path for auto-linking.
 * Prefer Chinese strings (less ambiguous) over English titles.
 */
export function buildLinkMap(entries, currentEntry) {
  const map = [];
  for (const e of entries) {
    if (e.status !== 'complete') continue;
    if (e.path === currentEntry.path) continue;

    const phrases = new Set();

    // Character entries: link the glyph itself
    if (e.char) phrases.add(e.char);

    // Topic / vocab / chengyu / grammar: link the leading Chinese phrase from title
    // Title format: "春节 · Spring Festival" or "矛盾 · Contradiction"
    if (e.title) {
      const cn = e.title.split('·')[0].trim();
      if (cn && HZ_RE.test(cn)) phrases.add(cn);
    }

    for (const p of phrases) {
      if (p.length >= 1) map.push({ phrase: p, path: e.path });
    }
  }
  // Longest first so 春节 beats 春 when scanning
  map.sort((a, b) => b.phrase.length - a.phrase.length);
  return map;
}

const MAX_LINKS_PER_TARGET_PER_SECTION = 2;
const MAX_LINKS_PER_TARGET_GLOBAL = 6;

// Sentinel inserted while splitting into sections, stripped before returning.
const SECTION_BOUNDARY = '\x00SECTION\x00';

/**
 * Split body into per-section chunks so we can apply a per-section link budget.
 * Section boundaries are <span class="section-anchor"> or <section class="section-anchor">.
 * Returns array of strings; boundaries are represented by the SECTION_BOUNDARY sentinel.
 */
function splitIntoSections(body) {
  const sectionStart = /<(?:span|section)\s[^>]*class="section-anchor"[^>]*>/g;
  const parts = [];
  let last = 0;
  let m;
  while ((m = sectionStart.exec(body)) !== null) {
    if (m.index > last) parts.push(body.slice(last, m.index));
    parts.push(SECTION_BOUNDARY);
    parts.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts;
}

export function autoLinkBody(body, linkMap, currentEntry) {
  if (!linkMap.length) return body;

  // Extract auto-link-skip sentinel blocks before any splitting so section
  // boundaries inside the block don't fracture the sentinel across chunks.
  const skipBlocks = [];
  body = body.replace(/<!--\s*auto-link-skip\s*-->[\s\S]*?<!--\s*\/auto-link-skip\s*-->/g, (m) => {
    const token = `\x00SKIP${skipBlocks.length}\x00`;
    skipBlocks.push(m);
    return token;
  });

  // Global usage counter: path → total links inserted across the whole page
  const globalCount = new Map();
  // Per-section usage counter: path → links inserted in the current section
  let sectionCount = new Map();

  // Walk the body section-by-section so we can reset the per-section counter
  const sectionChunks = splitIntoSections(body);
  const processedChunks = [];

  for (const chunk of sectionChunks) {
    if (chunk === SECTION_BOUNDARY) {
      // Reset per-section counts at each section boundary
      sectionCount = new Map();
      processedChunks.push(SECTION_BOUNDARY);
      continue;
    }

    // Split chunk into protected/unprotected segments and auto-link
    const segments = splitProtected(chunk);
    let result = '';
    for (const seg of segments) {
      if (seg.protected) {
        result += seg.text;
        continue;
      }
      // Build output left-to-right, advancing a cursor so already-inserted
      // link markup is never rescanned by subsequent phrase substitutions.
      let remaining = seg.text;
      let built = '';
      let anyReplaced = true;
      while (anyReplaced) {
        anyReplaced = false;
        // Find the earliest-occurring phrase in `remaining` that is within budget.
        let bestIdx = -1;
        let bestPhrase = null;
        let bestPath = null;
        for (const { phrase, path } of linkMap) {
          const secUsed = sectionCount.get(path) || 0;
          const globUsed = globalCount.get(path) || 0;
          if (secUsed >= MAX_LINKS_PER_TARGET_PER_SECTION) continue;
          if (globUsed >= MAX_LINKS_PER_TARGET_GLOBAL) continue;
          const idx = remaining.indexOf(phrase);
          if (idx === -1) continue;
          if (phrase.length === 1 && HZ_RE.test(phrase)) {
            const before = remaining[idx - 1] || '';
            const after  = remaining[idx + phrase.length] || '';
            if (HZ_RE.test(before) || HZ_RE.test(after)) continue;
          }
          if (bestIdx === -1 || idx < bestIdx) {
            bestIdx = idx;
            bestPhrase = phrase;
            bestPath = path;
          }
        }
        if (bestIdx !== -1) {
          const href = relativePath(currentEntry.path, bestPath);
          const replacement = `<a class="auto-link" href="${escapeAttr(href)}">${escapeHtml(bestPhrase)}</a>`;
          built += remaining.slice(0, bestIdx) + replacement;
          remaining = remaining.slice(bestIdx + bestPhrase.length);
          sectionCount.set(bestPath, (sectionCount.get(bestPath) || 0) + 1);
          globalCount.set(bestPath, (globalCount.get(bestPath) || 0) + 1);
          anyReplaced = true;
        }
      }
      result += built + remaining;
    }
    processedChunks.push(result);
  }

  // Re-join, stripping the section-boundary sentinels
  let result = processedChunks.join('').split(SECTION_BOUNDARY).join('');

  // Reinsert auto-link-skip blocks verbatim (also strip the sentinel comments)
  result = result.replace(/\x00SKIP(\d+)\x00/g, (_, i) => {
    const block = skipBlocks[Number(i)];
    // Strip the sentinel comment wrappers from the final output
    return block
      .replace(/^<!--\s*auto-link-skip\s*-->/, '')
      .replace(/<!--\s*\/auto-link-skip\s*-->$/, '');
  });
  return result;
}

/**
 * Wrap pinyin spans with a clickable audio trigger.
 *
 * - Character pages: button injected inside <div class="hero-pinyin">.
 * - Vocab / topic / grammar pages: button injected after
 *   <span class="topic-hero-title-py"> when the title's CN portion is a
 *   single pronounceable utterance and pinyin is set. Pages whose CN title
 *   or pinyin contain split markers ("/", "…") are skipped — they cover
 *   multiple readings or constructions that don't render as one clip.
 *
 * Hub / family / hsk pages are aggregate views and remain skipped.
 *
 * Markup emitted:
 *   <button type="button" class="audio-btn" data-audio="感" data-pinyin="gǎn"
 *           aria-label="Play pronunciation">
 *     <svg class="audio-btn-ico" …></svg>
 *     <span class="audio-btn-voice" data-voice="xiaoxiao">女</span>
 *   </button>
 *
 * The voice indicator text is updated client-side to reflect the user's
 * cycled choice (女 / 男). Default is 女 (zh-CN-XiaoxiaoNeural).
 */
/**
 * Append a "all <pinyin> readings →" chip to a character page's hero-chips
 * block, linking to /pages/pinyin/<base>.html. Helps polyphone disambiguation
 * for readers who arrived via search and aren't sure which reading they meant.
 *
 * Only injected when the target page exists in `pinyinSyllables` (the set of
 * generated syllable bases — passed in so we don't link into thin air).
 */
export function injectPinyinIndexChip(body, fm, pinyinSyllables) {
  if (fm.type !== 'character' || !fm.pinyin) return body;
  const base = String(fm.pinyin)
    .replace(/[āáǎà]/g, 'a').replace(/[ēéěè]/g, 'e').replace(/[īíǐì]/g, 'i')
    .replace(/[ōóǒò]/g, 'o').replace(/[ūúǔù]/g, 'u').replace(/[ǖǘǚǜü]/g, 'u')
    .toLowerCase().replace(/[^a-z]/g, '');
  if (!base || !pinyinSyllables.has(base)) return body;

  const chip = `<a class="chip chip-pinyin-link" href="../pinyin/${base}.html" aria-label="See all characters read as ${base}">all ${escapeAttr(base)} readings →</a>`;

  const before = body;
  body = body.replace(
    /(<div class="hero-chips">[\s\S]*?)(<\/div>)/,
    (m, inner, close) => /chip-pinyin-link/.test(inner) ? m : `${inner}            ${chip}\n          ${close}`,
  );
  return body === before ? body : body;
}

export function addPinyinAudio(body, fm) {
  if (fm.type === 'character' && fm.char) {
    return addCharacterAudio(body, fm);
  }
  if (fm.type === 'vocab' || fm.type === 'topic' || fm.type === 'grammar') {
    return addTopicHeroAudio(body, fm);
  }
  return body;
}

function addCharacterAudio(body, fm) {
  const before = body;
  body = body.replace(
    /<div class="hero-pinyin">([\s\S]*?)<\/div>/,
    (m, py) => `<div class="hero-pinyin">${py}${buildAudioButton(fm.char, fm.pinyin)}</div>`,
  );
  if (body === before) {
    throw new Error(`addPinyinAudio: no <div class="hero-pinyin">…</div> found for character "${fm.char}" — the audio button cannot be attached.`);
  }
  return body;
}

function addTopicHeroAudio(body, fm) {
  // CN portion of the title ("茶道 · the way of tea" → "茶道").
  const cn = fm.title ? fm.title.split('·')[0].trim() : '';
  if (!cn || !/[一-鿿]/.test(cn) || !fm.pinyin) return body;
  // Skip pages with split readings/constructions in title or pinyin.
  if (/[\/…]/.test(cn) || /[\/…]/.test(fm.pinyin)) return body;

  // Insert INSIDE the topic-hero-title-py span (mirroring how character
  // pages put the button inside .hero-pinyin). Putting it inside ensures
  // the later injectTopicHeroEn pass — which inserts a sibling
  // .topic-hero-en after title-py — can't displace the button below the
  // English gloss.
  const before = body;
  body = body.replace(
    /<span class="topic-hero-title-py">([\s\S]*?)<\/span>/,
    (m, py) => `<span class="topic-hero-title-py">${py}${buildAudioButton(cn, fm.pinyin)}</span>`,
  );
  return body === before ? body : body;
}

function buildAudioButton(text, pinyin, opts) {
  const inline = opts && opts.inline;
  const cls = inline ? 'audio-btn audio-btn--inline' : 'audio-btn';
  return (
    `<button type="button" class="${cls}" ` +
      `data-audio="${escapeAttr(text)}" ` +
      `data-pinyin="${escapeAttr(pinyin || '')}" ` +
      `aria-label="Play pronunciation (click to cycle voice)">` +
      `<svg class="audio-btn-ico" width="14" height="14" viewBox="0 0 24 24" ` +
        `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
        `stroke-linejoin="round" aria-hidden="true" focusable="false">` +
        `<path d="M11 5 6 9H2v6h4l5 4V5z"/>` +
        `<path class="audio-btn-wave" d="M15.54 8.46a5 5 0 0 1 0 7.07"/>` +
        `<path class="audio-btn-wave audio-btn-wave--far" d="M19.07 4.93a10 10 0 0 1 0 14.14"/>` +
      `</svg>` +
      `<span class="audio-btn-voice" data-voice="xiaoxiao">女</span>` +
    `</button>`
  );
}

/**
 * Inject inline audio buttons next to <span class="cy-py"> (chengyu cards)
 * and <span class="card-py"> (vocab compound cards) wherever the preceding
 * sibling has a matching cn span. Each button references the same (text, pinyin)
 * pair the audio build module hashed for inline clips, so clicks resolve
 * cleanly through the manifest's `inline` section.
 *
 * Skip if a button already exists for that py span (idempotent re-run).
 */
export function injectInlineAudio(body) {
  // Chengyu pairs
  body = body.replace(
    /<span class="cy-cn">([\s\S]*?)<\/span>(\s*)<span class="cy-py">([\s\S]*?)<\/span>/g,
    (m, cnInner, ws, pyInner) => {
      const text   = stripTags(cnInner).trim();
      const pinyin = stripTags(pyInner).trim();
      if (!text || !pinyin || !/[一-鿿]/.test(text)) return m;
      // If a button already follows, skip
      return `<span class="cy-cn">${cnInner}</span>${ws}<span class="cy-py">${pyInner}</span>${buildAudioButton(text, pinyin, { inline: true })}`;
    },
  );

  // Vocab-compound card pairs
  body = body.replace(
    /<span class="card-cn">([\s\S]*?)<\/span>(\s*)<span class="card-py">([\s\S]*?)<\/span>/g,
    (m, cnInner, ws, pyInner) => {
      const text   = stripTags(cnInner).trim();
      const pinyin = stripTags(pyInner).trim();
      if (!text || !pinyin || !/[一-鿿]/.test(text)) return m;
      return `<span class="card-cn">${cnInner}</span>${ws}<span class="card-py">${pyInner}</span>${buildAudioButton(text, pinyin, { inline: true })}`;
    },
  );

  // Section-head pairs — every topic/vocab/grammar section gets a play button
  // next to the heading's pinyin. Pairs whose pinyin contains split markers
  // ("/", "…") are skipped because they cover multiple readings.
  body = body.replace(
    /<span class="sh-cn">([\s\S]*?)<\/span>(\s*)<span class="sh-py">([\s\S]*?)<\/span>/g,
    (m, cnInner, ws, pyInner) => {
      const text   = stripTags(cnInner).trim();
      const pinyin = stripTags(pyInner).trim();
      if (!text || !pinyin || !/[一-鿿]/.test(text)) return m;
      if (/[\/…]/.test(text) || /[\/…]/.test(pinyin)) return m;
      return `<span class="sh-cn">${cnInner}</span>${ws}<span class="sh-py">${pyInner}</span>${buildAudioButton(text, pinyin, { inline: true })}`;
    },
  );

  // Sutra passage pairs — passage-cn + passage-py with an audio button
  // injected after the pinyin span. Each passage is one clip in the inline
  // audio manifest, hashed by (text|pinyin), so duplicates across sutra pages
  // (eg. 揭谛揭谛… in both 心经 and a quoted commentary) share one MP3.
  body = body.replace(
    /<span class="passage-cn">([\s\S]*?)<\/span>(\s*)<span class="passage-py">([\s\S]*?)<\/span>/g,
    (m, cnInner, ws, pyInner) => {
      const text   = stripTags(cnInner).trim();
      const pinyin = stripTags(pyInner).trim();
      if (!text || !pinyin || !/[一-鿿]/.test(text)) return m;
      return `<span class="passage-cn">${cnInner}</span>${ws}<span class="passage-py">${pyInner}</span>${buildAudioButton(text, pinyin, { inline: true })}`;
    },
  );

  return body;
}

/**
 * Transform sutra .passage cards into the polished design:
 *   - Inject a .passage-ordinal element (manuscript folio numbering) using
 *     the passage's index within its .sutra-frame.
 *   - Trim the .passage-marker so the verbose "第N段 · dì-N duàn · N of M"
 *     prefix is dropped, keeping only the trailing semantic label
 *     (eg. "Setting", "The Mantra", "the bodhisattva speaks"). When no
 *     trailing label is present, the marker element is removed entirely
 *     so the ordinal carries the numbering alone.
 *   - Wrap the .passage-note-toggle in a .passage-actions row so future
 *     siblings (eg. share, copy, repeat) can join cleanly.
 *   - Apply .passage--mantra when the .passage carries
 *     data-passage-type="mantra".
 *
 * Idempotent: re-running on already-transformed markup is a no-op because
 * we look for the original .passage-marker shape and bail out if a
 * .passage-ordinal is already present.
 */
export function transformSutraPassages(body) {
  // Process each <div class="sutra-frame"...> block separately so we can
  // number passages 1..N within their own frame.
  const frameRe = /<div class="sutra-frame"[^>]*>([\s\S]*?)<\/div><!--\s*\/sutra-frame\s*-->/g;
  return body.replace(frameRe, (full, inner) => {
    // Match an outer .passage open-tag: class is exactly "passage"
    // (followed by " " for modifiers or `"` for end-of-attr). This avoids
    // matching nested .passage-head / .passage-en / .passage-note divs.
    // After matching the open tag, walk forward tracking <div>/</div>
    // depth to find the corresponding close tag.
    const openRe = /<div class="passage(?:\s+[^"]*)?"([^>]*)>/g;
    const out = [];
    let lastIndex = 0;
    let i = 0;
    let m;
    while ((m = openRe.exec(inner)) !== null) {
      out.push(inner.slice(lastIndex, m.index));
      const attrs = m[1];
      // Walk forward from the end of the open tag to find the matching </div>.
      const start = m.index;
      const bodyStart = openRe.lastIndex;
      let depth = 1;
      let pos = bodyStart;
      const tagRe = /<\/?div\b[^>]*>/g;
      tagRe.lastIndex = bodyStart;
      let t;
      while ((t = tagRe.exec(inner)) !== null) {
        if (t[0].startsWith('</')) {
          depth -= 1;
          if (depth === 0) {
            pos = t.index + t[0].length;
            break;
          }
        } else {
          depth += 1;
        }
      }
      const content = inner.slice(bodyStart, pos - 6); // strip trailing </div>
      i += 1;
      if (/passage-ordinal/.test(content)) {
        out.push(inner.slice(start, pos));
      } else {
        const isMantra = /data-passage-type="mantra"/.test(attrs);
        const klass = `passage${isMantra ? ' passage--mantra' : ''}`;
        let newContent = content;

        // Trim marker: drop "第N段 · ..." prefix, keep the trailing label
        // (eg. "Setting", "The Mantra"). If nothing meaningful remains,
        // drop the marker element entirely.
        newContent = newContent.replace(
          /<span class="passage-marker">([\s\S]*?)<\/span>\s*/,
          (_mm, raw) => {
            const text = stripTags(raw);
            const parts = text.split(/\s*·\s*/).filter(Boolean);
            const tail = parts.filter(p =>
              !/^第.+段$/.test(p) &&
              !/^dì[\s-].+duàn$/i.test(p) &&
              !/^\d+\s+of\s+\d+$/i.test(p)
            );
            if (tail.length === 0) return '';
            return `<span class="passage-marker">${escapeHtml(tail.join(' · '))}</span>\n        `;
          }
        );

        // Wrap the standalone note-toggle in a .passage-actions row.
        newContent = newContent.replace(
          /(<button type="button" class="passage-note-toggle"[^>]*>[\s\S]*?<\/button>)/,
          '<div class="passage-actions">$1</div>'
        );

        const ordinal = `<span class="passage-ordinal" aria-hidden="true">${i}</span>\n        `;
        out.push(`<div class="${klass}"${attrs}>\n        ${ordinal}${newContent.trimStart()}</div>`);
      }
      lastIndex = pos;
      openRe.lastIndex = pos;
    }
    out.push(inner.slice(lastIndex));
    const transformed = out.join('');
    const frameAttrs = full.match(/<div class="sutra-frame"([^>]*)>/)[1];
    return `<div class="sutra-frame"${frameAttrs}>${transformed}</div><!-- /sutra-frame -->`;
  });
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// ── helpers ────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Split body into segments, marking ranges that must not be modified:
 *   - inside any HTML tag
 *   - inside <a>...</a>
 *   - inside <code>, <pre>, <script>, <style>
 *   - inside ex-cn / ex-py / ex-en spans (example sentences should stay clean)
 *   - inside the hero block (already structured)
 */
function splitProtected(body) {
  const segs = [];
  // `button` is in the protect list because the audio-btn voice indicator
  // contains `女`/`男` — a UI affordance for cycling voices, not body
  // content. Without protection the auto-linker wraps it as a link to
  // the 女 character page, breaking the voice toggle.
  const protectedTags = ['a', 'button', 'code', 'pre', 'script', 'style'];
  const re = new RegExp(
    `<!--\\s*auto-link-skip\\s*-->[\\s\\S]*?<!--\\s*\\/auto-link-skip\\s*-->|` + // skip sentinel
    `<(${protectedTags.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1>|` + // protected element trees
    `<header class="hero">[\\s\\S]*?<\\/header>|` +                // hero
    `<header class="topic-hero">[\\s\\S]*?<\\/header>|` +
    `<section class="related"[^>]*>[\\s\\S]*?<\\/section>|` +
    `<nav class="prev-next">[\\s\\S]*?<\\/nav>|` +
    `<section class="stroke-order">[\\s\\S]*?<\\/section>|` +
    `<aside class="sidebar"[^>]*>[\\s\\S]*?<\\/aside>|` +          // sidebar TOC
    `<[^>]+>`,                                                      // any single tag
    'g'
  );
  let last = 0, m;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) segs.push({ text: body.slice(last, m.index), protected: false });
    segs.push({ text: m[0], protected: true });
    last = m.index + m[0].length;
  }
  if (last < body.length) segs.push({ text: body.slice(last), protected: false });
  return segs;
}

function relativePath(fromPath, toPath) {
  const fromParts = fromPath.split('/').slice(0, -1);
  const toParts = toPath.split('/');
  let common = 0;
  while (common < fromParts.length && common < toParts.length - 1 && fromParts[common] === toParts[common]) common++;
  const ups = fromParts.length - common;
  const downs = toParts.slice(common);
  return ('../'.repeat(ups) + downs.join('/')) || './';
}

/**
 * Build a chip lookup: Chinese phrase → { path, category }. Used by
 * linkifyAdjChips to upgrade adj chips matching an existing page into
 * clickable, color-coded links.
 */
export function buildChipLinkMap(entries, currentEntry) {
  const map = new Map();
  for (const e of entries) {
    if (e.status !== 'complete') continue;
    if (e.path === currentEntry.path) continue;
    const phrases = new Set();
    if (e.char) phrases.add(e.char);
    if (e.title) {
      const cn = e.title.split('·')[0].trim();
      if (cn && HZ_RE.test(cn)) phrases.add(cn);
    }
    for (const p of phrases) {
      // First entry wins: characters are added before topics in entries.json,
      // so a chip like 道 prefers the character page over a topic page.
      if (!map.has(p)) map.set(p, { path: e.path, category: e.category || '' });
    }
  }
  return map;
}

/**
 * Upgrade <span class="adj"> chips into <a class="adj"> when their .a-cn
 * text matches a built page. Adds a `data-category` attr for color signaling.
 * Preserves any existing data-* attributes (e.g. data-relation, data-distinct).
 * Idempotent: chips already wrapped in <a> are left alone.
 */
export function linkifyAdjChips(body, chipMap, fromPath) {
  if (!chipMap || chipMap.size === 0) return body;
  // Match the canonical chip shape:
  //   <span class="adj"[attrs]><span class="a-cn">PHRASE</span><span class="a-py">…</span><span class="a-en">…</span></span>
  // Tight, ordered match avoids the nested-</span> ambiguity.
  const chipRe = /<span\s+class="adj"([^>]*)>(<span class="a-cn">([^<]+)<\/span><span class="a-py">[^<]*<\/span><span class="a-en">[^<]*<\/span>)<\/span>/g;
  return body.replace(chipRe, (full, restAttrs, inner, phraseRaw) => {
    const phrase = phraseRaw.trim();
    const target = chipMap.get(phrase);
    if (!target) return full;
    const href = relativePath(fromPath, target.path);
    const cat = target.category;
    return `<a class="adj"${restAttrs} href="${href}" data-category="${cat}">${inner}</a>`;
  });
}
