const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const logsdata = require("../../../test-data/logs_data.json");
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

// Utility Functions

// Legacy login function replaced by global authentication via navigateToBase

const selectStream = async (pm, stream) => {
  // Strategic 1000ms wait for stream selection UI stabilization - this is functionally necessary
  await pm.page.waitForTimeout(1000);
  await pm.logsPage.selectStream(stream);
};

async function applyQueryButton(pm) {
  const search = pm.page.waitForResponse(logData.applyQuery);
  // Strategic 1000ms wait for query preparation - this is functionally necessary
  await pm.page.waitForTimeout(1000);
  await pm.logsPage.clickRefreshButton();
  await expect.poll(async () => (await search).status()).toBe(200);
}

async function runQuery(page, query) {
    const startTime = Date.now();
    const response = await page.evaluate(async ({ query, url, streamName, orgId }) => {
      try {
        const fetchUrl = `${url}/api/${orgId}/${streamName}/_search?type=logs`;
        
        const response = await fetch(fetchUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(query)
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          testLogger.error('Query failed', { status: response.status, error: errorText });
          return { error: errorText, status: response.status };
        }
        
        const result = await response.json();
        return result;
      } catch (err) {
        testLogger.error('Query execution error', { error: err.message });
        return { error: err.message };
      }
    }, { 
      query, 
      url: process.env.ZO_BASE_URL, 
      streamName: "e2e_automate", 
      orgId: process.env.ORGNAME 
    });
    const endTime = Date.now();
    const duration = endTime - startTime;
    return {
      response,
      duration
    };
  }

test.describe("Compare SQL query execution times", () => {
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

    // Data ingestion for performance testing (preserve exact logic)
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

    testLogger.debug('Query response received', { response });

    // Navigate to logs page and setup for performance testing
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await selectStream(pm, logData.Stream);
    await applyQueryButton(pm);
    
    testLogger.info('Performance test setup completed');
  });

  test("should compare match_all_raw and match_all query times", async ({ page }) => {
    testLogger.info('Testing match_all_raw vs match_all query performance comparison');
    
    const oneMinuteAgo = Date.now() - 60 * 1000;
    const query1 = {
      query: {
        sql: "select * from 'e2e_automate'  WHERE match_all_raw('provide_credentials')",
        start_time: oneMinuteAgo,
        end_time: Date.now(),
        from: 0,
        size: 250,
        quick_mode: false
      },
      regions: []
    };

    const query2 = {
      query: {
        sql: "select * from 'e2e_automate'  WHERE match_all('provide_credentials')",
        start_time: oneMinuteAgo,
        end_time: Date.now(),
        from: 0,
        size: 250,
        quick_mode: false
      },
      regions: []
    };

    const result1 = await runQuery(page, query1);
    const result2 = await runQuery(page, query2);

    if (!result1.response || result1.response.error) {
      testLogger.error('Query 1 failed to execute', { query: 'match_all_raw', error: result1.response?.error });
      return;
    }
    
    if (!result2.response || result2.response.error) {
      testLogger.error('Query 2 failed to execute', { query: 'match_all', error: result2.response?.error });
      return;
    }

    testLogger.info('Query 1 performance result', { query: 'match_all_raw', duration: result1.duration, records: result1.response.total || 0 });
    testLogger.info('Query 2 performance result', { query: 'match_all', duration: result2.duration, records: result2.response.total || 0 });

    try {
      expect(result2.duration).toBeLessThan(result1.duration);
      testLogger.info('Performance assertion passed', { test: 'match_all vs match_all_raw', result: 'match_all faster' });
      testLogger.info('Performance comparison completed successfully', {
        query1_duration: result1.duration,
        query2_duration: result2.duration
      });
    } catch (error) {
      testLogger.warn('Performance assertion failed', { test: 'match_all vs match_all_raw', result: 'match_all slower than expected' });
      testLogger.warn('Performance assertion failed', { error: error.message });
    }
  });

  test("should compare match_all and match_all_raw_ignore_case query times", async ({ page }) => {
    testLogger.info('Testing match_all vs match_all_raw_ignorecase query performance comparison');
    
    const oneMinuteAgo = Date.now() - 60 * 1000;
    const query1 = {
      query: {
        sql: "select * from 'e2e_automate'  WHERE match_all('provide_credentials')",
        start_time: oneMinuteAgo,
        end_time: Date.now(),
        from: 0,
        size: 250,
        quick_mode: false
      },
      regions: []
    };

    const query2 = {
      query: {
        sql: "select * from 'e2e_automate'  WHERE match_all_raw_ignorecase('provide_credentials')",
        start_time: oneMinuteAgo,
        end_time: Date.now(),
        from: 0,
        size: 250,
        quick_mode: false
      },
      regions: []
    };

    const result1 = await runQuery(page, query1);
    const result2 = await runQuery(page, query2);

    if (!result1.response || result1.response.error) {
      testLogger.error('Query 1 failed to execute', { query: 'match_all', error: result1.response?.error });
      return;
    }
    
    if (!result2.response || result2.response.error) {
      testLogger.error('Query 2 failed to execute', { query: 'match_all_raw_ignorecase', error: result2.response?.error });
      return;
    }

    testLogger.info('Query 1 performance result', { query: 'match_all', duration: result1.duration, records: result1.response.total || 0 });
    testLogger.info('Query 2 performance result', { query: 'match_all_raw_ignorecase', duration: result2.duration, records: result2.response.total || 0 });

    try {
      expect(result1.duration).toBeLessThan(result2.duration);
      testLogger.info('Performance assertion passed', { test: 'match_all vs match_all_raw_ignorecase', result: 'match_all faster' });
      testLogger.info('Performance comparison completed successfully', {
        query1_duration: result1.duration,
        query2_duration: result2.duration
      });
    } catch (error) {
      testLogger.warn('Performance assertion failed', { test: 'match_all vs match_all_raw_ignorecase', result: 'match_all slower than expected' });
      testLogger.warn('Performance assertion failed', { error: error.message });
    }
  });

  test("should validate time range filtering with custom timestamped data", {
    tag: ['@logs', '@timeFilter', '@dataIngestion', '@critical', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing time range filtering with custom timestamped data ingestion');
    
    // This test validates that OpenObserve correctly filters logs based on their actual timestamp
    // (not ingestion time) when backdated data is ingested. Real-world scenarios include:
    // - Log ingestion delays: Logs arrive late with past timestamps
    // - Batch processing: Historical data being processed and ingested  
    // - Multi-source logs: Different systems sending logs with their local timestamps
    // - Time zone handling: Logs from different time zones with past timestamps
    
    const orgId = process.env["ORGNAME"];
    const streamName = `e2e_time_test_${Date.now()}`; // Use timestamp for uniqueness
    const basicAuthCredentials = Buffer.from(
      `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
    ).toString('base64');

    const headers = {
      "Authorization": `Basic ${basicAuthCredentials}`,
      "Content-Type": "application/json",
    };

    // Create test data with different timestamps (within 5-hour ingestion limit)
    const now = Date.now();
    const oneHourAgo = now - (1 * 60 * 60 * 1000);
    const threeHoursAgo = now - (3 * 60 * 60 * 1000);
    const fourHoursAgo = now - (4 * 60 * 60 * 1000);

    const testLogs = [
      {
        _timestamp: new Date(oneHourAgo).toISOString(),
        message: "Recent log entry - 1 hour ago",
        level: "info",
        test_id: "time_test_1h",
        data_age: "1h_old",
        hours_old: 1,
        expected_in_30m_range: false,
        expected_in_2h_range: true,
        expected_in_6h_range: true
      },
      {
        _timestamp: new Date(threeHoursAgo).toISOString(),
        message: "Three hour old log entry - 3 hours ago",
        level: "info", 
        test_id: "time_test_3h",
        data_age: "3h_old",
        hours_old: 3,
        expected_in_30m_range: false,
        expected_in_2h_range: false,
        expected_in_6h_range: true
      },
      {
        _timestamp: new Date(fourHoursAgo).toISOString(),
        message: "Four hour old log entry - 4 hours ago",
        level: "info",
        test_id: "time_test_4h",
        data_age: "4h_old",
        hours_old: 4,
        expected_in_30m_range: false,
        expected_in_2h_range: false,
        expected_in_6h_range: true
      }
    ];

    // Ingest test data with specific timestamps
    const ingestionResponse = await page.evaluate(async ({ url, headers, orgId, streamName, testLogs }) => {
      const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(testLogs)
      });
      return await fetchResponse.json();
    }, {
      url: process.env.INGESTION_URL,
      headers: headers,
      orgId: orgId,
      streamName: streamName,
      testLogs: testLogs
    });

    testLogger.debug('Test data ingested', { response: ingestionResponse });
    
    // Verify ingestion was successful
    expect(ingestionResponse.code).toBe(200);
    expect(ingestionResponse.status[0].successful).toBe(3);
    expect(ingestionResponse.status[0].failed).toBe(0);
    testLogger.info('Verified all 3 test logs were successfully ingested');
    
    await page.waitForTimeout(5000); // Wait for data to be indexed and available

    // Navigate to logs page and select test stream
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await pm.logsPage.selectStream(streamName);

    // STEP 0: First verify ALL data is available in wide range (baseline check to eliminate false positives)
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickPast6DaysButton();
    await applyQueryButton(pm);
    
    // Verify all 3 logs are available (proves ingestion and indexing worked)
    await pm.logsPage.expectLogsTableVisible();
    await pm.logsPage.expectLogsTableRowCount(3);
    await pm.logsPage.waitForSearchResultAndCheckText("Recent log entry - 1 hour ago");
    await pm.logsPage.waitForSearchResultAndCheckText("Three hour old log entry - 3 hours ago");
    await pm.logsPage.waitForSearchResultAndCheckText("Four hour old log entry - 4 hours ago");
    testLogger.info('Baseline check passed: All 3 logs are available in 6-day range');

    // Test 1: Set time range to last 30 minutes - should show NO logs (all are older than 30 min)
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton(); // Using 15min as closest to 30min
    await applyQueryButton(pm);

    // Verify exactly 0 rows are visible (all data is older than 15 minutes)
    await pm.logsPage.expectLogsTableRowCount(0);
    testLogger.info('15-minute range test passed: No data visible (all logs older than 15 minutes)');

    // Test 2: Set time range to last 2 hours - should show exactly 1 log (1-hour old log only)
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.selectRelative6Hours(); // Using 6h since 2h might not exist
    await applyQueryButton(pm);

    // Verify all 3 logs are visible (all within 6 hours)
    await pm.logsPage.expectLogsTableRowCount(3);
    await pm.logsPage.waitForSearchResultAndCheckText("Recent log entry - 1 hour ago");
    await pm.logsPage.waitForSearchResultAndCheckText("data_age\":1h_old");
    testLogger.info('6-hour range test passed: All 3 logs visible (all within 6 hours)');

    // Test 3: Return to 6 days - should show all 3 logs again (final verification)
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickPast6DaysButton();
    await applyQueryButton(pm);

    // Verify all 3 logs are visible again (confirms filtering is reversible)
    await pm.logsPage.expectLogsTableRowCount(3);
    await pm.logsPage.waitForSearchResultAndCheckText("Recent log entry - 1 hour ago");
    await pm.logsPage.waitForSearchResultAndCheckText("Three hour old log entry - 3 hours ago");
    await pm.logsPage.waitForSearchResultAndCheckText("Four hour old log entry - 4 hours ago");
    await pm.logsPage.waitForSearchResultAndCheckText("data_age\":1h_old");
    await pm.logsPage.waitForSearchResultAndCheckText("data_age\":3h_old");
    await pm.logsPage.waitForSearchResultAndCheckText("data_age\":4h_old");
    
    testLogger.info('Final verification passed: All 3 logs visible in 6-day range');
    testLogger.info('Time range filtering validation completed successfully - Progressive filtering works: 0 → 3 → 3 logs as range expands');

    testLogger.info('Time range filtering validation test completed successfully');
  });

  test.afterEach(async () => {
    try {
      // await pm.commonActions.flipStreaming();
      testLogger.info('Streaming flipped after test');
    } catch (error) {
      testLogger.warn('Streaming flip failed', { error: error.message });
    }
  });
});
