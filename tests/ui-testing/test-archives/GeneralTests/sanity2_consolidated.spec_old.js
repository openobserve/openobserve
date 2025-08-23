const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe("Sanity2 Test Cases", () => {
  let pm;

  test.beforeEach(async ({ page }) => {
    // Initialize test setup
    await navigateToBase(page);
    pm = new PageManager(page);
    
    testLogger.info('Test setup completed');
  });

  // Settings Tests
  test("should change settings successfully", async ({ page }) => {
    testLogger.info('Testing settings change functionality');
    
    await pm.sanityPage.changeSettingsSuccessfully();
    
    testLogger.info('Settings change test completed');
  });

  // Stream Stats Tests
  test("should display results on click refresh stats", async ({ page }) => {
    testLogger.info('Testing stream stats refresh functionality');
    
    await pm.sanityPage.displayResultsOnRefreshStats();
    
    testLogger.info('Stream stats refresh test completed');
  });

  // Schema Pagination Tests
  test("should display pagination for schema", async ({ page }) => {
    testLogger.info('Testing schema pagination functionality');
    
    await pm.sanityPage.displayPaginationForSchema();
    
    testLogger.info('Schema pagination test completed');
  });

  // Advanced Histogram Pagination Tests
  test("should display pagination when histogram is off and clicking and closing the result", async ({ page }) => {
    testLogger.info('Testing histogram off with pagination functionality');
    
    await pm.sanityPage.displayPaginationWhenHistogramOffWithResult();
    
    testLogger.info('Histogram off pagination test completed');
  });

  test("should display pagination when only SQL is on clicking and closing the result", async ({ page }) => {
    testLogger.info('Testing SQL mode with pagination functionality');
    
    await pm.sanityPage.displayPaginationWhenOnlySQLWithResult();
    
    testLogger.info('SQL mode pagination test completed');
  });

  // Histogram SQL Mode Tests
  test("should display histogram in sql mode", async ({ page }) => {
    testLogger.info('Testing histogram in SQL mode functionality');
    
    await pm.sanityPage.displayHistogramInSQLMode();
    
    testLogger.info('Histogram SQL mode test completed');
  });

  test("should display results when SQL+histogram is on and then stream is selected", async ({ page }) => {
    testLogger.info('Testing SQL+histogram with stream selection functionality');
    
    await pm.sanityPage.displayResultsWhenSQLHistogramOnWithStreamSelection();
    
    testLogger.info('SQL+histogram stream selection test completed');
  });
});