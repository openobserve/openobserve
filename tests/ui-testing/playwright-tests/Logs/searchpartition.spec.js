const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

async function applyQuery(pm) {
  const search = pm.page.waitForResponse(logData.applyQuery, { timeout: 90000 });
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
      `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`
    );
    await pm.logsPage.selectStream("e2e_automate");
    await applyQuery(pm);
    
    testLogger.info('Search partition test setup completed');
  });

  test("should verify search partition and search API calls for histogram query", {
    tag: ['@searchPartition', '@logs', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing search partition and histogram query functionality');
    
    const isStreamingEnabled = process.env["ZO_STREAMING_ENABLED"] === "true";
    const histogramQuery = `SELECT histogram(_timestamp) as "x_axis_1", count(distinct(kubernetes_container_name)) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;
    
    // Setup and execute query
    await pm.logsPage.executeHistogramQuery(histogramQuery);

    if (!isStreamingEnabled) {
      testLogger.info('Testing non-streaming mode partition verification');

      // Set up response listeners BEFORE the action that triggers them
      const orgName = getOrgIdentifier() || 'default';
      const searchPartitionPromise = pm.page.waitForResponse(
        response =>
          response.url().includes(`/api/${orgName}/_search_partition`) &&
          response.request().method() === 'POST',
        { timeout: 90000 }
      );

      await pm.logsPage.toggleHistogramAndExecute();

      // Verify search partition response (listener was set up before action)
      const searchPartitionResponse = await searchPartitionPromise;
      const searchPartitionData = await searchPartitionResponse.json();
      expect(searchPartitionData).toHaveProperty('partitions');
      expect(searchPartitionData).toHaveProperty('histogram_interval');
      expect(searchPartitionData).toHaveProperty('order_by', 'asc');

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
      await pm.logsPage.toggleHistogramAndExecute();
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

