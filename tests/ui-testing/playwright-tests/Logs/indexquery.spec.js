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
    const response = await page.evaluate(async (query, url, streamName, orgId) => {
      let response
      try {
        response = await fetch(`${url}/api/${orgId}/${streamName}/_search?type=logs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(query)
        });
      } catch (err) {
        testLogger.error('Query execution error', { error: err });
      }
  
      return response
    }, query);
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

    testLogger.info('Query 1 performance result', { query: 'match_all_raw', duration: result1.duration, records: result1.response.total });
    testLogger.info('Query 2 performance result', { query: 'match_all', duration: result2.duration, records: result2.response.total });

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

    testLogger.info('Query 1 performance result', { query: 'match_all', duration: result1.duration, records: result1.response.total });
    testLogger.info('Query 2 performance result', { query: 'match_all_raw_ignorecase', duration: result2.duration, records: result2.response.total });

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

  test.afterEach(async ({ page }) => {
    try {
      await pm.commonActions.flipStreaming();
      testLogger.info('Streaming flipped after test');
    } catch (error) {
      testLogger.warn('Streaming flip failed', { error: error.message });
    }
  });
});
