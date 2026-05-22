// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const dotenv = require('dotenv');

// Load environment variables
try {
  dotenv.config();
  console.log('✅ Environment variables loaded from .env file');
} catch (error) {
  console.warn('⚠️  dotenv not available');
}

if (!process.env.ZO_BASE_URL || !process.env.ZO_ROOT_USER_EMAIL || !process.env.ZO_ROOT_USER_PASSWORD) {
  console.warn('⚠️  Essential environment variables not found');
}

module.exports = defineConfig({
  testDir: './playwright-tests',
  outputDir: '/tmp/playwright-test-results',
  testIgnore: ['**/test-archives/**', '**/*_old.js'],
  globalSetup: './playwright-tests/utils/global-setup.js',
  globalTeardown: './playwright-tests/utils/global-teardown.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: '/tmp/playwright-test-results/report.json' }]
  ],
  use: {
    baseURL: process.env["ZO_BASE_URL"],
    trace: 'on-first-retry',
    navigationTimeout: 30000,
    actionTimeout: 15000,
    screenshot: 'off',
    video: 'off',
  },
  timeout: 3 * 60 * 1000,
  expect: {
    timeout: 10000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1500, height: 1024 },
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
  ],
});
