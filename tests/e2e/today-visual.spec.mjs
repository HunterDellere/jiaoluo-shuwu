// Visual diagnostic: capture screenshots + DOM state to inspect what
// renders on the Today page and surface the user-reported issues.
import { test } from '@playwright/test';
import fs from 'node:fs';

const TODAY_URL = '/pages/today/';

test('capture today page state', async ({ page }) => {
  // Seed localStorage so we have a streak with history (otherwise the
  // grid only shows one filled dot for today).
  await page.addInitScript(() => {
    const dayKey = (offset) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    const recentDays = [];
    // Simulate a 5-day streak with 3 visits in the prior 14 days.
    for (let i = 0; i < 5; i++) recentDays.push(dayKey(-i));
    recentDays.push(dayKey(-7));
    recentDays.push(dayKey(-9));
    recentDays.push(dayKey(-12));
    localStorage.setItem('shuwo.streak.v1', JSON.stringify({
      v: 1, current: 5, longest: 12, lastDayKey: dayKey(-1), firstDayKey: dayKey(-30),
      totalDays: 18, recentDays, deviceId: 'd_test', updatedAt: new Date().toISOString()
    }));
  });
  await page.goto(TODAY_URL);
  await page.waitForSelector('.tsg-dot', { timeout: 5_000 });
  await page.waitForTimeout(500);

  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/today-full.png', fullPage: true });
  await page.locator('.today-hero').screenshot({ path: 'test-results/today-hero.png' });
  await page.locator('[data-today-streak]').screenshot({ path: 'test-results/today-streak.png' });

  const rotation = page.locator('.today-rotation');
  if (await rotation.count() > 0) {
    await rotation.scrollIntoViewIfNeeded();
    await rotation.screenshot({ path: 'test-results/today-rotation.png' });
  }

  // DOM state for the streak grid.
  const gridState = await page.evaluate(() => {
    const grid = document.querySelector('[data-streak-grid]');
    if (!grid) return { exists: false };
    const dots = Array.from(grid.querySelectorAll('.tsg-dot'));
    const computedGrid = window.getComputedStyle(grid);
    const computedDot = dots.length > 0 ? window.getComputedStyle(dots[0]) : null;
    return {
      exists: true,
      dotCount: dots.length,
      gridRect: grid.getBoundingClientRect(),
      gridParentRect: grid.parentElement.getBoundingClientRect(),
      gridDisplay: computedGrid.display,
      gridFlexWrap: computedGrid.flexWrap,
      gridGap: computedGrid.gap,
      dotWidth: computedDot ? computedDot.width : null,
      dotHeight: computedDot ? computedDot.height : null,
      hits: dots.filter(d => d.classList.contains('is-hit')).length
    };
  });
  console.log('GRID STATE:', JSON.stringify(gridState, null, 2));

  // Streak chip layout
  const chipState = await page.evaluate(() => {
    const chip = document.querySelector('[data-today-streak]');
    const hero = document.querySelector('.today-hero');
    if (!chip || !hero) return null;
    const chipRect = chip.getBoundingClientRect();
    const heroRect = hero.getBoundingClientRect();
    return {
      chip: { x: chipRect.x, y: chipRect.y, w: chipRect.width, h: chipRect.height },
      hero: { x: heroRect.x, y: heroRect.y, w: heroRect.width, h: heroRect.height },
      chipOverflowsHero: chipRect.right > heroRect.right + 1,
      chipOverflowsViewport: chipRect.right > window.innerWidth + 1
    };
  });
  console.log('CHIP STATE:', JSON.stringify(chipState, null, 2));

  // Countdown state
  const countdown = await page.evaluate(() => {
    const el = document.querySelector('[data-rotation-countdown]');
    return el ? { text: el.textContent, visible: el.offsetParent !== null } : null;
  });
  console.log('COUNTDOWN:', JSON.stringify(countdown));

  // Rotation aside layout
  const rotationState = await page.evaluate(() => {
    const el = document.querySelector('.today-rotation');
    if (!el) return { exists: false };
    const rect = el.getBoundingClientRect();
    const main = document.querySelector('main.main');
    const mainRect = main ? main.getBoundingClientRect() : { x: 0, width: 0 };
    return {
      exists: true,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      overflowsMain: rect.right > mainRect.x + mainRect.width + 1,
      kbds: Array.from(el.querySelectorAll('kbd')).map(k => k.textContent)
    };
  });
  console.log('ROTATION:', JSON.stringify(rotationState, null, 2));

  // Test keyboard shortcut "1": does focus actually land on a card?
  await page.keyboard.press('1');
  await page.waitForTimeout(450);
  const afterKey1 = await page.evaluate(() => {
    const ae = document.activeElement;
    return {
      tag: ae ? ae.tagName : null,
      className: ae ? ae.className : null,
      href: ae && ae.href ? ae.href : null,
      entryPath: ae ? ae.getAttribute && ae.getAttribute('data-entry-path') : null
    };
  });
  console.log('AFTER KEY 1:', JSON.stringify(afterKey1, null, 2));
});
