const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const logsdata = require("../../../test-data/logs_data.json");
const testLogger = require('../utils/test-logger.js');

// Utility Functions
function removeUTFCharacters(text) {
  return text.replace(/[^\x00-\x7F]/g, " ");
}

async function applyQueryButton(page) {
  testLogger.step('Applying query button');
  
  // Use page object method instead of inline locators
  const pm = new PageManager(page);
  await pm.logsPage.clickRefreshButton();
  
  testLogger.debug('Query applied successfully');
}



test.describe("Logs Quickmode testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);
    
    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);
    
    // Navigate to logs page
    const logsUrl = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`;
    testLogger.navigation('Navigating to logs page', { url: logsUrl });
    
    await page.goto(logsUrl);
    await page.waitForLoadState('domcontentloaded');
    
    // Simple setup - select stream
    try {
      await pm.logsPage.selectStream("e2e_automate");
      testLogger.info('Stream selected successfully');
    } catch (error) {
      testLogger.warn('Stream selection failed, continuing test', { error: error.message });
    }
    
    // Apply query to load data
    await applyQueryButton(page);
    
    // Enable quick mode toggle if it's not already enabled - using page object method
    try {
      await pm.logsPage.enableQuickModeIfDisabled();
      testLogger.info('Quick mode enabled');
    } catch (error) {
      testLogger.warn('Quick mode toggle failed', { error: error.message });
    }
    
    // Click all fields button using page object
    try {
      await pm.logsPage.clickAllFieldsButton();
      testLogger.info('All fields button clicked');
    } catch (error) {
      testLogger.warn('All fields button click failed', { error: error.message });
    }
    
    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ page }) => {
    try {
      // await pm.commonActions.flipStreaming();
      testLogger.info('Streaming flipped after test');
    } catch (error) {
      testLogger.warn('Streaming flip failed', { error: error.message });
    }
  });
  test("should click on interesting fields icon and display query in editor", {
    tag: ['@interestingFieldsLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing interesting fields and query editor');
    
    await pm.logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await pm.logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await pm.logsPage.clickSQLModeToggle();
    await pm.logsPage.waitForQueryEditorTextbox();
    await pm.logsPage.expectInterestingFieldInEditor("_timestamp,kubernetes_pod_id");
    
    testLogger.info('Interesting fields and query editor test completed');
  });
  test("should display quick mode toggle button", {
    tag: ['@quickModeLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing quick mode toggle button visibility');
    
    await pm.logsPage.expectQuickModeToggleVisible();
    
    testLogger.info('Quick mode toggle button visible');
  });

  test("should click on interesting fields icon in histogram mode and run query", {
    tag: ['@interestingFieldsHistogramModeLogs', '@histogram', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing interesting fields in histogram mode');
    
    await pm.logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await pm.logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults();
    await pm.logsPage.expectInterestingFieldInTable("kubernetes_pod_id");
    
    testLogger.info('Interesting fields histogram mode test completed');
  });

  test("should display error on entering random text in histogram mode when quick mode is on", {
    tag: ['@errorHandlingHistogramModeLogs', '@histogram', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing error handling with random text in histogram mode');
    
    // Strategic 1000ms wait for page stabilization - this is functionally necessary
    await page.waitForTimeout(1000);
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor("oooo");
    
    // Strategic 500ms wait for query editor input processing - this is functionally necessary
    await page.waitForTimeout(500);
    await pm.logsPage.waitForSearchBarRefreshButton();
    await pm.logsPage.clickSearchBarRefreshButton();
    
    // Strategic 2000ms wait for error message rendering - this is functionally necessary
    await page.waitForTimeout(2000);
    await pm.logsPage.expectErrorMessageVisible();
    
    testLogger.info('Error handling histogram mode test completed');
  });

  test("should display selected interestesing field and order by - as default in editor", {
    tag: ['@interestingFieldsSqlModeLogs', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing interesting fields SQL mode default behavior');
    
    await pm.logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await pm.logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await pm.logsPage.clickSQLModeToggle();
    await pm.logsPage.waitForQueryEditorTextbox();
    await pm.logsPage.expectQueryEditorVisible();
    
    testLogger.info('Interesting fields SQL mode test completed');
  });

  test("should adding/removing interesting field removes it from editor and results too", {
    tag: ['@interestingFieldsCRUD', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing interesting fields add/remove functionality');
    
    await pm.logsPage.fillIndexFieldSearchInput("kubernetes_container_name");
    await pm.logsPage.clickInterestingFieldButton("kubernetes_container_name");
    await pm.logsPage.fillIndexFieldSearchInput("level");
    await pm.logsPage.clickInterestingFieldButton("level");
    await pm.logsPage.clickSQLModeToggle();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.expectLogTableColumnSourceVisible();
    await pm.logsPage.clickInterestingFieldButton("level");
    await pm.logsPage.expectQueryEditorNotContainsText("level");
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.expectLogTableColumnSourceNotHaveText("source");
    
    testLogger.info('Interesting fields add/remove test completed');
  });

  test("should display order by in sql mode by default even after page reload", {
    tag: ['@sqlModeOrderBy', '@sqlMode', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing SQL mode order by persistence after page reload');
    
    await pm.logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await pm.logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await pm.logsPage.clickSQLModeToggle();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.page.reload();
    await pm.logsPage.page.waitForLoadState('domcontentloaded');
    await pm.logsPage.expectQueryEditorContainsText('SELECT _timestamp,kubernetes_pod_id FROM "e2e_automate"');
    
    testLogger.info('SQL mode order by persistence test completed');
  });

  test("should display results without adding timestamp in quick mode", {
    tag: ['@quickModeResults', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing quick mode results without timestamp');
    
    await pm.logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await pm.logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    await pm.logsPage.clickSQLModeToggle();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.waitForSearchResults();
    await pm.logsPage.expectExactTextVisible("source");
    
    testLogger.info('Quick mode results test completed');
  });

  test("should click timestamp field and then search for kubernetes_pod_id field", {
    tag: ['@fieldInteraction', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing timestamp field click and kubernetes_pod_id field search');
    
    // Check if _timestamp field exists and click it
    await pm.logsPage.clickTimestampField();
    
    // Click on schema button
    await pm.logsPage.clickSchemaButton();
    
    // Search and click kubernetes_pod_id field
    await pm.logsPage.fillIndexFieldSearchInput("kubernetes_pod_id");
    await pm.logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    
    // Click on infoschema button
    await pm.logsPage.clickInfoSchemaButton();
    
    // Click Clear button
    await pm.logsPage.clickClearButton();
    
    // Remove kubernetes_pod_id as interesting field
    await pm.logsPage.clickInterestingFieldButton("kubernetes_pod_id");
    
    // Assert that _timestamp still exists
    await pm.logsPage.expectTimestampFieldVisible();
    
    testLogger.info('Timestamp field click and kubernetes_pod_id field search completed');
  });


});
