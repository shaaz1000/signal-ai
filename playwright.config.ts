import { defineConfig } from '@playwright/test';

const CI = Boolean(process.env.CI);
// Every test worker shares one address, so the per-client API limit is lifted for the test server only.
const env = { PGLITE_DIR: '.data/e2e', DATABASE_URL: '', LOG_SILENT: '1', API_RATE_LIMIT: '100000' };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
  webServer: [
    {
      // Seeds fixtures, builds the Artifact and the app, then serves the production build.
      command: 'npx tsx scripts/e2e-prepare.ts && npx next start -p 3100',
      url: 'http://localhost:3100/api/status',
      timeout: 420_000,
      reuseExistingServer: !CI,
      env,
    },
    {
      command: 'npx tsx scripts/preview-artifact.ts --port 3101 --dir dist/artifact-e2e',
      url: 'http://localhost:3101/health',
      timeout: 60_000,
      reuseExistingServer: !CI,
    },
  ],
});
