// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Fallback to .env file if environment variables are not set
 * This allows both UI runner (which sets env vars) and terminal usage (which uses .env)
 */
function loadEnvironmentVariables() {
  // Check if essential env vars are already set (from UI runner)
  if (process.env.ZO_BASE_URL && process.env.ZO_ROOT_USER_EMAIL && process.env.ZO_ROOT_USER_PASSWORD) {
    console.log('Using environment variables from UI runner');
    return;
  }

  // Fallback to .env file for terminal usage
  try {
    require('dotenv').config();
    console.log('Using environment variables from .env file');
  } catch (error) {
    console.warn('dotenv not available, using existing environment variables');
  }
}

// Load environment variables
loadEnvironmentVariables();

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './playwright-tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 5 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env["ZO_BASE_URL"],

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    },
   timeout: 5 * 60 * 1000,
   
  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1500, height: 1024 }, },
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

