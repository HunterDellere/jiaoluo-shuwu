#!/usr/bin/env node
// Orphan detector: lists complete pages with zero or low inbound .adj chip mentions
// from other pages on the site. Reads data/entries.json + data/adj-index.json,
// writes a sorted markdown report to local/orphan-report.md.
//
// Usage: node build/orphan-report.mjs [--threshold N]
//   --threshold N : pages with <= N inbound mentions are flagged (default 1)
//
// Diagnosis (2026-05-06): pages with 0 inbound chip mentions are 6/6 not indexed
// by Google; pages with >=1 inbound mention are 6/6 indexed. Adding chip references
// on existing pages that point *to* an orphan is the cheapest known way to push it
// into Google's index. See local/seo-plan.md for full context.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const threshold = (() => {
  const i = args.indexOf('--threshold');
  if (i >= 0 && args[i + 1]) return Number(args[i + 1]);
  return 1;
})();

const entries = JSON.parse(readFileSync(join(ROOT, 'data/entries.json'), 'utf8'));
const adjIndex = JSON.parse(readFileSync(join(ROOT, 'data/adj-index.json'), 'utf8'));

const completeEntries = entries.filter(e => e.status === 'complete');

// Derive candidate CN chip keys for an entry. Multi-char titles often have
// shorter canonical forms used in chips (战国时期 -> 战国; 二十四节气 -> 节气),
// so we generate 2- and 3-char substrings as candidate keys; adj-index lookup
// will only hit real chips.
function chipKeysFor(entry) {
  const keys = new Set();
  if (entry.char) keys.add(entry.char);
  if (entry.title) {
    // Allow internal ellipsis (…) so grammar-pair titles like "虽然…但是"
    // capture their full form, which matches adj-index keys that include the ellipsis joiner.
    const m = entry.title.match(/^([㐀-鿿豈-﫿…]+)/);
    if (m) {
      const full = m[1];
      keys.add(full);
      const stripped = full.replace(/…/g, '');
      if (stripped && stripped !== full) keys.add(stripped);
      const base = stripped || full;
      const hadEllipsis = full.includes('…');
      // Generate length-2,3 substrings for shorthand chip keys (e.g. 战国时期 -> 战国).
      if (base.length >= 3) {
        for (let len = 2; len <= 3; len++) {
          for (let i = 0; i + len <= base.length; i++) {
            keys.add(base.slice(i, i + len));
          }
        }
      }
      // For ellipsis titles only, also add length-1 substrings — these titles
      // (e.g. 太…了) often have single-hanzi chip variants on referrer pages.
      if (hadEllipsis) {
        for (const ch of base) keys.add(ch);
      }
    }
  }
  const fname = entry.path.split('/').pop() || '';
  const fm = fname.match(/_([㐀-鿿豈-﫿]+)\.html$/);
  if (fm) keys.add(fm[1]);
  return [...keys];
}

function inboundCount(entry) {
  const keys = chipKeysFor(entry);
  const referrers = new Set();
  for (const k of keys) {
    const rec = adjIndex[k];
    if (!rec) continue;
    for (const p of rec.appearsOn || []) {
      if (p !== entry.path) referrers.add(p);
    }
  }
  return { count: referrers.size, referrers: [...referrers], keys };
}

const scored = completeEntries.map(e => {
  const { count, referrers, keys } = inboundCount(e);
  return { entry: e, count, referrers, keys };
});

const orphans = scored
  .filter(s => s.count <= threshold)
  .sort((a, b) => {
    if (a.entry.category !== b.entry.category) return a.entry.category.localeCompare(b.entry.category);
    return a.entry.path.localeCompare(b.entry.path);
  });

const byCategory = new Map();
for (const s of orphans) {
  const cat = s.entry.category;
  if (!byCategory.has(cat)) byCategory.set(cat, []);
  byCategory.get(cat).push(s);
}

// Suggest 2-4 same-category pages with the most tag overlap as candidate referrers.
function suggestReferrers(orphan) {
  const orphanTags = new Set(orphan.entry.tags || []);
  if (orphanTags.size === 0) return [];
  return completeEntries
    .filter(e => e.path !== orphan.entry.path && e.category === orphan.entry.category)
    .map(e => {
      const overlap = (e.tags || []).filter(t => orphanTags.has(t)).length;
      return { path: e.path, title: e.title, overlap };
    })
    .filter(c => c.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 4);
}

const lines = [];
lines.push('# Orphan Page Report');
lines.push('');
lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
lines.push(`Threshold: pages with **${threshold} or fewer** inbound \`.adj\` chip references from other site pages.`);
lines.push('');
lines.push(`**Total complete pages:** ${completeEntries.length}`);
lines.push(`**Orphans (≤${threshold} inbound):** ${orphans.length}`);
lines.push(`**True orphans (0 inbound):** ${scored.filter(s => s.count === 0).length}`);
lines.push('');
lines.push('## Why this matters');
lines.push('');
lines.push('Diagnosis from 2026-05-06: pages with 0 inbound chip mentions are 6/6 not indexed');
lines.push('by Google; pages with ≥1 inbound mention are 6/6 indexed. Adding chip references');
lines.push('on existing high-traffic pages that point *to* an orphan is the cheapest known way');
lines.push('to push it into Google\'s index.');
lines.push('');
lines.push('## How to fix an orphan');
lines.push('');
lines.push('1. Pick 2–3 of the suggested referrer pages below (they share tags with the orphan)');
lines.push('2. Open `content/<category>/<slug>.md` for the *referrer*, not the orphan');
lines.push('3. In the `<div class="adj-wrap">` block, add a chip pointing to the orphan:');
lines.push('   `<span class="adj"><span class="a-cn">CN</span><span class="a-py">pinyin</span><span class="a-en">english</span></span>`');
lines.push('4. Only add chips where the prose actually warrants the link — Google can detect forced linking');
lines.push('5. Run `npm run build` to regenerate, push, then request indexing in GSC for the orphan');
lines.push('');

for (const [cat, list] of byCategory) {
  lines.push(`## ${cat} (${list.length})`);
  lines.push('');
  for (const s of list) {
    const e = s.entry;
    const display = e.char || e.title.split(' ')[0] || e.path;
    lines.push(`### ${display} — \`${e.path}\``);
    lines.push('');
    lines.push(`- **Inbound:** ${s.count}${s.referrers.length ? ` (from: ${s.referrers.map(r => `\`${r}\``).join(', ')})` : ''}`);
    lines.push(`- **Chip keys checked:** ${s.keys.map(k => `\`${k}\``).join(', ') || '_(none derivable)_'}`);
    lines.push(`- **Tags:** ${(e.tags || []).join(', ') || '_none_'}`);
    lines.push(`- **Title:** ${e.title}`);
    const suggested = suggestReferrers(s);
    if (suggested.length) {
      lines.push(`- **Suggested referrers (by tag overlap):**`);
      for (const c of suggested) {
        lines.push(`  - \`${c.path}\` — ${c.title} _(overlap: ${c.overlap})_`);
      }
    } else {
      lines.push(`- **Suggested referrers:** _none in same category share tags — manual selection needed_`);
    }
    lines.push('');
  }
}

const localDir = join(ROOT, 'local');
if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });
const out = join(localDir, 'orphan-report.md');
writeFileSync(out, lines.join('\n'), 'utf8');

console.log(`Wrote ${out}`);
console.log(`  Complete pages: ${completeEntries.length}`);
console.log(`  Orphans (≤${threshold} inbound): ${orphans.length}`);
console.log(`  True orphans (0 inbound): ${scored.filter(s => s.count === 0).length}`);
