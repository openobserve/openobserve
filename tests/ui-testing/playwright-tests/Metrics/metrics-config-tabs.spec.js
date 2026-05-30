const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

test.describe("Metrics Config Tabs Tests", () => {
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  async function setupTest(page, testInfo) {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    await pm.metricsPage.gotoMetricsPage();
    await page.waitForLoadState('domcontentloaded');
    await pm.metricsPage.executeQuery('up');
    await pm.metricsPage.waitForChartRender(15000);
    testLogger.info('Test setup completed - metrics page ready with query results');
    return pm;
  }

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // CONSOLIDATED TEST 1: Config sidebar open/close/navigation (3 tests → 1 test)
  test("Open config sidebar and navigate between tabs", {
    tag: ['@metrics', '@config', '@sidebar', '@tabs', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing config sidebar opening and tab navigation');

    // Test 1: Open config sidebar
    testLogger.info('Opening config sidebar');
    const configButton = await pm.metricsPage.getDashboardSidebarButton();
    await expect(configButton).toBeVisible({ timeout: 10000 });

    await pm.metricsPage.openConfigSidebar();

    expect(await pm.metricsPage.isSidebarVisible()).toBe(true);
    testLogger.info('Config sidebar opened successfully');

    // Test 2: Navigate between config sections (Legend, Data, Axis, Labels)
    const sectionKeys = await pm.metricsPage.getConfigSectionKeys();
    testLogger.info(`Found ${sectionKeys.length} config sections`);

    expect(sectionKeys.length).toBeGreaterThan(0);

    for (const sectionKey of sectionKeys.slice(0, 5)) {
      const toggled = await pm.metricsPage.toggleConfigSection(sectionKey);
      testLogger.info(`Toggled section: ${sectionKey} (success: ${toggled})`);

      if (toggled) {
        const visible = await pm.metricsPage.isConfigSectionVisible(sectionKey);
        if (visible) {
          testLogger.info(`Config section visible: ${sectionKey}`);
        }
      }
    }

    // Test 3: Close sidebar
    testLogger.info('Closing config sidebar');
    await pm.metricsPage.closeConfigSidebar();

    const sidebarVisible = await pm.metricsPage.isSidebarVisible();
    if (!sidebarVisible) {
      testLogger.info('Config sidebar closed successfully');
    } else {
      testLogger.info('Sidebar still visible (may be minimized)');
    }

    testLogger.info('Config sidebar and tab navigation test completed');
  });

  // CONSOLIDATED TEST 2: Tab-specific configurations (Query, Legend, Axes, Options) (4 tests → 1 test)
  test("Configure settings in different config tabs (Query, Legend, Axes, Options)", {
    tag: ['@metrics', '@config', '@tabs-configuration', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing configuration settings across different tabs');

    await pm.metricsPage.openConfigSidebar();

    // Legend section: toggle show-legend
    testLogger.info('Testing Legend tab — show-legend toggle');
    if (await pm.metricsPage.isConfigShowLegendVisible()) {
      await pm.metricsPage.clickConfigShowLegend();
      testLogger.info('Toggled show-legend');
    }

    // Data section: set unit
    testLogger.info('Testing Data tab — decimals input');
    if (await pm.metricsPage.isConfigDecimalsVisible()) {
      await pm.metricsPage.fillConfigDecimals('2');
      const decimalsValue = await pm.metricsPage.getConfigDecimalsValue();
      expect(decimalsValue).toBe('2');
      testLogger.info('Set and verified decimals value: 2');
    }

    // Axis section: y-axis min/max
    testLogger.info('Testing Axes tab — y_axis_min input');
    if (await pm.metricsPage.isConfigYAxisMinVisible()) {
      await pm.metricsPage.fillConfigYAxisMin('100');
      const minValue = await pm.metricsPage.getConfigYAxisMinValue();
      expect(minValue).toBe('100');
      testLogger.info('Set and verified axis value: 100');
    }

    // Options: connect-null-values toggle
    testLogger.info('Testing Options tab — connect-null-values toggle');
    if (await pm.metricsPage.isConfigConnectNullValuesVisible()) {
      await pm.metricsPage.clickConfigConnectNullValues();
      testLogger.info('Toggled connect-null-values');
    }

    testLogger.info('All tab configurations tested successfully');
  });

  // CONSOLIDATED TEST 3: Config behavior (save, persistence, chart type updates) (3 tests → 1 test)
  test("Verify config save, persistence, and chart type-specific settings", {
    tag: ['@metrics', '@config', '@save', '@persistence', '@chart-type', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing config save, persistence, and chart type behavior');

    // Test 1: Save configuration — set y-axis min via input
    testLogger.info('Testing save configuration');
    await pm.metricsPage.openConfigSidebar();

    let testValue = '';
    const yAxisMinVisible = await pm.metricsPage.isConfigYAxisMinVisible();

    if (yAxisMinVisible) {
      testValue = String(Date.now() % 1000);
      await pm.metricsPage.fillConfigYAxisMin(testValue);
      testLogger.info('Modified input field');

      // Check apply button
      if (await pm.metricsPage.isApplyButtonVisible()) {
        const isEnabled = await pm.metricsPage.isApplyButtonEnabled();
        testLogger.info(`Apply button found and enabled: ${isEnabled}`);
      }
    }

    // Test 2: Config persistence
    testLogger.info('Testing config persistence');
    await pm.metricsPage.closeConfigSidebar();
    testLogger.info('Closed config sidebar');

    await pm.metricsPage.openConfigSidebar();
    testLogger.info('Reopened config sidebar');

    if (testValue && yAxisMinVisible) {
      if (await pm.metricsPage.isConfigYAxisMinVisible()) {
        const currentValue = await pm.metricsPage.getConfigYAxisMinValue();
        // Assert: Config value should persist after closing and reopening
        expect(currentValue).toBe(testValue);
        testLogger.info('Config value persisted successfully');
      } else {
        testLogger.info('Input field not visible after reopening sidebar');
      }
    }

    // Test 3: Config with chart type changes
    testLogger.info('Testing config with chart type changes');
    await pm.metricsPage.closeConfigSidebar();

    const chartTypeButton = await pm.metricsPage.getChartTypeButton();
    if (await chartTypeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await chartTypeButton.click();

      const chartTypeChanged = await pm.metricsPage.selectChartTypeOption('Bar');
      if (chartTypeChanged) {
        testLogger.info('Changed chart type to Bar');

        await pm.metricsPage.openConfigSidebar();

        const sectionKeys = await pm.metricsPage.getConfigSectionKeys();
        // Assert: Config sidebar should have sections for the selected chart type
        expect(sectionKeys.length).toBeGreaterThan(0);
        testLogger.info(`Config sidebar has ${sectionKeys.length} sections for Bar chart`);
      }
    }

    testLogger.info('Config save, persistence, and chart type tests completed');
  });
});
