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
  await page.waitForTimeout(400);

  await page.screenshot({ path: out('exports-page.png'), fullPage: true });

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
    return out;
  });
  for (const k of Object.keys(counts)) {
    if (counts[k] === 0) throw new Error(`section "${k}" rendered 0 cards`);
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
