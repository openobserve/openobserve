const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');
const { verifyDataOnUIWithValues: verifyDataOnUI } = require('../utils/metrics-assertions.js');

test.describe("Metrics Aggregation and Grouping Tests", () => {
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

  // --- Basic aggregation tests (split from original 4-category loop into individual tests) ---

  test("Execute single label grouping aggregations", {
    tag: ['@metrics', '@grouping', '@aggregation', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queries = [
      'sum by (service) (request_count)',
      'avg by (instance) (cpu_usage)',
      'max by (region) (memory_usage)',
      'min by (service) (request_duration)',
      'count by (job) (up)'
    ];
    testLogger.info('Testing Single label grouping');
    for (const query of queries) {
      testLogger.info(`Executing: ${query}`);
      await pm.metricsPage.executeQuery(query);
      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);
      await verifyDataOnUI(pm, `Single label grouping: ${query}`, true);
    }
    testLogger.info('Single label grouping tested successfully');
  });

  test("Execute multiple label grouping aggregations", {
    tag: ['@metrics', '@grouping', '@aggregation', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queries = [
      'sum by (node, service) (rate(request_count[5m]))',
      'avg by (instance, region) (cpu_usage)',
      'sum by (service, region, node) (request_duration)'
    ];
    testLogger.info('Testing Multiple label grouping');
    for (const query of queries) {
      testLogger.info(`Executing: ${query}`);
      await pm.metricsPage.executeQuery(query);
      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);
      await verifyDataOnUI(pm, `Multiple label grouping: ${query}`, true);
    }
    testLogger.info('Multiple label grouping tested successfully');
  });

  test("Execute aggregation queries without grouping", {
    tag: ['@metrics', '@aggregation', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queries = [
      'sum(request_count)',
      'avg(cpu_usage)',
      'max(memory_usage)',
      'min(request_duration)',
      'stddev(cpu_usage)'
    ];
    testLogger.info('Testing Aggregation without grouping');
    for (const query of queries) {
      testLogger.info(`Executing: ${query}`);
      await pm.metricsPage.executeQuery(query);
      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);
      await verifyDataOnUI(pm, `Aggregation without grouping: ${query}`, true);
    }
    testLogger.info('Aggregation without grouping tested successfully');
  });

  test("Execute aggregation queries with label filters", {
    tag: ['@metrics', '@grouping', '@aggregation', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queries = [
      'sum(request_count{service="api-gateway"})',
      'avg(cpu_usage{region="us-west-2"})',
      'sum by (service) (request_count{region!="us-east-1"})'
    ];
    testLogger.info('Testing Aggregation with filters');
    for (const query of queries) {
      testLogger.info(`Executing: ${query}`);
      await pm.metricsPage.executeQuery(query);
      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);
      await verifyDataOnUI(pm, `Aggregation with filters: ${query}`, true);
    }
    testLogger.info('Aggregation with filters tested successfully');
  });

  // --- Advanced aggregation tests (split from original 4-category loop into individual tests) ---

  test("Execute topK and bottomK aggregation queries", {
    tag: ['@metrics', '@topk', '@aggregation', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queries = [
      'topk(5, request_count)',
      'bottomk(3, cpu_usage)',
      'topk(10, sum by (service) (rate(request_count[5m])))'
    ];
    testLogger.info('Testing TopK and BottomK queries');
    for (const query of queries) {
      testLogger.info(`Executing: ${query}`);
      await pm.metricsPage.executeQuery(query);
      const inlineError = pm.metricsPage.getInlineError();
      const hasInlineError = await inlineError.isVisible({ timeout: 1000 }).catch(() => false);
      if (hasInlineError) {
        testLogger.warn(`Query may have produced an error: ${await inlineError.textContent().catch(() => '')}`);
      }
      expect(hasInlineError).toBe(false);
      const legendCount = await pm.metricsPage.getLegendItemCount();
      testLogger.info(`Query returned ${legendCount} series`);
      expect(legendCount).toBeGreaterThan(0);
    }
    testLogger.info('TopK and BottomK queries tested successfully');
  });

  test("Execute quantile aggregation queries", {
    tag: ['@metrics', '@quantile', '@aggregation', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queries = [
      'quantile(0.5, cpu_usage)',
      'quantile(0.95, request_duration)',
      'quantile by (instance) (0.99, memory_usage)'
    ];
    testLogger.info('Testing Quantile calculations');
    for (const query of queries) {
      testLogger.info(`Executing: ${query}`);
      await pm.metricsPage.executeQuery(query);
      const inlineError = pm.metricsPage.getInlineError();
      const hasInlineError = await inlineError.isVisible({ timeout: 1000 }).catch(() => false);
      if (hasInlineError) {
        testLogger.warn(`Query may have produced an error: ${await inlineError.textContent().catch(() => '')}`);
      }
      expect(hasInlineError).toBe(false);
    }
    testLogger.info('Quantile calculations tested successfully');
  });

  test("Execute over-time aggregation queries", {
    tag: ['@metrics', '@overtime', '@aggregation', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queries = [
      'avg_over_time(cpu_usage[5m])',
      'max_over_time(memory_usage[10m])',
      'sum_over_time(request_count[30m])',
      'count_over_time(up[1h])'
    ];
    testLogger.info('Testing Over time aggregations');
    for (const query of queries) {
      testLogger.info(`Executing: ${query}`);
      await pm.metricsPage.executeQuery(query);
      const inlineError = pm.metricsPage.getInlineError();
      const hasInlineError = await inlineError.isVisible({ timeout: 1000 }).catch(() => false);
      if (hasInlineError) {
        testLogger.warn(`Query may have produced an error: ${await inlineError.textContent().catch(() => '')}`);
      }
      expect(hasInlineError).toBe(false);
    }
    testLogger.info('Over time aggregations tested successfully');
  });

  test("Execute absent and present function queries", {
    tag: ['@metrics', '@aggregation', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queries = [
      'absent(nonexistent_metric)',
      'absent(up{job="fake_job"})',
      'present_over_time(request_count[10m])'
    ];
    testLogger.info('Testing Absent and present functions');
    for (const query of queries) {
      testLogger.info(`Executing: ${query}`);
      await pm.metricsPage.executeQuery(query);
      const inlineError = pm.metricsPage.getInlineError();
      const hasInlineError = await inlineError.isVisible({ timeout: 1000 }).catch(() => false);
      if (hasInlineError) {
        testLogger.warn(`Query may have produced an error: ${await inlineError.textContent().catch(() => '')}`);
      }
      expect(hasInlineError).toBe(false);
      // absent() returns 1 when metric is absent, shown in chart visualization
      const hasVisualization = await pm.metricsPage.hasVisualization();
      testLogger.info(`Visualization present: ${hasVisualization}`);
      expect(hasVisualization).toBe(true);
    }
    testLogger.info('Absent and present functions tested successfully');
  });

  // --- Complex aggregation tests (split from original 2-category loop into individual tests) ---

  test("Execute complex aggregation combination queries", {
    tag: ['@metrics', '@complex', '@aggregation', '@P3', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queries = [
      'avg(sum by (instance) (rate(request_count[5m])))',
      'max(avg by (region) (cpu_usage))',
      'sum(topk(5, rate(request_count[5m])))',
      'stddev(sum by (service) (increase(request_count[1h])))'
    ];
    testLogger.info('Testing Complex aggregation combinations');
    for (const query of queries) {
      testLogger.info(`Executing: ${query}`);
      await pm.metricsPage.executeQuery(query);
      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);
      testLogger.info(`${query} executed successfully`);
    }
    testLogger.info('Complex aggregation combinations tested successfully');
  });

  test("Execute count distinct label value queries", {
    tag: ['@metrics', '@distinct', '@aggregation', '@P3', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const queries = [
      'count(count by (service) (request_count))',
      'count(count by (instance) (up))',
      'count(group by (region) (request_count))',
      'count(count by (node, service) (request_count))'
    ];
    testLogger.info('Testing Count distinct label values');
    for (const query of queries) {
      testLogger.info(`Executing: ${query}`);
      await pm.metricsPage.executeQuery(query);
      const hasError = await pm.metricsPage.expectQueryError();
      expect(hasError).toBe(false);
      testLogger.info(`${query} executed successfully`);
    }
    testLogger.info('Count distinct label values tested successfully');
  });
});
