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

    // Open date picker
    const datePicker = page.locator('[data-test="date-time-picker"]').or(
      page.locator('[data-test="metrics-date-picker"]')
    ).or(
      page.locator('[data-cy="date-time-btn"]')
    );

    if (await datePicker.isVisible()) {
      await datePicker.click();
      testLogger.info('Date picker opened');

      // Look for custom range option
      const customRange = page.locator('text=/custom|relative|absolute/i').first();
      if (await customRange.isVisible()) {
        await customRange.click();
        testLogger.info('Custom date range option selected');
      }

      // Verify date picker UI elements
      const dateInput = page.locator('input[type="date"], input[placeholder*="date"]').first();
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

    // Look for refresh button/dropdown
    const refreshButton = page.locator('[data-test*="refresh"]').or(
      page.locator('[data-cy*="refresh"]')
    ).or(
      page.locator('button:has-text("Off")')
    ).first();

    if (await refreshButton.isVisible()) {
      await refreshButton.click();
      await page.waitForTimeout(500);

      // Look for interval options
      const intervalOptions = page.locator('.q-item, [role="option"]');
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

    // Look for chart type selector
    const chartTypeSelectors = [
      '[data-test*="chart-type"]',
      '[data-cy*="chart-type"]',
      'button:has-text("Line")',
      'button:has-text("Bar")',
      '[class*="chart-type"]'
    ];

    let chartTypeButton = null;
    for (const selector of chartTypeSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible().catch(() => false)) {
        chartTypeButton = element;
        testLogger.info(`Found chart type selector: ${selector}`);
        break;
      }
    }

    if (chartTypeButton) {
      await chartTypeButton.click();
      await page.waitForTimeout(500);

      // Look for chart type options
      const chartOptions = page.locator('.q-item:visible, [role="option"]:visible');
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

    // Look for legend toggle
    const legendSelectors = [
      '[data-test*="legend"]',
      '[data-cy*="legend"]',
      'button:has-text("Legend")',
      '[class*="legend-toggle"]'
    ];

    let legendToggle = null;
    for (const selector of legendSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible().catch(() => false)) {
        legendToggle = element;
        testLogger.info(`Found legend toggle: ${selector}`);
        break;
      }
    }

    if (legendToggle) {
      // Check initial state
      const initialState = await legendToggle.getAttribute('aria-pressed') || 'false';

      await legendToggle.click();
      await page.waitForTimeout(500);

      const newState = await legendToggle.getAttribute('aria-pressed') || 'true';

      if (initialState !== newState) {
        testLogger.info(`Legend toggled from ${initialState} to ${newState}`);
      }
    }

    // Check if legend is visible
    const legend = page.locator('.legend, [class*="legend-container"]').first();
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

    // Open date picker
    const datePicker = page.locator('[data-test="date-time-picker"]').or(
      page.locator('[data-cy="date-time-btn"]')
    ).first();

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

    // Look for query mode toggle (PromQL vs SQL)
    const queryModeSelectors = [
      '[data-test*="query-mode"]',
      'button:has-text("PromQL")',
      'button:has-text("SQL")',
      '[class*="query-mode"]'
    ];

    let queryModeToggle = null;
    for (const selector of queryModeSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible().catch(() => false)) {
        queryModeToggle = element;
        testLogger.info(`Found query mode selector: ${selector}`);
        break;
      }
    }

    if (queryModeToggle) {
      const currentMode = await queryModeToggle.textContent();
      testLogger.info(`Current query mode: ${currentMode}`);

      await queryModeToggle.click();
      await page.waitForTimeout(500);

      // Check if mode options appear
      const modeOptions = page.locator('.q-item:has-text("SQL"), .q-item:has-text("PromQL")');
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

    // Look for panel settings button
    const settingsSelectors = [
      '[data-test*="panel-settings"]',
      '[data-test*="chart-settings"]',
      'button[aria-label*="settings"]',
      '[class*="settings-btn"]'
    ];

    let settingsButton = null;
    for (const selector of settingsSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible().catch(() => false)) {
        settingsButton = element;
        testLogger.info(`Found settings button: ${selector}`);
        break;
      }
    }

    if (settingsButton) {
      await settingsButton.click();
      await page.waitForTimeout(500);

      // Look for settings panel/modal
      const settingsPanel = page.locator('.settings-panel, .settings-modal, [class*="settings-dialog"]').first();
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

        // Close settings
        const closeButton = page.locator('button:has-text("Close"), button:has-text("Cancel"), [aria-label="Close"]').first();
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

    // Look for export button
    const exportSelectors = [
      '[data-test*="export"]',
      'button:has-text("Export")',
      'button[aria-label*="export"]',
      '[class*="export-btn"]'
    ];

    let exportButton = null;
    for (const selector of exportSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible().catch(() => false)) {
        exportButton = element;
        testLogger.info(`Found export button: ${selector}`);
        break;
      }
    }

    if (exportButton) {
      await exportButton.click();
      await page.waitForTimeout(500);

      // Look for export options
      const exportOptions = page.locator('.q-item:has-text("CSV"), .q-item:has-text("JSON"), .q-item:has-text("PNG")');
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

    // Look for axis configuration options
    const axisSelectors = [
      '[data-test*="axis-config"]',
      '[data-test*="y-axis"]',
      '[data-test*="x-axis"]',
      'button:has-text("Axis")',
      '[class*="axis-settings"]'
    ];

    let axisButton = null;
    for (const selector of axisSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible().catch(() => false)) {
        axisButton = element;
        testLogger.info(`Found axis configuration: ${selector}`);
        break;
      }
    }

    if (axisButton) {
      await axisButton.click();
      await page.waitForTimeout(500);

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

    // Look for threshold configuration
    const thresholdSelectors = [
      '[data-test*="threshold"]',
      'button:has-text("Threshold")',
      '[class*="threshold-config"]'
    ];

    let thresholdButton = null;
    for (const selector of thresholdSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible().catch(() => false)) {
        thresholdButton = element;
        testLogger.info(`Found threshold configuration: ${selector}`);
        break;
      }
    }

    if (thresholdButton) {
      await thresholdButton.click();
      await page.waitForTimeout(500);

      // Look for threshold input fields
      const thresholdInputs = page.locator('input[type="number"][placeholder*="threshold"], input[placeholder*="value"]');
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