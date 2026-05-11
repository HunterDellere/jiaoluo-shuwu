import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(REPO_ROOT, 'test-results');
mkdirSync(OUT, { recursive: true });
const out = (n) => path.join(OUT, n);

test('collections family page shows the exports promo and it links to the hub', async ({ page }) => {
  await page.goto('/pages/families/collections.html');
  await page.waitForSelector('.exports-promo', { timeout: 5_000 });
  await page.waitForTimeout(150);
  const promo = page.locator('.exports-promo');
  await promo.scrollIntoViewIfNeeded();
  await promo.screenshot({ path: out('exports-promo-collections.png') });
  const href = await promo.getAttribute('href');
  if (!href || !/\/exports\/?$/.test(href)) {
    throw new Error('exports-promo href should resolve to /pages/exports/, got: ' + href);
  }
});

test('explore family page shows the exports promo', async ({ page }) => {
  await page.goto('/pages/families/explore.html');
  await page.waitForSelector('.exports-promo', { timeout: 5_000 });
  await page.waitForTimeout(150);
  const promo = page.locator('.exports-promo');
  await promo.scrollIntoViewIfNeeded();
  await promo.screenshot({ path: out('exports-promo-explore.png') });
});
