#!/usr/bin/env node
/**
 * refresh-reference.mjs — rebuild the filtered reference JSONs from vendored
 * upstream source files.
 *
 * Default (no flags):  read the committed raw files under
 *   data/_reference/upstream/ and regenerate:
 *     - data/_reference/hanzi-facts.json
 *     - data/_reference/simp-trad-pairs.json
 *   This is fully offline and reproducible from repo state.
 *
 * --fetch:             re-download the raw upstream files first, updating
 *                      the MANIFEST.json SHA256s and fetch date. Use this
 *                      when you explicitly want fresher upstream data.
 *
 * --verify:            only verify that committed raw files match the SHA256s
 *                      in MANIFEST.json. Exits non-zero on mismatch.
 *
 * The refresh script does NOT depend on network access unless --fetch is set.
 * Network failures during --fetch retry 4 times with exponential backoff.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REF_DIR = path.join(ROOT, 'data', '_reference');
const UP_DIR = path.join(REF_DIR, 'upstream');
const CONTENT = path.join(ROOT, 'content');

const args = new Set(process.argv.slice(2));
const DO_FETCH = args.has('--fetch');
const DO_VERIFY = args.has('--verify');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(UP_DIR, 'MANIFEST.json'), 'utf8'));
}

function writeManifest(m) {
  fs.writeFileSync(path.join(UP_DIR, 'MANIFEST.json'), JSON.stringify(m, null, 2) + '\n');
}

// Retry a promise-returning op with exponential backoff.
async function withRetry(fn, { attempts = 4, base = 2000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        const delay = base * Math.pow(2, i);
        console.warn(`  retry in ${delay}ms: ${e.message}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─────────────────────────────────────────────────────── verify / fetch ──

async function verifyUpstream() {
  const m = readManifest();
  let ok = true;
  for (const entry of m.files) {
    const fp = path.join(UP_DIR, entry.file);
    if (!fs.existsSync(fp)) {
      console.error(`✗ ${entry.file}: missing`);
      ok = false;
      continue;
    }
    const actual = sha256(fs.readFileSync(fp));
    if (actual !== entry.sha256) {
      console.error(`✗ ${entry.file}: SHA256 mismatch`);
      console.error(`  expected: ${entry.sha256}`);
      console.error(`  actual:   ${actual}`);
      ok = false;
    } else {
      console.log(`✓ ${entry.file}: ${entry.sha256.slice(0, 16)}…`);
    }
  }
  return ok;
}

async function fetchUpstream() {
  const m = readManifest();
  const today = new Date().toISOString().slice(0, 10);
  for (const entry of m.files) {
    console.log(`Fetching ${entry.source_url} …`);
    const buf = await withRetry(() => httpsGet(entry.source_url));
    const newHash = sha256(buf);
    const fp = path.join(UP_DIR, entry.file);
    fs.writeFileSync(fp, buf);
    if (entry.sha256 !== newHash) {
      console.log(`  hash changed: ${entry.sha256.slice(0, 16)}… → ${newHash.slice(0, 16)}…`);
    } else {
      console.log(`  unchanged`);
    }
    entry.sha256 = newHash;
    entry.fetched = today;
  }
  writeManifest(m);
}

// ─────────────────────────────────────── derive filtered JSONs locally ──

function enumerateSiteHanzi() {
  const set = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        const src = fs.readFileSync(p, 'utf8');
        for (const ch of src) {
          const cp = ch.codePointAt(0);
          if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) ||
              (cp >= 0x2E80 && cp <= 0x2EFF) || (cp >= 0x2F00 && cp <= 0x2FDF) ||
              (cp >= 0xF900 && cp <= 0xFAFF)) set.add(ch);
        }
      }
    }
  };
  walk(CONTENT);
  return set;
}

function deriveHanziFacts(used) {
  const mmah = path.join(UP_DIR, 'makemeahanzi-dictionary.txt');
  const out = {};
  let matched = 0;
  const missing = [];
  for (const ln of fs.readFileSync(mmah, 'utf8').split('\n')) {
    if (!ln.trim()) continue;
    let e;
    try { e = JSON.parse(ln); } catch { continue; }
    if (!used.has(e.character)) continue;
    out[e.character] = {
      pinyin: e.pinyin || [],
      decomposition: e.decomposition || null,
      radical: e.radical || null,
      etymology: e.etymology || null,
      definition: e.definition || null,
    };
    matched++;
  }
  for (const ch of used) if (!out[ch]) missing.push(ch);
  fs.writeFileSync(path.join(REF_DIR, 'hanzi-facts.json'), JSON.stringify(out));
  fs.writeFileSync(path.join(REF_DIR, 'hanzi-missing.json'), JSON.stringify(missing));
  return { matched, total: used.size, missing: missing.length };
}

function enumerateCharacterHeroHanzi() {
  // Stroke data is only needed for hero glyphs on character pages, not for
  // every hanzi mentioned in prose. Pull the `char:` field from each
  // content/characters/*.md frontmatter.
  const dir = path.join(CONTENT, 'characters');
  const set = new Set();
  if (!fs.existsSync(dir)) return set;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const src = fs.readFileSync(path.join(dir, name), 'utf8');
    const m = src.match(/^char:\s*["']?([^\s"'\n]+)/m);
    if (m) set.add(m[1]);
  }
  return set;
}

function deriveStrokeData(_unused) {
  // Filter graphics.txt to hero hanzi on character pages + their simp/trad
  // counterparts. Prose hanzi are out of scope for the hero animation.
  const heroes = enumerateCharacterHeroHanzi();
  const pairsPath = path.join(REF_DIR, 'simp-trad-pairs.json');
  const pairs = JSON.parse(fs.readFileSync(pairsPath, 'utf8'));
  const scope = new Set(heroes);
  for (const [trad, simp] of pairs) {
    if (heroes.has(trad) || heroes.has(simp)) {
      scope.add(trad);
      scope.add(simp);
    }
  }
  const graphicsPath = path.join(UP_DIR, 'makemeahanzi-graphics.txt');
  const out = {};
  let matched = 0;
  // Stream line-by-line; the file is ~30 MB so readFileSync is fine on dev machines.
  for (const ln of fs.readFileSync(graphicsPath, 'utf8').split('\n')) {
    if (!ln.trim()) continue;
    let e;
    try { e = JSON.parse(ln); } catch { continue; }
    if (!scope.has(e.character)) continue;
    // Keep both strokes (filled outlines, used as the visible glyph) AND
    // medians (centerline polylines, used as the animated pen path). The
    // hero animation reveals each stroke shape under its corresponding
    // median sweep, which reads as actual writing rather than a perimeter
    // trace.
    out[e.character] = {
      strokes: e.strokes || [],
      medians: e.medians || [],
    };
    matched++;
  }
  fs.writeFileSync(path.join(REF_DIR, 'stroke-data.json'), JSON.stringify(out));
  return { matched, scope: scope.size };
}

function deriveSimpTradPairs(used) {
  const ts = path.join(UP_DIR, 'opencc-TSCharacters.txt');
  const parse = (fp) => {
    const map = {};
    for (const ln of fs.readFileSync(fp, 'utf8').split('\n')) {
      if (!ln || ln.startsWith('#')) continue;
      const [k, v] = ln.split('\t');
      if (!k || !v) continue;
      map[k] = v.split(' ').filter(Boolean);
    }
    return map;
  };
  const tsMap = parse(ts);
  // Include IDS leaves so component-level equivalence works even for
  // characters not directly in content.
  const facts = JSON.parse(fs.readFileSync(path.join(REF_DIR, 'hanzi-facts.json'), 'utf8'));
  const scope = new Set(used);
  const idsOps = new Set('⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻');
  for (const ch of Object.keys(facts)) {
    const d = facts[ch].decomposition || '';
    for (const c of d) if (!idsOps.has(c) && c !== '？') scope.add(c);
  }
  const pairs = [];
  const seen = new Set();
  for (const trad of Object.keys(tsMap)) {
    for (const simp of tsMap[trad]) {
      if (trad === simp) continue;
      if (!scope.has(trad) && !scope.has(simp)) continue;
      const k = trad < simp ? trad + '|' + simp : simp + '|' + trad;
      if (seen.has(k)) continue;
      seen.add(k);
      pairs.push([trad, simp]);
    }
  }
  fs.writeFileSync(path.join(REF_DIR, 'simp-trad-pairs.json'), JSON.stringify(pairs));
  return { scope: scope.size, pairs: pairs.length };
}

// ───────────────────────────────────────────────────────────── main ──

async function main() {
  if (DO_VERIFY) {
    const ok = await verifyUpstream();
    process.exit(ok ? 0 : 1);
  }
  if (DO_FETCH) {
    await fetchUpstream();
  }
  // Always verify before deriving — catches silent corruption of vendored files.
  const ok = await verifyUpstream();
  if (!ok) {
    console.error('\nUpstream file verification failed. Not regenerating derived JSONs.');
    console.error('Run with --fetch to refresh, or restore files from git.');
    process.exit(1);
  }

  console.log('\nEnumerating hanzi in content/ …');
  const used = enumerateSiteHanzi();
  console.log(`  ${used.size} unique hanzi`);

  console.log('\nDeriving hanzi-facts.json …');
  const r1 = deriveHanziFacts(used);
  console.log(`  matched ${r1.matched}/${r1.total}; ${r1.missing} uncovered`);

  console.log('\nDeriving simp-trad-pairs.json …');
  const r2 = deriveSimpTradPairs(used);
  console.log(`  scope ${r2.scope}, ${r2.pairs} pairs`);

  console.log('\nDeriving stroke-data.json …');
  const r3 = deriveStrokeData(used);
  console.log(`  matched ${r3.matched}/${r3.scope} (incl. simp/trad counterparts)`);

  console.log('\n✓ reference data regenerated from vendored upstream files.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
