// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const dotenv = require('dotenv');
// Load environment variables from .env file
try {
  dotenv.config();
  console.log('✅ Environment variables loaded from .env file');
} catch (error) {
  console.warn('⚠️  dotenv not available, using system environment variables');
}

// Check if essential environment variables are set
if (!process.env.ZO_BASE_URL || !process.env.ZO_ROOT_USER_EMAIL || !process.env.ZO_ROOT_USER_PASSWORD) {
  console.warn('⚠️  Essential environment variables not found. Make sure to set ZO_BASE_URL, ZO_ROOT_USER_EMAIL, and ZO_ROOT_USER_PASSWORD');
}

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './playwright-tests',
  /* Output directory for test artifacts */
  outputDir: './test-results',
  /* Exclude archived tests from all test runs */
  testIgnore: ['**/test-archives/**', '**/*_old.js'],
  /* Global setup and teardown */
  globalSetup: './playwright-tests/utils/global-setup.js',
  globalTeardown: './playwright-tests/utils/global-teardown.js',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry failed tests: 3 times on CI, 0 times locally */
  retries: process.env.CI ? 3 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 5 : 5,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI
    ? [
        ['blob', { outputDir: 'blob-report' }], // Use blob reporter in CI - JSON created during merge
      ]
    : [
        ['html', { outputFolder: 'playwright-results/html-report', open: 'never' }], // HTML reporter
        ['json', { outputFile: 'playwright-results/report.json' }] // JSON reporter for TestDino
      ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env["ZO_BASE_URL"],

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Navigation and action timeouts for CI stability */
    navigationTimeout: process.env.CI ? 90000 : 30000,
    actionTimeout: process.env.CI ? 45000 : 15000,

    /* Capture screenshots and videos on failure for CI debugging */
    screenshot: process.env.CI ? 'only-on-failure' : 'off',
    video: process.env.CI ? 'retain-on-failure' : 'off',

    /* Slow down execution for Pipeline tests on deployed environments to avoid sync issues */
    slowMo: (process.env.SLOW_MO_TESTS === 'true' && process.env.TEST_SHARD === 'Pipelines') ? 1000 : 0,
    },
  /* Test timeout: 3 minutes locally, 5 minutes in CI */
  timeout: process.env.CI ? 5 * 60 * 1000 : 3 * 60 * 1000,

  /* Expect timeout for assertions - increased for deployed envs */
  expect: {
    timeout: process.env.CI ? 30000 : 10000,
  },
   
  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1500, height: 1024 },
        // Grant clipboard permissions for share link tests
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    //   {
    //   name: 'webkit', // Safari/WebKit configuration
    //   use: {
    //     ...devices['Desktop Safari'], // Uses Playwright's pre-defined device settings for Safari
    //     viewport: { width: 1500, height: 1024 },
    //   },
    // },
    // }

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // }
  
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://127.0.0.1:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});