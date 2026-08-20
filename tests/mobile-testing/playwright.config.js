const { defineConfig } = require('@playwright/test');
require('dotenv').config({ path: __dirname + '/.env' });

// One emulator + shared app state → serialize. Flows + async ingestion need long timeouts.
module.exports = defineConfig({
  testDir: './specs',
  timeout: 6 * 60 * 1000,
  expect: { timeout: 30000 },
  fullyParallel: false,
  workers: 1,
  retries: 1, // absorb transient network drops to the internal dev instance
  // In CI each device job (separate runner) emits a `blob` report that the merge_reports job combines
  // into one HTML report (survives failures). Locally, write a browsable HTML report directly.
  reporter: process.env.CI
    ? [['list'], ['blob', { fileName: process.env.BLOB_REPORT_NAME || 'report.zip' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.OO_URL,
    actionTimeout: 20000, // no single action may hang the whole test
    navigationTimeout: 60000,
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'rn-android', testMatch: /rn-android\..*\.spec\.js/ },
    { name: 'android-native', testMatch: /android-native\..*\.spec\.js/ },
    { name: 'rn-ios', testMatch: /rn-ios\..*\.spec\.js/ },
    { name: 'ios-native', testMatch: /ios-native\..*\.spec\.js/ },
    // Docs-freshness check (no device); all skipped for now — see sdk-version-drift.spec.js.
    { name: 'sdk-drift', testMatch: /sdk-version-drift\.spec\.js/ },
  ],
});
