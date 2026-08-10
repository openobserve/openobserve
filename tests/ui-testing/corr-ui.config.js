// Playwright config for the Correlation Phase-2 UI suite.
// Stack: vite dev server (wt-correlation-fix web) on :5174 → backend :5090.
// Run: npx playwright test -c corr-ui.config.js
// Env: O2_UI_BASE_URL (default http://localhost:5174), O2_BASE_URL, O2_ROOT_EMAIL/PASSWORD.

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: "./playwright-tests/Correlation",
  testMatch: "**/*.ui.spec.js",
  timeout: 600_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 3,
  retries: 0,
  reporter: [["list"]],
  use: {
    headless: true,
    viewport: { width: 1920, height: 1080 },
    screenshot: "only-on-failure",
  },
};
