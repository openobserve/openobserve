const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

// Utility Functions

// Legacy login function replaced by global authentication via navigateToBase 

test.describe("Join for logs", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);
    
    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);
    
    // Strategic 500ms wait for post-authentication stabilization - this is functionally necessary
    await page.waitForTimeout(500);
    
    // Data ingestion for join testing (preserve exact logic)
    await pm.ingestionPage.ingestion();
    await pm.ingestionPage.ingestionJoin();
    
    testLogger.info('Join test setup completed');
  });

  test("Run query after selecting two streams", async ({ page }) => {
    testLogger.info('Testing run query with two streams selection');
    
    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.displayTwoStreams();
    await pm.logsPage.selectRunQuery();
    
    testLogger.info('Two streams query execution completed');
  });

  test("Run query after selecting two streams and SQL Mode On", async ({ page }) => {
    testLogger.info('Testing two streams query with SQL Mode enabled');
    
    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.displayTwoStreams();
    
    testLogger.info('Two streams SQL Mode query completed');
  });

  test("Run query after selecting two streams, selecting field and SQL Mode On", async ({ page }) => {
    testLogger.info('Testing two streams with field selection and SQL Mode');
    
    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.kubernetesContainerName();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.validateResult();
    
    testLogger.info('Field selection with SQL Mode query validated successfully');
  });

  test("Run query after selecting two streams, SQL Mode On and entering join queries", async ({ page }) => {
    testLogger.info('Testing join queries with SQL Mode enabled');
    
    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.kubernetesContainerNameJoin();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.displayCountQuery();
    await pm.logsPage.validateResult();
    
    testLogger.info('Join queries execution and validation completed');
  });

  test("Run query after selecting two streams, SQL Mode On and entering join limit", async ({ page }) => {
    testLogger.info('Testing join queries with limit clause');
    
    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.kubernetesContainerNameJoinLimit();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.validateResult();
    
    testLogger.info('Join limit query validation completed');
  });

  test("Run query after selecting two streams, SQL Mode On and entering join like", async ({ page }) => {
    testLogger.info('Testing join queries with LIKE clause');
    
    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.kubernetesContainerNameJoinLike();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    
    testLogger.info('Join LIKE query execution completed');
  });

  test("Run query after selecting two streams, SQL Mode On and entering Left join queries", async ({ page }) => {
    testLogger.info('Testing LEFT JOIN queries');
    
    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.kubernetesContainerNameLeftJoin();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.validateResult();
    
    testLogger.info('LEFT JOIN query validation completed');
  });

  test("Run query after selecting two streams, SQL Mode On and entering Right join queries", async ({ page }) => {
    testLogger.info('Testing RIGHT JOIN queries');
    
    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.kubernetesContainerNameRightJoin();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.validateResult();
    
    testLogger.info('RIGHT JOIN query validation completed');
  });

  test("Run query after selecting two streams, SQL Mode On and entering Full join queries", async ({ page }) => {
    testLogger.info('Testing FULL JOIN queries');
    
    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.kubernetesContainerNameFullJoin();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.validateResult();
    
    testLogger.info('FULL JOIN query validation completed');
  });

  test("Click on interesting field icon and display field in editor", async ({ page }) => {
    testLogger.info('Testing interesting field display functionality');
    
    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.clickQuickModeToggle();
    await pm.logsPage.clickAllFieldsButton();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.clickInterestingFields();
    await pm.logsPage.validateInterestingFields();
    
    testLogger.info('Interesting field display validation completed');
  });

  test("Click on interesting field icon and display query in editor", async ({ page }) => {
    testLogger.info('Testing interesting field query display functionality');
    
    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.clickQuickModeToggle();
    await pm.logsPage.clickAllFieldsButton();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.clickInterestingFields();
    await pm.logsPage.validateInterestingFieldsQuery();
    
    testLogger.info('Interesting field query display validation completed');
  });

  test("Add/remove interesting field removes it from editor and results too", async ({ page }) => {
    testLogger.info('Testing add/remove interesting field functionality');
    
    await pm.logsPage.navigateToLogs();
    await pm.logsPage.selectIndexAndStreamJoin();
    await pm.logsPage.enableSQLMode();
    await pm.logsPage.clickQuickModeToggle();
    await pm.logsPage.clickAllFieldsButton();
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.clickInterestingFields();
    await pm.logsPage.addRemoveInteresting();
    
    testLogger.info('Add/remove interesting field functionality completed');
  });

  test.afterEach(async ({ page }) => {
    try {
      await pm.commonActions.flipStreaming();
      testLogger.info('Streaming flipped after test');
    } catch (error) {
      testLogger.warn('Streaming flip failed', { error: error.message });
    }
  });
});
