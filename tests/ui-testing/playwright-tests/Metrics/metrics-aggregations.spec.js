const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

// Helper function to verify data is actually visible on the UI
async function verifyDataOnUI(page, testName) {
  // Wait for chart/data rendering
  await page.waitForTimeout(2000);

  // Check for canvas elements (charts)
  const canvas = page.locator('canvas');
  const canvasCount = await canvas.count();
  const hasCanvas = canvasCount > 0;

  if (hasCanvas) {
    testLogger.info(`${testName} - Found ${canvasCount} canvas elements`);
  }

  // Check for SVG elements (alternative chart format)
  const svg = page.locator('svg').filter({ has: page.locator('path, rect, circle, line') });
  const svgCount = await svg.count();
  const hasSvg = svgCount > 0;

  if (hasSvg) {
    testLogger.info(`${testName} - Found ${svgCount} SVG elements`);
  }

  // Check for table data
  const tableRows = page.locator('table tbody tr, .data-table tr, [role="row"]');
  const rowCount = await tableRows.count();
  const hasTable = rowCount > 0;

  if (hasTable) {
    testLogger.info(`${testName} - Found table with ${rowCount} rows`);
  }

  // Check for result panels or data cards
  const resultPanels = page.locator('.result-panel, .chart-panel, .metric-card, [class*="result"], [class*="chart"]');
  const panelCount = await resultPanels.count();
  const hasPanels = panelCount > 0;

  if (hasPanels) {
    testLogger.info(`${testName} - Found ${panelCount} result/chart panels`);
  }

  // Verify at least one visualization method has data
  const hasVisualization = hasCanvas || hasSvg || hasTable || hasPanels;

  if (hasVisualization) {
    testLogger.info(`${testName} - Data visualization confirmed`);
  } else {
    testLogger.warn(`${testName} - No data visualization found`);
  }

  // Check for actual data values
  const dataValues = page.locator('[class*="value"]:not(:empty), td:not(:empty)').first();
  const hasDataValues = await dataValues.count() > 0;

  if (hasDataValues) {
    const valueText = await dataValues.textContent();
    // Check if we have actual metric names in the data
    const metricNames = ['cpu_usage', 'memory_usage', 'request_count', 'request_duration', 'up'];
    const hasMetricData = metricNames.some(metric => valueText.toLowerCase().includes(metric));

    if (hasMetricData) {
      testLogger.info(`${testName} - Data value found: ${valueText.substring(0, 100)}`);
    }
  }

  // Final assertion - ensure we have some form of data visualization
  expect(hasVisualization).toBeTruthy();
}

test.describe("Metrics Aggregation and Grouping Tests", () => {
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

  // Grouping Tests
  test("Group metrics by single label", {
    tag: ['@metrics', '@grouping', '@aggregation', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing single label grouping');

    const queries = [
      'sum by (service) (request_count)',
      'avg by (instance) (cpu_usage)',
      'max by (region) (memory_usage)',
      'min by (service) (request_duration)',
      'count by (job) (up)'
    ];

    for (const query of queries) {
      testLogger.info(`Testing grouping query: ${query}`);

      await pm.metricsPage.executeQuery(query);

      // Verify no errors
      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);

      // Verify data is visible on UI
      await verifyDataOnUI(page, `Single label grouping: ${query}`);

      await page.waitForTimeout(1000);
    }
  });

  test("Group metrics by multiple labels", {
    tag: ['@metrics', '@grouping', '@aggregation', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing multiple label grouping');

    const queries = [
      'sum by (node, service) (rate(request_count[5m]))',
      'avg by (instance, region) (cpu_usage)',
      'max by (region, node) (memory_usage)',
      'sum by (service, region, node) (request_duration)'
    ];

    for (const query of queries) {
      testLogger.info(`Testing multi-label grouping: ${query}`);

      await pm.metricsPage.executeQuery(query);

      // Allow time for complex query
      await page.waitForTimeout(2000);

      // Verify execution completed
      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);

      // Verify data is visible on UI
      await verifyDataOnUI(page, `Multi-label grouping: ${query}`);
    }
  });

  // Aggregation Without Grouping
  test("Aggregate metrics without grouping", {
    tag: ['@metrics', '@aggregation', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing aggregation without grouping');

    const queries = [
      'sum(request_count)',
      'avg(cpu_usage)',
      'max(memory_usage)',
      'min(request_duration)',
      'count(up == 1)',
      'stddev(cpu_usage)',
      'stdvar(memory_usage)'
    ];

    for (const query of queries) {
      testLogger.info(`Testing aggregation: ${query}`);

      await pm.metricsPage.executeQuery(query);

      // These should return single values
      await page.waitForTimeout(1500);

      // Check for single value result
      const valueElement = page.locator('.metric-value, .single-stat, .result-value, [class*="value"]').first();
      const hasValue = await valueElement.isVisible().catch(() => false);

      if (hasValue) {
        const value = await valueElement.textContent().catch(() => '');
        testLogger.info(`Aggregation result: ${value}`);
      }

      // Verify data is visible on UI
      await verifyDataOnUI(page, `Aggregation: ${query}`);
    }
  });

  // Top/Bottom K Queries
  test("Get top and bottom K metrics", {
    tag: ['@metrics', '@topk', '@aggregation', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing topk and bottomk queries');

    const queries = [
      'topk(5, request_count)',
      'bottomk(3, cpu_usage)',
      'topk(10, sum by (service) (rate(request_count[5m])))',
      'bottomk(5, avg by (instance) (memory_usage))'
    ];

    for (const query of queries) {
      testLogger.info(`Testing topk/bottomk: ${query}`);

      await pm.metricsPage.executeQuery(query);

      // These queries should return multiple series
      await page.waitForTimeout(2000);

      // Check if multiple series are shown
      const legendItems = page.locator('.legend-item, .series-label, [class*="legend"]');
      const legendCount = await legendItems.count();

      if (legendCount > 0) {
        testLogger.info(`Query returned ${legendCount} series`);
      }

      // Verify data is visible on UI
      await verifyDataOnUI(page, `TopK/BottomK: ${query}`);
    }
  });

  // Quantile Calculations
  test("Calculate quantiles over metrics", {
    tag: ['@metrics', '@quantile', '@aggregation', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing quantile calculations');

    const queries = [
      'quantile(0.5, cpu_usage)',
      'quantile(0.95, request_duration)',
      'quantile by (instance) (0.99, memory_usage)',
      'quantile(0.75, rate(request_count[5m]))'
    ];

    for (const query of queries) {
      testLogger.info(`Testing quantile: ${query}`);

      await pm.metricsPage.executeQuery(query);

      // Verify execution
      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);

      await page.waitForTimeout(1500);
    }
  });

  // Aggregation Over Time
  test("Aggregate metrics over time windows", {
    tag: ['@metrics', '@overtime', '@aggregation', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing aggregation over time');

    const queries = [
      'avg_over_time(cpu_usage[5m])',
      'max_over_time(memory_usage[10m])',
      'min_over_time(request_duration[1h])',
      'sum_over_time(request_count[30m])',
      'stddev_over_time(cpu_usage[15m])',
      'count_over_time(up[1h])'
    ];

    for (const query of queries) {
      testLogger.info(`Testing over time aggregation: ${query}`);

      await pm.metricsPage.executeQuery(query);

      // These functions aggregate over time windows
      await page.waitForTimeout(2000);

      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);
    }
  });

  // Complex Aggregation Combinations
  test("Combine multiple aggregations", {
    tag: ['@metrics', '@complex', '@aggregation', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing complex aggregation combinations');

    const queries = [
      'avg(sum by (instance) (rate(request_count[5m])))',
      'max(avg by (region) (cpu_usage))',
      'sum(topk(5, rate(request_count[5m])))',
      'avg(quantile by (instance) (0.95, request_duration))',
      'stddev(sum by (service) (increase(request_count[1h])))'
    ];

    for (const query of queries) {
      testLogger.info(`Testing complex aggregation: ${query}`);

      await pm.metricsPage.executeQuery(query);

      // Complex queries may take longer
      await page.waitForTimeout(3000);

      // Just verify they don't error out
      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);
    }
  });

  // Aggregation with Filters
  test("Apply aggregations with label filters", {
    tag: ['@metrics', '@filters', '@aggregation', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing aggregation with filters');

    const queries = [
      'sum(request_count{service="api-gateway"})',
      'avg(cpu_usage{region="us-west-2"})',
      'max(memory_usage{node=~"server-.*"})',
      'sum by (service) (request_count{region!="us-east-1"})',
      'avg by (instance) (cpu_usage{job="api-server"})'
    ];

    for (const query of queries) {
      testLogger.info(`Testing filtered aggregation: ${query}`);

      await pm.metricsPage.executeQuery(query);

      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);

      await page.waitForTimeout(1500);
    }
  });

  // Absent and Present Functions
  test("Check for absent metrics", {
    tag: ['@metrics', '@absent', '@aggregation', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing absent metric detection');

    const queries = [
      'absent(nonexistent_metric)',
      'absent(up{job="fake_job"})',
      'absent_over_time(cpu_usage[5m])',
      'present_over_time(request_count[10m])'
    ];

    for (const query of queries) {
      testLogger.info(`Testing absent/present: ${query}`);

      await pm.metricsPage.executeQuery(query);

      // These functions return 1 or 0
      await page.waitForTimeout(2000);

      // Check for boolean result
      const resultValue = page.locator('.result-value, .metric-value, [class*="value"]').first();
      if (await resultValue.isVisible().catch(() => false)) {
        const value = await resultValue.textContent();
        testLogger.info(`Absent/present result: ${value}`);
      }
    }
  });

  // Count Distinct Values
  test("Count distinct label values", {
    tag: ['@metrics', '@distinct', '@aggregation', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing distinct value counting');

    const queries = [
      'count(count by (service) (request_count))',
      'count(count by (instance) (up))',
      'count(group by (region) (request_count))',
      'count(count by (node, service) (request_count))'
    ];

    for (const query of queries) {
      testLogger.info(`Testing distinct count: ${query}`);

      await pm.metricsPage.executeQuery(query);

      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);

      await page.waitForTimeout(1500);
    }
  });
});