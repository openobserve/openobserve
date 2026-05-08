const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestTestData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe("Logs Histogram testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);
    
    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);
    
    // Strategic post-authentication stabilization wait - this is functionally necessary
    await page.waitForTimeout(1000);
    
    // Data ingestion for histogram testing (preserve exact logic)
    await ingestTestData(page);
    // Strategic wait for data ingestion completion - this is functionally necessary
    await page.waitForTimeout(1000);

    // Navigate to logs page and setup for histogram testing
    await page.goto(
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`
    );
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    await pm.logsPage.selectStream("e2e_automate");
    await page.waitForTimeout(1000);

    // Wait for initial search to complete
    const orgName = getOrgIdentifier();
    const allsearch = page.waitForResponse(`**/api/${orgName}/_search**`, { timeout: 60000 });
    await pm.logsPage.clickRefreshButton();
    await allsearch;
    await page.waitForTimeout(1000);

    testLogger.info('Histogram test setup completed');
  });

  test.afterEach(async () => {
    try {
      // await pm.commonActions.flipStreaming();
      testLogger.info('Streaming flipped after test');
    } catch (error) {
      testLogger.warn('Streaming flip failed', { error: error.message });
    }
  });

  test("Verify error handling and no results found with histogram", {
    tag: ['@histogram', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing error handling and no results found with histogram');

    const orgName = getOrgIdentifier();

    // Ensure histogram is ON
    const isHistogramOn = await pm.logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await pm.logsPage.toggleHistogram();
    }

    await pm.logsPage.disableAutoRun();

    // Step 1: FTS mode — match_all with no-results string
    await pm.logsPage.ensureFTSMode();
    await pm.logsPage.clearAndFillQueryEditor("match_all('asdukiabnfnsajkn')");
    await pm.logsPage.setDateTimeFilter();
    await pm.logsPage.waitForTimeout(500);
    const ftsResponse = page.waitForResponse(`**/api/${orgName}/_search**`, { timeout: 60000 });
    await pm.logsPage.clickRefresh();
    await ftsResponse;
    await pm.logsPage.waitForTimeout(1000);
    await pm.logsPage.clickErrorMessage();

    // Step 2: SQL mode — query that returns 0 rows
    await pm.logsPage.ensureSQLMode();
    await pm.logsPage.clearAndFillQueryEditor("SELECT * FROM 'e2e_automate' where code > 500");
    await pm.logsPage.waitForTimeout(500);
    const sqlResponse = page.waitForResponse(`**/api/${orgName}/_search**`, { timeout: 60000 });
    await pm.logsPage.clickRefresh();
    await sqlResponse;
    await pm.logsPage.waitForTimeout(1000);
    await pm.logsPage.clickNoDataFound();

    await pm.logsPage.enableAutoRun();

    testLogger.info('Error handling and no results verification completed');
  });

  test("Verify error handling with histogram toggle off and on", {
    tag: ['@histogram', '@all', '@logs', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing error handling with histogram toggle off and on');

    const orgName = getOrgIdentifier();

    // Ensure histogram is OFF
    const isHistogramOn = await pm.logsPage.isHistogramOn();
    if (isHistogramOn) {
      await pm.logsPage.toggleHistogram();
    }

    await pm.logsPage.disableAutoRun();

    // Step 1: FTS mode — match_all with no-results string, histogram OFF
    await pm.logsPage.ensureFTSMode();
    await pm.logsPage.clearAndFillQueryEditor("match_all('asdukiabnfnsajkn')");
    await pm.logsPage.setDateTimeFilter();
    await pm.logsPage.waitForTimeout(500);
    const ftsResponse = page.waitForResponse(`**/api/${orgName}/_search**`, { timeout: 60000 });
    await pm.logsPage.clickRefresh();
    await ftsResponse;
    await pm.logsPage.waitForTimeout(1000);
    await pm.logsPage.clickErrorMessage();

    // Toggle histogram ON
    await pm.logsPage.toggleHistogram();

    // Step 2: SQL mode — query that returns 0 rows, histogram ON
    await pm.logsPage.ensureSQLMode();
    await pm.logsPage.clearAndFillQueryEditor("SELECT * FROM 'e2e_automate' where code > 500");
    await pm.logsPage.waitForTimeout(500);
    const sqlResponse = page.waitForResponse(`**/api/${orgName}/_search**`, { timeout: 60000 });
    await pm.logsPage.clickRefresh();
    await sqlResponse;
    await pm.logsPage.waitForTimeout(1000);
    await pm.logsPage.clickNoDataFound();

    await pm.logsPage.enableAutoRun();

    testLogger.info('Histogram toggle error handling verification completed');
  });

  test("Verify histogram toggle persistence after multiple queries", {
    tag: ['@histogram', '@all', '@logs', '@P1']
  }, async () => {
    testLogger.info('Testing histogram toggle persistence after multiple queries');
    
    // Start with histogram on
    const isHistogramOn = await pm.logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await pm.logsPage.toggleHistogram();
    }

    // Run first query
    await pm.logsPage.typeQuery("SELECT * FROM 'e2e_automate' LIMIT 10");
    await pm.logsPage.setDateTimeFilter();
    // Strategic 500ms wait for SQL query processing - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);
    await pm.logsPage.clickRefresh();
    // Strategic 500ms wait for refresh completion - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);

    // Toggle histogram off
    await pm.logsPage.toggleHistogram();
    await pm.logsPage.enableSQLMode();
    // Strategic 500ms wait for SQL mode transition - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);
    await pm.logsPage.enableSQLMode();

    // Run second query
    await pm.logsPage.typeQuery("SELECT count(*) FROM 'e2e_automate'");
    // Strategic 500ms wait for query processing - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);
    await pm.logsPage.clickRefresh();
    // Strategic 500ms wait for refresh completion - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);

    // Verify histogram stays off
    await pm.logsPage.verifyHistogramState();
    
    testLogger.info('Histogram persistence verification completed');
  });

  test("Verify histogram toggle with empty query", {
    tag: ['@histogram', '@all', '@logs', '@P1']
  }, async () => {
    testLogger.info('Testing histogram toggle with empty query');
    
    // Start with histogram off
    const isHistogramOn = await pm.logsPage.isHistogramOn();
    if (isHistogramOn) {
      await pm.logsPage.toggleHistogram();
    }

    // Clear query and refresh
    await pm.logsPage.typeQuery("");
    await pm.logsPage.setDateTimeFilter();
    // Strategic 500ms wait for query processing - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);
    await pm.logsPage.clickRefresh();
    // Strategic 500ms wait for refresh completion - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);

    // Toggle histogram on
    await pm.logsPage.toggleHistogram();

    // Verify histogram state
    const isHistogramOnAfterToggle = await pm.logsPage.isHistogramOn();
    expect(isHistogramOnAfterToggle).toBeTruthy();
    
    testLogger.info('Empty query histogram toggle verification completed');
  });

  test("Verify histogram toggle with complex query", {
    tag: ['@histogram', '@all', '@logs', '@P1']
  }, async () => {
    testLogger.info('Testing histogram toggle with complex query');
    
    // Start with histogram on
    const isHistogramOn = await pm.logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await pm.logsPage.toggleHistogram();
    }

    // Run complex query
    await pm.logsPage.typeQuery("SELECT * FROM 'e2e_automate' WHERE timestamp > '2024-01-01' AND code < 400 GROUP BY code ORDER BY count(*) DESC LIMIT 5");
    await pm.logsPage.setDateTimeFilter();
    // Strategic 500ms wait for complex SQL query processing - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);
    await pm.logsPage.clickRefresh();
    // Strategic 500ms wait for refresh completion - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);

    // Toggle histogram off and verify
    await pm.logsPage.toggleHistogram();
    const isHistogramOff = await pm.logsPage.isHistogramOn();
    expect(!isHistogramOff).toBeTruthy();

    // Run another query and verify histogram stays off
    await pm.logsPage.typeQuery("SELECT count(*) FROM 'e2e_automate'");
    // Strategic 500ms wait for query processing - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);
    await pm.logsPage.clickRefresh();
    // Strategic 500ms wait for refresh completion - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);

    const isHistogramStillOff = await pm.logsPage.isHistogramOn();
    expect(!isHistogramStillOff).toBeTruthy();
    
    testLogger.info('Complex query histogram toggle verification completed');
  });
}); 