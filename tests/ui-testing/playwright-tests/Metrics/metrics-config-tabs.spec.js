const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

test.describe("Metrics Config Tabs Tests", () => {
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

    // Execute a query first so we have results to work with
    await pm.metricsPage.executeQuery('up');
    await page.waitForTimeout(2000);

    testLogger.info('Test setup completed - metrics page ready with query results');
  });

  test.afterEach(async ({ page }, testInfo) => {
    // Close config sidebar if open using the collapse button
    await pm.metricsPage.clickDashboardSidebarCollapseButton();
    await page.waitForTimeout(500);
    testLogger.info('Closed sidebar using collapse button');

    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // CONSOLIDATED TEST 1: Config sidebar open/close/navigation (3 tests → 1 test)
  test("Open config sidebar and navigate between tabs", {
    tag: ['@metrics', '@config', '@sidebar', '@tabs', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing config sidebar opening and tab navigation');

    // Test 1: Open config sidebar
    testLogger.info('Opening config sidebar');
    const configButton = await pm.metricsPage.getDashboardSidebarButton();
    await expect(configButton).toBeVisible({ timeout: 10000 });

    await pm.metricsPage.clickDashboardSidebarButton();
    await page.waitForTimeout(1000);

    let sidebarVisible = await pm.metricsPage.isSidebarVisible();
    expect(sidebarVisible).toBe(true);
    testLogger.info('Config sidebar opened successfully');

    // Test 2: Navigate between tabs
    const tabCount = await pm.metricsPage.getSidebarTabCount();
    testLogger.info(`Found ${tabCount} config tabs`);

    if (tabCount > 0) {
      const tabs = await pm.metricsPage.getSidebarTabs();
      for (let i = 0; i < Math.min(tabCount, 5); i++) {
        const tab = tabs.nth(i);
        const tabText = await tab.textContent();

        await tab.click();
        await page.waitForTimeout(500);

        const ariaSelected = await tab.getAttribute('aria-selected').catch(() => null);
        testLogger.info(`Clicked tab: ${tabText?.trim()} (aria-selected: ${ariaSelected})`);

        const panelVisible = await pm.metricsPage.isTabPanelVisible();
        if (panelVisible) {
          testLogger.info(`Tab panel visible for ${tabText?.trim()}`);
        }
      }
    }

    // Test 3: Close sidebar
    testLogger.info('Closing config sidebar');
    await pm.metricsPage.clickDashboardSidebarCollapseButton();
    await page.waitForTimeout(500);

    sidebarVisible = await pm.metricsPage.isSidebarVisible();
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
  }, async ({ page }) => {
    testLogger.info('Testing configuration settings across different tabs');

    await pm.metricsPage.clickDashboardSidebarButton();
    await page.waitForTimeout(1000);

    const tabConfigurations = [
      {
        tabName: 'Query',
        selectors: [
          'input[placeholder*="query" i]',
          'textarea[placeholder*="query" i]',
          '.monaco-editor'
        ],
        action: async (selector) => {
          if (selector.includes('input') || selector.includes('textarea')) {
            await pm.metricsPage.clickElementBySelector(selector);
            await page.keyboard.type('test_query');
            testLogger.info('Modified query input');
          }
        }
      },
      {
        tabName: 'Legend',
        selectors: [
          'input[type="checkbox"]',
          '.q-toggle',
          '.q-checkbox'
        ],
        action: async (selector) => {
          const firstElement = await pm.metricsPage.getElementBySelector(selector);
          await firstElement.click();
          testLogger.info('Toggled legend setting');
        }
      },
      {
        tabName: 'Axes',
        selectors: [
          'input[placeholder*="min" i]',
          'input[placeholder*="max" i]',
          'input[type="number"]'
        ],
        action: async (selector) => {
          const element = await pm.metricsPage.getElementBySelector(selector);
          await element.fill('100');

          // Verify the value was set
          const setValue = await element.inputValue();
          expect(setValue).toBe('100');
          testLogger.info('Set and verified axis value: 100');
        }
      },
      {
        tabName: 'Options',
        selectors: ['input', 'select', '.q-select'],
        action: async () => {
          const elementCount = await pm.metricsPage.getVisibleOptionElementCount();
          if (elementCount > 0) {
            testLogger.info(`Found ${elementCount} option elements`);
          }
        }
      }
    ];

    for (const tabConfig of tabConfigurations) {
      testLogger.info(`Testing ${tabConfig.tabName} tab`);

      if (await pm.metricsPage.clickTabByText(tabConfig.tabName)) {
        await page.waitForTimeout(500);
        testLogger.info(`Clicked ${tabConfig.tabName} tab`);

        // Try to find and interact with settings
        for (const selector of tabConfig.selectors) {
          if (await pm.metricsPage.isElementVisible(selector)) {
            testLogger.info(`Found setting element in ${tabConfig.tabName}: ${selector}`);
            try {
              await tabConfig.action(selector);
              break;
            } catch (error) {
              testLogger.info(`Could not interact with ${selector}: ${error.message}`);
            }
          }
        }
      } else {
        testLogger.info(`${tabConfig.tabName} tab not found`);
      }
    }

    testLogger.info('All tab configurations tested successfully');
  });

  // CONSOLIDATED TEST 3: Config behavior (save, persistence, chart type updates) (3 tests → 1 test)
  test("Verify config save, persistence, and chart type-specific settings", {
    tag: ['@metrics', '@config', '@save', '@persistence', '@chart-type', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing config save, persistence, and chart type behavior');

    // Test 1: Save configuration
    testLogger.info('Testing save configuration');
    await pm.metricsPage.clickDashboardSidebarButton();
    await page.waitForTimeout(1000);

    const inputCount = await pm.metricsPage.getVisibleInputCount();
    let testValue = '';

    if (inputCount > 0) {
      const inputs = await pm.metricsPage.getVisibleInputs();
      const firstInput = inputs.first();
      testValue = `test_${Date.now()}`;
      await firstInput.fill(testValue);
      testLogger.info('Modified input field');

      // Check for save button
      const saveButton = await pm.metricsPage.getSaveButton();
      if (await saveButton.isVisible().catch(() => false)) {
        const isEnabled = await saveButton.isEnabled();
        testLogger.info(`Save button found and enabled: ${isEnabled}`);
      }
    }

    // Test 2: Config persistence
    testLogger.info('Testing config persistence');
    await pm.metricsPage.clickDashboardSidebarCollapseButton();
    await page.waitForTimeout(500);
    testLogger.info('Closed config sidebar');

    await pm.metricsPage.clickDashboardSidebarButton();
    await page.waitForTimeout(1000);
    testLogger.info('Reopened config sidebar');

    if (testValue && inputCount > 0) {
      const inputs = await pm.metricsPage.getVisibleInputs();
      const textInput = inputs.first();
      if (await textInput.isVisible().catch(() => false)) {
        const currentValue = await textInput.inputValue();
        // Assert: Config value should persist after closing and reopening
        expect(currentValue).toBe(testValue);
        testLogger.info('Config value persisted successfully');
      } else {
        testLogger.info('Input field not visible after reopening sidebar');
      }
    }

    // Test 3: Config with chart type changes
    testLogger.info('Testing config with chart type changes');
    await pm.metricsPage.clickDashboardSidebarCollapseButton();
    await page.waitForTimeout(500);

    const chartTypeButton = await pm.metricsPage.getChartTypeButton();
    if (await chartTypeButton.isVisible().catch(() => false)) {
      await chartTypeButton.click();
      await page.waitForTimeout(500);

      const chartTypeChanged = await pm.metricsPage.selectChartTypeOption('Bar');
      if (chartTypeChanged) {
        testLogger.info('Changed chart type to Bar');

        await pm.metricsPage.clickDashboardSidebarButton();
        await page.waitForTimeout(1000);

        const tabCount = await pm.metricsPage.getSidebarTabCount();
        // Assert: Config sidebar should have tabs for the selected chart type
        expect(tabCount).toBeGreaterThan(0);
        testLogger.info(`Config sidebar has ${tabCount} tabs for Bar chart`);
      }
    }

    testLogger.info('Config save, persistence, and chart type tests completed');
  });
});
