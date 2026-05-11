import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(REPO_ROOT, 'test-results');
mkdirSync(OUT, { recursive: true });
const out = (n) => path.join(OUT, n);

test('exports page screenshots', async ({ page }) => {
  await page.goto('/pages/exports/');
  await page.waitForSelector('.slice-card', { timeout: 5_000 });
  await page.waitForSelector('.builder-tag-chip', { timeout: 5_000 });
  await page.waitForTimeout(400);

  await page.screenshot({ path: out('exports-page.png'), fullPage: true });

  const builder = page.locator('.builder');
  await builder.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await builder.screenshot({ path: out('exports-builder.png') });

  const intent = page.locator('[data-slice-section="intent"]');
  await intent.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await intent.screenshot({ path: out('exports-intent.png') });

  const firstCard = page.locator('.slice-card').first();
  await firstCard.screenshot({ path: out('exports-slice-card.png') });

  const ladder = page.locator('[data-slice-section="hsk-ladder"]');
  await ladder.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await ladder.screenshot({ path: out('exports-hsk-ladder.png') });

  const counts = await page.evaluate(() => {
    const sections = ['intent', 'hsk-ladder', 'hsk', 'type', 'tag'];
    const out = {};
    for (const s of sections) {
      const el = document.querySelector(`[data-slice-section="${s}"]`);
      out[s] = el ? el.querySelectorAll('.slice-card').length : 0;
    }
    out.legacy = document.querySelectorAll('.export-card').length;
    out.tagChips = document.querySelectorAll('.builder-tag-chip').length;
    out.builderCount = parseInt(document.querySelector('[data-builder-count]')?.textContent || '0', 10);
    return out;
  });
  for (const k of ['intent', 'hsk-ladder', 'hsk', 'type', 'tag', 'legacy']) {
    if (counts[k] === 0) throw new Error(`section "${k}" rendered 0 cards`);
  }
  if (counts.tagChips === 0) throw new Error('builder rendered 0 tag chips');
  if (counts.builderCount === 0) throw new Error('builder live count is 0 with all defaults — should match full corpus');
});

test('builder filters narrow the corpus and the Pleco download fires', async ({ page }) => {
  await page.goto('/pages/exports/');
  await page.waitForSelector('.builder-tag-chip', { timeout: 5_000 });
  await page.waitForTimeout(150);

  const initial = await page.evaluate(() => parseInt(document.querySelector('[data-builder-count]').textContent, 10));
  if (initial < 200) throw new Error('initial count should be the full corpus, got ' + initial);

  // Narrow: untick all types except 'character', set HSK 1-1.
  await page.evaluate(() => {
    document.querySelectorAll('[data-builder-type]').forEach(cb => {
      if (cb.dataset.builderType !== 'character') {
        cb.checked = false;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    const min = document.querySelector('[data-builder-hsk-min]');
    const max = document.querySelector('[data-builder-hsk-max]');
    max.value = '1';
    max.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(120);
  const narrow = await page.evaluate(() => parseInt(document.querySelector('[data-builder-count]').textContent, 10));
  if (narrow >= initial) throw new Error('expected narrow filter to reduce count: initial=' + initial + ' narrow=' + narrow);
  if (narrow === 0) throw new Error('narrowed to zero unexpectedly');

  // Click Pleco download — verify a download is triggered.
  const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
  await page.click('[data-builder-pleco]');
  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  if (!filename.startsWith('shuwu-') || !filename.endsWith('.txt')) {
    throw new Error('unexpected download filename: ' + filename);
  }
});

test('builder Anki .apkg download works (loads sql.js + jszip)', async ({ page }) => {
  test.setTimeout(30_000); // sql.js wasm + jszip CDN can be slow first time
  await page.goto('/pages/exports/');
  await page.waitForSelector('.builder-tag-chip', { timeout: 5_000 });
  await page.waitForTimeout(150);

  // Narrow to a small set so the .apkg build is fast.
  await page.evaluate(() => {
    document.querySelectorAll('[data-builder-type]').forEach(cb => {
      if (cb.dataset.builderType !== 'character') {
        cb.checked = false;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    const max = document.querySelector('[data-builder-hsk-max]');
    max.value = '1';
    max.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(120);

  const downloadPromise = page.waitForEvent('download', { timeout: 25_000 });
  await page.click('[data-builder-anki]');
  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  if (!filename.startsWith('shuwu-') || !filename.endsWith('.apkg')) {
    throw new Error('unexpected download filename: ' + filename);
  }
});

test('per-page export buttons sit above the page footer', async ({ page }) => {
  await page.goto('/pages/characters/dao4_%E9%81%93.html');
  await page.waitForSelector('.page-export', { timeout: 5_000 });
  await page.waitForTimeout(300);

  const layout = await page.evaluate(() => {
    const exp = document.querySelector('.page-export');
    const foot = document.querySelector('.page-footer');
    return {
      hasExport: !!exp,
      hasFooter: !!foot,
      expBeforeFooter: exp && foot && (exp.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      adjacentBefore: exp && foot && exp.nextElementSibling === foot
    };
  });
  if (!(layout.expBeforeFooter && layout.adjacentBefore)) {
    throw new Error('page-export is not directly before .page-footer: ' + JSON.stringify(layout));
  }
});
