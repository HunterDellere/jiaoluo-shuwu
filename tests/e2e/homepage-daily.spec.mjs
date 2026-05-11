// Smoke tests for the homepage daily-draw section. Verifies:
//   1. The #daily-draw section renders above #recent.
//   2. The four chips populate with real entries (not skeletons).
//   3. The streak chip renders with either a numeric count or the
//      "begin a streak" zero state.
//   4. The picks on the homepage agree with the picks on /pages/today/
//      for the same UTC day (the load-bearing acceptance criterion —
//      they share a single seeded module).
import { test, expect } from '@playwright/test';

test.describe('Homepage daily draw', () => {
  test('daily-draw section renders above recent', async ({ page }) => {
    await page.goto('/');
    const daily = page.locator('#daily-draw');
    const recent = page.locator('#recent');
    await expect(daily).toBeVisible();
    await expect(recent).toBeVisible();
    const dBox = await daily.boundingBox();
    const rBox = await recent.boundingBox();
    expect(dBox.y).toBeLessThan(rBox.y);
  });

  test('four daily chips render with real content', async ({ page }) => {
    await page.goto('/');
    // Wait for the section to lose its skeleton chips (JS swaps them in).
    await page.waitForFunction(() => {
      const chips = document.querySelectorAll('#daily-draw .daily-chip');
      if (chips.length !== 4) return false;
      return Array.from(chips).every(c => !c.classList.contains('is-skeleton'));
    }, { timeout: 5000 });
    const chips = page.locator('#daily-draw .daily-chip');
    await expect(chips).toHaveCount(4);
  });

  test('streak chip renders numeric or zero state', async ({ page }) => {
    await page.goto('/');
    const streak = page.locator('#daily-draw [data-daily-streak]');
    await expect(streak).toBeVisible();
    const num = (await streak.locator('.dd-streak-num').textContent() || '').trim();
    // Either a number (≥1) or the dot we render for streak === 0.
    expect(num === '·' || /^\d+$/.test(num)).toBeTruthy();
  });

  test('picks match /pages/today/ for the same day', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => {
      const chips = document.querySelectorAll('#daily-draw .daily-chip');
      return chips.length === 4 && Array.from(chips).every(c => !c.classList.contains('is-skeleton'));
    }, { timeout: 5000 });
    const homepageHrefs = await page.locator('#daily-draw .daily-chip').evaluateAll(els =>
      els.map(e => e.getAttribute('href')).filter(Boolean)
    );

    await page.goto('/pages/today/');
    await page.waitForFunction(() => {
      const slots = ['character','vocab','grammar','chengyu'];
      return slots.every(s => {
        const slot = document.querySelector(`[data-today-slot="${s}"]`);
        return slot && slot.querySelector('a.today-card');
      });
    }, { timeout: 5000 });
    const todayHrefs = await page.locator('[data-today-slot] a.today-card').evaluateAll(els =>
      els.map(e => e.getAttribute('href'))
    );

    // Homepage hrefs are root-relative ("pages/x/y.html"); Today page hrefs
    // are relative to /pages/today/ ("../x/y.html"). Normalize both to the
    // bare entry path before comparing.
    const norm = h => String(h).replace(/^\.\.\//, 'pages/');
    expect(homepageHrefs.map(norm).sort()).toEqual(todayHrefs.map(norm).sort());
  });
});
