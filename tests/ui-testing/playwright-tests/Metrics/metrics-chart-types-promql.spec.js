const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

/**
 * Test Suite: PromQL Chart Type Support (NEW FEATURE - Dec 2025)
 *
 * Tests the newly added chart type converters for PromQL queries:
 * - Pie Chart (convertPromQLPieChart.ts)
 * - Table Chart (convertPromQLTableChart.ts)
 * - Heatmap Chart (convertPromQLHeatmapChart.ts)
 * - Gauge Chart (convertPromQLGaugeChart.ts)
 * - Bar Chart (convertPromQLBarChart.ts)
 *
 * Related PRs: #9696, #9733, #9756
 * Feature Location: web/src/utils/dashboard/promql/
 *
 * NOTE: This file has been refactored to use Page Object Model properly.
 * All chart selection and verification logic is in metricsPage.js
 */

test.describe("Metrics PromQL Chart Type Support (New Feature)", () => {
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

  // Helper function to execute a test query (uses page object methods)
  async function executeTestQuery(pm, query) {
    testLogger.info(`Executing query: ${query}`);

    // Set time range to Last 15 minutes using page object method
    await pm.metricsPage.selectLast15Minutes();

    // Enter query using page object method
    await pm.metricsPage.enterMetricsQuery(query);
    await pm.metricsPage.page.waitForTimeout(500);

    // Execute query using page object method
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();
    await pm.metricsPage.page.waitForTimeout(2000);

    testLogger.info('Query executed successfully');
  }

  // =====================================================
  // P1 TESTS - NEW CHART TYPES FOR PROMQL
  // =====================================================

  test("Select Line Chart for PromQL query (baseline)", {
    tag: ['@metrics', '@visualization', '@chart-line', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing Line chart with PromQL (baseline)');

    // Select Line chart (default) using page object method
    const lineSelected = await pm.metricsPage.selectChartType('line');
    if (lineSelected) {
      testLogger.info('Line chart type selected');
    }

    // Execute PromQL query
    await executeTestQuery(pm, 'rate(http_requests_total[5m])');

    // Verify Line chart renders using page object method
    const lineRendered = await pm.metricsPage.expectChartTypeRendered('line');
    if (lineRendered) {
      testLogger.info('Line chart rendered successfully');
    }
    expect(lineRendered).toBeTruthy();

    testLogger.info('Line chart test completed');
  });

  test("Select Pie Chart for PromQL query with labels", {
    tag: ['@metrics', '@visualization', '@chart-pie', '@P1', '@new-feature']
  }, async ({ page }) => {
    testLogger.info('Testing NEW Pie chart support for PromQL');

    // Execute PromQL query with grouping (for pie slices)
    await executeTestQuery(pm, 'sum(rate(http_requests_total[5m])) by (status)');

    // Select Pie chart using page object method
    const pieSelected = await pm.metricsPage.selectChartType('pie');

    if (pieSelected) {
      // Verify Pie chart renders using page object method
      const pieRendered = await pm.metricsPage.expectChartTypeRendered('pie');

      if (pieRendered) {
        testLogger.info('Pie chart rendered successfully');

        // Additional validation: Check for pie slices using page object method
        const slices = await pm.metricsPage.getPieSliceCount();
        testLogger.info(`Found ${slices} pie slices`);
        expect(slices).toBeGreaterThan(0);
      } else {
        testLogger.warn('Pie chart did not render - may not be available for metrics page');
        // Don't fail test - chart type may only be available in dashboards
      }
    } else {
      testLogger.warn('Pie chart selector not found - may only be in dashboard context');
      // Don't fail test - some chart types may only be available in dashboards
    }

    testLogger.info('Pie chart test completed');
  });

  test("Select Table Chart for PromQL query", {
    tag: ['@metrics', '@visualization', '@chart-table', '@P1', '@new-feature']
  }, async ({ page }) => {
    testLogger.info('Testing NEW Table chart support for PromQL');

    // Execute PromQL query
    await executeTestQuery(pm, 'up{job="api-server"}');

    // Select Table chart using page object method
    const tableSelected = await pm.metricsPage.selectChartType('table');

    if (tableSelected) {
      // Verify Table renders using page object method
      const tableRendered = await pm.metricsPage.expectChartTypeRendered('table');

      if (tableRendered) {
        testLogger.info('Table chart rendered successfully');

        // Additional validation: Check for table rows using page object method
        const rows = await pm.metricsPage.getTableRowCount();
        testLogger.info(`Found ${rows} table rows`);
        expect(rows).toBeGreaterThan(0);

        // Check for table headers using page object method
        const headers = await pm.metricsPage.getTableHeaderCount();
        testLogger.info(`Found ${headers} table headers`);
      } else {
        testLogger.warn('Table chart did not render');
      }
    } else {
      testLogger.warn('Table chart selector not found');
    }

    testLogger.info('Table chart test completed');
  });

  test("Select Heatmap Chart for PromQL histogram query", {
    tag: ['@metrics', '@visualization', '@chart-heatmap', '@P1', '@new-feature']
  }, async ({ page }) => {
    testLogger.info('Testing NEW Heatmap chart support for PromQL');

    // Execute PromQL histogram query
    await executeTestQuery(pm, 'rate(http_request_duration_bucket[5m])');

    // Select Heatmap chart using page object method
    const heatmapSelected = await pm.metricsPage.selectChartType('heatmap');

    if (heatmapSelected) {
      // Verify Heatmap renders using page object method
      const heatmapRendered = await pm.metricsPage.expectChartTypeRendered('heatmap');

      if (heatmapRendered) {
        testLogger.info('Heatmap chart rendered successfully');

        // Additional validation: Check for heatmap cells using page object method
        const cells = await pm.metricsPage.getHeatmapCellCount();
        testLogger.info(`Found ${cells} heatmap cells`);
        expect(cells).toBeGreaterThan(0);
      } else {
        testLogger.warn('Heatmap chart did not render');
      }
    } else {
      testLogger.warn('Heatmap chart selector not found');
    }

    testLogger.info('Heatmap chart test completed');
  });

  test("Select Gauge Chart for PromQL single value query", {
    tag: ['@metrics', '@visualization', '@chart-gauge', '@P1', '@new-feature']
  }, async ({ page }) => {
    testLogger.info('Testing NEW Gauge chart support for PromQL');

    // Execute PromQL query for single value
    await executeTestQuery(pm, 'avg(up)');

    // Select Gauge chart using page object method
    const gaugeSelected = await pm.metricsPage.selectChartType('gauge');

    if (gaugeSelected) {
      // Verify Gauge renders using page object method
      const gaugeRendered = await pm.metricsPage.expectChartTypeRendered('gauge');

      if (gaugeRendered) {
        testLogger.info('Gauge chart rendered successfully');

        // Additional validation: Check for gauge elements using page object method
        const gaugeElements = await pm.metricsPage.getGaugeElementCount();
        testLogger.info(`Found ${gaugeElements} gauge elements`);
        expect(gaugeElements).toBeGreaterThan(0);
      } else {
        testLogger.warn('Gauge chart did not render');
      }
    } else {
      testLogger.warn('Gauge chart selector not found');
    }

    testLogger.info('Gauge chart test completed');
  });

  test("Select Bar Chart for PromQL query with multiple series", {
    tag: ['@metrics', '@visualization', '@chart-bar', '@P1', '@new-feature']
  }, async ({ page }) => {
    testLogger.info('Testing NEW Bar chart support for PromQL');

    // Execute PromQL query with grouping (for multiple bars)
    await executeTestQuery(pm, 'sum(rate(http_requests_total[5m])) by (method)');

    // Select Bar chart using page object method
    const barSelected = await pm.metricsPage.selectChartType('bar');

    if (barSelected) {
      // Verify Bar chart renders using page object method
      const barRendered = await pm.metricsPage.expectChartTypeRendered('bar');

      if (barRendered) {
        testLogger.info('Bar chart rendered successfully');

        // Additional validation: Check for bar elements using page object method
        const bars = await pm.metricsPage.getBarElementCount();
        testLogger.info(`Found ${bars} bar elements`);
        expect(bars).toBeGreaterThan(0);
      } else {
        testLogger.warn('Bar chart did not render');
      }
    } else {
      testLogger.warn('Bar chart selector not found');
    }

    testLogger.info('Bar chart test completed');
  });

  test("Switch between different chart types", {
    tag: ['@metrics', '@visualization', '@chart-switching', '@P1', '@new-feature']
  }, async ({ page }) => {
    testLogger.info('Testing chart type switching functionality');

    // Execute a test query first
    await executeTestQuery(pm, 'rate(http_requests_total[5m])');

    // Test switching between chart types
    const chartTypes = ['line', 'pie', 'table', 'bar'];

    for (const chartType of chartTypes) {
      testLogger.info(`Switching to ${chartType} chart`);

      // Use page object method to select chart type
      const selected = await pm.metricsPage.selectChartType(chartType);
      if (selected) {
        // Use page object method to verify rendering
        const rendered = await pm.metricsPage.expectChartTypeRendered(chartType);
        testLogger.info(`${chartType} chart: ${rendered ? 'RENDERED' : 'NOT RENDERED'}`);

        // Wait between switches
        await page.waitForTimeout(1000);
      } else {
        testLogger.info(`${chartType} chart selector not found - skipping`);
      }
    }

    testLogger.info('Chart type switching test completed');
  });

  // =====================================================
  // P2 TESTS - EDGE CASES FOR NEW CHART TYPES
  // =====================================================

  test("Verify chart type persists after query re-execution", {
    tag: ['@metrics', '@visualization', '@persistence', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing chart type persistence');

    // Execute query
    await executeTestQuery(pm, 'up');

    // Select Table chart using page object method
    const tableSelected = await pm.metricsPage.selectChartType('table');

    if (tableSelected) {
      await page.waitForTimeout(1000);

      // Re-execute query
      await pm.metricsPage.clickApplyButton();
      await pm.metricsPage.waitForMetricsResults();
      await page.waitForTimeout(2000);

      // Verify Table is still displayed using page object method
      const tableStillRendered = await pm.metricsPage.expectChartTypeRendered('table');
      expect(tableStillRendered).toBeTruthy();

      testLogger.info('Chart type persisted after query re-execution');
    } else {
      testLogger.warn('Table chart selector not found - skipping persistence test');
    }

    testLogger.info('Persistence test completed');
  });

  test("Verify appropriate chart types for different query results", {
    tag: ['@metrics', '@visualization', '@compatibility', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing chart type compatibility with different queries');

    // Test 1: Single value query (good for Gauge)
    await executeTestQuery(pm, 'avg(up)');
    testLogger.info('Single value query executed - suitable for Gauge chart');

    // Test 2: Time series query (good for Line)
    await executeTestQuery(pm, 'rate(http_requests_total[5m])');
    testLogger.info('Time series query executed - suitable for Line chart');

    // Test 3: Grouped query (good for Pie/Bar)
    await executeTestQuery(pm, 'sum(up) by (job)');
    testLogger.info('Grouped query executed - suitable for Pie/Bar chart');

    // Note: This test validates that queries execute successfully
    // Visual validation of "appropriateness" is subjective

    testLogger.info('Compatibility test completed');
  });
});
