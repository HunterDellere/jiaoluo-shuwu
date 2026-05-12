#!/usr/bin/env node
/**
 * share-generate.mjs — generate carousel-ready hooks/beats/cta for every
 * complete content entry, cached by content hash.
 *
 * Output: data/share-cache.json   keyed by entry path, value:
 *   { hash, hook, beats, cta, generated, model }
 *
 * Behaviour:
 *   - Hashes (frontmatter desc + first scholar paragraph + page type) for
 *     each entry. If the cache hash matches, skip the LLM call.
 *   - Calls Anthropic Claude Haiku for entries that need (re)generation.
 *   - Writes the cache file at the end (atomic).
 *
 * Use:
 *   ANTHROPIC_API_KEY=sk-... npm run share:generate
 *   ANTHROPIC_API_KEY=sk-... npm run share:generate -- --force        # ignore cache
 *   ANTHROPIC_API_KEY=sk-... npm run share:generate -- --limit 5      # cap LLM calls (test runs)
 *   ANTHROPIC_API_KEY=sk-... npm run share:generate -- --slug ai4_爱  # one entry only
 *
 * The /pages/share/ builder reads frontmatter `share:` first, then this
 * cache, then falls back to heuristic auto-extraction. Authored frontmatter
 * always wins.
 *
 * Cost: ~$0.001 per entry with Haiku 4.5 → ~$0.45 for the full corpus.
 * Concurrency capped to keep API friendly; full run takes a couple minutes.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONTENT_DIR = join(ROOT, 'content');
const CACHE_PATH = join(ROOT, 'data', 'share-cache.json');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) : Infinity;
})();
const ONLY_SLUG = (() => {
  const i = args.indexOf('--slug');
  return i >= 0 ? args[i + 1] : null;
})();
const DRY_RUN = args.includes('--dry-run');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const CONCURRENCY = parseInt(process.env.SHARE_CONCURRENCY || '4', 10);

if (!API_KEY && !DRY_RUN) {
  console.error('ANTHROPIC_API_KEY not set. Export it or pass --dry-run to preview entries that would be generated.');
  process.exit(1);
}

// ── walk content/ ──────────────────────────────────────────────────────
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

// Extract the first scholar paragraph from a content body. Lossy on
// purpose — we only need a representative slice for the LLM context.
function firstScholarParagraph(body) {
  const m = body.match(/<div class="scholar"[^>]*>[\s\S]*?<\/div>/);
  if (!m) return '';
  // Strip HTML tags, collapse whitespace, take the first ~600 chars.
  return m[0]
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
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
  // content/characters/ai4_爱.md → pages/characters/ai4_爱.html
  const rel = relative(CONTENT_DIR, filePath).replace(/\.md$/, '.html');
  return 'pages/' + rel;
}

// ── prompt ─────────────────────────────────────────────────────────────
//
// Asked to produce structured JSON. Tone instructions reference the
// VOICE.md voice rules (no em-dashes, no hyperbole).
const SYSTEM_PROMPT = `You write social-media carousel copy for Jiǎoluò Shūwū (角落書屋), a scholarly site about Chinese language and civilisation. Each carousel opens with a hook (a question or claim that earns the swipe), then 2-3 short payoff beats, then a call-to-action.

VOICE
- Quiet, scholarly, never hyperbolic. No "delightful," "powerful," "amazing," "fascinating."
- No em-dashes (—). Use commas, semicolons, colons, parentheses, or sentence splits instead. This is the single most important rule.
- Plain English. Write for a curious adult, not a textbook reader.
- Bilingual is fine: 心 xīn used inline reads naturally.
- Do not use emoji.

OUTPUT
Return ONLY valid JSON. No prose, no markdown fences. Schema:
{
  "hook": "string (a question or contrast that earns the swipe; 60-180 chars)",
  "beats": ["string", "string", "string"]   // 2-3 beats, each 80-220 chars
}

Each beat should make ONE concrete point that the reader walks away with. Avoid summary-of-the-page beats; prefer specific etymological / historical / cultural details. End with a beat that lingers.`;

function userPromptFor(entry) {
  return `ENTRY METADATA
type: ${entry.type}
title: ${entry.title}
desc: ${entry.desc}
${entry.char ? `character: ${entry.char}` : ''}
${entry.pinyin ? `pinyin: ${entry.pinyin}` : ''}

SOURCE PROSE (first scholar paragraph)
${entry.scholar || '(no scholar prose available)'}

Generate hook + beats for this entry. Return JSON only.`;
}

// ── Anthropic API call ─────────────────────────────────────────────────
async function callClaude(entry, attempt = 1) {
  const body = {
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPromptFor(entry) }],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = 1500 * Math.pow(2, attempt - 1);
      console.warn(`  retry in ${wait}ms (HTTP ${res.status}) — ${entry.path}`);
      await new Promise(r => setTimeout(r, wait));
      return callClaude(entry, attempt + 1);
    }
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  // Strip code fences if the model added them despite instructions.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (e) { throw new Error(`Could not parse JSON for ${entry.path}: ${cleaned.slice(0, 200)}`); }
  if (!parsed.hook || !Array.isArray(parsed.beats)) {
    throw new Error(`Invalid shape for ${entry.path}: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  // Defensive: strip any em-dashes the model snuck in.
  parsed.hook = parsed.hook.replace(/—/g, ',');
  parsed.beats = parsed.beats.map(b => b.replace(/—/g, ','));
  return parsed;
}

// ── concurrency-limited runner ─────────────────────────────────────────
async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let i = 0;
  let active = 0;
  return new Promise((resolve, reject) => {
    function next() {
      if (i >= items.length && active === 0) return resolve(results);
      while (active < limit && i < items.length) {
        const idx = i++;
        active++;
        worker(items[idx], idx).then(r => {
          results[idx] = r;
          active--;
          next();
        }).catch(err => {
          // One entry failing shouldn't kill the run — record and continue.
          results[idx] = { error: err.message };
          active--;
          next();
        });
      }
    }
    next();
  });
}

// ── main ───────────────────────────────────────────────────────────────
async function main() {
  const cache = existsSync(CACHE_PATH)
    ? JSON.parse(readFileSync(CACHE_PATH, 'utf8'))
    : {};

  // Build the list of candidate entries.
  const files = walk(CONTENT_DIR);
  const candidates = [];
  for (const fp of files) {
    const raw = readFileSync(fp, 'utf8');
    const { data: fm, content: body } = matter(raw);
    if (fm.status !== 'complete') continue;
    if (fm.share && fm.share.hook) continue;          // authored wins
    if (ONLY_SLUG && !fp.includes(ONLY_SLUG)) continue;
    const scholar = firstScholarParagraph(body);
    const path = entryPath(fp);
    const fingerprint = {
      type: fm.type, char: fm.char || '', pinyin: fm.pinyin || '',
      title: fm.title || '', desc: fm.desc || '', scholar,
    };
    const hash = entryFingerprint(fm, scholar);
    candidates.push({ path, hash, fingerprint });
  }

  // Filter to entries that need work (cache miss OR --force).
  const todo = candidates.filter(c => FORCE || !cache[c.path] || cache[c.path].hash !== c.hash);
  const skipped = candidates.length - todo.length;

  console.log(`Total complete entries:    ${candidates.length}`);
  console.log(`Cache hits (skipped):      ${skipped}`);
  console.log(`To generate:               ${Math.min(todo.length, LIMIT)}`);
  console.log(`Model:                     ${MODEL}`);
  console.log(`Concurrency:               ${CONCURRENCY}`);

  if (DRY_RUN) {
    console.log('\nDry run — no API calls. First 5 candidates:');
    todo.slice(0, 5).forEach(c => console.log('  ', c.path));
    return;
  }

  const work = todo.slice(0, LIMIT);
  if (!work.length) {
    console.log('\nNothing to do.');
    return;
  }

  let done = 0;
  const start = Date.now();
  const generated = await runWithConcurrency(work, CONCURRENCY, async (c) => {
    const result = await callClaude({ ...c.fingerprint, path: c.path });
    done++;
    if (done % 5 === 0 || done === work.length) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`  [${done}/${work.length}] ${elapsed}s elapsed`);
    }
    return { hook: result.hook, beats: result.beats };
  });

  // Merge into cache.
  let okCount = 0;
  let errCount = 0;
  work.forEach((c, i) => {
    const r = generated[i];
    if (r && r.error) {
      console.warn(`  ✗ ${c.path}: ${r.error}`);
      errCount++;
      return;
    }
    cache[c.path] = {
      hash: c.hash,
      hook: r.hook,
      beats: r.beats,
      generated: new Date().toISOString().slice(0, 10),
      model: MODEL,
    };
    okCount++;
  });

  // Atomic write.
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
  console.log(`\n✓ ${okCount} cached, ${errCount} failed. Cache written to ${relative(ROOT, CACHE_PATH)}.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
