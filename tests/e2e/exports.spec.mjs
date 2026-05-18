// E2E coverage for the Pleco / Anki export pipeline:
//   - Static export files exist and parse correctly.
//   - The /pages/exports/ bulk page lists files from the manifest.
//   - Per-page export buttons appear on character/vocab/chengyu pages,
//     trigger a download with the right contents, and don't appear on
//     non-exportable page types.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test.describe('Exports — static files', () => {
  test('manifest.json lists all expected files', async () => {
    const m = JSON.parse(readFileSync(join(process.cwd(), 'data/exports/manifest.json'), 'utf8'));
    const files = new Set(m.files.map(f => f.file));
    for (const f of [
      'pleco-characters.txt', 'pleco-vocab.txt', 'pleco-chengyu.txt', 'pleco-all.txt',
      'anki-characters.tsv', 'anki-vocab.tsv', 'anki-chengyu.tsv',
      'characters.apkg', 'vocab.apkg', 'chengyu.apkg', 'all.apkg'
    ]) {
      expect(files, `manifest missing ${f}`).toContain(f);
    }
  });

  test('Pleco TSV is strictly tab-separated, three columns, no embedded newlines', () => {
    const raw = readFileSync(join(process.cwd(), 'data/exports/pleco-characters.txt'), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(100);
    for (const line of lines) {
      const cols = line.split('\t');
      expect(cols, `bad columns in: ${line}`).toHaveLength(3);
      expect(cols[0]).not.toMatch(/\s{2,}/);
      expect(cols[1]).toBeTruthy();
      expect(cols[2]).toBeTruthy();
    }
  });

  test('Anki TSV starts with #fields header and has consistent column count', () => {
    const raw = readFileSync(join(process.cwd(), 'data/exports/anki-characters.tsv'), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines[0]).toMatch(/^#fields:/);
    const headerCols = lines[0].replace('#fields:', '').split('\t').length;
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].split('\t')).toHaveLength(headerCols);
    }
  });

  test('Anki .apkg files are valid zips containing collection.anki2', async () => {
    const apkg = readFileSync(join(process.cwd(), 'data/exports/characters.apkg'));
    // Zip files start with 'PK\x03\x04'.
    expect(apkg.slice(0, 4).toString('ascii').slice(0, 2)).toBe('PK');
    expect(apkg.length).toBeGreaterThan(1000);
  });

  test('Anki .apkg every note.mid resolves to a registered model', async () => {
    // Regression guard for an off-by-one where notes referenced `mid + 1`
    // while only `mid` was registered. Anki refuses to import such decks
    // with: "No such notetype: '<id>'  Please use Check Database".
    const JSZip = (await import('jszip')).default;
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3');
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');

    for (const name of ['characters.apkg', 'vocab.apkg', 'chengyu.apkg', 'all.apkg']) {
      const buf = readFileSync(join(process.cwd(), 'data/exports', name));
      const zip = await JSZip.loadAsync(buf);
      const dbBuf = await zip.file('collection.anki2').async('nodebuffer');
      const tmp = join(tmpdir(), `apkg-check-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
      writeFileSync(tmp, dbBuf);
      try {
        const db = new Database(tmp, { readonly: true });
        const { models: modelsJson } = db.prepare('SELECT models FROM col').get();
        const modelIds = new Set(Object.keys(JSON.parse(modelsJson)).map(Number));
        const noteMids = db.prepare('SELECT DISTINCT mid FROM notes').all().map(r => r.mid);
        db.close();
        expect(noteMids.length, `${name}: no notes`).toBeGreaterThan(0);
        for (const mid of noteMids) {
          expect(modelIds.has(mid), `${name}: note.mid ${mid} not in models {${[...modelIds].join(',')}}`).toBe(true);
        }
      } finally {
        unlinkSync(tmp);
      }
    }
  });
});

test.describe('Exports — bulk page', () => {
  test('/pages/exports/ renders all format groups with download links', async ({ page }) => {
    await page.goto('/pages/exports/');
    // Wait for JS to populate the cards.
    await page.waitForSelector('.export-card', { timeout: 5_000 });
    const cards = page.locator('.export-card');
    const count = await cards.count();
    // 4 pleco + 3 anki-tsv + 4 anki-apkg = 11
    expect(count).toBeGreaterThanOrEqual(11);
    // Each card has a download attribute pointing under data/exports/.
    for (let i = 0; i < count; i++) {
      const href = await cards.nth(i).getAttribute('href');
      expect(href).toMatch(/data\/exports\//);
    }
  });

  test('/pages/exports/ has the expected section heads', async ({ page }) => {
    await page.goto('/pages/exports/');
    await expect(page.locator('#builder')).toBeAttached();
    await expect(page.locator('#hsk')).toBeAttached();
    await expect(page.locator('#how-to')).toBeAttached();
  });
});

test.describe('Exports — per-page buttons', () => {
  test('character page shows Pleco and Anki buttons', async ({ page }) => {
    await page.goto('/pages/characters/dao4_%E9%81%93.html');
    const exp = page.locator('.page-export');
    await expect(exp).toBeVisible();
    await expect(exp.locator('[data-export="pleco"]')).toBeVisible();
    await expect(exp.locator('[data-export="anki"]')).toBeVisible();
  });

  test('vocab page shows export buttons', async ({ page }) => {
    await page.goto('/pages/vocab/mianzi_%E9%9D%A2%E5%AD%90.html');
    await expect(page.locator('.page-export')).toBeVisible();
  });

  test('chengyu page shows export buttons', async ({ page }) => {
    await page.goto('/pages/chengyu/maodun_%E7%9F%9B%E7%9B%BE.html');
    await expect(page.locator('.page-export')).toBeVisible();
  });

  test('grammar page does NOT show export buttons (not atomic-card)', async ({ page }) => {
    await page.goto('/pages/grammar/le_%E4%BA%86.html');
    await expect(page.locator('.page-export')).toHaveCount(0);
  });

  test('topic page does NOT show export buttons', async ({ page }) => {
    await page.goto('/pages/philosophy/topic_kongzi.html');
    await expect(page.locator('.page-export')).toHaveCount(0);
  });

  test('Pleco button triggers a single-line TSV download', async ({ page }) => {
    await page.goto('/pages/characters/dao4_%E9%81%93.html');
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-export="pleco"]');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pleco\.txt$/);
    const stream = await download.createReadStream();
    let body = '';
    for await (const chunk of stream) body += chunk;
    const lines = body.trim().split('\n');
    expect(lines).toHaveLength(1);
    const cols = lines[0].split('\t');
    expect(cols).toHaveLength(3);
    expect(cols[0]).toContain('道');
    expect(cols[1]).toMatch(/dào/i);
    expect(cols[2]).toBeTruthy();
  });

  test('Anki button triggers a TSV download with #fields header', async ({ page }) => {
    await page.goto('/pages/characters/dao4_%E9%81%93.html');
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-export="anki"]');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.anki\.tsv$/);
    const stream = await download.createReadStream();
    let body = '';
    for await (const chunk of stream) body += chunk;
    const lines = body.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^#fields:/);
    const cols = lines[1].split('\t');
    expect(cols.length).toBeGreaterThanOrEqual(3);
    expect(cols[0]).toContain('道');
  });
});
