// Playwright config for the Correlation Phase-1 API-only suite.
// No browser needed — specs use APIRequestContext only.
// Run: npx playwright test -c corr-api.config.js
// Env: O2_BASE_URL (default http://localhost:5090), O2_ROOT_EMAIL, O2_ROOT_PASSWORD.

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: "./playwright-tests/Correlation",
  testMatch: "**/*.api.spec.js",
  timeout: 420_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // serial within files; files run in parallel across workers
  workers: 5,
  retries: 0,
  reporter: [["list"]],
};
