// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// Load KINORA_TOKEN / KINORA_URL from a local .env if present (not committed).
try { require('dotenv').config(); } catch { /* dotenv optional */ }

/**
 * POC config: points the kinora reporter at the locally self-hosted server.
 * KINORA_URL + KINORA_TOKEN come from the environment (.env), never hard-coded.
 */
module.exports = defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  // One retry so a flaky test that passes on retry is reported as "flaky", not "failed".
  retries: 1,
  workers: 3,
  reporter: [
    ['list'],
    ['@kinora/reporter', {
      project: { slug: 'openobserve-e2e-poc', name: 'OpenObserve E2E (POC)' },
      // url defaults to env KINORA_URL; token defaults to env KINORA_TOKEN.
    }],
  ],
  use: {
    // Required so failures/flakes upload a viewable trace to kinora.
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
