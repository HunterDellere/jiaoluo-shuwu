// E2E coverage for the social-carousel exporter:
//   - The /pages/share/ builder page loads the source via ?page=
//   - Slides render to <canvas> elements at the requested format size
//   - Switching format re-renders slides at the new dimensions
//   - The "Carousel" affordance appears in the footer of a content page
//     and links to the builder with the source pre-loaded
import { test, expect } from '@playwright/test';

const SOURCE_PATH = 'pages/characters/ai4_爱.html';

test.describe('Share — carousel builder', () => {
  test('loads source page and renders slides as canvases', async ({ page }) => {
    await page.goto('/pages/share/?page=' + encodeURIComponent(SOURCE_PATH));
    // Wait for the status line to land in the OK state.
    await expect(page.locator('[data-share-status]')).toContainText(/slides rendered/i, { timeout: 8000 });

    const canvases = page.locator('.share-slide-canvas');
    const count = await canvases.count();
    expect(count).toBeGreaterThanOrEqual(4);
    expect(count).toBeLessThanOrEqual(10);

    // Square format default — every canvas should be 1080×1080.
    const first = canvases.first();
    await expect(first).toHaveAttribute('width', '1080');
    await expect(first).toHaveAttribute('height', '1080');

    // The download-all button should be enabled.
    await expect(page.locator('[data-share-download-zip]')).toBeEnabled();
  });

  test('switching format re-renders slides at new dimensions', async ({ page }) => {
    await page.goto('/pages/share/?page=' + encodeURIComponent(SOURCE_PATH));
    await expect(page.locator('[data-share-status]')).toContainText(/slides rendered/i, { timeout: 8000 });

    await page.locator('[data-share-format="story"]').click();
    await expect(page.locator('[data-share-status]')).toContainText(/slides rendered/i, { timeout: 8000 });
    const first = page.locator('.share-slide-canvas').first();
    await expect(first).toHaveAttribute('width', '1080');
    await expect(first).toHaveAttribute('height', '1920');
  });

  test('renders for a topic page with chengyu content', async ({ page }) => {
    await page.goto('/pages/share/?page=' + encodeURIComponent('pages/chengyu/huashetianzu_画蛇添足.html'));
    await expect(page.locator('[data-share-status]')).toContainText(/slides rendered/i, { timeout: 8000 });
    const count = await page.locator('.share-slide-canvas').count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('shows empty state when no ?page= query', async ({ page }) => {
    await page.goto('/pages/share/');
    await expect(page.locator('[data-share-empty]')).toBeVisible();
  });
});

test.describe('Carousel affordance on content pages', () => {
  test('character page footer has a Carousel link to the builder', async ({ page }) => {
    await page.goto('/' + SOURCE_PATH);
    const link = page.locator('a.pf-btn-carousel');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toContain('share/');
    expect(href).toContain('page=pages/characters/ai4_');
  });
});
