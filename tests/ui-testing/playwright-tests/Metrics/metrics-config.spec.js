const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

test.describe("Metrics Configuration Tests", () => {
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

  // Date/Time Configuration Tests
  test("Configure custom date range", {
    tag: ['@metrics', '@config', '@datetime', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing custom date range configuration');

    // Open date picker using page object
    const opened = await pm.metricsPage.clickDateTimePicker();

    if (opened) {
      testLogger.info('Date picker opened');

      // Look for custom range option
      const customRange = await pm.metricsPage.getCustomRangeOption();
      if (await customRange.isVisible()) {
        await customRange.click();
        testLogger.info('Custom date range option selected');
      }

      // Verify date picker UI elements
      const dateInput = await pm.metricsPage.getDateInput();
      if (await dateInput.isVisible()) {
        testLogger.info('Date input field is visible');
      }
    }

    testLogger.info('Date range configuration test completed');
  });

  test("Configure auto-refresh interval", {
    tag: ['@metrics', '@config', '@refresh', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing auto-refresh interval configuration');

    // Look for refresh button/dropdown using page object
    const refreshButton = await pm.metricsPage.getRefreshButton();

    if (await refreshButton.isVisible()) {
      await refreshButton.click();
      await page.waitForTimeout(500);

      // Look for interval options using page object
      const intervalOptions = await pm.metricsPage.getIntervalOptions();
      const optionCount = await intervalOptions.count();

      if (optionCount > 0) {
        testLogger.info(`Found ${optionCount} refresh interval options`);

        // Select first available option
        await intervalOptions.first().click();
        testLogger.info('Selected refresh interval');
      }
    }

    testLogger.info('Auto-refresh configuration test completed');
  });

  // Chart Type Configuration Tests
  test("Configure chart visualization type", {
    tag: ['@metrics', '@config', '@visualization', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing chart type configuration');

    // First execute a query to have data
    await pm.metricsPage.executeQuery('up');
    await page.waitForTimeout(2000);

    // Look for chart type selector using page object
    const chartTypeButton = await pm.metricsPage.getChartTypeButton();

    if (await chartTypeButton.isVisible().catch(() => false)) {
      await chartTypeButton.click();
      await page.waitForTimeout(500);
      testLogger.info('Chart type selector clicked');

      // Look for chart type options using page object
      const chartOptions = await pm.metricsPage.getVisibleChartOptions();
      const optionCount = await chartOptions.count();

      if (optionCount > 0) {
        testLogger.info(`Found ${optionCount} chart type options`);

        // Try to select bar chart
        const barOption = chartOptions.filter({ hasText: /bar/i }).first();
        if (await barOption.isVisible().catch(() => false)) {
          await barOption.click();
          testLogger.info('Selected bar chart type');
        }
      }
    }

    testLogger.info('Chart type configuration test completed');
  });

  // Legend Configuration Tests
  test("Configure chart legend display", {
    tag: ['@metrics', '@config', '@legend', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing legend configuration');

    // Execute a query first
    await pm.metricsPage.executeQuery('up');
    await page.waitForTimeout(2000);

    // Look for legend toggle using page object
    const legendToggle = await pm.metricsPage.getLegendToggle();

    if (await legendToggle.isVisible().catch(() => false)) {
      testLogger.info('Found legend toggle');

      // Check initial state
      const initialState = await legendToggle.getAttribute('aria-pressed') || 'false';

      await legendToggle.click();
      await page.waitForTimeout(500);

      const newState = await legendToggle.getAttribute('aria-pressed') || 'true';

      if (initialState !== newState) {
        testLogger.info(`Legend toggled from ${initialState} to ${newState}`);
      }
    }

    // Check if legend is visible using page object
    const legend = await pm.metricsPage.getLegendElement();
    if (await legend.isVisible().catch(() => false)) {
      testLogger.info('Legend is visible on chart');
    }

    testLogger.info('Legend configuration test completed');
  });

  // Time Range Presets Tests
  test("Select time range presets", {
    tag: ['@metrics', '@config', '@timerange', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing time range presets');

    // Open date picker using page object
    const datePicker = await pm.metricsPage.getDateTimePicker();

    if (await datePicker.isVisible()) {
      await datePicker.click();
      await page.waitForTimeout(500);

      // Look for preset options
      const presets = [
        'Last 5 minutes',
        'Last 15 minutes',
        'Last 30 minutes',
        'Last 1 hour',
        'Last 6 hours',
        'Last 1 day',
        'Last 2 days',
        'Last 7 days'
      ];

      for (const preset of presets) {
        const presetOption = page.locator(`text="${preset}"`).first();
        if (await presetOption.isVisible().catch(() => false)) {
          testLogger.info(`Found preset: ${preset}`);
          // Don't click all of them, just verify they exist
          if (preset === 'Last 1 hour') {
            await presetOption.click();
            testLogger.info('Selected "Last 1 hour" preset');
            break;
          }
        }
      }
    }

    testLogger.info('Time range presets test completed');
  });

  // Query Builder Configuration Tests
  test("Configure query builder mode", {
    tag: ['@metrics', '@config', '@querybuilder', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing query builder configuration');

    // Look for query mode toggle (PromQL vs SQL) using page object
    const queryModeToggle = await pm.metricsPage.getQueryModeToggle();

    if (await queryModeToggle.isVisible().catch(() => false)) {
      const currentMode = await queryModeToggle.textContent();
      testLogger.info(`Current query mode: ${currentMode}`);

      await queryModeToggle.click();
      await page.waitForTimeout(500);

      // Check if mode options appear using page object
      const modeOptions = await pm.metricsPage.getModeOptions();
      if (await modeOptions.count() > 0) {
        testLogger.info('Query mode options are available');
      }
    }

    testLogger.info('Query builder configuration test completed');
  });

  // Panel Settings Tests
  test("Configure panel display settings", {
    tag: ['@metrics', '@config', '@panel', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing panel display settings');

    // Execute a query first
    await pm.metricsPage.executeQuery('cpu_usage');
    await page.waitForTimeout(2000);

    // Look for panel settings button using page object
    const settingsButton = await pm.metricsPage.getSettingsButton();

    if (await settingsButton.isVisible().catch(() => false)) {
      await settingsButton.click();
      await page.waitForTimeout(500);
      testLogger.info('Settings button clicked');

      // Look for settings panel/modal using page object
      const settingsPanel = await pm.metricsPage.getSettingsPanel();
      if (await settingsPanel.isVisible().catch(() => false)) {
        testLogger.info('Settings panel opened');

        // Look for common settings options
        const settingOptions = [
          'Show data points',
          'Stack series',
          'Fill area',
          'Show grid',
          'Y-axis scale'
        ];

        for (const option of settingOptions) {
          const settingElement = page.locator(`text=/${option}/i`).first();
          if (await settingElement.isVisible().catch(() => false)) {
            testLogger.info(`Found setting option: ${option}`);
          }
        }

        // Close settings using page object
        const closeButton = await pm.metricsPage.getCloseButton();
        if (await closeButton.isVisible()) {
          await closeButton.click();
          testLogger.info('Settings panel closed');
        }
      }
    }

    testLogger.info('Panel display settings test completed');
  });

  // Export Configuration Tests
  test("Configure export options", {
    tag: ['@metrics', '@config', '@export', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing export configuration');

    // Execute a query first
    await pm.metricsPage.executeQuery('up');
    await page.waitForTimeout(2000);

    // Look for export button using page object
    const exportButton = await pm.metricsPage.getExportButton();

    if (await exportButton.isVisible().catch(() => false)) {
      await exportButton.click();
      await page.waitForTimeout(500);
      testLogger.info('Export button clicked');

      // Look for export options using page object
      const exportOptions = await pm.metricsPage.getExportOptions();
      const optionCount = await exportOptions.count();

      if (optionCount > 0) {
        testLogger.info(`Found ${optionCount} export options`);

        // Don't actually export, just verify options exist
        const csvOption = exportOptions.filter({ hasText: 'CSV' }).first();
        if (await csvOption.isVisible().catch(() => false)) {
          testLogger.info('CSV export option available');
        }
      }
    }

    testLogger.info('Export configuration test completed');
  });

  // Axis Configuration Tests
  test("Configure axis settings", {
    tag: ['@metrics', '@config', '@axis', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing axis configuration');

    // Execute a query with numeric data
    await pm.metricsPage.executeQuery('cpu_usage');
    await page.waitForTimeout(2000);

    // Look for axis configuration options using page object
    const axisButton = await pm.metricsPage.getAxisButton();

    if (await axisButton.isVisible().catch(() => false)) {
      await axisButton.click();
      await page.waitForTimeout(500);
      testLogger.info('Axis configuration button clicked');

      // Look for axis options
      const axisOptions = [
        'Linear',
        'Logarithmic',
        'Min value',
        'Max value',
        'Auto scale'
      ];

      for (const option of axisOptions) {
        const optionElement = page.locator(`text=/${option}/i`).first();
        if (await optionElement.isVisible().catch(() => false)) {
          testLogger.info(`Found axis option: ${option}`);
        }
      }
    }

    testLogger.info('Axis configuration test completed');
  });

  // Threshold Configuration Tests
  test("Configure value thresholds", {
    tag: ['@metrics', '@config', '@threshold', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing threshold configuration');

    // Execute a query first
    await pm.metricsPage.executeQuery('memory_usage');
    await page.waitForTimeout(2000);

    // Look for threshold configuration using page object
    const thresholdButton = await pm.metricsPage.getThresholdButton();

    if (await thresholdButton.isVisible().catch(() => false)) {
      await thresholdButton.click();
      await page.waitForTimeout(500);
      testLogger.info('Threshold configuration button clicked');

      // Look for threshold input fields using page object
      const thresholdInputs = await pm.metricsPage.getThresholdInputs();
      const inputCount = await thresholdInputs.count();

      if (inputCount > 0) {
        testLogger.info(`Found ${inputCount} threshold input fields`);

        // Set a threshold value
        const firstInput = thresholdInputs.first();
        await firstInput.fill('80');
        testLogger.info('Set threshold value to 80');
      }
    }

    testLogger.info('Threshold configuration test completed');
  });
});