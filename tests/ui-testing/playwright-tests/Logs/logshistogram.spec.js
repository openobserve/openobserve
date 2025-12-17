const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const logsdata = require('../../../test-data/logs_data.json');

// Utility Functions

// Legacy login function replaced by global authentication via navigateToBase

async function ingestTestData(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_automate";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
  const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
    const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(logsdata)
    });
    return await fetchResponse.json();
  }, {
    url: process.env.INGESTION_URL,
    headers: headers,
    orgId: orgId,
    streamName: streamName,
    logsdata: logsdata
  });
  testLogger.debug('API response received', { response });
}

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
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    await pm.logsPage.selectStream("e2e_automate");
    await page.waitForTimeout(1000);

    // Wait for initial search to complete
    const orgName = process.env.ORGNAME || 'default';
    const allsearch = page.waitForResponse(`**/api/${orgName}/_search**`, { timeout: 60000 });
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await allsearch;
    await page.waitForTimeout(1000);

    testLogger.info('Histogram test setup completed');
  });

  test.afterEach(async ({ page }) => {
    try {
      // await pm.commonActions.flipStreaming();
      testLogger.info('Streaming flipped after test');
    } catch (error) {
      testLogger.warn('Streaming flip failed', { error: error.message });
    }
  });

  test("Verify error handling and no results found with histogram", {
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing error handling and no results found with histogram');

    // Check if histogram is off and toggle it on if needed
    const isHistogramOn = await pm.logsPage.isHistogramOn();
    if (!isHistogramOn) {
      await pm.logsPage.toggleHistogram();
    }

    // Type invalid query and verify error
    await pm.logsPage.clearAndFillQueryEditor("match_all('invalid')");
    await pm.logsPage.setDateTimeFilter();
    await pm.logsPage.waitForTimeout(1000);

    // Wait for search response before checking for error
    const orgName = process.env.ORGNAME || 'default';
    const searchResponse = page.waitForResponse(`**/api/${orgName}/_search**`, { timeout: 60000 });
    await pm.logsPage.clickRefresh();
    await searchResponse;
    await pm.logsPage.waitForTimeout(2000);

    await pm.logsPage.clickErrorMessage();
    await pm.logsPage.clickResetFilters();

    // Type SQL query and verify no results
    await pm.logsPage.clearAndFillQueryEditor("SELECT count(*) FROM 'e2e_automate' where code > 500");
    await pm.logsPage.waitForTimeout(1000);

    // Wait for search response before checking for no data
    const sqlSearchResponse = page.waitForResponse(`**/api/${orgName}/_search**`, { timeout: 60000 });
    await pm.logsPage.clickRefresh();
    await sqlSearchResponse;
    await pm.logsPage.waitForTimeout(2000);

    await pm.logsPage.clickNoDataFound();
    await pm.logsPage.clickResultDetail();

    testLogger.info('Error handling and no results verification completed');
  });

  test("Verify error handling with histogram toggle off and on", {
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing error handling with histogram toggle off and on');
    
    // Check if histogram is on and toggle it off
    const isHistogramOn = await pm.logsPage.isHistogramOn();
    if (isHistogramOn) {
      await pm.logsPage.toggleHistogram();
    }

    // Type invalid query and verify error
    await pm.logsPage.typeQuery("match_all('invalid')");
    await pm.logsPage.setDateTimeFilter();
    // Strategic 500ms wait for query processing - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);
    await pm.logsPage.clickRefresh();
    await pm.logsPage.clickErrorMessage();
    await pm.logsPage.clickResetFilters();

    // Toggle histogram back on
    await pm.logsPage.toggleHistogram();

    // Type SQL query and verify no results
    await pm.logsPage.typeQuery("SELECT count(*) FROM 'e2e_automate' where code > 500");
    // Strategic 500ms wait for SQL query processing - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);
    await pm.logsPage.clickRefresh();
    // Strategic 500ms wait for SQL refresh completion - this is functionally necessary
    await pm.logsPage.waitForTimeout(500);
    await pm.logsPage.clickNoDataFound();
    await pm.logsPage.clickResultDetail();
    
    testLogger.info('Histogram toggle error handling verification completed');
  });

  test("Verify histogram toggle persistence after multiple queries", {
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
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
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
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
    tag: ['@histogram', '@all', '@logs']
  }, async ({ page }) => {
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