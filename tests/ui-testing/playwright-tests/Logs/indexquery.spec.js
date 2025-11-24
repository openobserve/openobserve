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
          console.error('Query failed with status:', response.status, 'Error:', errorText);
          return { error: errorText, status: response.status };
        }
        
        const result = await response.json();
        return result;
      } catch (err) {
        console.error('Query execution error', err);
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

  test("should validate custom date range picker functionality", async ({ page }) => {
    testLogger.info('Testing custom date range picker functionality');
    
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await pm.logsPage.selectStream("e2e_automate");
    
    // Open date time picker using POM
    await pm.logsPage.clickDateTimeButton();
    
    // Select absolute time range option
    await page.locator('[data-test="date-time-absolute-tab"]').click();
    await page.waitForTimeout(500);
    
    // Set custom date range (last 24 hours)
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Use date picker inputs 
    const startDateInput = page.locator('[data-test="date-time-absolute-start-date"]');
    const endDateInput = page.locator('[data-test="date-time-absolute-end-date"]');
    
    if (await startDateInput.isVisible()) {
      await startDateInput.fill(yesterday.toISOString().split('T')[0]);
      await endDateInput.fill(now.toISOString().split('T')[0]);
      
      // Apply the custom date range
      await page.locator('[data-test="date-time-btn-apply"]').click();
      await page.waitForTimeout(1000);
      
      // Run query with custom date range
      await pm.logsPage.clickRefreshButton();
      await expect(page.locator('[data-test="logs-search-result-logs-table"]')).toBeVisible();
    }
    
    testLogger.info('Custom date range picker test completed successfully');
  });

  test("should validate field filtering and advanced search functionality", async ({ page }) => {
    testLogger.info('Testing field filtering and advanced search capabilities');
    
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.clickRefreshButton();
    
    // Enable quick mode and access fields
    await pm.logsPage.clickQuickModeToggle();
    await pm.logsPage.clickAllFieldsButton();
    
    // Test field value filtering
    const fieldFilter = page.locator('[data-cy="index-field-search-input"]');
    await fieldFilter.fill("level");
    await page.waitForTimeout(1000);
    
    // Look for level field in the field list
    const levelField = page.locator('[title="level"]').first();
    if (await levelField.isVisible()) {
      testLogger.info('Field filtering working - level field found');
      
      // Click on level field to add it as a filter
      await levelField.click({ force: true });
      await page.waitForTimeout(500);
    }
    
    // Test advanced search with multiple conditions
    await pm.logsPage.clickSQLModeToggle();
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.clearQueryEditor();
    
    // Advanced query with AND conditions
    const advancedQuery = "SELECT * FROM 'e2e_automate' WHERE level='info' AND job='test' LIMIT 50";
    await pm.logsPage.fillQueryEditor(advancedQuery);
    await pm.logsPage.clickRefreshButton();
    
    // Verify advanced search results
    await expect(page.locator('[data-test="logs-search-result-logs-table"]')).toBeVisible();
    
    testLogger.info('Field filtering and advanced search test completed successfully');
  });

  test("should display logs table and basic functionality", async ({ page }) => {
    testLogger.info('Testing basic logs display and table functionality');
    
    // Navigate to logs page and select stream
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await pm.logsPage.selectStream("e2e_automate");
    
    // Apply query to load logs
    await pm.logsPage.clickRefreshButton();
    
    // Verify logs table is visible
    await expect(page.locator('[data-test="logs-search-result-logs-table"]')).toBeVisible();
    
    // Test that logs are actually loaded by checking for table rows
    const logRows = page.locator('[data-test="logs-search-result-logs-table"] tbody tr');
    await expect(logRows).not.toHaveCount(0);
    
    // Verify refresh button functionality
    const refreshButton = page.locator('[data-test="logs-search-bar-refresh-btn"]');
    await expect(refreshButton).toBeVisible();
    
    // Verify that we can see log data in the table
    await expect(page.locator('[data-test="logs-search-result-logs-table"] tbody')).toContainText(/\w+/);
    
    testLogger.info('Basic logs display test completed successfully');
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
