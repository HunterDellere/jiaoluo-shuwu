import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('test-results', { recursive: true });

test('exports page screenshot', async ({ page }) => {
  await page.goto('/pages/exports/');
  await page.waitForSelector('.export-card', { timeout: 5_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/exports-page.png', fullPage: true });
});

test('per-page export buttons screenshot', async ({ page }) => {
  await page.goto('/pages/characters/dao4_%E9%81%93.html');
  await page.waitForSelector('.page-export', { timeout: 5_000 });
  await page.waitForTimeout(300);
  // Capture just the hero + the export bar that follows it.
  const hero = page.locator('header.hero, header.topic-hero').first();
  const exp = page.locator('.page-export');
  const heroBox = await hero.boundingBox();
  const expBox = await exp.boundingBox();
  if (heroBox && expBox) {
    await page.screenshot({
      path: 'test-results/per-page-export.png',
      clip: {
        x: Math.max(0, heroBox.x - 16),
        y: Math.max(0, heroBox.y - 10),
        width: heroBox.width + 32,
        height: (expBox.y + expBox.height) - heroBox.y + 30
      }
    });
  }
});
