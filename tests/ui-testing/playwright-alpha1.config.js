// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const dotenv = require('dotenv');

// Load environment variables from .env file
const envResult = dotenv.config();
if (envResult.error) {
  console.warn('⚠️  No .env file found, using system environment variables');
} else {
  console.log('✅ Environment variables loaded from .env file');
}

// Check alpha1-specific environment variables
if (!process.env.ZO_BASE_URL) {
  console.warn('⚠️  ZO_BASE_URL not set. Must be provided for alpha1 cloud tests.');
}
if (!process.env.ALPHA1_USER_EMAIL || !process.env.ALPHA1_USER_PASSWORD) {
  console.warn('⚠️  ALPHA1_USER_EMAIL and ALPHA1_USER_PASSWORD must be set for Dex email login');
}

/**
 * Alpha1 Cloud Playwright Configuration
 * Uses Dex "Continue with Email" login flow
 */
module.exports = defineConfig({
  testDir: './playwright-tests',
  testMatch: ['**/Cloud/**/*.spec.js'],
  outputDir: './test-results',
  testIgnore: ['**/test-archives/**', '**/*_old.js'],

  // Custom global setup for Dex email login
  globalSetup: './playwright-tests/utils/global-setup-alpha1.js',
  globalTeardown: './playwright-tests/utils/global-teardown.js',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 3 : 0,
  workers: process.env.CI ? 2 : 5,

  reporter: process.env.CI
    ? [
        ['blob', { outputDir: 'blob-report' }],
      ]
    : [
        ['html', { outputFolder: 'playwright-results/html-report', open: 'never' }],
        ['json', { outputFile: 'playwright-results/report.json' }]
      ],

  use: {
    baseURL: process.env.ZO_BASE_URL,
    trace: 'on-first-retry',
    navigationTimeout: process.env.CI ? 90000 : 30000,
    actionTimeout: process.env.CI ? 45000 : 15000,
    screenshot: process.env.CI ? 'only-on-failure' : 'off',
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },

  timeout: process.env.CI ? 5 * 60 * 1000 : 3 * 60 * 1000,

  expect: {
    timeout: process.env.CI ? 30000 : 10000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1500, height: 1024 },
        permissions: ['clipboard-read', 'clipboard-write'],
        // Reuse auth state from global setup (Dex email login)
        storageState: './playwright-tests/utils/auth/user.json',
      },
    },
  ],
});
