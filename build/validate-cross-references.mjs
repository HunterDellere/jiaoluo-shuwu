#!/usr/bin/env node
// validate-cross-references.mjs — non-character factual validation.
//
// Three checks share one extraction pass over content/**/*.md body prose:
//
//   1. Cross-page consistency: when two pages cite different year ranges for
//      the same named entity, ERROR. Pure self-consistency, no registry needed.
//   2. Canonical claims: when a named entity matches an entry in
//      data/_reference/canonical-claims.json, verify the cited range matches.
//   3. Romanization consistency: enforce the house-style spelling per CN
//      proper noun (data/_reference/canonical-romanizations.json). WARN-level.
//
// Plus #5: a freshness gate over data/_reference/upstream/MANIFEST.json that
// WARNs when any vendored upstream file's `fetched` date is >180 days old.
//
// Exits 1 on any ERROR. WARNs and INFOs report but don't fail.
// Pairs with build/validate-facts.mjs (which handles character-level claims)
// and build/validate-formatting.mjs (em-dash gate + voice).

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { createFinding, mergeFindings, reportFindings } from './lib/findings.mjs';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const CONTENT = path.join(ROOT, 'content');
const REF_DIR = path.join(ROOT, 'data', '_reference');

const CANONICAL = JSON.parse(fs.readFileSync(path.join(REF_DIR, 'canonical-claims.json'), 'utf8'));
const ROMANIZATIONS = JSON.parse(fs.readFileSync(path.join(REF_DIR, 'canonical-romanizations.json'), 'utf8'));
const MANIFEST_PATH = path.join(REF_DIR, 'upstream', 'MANIFEST.json');

const findings = [];
function emit(level, file, msg, extra = {}) {
  findings.push(createFinding({ level, category: 'cross-references', file, msg, ...extra }));
}

// ────────────────────── Alias index ──────────────────────
// Build alias → { kind, canonicalName, entry } so we can resolve any cited
// form (English label, CN, pinyin variant) back to the canonical entry.
const ALIAS_INDEX = new Map();
function indexEntries(group, kind) {
  for (const [name, entry] of Object.entries(group)) {
    if (name.startsWith('_')) continue;
    const target = { kind, canonicalName: name, entry };
    ALIAS_INDEX.set(normalizeName(name), target);
    for (const a of entry.aliases || []) ALIAS_INDEX.set(normalizeName(a), target);
  }
}
indexEntries(CANONICAL.dynasties, 'dynasty');
indexEntries(CANONICAL.people, 'person');
indexEntries(CANONICAL.events, 'event');
indexEntries(CANONICAL.texts, 'text');

function normalizeName(s) {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ────────────────────── Body extraction ──────────────────────
// Strip frontmatter, fenced code, comments, and HTML tags. We deliberately
// keep gloss spans (sh-en, card-en, etc.) here — unlike the em-dash check,
// factual claims about dynasty dates can appear in glosses too.
function bodyText(src) {
  return src
    .replace(/^---[\s\S]*?\n---\n/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

// Year-range claims of shape "<Name> (<start>[-]<end> [BCE|CE|AD|BC]?)"
// where <Name> is up to 5 capitalized words. To avoid clipping compound
// period names like "Five Dynasties and Northern Song (907–1127)" — where
// the date legitimately spans both periods — we extend the name greedily
// across "and"/"through"/"to" connectors. The compound form won't match
// the canonical registry, so it falls through to the cross-page consistency
// check, which is the right behaviour: "Five Dynasties and Northern Song"
// is its own descriptor, not a canonical entity.
const RANGE_RE = /(?:^|[^\w'-])([A-Z][\w'’-]+(?:\s+(?:of\s+|the\s+|and\s+|through\s+|to\s+)?[A-Z][\w'’-]+){0,5})\s*\(\s*(c\.?\s*)?(\d{3,4})\s*[-–—]\s*(\d{3,4})\s*(BCE|BC|CE|AD)?\s*\)/g;

function parseEra(yearStr, era) {
  const y = parseInt(yearStr, 10);
  if (!Number.isFinite(y)) return null;
  if (era === 'BCE' || era === 'BC') return -y;
  return y;
}

// Some pages use a CE/BCE marker only on the second number. Treat both as
// the same era unless explicit. If no era, infer from magnitude only when
// both numbers are < 1000 — too ambiguous otherwise; bail.
function inferEra(start, end, era) {
  const e = parseEra(end, era);
  // If start has no explicit era, mirror end's era. If neither has era, leave
  // as positive (CE-like) — these will only match canonical entries with
  // start>0 anyway.
  const s = parseEra(start, era);
  return [s, e];
}

// ────────────────────── Claim extraction ──────────────────────
function extractRangeClaims(text) {
  const claims = [];
  let m;
  while ((m = RANGE_RE.exec(text)) !== null) {
    const [whole, name, , startStr, endStr, era] = m;
    const [start, end] = inferEra(startStr, endStr, era);
    if (start === null || end === null) continue;
    const off = m.index + (m[0].startsWith(name) ? 0 : m[0].indexOf(name));
    const ctx = text.slice(Math.max(0, off - 30), off + whole.length + 30).trim();
    claims.push({ name: name.trim(), start, end, era: era || null, raw: whole.trim(), ctx });
  }
  return claims;
}

// ────────────────────── Pass 1+2: range checks ──────────────────────
// Per-name aggregation (cross-page) + canonical comparison.
const observed = new Map(); // normalizedName → [{file, start, end, raw, ctx}]

function checkRangeClaims(rel, claims) {
  for (const c of claims) {
    const key = normalizeName(c.name);
    if (!observed.has(key)) observed.set(key, []);
    observed.get(key).push({ file: rel, ...c });
  }
}

function reportRangeChecks() {
  for (const [key, occurrences] of observed) {
    const ref = ALIAS_INDEX.get(key);

    // ── #2: canonical match check ──
    if (ref) {
      const expected = canonicalRange(ref.entry);
      if (expected) {
        for (const o of occurrences) {
          if (o.start !== expected.start || o.end !== expected.end) {
            // Allow `c.` (circa) prefix in the source to soften an exact
            // match into a WARN. Otherwise it's an ERROR.
            const isCirca = /\bc\.?\s/.test(o.raw);
            emit(isCirca ? 'WARN' : 'ERROR', o.file,
              `'${o.name}' cited as ${formatRange(o.start, o.end)} but canonical reference says ${formatRange(expected.start, expected.end)} (${ref.kind}: ${ref.canonicalName})`,
              { context: o.ctx, fix: `Use ${formatRange(expected.start, expected.end)} or update data/_reference/canonical-claims.json if the canonical is wrong.` });
          }
        }
        continue;
      }
    }

    // ── #1: cross-page consistency ──
    // No canonical entry — but if the same name has divergent ranges across
    // pages, that's still a contradiction.
    const distinct = new Map(); // "start-end" → first occurrence
    for (const o of occurrences) {
      const k = o.start + '/' + o.end;
      if (!distinct.has(k)) distinct.set(k, o);
    }
    if (distinct.size > 1) {
      const variants = [...distinct.values()];
      const summary = variants.map(v => `${formatRange(v.start, v.end)} (${v.file})`).join(' vs ');
      // Report on each affected file so admin dashboard finds them all.
      for (const o of occurrences) {
        emit('ERROR', o.file,
          `'${o.name}' cited as ${formatRange(o.start, o.end)} — conflicts with other pages: ${summary}`,
          { context: o.ctx, fix: `Pick one canonical range and either update the other pages or add an entry to data/_reference/canonical-claims.json.` });
      }
    }
  }
}

function canonicalRange(entry) {
  if (typeof entry.start === 'number' && typeof entry.end === 'number') {
    return { start: entry.start, end: entry.end };
  }
  if (typeof entry.born === 'number' && typeof entry.died === 'number') {
    return { start: entry.born, end: entry.died };
  }
  return null;
}

function formatRange(start, end) {
  if (start < 0 && end < 0)        return `${-start}–${-end} BCE`;
  if (start < 0 && end >= 0)       return `${-start} BCE – ${end} CE`;
  return `${start}–${end}`;
}

// ────────────────────── Pass 3: romanization consistency ──────────────────────
// For each CN proper noun, a `canonical` form is preferred and an
// `also_acceptable` list is tolerated. Only spellings explicitly listed in
// `flagged` get a WARN — this is the strict subset we've decided to push
// out of the corpus. Adjacent gloss patterns (e.g. `心经 (Xīnjīng)`) are
// exempt so glossed pinyin doesn't trip the check.
const ROM_CANONICAL = ROMANIZATIONS.canonical || {};
const ROM_FLAGGED = ROMANIZATIONS.flagged || {};

function checkRomanizations(rel, text) {
  for (const [cn, flaggedList] of Object.entries(ROM_FLAGGED)) {
    const canonical = ROM_CANONICAL[cn];
    if (!canonical) continue;
    for (const v of flaggedList) {
      if (v === canonical) continue;
      const re = new RegExp('(?:^|[^\\w])(' + escapeRegex(v) + ')(?=[^\\w]|$)', 'gu');
      let m;
      while ((m = re.exec(text)) !== null) {
        const off = m.index + m[0].indexOf(v);
        // Adjacent-gloss exemption — bidirectional. The variant counts as a
        // gloss if either the CN form or the canonical English form appears
        // within ~60 chars on either side. Catches `心经 (Xīnjīng)` (CN
        // before), `Xīnjīng (心经)` (CN after), and `Tao Te Ching (=道德经)`
        // (CN after, parenthetical-with-equals teaching context).
        const before = text.slice(Math.max(0, off - 60), off);
        const after  = text.slice(off + v.length, off + v.length + 60);
        const isGloss = before.includes(cn) || before.includes(canonical)
                     ||  after.includes(cn) ||  after.includes(canonical);
        if (isGloss) continue;
        const ctx = text.slice(Math.max(0, off - 30), off + v.length + 30).trim();
        emit('WARN', rel,
          `romanization '${v}' for ${cn} — house style is '${canonical}'`,
          { context: ctx, fix: `Replace '${v}' with '${canonical}' in body prose. Toned/native forms inside pinyin spans (.sh-py / .card-py / .a-py) are exempt — those spans are stripped before validation.` });
      }
    }
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ────────────────────── Per-file walk ──────────────────────
function validateFile(fp) {
  const src = fs.readFileSync(fp, 'utf8');
  const rel = path.relative(ROOT, fp);
  const { content: body } = matter(src);
  const text = bodyText(body);
  const claims = extractRangeClaims(text);
  checkRangeClaims(rel, claims);
  checkRomanizations(rel, text);
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md')) validateFile(p);
  }
}

walk(CONTENT);
reportRangeChecks();

// ────────────────────── Pass 5: reference data freshness ──────────────────────
// WARN when any vendored upstream file's `fetched` date is older than
// FRESHNESS_DAYS. Catches the silent-decay case where Unihan/CC-CEDICT
// updates upstream but our subset goes years without a refresh.
const FRESHNESS_DAYS = 180;
try {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const now = new Date();
  for (const file of manifest.files || []) {
    if (!file.fetched) continue;
    const fetched = new Date(file.fetched + 'T00:00:00Z');
    const ageDays = Math.floor((now - fetched) / 86400000);
    if (ageDays > FRESHNESS_DAYS) {
      emit('WARN', 'data/_reference/upstream/MANIFEST.json',
        `${file.file} last fetched ${file.fetched} (${ageDays} days ago, threshold ${FRESHNESS_DAYS}). Reference data may be stale.`,
        { fix: `Run 'npm run refresh:reference -- --fetch' to pull fresh upstream copies, then commit the updated MANIFEST.json + derived JSONs.` });
    }
  }
} catch (e) {
  emit('WARN', 'data/_reference/upstream/MANIFEST.json',
    `could not read manifest: ${e.message}`);
}

// ────────────────────── Report + persist ──────────────────────
reportFindings('validate-cross-references', findings);
mergeFindings(ROOT, findings, ['cross-references']);

const errorCount = findings.filter(f => f.level === 'ERROR').length;
process.exit(errorCount > 0 ? 1 : 0);
