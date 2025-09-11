// Playwright config for POC tests
module.exports = {
  testDir: '.',
  timeout: 15000,
  retries: 2, // Enable retries for flaky test behavior
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  reporter: [
    ['json', { outputFile: 'test-result.json' }]
  ],
};