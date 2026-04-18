# chinese-field-guide — Project Instructions

## What this is
A personal HTML/CSS/JS field guide to the Chinese language and civilization. No build system. Static files served from subfolders. Run locally with `python3 -m http.server 8080`.

---

## Folder Structure

```
chinese-field-guide/
├── index.html          # auto-renders from entries.js — never hand-edit entry cards
├── style.css           # shared stylesheet — ALL pages link this
├── entries.js          # single source of truth for all 100 pages
├── README.md           # authoring TODO checklist
├── CLAUDE.md           # this file
├── characters/         # Language — Characters (type: "character")
├── vocab/              # Language — Vocab (type: "vocab")
├── grammar/            # Language — Grammar (type: "grammar")
├── religion/           # type: "topic"
├── philosophy/         # type: "topic"
├── history/            # type: "topic"
├── geography/          # type: "topic"
├── culture/            # type: "topic"
├── culinary/           # type: "topic"
├── arts/               # type: "topic"
├── science/            # type: "topic"
└── daily/              # type: "topic"
```

---

## Stylesheet Rule
The shared stylesheet is **`style.css`** at the repo root — always. Never rename it.

Pages in subfolders link it as:
```html
<link rel="stylesheet" href="../style.css">
```

---

## Metadata Comment Block
Place the JSON metadata comment immediately after `<!DOCTYPE html>`, before `<html>`:
```html
<!DOCTYPE html>
<!-- {"type":"character","char":"感","pinyin":"gǎn","tone":3,"hsk":3,"radical":"心","category":"characters","status":"complete","tags":["emotion"]} -->
<html lang="zh-Hans">
```
For topic/vocab/grammar pages, use `"type":"topic"`, `"type":"vocab"`, or `"type":"grammar"` and omit character-specific fields.

---

## Naming Conventions
- Character pages: `[pinyin][tone]_[char].html` → `characters/gan3_感.html`
- Vocab pages: `[pinyin-ascii]_[char].html` → `vocab/mianzi_面子.html`
- Grammar pages: short ASCII slug → `grammar/le_了.html`
- Topic pages: `topic_[slug].html` → `religion/topic_chan.html`

**ASCII-only in all filenames** — no toned pinyin vowels in filenames.

---

## entries.js — the Manifest
Every page has one entry object in `entries.js`. Fields:

```js
{
  path: "characters/gan3_感.html",   // relative from root
  type: "character",                  // character | vocab | grammar | topic
  category: "characters",             // must match a key in CATEGORY_META in index.html
  char: "感",                         // character entries only
  pinyin: "gǎn",
  tone: 3,                            // character entries only
  hsk: "2–4",                         // character entries only
  radical: "心",                      // character entries only
  title: "感 · to feel, resonance",
  desc: "Short 1-sentence description shown on the index card.",
  tags: ["emotion","perception"],
  status: "complete"                  // "complete" | "stub"
}
```

**Rules:**
- Adding a page = create the HTML + append one object to `entries.js`. Never edit `index.html` for entries.
- Flip `status: "stub"` → `status: "complete"` when the page is fully authored.

---

## Topnav Pattern (from subfolders)
```html
<nav class="topnav">
  <a href="../index.html" class="topnav-brand">Field Notes on <span>Chinese</span></a>
  <a href="../index.html" class="topnav-back">← All Entries</a>
</nav>
```

---

## Two Content Page Types

### Character entries (`type: character`, subfolder: `characters/`)
Structure:
1. `<header class="hero">` — glyph hero with `.hero-glyph`, `.hero-pinyin`, `.hero-en`, `.hero-chips`
2. Etymology `.scholar` box (data-glyph attribute)
3. Word-formation `.pattern` box
4. Grouped `.cards` sections (each group under a `.section-head`)
5. 成语 `.chengyu-grid`
6. Adjacent vocab `.adj-wrap`
7. Retention image `.scholar` box
8. `.page-footer`

Sidebar: `.toc-glyph` + `.toc-pinyin`, then `.toc-list` anchors for each section.

### Topic / Vocab / Grammar entries (`type: topic|vocab|grammar`)
Structure:
1. `<header class="topic-hero">` — eyebrow + title (Chinese) + `.topic-hero-title-py` + desc
2. `.scholar` prose sections
3. `.pattern` boxes for structural patterns
4. `.cards` vocab groups as appropriate
5. 成语 `.chengyu-grid`
6. Adjacent vocab `.adj-wrap`
7. `.page-footer`

Sidebar: `.toc-topic` + `.toc-topic-en`, then `.toc-list`.

---

## Required Elements (all pages)
- `lang="zh-Hans"` on `<html>`
- Descriptive `<title>`: `感 gǎn — Field Notes on Chinese` or `禅宗 Chán Buddhism — Field Notes on Chinese`
- Google Fonts link (Cormorant Garamond + Noto Serif SC + Inconsolata) in `<head>`
- `<link rel="stylesheet" href="../style.css">` (subfolder) or `href="style.css"` (root)
- Topnav with both brand and back link pointing to `../index.html`
- Mobile TOC toggle inside `<aside class="sidebar" id="sidebar">`
- Scroll-active TOC JS (IntersectionObserver on `.section-anchor` elements)
- Page footer with filename reference

---

## CSS Component Reference
`.shell` → `.sidebar` + `.main`. Components: `.hero` / `.topic-hero`, `.scholar[data-glyph]`, `.pattern`, `.cards` + `.card.c-{red|ochre|teal|violet|sienna}`, `.chengyu-grid` + `.cy`, `.adj-wrap` + `.adj`, `.table-wrap` + `table`, `.page-footer`. Chips: `.chip`, `.chip-hsk`, `.chip-topic`. Tags: `.tag-v`, `.tag-n`, `.tag-vn`, `.tag-adj`.

---

## Stub Page Template

When creating a stub (not yet authored):
```html
<!DOCTYPE html>
<!-- {"type":"topic","category":"religion","status":"stub","title":"禅宗 Chán Buddhism"} -->
<html lang="zh-Hans">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>禅宗 Chán Buddhism — Field Notes on Chinese</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400;1,600&family=Noto+Serif+SC:wght@300;400;600;700&family=Inconsolata:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../style.css">
</head>
<body>
<nav class="topnav">
  <a href="../index.html" class="topnav-brand">Field Notes on <span>Chinese</span></a>
  <a href="../index.html" class="topnav-back">← All Entries</a>
</nav>
<button class="toc-toggle" onclick="document.getElementById('sidebar').classList.toggle('open')">目录 Contents ▾</button>
<div class="shell">
  <aside class="sidebar" id="sidebar">
    <span class="toc-topic">禅宗</span>
    <span class="toc-topic-en">Chán Buddhism</span>
    <div class="toc-divider"></div>
    <span class="toc-label">Coming soon</span>
  </aside>
  <main class="main">
    <header class="topic-hero">
      <span class="topic-hero-eyebrow">Religion · 宗教 zōngjiào</span>
      <h1 class="topic-hero-title">禅宗</h1>
      <span class="topic-hero-title-py">chán zōng</span>
      <p class="topic-hero-desc">The meditative school that became Japanese Zen.</p>
    </header>
    <div class="scholar" data-glyph="禅">
      <div class="scholar-label">待完成 dài wánchéng · Stub</div>
      <p>This entry is a placeholder. The authoring queue is in <code>README.md</code>.</p>
    </div>
    <footer class="page-footer">
      <span class="footer-id">Field Notes on Chinese · <span>stub</span></span>
      <a href="../index.html" class="footer-back">← All Entries</a>
    </footer>
  </main>
</div>
</body>
</html>
```

For character stubs, replace `.topic-hero` with `.hero` + `.hero-glyph` + `.hero-pinyin` etc.

---

## Git Commit Format
```
feat: add [char/topic slug] — [pinyin] [english gloss]
```
Examples:
- `feat: add 是 character page — shì copula`
- `feat: add topic_chan — chán Buddhism`
- `feat: author religion/topic_chan — full content`
