const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');
const { verifyDataOnUIWithValues: verifyDataOnUI } = require('../utils/metrics-assertions.js');

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

  // CONSOLIDATED TEST 1: All basic aggregations (grouping, non-grouping, filters) (4 tests → 1 test)
  test("Execute aggregation queries with and without grouping", {
    tag: ['@metrics', '@grouping', '@aggregation', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing aggregation queries with grouping and filtering');

    const aggregationTests = [
      {
        category: 'Single label grouping',
        queries: [
          'sum by (service) (request_count)',
          'avg by (instance) (cpu_usage)',
          'max by (region) (memory_usage)',
          'min by (service) (request_duration)',
          'count by (job) (up)'
        ]
      },
      {
        category: 'Multiple label grouping',
        queries: [
          'sum by (node, service) (rate(request_count[5m]))',
          'avg by (instance, region) (cpu_usage)',
          'sum by (service, region, node) (request_duration)'
        ]
      },
      {
        category: 'Aggregation without grouping',
        queries: [
          'sum(request_count)',
          'avg(cpu_usage)',
          'max(memory_usage)',
          'min(request_duration)',
          'stddev(cpu_usage)'
        ]
      },
      {
        category: 'Aggregation with filters',
        queries: [
          'sum(request_count{service="api-gateway"})',
          'avg(cpu_usage{region="us-west-2"})',
          'sum by (service) (request_count{region!="us-east-1"})'
        ]
      }
    ];

    for (const testGroup of aggregationTests) {
      testLogger.info(`Testing ${testGroup.category}`);

      for (const query of testGroup.queries) {
        testLogger.info(`Executing: ${query}`);

        await pm.metricsPage.executeQuery(query);
        await page.waitForTimeout(1500);

        // Verify no errors - if error found, test fails immediately
        const hasError = await pm.metricsPage.expectQueryError();
        if (hasError) {
          const errorIndicators = await pm.metricsPage.getErrorIndicators();
          const errorText = await errorIndicators.textContent();
          testLogger.error(`Query failed with error: ${errorText}`);
        }
        expect(hasError).toBe(false);

        // Verify data is visible on UI with value validation
        await verifyDataOnUI(pm, `${testGroup.category}: ${query}`, true);
      }
    }

    testLogger.info('All aggregation queries tested successfully');
  });

  // CONSOLIDATED TEST 2: Advanced aggregation functions (topk, quantile, overtime, absent) (4 tests → 1 test)
  test("Execute advanced aggregation functions (topk, quantile, overtime, absent)", {
    tag: ['@metrics', '@topk', '@quantile', '@overtime', '@aggregation', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing advanced aggregation functions');

    const advancedTests = [
      {
        category: 'TopK and BottomK queries',
        queries: [
          'topk(5, request_count)',
          'bottomk(3, cpu_usage)',
          'topk(10, sum by (service) (rate(request_count[5m])))'
        ],
        checkLegend: true
      },
      {
        category: 'Quantile calculations',
        queries: [
          'quantile(0.5, cpu_usage)',
          'quantile(0.95, request_duration)',
          'quantile by (instance) (0.99, memory_usage)'
        ]
      },
      {
        category: 'Over time aggregations',
        queries: [
          'avg_over_time(cpu_usage[5m])',
          'max_over_time(memory_usage[10m])',
          'sum_over_time(request_count[30m])',
          'count_over_time(up[1h])'
        ]
      },
      {
        category: 'Absent and present functions',
        queries: [
          'absent(nonexistent_metric)',
          'absent(up{job="fake_job"})',
          'present_over_time(request_count[10m])'
        ],
        checkVisualization: true  // Check for chart/visualization instead of specific value
      }
    ];

    for (const testGroup of advancedTests) {
      testLogger.info(`Testing ${testGroup.category}`);

      for (const query of testGroup.queries) {
        testLogger.info(`Executing: ${query}`);

        await pm.metricsPage.executeQuery(query);
        await page.waitForTimeout(2000);

        // Verify no errors - if error found, test fails immediately
        const hasError = await pm.metricsPage.expectQueryError();
        if (hasError) {
          const errorIndicators = await pm.metricsPage.getErrorIndicators();
          const errorText = await errorIndicators.textContent();
          testLogger.error(`Query failed with error: ${errorText}`);
        }
        expect(hasError).toBe(false);

        // Check legend count for topk/bottomk - assert actual value
        if (testGroup.checkLegend) {
          const legendCount = await pm.metricsPage.getLegendItemCount();
          testLogger.info(`Query returned ${legendCount} series`);
          // Assert OUTSIDE the if - will fail if legendCount is 0
          expect(legendCount).toBeGreaterThan(0);
        }

        // Check visualization for absent/present functions
        // absent() returns 1 when metric is absent, shown in chart visualization
        if (testGroup.checkVisualization) {
          const hasVisualization = await pm.metricsPage.hasVisualization();
          testLogger.info(`Visualization present: ${hasVisualization}`);
          // Assert: Query should produce some visualization (chart, table, or value display)
          expect(hasVisualization).toBe(true);
        }
      }
    }

    testLogger.info('All advanced aggregation functions tested successfully');
  });

  // CONSOLIDATED TEST 3: Complex aggregations and distinct counts (2 tests → 1 test)
  test("Execute complex aggregation combinations and distinct value counting", {
    tag: ['@metrics', '@complex', '@distinct', '@aggregation', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing complex aggregations and distinct counting');

    const complexTests = [
      {
        category: 'Complex aggregation combinations',
        queries: [
          'avg(sum by (instance) (rate(request_count[5m])))',
          'max(avg by (region) (cpu_usage))',
          'sum(topk(5, rate(request_count[5m])))',
          'stddev(sum by (service) (increase(request_count[1h])))'
        ]
      },
      {
        category: 'Count distinct label values',
        queries: [
          'count(count by (service) (request_count))',
          'count(count by (instance) (up))',
          'count(group by (region) (request_count))',
          'count(count by (node, service) (request_count))'
        ]
      }
    ];

    for (const testGroup of complexTests) {
      testLogger.info(`Testing ${testGroup.category}`);

      for (const query of testGroup.queries) {
        testLogger.info(`Executing: ${query}`);

        await pm.metricsPage.executeQuery(query);
        await page.waitForTimeout(2500);

        // Verify no errors - if error found, test fails immediately
        const hasError = await pm.metricsPage.expectQueryError();
        if (hasError) {
          const errorIndicators = await pm.metricsPage.getErrorIndicators();
          const errorText = await errorIndicators.textContent();
          testLogger.error(`Query failed with error: ${errorText}`);
        }
        expect(hasError).toBe(false);

        testLogger.info(`${query} executed successfully`);
      }
    }

    testLogger.info('Complex aggregations and distinct counting tested successfully');
  });
});
