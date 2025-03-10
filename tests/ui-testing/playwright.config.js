// @ts-check
const { defineConfig, devices } = require('@playwright/test');
import dotenv from 'dotenv';
dotenv.config();

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './playwright-tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 50, // Set the number of workers to 50
  reporter: 'html',
  use: {
    baseURL: process.env["ZO_BASE_URL"],
    trace: 'on-first-retry',
  },
  timeout: 5 * 60 * 1000,
  
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1500, height: 1024 } },
    },
  ],
});
