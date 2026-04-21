# Factual Review Checklist

Every character and vocab page carries a `factual_review` frontmatter field. It must be set to one of:

- `verified` — all factual claims have been checked against at least one listed source
- `pending` — claims have not yet been verified (default for backfilled pages)
- `unverified` — treat claims as provisional

A page with `status: complete` is only trustworthy to readers if `factual_review: verified`. The UI renders a banner on `pending` and `unverified` pages so readers know the state.

---

## What the build checks automatically

`npm run check` runs `build/validate-facts.mjs`, which:

1. **Cross-checks frontmatter** (character pages) against the bundled reference data — `data/_reference/hanzi-facts.json` (Unihan + CC-CEDICT + IDS decomposition from the makemeahanzi dataset).
   - `radical` must match (with variant equivalence: ⺮↔竹, 钅↔金, 讠↔言, 礻↔示, etc.)
   - `pinyin` mismatches become WARNings (polyphones are common)
   - `tone` integer must match the tone mark on `pinyin`
2. **Extracts every `X = Y + Z` claim** from prose etymology sections and verifies Y and Z appear in X's IDS decomposition (with simp↔trad equivalence from OpenCC).
3. **Checks `phonetic` claims** — if the page says "Y is phonetic" for the page's own character, verifies Y matches the reference phonetic component.
4. **Gates `status: complete`** — requires `factual_review` frontmatter to be set, and requires `factual_sources: [...]` to be non-empty when `factual_review: verified`.

False positives are reported as WARNings, not ERRORs. ERRORs fail the build.

---

## Before flipping `factual_review: pending → verified`

Work through this list, using a reference like Outlier Obscure (Pleco), Wenlin, Shuōwén, or a reputable etymology source:

1. **Radical** — confirm `radical` frontmatter against the source you're using. If using a different radical system than Unihan's default, note it in `factual_sources` ("Xinhua 部首表" or similar).
2. **Component decomposition** — every `X = Y + Z` prose claim must reflect the actual modern character. Pay special attention to simplified-vs-traditional mismatches: simplified 笔 has 毛, not 聿; simplified 运 has 云, not 军; simplified 时 has 寸, not 寺. If the page needs to explain the traditional etymology, make the simplified/traditional distinction explicit.
3. **Phonetic claims** — does the named phonetic component actually give the target reading through a regular Mandarin correspondence? A good test: does the phonetic appear in other characters with the same-or-close reading (e.g. 己 jǐ → 起 qǐ, 记 jì, 纪 jì — a real phonetic series)? If not, the claim is probably wrong.
4. **Historical dates and attributions** — cross-check against at least one authoritative source. Shen Kuo's 梦溪笔谈 is 1088, not 1086. Confucius' dates are 551–479 BCE. When in doubt, cite.
5. **Chengyu and classical quotations** — verify the source text exists and the translation is defensible.
6. **Populate `factual_sources`** — list at least one: "Outlier", "Wenlin", "Shuōwén Jiězì", "Baxter-Sagart OC", "CC-CEDICT", "Pleco/Outlier Expert", "汉语大字典", etc.
7. **Flip the field** — set `factual_review: 'verified'`, update `updated:` to today's date, and commit.

---

## Common error patterns to watch for

| Error class | Example | How to catch it |
|---|---|---|
| Traditional component ascribed to simplified char | 笔 = 竹 + 聿 (actual: 竹 + 毛) | Layer 1.5 validator catches this automatically |
| Wrong phonetic character | 起 = 走 + 巳 (actual: 走 + 己) | Layer 1.5 catches + phonetic-plausibility check |
| Radical from wrong system | 电 under 雨 (traditional) vs 日 (simplified Xinhua) | Layer 1 WARN |
| Polyphone primary reading | 长 'cháng' vs reference 'zhǎng' | Layer 1 WARN — usually legitimate, but verify |
| Confused compound formation for decomposition | "有 + 时 = 有时" misread as decomposition | Validator filters these automatically |

---

## Reference data

The build uses these vendored files in `data/_reference/`:

- `hanzi-facts.json` — Unihan + CC-CEDICT + IDS decomposition for every hanzi used on the site
- `radical-variants.json` — manual equivalence groups (⺮↔竹 etc.)
- `simp-trad-pairs.json` — simp↔trad pairs derived from OpenCC

To re-seed after adding new content:

```
node -e "require('./build/build.mjs')"   # first, ensure content is current
# then regenerate hanzi-facts.json from upstream dictionary.txt if new chars appear.
```

(A proper `scripts/refresh-reference.mjs` is a future task; for now the source URLs are noted in `build/validate-facts.mjs`.)
