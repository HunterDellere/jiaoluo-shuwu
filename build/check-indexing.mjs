#!/usr/bin/env node
/**
 * check-indexing.mjs — post-build gates on what Google is offered.
 *
 * Why: local/seo/03-spam-recovery.md. The site was demoted sitewide on
 * 2026-08-24 after shipping ~900 mostly AI-drafted URLs, 200 of them thin
 * template pages. These gates keep the indexable surface small, reviewed and
 * substantive, so the same pattern cannot ship again by accident.
 *
 * Errors (exit 1):
 *   - A sitemap URL points at a missing file or at a page carrying noindex.
 *   - A built page has no noindex but is not in the sitemap (an indexable
 *     surface that bypassed the human-review rule, e.g. a new generated family).
 *   - entries.json `indexable` disagrees with the sitemap.
 *   - An indexable page has fewer than MIN_BODY_WORDS words of body text.
 *   - A body sentence is repeated on more than MAX_SENTENCE_PAGES indexable pages.
 *
 * `--audit-all` applies the two content gates to every complete page as a
 * report (no exit code), to see what would fail once a page is reviewed.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { hasNoindex } from './lib/indexability.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = 'https://jiaoshoo.com';
const AUDIT_ALL = process.argv.includes('--audit-all');

export const MIN_BODY_WORDS = 600;
export const MAX_SENTENCE_PAGES = 3;
const MIN_SENTENCE_CHARS = 40;

const errors = [];
const fail = (file, msg) => errors.push(`${file}\n    ${msg}`);

// ── sitemap ─────────────────────────────────────────────────────────────────

function locs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
}

function urlToFile(url) {
  let p = decodeURIComponent(url.slice(SITE_URL.length));
  if (p.endsWith('/')) p += 'index.html';
  return join(ROOT, p.replace(/^\//, ''));
}

const sitemapUrls = [];
for (const child of locs(readFileSync(join(ROOT, 'sitemap.xml'), 'utf8'))) {
  const childFile = urlToFile(child);
  if (!existsSync(childFile)) { fail(childFile, `sitemap index lists missing child ${child}`); continue; }
  sitemapUrls.push(...locs(readFileSync(childFile, 'utf8')));
}
const sitemapFiles = new Set();
for (const url of sitemapUrls) {
  const file = urlToFile(url);
  sitemapFiles.add(relative(ROOT, file));
  if (!existsSync(file)) { fail(file, `sitemap lists ${url} but the file does not exist`); continue; }
  if (hasNoindex(readFileSync(file, 'utf8'))) fail(file, `sitemap lists ${url} but the page is noindex`);
}

// ── every indexable built page must be in the sitemap ───────────────────────

function walkHtml(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('_')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkHtml(full));
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

for (const file of walkHtml(join(ROOT, 'pages'))) {
  const rel = relative(ROOT, file);
  if (sitemapFiles.has(rel)) continue;
  if (!hasNoindex(readFileSync(file, 'utf8'))) {
    fail(rel, 'page is indexable (no robots noindex) but not in the sitemap; '
      + 'indexability must come from build/lib/indexability.mjs');
  }
}

// ── entries.json agrees with the sitemap ────────────────────────────────────

const entries = JSON.parse(readFileSync(join(ROOT, 'data', 'entries.json'), 'utf8'));
for (const e of entries) {
  if (typeof e.indexable !== 'boolean') { fail(e.path, 'entries.json entry has no boolean `indexable`'); continue; }
  if (e.indexable !== sitemapFiles.has(e.path)) {
    fail(e.path, `entries.json indexable=${e.indexable} but sitemap ${sitemapFiles.has(e.path) ? 'lists' : 'omits'} it`);
  }
}

// ── content gates ───────────────────────────────────────────────────────────

// Links whose text is longer than this are teaser cards quoting another
// page's description (related cards, "appears in" lists, hub entry cards).
// That text belongs to the other page, so it is not counted as this page's
// body. Short inline links (an autolinked word) stay.
const CARD_LINK_CHARS = 60;

function bodyText(html) {
  const main = (html.match(/<main[\s\S]*<\/main>/) || [html])[0];
  return main
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/g, (whole, inner) =>
      inner.replace(/<[^>]+>/g, '').trim().length > CARD_LINK_CHARS ? ' ' : whole)
    .replace(/<footer[\s\S]*?<\/footer>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// English words plus CJK characters at two per word.
function wordCount(text) {
  const latin = (text.match(/[A-Za-zÀ-ɏ']+/g) || []).length;
  const cjk = (text.match(/[㐀-鿿]/g) || []).length;
  return Math.round(latin + cjk / 2);
}

function sentences(text) {
  return new Set(text.split(/(?<=[.!?。！？])\s+/).filter(s => s.length >= MIN_SENTENCE_CHARS));
}

const gated = entries.filter(e => (AUDIT_ALL ? e.status === 'complete' : e.indexable));
const report = [];
const sentencePages = new Map();
for (const e of gated) {
  const file = join(ROOT, e.path);
  if (!existsSync(file)) continue;
  const text = bodyText(readFileSync(file, 'utf8'));
  const words = wordCount(text);
  if (words < MIN_BODY_WORDS) report.push([e.path, `thin: ${words} body words (minimum ${MIN_BODY_WORDS})`]);
  for (const s of sentences(text)) {
    if (!sentencePages.has(s)) sentencePages.set(s, []);
    sentencePages.get(s).push(e.path);
  }
}
for (const [s, pages] of sentencePages) {
  if (pages.length <= MAX_SENTENCE_PAGES) continue;
  for (const p of pages) {
    report.push([p, `boilerplate: sentence repeated on ${pages.length} pages (max ${MAX_SENTENCE_PAGES}): "${s.slice(0, 90)}"`]);
  }
}

if (AUDIT_ALL) {
  const byPage = new Map();
  for (const [p, msg] of report) byPage.set(p, [...(byPage.get(p) || []), msg]);
  console.log(`audit-all: ${gated.length} complete pages, ${byPage.size} would fail the content gates.`);
  const thin = report.filter(([, m]) => m.startsWith('thin')).length;
  console.log(`  thin: ${thin} pages; boilerplate: ${new Set(report.filter(([, m]) => m.startsWith('boilerplate')).map(([p]) => p)).size} pages`);
  process.exit(0);
}

for (const [p, msg] of report) fail(p, msg);

// ── report ──────────────────────────────────────────────────────────────────

if (errors.length === 0) {
  console.log(`✓ check-indexing: ${sitemapUrls.length} sitemap URLs, ${gated.length} indexable entries pass the content gates; everything else is noindex.`);
} else {
  console.error(`\n${errors.length} indexing error(s):\n`);
  for (const e of errors) console.error('✗ ' + e + '\n');
  process.exit(1);
}
