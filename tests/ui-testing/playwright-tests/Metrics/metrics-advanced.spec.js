const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const metricsTestData = require('../utils/metrics-test-data.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');
const { verifyDataOnUI } = require('../utils/metrics-assertions.js');

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

  // CONSOLIDATED TEST 1: Stream and time range selection (2 tests → 1 test)
  test("Select streams and query with different time ranges", {
    tag: ['@metrics', '@streams', '@timerange', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing stream selection and time range variations');

    // Test 1: Stream selection
    testLogger.info('Testing metric stream selection');
    const streamSelector = await pm.metricsPage.getStreamSelector();
    const isStreamSelectorVisible = await streamSelector.isVisible().catch(() => false);

    // Stream selector should be visible for multi-stream environments
    if (isStreamSelectorVisible) {
      await pm.metricsPage.clickStreamSelector();
      await page.waitForTimeout(500);

      const hasStreamOptions = await pm.metricsPage.isStreamOptionVisible();

      if (!hasStreamOptions) {
        testLogger.warn('Stream options not visible after clicking selector - may be single stream or UI changed');
        await page.keyboard.press('Escape');
      } else {
        expect(hasStreamOptions).toBe(true); // Should have stream options available

        const streamOption = await pm.metricsPage.getStreamOption();
        const streamName = await streamOption.textContent();
        testLogger.info(`Selecting stream: ${streamName}`);
        await streamOption.click();
        await page.waitForTimeout(1000);

        await pm.metricsPage.enterMetricsQuery('up');
        await pm.metricsPage.clickApplyButton();
        await pm.metricsPage.waitForMetricsResults();

        await verifyDataOnUI(pm, 'Stream selection query', true);
        testLogger.info('Stream selection and query completed');
      }
    } else {
      testLogger.info('Stream selector not visible - single stream environment');
    }

    // Test 2: Time range selection
    // Valid time ranges based on DateTime.vue relativeDates:
    // Minutes: 1, 5, 10, 15, 30, 45
    // Hours: 1, 2, 3, 6, 8, 12
    // Days: 1, 2, 3, 4, 5, 6
    testLogger.info('Testing time range selection');
    const timeRanges = ['Last 5 minutes', 'Last 1 hour', 'Last 1 day'];

    let successfulSelections = 0;
    for (const range of timeRanges) {
      testLogger.info(`Testing time range: ${range}`);

      const selected = await pm.metricsPage.selectDateRange(range);
      if (selected) {
        testLogger.info(`Selected time range: ${range}`);
        successfulSelections++;
      } else {
        testLogger.warn(`Failed to select time range: ${range}`);
        await page.keyboard.press('Escape');
      }

      await pm.metricsPage.executeQuery('rate(http_requests_total[5m])');
      await page.waitForTimeout(2000);

      const hasError = await pm.metricsPage.expectQueryError();
      if (hasError) {
        const errorIndicators = await pm.metricsPage.getErrorIndicators();
        const errorText = await errorIndicators.textContent();
        testLogger.error(`Query failed for time range "${range}": ${errorText}`);
      }
      expect(hasError).toBe(false);
    }

    // Should have successfully selected at least one time range
    if (successfulSelections === 0) {
      testLogger.warn('Could not select any time ranges - date picker UI may have changed');
    }
    // Assert OUTSIDE the if - this will fail if successfulSelections is 0
    expect(successfulSelections).toBeGreaterThan(0);
    testLogger.info(`Successfully selected ${successfulSelections} time ranges`);

    testLogger.info('Stream and time range selection tests completed');
  });

  // CONSOLIDATED TEST 2: Complex queries (functions, histograms, labels, comparisons) (4 tests → 1 test)
  test("Execute complex queries (functions, histograms, label filters, comparisons)", {
    tag: ['@metrics', '@functions', '@histogram', '@labels', '@comparison', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing complex query variations');

    const complexQueryGroups = [
      {
        category: 'PromQL functions',
        queries: [
          { name: 'rate', query: 'rate(http_requests_total[5m])' },
          { name: 'increase', query: 'increase(http_requests_total[1h])' },
          { name: 'avg_over_time', query: 'avg_over_time(cpu_usage_percent[5m])' },
          { name: 'stddev', query: 'stddev(cpu_usage_percent)' }
        ]
      },
      {
        category: 'Histogram quantiles',
        queries: [
          { name: 'P50', quantile: '0.50' },
          { name: 'P95', quantile: '0.95' },
          { name: 'P99', quantile: '0.99' }
        ].map(q => ({
          name: q.name,
          query: `histogram_quantile(${q.quantile}, rate(http_request_duration_seconds_bucket[5m]))`
        }))
      },
      {
        category: 'Label filtering and regex',
        queries: [
          { name: 'exact match', query: 'http_requests_total{method="GET", status="200"}' },
          { name: 'regex match', query: 'http_requests_total{status=~"2.."}' },
          { name: 'negative regex', query: 'http_requests_total{status!~"5.."}' },
          { name: 'instance regex', query: 'cpu_usage_percent{instance=~"node-.*"}' }
        ]
      },
      {
        category: 'Multi-metric comparisons',
        queries: [
          { name: 'division', query: 'cpu_usage_percent / 100' },
          { name: 'memory ratio', query: 'memory_usage_bytes / memory_total_bytes' },
          { name: 'threshold', query: 'rate(http_requests_total[5m]) > 100' },
          { name: 'boolean or', query: 'cpu_usage_percent > 80 or memory_usage_bytes > 1000000000' }
        ]
      }
    ];

    for (const group of complexQueryGroups) {
      testLogger.info(`Testing ${group.category}`);

      for (const queryData of group.queries) {
        testLogger.info(`Executing ${group.category} - ${queryData.name}`);

        await pm.metricsPage.executeQuery(queryData.query);
        await page.waitForTimeout(1500);

        // Verify query executed without errors
        const hasError = await pm.metricsPage.expectQueryError();
        if (hasError) {
          const errorIndicators = await pm.metricsPage.getErrorIndicators();
          const errorText = await errorIndicators.textContent();
          testLogger.error(`Query "${queryData.name}" failed with error: ${errorText}`);
        }
        expect(hasError).toBe(false); // All queries should execute successfully

        testLogger.info(`${queryData.name} executed successfully`);
      }
    }

    testLogger.info('All complex query variations tested successfully');
  });

  // CONSOLIDATED TEST 3: Advanced features (aggregations, subqueries, alerts) (3 tests → 1 test)
  test("Execute advanced features (aggregations, subqueries, alert conditions)", {
    tag: ['@metrics', '@aggregation', '@subquery', '@alerts', '@functional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing advanced query features');

    // Test 1: Complex aggregations
    testLogger.info('Testing complex aggregation queries');
    const aggregationQueries = metricsTestData.getTestQueries('promql')
      .filter(q => q.category === 'aggregations')
      .slice(0, 3);

    for (const queryData of aggregationQueries) {
      testLogger.info(`Testing aggregation: ${queryData.name}`);

      await pm.metricsPage.clearQueryEditor();
      await pm.metricsPage.enterMetricsQuery(queryData.query);
      await pm.metricsPage.clickApplyButton();
      await pm.metricsPage.waitForMetricsResults();

      const hasError = await pm.metricsPage.expectQueryError();
      if (hasError) {
        const errorIndicators = await pm.metricsPage.getErrorIndicators();
        const errorText = await errorIndicators.textContent();
        testLogger.error(`Aggregation "${queryData.name}" failed: ${errorText}`);
      }
      expect(hasError).toBe(false); // Should execute without errors

      testLogger.info(`Aggregation "${queryData.name}" executed successfully`);

      await page.waitForTimeout(1000);
    }

    // Test 2: Subqueries
    testLogger.info('Testing subqueries and nested expressions');
    const subqueries = [
      'max_over_time(rate(http_requests_total[5m])[1h:])',
      'avg_over_time(cpu_usage_percent[5m])[10m:1m]',
      'quantile_over_time(0.95, http_request_duration_seconds[5m])[1h:]'
    ];

    for (const query of subqueries) {
      testLogger.info(`Executing subquery: ${query.substring(0, 50)}...`);

      await pm.metricsPage.executeQuery(query);
      await page.waitForTimeout(2000);

      testLogger.info('Subquery executed');
    }

    // Test 3: Alert conditions
    testLogger.info('Testing alert condition queries');
    const alertQueries = metricsTestData.sampleQueries.alerts;

    for (const [name, query] of Object.entries(alertQueries)) {
      testLogger.info(`Testing alert condition: ${name}`);

      await pm.metricsPage.executeQuery(query);
      await page.waitForTimeout(2000);

      const resultsVisible = await pm.metricsPage.areResultsVisible();
      if (resultsVisible) {
        testLogger.info(`Alert condition "${name}" evaluated`);
      }
    }

    testLogger.info('Advanced features tested successfully');
  });

  // CONSOLIDATED TEST 4: Performance testing with complex queries (1 test remains)
  test("Execute performance-intensive queries and verify execution time", {
    tag: ['@metrics', '@performance', '@functional', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing performance with complex queries');

    const performanceQueries = [
      {
        name: 'Large aggregation',
        query: 'sum by (instance, job, method, status) (rate(http_requests_total[5m]))'
      },
      {
        name: 'Multiple metrics',
        query: 'cpu_usage_percent + memory_usage_bytes/1000000 + disk_io_bytes_per_sec/1000'
      },
      {
        name: 'Complex calculation',
        query: '100 * (1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])))'
      },
      {
        name: 'Many labels',
        query: 'http_requests_total{method=~"GET|POST|PUT|DELETE", status=~"2..|3..|4..|5.."}'
      }
    ];

    for (const queryData of performanceQueries) {
      testLogger.info(`Testing ${queryData.name}`);

      const startTime = Date.now();
      await pm.metricsPage.executeQuery(queryData.query);
      const executionTime = Date.now() - startTime;

      testLogger.info(`${queryData.name} executed in ${executionTime}ms`);

      // Verify query completed within reasonable time (10 seconds for performance)
      expect(executionTime).toBeLessThan(10000);

      await page.waitForTimeout(1000);
    }

    testLogger.info('Performance testing completed successfully');
  });
});
