const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const matchAllLogsData = require("../../../test-data/match_all.json");

// Legacy login function replaced by global authentication via navigateToBase

async function ingestion(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_matchall";
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
    logsdata: matchAllLogsData
  });
  testLogger.debug('API response received', { response });
}

test.describe("Match All Logs Queries testcases", () => {
  let pageManager;

  async function applyQueryButton(page) {
    const search = page.waitForResponse(logData.applyQuery);
    // Strategic 1000ms wait for query preparation - this is functionally necessary
    await page.waitForTimeout(1000);
    await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
      force: true,
    });
    await expect.poll(async () => (await search).status()).toBe(200);
  }

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);
    
    // Navigate to base URL with authentication
    await navigateToBase(page);
    pageManager = new PageManager(page);
    
    // Strategic 500ms wait for post-authentication stabilization - this is functionally necessary
    await page.waitForTimeout(500);
    await ingestion(page);
    // Strategic 500ms wait for ingestion completion - this is functionally necessary
    await page.waitForTimeout(500);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    // Strategic 1000ms wait for logs page stabilization - this is functionally necessary
    await page.waitForTimeout(1000);
    await pageManager.logsPage.selectStream("e2e_matchall"); 
    await applyQueryButton(page);
    
    testLogger.info('Match All test setup completed');
  });

  test("should match logs with simple level=info", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing match_all with simple level=info');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor("match_all('level=info')");
    // Strategic 500ms wait for match_all query processing - this is functionally necessary
    await pageManager.logsPage.waitForTimeout(500);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Match_all level=info query completed successfully');
  });

  test("should match logs with quoted message", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing match_all with quoted message');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('match_all(\'msg="test"\')')
    // Strategic 500ms wait for match_all query processing - this is functionally necessary
    await pageManager.logsPage.waitForTimeout(500);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Match_all quoted message query completed successfully');
  });

  test("should match logs with level and quoted message", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing match_all with level and quoted message');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('match_all(\'level=info msg="test"\')')
    // Strategic 500ms wait for match_all query processing - this is functionally necessary
    await pageManager.logsPage.waitForTimeout(500);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Match_all level and quoted message query completed successfully');
  });

  test("should match logs with stopping collector runner message", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing match_all with stopping collector runner message');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('match_all(\'level=info msg="stopping collector runner..."\')')
    // Strategic 500ms wait for match_all query processing - this is functionally necessary
    await pageManager.logsPage.waitForTimeout(500);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Match_all collector runner message query completed successfully');
  });

  test("should match logs with field value test", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing match_all with field value test');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('match_all(\'field="value=test"\')')
    // Strategic 500ms wait for match_all query processing - this is functionally necessary
    await pageManager.logsPage.waitForTimeout(500);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Match_all field value test query completed successfully');
  });

  test("should match logs with function parameters", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing match_all with function parameters');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('match_all(\'func(param1="a=b", param2>5)\')')
    // Strategic 500ms wait for match_all query processing - this is functionally necessary
    await pageManager.logsPage.waitForTimeout(500);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Match_all function parameters query completed successfully');
  });

  test("should match logs with inequality conditions", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing match_all with inequality conditions');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('match_all(\'status!=200 url=/api/v1/resource?path=test\')')
    // Strategic 500ms wait for match_all query processing - this is functionally necessary
    await pageManager.logsPage.waitForTimeout(500);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Match_all inequality conditions query completed successfully');
  });

  test("should match logs with multiple conditions", {
    tag: ['@matchAllLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing match_all with multiple conditions');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('match_all(\'level!=debug count<=50 size>=1024\')')
    // Strategic 500ms wait for match_all query processing - this is functionally necessary
    await pageManager.logsPage.waitForTimeout(500);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Match_all multiple conditions query completed successfully');
  });

  test.afterEach(async ({ page }) => {
    try {
      // await pageManager.commonActions.flipStreaming();
      testLogger.info('Streaming flipped after test');
    } catch (error) {
      testLogger.warn('Streaming flip failed', { error: error.message });
    }
  });
}); 