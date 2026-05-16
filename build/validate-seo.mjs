#!/usr/bin/env node
/**
 * validate-seo.mjs — surface SEO quality signals for complete pages.
 *
 * The structural finding: for complete entries in categories that compete
 * in English-language SERPs (vocab, topic-style philosophy/religion/history/
 * culture/geography/grammar/chengyu), the default <title> tag leads with a
 * CJK character and is built around a generic gloss. English researchers
 * skip those titles in favor of Wikipedia/Wiktionary. The fix is the
 * `seo_title` and `seo_desc` frontmatter overrides: pinyin-first (or
 * English-keyword-first), concrete hook, sized to SERP truncation budgets.
 *
 * See templates/_drafting/SEO.md for the pattern.
 *
 * Checks (all emit category:'seo'):
 *   - seo_title missing on competitive-SERP page (WARN)
 *   - seo_title over 60 chars (WARN — Google truncates)
 *   - seo_title leads with a CJK character (WARN — defeats the purpose)
 *   - seo_title identical to title (WARN — override is doing no work)
 *   - seo_desc missing on competitive-SERP page (WARN)
 *   - seo_desc out of band 70-165 chars (WARN)
 */

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { createFinding, mergeFindings, reportFindings } from './lib/findings.mjs';

const ROOT    = path.resolve(new URL('.', import.meta.url).pathname, '..');
const CONTENT = path.join(ROOT, 'content');

const TITLE_MAX = 60;
const DESC_MIN  = 70;
const DESC_MAX  = 165;

// Categories where pages routinely compete in English-language SERPs with
// Wikipedia, Wiktionary, and other English explainer sites. These pages
// benefit most from hand-tuned SERP titles. Other categories (e.g. the
// drafting/admin scaffolding) are exempt.
const COMPETITIVE_CATEGORIES = new Set([
  'vocab', 'grammar', 'chengyu',
  'philosophy', 'religion', 'history', 'culture',
  'geography', 'culinary', 'arts', 'science', 'daily',
]);

const CJK_FIRST = /^[一-鿿㐀-䶿]/;

const entriesPath = path.join(ROOT, 'data', 'entries.json');
if (!fs.existsSync(entriesPath)) {
  console.error('validate-seo: data/entries.json missing — run `npm run build` first.');
  process.exit(1);
}
const entries = JSON.parse(fs.readFileSync(entriesPath, 'utf8'));

const findings = [];
function emit(level, file, msg, extra = {}) {
  findings.push(createFinding({ level, category: 'seo', file, msg, ...extra }));
}

function contentPath(entry) {
  return entry.path.replace(/^pages\//, 'content/').replace(/\.html$/, '.md');
}

for (const e of entries) {
  if (e.status !== 'complete') continue;
  if (!COMPETITIVE_CATEGORIES.has(e.category)) continue;

  const relContent = contentPath(e);
  const absContent = path.join(ROOT, relContent);
  if (!fs.existsSync(absContent)) continue;

  // Read frontmatter for the SEO fields (not exposed via entries.json yet).
  let fm;
  try {
    fm = matter(fs.readFileSync(absContent, 'utf8')).data;
  } catch {
    continue;
  }

  const seoTitle = (fm.seo_title || '').trim();
  const seoDesc  = (fm.seo_desc  || '').trim();

  if (!seoTitle) {
    emit('WARN', relContent, 'missing seo_title — default title leads with CJK and loses English-SERP clicks', {
      fix: 'Add seo_title to frontmatter. See templates/_drafting/SEO.md for the pattern.',
    });
  } else {
    if (seoTitle.length > TITLE_MAX) {
      emit('WARN', relContent, `seo_title is ${seoTitle.length} chars (max ${TITLE_MAX}) — Google will truncate`, {
        fix: `Rewrite the seo_title to ${TITLE_MAX} chars or fewer`,
      });
    }
    if (CJK_FIRST.test(seoTitle)) {
      emit('WARN', relContent, `seo_title leads with a CJK character — defeats the SERP rewrite`, {
        fix: 'Lead with the pinyin form or the English keyword; put CJK in parens.',
      });
    }
    if (fm.title && seoTitle === fm.title.trim()) {
      emit('WARN', relContent, 'seo_title is identical to title — override is doing no work', {
        fix: 'Either remove seo_title to use the default, or rewrite to lead with pinyin/English and add a hook.',
      });
    }
  }

  if (!seoDesc) {
    emit('WARN', relContent, 'missing seo_desc — default desc is hero copy, not SERP copy', {
      fix: 'Add seo_desc as a complete-sentence answer to the natural-language query the page targets.',
    });
  } else {
    if (seoDesc.length < DESC_MIN || seoDesc.length > DESC_MAX) {
      emit('WARN', relContent, `seo_desc is ${seoDesc.length} chars (target ${DESC_MIN}-${DESC_MAX})`, {
        fix: 'Tighten or expand to fit the SERP description budget.',
      });
    }
  }
}

mergeFindings(ROOT, findings, ['seo']);
reportFindings('validate-seo', findings);

// Validator is advisory only — never blocks the build. SEO field coverage
// will grow over time as we work through the backlog.
process.exit(0);
