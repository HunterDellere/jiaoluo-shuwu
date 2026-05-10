// Test streak chip across a range of streak lengths to make sure the
// number doesn't blow out the chip when it grows from 1 to 999.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const STREAKS = [
  { current: 0, longest: 0, total: 0 },
  { current: 1, longest: 1, total: 1 },
  { current: 8, longest: 12, total: 25 },
  { current: 47, longest: 47, total: 102 },
  { current: 365, longest: 365, total: 600 }
];

fs.mkdirSync('test-results', { recursive: true });

for (const s of STREAKS) {
  test(`streak ${s.current}`, async ({ page }) => {
    await page.addInitScript((seed) => {
      const dayKey = (offset) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      };
      const recentDays = [];
      for (let i = 0; i < Math.min(seed.current, 14); i++) recentDays.push(dayKey(-i));
      localStorage.setItem('shuwo.streak.v1', JSON.stringify({
        v: 1, current: seed.current, longest: seed.longest, totalDays: seed.total,
        lastDayKey: dayKey(0), firstDayKey: dayKey(-seed.total),
        recentDays, deviceId: 'd_test', updatedAt: new Date().toISOString()
      }));
    }, s);
    await page.goto('/pages/today/');
    await page.waitForSelector('.tsg-dot', { timeout: 5_000 });
    await page.waitForTimeout(300);
    await page.locator('[data-today-streak]').screenshot({
      path: `test-results/streak-${s.current}.png`
    });

    // Chip should not exceed its hero column.
    const measurements = await page.evaluate(() => {
      const chip = document.querySelector('[data-today-streak]');
      const hero = document.querySelector('.today-hero');
      const chipRect = chip.getBoundingClientRect();
      const heroRect = hero.getBoundingClientRect();
      const grid = document.querySelector('[data-streak-grid]');
      const gridRect = grid ? grid.getBoundingClientRect() : null;
      const num = document.querySelector('[data-streak-count]');
      const numRect = num ? num.getBoundingClientRect() : null;
      return { chip: chipRect, hero: heroRect, grid: gridRect, num: numRect };
    });
    // Grid height should be ≤ 24px (single line of 9px dots + gap).
    expect(measurements.grid.height).toBeLessThanOrEqual(28);
  });
}
