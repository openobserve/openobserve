const { test } = require('./utils/enhanced-baseFixtures.js');
const PageManager = require('../pages/page-manager.js');
const testLogger = require('./utils/test-logger.js');

test.describe("Pre-Test Cleanup", () => {
  /**
   * This cleanup test runs before all UI integration tests
   * It removes all test data from previous runs using API calls
   * This ensures a clean state for all subsequent tests
   */
  test('Clean up all test data via API', {
    tag: ['@cleanup', '@all']
  }, async ({ page }) => {
    testLogger.info('Starting pre-test cleanup');

    const pm = new PageManager(page);

    // Run complete cascade cleanup
    // This will delete:
    // 1. All destinations starting with 'auto_playwright'
    // 2. All alerts blocking those destinations
    // 3. All folders containing those alerts
    // 4. All templates linked to those destinations
    // 5. All remaining folders starting with 'auto_'
    await pm.apiCleanup.completeCascadeCleanup('auto_playwright');

    // Clean up all dashboards owned by automation user
    await pm.apiCleanup.cleanupDashboards();

    testLogger.info('Pre-test cleanup completed successfully');
  });
});
