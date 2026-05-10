// Minimal Playwright config: spins up the static-site server on a free
// port and tears it down when the suite finishes. We don't need parallel
// workers, fixtures, or projects — these are smoke tests for the Today
// page only.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 15_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: 'python3 -m http.server 4173',
    url: 'http://localhost:4173/index.html',
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
