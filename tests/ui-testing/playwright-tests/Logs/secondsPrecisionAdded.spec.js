const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { startTimeValue, endTimeValue } = require('../../pages/commonActions.js');

test.describe("Seconds Precision Tests", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);
    
    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);
    
    testLogger.info('Test setup completed');
  });

  test('Relative Seconds on Logs page', async ({ page }) => {
    testLogger.info('Testing relative seconds precision on Logs page');
    
    // Step 1: Navigate to Logs Page (already authenticated via global setup)
    await pm.logsPage.navigateToLogs();
    
    // Step 2: Set the time to past 30 seconds and verify
    await pm.logsPage.setTimeToPast30Seconds();
    await pm.logsPage.verifyTimeSetTo30Seconds();
    
    testLogger.info('Seconds precision test completed successfully');
  });
});
