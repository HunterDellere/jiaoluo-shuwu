// Smoke tests for /pages/today/. Verifies the issues Hunter reported:
//   1. The 14-day streak grid renders inside the streak chip without
//      breaking the chip's layout.
//   2. The "Picks rotate in <countdown>" countdown shows a real value,
//      not the placeholder "—".
//   3. Keyboard shortcuts 1–4 + T + R are handled.
//
// We don't try to test full UI fidelity here — just that the wiring
// works end-to-end.
import { test, expect } from '@playwright/test';

const TODAY_URL = '/pages/today/';

test.describe('Today page', () => {
  test('streak chip renders without overflowing its container', async ({ page }) => {
    await page.goto(TODAY_URL);
    // Streak counter has rendered (i.e. JS ran).
    await expect(page.locator('[data-streak-count]')).not.toHaveText('—');

    // Visit grid is present and has 14 dots.
    const dots = page.locator('.tsg-dot');
    await expect(dots).toHaveCount(14);

    // The streak chip should not exceed its hero column width — i.e.
    // the grid wraps inside the chip rather than blowing it out.
    const chip = page.locator('[data-today-streak]');
    const chipBox = await chip.boundingBox();
    expect(chipBox).toBeTruthy();
    // Today hero is the parent; its width should fully contain the chip.
    const hero = page.locator('.today-hero');
    const heroBox = await hero.boundingBox();
    expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(heroBox.x + heroBox.width + 1);
  });

  test('rotation countdown ticks to a real value', async ({ page }) => {
    await page.goto(TODAY_URL);
    const countdown = page.locator('[data-rotation-countdown]');
    // Wait for JS to set the countdown.
    await expect(countdown).not.toHaveText('—', { timeout: 5_000 });
    const text = (await countdown.textContent()) || '';
    // Should match e.g. "14h 22m", "5h", "30 min", "just now".
    expect(text).toMatch(/^(\d+h(\s\d+m)?|\d+\smin|just now)$/);
  });

  test('keyboard shortcut "1" jumps focus into the character pick', async ({ page }) => {
    await page.goto(TODAY_URL);
    // Wait for picks to render (skeleton replaced).
    await page.waitForSelector('[data-today-slot="character"] a.today-card', { timeout: 5_000 });
    await page.keyboard.press('1');
    // The character card link should be focused after the smooth-scroll
    // delay (250ms in code; allow margin).
    await page.waitForTimeout(450);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-entry-path'));
    expect(focused).toBeTruthy();
    expect(focused).toMatch(/characters\//);
  });

  test('keyboard shortcut "t" jumps to the thread', async ({ page }) => {
    await page.goto(TODAY_URL);
    await page.waitForSelector('#today-thread-card a', { timeout: 5_000 });
    await page.keyboard.press('t');
    await page.waitForTimeout(450);
    const inThread = await page.evaluate(() => {
      const ae = document.activeElement;
      return !!(ae && ae.closest && ae.closest('#today-thread-card'));
    });
    expect(inThread).toBe(true);
  });

  test('hero pinyin gloss is present for accessibility', async ({ page }) => {
    await page.goto(TODAY_URL);
    // The character 今日 in the eyebrow should have an adjacent pinyin
    // gloss "jīnrì" so a non-reader can sound it out.
    const eyebrow = page.locator('.topic-hero-eyebrow').first();
    const text = (await eyebrow.textContent()) || '';
    expect(text).toContain('jīnrì');
  });

  test('today section heads have CN + pinyin + EN labels', async ({ page }) => {
    await page.goto(TODAY_URL);
    // Each numbered section has sh-cn + sh-py + sh-en. Check thread + 4 picks.
    const heads = page.locator('.today-section-head');
    const count = await heads.count();
    expect(count).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < count; i++) {
      const head = heads.nth(i);
      await expect(head.locator('.sh-cn')).toBeVisible();
      await expect(head.locator('.sh-py')).toBeVisible();
      await expect(head.locator('.sh-en')).toBeVisible();
    }
  });

  test('hero title shows CN, pinyin, and English', async ({ page }) => {
    await page.goto(TODAY_URL);
    await expect(page.locator('.today-hero-title-cn')).toHaveText('今日阅读');
    await expect(page.locator('.today-hero-title-py')).toHaveText('jīnrì yuèdú');
    await expect(page.locator('.today-hero-title-en')).toHaveText("Today's reading");
  });

  test('rotation aside shows CN + pinyin + EN', async ({ page }) => {
    await page.goto(TODAY_URL);
    await expect(page.locator('.today-rotation-cn')).toHaveText('轮换');
    await expect(page.locator('.today-rotation-py')).toHaveText('lúnhuàn');
  });

  test('streak tab shows 连 with pinyin gloss', async ({ page }) => {
    await page.goto(TODAY_URL);
    const tab = page.locator('.today-streak-tab');
    await expect(tab).toBeVisible();
    await expect(tab.locator('span[lang=zh]')).toHaveText('连');
    await expect(tab.locator('.today-streak-tab-py')).toHaveText('lián');
  });

  test('thread TOC entry has 线 + xiàn pinyin', async ({ page }) => {
    await page.goto(TODAY_URL);
    const entry = page.locator('a[href="#today-thread"]');
    await expect(entry.locator('.toc-cn')).toHaveText('线');
    await expect(entry.locator('.toc-py')).toHaveText('xiàn');
  });

  test('streak chip stays inside hero column at all viewport widths', async ({ page }) => {
    for (const vp of [{ width: 375, height: 812 }, { width: 720, height: 900 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(vp);
      await page.goto(TODAY_URL);
      await page.waitForSelector('.tsg-dot', { timeout: 5_000 });
      const measurements = await page.evaluate(() => {
        const chip = document.querySelector('[data-today-streak]');
        const main = document.querySelector('main.main');
        const chipRect = chip.getBoundingClientRect();
        const mainRect = main.getBoundingClientRect();
        const grid = document.querySelector('[data-streak-grid]');
        const gridRect = grid.getBoundingClientRect();
        return { chipRect, mainRect, gridRect, gridChildren: grid.children.length };
      });
      // Chip never exceeds main column.
      expect(measurements.chipRect.right).toBeLessThanOrEqual(measurements.mainRect.right + 1);
      // Grid contains 14 dots.
      expect(measurements.gridChildren).toBe(14);
      // Grid sits inside its chip parent.
      expect(measurements.gridRect.right).toBeLessThanOrEqual(measurements.chipRect.right + 1);
      expect(measurements.gridRect.left).toBeGreaterThanOrEqual(measurements.chipRect.left - 1);
    }
  });

  test('keyboard 2,3,4 also jump to their respective picks', async ({ page }) => {
    await page.goto(TODAY_URL);
    await page.waitForSelector('[data-today-slot="chengyu"] a.today-card', { timeout: 5_000 });
    const cases = [
      { key: '2', match: /vocab\// },
      { key: '3', match: /grammar\// },
      { key: '4', match: /chengyu\// }
    ];
    for (const c of cases) {
      await page.keyboard.press(c.key);
      await page.waitForTimeout(450);
      const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-entry-path'));
      expect(focused, `key ${c.key}`).toMatch(c.match);
    }
  });
});
