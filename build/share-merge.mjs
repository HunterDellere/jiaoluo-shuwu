#!/usr/bin/env node
/**
 * share-merge.mjs — merge sub-agent shard outputs into data/share-cache.json.
 *
 * Reads /tmp/shuwu-shards/result-*.json (each shape:
 *   { results: { <path>: {hash, hook, beats} }, failures: [...] })
 * Merges all results into the canonical share-cache, applies a final
 * em-dash strip (defensive — voice rule is non-negotiable, sub-agents
 * occasionally slip), validates shape, writes the cache atomically.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SHARD_DIR = '/tmp/shuwu-shards';
const CACHE_PATH = join(ROOT, 'data', 'share-cache.json');

const today = new Date().toISOString().slice(0, 10);

const cache = existsSync(CACHE_PATH)
  ? JSON.parse(readFileSync(CACHE_PATH, 'utf8'))
  : {};

const before = Object.keys(cache).length;
let added = 0;
let stripped = 0;
const failures = [];

function clean(s) {
  // Defensive em-dash strip + whitespace normalize.
  let out = String(s || '').replace(/—/g, ',');
  if (out !== s) stripped++;
  return out.replace(/\s+/g, ' ').trim();
}

const shardFiles = readdirSync(SHARD_DIR).filter(f => /^result-\d+\.json$/.test(f)).sort();
console.log(`Found ${shardFiles.length} shard result files:\n  ` + shardFiles.join('\n  '));

for (const file of shardFiles) {
  const shard = JSON.parse(readFileSync(join(SHARD_DIR, file), 'utf8'));
  const results = shard.results || {};
  for (const [path, value] of Object.entries(results)) {
    if (!value || typeof value !== 'object') continue;
    if (!value.hook || !Array.isArray(value.beats)) {
      failures.push({ path, reason: 'invalid shape' });
      continue;
    }
    cache[path] = {
      hash: value.hash || '',
      hook: clean(value.hook),
      beats: value.beats.map(clean).filter(b => b.length > 10),
      generated: today,
      model: 'claude-code-subagent',
    };
    added++;
  }
  if (Array.isArray(shard.failures)) failures.push(...shard.failures);
}

writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
const after = Object.keys(cache).length;
console.log(`\nCache: ${before} → ${after} entries (+${added}).`);
if (stripped) console.log(`Em-dashes stripped: ${stripped}.`);
if (failures.length) {
  console.log(`\n${failures.length} failures:`);
  failures.slice(0, 10).forEach(f => console.log(`  ${f.path}: ${f.reason}`));
}
console.log(`\n✓ Wrote ${relative(ROOT, CACHE_PATH)}`);
