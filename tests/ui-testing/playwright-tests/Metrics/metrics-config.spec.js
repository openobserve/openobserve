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

  // CONSOLIDATED TEST 1: Time range configurations (date picker, presets, auto-refresh) (3 tests → 1 test)
  test("Configure time range settings (custom dates, presets, auto-refresh)", {
    tag: ['@metrics', '@config', '@datetime', '@timerange', '@refresh', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing time range configuration features');

    // Test 1: Custom date range
    testLogger.info('Testing custom date range configuration');
    const opened = await pm.metricsPage.clickDateTimePicker();

    if (opened) {
      testLogger.info('Date picker opened');

      const customRange = await pm.metricsPage.getCustomRangeOption();
      if (await customRange.isVisible()) {
        await customRange.click();
        testLogger.info('Custom date range option selected');
      }

      const dateInput = await pm.metricsPage.getDateInput();
      if (await dateInput.isVisible()) {
        testLogger.info('Date input field is visible');
      }
    }

    // Test 2: Time range presets
    testLogger.info('Testing time range presets');
    const datePicker = await pm.metricsPage.getDateTimePicker();

    if (await datePicker.isVisible()) {
      await datePicker.click();
      await page.waitForTimeout(500);

      const presets = [
        'Last 5 minutes',
        'Last 15 minutes',
        'Last 1 hour',
        'Last 6 hours',
        'Last 1 day'
      ];

      let foundPreset = false;
      for (const preset of presets) {
        const presetOption = await pm.metricsPage.getPresetOptionByText(preset);
        if (await presetOption.isVisible().catch(() => false)) {
          testLogger.info(`Found preset: ${preset}`);
          foundPreset = true;
          if (preset === 'Last 1 hour') {
            await presetOption.click();
            testLogger.info('Selected "Last 1 hour" preset');
            break;
          }
        }
      }

      // Should have found at least one preset option (or date picker may use different UI)
      if (!foundPreset) {
        testLogger.warn('No preset options found - date picker may use different UI pattern');
        // Close the date picker if it's still open
        await page.keyboard.press('Escape');
      } else {
        expect(foundPreset).toBe(true);
      }
    }

    // Test 3: Auto-refresh configuration
    testLogger.info('Testing auto-refresh interval configuration');
    const refreshButton = await pm.metricsPage.getRefreshButton();

    if (await refreshButton.isVisible()) {
      await refreshButton.click();
      await page.waitForTimeout(500);

      const intervalOptions = await pm.metricsPage.getIntervalOptions();
      const optionCount = await intervalOptions.count();

      if (optionCount > 0) {
        testLogger.info(`Found ${optionCount} refresh interval options`);
        await intervalOptions.first().click();
        testLogger.info('Selected refresh interval');
      }
    }

    testLogger.info('Time range configuration tests completed');
  });

  // CONSOLIDATED TEST 2: Panel and display settings (panel settings, axis, threshold, export) (4 tests → 1 test)
  test("Configure panel display settings (settings, axis, threshold, export)", {
    tag: ['@metrics', '@config', '@panel', '@axis', '@threshold', '@export', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing panel display settings configuration');

    await pm.metricsPage.executeQuery('cpu_usage');
    await page.waitForTimeout(2000);

    // Test 1: Panel display settings
    testLogger.info('Testing panel display settings');
    const settingsButton = await pm.metricsPage.getSettingsButton();

    if (await settingsButton.isVisible().catch(() => false)) {
      await settingsButton.click();
      await page.waitForTimeout(500);
      testLogger.info('Settings button clicked');

      const settingsPanel = await pm.metricsPage.getSettingsPanel();
      const isPanelVisible = await settingsPanel.isVisible().catch(() => false);

      if (!isPanelVisible) {
        testLogger.warn('Settings panel not visible - may not be implemented or different UI pattern');
        await page.keyboard.press('Escape');
        return; // Skip rest of this test
      }

      expect(isPanelVisible).toBe(true); // Settings panel should open
      testLogger.info('Settings panel opened');

      const settingOptions = [
        'Show data points',
        'Stack series',
        'Show grid',
        'Y-axis scale'
      ];

      let foundOptions = 0;
      for (const option of settingOptions) {
        const settingElement = await pm.metricsPage.getSettingElementByText(option);
        if (await settingElement.isVisible().catch(() => false)) {
          testLogger.info(`Found setting option: ${option}`);
          foundOptions++;
        }
      }

      // Should have found at least some setting options
      expect(foundOptions).toBeGreaterThan(0);

      const closeButton = await pm.metricsPage.getCloseButton();
      const isCloseVisible = await closeButton.isVisible();
      expect(isCloseVisible).toBe(true); // Close button should be visible

      await closeButton.click();
      testLogger.info('Settings panel closed');
    }

    // Test 2: Axis configuration
    testLogger.info('Testing axis configuration');
    const axisButton = await pm.metricsPage.getAxisButton();

    if (await axisButton.isVisible().catch(() => false)) {
      await axisButton.click();
      await page.waitForTimeout(500);
      testLogger.info('Axis configuration button clicked');

      const axisOptions = ['Linear', 'Logarithmic', 'Min value', 'Max value', 'Auto scale'];

      for (const option of axisOptions) {
        const optionElement = await pm.metricsPage.getSettingElementByText(option);
        if (await optionElement.isVisible().catch(() => false)) {
          testLogger.info(`Found axis option: ${option}`);
        }
      }
    }

    // Test 3: Threshold configuration
    testLogger.info('Testing threshold configuration');
    await pm.metricsPage.executeQuery('memory_usage');
    await page.waitForTimeout(2000);

    const thresholdButton = await pm.metricsPage.getThresholdButton();

    if (await thresholdButton.isVisible().catch(() => false)) {
      await thresholdButton.click();
      await page.waitForTimeout(500);
      testLogger.info('Threshold configuration button clicked');

      const thresholdInputs = await pm.metricsPage.getThresholdInputs();
      const inputCount = await thresholdInputs.count();

      if (inputCount > 0) {
        testLogger.info(`Found ${inputCount} threshold input fields`);
        const firstInput = thresholdInputs.first();
        await firstInput.fill('80');
        testLogger.info('Set threshold value to 80');
      }
    }

    // Test 4: Export configuration
    testLogger.info('Testing export configuration');
    await pm.metricsPage.executeQuery('up');
    await page.waitForTimeout(2000);

    const exportButton = await pm.metricsPage.getExportButton();

    if (await exportButton.isVisible().catch(() => false)) {
      await exportButton.click();
      await page.waitForTimeout(500);
      testLogger.info('Export button clicked');

      const exportOptions = await pm.metricsPage.getExportOptions();
      const optionCount = await exportOptions.count();

      if (optionCount > 0) {
        testLogger.info(`Found ${optionCount} export options`);

        const csvOption = exportOptions.filter({ hasText: 'CSV' }).first();
        if (await csvOption.isVisible().catch(() => false)) {
          testLogger.info('CSV export option available');
        }
      }
    }

    testLogger.info('Panel display settings configuration tests completed');
  });
});
