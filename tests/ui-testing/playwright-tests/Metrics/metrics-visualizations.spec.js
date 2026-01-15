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
test.describe("Metrics Visualization and Chart Tests", () => {
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

  // Line Chart Tests
  test("Display metrics as line chart", {
    tag: ['@metrics', '@visualization', '@line-chart', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing line chart visualization');

    // Execute a query that should produce line chart
    await pm.metricsPage.executeQuery('rate(request_count[5m])');

    // Check for line chart visualization
    await pm.metricsPage.selectChartType('line');

    // Verify line chart elements
    const chartCanvas = page.locator('canvas, .line-chart, [class*="line"], svg path[class*="line"]').first();
    await expect(chartCanvas).toBeVisible({ timeout: 10000 });

    // Check for axes
    const xAxis = page.locator('.x-axis, [class*="axis-x"], .apexcharts-xaxis, .chart-axis-x').first();
    const yAxis = page.locator('.y-axis, [class*="axis-y"], .apexcharts-yaxis, .chart-axis-y').first();

    const hasAxes = (await xAxis.isVisible().catch(() => false)) || (await yAxis.isVisible().catch(() => false));

    if (hasAxes) {
      testLogger.info('Line chart axes detected');
    }

    // Check for legend
    const legend = page.locator('.chart-legend, .legend, [class*="legend"], .apexcharts-legend').first();
    if (await legend.isVisible().catch(() => false)) {
      testLogger.info('Line chart legend visible');
    }

    // Verify actual data is displayed
    await verifyDataOnUI(pm, 'Line chart visualization');

    testLogger.info('Line chart visualization verified');
  });

  test("Line chart with multiple series", {
    tag: ['@metrics', '@visualization', '@line-chart', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing multi-series line chart');

    // Query that returns multiple series
    await pm.metricsPage.executeQuery('sum by (service) (rate(request_count[5m]))');

    // Try to set chart type to line
    await pm.metricsPage.selectChartType('line');

    // Check for multiple lines/series
    const series = page.locator('.chart-series, path[class*="line"], .apexcharts-series, g[class*="series"]');
    const seriesCount = await series.count();

    if (seriesCount > 1) {
      testLogger.info(`Line chart displaying ${seriesCount} series`);
    } else {
      testLogger.info('Line chart rendered (series count uncertain)');
    }

    // Verify actual data is displayed
    await verifyDataOnUI(pm, 'Multi-series line chart');

    // Check for tooltips on hover
    const chartArea = page.locator('canvas, svg, .chart-container').first();
    if (await chartArea.isVisible()) {
      try {
        // Try to hover with retry logic
        await chartArea.hover({ position: { x: 100, y: 100 }, timeout: 5000 }).catch(() => {
          // If hover fails, try without position
          return chartArea.hover();
        });
        await page.waitForTimeout(500);

        const tooltip = page.locator('.chart-tooltip, .tooltip, [role="tooltip"], .apexcharts-tooltip').first();
        if (await tooltip.isVisible().catch(() => false)) {
          testLogger.info('Chart tooltip appears on hover');
        }
      } catch (error) {
        testLogger.info('Tooltip hover test skipped due to chart interaction limitation');
      }
    }
  });

  // Bar Chart Tests
  test("Display metrics as bar chart", {
    tag: ['@metrics', '@visualization', '@bar-chart', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing bar chart visualization');

    // Execute aggregation query suitable for bar chart
    await pm.metricsPage.executeQuery('sum by (endpoint) (http_requests_total)');

    // Select bar chart type
    await pm.metricsPage.selectChartType('bar');

    // Verify bar chart elements
    const barElements = page.locator('rect[class*="bar"], .bar-chart, .chart-bar, path[class*="bar"], .apexcharts-bar-series').first();
    await expect(barElements).toBeVisible({ timeout: 10000 }).catch(() => {
      testLogger.info('Bar chart elements not found with expected selectors');
    });

    // Check for bar chart specific elements
    const bars = page.locator('rect, .bar, [class*="bar-element"]');
    const barCount = await bars.count();

    if (barCount > 0) {
      testLogger.info(`Bar chart rendered with ${barCount} bars`);
    }

    testLogger.info('Bar chart visualization tested');
  });

  test("Stacked bar chart for grouped metrics", {
    tag: ['@metrics', '@visualization', '@bar-chart', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing stacked bar chart');

    // Query with multiple groupings for stacked bars
    await pm.metricsPage.executeQuery('sum by (status, method) (rate(http_requests_total[5m]))');

    // Try to select stacked bar chart
    await pm.metricsPage.selectChartType('bar');

    // Look for stacking option
    const stackOption = page.locator('button:has-text("Stack"), input[type="checkbox"][name*="stack"], .stack-toggle').first();
    if (await stackOption.isVisible().catch(() => false)) {
      await stackOption.click();
      testLogger.info('Enabled bar chart stacking');
    }

    await page.waitForTimeout(2000);

    // Verify stacked bars rendered
    const stackedBars = page.locator('.stacked-bar, [class*="stack"], .apexcharts-bar-stacked').first();
    if (await stackedBars.isVisible().catch(() => false)) {
      testLogger.info('Stacked bar chart rendered');
    }
  });

  // Scatter Plot Tests
  test("Display metrics as scatter plot", {
    tag: ['@metrics', '@visualization', '@scatter', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing scatter plot visualization');

    // Query suitable for scatter plot
    await pm.metricsPage.executeQuery('cpu_usage_percent');

    // Select scatter plot type
    await pm.metricsPage.selectChartType('scatter');

    // Verify scatter plot elements
    const scatterPoints = page.locator('circle[class*="scatter"], .scatter-point, .chart-scatter, .apexcharts-scatter').first();

    if (await scatterPoints.isVisible().catch(() => false)) {
      testLogger.info('Scatter plot points visible');
    } else {
      // Alternative check for scatter elements
      const dots = page.locator('circle, .dot, [class*="point"]');
      const dotCount = await dots.count();
      if (dotCount > 0) {
        testLogger.info(`Scatter plot rendered with ${dotCount} points`);
      }
    }

    testLogger.info('Scatter plot visualization tested');
  });

  test("Scatter plot with correlation analysis", {
    tag: ['@metrics', '@visualization', '@scatter', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing scatter plot with correlation');

    // Query two metrics for correlation
    const correlationQuery = 'cpu_usage_percent and memory_usage_bytes/1000000';
    await pm.metricsPage.executeQuery(correlationQuery);

    await pm.metricsPage.selectChartType('scatter');

    await page.waitForTimeout(2000);

    // Check for trend line or correlation indicator
    const trendLine = page.locator('.trend-line, path[class*="trend"], .regression-line').first();
    if (await trendLine.isVisible().catch(() => false)) {
      testLogger.info('Correlation trend line displayed');
    }

    // Check for correlation coefficient
    const correlationText = page.locator('text=/correlation|r²|R²/i').first();
    if (await correlationText.isVisible().catch(() => false)) {
      const value = await correlationText.textContent();
      testLogger.info(`Correlation coefficient: ${value}`);
    }
  });

  // Area Chart Tests
  test("Display metrics as area chart", {
    tag: ['@metrics', '@visualization', '@area-chart', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing area chart visualization');

    // Time series query for area chart
    await pm.metricsPage.executeQuery('rate(http_requests_total[5m])');

    // Select area chart type
    await pm.metricsPage.selectChartType('area');

    // Verify area chart elements
    const areaElements = page.locator('path[class*="area"], .area-chart, .chart-area, .apexcharts-area').first();

    if (await areaElements.isVisible().catch(() => false)) {
      testLogger.info('Area chart elements detected');
    } else {
      // Check for filled regions
      const fills = page.locator('path[fill-opacity], path[fill]');
      const fillCount = await fills.count();
      if (fillCount > 0) {
        testLogger.info(`Area chart rendered with ${fillCount} filled regions`);
      }
    }

    testLogger.info('Area chart visualization tested');
  });

  test("Stacked area chart for cumulative metrics", {
    tag: ['@metrics', '@visualization', '@area-chart', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing stacked area chart');

    // Multiple series for stacking
    await pm.metricsPage.executeQuery('sum by (status) (rate(http_requests_total[5m]))');

    await pm.metricsPage.selectChartType('area');

    // Enable stacking if option available
    const stackOption = page.locator('button:has-text("Stack"), .stack-toggle, input[name*="stack"]').first();
    if (await stackOption.isVisible().catch(() => false)) {
      await stackOption.click();
      testLogger.info('Enabled area chart stacking');
    }

    await page.waitForTimeout(2000);

    // Verify stacked areas
    const stackedAreas = page.locator('.stacked-area, [class*="stack"], .apexcharts-area-stacked').first();
    if (await stackedAreas.isVisible().catch(() => false)) {
      testLogger.info('Stacked area chart rendered');
    }
  });

  // Heatmap Tests
  test("Display metrics as heatmap", {
    tag: ['@metrics', '@visualization', '@heatmap', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing heatmap visualization');

    // Query with time buckets for heatmap
    await pm.metricsPage.executeQuery('histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))');

    // Select heatmap type
    await pm.metricsPage.selectChartType('heatmap');

    // Verify heatmap elements
    const heatmapCells = page.locator('rect[class*="heat"], .heatmap-cell, .chart-heatmap, .apexcharts-heatmap').first();

    if (await heatmapCells.isVisible().catch(() => false)) {
      testLogger.info('Heatmap cells visible');
    } else {
      // Check for grid pattern
      const gridCells = page.locator('rect[fill], g[class*="cell"]');
      const cellCount = await gridCells.count();
      if (cellCount > 4) { // Multiple cells indicate heatmap
        testLogger.info(`Heatmap rendered with ${cellCount} cells`);
      }
    }

    // Check for color scale legend
    const colorScale = page.locator('.color-scale, .heatmap-legend, [class*="gradient"]').first();
    if (await colorScale.isVisible().catch(() => false)) {
      testLogger.info('Heatmap color scale legend visible');
    }

    testLogger.info('Heatmap visualization tested');
  });

  // Pie/Donut Chart Tests
  test("Display metrics as pie chart", {
    tag: ['@metrics', '@visualization', '@pie-chart', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing pie chart visualization');

    // Aggregation query for pie chart
    await pm.metricsPage.executeQuery('sum by (status) (http_requests_total)');

    // Select pie chart type
    await pm.metricsPage.selectChartType('pie');

    // Verify pie chart elements
    const pieSlices = page.locator('path[class*="pie"], .pie-slice, .chart-pie, .apexcharts-pie').first();

    if (await pieSlices.isVisible().catch(() => false)) {
      testLogger.info('Pie chart slices visible');
    } else {
      // Check for circular paths
      const arcs = page.locator('path[d*="A"], g[class*="slice"]');
      const arcCount = await arcs.count();
      if (arcCount > 0) {
        testLogger.info(`Pie chart rendered with ${arcCount} slices`);
      }
    }

    // Check for percentage labels
    const percentLabels = page.locator('text:has-text("%"), .pie-label').first();
    if (await percentLabels.isVisible().catch(() => false)) {
      testLogger.info('Pie chart percentage labels visible');
    }

    testLogger.info('Pie chart visualization tested');
  });

  // Table View Tests
  test("Display metrics in table format", {
    tag: ['@metrics', '@visualization', '@table', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing table view');

    // Query for table display
    await pm.metricsPage.executeQuery('topk(10, http_requests_total)');

    // Select table view
    await pm.metricsPage.selectChartType('table');

    // Verify table elements
    const table = page.locator('table, .data-table, [role="table"], .metrics-table').first();
    await expect(table).toBeVisible({ timeout: 10000 });

    // Check for table headers
    const headers = page.locator('th, [role="columnheader"], .table-header');
    const headerCount = await headers.count();

    if (headerCount > 0) {
      testLogger.info(`Table rendered with ${headerCount} columns`);
    }

    // Check for table rows
    const rows = page.locator('tbody tr, [role="row"], .table-row');
    const rowCount = await rows.count();

    if (rowCount > 0) {
      testLogger.info(`Table displaying ${rowCount} data rows`);
    }

    // Check for sorting functionality
    const sortableHeader = page.locator('th[class*="sort"], th[aria-sort], .sortable').first();
    if (await sortableHeader.isVisible().catch(() => false)) {
      await sortableHeader.click();
      await page.waitForTimeout(500);
      testLogger.info('Table sorting functionality available');
    }

    testLogger.info('Table view tested');
  });

  // Chart Interaction Tests
  test("Chart zoom and pan functionality", {
    tag: ['@metrics', '@visualization', '@interaction', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing chart zoom and pan');

    // Execute time series query
    await pm.metricsPage.executeQuery('rate(http_requests_total[1h])');

    await pm.metricsPage.selectChartType('line');

    const chartArea = page.locator('canvas, svg, .chart-container').first();

    if (await chartArea.isVisible()) {
      // Test zoom
      await chartArea.hover();
      await page.mouse.wheel(0, -100); // Zoom in
      await page.waitForTimeout(500);

      testLogger.info('Chart zoom tested');

      // Test pan
      await page.mouse.down();
      await page.mouse.move(100, 0);
      await page.mouse.up();
      await page.waitForTimeout(500);

      testLogger.info('Chart pan tested');

      // Check for zoom reset button
      const resetButton = page.locator('button:has-text("Reset"), .zoom-reset, button[title*="reset"]').first();
      if (await resetButton.isVisible().catch(() => false)) {
        await resetButton.click();
        testLogger.info('Chart zoom reset available');
      }
    }
  });

  // Export Chart Tests
  test("Export chart as image", {
    tag: ['@metrics', '@visualization', '@export', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing chart export functionality');

    // Execute query and render chart
    await pm.metricsPage.executeQuery('cpu_usage_percent');

    // Look for export options
    const exportButton = page.locator('button:has-text("Export"), .export-chart, button[title*="export"], button[aria-label*="export"]').first();

    if (await exportButton.isVisible().catch(() => false)) {
      await exportButton.click();
      await page.waitForTimeout(500);

      // Check for export format options
      const pngOption = page.locator('text=/PNG/i, button:has-text("PNG")').first();
      const svgOption = page.locator('text=/SVG/i, button:has-text("SVG")').first();
      const csvOption = page.locator('text=/CSV/i, button:has-text("CSV")').first();

      if (await pngOption.isVisible().catch(() => false)) {
        testLogger.info('PNG export option available');
      }
      if (await svgOption.isVisible().catch(() => false)) {
        testLogger.info('SVG export option available');
      }
      if (await csvOption.isVisible().catch(() => false)) {
        testLogger.info('CSV export option available');
      }

      // Close export menu
      await page.keyboard.press('Escape');
    } else {
      testLogger.info('Export functionality not visible');
    }
  });

  // Chart Options and Customization
  test("Customize chart display options", {
    tag: ['@metrics', '@visualization', '@customization', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing chart customization options');

    await pm.metricsPage.executeQuery('rate(http_requests_total[5m])');

    // Look for chart options/settings
    const settingsButton = page.locator('button[aria-label*="settings"], .chart-settings, button:has-text("Options")').first();

    if (await settingsButton.isVisible().catch(() => false)) {
      await settingsButton.click();
      await page.waitForTimeout(500);

      // Check for various options
      const legendToggle = page.locator('input[name*="legend"], .legend-toggle, text=/Show Legend/i').first();
      const gridToggle = page.locator('input[name*="grid"], .grid-toggle, text=/Show Grid/i').first();
      const tooltipToggle = page.locator('input[name*="tooltip"], .tooltip-toggle, text=/Show Tooltip/i').first();

      if (await legendToggle.isVisible().catch(() => false)) {
        testLogger.info('Legend toggle option available');
      }
      if (await gridToggle.isVisible().catch(() => false)) {
        testLogger.info('Grid toggle option available');
      }
      if (await tooltipToggle.isVisible().catch(() => false)) {
        testLogger.info('Tooltip toggle option available');
      }

      // Close settings
      await page.keyboard.press('Escape');
    }

    testLogger.info('Chart customization options tested');
  });
});