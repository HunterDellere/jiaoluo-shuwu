import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('test-results', { recursive: true });

test('exports page screenshot', async ({ page }) => {
  await page.goto('/pages/exports/');
  await page.waitForSelector('.export-card', { timeout: 5_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/exports-page.png', fullPage: true });
});

test('per-page export buttons sit above the page footer', async ({ page }) => {
  await page.goto('/pages/characters/dao4_%E9%81%93.html');
  await page.waitForSelector('.page-export', { timeout: 5_000 });
  await page.waitForTimeout(300);

  // Verify positioning: .page-export should be a previous sibling of
  // .page-footer (or anywhere above it in document order, but adjacent
  // is what we want here).
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

  // Screenshot the export bar + footer together so the bottom-of-page
  // placement is visible.
  const exp = page.locator('.page-export');
  await exp.scrollIntoViewIfNeeded();
  const expBox = await exp.boundingBox();
  const footBox = await page.locator('.page-footer').boundingBox();
  if (expBox && footBox) {
    await page.screenshot({
      path: 'test-results/per-page-export.png',
      clip: {
        x: Math.max(0, expBox.x - 16),
        y: Math.max(0, expBox.y - 30),
        width: Math.max(expBox.width, footBox.width) + 32,
        height: (footBox.y + footBox.height) - expBox.y + 50
      }
    });
  }
});
