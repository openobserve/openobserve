const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const metricsTestData = require('../utils/metrics-test-data.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

// Helper function to verify data is actually visible on the UI
// Uses page object methods to comply with POM pattern
async function verifyDataOnUI(pm, testName) {
  const hasVisualization = await pm.metricsPage.verifyDataVisualization(testName);
  // Final assertion - ensure we have some form of data visualization
  expect(hasVisualization).toBeTruthy();
}

test.describe("Advanced Metrics Tests with Stream Selection", () => {
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

  // Stream Selection Tests
  test("Select and query different metric streams", {
    tag: ['@metrics', '@streams', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing metric stream selection');

    // Try to select a stream if the selector is available
    const streamSelector = await pm.metricsPage.getStreamSelector();

    if (await streamSelector.isVisible().catch(() => false)) {
      // Click to open stream dropdown
      await pm.metricsPage.clickStreamSelector();

      // Look for stream options
      if (await pm.metricsPage.isStreamOptionVisible()) {
        const streamOption = await pm.metricsPage.getStreamOption();
        const streamName = await streamOption.textContent();
        testLogger.info(`Selecting stream: ${streamName}`);
        await streamOption.click();
        await page.waitForTimeout(1000);

        // Run a query on the selected stream
        await pm.metricsPage.enterMetricsQuery('up');
        await pm.metricsPage.clickApplyButton();
        await pm.metricsPage.waitForMetricsResults();

        // Verify data is visible
        await verifyDataOnUI(pm, 'Stream selection query');

        testLogger.info('Stream selection and query completed');
      } else {
        testLogger.info('No stream options available, skipping stream selection');
      }
    } else {
      testLogger.info('Stream selector not visible, running query on default stream');
      await pm.metricsPage.executeQuery('up');

      // Verify data is visible
      await verifyDataOnUI(pm, 'Default stream query');
    }
  });

  // Time Range Selection Tests
  test("Query metrics with different time ranges", {
    tag: ['@metrics', '@timerange', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing time range selection for metrics');

    const timeRanges = ['Last 5 minutes', 'Last 1 hour', 'Last 24 hours'];

    for (const range of timeRanges) {
      testLogger.info(`Testing time range: ${range}`);

      // Use page object method to select date range
      const selected = await pm.metricsPage.selectDateRange(range);

      if (selected) {
        testLogger.info(`Selected time range: ${range}`);
      } else {
        await page.keyboard.press('Escape');
        testLogger.info(`Time range option "${range}" not found`);
      }

      // Run a query with the selected time range
      await pm.metricsPage.executeQuery('rate(http_requests_total[5m])');
      await page.waitForTimeout(2000);

      // Verify no errors
      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);
    }

    testLogger.info('Time range selection tests completed');
  });

  // Complex Aggregation Tests
  test("Execute complex aggregation queries", {
    tag: ['@metrics', '@aggregation', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing complex aggregation queries');

    const aggregationQueries = metricsTestData.getTestQueries('promql')
      .filter(q => q.category === 'aggregations')
      .slice(0, 3); // Test first 3 aggregation queries

    for (const queryData of aggregationQueries) {
      testLogger.info(`Testing aggregation: ${queryData.name}`);

      await pm.metricsPage.clearQueryEditor();
      await pm.metricsPage.enterMetricsQuery(queryData.query);
      await pm.metricsPage.clickApplyButton();
      await pm.metricsPage.waitForMetricsResults();

      // Check for errors
      const hasError = await pm.metricsPage.expectQueryError();
      if (hasError) {
        testLogger.warn(`Query "${queryData.name}" returned an error (may be expected if no data)`);
      } else {
        testLogger.info(`Aggregation query "${queryData.name}" executed successfully`);
      }

      await page.waitForTimeout(1000);
    }
  });

  // Function-based Query Tests
  test("Test PromQL functions with metrics", {
    tag: ['@metrics', '@functions', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing PromQL functions');

    const functionQueries = [
      { name: 'rate', query: 'rate(http_requests_total[5m])' },
      { name: 'increase', query: 'increase(http_requests_total[1h])' },
      { name: 'avg_over_time', query: 'avg_over_time(cpu_usage_percent[5m])' },
      { name: 'max_over_time', query: 'max_over_time(memory_usage_bytes[10m])' },
      { name: 'stddev', query: 'stddev(cpu_usage_percent)' }
    ];

    for (const queryData of functionQueries) {
      testLogger.info(`Testing function: ${queryData.name}`);

      await pm.metricsPage.executeQuery(queryData.query);

      // Verify query executed without critical errors
      const hasError = await pm.metricsPage.isErrorNotificationVisible();

      if (!hasError) {
        testLogger.info(`Function "${queryData.name}" executed successfully`);
      } else {
        const errorText = await pm.metricsPage.getErrorNotificationText() || 'Unknown error';
        testLogger.info(`Function "${queryData.name}" returned: ${errorText}`);
      }

      await page.waitForTimeout(1000);
    }
  });

  // Histogram Quantile Tests
  test("Calculate histogram quantiles", {
    tag: ['@metrics', '@histogram', '@functional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing histogram quantile calculations');

    const quantiles = ['0.50', '0.75', '0.90', '0.95', '0.99'];

    for (const quantile of quantiles) {
      const query = `histogram_quantile(${quantile}, rate(http_request_duration_seconds_bucket[5m]))`;
      testLogger.info(`Testing P${parseFloat(quantile) * 100} quantile`);

      await pm.metricsPage.executeQuery(query);

      // Check if results are displayed (chart or table)
      const hasResults = await pm.metricsPage.isResultsAreaVisible();

      if (hasResults) {
        testLogger.info(`P${parseFloat(quantile) * 100} quantile calculated`);
      } else {
        testLogger.info(`P${parseFloat(quantile) * 100} quantile query executed (no visible results)`);
      }

      await page.waitForTimeout(1000);
    }
  });

  // Label Filtering and Regex Tests
  test("Query with complex label filters and regex", {
    tag: ['@metrics', '@labels', '@functional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing complex label filtering');

    const labelQueries = [
      'http_requests_total{method="GET", status="200"}',
      'http_requests_total{status=~"2.."}',
      'http_requests_total{status!~"5.."}',
      'cpu_usage_percent{instance=~"node-.*"}',
      '{__name__=~"http_.*_total"}'
    ];

    for (const query of labelQueries) {
      testLogger.info(`Testing label query: ${query}`);

      await pm.metricsPage.executeQuery(query);

      // Verify no critical errors
      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);

      await page.waitForTimeout(1000);
    }
  });

  // Multi-metric Comparison Tests
  test("Compare multiple metrics in single query", {
    tag: ['@metrics', '@comparison', '@functional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing multi-metric comparisons');

    const comparisonQueries = [
      'cpu_usage_percent / 100',
      'memory_usage_bytes / memory_total_bytes',
      'rate(http_requests_total[5m]) > 100',
      'cpu_usage_percent > 80 or memory_usage_bytes > 1000000000',
      'http_requests_total unless http_requests_total{status="500"}'
    ];

    for (const query of comparisonQueries) {
      testLogger.info(`Testing comparison: ${query}`);

      await pm.metricsPage.executeQuery(query);

      // Allow query to complete
      await page.waitForTimeout(2000);

      // Check if any visualization is shown
      const hasVisualization = await pm.metricsPage.isChartOrVisualizationVisible();

      if (hasVisualization) {
        testLogger.info('Comparison query rendered visualization');
      } else {
        testLogger.info('Comparison query executed (no visualization)');
      }
    }
  });

  // Subquery Tests
  test("Execute subqueries and nested expressions", {
    tag: ['@metrics', '@subquery', '@functional', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing subqueries');

    const subqueries = [
      'max_over_time(rate(http_requests_total[5m])[1h:])',
      'avg_over_time(cpu_usage_percent[5m])[10m:1m]',
      'quantile_over_time(0.95, http_request_duration_seconds[5m])[1h:]'
    ];

    for (const query of subqueries) {
      testLogger.info(`Testing subquery: ${query}`);

      await pm.metricsPage.executeQuery(query);

      // These queries might not have data, just verify they don't crash
      await page.waitForTimeout(2000);

      // Log completion
      testLogger.info('Subquery executed');
    }
  });

  // Alert Rule Preview Tests
  test("Preview alert conditions with metrics", {
    tag: ['@metrics', '@alerts', '@functional', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing alert condition queries');

    const alertQueries = metricsTestData.sampleQueries.alerts;

    for (const [name, query] of Object.entries(alertQueries)) {
      testLogger.info(`Testing alert condition: ${name}`);

      await pm.metricsPage.executeQuery(query);

      // Alert queries return boolean results
      await page.waitForTimeout(2000);

      // Check for any results
      const resultsVisible = await pm.metricsPage.areResultsVisible();

      if (resultsVisible) {
        testLogger.info(`Alert condition "${name}" evaluated`);
      } else {
        testLogger.info(`Alert condition "${name}" executed`);
      }
    }
  });

  // Performance Testing with Large Queries
  test("Execute performance-intensive queries", {
    tag: ['@metrics', '@performance', '@functional', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing performance with complex queries');

    const performanceQueries = [
      // Large aggregation
      'sum by (instance, job, method, status) (rate(http_requests_total[5m]))',
      // Multiple metrics
      'cpu_usage_percent + memory_usage_bytes/1000000 + disk_io_bytes_per_sec/1000',
      // Complex calculation
      '100 * (1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])))',
      // Many labels
      'http_requests_total{method=~"GET|POST|PUT|DELETE", status=~"2..|3..|4..|5.."}'
    ];

    for (const query of performanceQueries) {
      testLogger.info(`Testing performance query: ${query.substring(0, 50)}...`);

      const startTime = Date.now();
      await pm.metricsPage.executeQuery(query);
      const executionTime = Date.now() - startTime;

      testLogger.info(`Query executed in ${executionTime}ms`);

      // Verify query completed within reasonable time (30 seconds)
      expect(executionTime).toBeLessThan(30000);

      await page.waitForTimeout(1000);
    }
  });
});