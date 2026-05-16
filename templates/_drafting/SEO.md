# SEO drafting guide — SERP titles and descriptions

This is the editorial standard for the `seo_title` and `seo_desc` frontmatter
fields. The build emits these as the page's `<title>` and `<meta name="description">`
tags — the two strings that actually appear in a Google search result.

The default title (built from `title:` and `pinyin:`) leads with CJK characters
and is bland by design — it works on the page but loses SERP clicks to
Wikipedia and Wiktionary on every competitive English-language query. This
guide explains how to write overrides that win.

## When to add SEO overrides

You don't need to do this on every page. Prioritize:

- Pages that already get search impressions (check Google Search Console).
- Vocab and topic entries where the romanized form is a likely query (e.g.
  someone searching `wuwei`, `kongzi`, `putonghua`, `mencius`).
- Chengyu, grammar particles, philosophy, religion, history, and culture
  pages — these compete head-to-head with Wikipedia in English SERPs.
- Pages where a quiz-style or how-to query shows up in GSC ("what is the
  radical of 要", "chinese opera role types").

The `validate:seo` check flags missing overrides on these competitive
categories. Skip it on character pages where the CJK glyph itself is the
useful artifact and most of the click intent comes from copy-paste lookup.

## The title pattern

```
Pīnyīn (CJK): concrete English hook
```

Examples that work:

- `Wúwéi (无为): the Daoist art of not-forcing`
- `Tiānmìng (天命): the Mandate of Heaven, in plain English`
- `Hànzì (汉字): how Chinese characters actually work`
- `Jiǎozi (饺子): why dumplings rule the Chinese New Year table`
- `Sheng, Dan, Jing, Chou: the four roles of Chinese opera`

Why this works:

1. **Pinyin first.** The SERP audience is overwhelmingly English-reading.
   Eyes lock on romanized text. A CJK-leading title reads as "a page in a
   language I can't read" and gets skipped, even when the page is in English.
2. **CJK in parens, not absent.** Keeps the keyword relevance for Mandarin
   readers and tells Google what this page is about. Don't drop the CJK.
3. **Concrete hook.** Not "guide to" or "introduction to" or "explained" —
   those signal generic content. "The Daoist art of not-forcing" tells the
   reader something specific they don't already know. The hook is the
   reason-to-click.

Patterns to avoid:

- **CJK first**: `无为 wúwéi — non-action; acting in accord with nature` —
  English readers' eyes glaze over before reaching the gloss.
- **Generic gloss only**: `Wuwei — Chinese philosophy` — Wikipedia wins this
  battle every time. Add a hook.
- **Question titles** (`What is wuwei?`): Reddit owns those SERPs.
- **Brand suffix**: don't include `| Jiǎoshū` — the template adds it.

Length budget: 60 characters max for the part you write. Google truncates
around 60 chars on desktop and 50 on mobile. The validator flags overruns.

## The description pattern

The description is a SERP advertisement, not page copy. It's read by a
person who has 8 results to choose from and 2 seconds to decide.

Write a complete-sentence answer to the query the page targets:

- `Wúwéi isn't doing nothing. It's the Daoist principle of acting in accord with nature: effortless effectiveness, sage governance, Zhuangzi's perfect cook.`
- `An old man decides to move two mountains with a basket. His neighbors call him a fool. Two thousand years later, Mao Zedong called him the model citizen.`
- `The character 山 (shān) is a pictograph of three mountain peaks. It has 3 strokes, the radical is itself (山), and it dates to oracle-bone script.`

Why this works:

1. **Answers the implied question.** A user searching `wuwei meaning` gets
   the meaning in the first sentence. They might still click, but only
   because the description promised more than it delivered (in a good way).
2. **Concrete nouns and proper names.** "Zhuangzi's perfect cook" is more
   memorable than "examples in Chinese philosophy". Names and details
   raise click-through.
3. **No keyword stuffing.** Google rewrites stuffed descriptions. One
   natural mention of the term is enough.
4. **For quiz-format queries**, answer the question directly. Google may
   pull the description into a featured snippet, which doubles CTR.

Length budget: 90-155 characters. Shorter and Google rewrites it from
page body (usually badly). Longer and the SERP truncates with an ellipsis
that often cuts mid-thought. The validator flags overruns.

## Common mistakes

- **Reusing the hero description.** The hero description (`desc:`) is
  page copy: lyrical, voice-driven, sometimes lapidary. The SERP
  description is functional: it answers a question to earn a click.
  These are different jobs. Keep `desc:` for the hero and write
  `seo_desc:` fresh.
- **Em-dashes in seo_title or seo_desc.** The site-wide voice rule
  bans em-dashes in body prose, but the SEO fields are subject to the
  same rule for the same reason — em-dashes are the clearest AI tell
  and they look strange in SERPs. Use a colon or comma instead.
- **Setting `seo_title` identical to `title`.** The override is doing
  no work in that case. Either remove it or rewrite to lead with the
  English-search form.
- **Forgetting that titles can be A/B-tested over time.** GSC shows
  impressions and CTR per page. If a rewrite doesn't lift CTR after
  4 weeks of impressions, try a different hook.

## Frontmatter slot

```yaml
---
title: '无为 · non-action; acting in accord with nature'
desc: '无为 is the Daoist elimination of forced, ego-driven action: the master principle behind effortless effectiveness, sage governance, and Zhuangzi''s cook whose knife stays forever sharp.'
pinyin: 'wúwéi'
seo_title: 'Wúwéi (无为): the Daoist art of not-forcing'
seo_desc: "Wúwéi isn't doing nothing. It's the Daoist principle of acting in accord with nature: effortless effectiveness, sage governance, Zhuangzi's perfect cook."
---
```

The build picks up `seo_title` and `seo_desc` automatically once present.
Run `npm run build && npm run check` to verify the new fields pass the
validator.
