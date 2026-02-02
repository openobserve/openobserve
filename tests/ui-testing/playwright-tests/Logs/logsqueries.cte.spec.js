const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const cteQueriesData = require("../../../test-data/cte_queries.json");

// Legacy login function replaced by global authentication via navigateToBase

async function ingestion(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_cte";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
  
  try {
    const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
      const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(logsdata)
      });
      if (!fetchResponse.ok) {
        throw new Error(`HTTP error! status: ${fetchResponse.status}`);
      }
      return await fetchResponse.json();
    }, {
      url: process.env.INGESTION_URL,
      headers: headers,
      orgId: orgId,
      streamName: streamName,
      logsdata: cteQueriesData
    });
    testLogger.info('Ingestion response', { response });
    return response;
  } catch (error) {
    testLogger.error('Ingestion failed', { error });
    throw error;
  }
}

test.describe("CTE Logs Queries testcases", () => {
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
    await pageManager.logsPage.selectStream("e2e_cte"); 
    await applyQueryButton(page);
    
    testLogger.info('CTE test setup completed');
  });

  test("should query with simple TotalCols CTE", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing simple TotalCols CTE query');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH TotalCols AS ( SELECT * FROM "e2e_cte" ) SELECT message FROM TotalCols');
    // Strategic 500ms wait for CTE query processing - this is functionally necessary
    await pageManager.logsPage.waitForTimeout(500);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('TotalCols CTE query completed successfully');
  });

  test("should query with Cleaned CTE for container names", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing Cleaned CTE for container names');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH Cleaned AS (SELECT message, kubernetes_container_name AS container, kubernetes_pod_name FROM "e2e_cte" WHERE kubernetes_container_name IS NOT NULL) SELECT container, kubernetes_pod_name, message FROM Cleaned');
    // Strategic 500ms wait for CTE query processing - this is functionally necessary
    await pageManager.logsPage.waitForTimeout(500);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Cleaned CTE query completed successfully');
  });

  test("should query with FilteredLogs CTE for org messages", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing FilteredLogs CTE for org messages');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH FilteredLogs AS (SELECT * FROM "e2e_cte" WHERE str_match_ignore_case(message, \'org\')) SELECT message, kubernetes_pod_name FROM FilteredLogs');
    // Strategic 500ms wait for CTE query processing - this is functionally necessary
    await pageManager.logsPage.waitForTimeout(500);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('FilteredLogs CTE query completed successfully');
  });

  test("should query with Counts CTE for pod log counts", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing Counts CTE for pod log counts');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH Counts AS (SELECT kubernetes_pod_name, COUNT(*) AS log_count FROM "e2e_cte" GROUP BY kubernetes_pod_name) SELECT * FROM Counts WHERE log_count > 1');
    // Strategic 500ms wait for CTE query processing - this is functionally necessary
    await pageManager.logsPage.waitForTimeout(500);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Counts CTE query completed successfully');
  });

  test("should query with Levels CTE for log level counts", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing Levels CTE for log level counts');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH Levels AS (SELECT level, COUNT(*) as level_count FROM "e2e_cte" GROUP BY level) SELECT * FROM Levels ORDER BY level_count DESC');
    // Strategic 500ms wait for CTE query processing - this is functionally necessary
    await pageManager.logsPage.waitForTimeout(500);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Levels CTE query completed successfully');
  });

  test("should query with Normalized CTE for timeout messages", {
    tag: ['@cteLogs', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing Normalized CTE for timeout messages');
    
    await pageManager.logsPage.clickDateTimeButton();
    await pageManager.logsPage.clickRelative15MinButton();
    await pageManager.logsPage.clickQueryEditor();
    await pageManager.logsPage.typeInQueryEditor('WITH Normalized AS (SELECT COALESCE(message, \'No message\') AS normalized_message FROM "e2e_cte") SELECT * FROM Normalized WHERE normalized_message LIKE \'%timeout%\'');
    // Strategic 500ms wait for CTE query processing - this is functionally necessary
    await pageManager.logsPage.waitForTimeout(500);
    await pageManager.logsPage.clickSearchBarRefreshButton();
    await pageManager.logsPage.expectLogTableColumnSourceVisible();
    
    testLogger.info('Normalized CTE query completed successfully');
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