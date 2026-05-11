#!/usr/bin/env node
/**
 * Regenerate the OG-card font subsets from data/entries.json.
 *
 * Run after adding content with new hanzi. Requires `pyftsubset` on PATH
 * (from the `fonttools` Python package: `pip install fonttools brotli`).
 *
 * Reads source TTFs from a local cache at `assets/fonts/og/.sources/` if
 * present, otherwise downloads them. Writes subset TTFs into
 * `assets/fonts/og/`.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'assets', 'fonts', 'og');
const CACHE_DIR = join(OUT_DIR, '.sources');

const SOURCES = [
  {
    name: 'NotoSerifSC.ttf',
    url: 'https://github.com/google/fonts/raw/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf',
    out: 'NotoSerifSC-subset.ttf',
    mode: 'hanzi'
  },
  {
    name: 'EBGaramond.ttf',
    url: 'https://github.com/google/fonts/raw/main/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf',
    out: 'EBGaramond-subset.ttf',
    mode: 'latin'
  },
  {
    name: 'Inconsolata.ttf',
    url: 'https://github.com/google/fonts/raw/main/ofl/inconsolata/Inconsolata%5Bwdth%2Cwght%5D.ttf',
    out: 'Inconsolata-subset.ttf',
    mode: 'latin'
  }
];

const LATIN_UNICODES = 'U+0020-007F,U+00A0-00FF,U+0100-017F,U+02B0-02FF,U+2018-201F,U+2022,U+2026,U+2032-2033,U+2039-203A,U+00B7';

function ensurePyftsubset() {
  const r = spawnSync('pyftsubset', ['--help'], { stdio: 'ignore' });
  if (r.status !== 0 && r.error) {
    console.error('pyftsubset not found on PATH.');
    console.error('Install with: pip install fonttools brotli  (or: brew install fonttools)');
    process.exit(2);
  }
}

function downloadSource(src) {
  const cached = join(CACHE_DIR, src.name);
  if (existsSync(cached) && statSync(cached).size > 100000) return cached;
  mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`  fetching ${src.name}…`);
  const r = spawnSync('curl', ['-sL', '-o', cached, src.url], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`download failed: ${src.name}`);
  return cached;
}

function deriveHanziCorpus() {
  const entries = JSON.parse(readFileSync(join(ROOT, 'data', 'entries.json'), 'utf8'));
  const chars = new Set();
  for (const e of entries) {
    if (e.status !== 'complete') continue;
    const glyph = e.char || (e.title ? e.title.split('·')[0].trim() : '');
    for (const c of [...glyph]) chars.add(c);
  }
  // Watermark + category eyebrows + brand glyphs (kept in sync with og-svg.mjs)
  for (const c of '書屋角落字词法语宗哲史地文食艺科日命感动情心人生宇宙') chars.add(c);
  return [...chars].join('');
}

function subsetFont(srcPath, outPath, mode, hanziText) {
  const args = [srcPath, `--unicodes=${LATIN_UNICODES}`, `--output-file=${outPath}`, '--layout-features=kern,liga', '--no-hinting', '--desubroutinize'];
  if (mode === 'hanzi') {
    const textFile = join(CACHE_DIR, 'hanzi.txt');
    writeFileSync(textFile, hanziText, 'utf8');
    args.splice(1, 0, `--text-file=${textFile}`);
    args.splice(args.indexOf('--layout-features=kern,liga'), 1, '--layout-features=*');
  }
  const r = spawnSync('pyftsubset', args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`pyftsubset failed for ${srcPath}`);
}

function main() {
  ensurePyftsubset();
  mkdirSync(OUT_DIR, { recursive: true });
  const hanzi = deriveHanziCorpus();
  console.log(`Hanzi corpus: ${[...hanzi].length} unique characters`);
  for (const src of SOURCES) {
    const srcPath = downloadSource(src);
    const outPath = join(OUT_DIR, src.out);
    subsetFont(srcPath, outPath, src.mode, hanzi);
    const kb = (statSync(outPath).size / 1024).toFixed(1);
    console.log(`  ${src.out}: ${kb} KB`);
  }
  console.log('done');
}

main();
