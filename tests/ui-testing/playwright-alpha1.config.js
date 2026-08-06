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

// Shared browser context for the chromium project.
const CHROME_USE = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1500, height: 1024 },
  permissions: ['clipboard-read', 'clipboard-write'],
  // Reuse auth state from global setup (Dex email login). Filename is canonical;
  // multi-user splitting happens at the CI layer (each shard downloads its own
  // user's artifact into this path). See global-setup-alpha1.js AUTH_FILE.
  storageState: path.join(__dirname, 'playwright-tests/utils/auth/user.json'),
  // Chromium launch flags for the EKS (Kubernetes) runners. --disable-dev-shm-usage
  // is the critical one: containers default to a 64MB /dev/shm, which Chromium
  // exhausts under parallel load (5 workers) on long/heavy shards — the renderer
  // then crashes and the pod hits memory pressure, surfacing as "runner lost
  // communication" (OOMKill/eviction) with a frozen step + 404 logs. Routing shared
  // memory to /tmp (disk) instead is the standard fix. The sandbox/gpu flags are the
  // usual container-safe defaults (no user namespaces / no GPU on the runners).
  launchOptions: {
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
    ],
  },
};

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
  // The heavy Alerts specs contend on the shared alpha org's slow list fetches under
  // concurrent load. Rather than serialize them, they run fully in parallel and rely on
  // (a) the page-object resilience (bounded retry loops + settle waits for slow stream/
  // destination/template dropdown fetches) and (b) this suite-wide retry to absorb any
  // residual contention flake. Only failing tests retry, so passing runs are unaffected.
  retries: process.env.CI ? 2 : 0,
  workers: 3,

  reporter: process.env.CI
    ? [
        ['blob', { outputDir: 'blob-report' }],
        // Prints a LOUD banner to stdout whenever a test is retried (blob writes nothing to
        // the log, so retries are otherwise invisible in the CI output). Log-only, never fails.
        ['./playwright-tests/utils/retry-banner-reporter.js'],
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
      // Single project — every test runs fully in parallel.
      name: 'chromium',
      use: CHROME_USE,
    },
  ],
});
