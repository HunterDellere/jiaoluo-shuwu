#!/usr/bin/env node
/**
 * validate-review-diff.mjs — pre-push guard on content edits that send
 * freshness or review signals (local/seo/03-spam-recovery.md).
 *
 * Compares each changed content/**.md against the merge-base with origin/main:
 *   - ERROR when `updated` changes but nothing else in the file changes by at
 *     least MIN_CHANGED_LINES lines. Date bumps must follow real edits.
 *   - ERROR when `human_reviewed` is set to a future date.
 *   - ERROR when more than MAX_REVIEWS_PER_PUSH files gain or change
 *     `human_reviewed` in one push. Review is Hunter reading a page; a bulk
 *     flip is what a script does. Hunter can override for a push he made by
 *     hand with ALLOW_BULK_REVIEW=1.
 *
 * Needs git and an origin/main ref; skips with a notice when there is none.
 */

import { execFileSync } from 'child_process';
import matter from 'gray-matter';

export const MIN_CHANGED_LINES = 3;
export const MAX_REVIEWS_PER_PUSH = 15;

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

let base;
try {
  base = git('merge-base', 'HEAD', 'origin/main').trim();
} catch {
  console.log('validate-review-diff: no origin/main merge-base; skipped.');
  process.exit(0);
}

// -z: raw NUL-separated paths. Without it git quotes non-ASCII names
// ("content/vocab/xihuan_\345...md") and the .md filter silently drops them.
const changed = git('diff', '-z', '--name-only', '--diff-filter=AM', `${base}...HEAD`, '--', 'content')
  .split('\0')
  .filter(f => f.endsWith('.md') && !f.includes('/_'));

function readAt(rev, file) {
  try { return git('show', `${rev}:${file}`); } catch { return null; }
}

function fieldOf(src, key) {
  if (src == null) return undefined;
  try { return matter(src).data[key]; } catch { return undefined; }
}

const UPDATED_LINE = /^updated:.*$/m;
function changedLineCount(a, b) {
  const strip = s => s.replace(UPDATED_LINE, '').split('\n');
  const before = strip(a);
  const after = strip(b);
  const seen = new Map();
  for (const l of before) seen.set(l, (seen.get(l) || 0) + 1);
  let unmatched = 0;
  for (const l of after) {
    const n = seen.get(l) || 0;
    if (n > 0) seen.set(l, n - 1); else unmatched++;
  }
  let removed = 0;
  for (const n of seen.values()) removed += n;
  return Math.max(unmatched, removed);
}

const today = new Date().toISOString().slice(0, 10);
const errors = [];
const reviewed = [];

for (const file of changed) {
  const before = readAt(base, file);
  const after = readAt('HEAD', file);
  if (after == null) continue;

  const oldUpdated = fieldOf(before, 'updated');
  const newUpdated = fieldOf(after, 'updated');
  if (before != null && oldUpdated !== newUpdated && changedLineCount(before, after) < MIN_CHANGED_LINES) {
    errors.push(`${file}: \`updated\` bumped (${oldUpdated} → ${newUpdated}) with fewer than ${MIN_CHANGED_LINES} other changed lines. Bump the date only for a real edit.`);
  }

  const oldReview = fieldOf(before, 'human_reviewed');
  const newReview = fieldOf(after, 'human_reviewed');
  if (newReview !== undefined && newReview !== oldReview) {
    reviewed.push(file);
    if (typeof newReview === 'string' && newReview > today) {
      errors.push(`${file}: human_reviewed ${newReview} is in the future.`);
    }
  }
}

if (reviewed.length > MAX_REVIEWS_PER_PUSH && process.env.ALLOW_BULK_REVIEW !== '1') {
  errors.push(`${reviewed.length} files gain or change human_reviewed in this push (max ${MAX_REVIEWS_PER_PUSH}). `
    + 'Only Hunter sets human_reviewed, after reading the page. If Hunter did review all of them, '
    + 'push with ALLOW_BULK_REVIEW=1.');
}

if (errors.length) {
  console.error(`\n${errors.length} review-diff error(s):\n`);
  for (const e of errors) console.error('✗ ' + e);
  process.exit(1);
}
console.log(`✓ validate-review-diff: ${changed.length} changed content files, ${reviewed.length} newly human-reviewed.`);
