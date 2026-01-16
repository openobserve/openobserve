const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');


// Helper function to verify data is displayed on UI
// Uses page object methods to comply with POM pattern
async function verifyDataOnUI(pm, testName) {
  const hasVisualization = await pm.metricsPage.verifyDataVisualization(testName);
  return { hasVisualization, hasNoData: !hasVisualization };
}

test.describe("Metrics PromQL and SQL Query testcases", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  // Ensure metrics are ingested once for all test files
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to metrics page
    await pm.metricsPage.gotoMetricsPage();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    testLogger.info('Test setup completed - navigated to metrics page');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // CONSOLIDATED TEST 1: Execute various PromQL query types (7 tests → 1 test)
  test("Execute various PromQL query types and functions", {
    tag: ['@metrics', '@promql', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing multiple PromQL query types in consolidated test');

    const queries = [
      {
        name: 'Basic rate query',
        query: 'rate(request_count[5m])',
        expectData: true
      },
      {
        name: 'Aggregation with sum',
        query: 'sum(rate(request_count[5m])) by (service)',
        expectData: true
      },
      {
        name: 'Histogram quantile',
        query: 'histogram_quantile(0.95, rate(request_duration_bucket[5m]))',
        expectData: true // Changed to true - we should verify data is returned
      },
      {
        name: 'Label filters',
        query: 'request_count{service="api-gateway", region=~"us-.*"}',
        expectData: true
      },
      {
        name: 'Comparison operators',
        query: 'up == 1',
        expectData: true
      },
      {
        name: 'Math expressions',
        query: '(memory_usage / cpu_usage) * 100',
        expectData: true // Changed to true - we should verify data is returned
      }
    ];

    for (const q of queries) {
      testLogger.info(`Testing ${q.name}: ${q.query}`);

      // Enter query
      await pm.metricsPage.enterMetricsQuery(q.query);

      // Execute query
      await pm.metricsPage.clickApplyButton();
      await pm.metricsPage.waitForMetricsResults();

      // Assert: Query must execute without errors
      const hasError = await pm.metricsPage.hasErrorIndicator();
      expect(hasError).toBe(false);

      // Verify data visualization if expected
      if (q.expectData) {
        const result = await verifyDataOnUI(pm, `PromQL ${q.name}`);
        // Assert: Data visualization should be present
        expect(result.hasVisualization).toBe(true);
      }

      testLogger.info(`${q.name} executed successfully`);
    }

    testLogger.info('All PromQL query types tested successfully');
  });

  // CONSOLIDATED TEST 2: Execute SQL queries (4 tests → 1 test)
  test("Execute SQL queries if SQL mode is available", {
    tag: ['@metrics', '@sql', '@functional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing SQL query functionality');

    // Check if SQL mode is available
    const sqlToggle = await pm.metricsPage.getSqlToggle();
    const hasSqlMode = await sqlToggle.isVisible().catch(() => false);

    if (!hasSqlMode) {
      testLogger.info('SQL mode not available in current metrics implementation - skipping SQL tests');
      return;
    }

    testLogger.info('SQL mode available - testing SQL queries');

    const sqlQueries = [
      {
        name: 'SQL mode switch',
        action: 'switch',
        query: null
      },
      {
        name: 'Basic SELECT query',
        query: 'SELECT * FROM metrics WHERE name = "cpu_usage" LIMIT 100'
      },
      {
        name: 'SQL aggregation query',
        query: 'SELECT AVG(value) as avg_value, MAX(value) as max_value FROM metrics GROUP BY host'
      },
      {
        name: 'SQL with WHERE clause',
        query: 'SELECT * FROM metrics WHERE value > 0.5 AND timestamp >= now() - interval "1 hour"'
      }
    ];

    for (const q of sqlQueries) {
      testLogger.info(`Testing ${q.name}`);

      if (q.action === 'switch') {
        // Test SQL mode switch
        await sqlToggle.click();
        await page.waitForTimeout(500);

        const sqlIndicator = await pm.metricsPage.getSqlIndicator();
        const isSqlMode = await sqlIndicator.isVisible().catch(() => false);

        // Assert: SQL mode should be activated
        expect(isSqlMode).toBe(true);
        testLogger.info('SQL mode activated successfully');
      } else {
        // Ensure SQL mode is active
        const currentlyInSqlMode = await pm.metricsPage.getSqlIndicator().then(i => i.isVisible().catch(() => false));
        if (!currentlyInSqlMode) {
          await sqlToggle.click();
          await page.waitForTimeout(500);
        }

        // Enter and execute SQL query
        await pm.metricsPage.enterMetricsQuery(q.query);
        await pm.metricsPage.clickApplyButton();
        await pm.metricsPage.waitForMetricsResults();

        // Assert: SQL query must execute without errors
        const hasError = await pm.metricsPage.hasErrorIndicator();
        expect(hasError).toBe(false);

        testLogger.info(`${q.name} executed successfully`);
      }
    }

    testLogger.info('All SQL queries tested successfully');
  });

  // CONSOLIDATED TEST 3: Advanced PromQL features (3 tests → 1 test)
  test("Execute advanced PromQL features and complex queries", {
    tag: ['@metrics', '@promql', '@advanced', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing advanced PromQL features');

    const advancedQueries = [
      {
        name: 'PromQL subquery',
        query: 'max_over_time(rate(request_count[5m])[30m:])'
      },
      {
        name: 'PromQL offset modifier',
        query: 'request_count offset 5m'
      },
      {
        name: 'PromQL vector matching',
        query: 'method:http_requests:rate5m{method="GET"} / ignoring(method) group_left method:http_requests:rate5m'
      }
    ];

    for (const q of advancedQueries) {
      testLogger.info(`Testing ${q.name}: ${q.query}`);

      // Enter query
      await pm.metricsPage.enterMetricsQuery(q.query);

      // Execute query
      await pm.metricsPage.clickApplyButton();
      await pm.metricsPage.waitForMetricsResults();

      // Assert: Advanced queries must execute without errors
      const hasError = await pm.metricsPage.hasErrorIndicator();
      expect(hasError).toBe(false);

      testLogger.info(`${q.name} executed successfully`);
    }

    testLogger.info('All advanced PromQL features tested successfully');
  });

  // CONSOLIDATED TEST 4: Error handling for invalid queries (2 tests → 1 test)
  test("Verify error handling for invalid queries and edge cases", {
    tag: ['@metrics', '@promql', '@sql', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing error handling for invalid queries');

    // Test 1: Invalid PromQL syntax
    testLogger.info('Testing invalid PromQL syntax');
    await pm.metricsPage.enterMetricsQuery('sum(rate(');
    await pm.metricsPage.clickApplyButton();
    await page.waitForTimeout(2000);

    let hasError = await pm.metricsPage.hasErrorIndicator();
    expect(hasError).toBe(true); // Should show error for invalid syntax

    const errorIndicators = await pm.metricsPage.getErrorIndicators();
    const errorText = await errorIndicators.textContent();
    testLogger.info(`Error message displayed: ${errorText}`);
    expect(errorText).toMatch(/syntax|parse|invalid|error/i); // Verify it's a proper error message

    // Test 2: Invalid SQL syntax (if SQL mode available)
    const sqlToggle = await pm.metricsPage.getSqlToggle();
    const hasSqlMode = await sqlToggle.isVisible().catch(() => false);

    if (hasSqlMode) {
      testLogger.info('Testing invalid SQL syntax');

      await sqlToggle.click();
      await page.waitForTimeout(500);

      await pm.metricsPage.enterMetricsQuery('SELECT FROM WHERE');
      await pm.metricsPage.clickApplyButton();
      await page.waitForTimeout(2000);

      hasError = await pm.metricsPage.hasErrorIndicator();
      expect(hasError).toBe(true); // Should show error for invalid SQL

      const sqlErrorIndicators = await pm.metricsPage.getErrorIndicators();
      const sqlErrorText = await sqlErrorIndicators.textContent();
      testLogger.info(`SQL error message displayed: ${sqlErrorText}`);
      expect(sqlErrorText).toMatch(/syntax|parse|invalid|error|sql/i); // Verify proper error
    } else {
      testLogger.info('SQL mode not available - skipping invalid SQL test');
    }

    testLogger.info('Error handling tests completed');
  });
});
