#!/usr/bin/env node
/**
 * share-prepare.mjs — prep a work list for sub-agent driven share-cache
 * generation, without making any API calls.
 *
 * Output:
 *   data/share-work.json   ordered array of entries needing enrichment:
 *     [{ path, hash, type, char?, pinyin?, title, desc, scholar }, …]
 *
 * The main agent loop reads this file, spawns N sub-agents (each given
 * a slice), they return JSON, the main loop merges shards into
 * data/share-cache.json.
 *
 * Reuses the same fingerprint logic as share-generate.mjs so a cache
 * built by sub-agents is interchangeable with a cache built by direct
 * API calls (both write the same shape, both skip on same hash match).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONTENT_DIR = join(ROOT, 'content');
const CACHE_PATH = join(ROOT, 'data', 'share-cache.json');
const WORK_PATH = join(ROOT, 'data', 'share-work.json');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('_')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * Extract the first meaningful body of prose from a content page so the
 * sub-agent has real signal to work with.
 *
 * Strategy: collect the first 2–3 <p> bodies (anywhere in the body),
 * skipping anything inside <aside class="sidebar">. The previous version
 * matched `<div class="scholar"[^>]*>` which also caught the
 * `<div class="scholar-label">` inner element (returning only the label
 * text). Going straight to <p> tags is more reliable across page types
 * (character pages use .scholar; topic pages may use .pattern, etc.).
 */
function firstScholarParagraph(body) {
  const cleaned = body
    .replace(/<aside\b[\s\S]*?<\/aside>/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/g, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/g, ' ');
  const paragraphs = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const text = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 60) paragraphs.push(text);
    if (paragraphs.length >= 3) break;
  }
  return paragraphs.join(' ').slice(0, 900);
}

function entryFingerprint(fm, scholarSlice) {
  const parts = [
    fm.type || '',
    fm.char || '',
    fm.title || '',
    fm.desc || '',
    scholarSlice,
  ].join('|');
  return crypto.createHash('sha256').update(parts).digest('hex').slice(0, 16);
}

function entryPath(filePath) {
  const rel = relative(CONTENT_DIR, filePath).replace(/\.md$/, '.html');
  return 'pages/' + rel;
}

const cache = existsSync(CACHE_PATH)
  ? JSON.parse(readFileSync(CACHE_PATH, 'utf8'))
  : {};

const files = walk(CONTENT_DIR);
const work = [];
for (const fp of files) {
  const raw = readFileSync(fp, 'utf8');
  const { data: fm, content: body } = matter(raw);
  if (fm.status !== 'complete') continue;
  if (fm.share && fm.share.hook) continue;
  const scholar = firstScholarParagraph(body);
  const path = entryPath(fp);
  const hash = entryFingerprint(fm, scholar);
  if (cache[path] && cache[path].hash === hash) continue;
  work.push({
    path, hash,
    type: fm.type,
    char: fm.char || '',
    pinyin: fm.pinyin || '',
    title: fm.title || '',
    desc: fm.desc || '',
    scholar,
  });
}

writeFileSync(WORK_PATH, JSON.stringify(work, null, 2) + '\n');
console.log(`Wrote ${work.length} pending entries to ${relative(ROOT, WORK_PATH)}`);
console.log(`Cache currently holds ${Object.keys(cache).length} entries.`);
