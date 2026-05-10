// Verify the reading-time badge renders on content pages and is absent
// on family / hsk / index pages.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('reading-time badge renders on character page', async ({ page }) => {
  await page.goto('/pages/characters/dao4_%E9%81%93.html');
  const badge = page.locator('.topic-hero-meta-time');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/~\d+ min/);
  fs.mkdirSync('test-results', { recursive: true });
  await page.locator('header.hero, header.topic-hero').first().screenshot({
    path: 'test-results/reading-time-character.png'
  });
});

test('reading-time badge renders on vocab page', async ({ page }) => {
  await page.goto('/pages/vocab/mianzi_%E9%9D%A2%E5%AD%90.html');
  const badge = page.locator('.topic-hero-meta-time');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/~\d+ min/);
  await page.locator('header.topic-hero').screenshot({
    path: 'test-results/reading-time-topic.png'
  });
});

test('reading-time badge skipped on family-index pages', async ({ page }) => {
  await page.goto('/pages/families/explore.html');
  const badge = page.locator('.topic-hero-meta-time');
  await expect(badge).toHaveCount(0);
});

test('reading-time floor of 2 minutes', async ({ page }) => {
  // Pick a chengyu page (small body) and verify floor.
  await page.goto('/pages/chengyu/maodun_%E7%9F%9B%E7%9B%BE.html');
  const badge = page.locator('.topic-hero-meta-time');
  await expect(badge).toBeVisible();
  const text = await badge.textContent();
  const m = (text || '').match(/~(\d+) min/);
  expect(m).toBeTruthy();
  expect(parseInt(m[1], 10)).toBeGreaterThanOrEqual(2);
});
