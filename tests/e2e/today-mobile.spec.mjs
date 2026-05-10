// Visual diagnostic on mobile + fresh-visitor states.
import { test } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } }); // iPhone-ish

test('mobile layout — fresh visitor (no localStorage)', async ({ page }) => {
  await page.goto('/pages/today/');
  await page.waitForSelector('.tsg-dot', { timeout: 5_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/today-mobile-fresh.png', fullPage: true });
  await page.locator('.today-hero').screenshot({ path: 'test-results/today-mobile-hero.png' });
  await page.locator('[data-today-streak]').screenshot({ path: 'test-results/today-mobile-streak.png' });
  const rotation = page.locator('.today-rotation');
  await rotation.scrollIntoViewIfNeeded();
  await rotation.screenshot({ path: 'test-results/today-mobile-rotation.png' });

  const state = await page.evaluate(() => {
    const chip = document.querySelector('[data-today-streak]');
    const hero = document.querySelector('.today-hero');
    const rotation = document.querySelector('.today-rotation');
    const main = document.querySelector('main.main');
    const grid = document.querySelector('[data-streak-grid]');
    const dots = grid ? grid.querySelectorAll('.tsg-dot') : [];
    return {
      viewport: window.innerWidth,
      chip: chip ? chip.getBoundingClientRect() : null,
      hero: hero ? hero.getBoundingClientRect() : null,
      main: main ? main.getBoundingClientRect() : null,
      rotation: rotation ? rotation.getBoundingClientRect() : null,
      dotCount: dots.length,
      gridHeight: grid ? grid.getBoundingClientRect().height : null,
      countdown: document.querySelector('[data-rotation-countdown]') && document.querySelector('[data-rotation-countdown]').textContent,
      kbds: Array.from(document.querySelectorAll('.today-rotation-keys kbd')).map(k => k.textContent)
    };
  });
  console.log('MOBILE STATE:', JSON.stringify(state, null, 2));
});
