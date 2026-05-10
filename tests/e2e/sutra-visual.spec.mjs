// Visual diagnostic for sutra pages — captures hero, passage cards,
// the mantra variant, sticky controls behavior, and mobile layout.
// Outputs into test-results/ so artifacts can be eyeballed without a
// browser handy. Mirrors the today-visual.spec.mjs pattern.
import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const XINJING = '/pages/religion/topic_xinjing.html';
const AMITUOJING = '/pages/religion/topic_amituojing.html';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(REPO_ROOT, 'test-results');
fs.mkdirSync(OUT, { recursive: true });
const out = (n) => path.join(OUT, n);

test('xinjing — desktop', async ({ page }) => {
  await page.goto(XINJING);
  await page.waitForSelector('.sutra-hero', { timeout: 5_000 });
  await page.waitForTimeout(300);

  await page.locator('.sutra-hero').screenshot({ path: out('sutra-xinjing-hero.png') });
  await page.locator('.sutra-controls').screenshot({ path: out('sutra-xinjing-controls.png') });
  await page.locator('#p1').screenshot({ path: out('sutra-xinjing-p1.png') });
  await page.locator('#p10').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await page.locator('#p10').screenshot({ path: out('sutra-xinjing-mantra.png') });
  await page.screenshot({ path: out('sutra-xinjing-full.png'), fullPage: true });

  // Sticky-controls position relative to topnav while scrolled mid-doc.
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(150);
  const stick = await page.evaluate(() => {
    const c = document.querySelector('.sutra-controls');
    const nav = document.querySelector('.topnav');
    if (!c || !nav) return null;
    const cr = c.getBoundingClientRect();
    const nr = nav.getBoundingClientRect();
    return {
      controlsTop: cr.top,
      navBottom: nr.bottom,
      gap: cr.top - nr.bottom,
      overlapsNav: cr.top < nr.bottom - 1,
    };
  });
  fs.writeFileSync(out('sticky-controls.json'), JSON.stringify(stick, null, 2));
  await page.screenshot({ path: out('sutra-xinjing-scrolled.png') });

  // Verify all 10 ordinals rendered at the top of their .passage.
  const ordinals = await page.evaluate(() => {
    const passages = Array.from(document.querySelectorAll('.sutra-frame > .passage'));
    return passages.map(p => {
      const ord = p.querySelector(':scope > .passage-ordinal');
      const head = p.querySelector(':scope > .passage-head');
      return {
        id: p.id,
        ordinalText: ord ? ord.textContent : null,
        ordinalIsFirstChild: ord ? p.firstElementChild === ord : false,
        hasHead: !!head,
        isMantra: p.classList.contains('passage--mantra'),
      };
    });
  });
  console.log('ORDINALS:', JSON.stringify(ordinals, null, 2));

  // Toggle pinyin from the controls and verify a passage now shows it.
  const toggle = page.locator('.sutra-controls .sutra-toggle').first();
  if (await toggle.count() > 0) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await toggle.click();
    await page.waitForTimeout(150);
    const pyVisible = await page.locator('#p1 .passage-py').isVisible();
    console.log('PINYIN TOGGLE → p1.passage-py visible:', pyVisible);
    await page.locator('#p1').screenshot({ path: out('sutra-xinjing-p1-pinyin.png') });
  }
});

test('xinjing — mobile', async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(XINJING);
  await page.waitForSelector('.sutra-hero', { timeout: 5_000 });
  await page.waitForTimeout(250);
  await page.locator('.sutra-hero').screenshot({ path: out('sutra-xinjing-hero-mobile.png') });
  await page.locator('#p1').screenshot({ path: out('sutra-xinjing-p1-mobile.png') });
  await page.locator('#p10').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await page.locator('#p10').screenshot({ path: out('sutra-xinjing-mantra-mobile.png') });
  await ctx.close();
});

test('amituojing — desktop', async ({ page }) => {
  await page.goto(AMITUOJING);
  await page.waitForSelector('.sutra-hero', { timeout: 5_000 });
  await page.waitForTimeout(250);
  await page.locator('.sutra-hero').screenshot({ path: out('sutra-amituojing-hero.png') });
  await page.locator('#p1').screenshot({ path: out('sutra-amituojing-p1.png') });
});
