# OG card fonts (subset)

Used by `build/lib/og-png.mjs` to rasterize per-page OG cards at build time.
Vendored so the build works offline and on CI without a network roundtrip.

- `NotoSerifSC-subset.ttf` — only the hanzi the site actually uses (extracted
  from `data/entries.json`) plus a small ASCII/Latin core.
- `EBGaramond-subset.ttf` — Latin Extended only, for English glosses.
- `Inconsolata-subset.ttf` — Latin only, for pinyin + the brand wordmark.

To regenerate after adding new content (especially new hanzi), run:

```
node scripts/build-og-fonts.mjs
```

That script reads `data/entries.json`, derives the hanzi corpus, and uses
`pyftsubset` (from the `fonttools` Python package) to write fresh subset
TTFs into this directory.

Licensing: Noto Serif SC is OFL 1.1. EB Garamond is OFL 1.1. Inconsolata is
OFL 1.1. The original full TTFs are not vendored — only the subset.
