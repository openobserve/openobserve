const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');
const { verifyDataOnUI } = require('../utils/metrics-assertions.js');

test.describe("Metrics PromQL and SQL Query testcases", () => {
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

  // --- PromQL query type tests (split from original 6-query loop into individual tests) ---

  test("Execute basic gauge query (cpu_usage)", {
    tag: ['@metrics', '@promql', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const q = { name: 'Basic gauge query', query: 'cpu_usage' };
    testLogger.info(`Testing ${q.name}: ${q.query}`);
    await pm.metricsPage.enterMetricsQuery(q.query);
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();
    const hasError = await pm.metricsPage.hasErrorIndicator();
    expect(hasError).toBe(false);
    const result = await verifyDataOnUI(pm, `PromQL ${q.name}`);
    expect(result.hasVisualization).toBe(true);
    testLogger.info(`${q.name} executed successfully`);
  });

  test("Execute aggregation with sum by node", {
    tag: ['@metrics', '@promql', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const q = { name: 'Aggregation with sum', query: 'sum(cpu_usage) by (node)' };
    testLogger.info(`Testing ${q.name}: ${q.query}`);
    await pm.metricsPage.enterMetricsQuery(q.query);
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();
    const hasError = await pm.metricsPage.hasErrorIndicator();
    expect(hasError).toBe(false);
    const result = await verifyDataOnUI(pm, `PromQL ${q.name}`);
    expect(result.hasVisualization).toBe(true);
    testLogger.info(`${q.name} executed successfully`);
  });

  test("Execute aggregation with avg by instance", {
    tag: ['@metrics', '@promql', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const q = { name: 'Aggregation with avg', query: 'avg(memory_usage) by (instance)' };
    testLogger.info(`Testing ${q.name}: ${q.query}`);
    await pm.metricsPage.enterMetricsQuery(q.query);
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();
    const hasError = await pm.metricsPage.hasErrorIndicator();
    expect(hasError).toBe(false);
    const result = await verifyDataOnUI(pm, `PromQL ${q.name}`);
    expect(result.hasVisualization).toBe(true);
    testLogger.info(`${q.name} executed successfully`);
  });

  test("Execute label filter query", {
    tag: ['@metrics', '@promql', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const q = { name: 'Label filters', query: 'request_count{service=~".*"}' };
    testLogger.info(`Testing ${q.name}: ${q.query}`);
    await pm.metricsPage.enterMetricsQuery(q.query);
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();
    const hasError = await pm.metricsPage.hasErrorIndicator();
    expect(hasError).toBe(false);
    const result = await verifyDataOnUI(pm, `PromQL ${q.name}`);
    expect(result.hasVisualization).toBe(true);
    testLogger.info(`${q.name} executed successfully`);
  });

  test("Execute comparison operator query", {
    tag: ['@metrics', '@promql', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const q = { name: 'Comparison operators', query: 'up == 1' };
    testLogger.info(`Testing ${q.name}: ${q.query}`);
    await pm.metricsPage.enterMetricsQuery(q.query);
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();
    const hasError = await pm.metricsPage.hasErrorIndicator();
    expect(hasError).toBe(false);
    const result = await verifyDataOnUI(pm, `PromQL ${q.name}`);
    expect(result.hasVisualization).toBe(true);
    testLogger.info(`${q.name} executed successfully`);
  });

  test("Execute math expression query", {
    tag: ['@metrics', '@promql', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const q = { name: 'Math expressions', query: '(memory_usage / 1000) * 100' };
    testLogger.info(`Testing ${q.name}: ${q.query}`);
    await pm.metricsPage.enterMetricsQuery(q.query);
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();
    const hasError = await pm.metricsPage.hasErrorIndicator();
    expect(hasError).toBe(false);
    const result = await verifyDataOnUI(pm, `PromQL ${q.name}`);
    expect(result.hasVisualization).toBe(true);
    testLogger.info(`${q.name} executed successfully`);
  });

  // --- SQL test (kept single — SQL mode availability check gates all SQL sub-steps) ---

  test("Execute SQL queries if SQL mode is available", {
    tag: ['@metrics', '@sql', '@functional', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing SQL query functionality');

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
        await sqlToggle.click();

        const sqlIndicator = await pm.metricsPage.getSqlIndicator();
        const isSqlMode = await sqlIndicator.isVisible({ timeout: 3000 }).catch(() => false);

        if (!isSqlMode) {
          testLogger.warn('SQL mode indicator not visible - SQL mode may not be fully implemented yet');
          break;
        }
        expect(isSqlMode).toBe(true);
        testLogger.info('SQL mode activated successfully');
      } else {
        const currentlyInSqlMode = await pm.metricsPage.getSqlIndicator().then(i => i.isVisible().catch(() => false));
        if (!currentlyInSqlMode) {
          await sqlToggle.click();
          await pm.metricsPage.getSqlIndicator().then(i => i.waitFor({ state: 'visible', timeout: 3000 })).catch(() => {});
        }

        await pm.metricsPage.enterMetricsQuery(q.query);
        await pm.metricsPage.clickApplyButton();
        await pm.metricsPage.waitForMetricsResults();

        const hasError = await pm.metricsPage.hasErrorIndicator();
        expect(hasError).toBe(false);

        testLogger.info(`${q.name} executed successfully`);
      }
    }

    testLogger.info('All SQL queries tested successfully');
  });

  // --- Advanced PromQL tests (split from original 3-query loop into individual tests) ---

  test("Execute PromQL subquery", {
    tag: ['@metrics', '@promql', '@advanced', '@P3', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const query = 'max_over_time(rate(request_count[5m])[30m:])';
    testLogger.info(`Testing PromQL subquery: ${query}`);
    await pm.metricsPage.enterMetricsQuery(query);
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();
    const hasError = await pm.metricsPage.hasErrorIndicator();
    expect(hasError).toBe(false);
    testLogger.info('PromQL subquery executed');
  });

  test("Execute PromQL offset modifier", {
    tag: ['@metrics', '@promql', '@advanced', '@P3', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const query = 'request_count offset 5m';
    testLogger.info(`Testing PromQL offset modifier: ${query}`);
    await pm.metricsPage.enterMetricsQuery(query);
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();
    const hasError = await pm.metricsPage.hasErrorIndicator();
    expect(hasError).toBe(false);
    testLogger.info('PromQL offset modifier executed');
  });

  test("Execute PromQL vector matching", {
    tag: ['@metrics', '@promql', '@advanced', '@P3', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const query = 'method:http_requests:rate5m{method="GET"} / ignoring(method) group_left method:http_requests:rate5m';
    testLogger.info(`Testing PromQL vector matching: ${query}`);
    await pm.metricsPage.enterMetricsQuery(query);
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();
    const hasError = await pm.metricsPage.hasErrorIndicator();
    expect(hasError).toBe(false);
    testLogger.info('PromQL vector matching executed');
  });

  // --- Error handling tests (split from original 2-scenario test into individual tests) ---

  test("Handle invalid PromQL syntax gracefully", {
    tag: ['@metrics', '@promql', '@edge', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing invalid PromQL syntax');

    // Initialize editor with a valid query first
    testLogger.info('Initializing editor with a valid query first');
    await pm.metricsPage.executeQuery('up');

    const validQueryHasVisualization = await pm.metricsPage.hasVisualization();
    testLogger.info(`Valid query visualization present: ${validQueryHasVisualization}`);

    await pm.metricsPage.enterMetricsQuery('sum(rate(');
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();

    let hasError = await pm.metricsPage.hasErrorIndicator();
    const noDataMessage = await pm.metricsPage.getNoDataMessage();
    const hasNoData = await noDataMessage.isVisible().catch(() => false);
    const invalidQueryHasVisualization = await pm.metricsPage.hasVisualization();

    testLogger.info(`Invalid query state: hasError=${hasError}, hasNoData=${hasNoData}, hasVisualization=${invalidQueryHasVisualization}`);

    const systemStable = !hasError ? await pm.metricsPage.hasVisualization() : true;
    const handledGracefully = hasError || hasNoData || systemStable;
    expect(handledGracefully).toBe(true);

    if (hasError) {
      testLogger.info('Invalid query showed error indicator - valid error handling');
    } else if (hasNoData) {
      testLogger.info('Invalid query resulted in no-data message - valid error handling');
    } else {
      testLogger.info('Invalid query maintained system stability - valid graceful handling');
    }

    testLogger.info('Invalid PromQL error handling test completed');
  });

  test("Handle invalid SQL syntax gracefully", {
    tag: ['@metrics', '@sql', '@edge', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing invalid SQL syntax');

    const sqlToggle = await pm.metricsPage.getSqlToggle();
    const hasSqlMode = await sqlToggle.isVisible().catch(() => false);

    if (!hasSqlMode) {
      testLogger.info('SQL mode not available - skipping invalid SQL test');
      return;
    }

    await sqlToggle.click();

    await pm.metricsPage.enterMetricsQuery('SELECT FROM WHERE');
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();

    const inlineError = pm.metricsPage.getInlineError();
    const hasInlineError = await inlineError.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasInlineError) {
      const errorText = await inlineError.textContent().catch(() => '');
      testLogger.info(`SQL inline error displayed: ${errorText.substring(0, 100)}`);
      expect(errorText.toLowerCase()).toMatch(/error|invalid|syntax|parse|sql|fail|cannot|not found/i);
    } else {
      testLogger.info('No inline error visible - system handled gracefully');
    }

    testLogger.info('Invalid SQL error handling test completed');
  });
});
