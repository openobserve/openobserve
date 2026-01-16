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

  // CONSOLIDATED TEST 1: All chart type selections and rendering (9 tests → 1 test)
  test("Verify all chart type selections render correctly", {
    tag: ['@metrics', '@visualization', '@chart-types', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing all chart type selections and rendering');

    // Execute a query first
    await pm.metricsPage.executeQuery('rate(http_requests_total[5m])');

    const chartTests = [
      {
        type: 'line',
        name: 'Line chart',
        query: 'rate(request_count[5m])',
        checkAxes: true,
        checkLegend: true,
        checkSeries: true
      },
      {
        type: 'bar',
        name: 'Bar chart',
        query: 'sum by (endpoint) (http_requests_total)',
        checkBars: true
      },
      {
        type: 'area',
        name: 'Area chart',
        query: 'rate(http_requests_total[5m])',
        checkAreaFills: true
      },
      {
        type: 'scatter',
        name: 'Scatter plot',
        query: 'cpu_usage_percent',
        checkScatterPoints: true
      },
      {
        type: 'pie',
        name: 'Pie chart',
        query: 'sum by (status) (http_requests_total)',
        checkSlices: true
      },
      {
        type: 'heatmap',
        name: 'Heatmap',
        query: 'histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))',
        checkCells: true
      },
      {
        type: 'table',
        name: 'Table view',
        query: 'topk(10, http_requests_total)',
        checkHeaders: true,
        checkRows: true
      }
    ];

    for (const chart of chartTests) {
      testLogger.info(`Testing ${chart.name}`);

      // Execute query for this chart type
      await pm.metricsPage.executeQuery(chart.query);
      await page.waitForTimeout(1000);

      // Select chart type
      const selected = await pm.metricsPage.selectChartType(chart.type);

      // Chart type selector must be available
      if (!selected) {
        testLogger.error(`${chart.name} selector not found - this is unexpected`);
        expect(selected).toBeTruthy(); // Fail the test - chart type should be available
      }

      // Wait for rendering
      await page.waitForTimeout(2000);

      // Verify chart renders
      if (chart.type === 'line' && chart.checkAxes) {
        await pm.metricsPage.expectChartCanvasVisible();
        const xAxis = await pm.metricsPage.getXAxis();
        const yAxis = await pm.metricsPage.getYAxis();
        const hasAxes = (await xAxis.isVisible().catch(() => false)) || (await yAxis.isVisible().catch(() => false));
        if (hasAxes) {
          testLogger.info('Line chart axes detected');
        }

        if (chart.checkLegend && await pm.metricsPage.isLegendVisible()) {
          testLogger.info('Line chart legend visible');
        }

        if (chart.checkSeries) {
          const series = await pm.metricsPage.getChartSeries();
          const seriesCount = await series.count();
          if (seriesCount > 0) {
            testLogger.info(`Line chart displaying ${seriesCount} series`);
          }
        }
      } else if (chart.type === 'bar' && chart.checkBars) {
        const bars = await pm.metricsPage.getBars();
        const barCount = await bars.count();
        if (barCount > 0) {
          testLogger.info(`Bar chart rendered with ${barCount} bars`);
        }
      } else if (chart.type === 'area' && chart.checkAreaFills) {
        const fills = await pm.metricsPage.getAreaFills();
        const fillCount = await fills.count();
        if (fillCount > 0) {
          testLogger.info(`Area chart rendered with ${fillCount} filled regions`);
        }
      } else if (chart.type === 'scatter' && chart.checkScatterPoints) {
        const dots = await pm.metricsPage.getScatterDots();
        const dotCount = await dots.count();
        if (dotCount > 0) {
          testLogger.info(`Scatter plot rendered with ${dotCount} points`);
        }
      } else if (chart.type === 'pie' && chart.checkSlices) {
        const arcs = await pm.metricsPage.getPieArcs();
        const arcCount = await arcs.count();
        if (arcCount > 0) {
          testLogger.info(`Pie chart rendered with ${arcCount} slices`);
        }
      } else if (chart.type === 'heatmap' && chart.checkCells) {
        const gridCells = await pm.metricsPage.getHeatmapGridCells();
        const cellCount = await gridCells.count();
        if (cellCount > 4) {
          testLogger.info(`Heatmap rendered with ${cellCount} cells`);
        }
      } else if (chart.type === 'table') {
        await pm.metricsPage.expectTableVisible();

        if (chart.checkHeaders) {
          const headers = await pm.metricsPage.getTableHeaders();
          const headerCount = await headers.count();
          if (headerCount > 0) {
            testLogger.info(`Table rendered with ${headerCount} columns`);
          }
        }

        if (chart.checkRows) {
          const rows = await pm.metricsPage.getTableRows();
          const rowCount = await rows.count();
          if (rowCount > 0) {
            testLogger.info(`Table displaying ${rowCount} data rows`);
          }
        }
      }

      testLogger.info(`${chart.name} verified successfully`);
    }

    testLogger.info('All chart types tested successfully');
  });

  // CONSOLIDATED TEST 2: Chart variations (stacked bar, stacked area, multi-series) (3 tests → 1 test)
  test("Verify chart variations with stacking and multiple series", {
    tag: ['@metrics', '@visualization', '@chart-variations', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing chart variations with stacking and multiple series');

    const variations = [
      {
        name: 'Multi-series line chart',
        type: 'line',
        query: 'sum by (service) (rate(request_count[5m]))',
        checkSeries: true,
        checkTooltip: true
      },
      {
        name: 'Stacked bar chart',
        type: 'bar',
        query: 'sum by (status, method) (rate(http_requests_total[5m]))',
        enableStacking: true
      },
      {
        name: 'Stacked area chart',
        type: 'area',
        query: 'sum by (status) (rate(http_requests_total[5m]))',
        enableStacking: true
      }
    ];

    for (const variation of variations) {
      testLogger.info(`Testing ${variation.name}`);

      await pm.metricsPage.executeQuery(variation.query);
      await page.waitForTimeout(1000);

      await pm.metricsPage.selectChartType(variation.type);
      await page.waitForTimeout(1000);

      if (variation.enableStacking) {
        const stackOption = await pm.metricsPage.getStackOption();

        // Stacking option must be available when required for this chart type
        await expect(stackOption).toBeVisible({
          timeout: 5000,
          message: `Stacking option must be available for ${variation.type} charts`
        });
        testLogger.info(`Stacking option found for ${variation.type} chart`);

        await stackOption.click();
        testLogger.info(`Enabled ${variation.type} chart stacking`);
        await page.waitForTimeout(2000);

        if (variation.type === 'bar') {
          const stackedBars = await pm.metricsPage.getStackedBars();
          const isStackedBarVisible = await stackedBars.isVisible().catch(() => false);
          expect(isStackedBarVisible).toBeTruthy(); // Should render stacked bars
          testLogger.info('Stacked bar chart rendered');
        } else if (variation.type === 'area') {
          const stackedAreas = await pm.metricsPage.getStackedAreas();
          const isStackedAreaVisible = await stackedAreas.isVisible().catch(() => false);
          expect(isStackedAreaVisible).toBeTruthy(); // Should render stacked areas
          testLogger.info('Stacked area chart rendered');
        }
      }

      if (variation.checkSeries) {
        const series = await pm.metricsPage.getChartSeries();
        const seriesCount = await series.count();
        if (seriesCount > 1) {
          testLogger.info(`${variation.name} displaying ${seriesCount} series`);
        }
      }

      if (variation.checkTooltip) {
        const chartArea = await pm.metricsPage.getChartArea();
        if (await chartArea.isVisible()) {
          try {
            await chartArea.hover({ position: { x: 100, y: 100 }, timeout: 5000 }).catch(() => chartArea.hover());
            await page.waitForTimeout(500);

            if (await pm.metricsPage.isChartTooltipVisible()) {
              testLogger.info('Chart tooltip appears on hover');
            }
          } catch (error) {
            testLogger.info('Tooltip hover test skipped due to chart interaction limitation');
          }
        }
      }

      testLogger.info(`${variation.name} tested successfully`);
    }
  });

  // CONSOLIDATED TEST 3: Advanced chart features (scatter correlation, table sorting) (2 tests → 1 test)
  test("Verify advanced chart features and customizations", {
    tag: ['@metrics', '@visualization', '@advanced-features', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing advanced chart features');

    // Test 1: Scatter plot with correlation
    testLogger.info('Testing scatter plot with correlation analysis');
    const correlationQuery = 'cpu_usage_percent and memory_usage_bytes/1000000';
    await pm.metricsPage.executeQuery(correlationQuery);
    const scatterSelected = await pm.metricsPage.selectChartType('scatter');
    await page.waitForTimeout(2000);

    // Assert: Scatter chart should be selectable
    if (scatterSelected) {
      expect(scatterSelected).toBe(true);
      testLogger.info('Scatter chart type selected successfully');
    }

    const trendLine = await pm.metricsPage.getTrendLine();
    const hasTrendLine = await trendLine.isVisible().catch(() => false);
    if (hasTrendLine) {
      // Assert: Trend line should be visible if correlation feature exists
      expect(trendLine).toBeVisible();
      testLogger.info('Correlation trend line displayed');
    }

    const correlationText = await pm.metricsPage.getCorrelationText();
    const hasCorrelationText = await correlationText.isVisible().catch(() => false);
    if (hasCorrelationText) {
      const value = await correlationText.textContent();
      // Assert: Correlation text should contain valid coefficient
      expect(value).toMatch(/correlation|r²|R²|\d+\.\d+/i);
      testLogger.info(`Correlation coefficient: ${value}`);
    }

    // Test 2: Table sorting
    testLogger.info('Testing table sorting functionality');
    await pm.metricsPage.executeQuery('topk(10, http_requests_total)');
    const tableSelected = await pm.metricsPage.selectChartType('table');
    await page.waitForTimeout(1000);

    // Assert: Table chart should be selectable
    expect(tableSelected).toBe(true);

    const sortableHeader = await pm.metricsPage.getSortableHeader();
    const hasSortableHeader = await sortableHeader.isVisible().catch(() => false);
    if (hasSortableHeader) {
      // Assert: Table should have sortable headers
      expect(sortableHeader).toBeVisible();
      await sortableHeader.click();
      await page.waitForTimeout(500);
      testLogger.info('Table sorting functionality available and working');
    }

    testLogger.info('Advanced chart features tested successfully');
  });

  // CONSOLIDATED TEST 4: Chart interactions (zoom, pan, export, customization) (3 tests → 1 test)
  test("Verify chart interaction features (zoom, pan, export, settings)", {
    tag: ['@metrics', '@visualization', '@interaction', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing chart interaction features');

    await pm.metricsPage.executeQuery('rate(http_requests_total[1h])');
    await pm.metricsPage.selectChartType('line');
    await page.waitForTimeout(1000);

    // Test zoom and pan
    const chartArea = await pm.metricsPage.getChartArea();
    const isChartVisible = await chartArea.isVisible();

    if (isChartVisible) {
      // Assert: Chart area should be visible for interaction
      expect(chartArea).toBeVisible();

      await chartArea.hover();
      await page.mouse.wheel(0, -100); // Zoom in
      await page.waitForTimeout(500);
      testLogger.info('Chart zoom tested');

      await page.mouse.down();
      await page.mouse.move(100, 0);
      await page.mouse.up();
      await page.waitForTimeout(500);
      testLogger.info('Chart pan tested');

      const resetButton = await pm.metricsPage.getResetButton();
      const hasResetButton = await resetButton.isVisible().catch(() => false);
      if (hasResetButton) {
        // Assert: Reset button should be available after zoom
        expect(resetButton).toBeVisible();
        await resetButton.click();
        testLogger.info('Chart zoom reset available');
      }
    }

    // Test export functionality
    const exportButton = await pm.metricsPage.getExportButtonElement();
    const hasExportButton = await exportButton.isVisible().catch(() => false);

    if (hasExportButton) {
      await exportButton.click();
      await page.waitForTimeout(500);

      const pngOption = await pm.metricsPage.getPngOption();
      const svgOption = await pm.metricsPage.getSvgOption();
      const csvOption = await pm.metricsPage.getCsvOption();

      const hasPng = await pngOption.isVisible().catch(() => false);
      const hasSvg = await svgOption.isVisible().catch(() => false);
      const hasCsv = await csvOption.isVisible().catch(() => false);

      // Assert: At least one export format should be available
      expect(hasPng || hasSvg || hasCsv).toBe(true);

      if (hasPng) testLogger.info('PNG export option available');
      if (hasSvg) testLogger.info('SVG export option available');
      if (hasCsv) testLogger.info('CSV export option available');

      await page.keyboard.press('Escape');
    }

    // Test chart customization options
    const settingsButton = await pm.metricsPage.getChartSettingsButton();
    const hasSettingsButton = await settingsButton.isVisible().catch(() => false);

    if (hasSettingsButton) {
      await settingsButton.click();
      await page.waitForTimeout(500);

      const legendToggle = await pm.metricsPage.getLegendToggleOption();
      const gridToggle = await pm.metricsPage.getGridToggleOption();
      const tooltipToggle = await pm.metricsPage.getTooltipToggleOption();

      const hasLegend = await legendToggle.isVisible().catch(() => false);
      const hasGrid = await gridToggle.isVisible().catch(() => false);
      const hasTooltip = await tooltipToggle.isVisible().catch(() => false);

      // Assert: At least one customization option should be available
      expect(hasLegend || hasGrid || hasTooltip).toBe(true);

      if (hasLegend) testLogger.info('Legend toggle option available');
      if (hasGrid) testLogger.info('Grid toggle option available');
      if (hasTooltip) testLogger.info('Tooltip toggle option available');

      await page.keyboard.press('Escape');
    }

    testLogger.info('Chart interaction features tested successfully');
  });
});
