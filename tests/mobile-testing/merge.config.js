// Used ONLY by `playwright merge-reports -c` in the merge_reports CI job.
// The Android (Linux) and iOS (macOS) blob reports embed different ABSOLUTE testDir paths
// (/home/runner/... vs /Users/runner/...). Playwright refuses to merge reports recorded with
// different testDirs unless a merge config supplies a single one — this normalizes them to
// the relative ./specs so the combined HTML/JSON report builds regardless of which OS produced it.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './specs',
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'report.json' }],
  ],
});
