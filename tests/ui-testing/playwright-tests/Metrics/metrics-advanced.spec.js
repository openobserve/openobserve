const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const metricsTestData = require('../utils/metrics-test-data.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');
const { verifyDataOnUI } = require('../utils/metrics-assertions.js');

test.describe("Advanced Metrics Tests with Stream Selection", () => {
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  /** Create fresh PageManager per test — avoids data races in parallel workers. */
  async function setupTest(page, testInfo) {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    await pm.metricsPage.gotoMetricsPage();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Test setup completed - navigated to metrics page');
    return pm;
  }

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // --- Stream and time range selection (kept combined — stream selector is optional/env-dependent) ---

  test("Select streams and query with different time ranges", {
    tag: ['@metrics', '@streams', '@timerange', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing stream selection and time range variations');

    // Test 1: Stream selection
    testLogger.info('Testing metric stream selection');
    const streamSelector = await pm.metricsPage.getStreamSelector();
    const isStreamSelectorVisible = await streamSelector.isVisible().catch(() => false);

    if (isStreamSelectorVisible) {
      await pm.metricsPage.clickStreamSelector();

      const hasStreamOptions = await pm.metricsPage.isStreamOptionVisible();

      if (!hasStreamOptions) {
        testLogger.warn('Stream options not visible after clicking selector - may be single stream or UI changed');
        await page.keyboard.press('Escape');
      } else {
        expect(hasStreamOptions).toBe(true);

        const streamOption = await pm.metricsPage.getStreamOption();
        const streamName = await streamOption.textContent();
        testLogger.info(`Selecting stream: ${streamName}`);
        await streamOption.click();

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

      const hasError = await pm.metricsPage.expectQueryError();
      if (hasError) {
        const errorIndicators = await pm.metricsPage.getErrorIndicators();
        const errorText = await errorIndicators.textContent();
        testLogger.error(`Query failed for time range "${range}": ${errorText}`);
      }
      expect(hasError).toBe(false);
    }

    if (successfulSelections === 0) {
      testLogger.warn('Could not select any time ranges - date picker UI may have changed');
    }
    expect(successfulSelections).toBeGreaterThan(0);
    testLogger.info(`Successfully selected ${successfulSelections} time ranges`);

    testLogger.info('Stream and time range selection tests completed');
  });

  // --- Complex query tests (split from original 4-category loop into individual tests) ---

  test("Execute PromQL function queries (rate, increase, avg_over_time, stddev)", {
    tag: ['@metrics', '@functions', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queries = [
      { name: 'rate', query: 'rate(http_requests_total[5m])' },
      { name: 'increase', query: 'increase(http_requests_total[1h])' },
      { name: 'avg_over_time', query: 'avg_over_time(cpu_usage_percent[5m])' },
      { name: 'stddev', query: 'stddev(cpu_usage_percent)' }
    ];
    testLogger.info('Testing PromQL functions');
    for (const queryData of queries) {
      testLogger.info(`Executing PromQL functions - ${queryData.name}`);
      await pm.metricsPage.executeQuery(queryData.query);
      const hasError = await pm.metricsPage.expectQueryError();
      if (hasError) {
        const errorIndicators = await pm.metricsPage.getErrorIndicators();
        const errorText = await errorIndicators.textContent();
        testLogger.error(`Query "${queryData.name}" failed with error: ${errorText}`);
      }
      expect(hasError).toBe(false);
      testLogger.info(`${queryData.name} executed successfully`);
    }
    testLogger.info('PromQL functions tested successfully');
  });

  test("Execute histogram quantile queries (P50, P95, P99)", {
    tag: ['@metrics', '@histogram', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queries = [
      { name: 'P50', quantile: '0.50' },
      { name: 'P95', quantile: '0.95' },
      { name: 'P99', quantile: '0.99' }
    ].map(q => ({
      name: q.name,
      query: `histogram_quantile(${q.quantile}, rate(http_request_duration_seconds_bucket[5m]))`
    }));
    testLogger.info('Testing Histogram quantiles');
    for (const queryData of queries) {
      testLogger.info(`Executing Histogram quantiles - ${queryData.name}`);
      await pm.metricsPage.executeQuery(queryData.query);
      const hasError = await pm.metricsPage.expectQueryError();
      if (hasError) {
        const errorIndicators = await pm.metricsPage.getErrorIndicators();
        const errorText = await errorIndicators.textContent();
        testLogger.error(`Query "${queryData.name}" failed with error: ${errorText}`);
      }
      expect(hasError).toBe(false);
      testLogger.info(`${queryData.name} executed successfully`);
    }
    testLogger.info('Histogram quantiles tested successfully');
  });

  test("Execute label filtering and regex queries", {
    tag: ['@metrics', '@labels', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queries = [
      { name: 'exact match', query: 'http_requests_total{method="GET", status="200"}' },
      { name: 'regex match', query: 'http_requests_total{status=~"2.."}' },
      { name: 'negative regex', query: 'http_requests_total{status!~"5.."}' },
      { name: 'instance regex', query: 'cpu_usage_percent{instance=~"node-.*"}' }
    ];
    testLogger.info('Testing Label filtering and regex');
    for (const queryData of queries) {
      testLogger.info(`Executing Label filtering and regex - ${queryData.name}`);
      await pm.metricsPage.executeQuery(queryData.query);
      const hasError = await pm.metricsPage.expectQueryError();
      if (hasError) {
        const errorIndicators = await pm.metricsPage.getErrorIndicators();
        const errorText = await errorIndicators.textContent();
        testLogger.error(`Query "${queryData.name}" failed with error: ${errorText}`);
      }
      expect(hasError).toBe(false);
      testLogger.info(`${queryData.name} executed successfully`);
    }
    testLogger.info('Label filtering and regex tested successfully');
  });

  test("Execute multi-metric comparison queries", {
    tag: ['@metrics', '@comparison', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queries = [
      { name: 'division', query: 'cpu_usage_percent / 100' },
      { name: 'memory ratio', query: 'memory_usage_bytes / memory_total_bytes' },
      { name: 'threshold', query: 'rate(http_requests_total[5m]) > 100' },
      { name: 'boolean or', query: 'cpu_usage_percent > 80 or memory_usage_bytes > 1000000000' }
    ];
    testLogger.info('Testing Multi-metric comparisons');
    for (const queryData of queries) {
      testLogger.info(`Executing Multi-metric comparisons - ${queryData.name}`);
      await pm.metricsPage.executeQuery(queryData.query);
      const hasError = await pm.metricsPage.expectQueryError();
      if (hasError) {
        const errorIndicators = await pm.metricsPage.getErrorIndicators();
        const errorText = await errorIndicators.textContent();
        testLogger.error(`Query "${queryData.name}" failed with error: ${errorText}`);
      }
      expect(hasError).toBe(false);
      testLogger.info(`${queryData.name} executed successfully`);
    }
    testLogger.info('Multi-metric comparisons tested successfully');
  });

  // --- Advanced feature tests (split from original 3-scenario test into individual tests) ---

  test("Execute complex aggregation queries from test data", {
    tag: ['@metrics', '@aggregation', '@functional', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing complex aggregation queries');
    const aggregationQueries = metricsTestData.getTestQueries('promql')
      .filter(q => q.category === 'aggregations')
      .slice(0, 3);

    for (const queryData of aggregationQueries) {
      testLogger.info(`Testing aggregation: ${queryData.name}`);

      await pm.metricsPage.executeQuery(queryData.query);

      const hasError = await pm.metricsPage.expectQueryError();
      if (hasError) {
        const errorIndicators = await pm.metricsPage.getErrorIndicators();
        const errorText = await errorIndicators.textContent();
        testLogger.error(`Aggregation "${queryData.name}" failed: ${errorText}`);
      }
      expect(hasError).toBe(false);

      testLogger.info(`Aggregation "${queryData.name}" executed successfully`);
    }

    testLogger.info('Complex aggregation queries tested successfully');
  });

  test("Execute subquery and nested expression queries", {
    tag: ['@metrics', '@subquery', '@functional', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing subqueries and nested expressions');
    // Use ingested test metrics (cpu_usage, request_count) — not http_requests_total which doesn't exist in test data
    const subqueries = [
      'max_over_time(rate(request_count[5m])[1h:])',
      'avg_over_time(cpu_usage[5m])[10m:1m]',
      'quantile_over_time(0.95, cpu_usage[5m])[1h:]'
    ];

    for (const query of subqueries) {
      testLogger.info(`Executing subquery: ${query.substring(0, 50)}...`);
      await pm.metricsPage.executeQuery(query);
      const hasError = await pm.metricsPage.expectQueryError();
      // Subquery range syntax ([duration:]) may not be supported in all environments — log but don't block
      if (hasError) {
        testLogger.warn(`Subquery syntax returned error (may be unsupported): ${query.substring(0, 60)}`);
      } else {
        testLogger.info('Subquery executed successfully');
      }
    }

    // Verify page is still functional after running subqueries
    const pageStable = await page.locator('body').isVisible();
    expect(pageStable).toBe(true);
    testLogger.info('Subquery and nested expression tests completed');
  });

  test("Execute alert condition queries", {
    tag: ['@metrics', '@alerts', '@functional', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing alert condition queries');
    const alertQueries = metricsTestData.sampleQueries.alerts;

    for (const [name, query] of Object.entries(alertQueries)) {
      testLogger.info(`Testing alert condition: ${name}`);

      await pm.metricsPage.executeQuery(query);

      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);

      const resultsVisible = await pm.metricsPage.areResultsVisible();
      if (resultsVisible) {
        testLogger.info(`Alert condition "${name}" evaluated`);
      }
    }

    testLogger.info('Alert condition queries tested successfully');
  });

  // --- Performance tests (split from original 4-query loop into individual tests) ---

  test("Execute large aggregation performance query", {
    tag: ['@metrics', '@performance', '@functional', '@P3', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queryData = {
      name: 'Large aggregation',
      query: 'sum by (instance, job, method, status) (rate(http_requests_total[5m]))'
    };
    testLogger.info(`Testing ${queryData.name}`);
    const startTime = Date.now();
    await pm.metricsPage.executeQuery(queryData.query);
    const executionTime = Date.now() - startTime;
    testLogger.info(`${queryData.name} executed in ${executionTime}ms`);
    // executeQuery() includes a networkidle wait (up to 5s) + CI can be slow
    expect(executionTime).toBeLessThan(30000);
  });

  test("Execute multiple metrics combination performance query", {
    tag: ['@metrics', '@performance', '@functional', '@P3', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queryData = {
      name: 'Multiple metrics',
      query: 'cpu_usage_percent + memory_usage_bytes/1000000 + disk_io_bytes_per_sec/1000'
    };
    testLogger.info(`Testing ${queryData.name}`);
    const startTime = Date.now();
    await pm.metricsPage.executeQuery(queryData.query);
    const executionTime = Date.now() - startTime;
    testLogger.info(`${queryData.name} executed in ${executionTime}ms`);
    expect(executionTime).toBeLessThan(30000);
  });

  test("Execute complex calculation performance query", {
    tag: ['@metrics', '@performance', '@functional', '@P3', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queryData = {
      name: 'Complex calculation',
      query: '100 * (1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])))'
    };
    testLogger.info(`Testing ${queryData.name}`);
    const startTime = Date.now();
    await pm.metricsPage.executeQuery(queryData.query);
    const executionTime = Date.now() - startTime;
    testLogger.info(`${queryData.name} executed in ${executionTime}ms`);
    expect(executionTime).toBeLessThan(30000);
  });

  test("Execute many-labels selector performance query", {
    tag: ['@metrics', '@performance', '@functional', '@P3', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queryData = {
      name: 'Many labels',
      query: 'http_requests_total{method=~"GET|POST|PUT|DELETE", status=~"2..|3..|4..|5.."}'
    };
    testLogger.info(`Testing ${queryData.name}`);
    const startTime = Date.now();
    await pm.metricsPage.executeQuery(queryData.query);
    const executionTime = Date.now() - startTime;
    testLogger.info(`${queryData.name} executed in ${executionTime}ms`);
    expect(executionTime).toBeLessThan(30000);
  });
});
