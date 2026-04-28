// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
const dotenv = require('dotenv');
const testLogger = require('./playwright-tests/utils/test-logger.js');

// Mark this as a cloud environment for page objects and auth helpers
process.env.IS_CLOUD = 'true';

// Load environment variables from .env file
const envResult = dotenv.config();
if (envResult.error) {
  testLogger.warn('No .env file found, using system environment variables');
} else {
  testLogger.info('Environment variables loaded from .env file');
}

// Check alpha1-specific environment variables
if (!process.env.ZO_BASE_URL) {
  testLogger.warn('ZO_BASE_URL not set. Must be provided for alpha1 cloud tests.');
  throw new Error('ZO_BASE_URL must be set to run alpha1 tests');
}
if (!process.env.ALPHA1_USER_EMAIL || !process.env.ALPHA1_USER_PASSWORD) {
  testLogger.warn('ALPHA1_USER_EMAIL and ALPHA1_USER_PASSWORD must be set for Dex email login');
}

// Set ZO_ROOT_USER_* as fallbacks from ALPHA1_* env vars so that spec files
// and utility modules that reference ZO_ROOT_USER_EMAIL/PASSWORD work on cloud
if (!process.env.ZO_ROOT_USER_EMAIL && process.env.ALPHA1_USER_EMAIL) {
  process.env.ZO_ROOT_USER_EMAIL = process.env.ALPHA1_USER_EMAIL;
}
if (!process.env.ZO_ROOT_USER_PASSWORD && process.env.ALPHA1_USER_PASSWORD) {
  process.env.ZO_ROOT_USER_PASSWORD = process.env.ALPHA1_USER_PASSWORD;
}

// On cloud, INGESTION_URL must point to the alpha base URL (not localhost from .env)
if (!process.env.INGESTION_URL || process.env.INGESTION_URL.includes('localhost')) {
  process.env.INGESTION_URL = process.env.ZO_BASE_URL;
  testLogger.info(`INGESTION_URL set to ZO_BASE_URL: ${process.env.ZO_BASE_URL}`);
}

// ORGNAME comes from .env. global-setup-alpha1.js performs a UI org-switch
// post-login so the Pinia store binds API calls to this org, and writes
// cloud-config.json with the matching passcode for ingestion.
testLogger.info(`ORGNAME from .env: ${process.env.ORGNAME}`);

/**
 * Alpha1 Cloud Playwright Configuration
 * Uses Dex "Continue with Email" login flow
 */
module.exports = defineConfig({
  testDir: './playwright-tests',
  testMatch: ['**/*.spec.js'],
  outputDir: './test-results',
  testIgnore: ['**/test-archives/**', '**/*_old.js'],

  // Custom global setup for Dex email login
  globalSetup: './playwright-tests/utils/global-setup-alpha1.js',
  globalTeardown: './playwright-tests/utils/global-teardown.js',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 3,

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
        storageState: path.join(__dirname, 'playwright-tests/utils/auth/user.json'),
      },
    },
  ],
});
