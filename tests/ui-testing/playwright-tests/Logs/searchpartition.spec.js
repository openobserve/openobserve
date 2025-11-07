const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const logsdata = require("../../../test-data/logs_data.json");

// Utility Functions

// Legacy setup function replaced by global authentication via navigateToBase

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

async function applyQuery(pm) {
  const search = pm.page.waitForResponse(logData.applyQuery);
  // CRITICAL: Search preparation wait - allows histogram query partitioning to initialize
  await pm.page.waitForTimeout(3000);
  await pm.logsPage.clickRefreshButton();
  await expect.poll(async () => (await search).status()).toBe(200);
}

test.describe("Search Partition Tests", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);
    
    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);
    
    // CRITICAL: Post-authentication stabilization wait
    await page.waitForTimeout(2000);
    
    // Ingest test data for partition testing (preserve exact logic)
    await ingestTestData(page);
    
    // Navigate to logs page and setup for partition testing
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await pm.logsPage.selectStream("e2e_automate");
    await applyQuery(pm);
    
    testLogger.info('Search partition test setup completed');
  });

  test("should verify search partition and search API calls for histogram query", async ({ page }) => {
    testLogger.info('Testing search partition and histogram query functionality');
    
    const isStreamingEnabled = process.env["ZO_STREAMING_ENABLED"] === "true";
    const histogramQuery = `SELECT histogram(_timestamp) as "x_axis_1", count(distinct(kubernetes_container_name)) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;
    
    // Setup and execute query
    await pm.logsPage.executeHistogramQuery(histogramQuery);
    await pm.logsPage.toggleHistogramAndExecute();

    if (!isStreamingEnabled) {
      testLogger.info('Testing non-streaming mode partition verification');
      
      // Verify search partition response
      const searchPartitionData = await pm.logsPage.verifySearchPartitionResponse();
      const searchCalls = await pm.logsPage.captureSearchCalls();
      
      expect(searchCalls.length).toBe(searchPartitionData.partitions.length);

      // Verify each partition has a matching search call
      for (const partition of searchPartitionData.partitions) {
        const matchingCall = searchCalls.find(call => 
          call.start_time === partition[0] && 
          call.end_time === partition[1]
        );
        expect(matchingCall).toBeTruthy();
        expect(matchingCall.sql).toContain('SELECT histogram(_timestamp');
      }
      
      testLogger.info('Search partition verification completed successfully', {
        partitions: searchPartitionData.partitions.length,
        searchCalls: searchCalls.length
      });
    } else {
      testLogger.info('Testing streaming mode response verification');
      
      await pm.logsPage.clickRunQueryButtonAndVerifyStreamingResponse();
      
      testLogger.info('Streaming mode verification completed');
    }

    // Verify histogram state
    await pm.logsPage.verifyHistogramState();
    testLogger.info('Histogram state verification completed');
  });

  test.afterEach(async ({ page }) => {
    try {
      // await pm.commonActions.flipStreaming();
      testLogger.info('Streaming flipped after test');
    } catch (error) {
      testLogger.warn('Streaming flip failed', { error: error.message });
    }
  });
});

