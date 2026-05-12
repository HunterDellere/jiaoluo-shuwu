#!/usr/bin/env node
/**
 * share-review-merge.mjs — combine reviewer-sub-agent shards into one
 * audit report at data/share-review.json.
 *
 * Reads /tmp/shuwu-review/result-*.json. Each shard is
 *   { results: [{path, scores: {hook,beats,voice,facts,ending}, total, flags, notes}] }
 *
 * Output sorts worst-first so flagged entries surface immediately:
 *   data/share-review.json = { reviewed, summary, byTotal, byFlag, all }
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SHARD_DIR = '/tmp/shuwu-review';
const OUT_PATH = join(ROOT, 'data', 'share-review.json');

const all = [];
const files = readdirSync(SHARD_DIR).filter(f => /^result-\d+\.json$/.test(f)).sort();
console.log(`Found ${files.length} reviewer shard files.`);
for (const f of files) {
  const shard = JSON.parse(readFileSync(join(SHARD_DIR, f), 'utf8'));
  for (const r of (shard.results || [])) all.push(r);
}

// Aggregate
const flagCounts = {};
const totals = [];
for (const r of all) {
  totals.push(r.total);
  for (const flag of (r.flags || [])) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
}
totals.sort((a, b) => a - b);
const median = totals[Math.floor(totals.length / 2)];
const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
const flagged = all.filter(r => r.total < 18 || (r.flags && r.flags.length > 0));

const summary = {
  reviewed: all.length,
  meanTotal: Math.round(mean * 10) / 10,
  medianTotal: median,
  flaggedCount: flagged.length,
  flagCounts,
};

// Worst first.
const byTotal = [...all].sort((a, b) => a.total - b.total);

writeFileSync(OUT_PATH, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  summary,
  flagged: byTotal.filter(r => r.total < 18 || (r.flags && r.flags.length > 0)),
  all: byTotal,
}, null, 2) + '\n');

console.log('\n── Summary ──');
console.log(`Reviewed:     ${summary.reviewed}`);
console.log(`Mean total:   ${summary.meanTotal} / 25`);
console.log(`Median:       ${summary.medianTotal} / 25`);
console.log(`Flagged:      ${summary.flaggedCount} (total < 18 or has flags)`);
console.log('\nFlag frequency:');
for (const [flag, count] of Object.entries(flagCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${flag.padEnd(20)} ${count}`);
}

console.log(`\nWorst 10 entries:`);
for (const r of byTotal.slice(0, 10)) {
  console.log(`  ${String(r.total).padStart(2)}/25  ${r.path}  ${(r.flags || []).join(',')}`);
  if (r.notes) console.log(`         ${r.notes}`);
}

console.log(`\n✓ Wrote ${relative(ROOT, OUT_PATH)}`);
