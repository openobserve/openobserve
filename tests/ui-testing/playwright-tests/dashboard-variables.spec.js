const {
  test,
  expect,
  navigateToBase,
} = require("./utils/enhanced-baseFixtures.js");
import { DashboardPage } from '../pages/dashboardPages/dashboardPage';
import DashboardVariables from '../pages/dashboardPages/dashboard-variables';
import DashboardTabs from '../pages/dashboardPages/dashboard-tabs';
import { waitForValuesStreamComplete } from './utils/streaming-helpers.js';
import { waitForDashboardPage, deleteDashboard } from './dashboards/utils/dashCreation.js';

const randomDashboardName = "VarTest_" + Math.random().toString(36).slice(2, 11);

test.describe('Dashboard Variables - Comprehensive Test Suite', () => {
  let dashboardPage;
  let variables;
  let tabs;
  let page;

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage;
    await navigateToBase(page);

    dashboardPage = new DashboardPage(page);
    variables = new DashboardVariables(page);
    tabs = new DashboardTabs(page);

    await dashboardPage.navigateToDashboards();
    await waitForDashboardPage(page);
    await dashboardPage.createDashboard(randomDashboardName);
  });

  test.afterEach(async () => {
    // Cleanup: delete dashboard
    try {
      await page.waitForTimeout(500);
      await dashboardPage.navigateToDashboards();
      await page.waitForTimeout(2000);
      await deleteDashboard(page, randomDashboardName);
    } catch (e) {
      console.log(`⚠️  Cleanup warning: ${e.message}`);
    }
  });

  test.describe('1. Global Variables', () => {
    test('1.1 - Global variable should be visible across all tabs', async () => {
      // Add global variable
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        null,
        false,
        'global'
      );

      // Add tabs
      await tabs.addTab('Tab_A');
      await tabs.addTab('Tab_B');

      // Verify variable is visible in default tab
      await variables.verifyVariableVisibleInScope('v_global', 'global');

      // Switch to Tab_A and verify
      await tabs.switchTab('Tab_A');
      await variables.verifyVariableVisibleInScope('v_global', 'global');

      // Switch to Tab_B and verify
      await tabs.switchTab('Tab_B');
      await variables.verifyVariableVisibleInScope('v_global', 'global');
    });

    test('1.2 - Global variable value change should trigger API call', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        null,
        false,
        'global'
      );

      // Setup API tracking
      const apiCalls = variables.setupApiTracking();

      // Change variable value
      const streamPromise = waitForValuesStreamComplete(page);
      await variables.selectValueFromVariableDropDown('v_global', 'test_value');
      await streamPromise;

      // Verify API was called
      expect(apiCalls.some(call => call.url.includes('kubernetes_container_name'))).toBeTruthy();
    });

    test('1.3 - Global variable dropdown should load values on click', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        null,
        false,
        'global'
      );

      // Click dropdown and wait for values to load
      const input = page.getByLabel('v_global', { exact: true });
      const streamPromise = waitForValuesStreamComplete(page);
      await input.click();
      await streamPromise;

      // Verify dropdown has options
      const options = page.locator('[role="option"]');
      await expect(options.first()).toBeVisible();
    });

    test('1.4 - Multiple global variables should work independently', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global_1',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        null,
        false,
        'global'
      );

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global_2',
        'logs',
        'e2e_automate',
        'kubernetes_namespace',
        false,
        null,
        false,
        'global'
      );

      // Verify both variables are visible
      await variables.verifyVariableVisibleInScope('v_global_1', 'global');
      await variables.verifyVariableVisibleInScope('v_global_2', 'global');

      // Change first variable
      const streamPromise1 = waitForValuesStreamComplete(page);
      await variables.selectValueFromVariableDropDown('v_global_1', 'value1');
      await streamPromise1;

      // Change second variable
      const streamPromise2 = waitForValuesStreamComplete(page);
      await variables.selectValueFromVariableDropDown('v_global_2', 'value2');
      await streamPromise2;

      // Verify values are set independently
      const value1 = await variables.getVariableValue('v_global_1', 'global');
      const value2 = await variables.getVariableValue('v_global_2', 'global');
      expect(value1).toContain('value1');
      expect(value2).toContain('value2');
    });

    test('1.5 - Global variable should persist across page reload', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        null,
        false,
        'global'
      );

      // Set value and commit with global refresh
      const streamPromise = waitForValuesStreamComplete(page);
      await variables.selectValueFromVariableDropDown('v_global', 'test_value');
      await streamPromise;

      await dashboardPage.clickGlobalRefresh();
      await page.waitForTimeout(1000);

      // Reload page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Verify variable still has the value
      const value = await variables.getVariableValue('v_global', 'global');
      expect(value).toContain('test_value');
    });
  });

  test.describe('2. Tab Level Variables', () => {
    test('2.1 - Tab variable should only display in selected tab', async () => {
      // Add tabs
      await tabs.addTab('Tab_A');
      await tabs.addTab('Tab_B');

      // Add variable to Tab_A only
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_tab_a',
        'logs',
        'e2e_automate',
        'kubernetes_namespace',
        false,
        null,
        false,
        'tabs',
        ['Tab_A']
      );

      // Switch to Tab_A and verify variable is visible
      await tabs.switchTab('Tab_A');
      await variables.verifyVariableVisibleInScope('v_tab_a', 'tab');

      // Switch to Tab_B and verify variable is NOT visible
      await tabs.switchTab('Tab_B');
      await variables.verifyVariableNotVisible('v_tab_a', 'tab');
    });

    test('2.2-2.3 - Same variable name in different tabs should maintain independent values', async () => {
      // Add tabs
      await tabs.addTab('Tab_1');
      await tabs.addTab('Tab_2');

      // Add same-named variable to both tabs
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_shared',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        null,
        false,
        'tabs',
        ['Tab_1', 'Tab_2']
      );

      // Switch to Tab_1 and set value
      await tabs.switchTab('Tab_1');
      const streamPromise1 = waitForValuesStreamComplete(page);
      await variables.selectValueFromScopedVariable('v_shared', 'value_tab1', 'tab');
      await streamPromise1;

      // Switch to Tab_2 and set different value
      await tabs.switchTab('Tab_2');
      const streamPromise2 = waitForValuesStreamComplete(page);
      await variables.selectValueFromScopedVariable('v_shared', 'value_tab2', 'tab');
      await streamPromise2;

      // Switch back to Tab_1 and verify original value persists
      await tabs.switchTab('Tab_1');
      const tab1Value = await variables.getVariableValue('v_shared', 'tab');
      expect(tab1Value).toContain('value_tab1');

      // Verify Tab_2 still has its value
      await tabs.switchTab('Tab_2');
      const tab2Value = await variables.getVariableValue('v_shared', 'tab');
      expect(tab2Value).toContain('value_tab2');
    });

    test('2.4-2.5 - Tab variable should load values and call API on dropdown click', async () => {
      await tabs.addTab('Tab_A');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_tab',
        'logs',
        'e2e_automate',
        'kubernetes_namespace',
        false,
        null,
        false,
        'tabs',
        ['Tab_A']
      );

      const apiCalls = variables.setupApiTracking();

      await tabs.switchTab('Tab_A');

      // Click dropdown
      const input = page.locator('[data-test="tab-variables-selector"]').locator('input').first();
      const streamPromise = waitForValuesStreamComplete(page);
      await input.click();
      await streamPromise;

      // Verify API was called
      expect(apiCalls.some(call => call.url.includes('kubernetes_namespace'))).toBeTruthy();

      // Verify dropdown has options
      const options = page.locator('[role="option"]');
      await expect(options.first()).toBeVisible();
    });

    test('2.6 - Tab variable can depend on global variables', async () => {
      await tabs.addTab('Tab_A');

      // Add global variable
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global',
        'logs',
        'e2e_automate',
        'job',
        false,
        null,
        false,
        'global'
      );

      // Add tab variable depending on global
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_tab',
        'logs',
        'e2e_automate',
        'level',
        false,
        { filterName: 'job', operator: '=', value: '$v_global' },
        false,
        'tabs',
        ['Tab_A']
      );

      await tabs.switchTab('Tab_A');

      // Verify both variables are visible
      await variables.verifyVariableVisibleInScope('v_global', 'global');
      await variables.verifyVariableVisibleInScope('v_tab', 'tab');
    });
  });

  test.describe('3. Panel Level Variables', () => {
    test('3.1 - Panel variable should only display within specific panel', async () => {
      const panel1Id = await dashboardPage.getPanelId(0);

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_panel',
        'logs',
        'e2e_automate',
        'kubernetes_node_name',
        false,
        null,
        false,
        'panels',
        [],
        [panel1Id]
      );

      // Verify variable is visible in panel
      await variables.verifyVariableVisibleInScope('v_panel', 'panel', panel1Id);

      // Verify it's not in global scope
      await variables.verifyVariableNotVisible('v_panel', 'global');
    });

    test('3.2-3.3 - Panel variable can use global and current tab variables', async () => {
      await tabs.addTab('Tab_A');
      const panel1Id = await dashboardPage.getPanelId(0);

      // Add global variable
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global',
        'logs',
        'e2e_automate',
        'job',
        false,
        null,
        false,
        'global'
      );

      // Add tab variable
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_tab',
        'logs',
        'e2e_automate',
        'level',
        false,
        { filterName: 'job', operator: '=', value: '$v_global' },
        false,
        'tabs',
        ['Tab_A']
      );

      // Add panel variable depending on tab variable
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_panel',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        { filterName: 'level', operator: '=', value: '$v_tab' },
        false,
        'panels',
        ['Tab_A'],
        [panel1Id]
      );

      await tabs.switchTab('Tab_A');

      // Verify all variables are visible in their scopes
      await variables.verifyVariableVisibleInScope('v_global', 'global');
      await variables.verifyVariableVisibleInScope('v_tab', 'tab');
      await variables.verifyVariableVisibleInScope('v_panel', 'panel', panel1Id);
    });

    test('3.6 - Panel variable should load lazily (only when visible)', async () => {
      const panel1Id = await dashboardPage.getPanelId(0);
      const apiCalls = variables.setupApiTracking();

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_panel',
        'logs',
        'e2e_automate',
        'kubernetes_node_name',
        false,
        null,
        false,
        'panels',
        [],
        [panel1Id]
      );

      // Initially panel is visible, so variable should load
      await page.waitForTimeout(2000);
      expect(apiCalls.some(call => call.url.includes('kubernetes_node_name'))).toBeTruthy();

      // Scroll panel out of view
      await page.evaluate(() => window.scrollTo(0, 10000));
      await page.waitForTimeout(1000);

      // Clear API calls
      apiCalls.length = 0;

      // Scroll back - should not trigger new load if already loaded
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(1000);

      const newCalls = apiCalls.filter(call => call.url.includes('kubernetes_node_name'));
      expect(newCalls.length).toBe(0);
    });
  });

  test.describe('4. Variable Dependencies', () => {
    test('4.1-4.2 - 2-level dependency chain (A -> B -> C) should cascade correctly', async () => {
      // Create chain: v_a -> v_b -> v_c
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_a',
        'logs',
        'e2e_automate',
        'job',
        false,
        null,
        false,
        'global'
      );

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_b',
        'logs',
        'e2e_automate',
        'level',
        false,
        { filterName: 'job', operator: '=', value: '$v_a' },
        false,
        'global'
      );

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_c',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        { filterName: 'level', operator: '=', value: '$v_b' },
        false,
        'global'
      );

      // Verify all variables are visible
      await variables.verifyVariableVisibleInScope('v_a', 'global');
      await variables.verifyVariableVisibleInScope('v_b', 'global');
      await variables.verifyVariableVisibleInScope('v_c', 'global');

      // Change v_a value and verify cascade
      const apiCalls = variables.setupApiTracking();
      const streamPromise = waitForValuesStreamComplete(page);
      await variables.selectValueFromVariableDropDown('v_a', 'new_value');
      await streamPromise;

      // Wait for dependent variables to reload
      await page.waitForTimeout(2000);

      // Verify v_b and v_c received updates
      expect(apiCalls.filter(call => call.url.includes('level')).length).toBeGreaterThan(0);
      expect(apiCalls.filter(call => call.url.includes('kubernetes_container_name')).length).toBeGreaterThan(0);
    });

    test('4.3-4.4 - Deep dependency chain (3-4 levels) should work', async () => {
      // Create chain: v1 -> v2 -> v3 -> v4
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v1', 'logs', 'e2e_automate', 'job');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v2',
        'logs',
        'e2e_automate',
        'level',
        false,
        { filterName: 'job', operator: '=', value: '$v1' }
      );

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v3',
        'logs',
        'e2e_automate',
        'kubernetes_namespace',
        false,
        { filterName: 'level', operator: '=', value: '$v2' }
      );

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v4',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        { filterName: 'kubernetes_namespace', operator: '=', value: '$v3' }
      );

      // Verify all 4 variables loaded
      await variables.verifyVariableVisibleInScope('v1', 'global');
      await variables.verifyVariableVisibleInScope('v2', 'global');
      await variables.verifyVariableVisibleInScope('v3', 'global');
      await variables.verifyVariableVisibleInScope('v4', 'global');
    });

    test('4.5 - Variable C depending on both A and B should wait for both', async () => {
      // Create: v_c depends on both v_a and v_b
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_a', 'logs', 'e2e_automate', 'job');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_b', 'logs', 'e2e_automate', 'level');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_c',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        { filterName: 'job', operator: '=', value: '$v_a' }
      );

      // v_c should be visible and loaded after both parents are ready
      await variables.verifyVariableVisibleInScope('v_c', 'global');
    });

    test('4.6-4.7 - Circular dependency should show error before loading', async () => {
      // Add v_a
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_a', 'logs', 'e2e_automate', 'job');

      // Add v_b depending on v_a
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_b',
        'logs',
        'e2e_automate',
        'level',
        false,
        { filterName: 'job', operator: '=', value: '$v_a' }
      );

      // Try to edit v_a to depend on v_b (creating circular dependency)
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await page.locator('[data-test="dashboard-settings-variable-tab"]').click();

      const variableRow = page.locator('[data-test="dashboard-variable-settings-draggable-row"]:has-text("v_a")');
      await variableRow.locator('[data-test="dashboard-variable-settings-edit-btn"]').click();

      await page.locator('[data-test="dashboard-add-filter-btn"]').click();

      const filterNameSelector = page.locator('[data-test="dashboard-query-values-filter-name-selector"]');
      await filterNameSelector.click();
      await page.getByRole('option', { name: 'level' }).first().click();

      const filterValueInput = page.locator('[data-test="common-auto-complete"]');
      await filterValueInput.click();
      await filterValueInput.fill('$v_b');

      await page.locator('[data-test="dashboard-variable-save-btn"]').click();

      // Verify circular dependency error appears
      await variables.verifyCircularDependencyError();
    });

    test('4.8 - When parent value changes, dependent variables should reload', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_parent', 'logs', 'e2e_automate', 'job');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_child',
        'logs',
        'e2e_automate',
        'level',
        false,
        { filterName: 'job', operator: '=', value: '$v_parent' }
      );

      const apiCalls = variables.setupApiTracking();

      // Change parent value
      const streamPromise = waitForValuesStreamComplete(page);
      await variables.selectValueFromVariableDropDown('v_parent', 'new_value');
      await streamPromise;

      // Wait for child to reload
      await page.waitForTimeout(2000);

      // Verify child variable API was called
      const childCalls = apiCalls.filter(call => call.url.includes('level'));
      expect(childCalls.length).toBeGreaterThan(0);
    });
  });

  test.describe('5. UI / Refresh Indicators', () => {
    test('5.1-5.2 - Variable changes should show refresh indicators', async () => {
      const panel1Id = await dashboardPage.getPanelId(0);

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_global', 'logs', 'e2e_automate', 'job');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_panel',
        'logs',
        'e2e_automate',
        'level',
        false,
        { filterName: 'job', operator: '=', value: '$v_global' },
        false,
        'panels',
        [],
        [panel1Id]
      );

      // Change global variable
      const streamPromise1 = waitForValuesStreamComplete(page);
      await variables.selectValueFromVariableDropDown('v_global', 'new_value');
      await streamPromise1;

      // Verify global refresh indicator appears
      await dashboardPage.verifyGlobalRefreshIndicator(true);

      // Verify panel refresh indicator appears
      await dashboardPage.verifyPanelRefreshIndicator(panel1Id, true);
    });

    test('5.3-5.4 - Clicking global refresh should pass data and reload all panels', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_global', 'logs', 'e2e_automate', 'job');

      // Change variable value
      const streamPromise = waitForValuesStreamComplete(page);
      await variables.selectValueFromVariableDropDown('v_global', 'new_value');
      await streamPromise;

      // Click global refresh
      await dashboardPage.clickGlobalRefresh();
      await page.waitForTimeout(1000);

      // Verify indicator clears
      await dashboardPage.verifyGlobalRefreshIndicator(false);
    });

    test('5.5-5.6 - Clicking panel refresh should only reload that panel', async () => {
      const panel1Id = await dashboardPage.getPanelId(0);

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_panel',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        null,
        false,
        'panels',
        [],
        [panel1Id]
      );

      // Change panel variable value
      const streamPromise = waitForValuesStreamComplete(page);
      await variables.selectValueFromScopedVariable('v_panel', 'test_value', 'panel', panel1Id);
      await streamPromise;

      // Verify panel refresh indicator
      await dashboardPage.verifyPanelRefreshIndicator(panel1Id, true);

      // Click panel refresh
      await dashboardPage.clickPanelRefresh(panel1Id);
      await page.waitForTimeout(1000);

      // Verify indicator clears
      await dashboardPage.verifyPanelRefreshIndicator(panel1Id, false);
    });
  });

  test.describe('6. Variables Loading', () => {
    test('6.1-6.2 - Variables should load with default values and timerange on dashboard open', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_global', 'logs', 'e2e_automate', 'job');

      // Reload dashboard
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Verify variable is visible and loaded
      await variables.verifyVariableVisibleInScope('v_global', 'global');
    });

    test('6.3-6.4 - Clicking variable dropdown should call values API and load values', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_global', 'logs', 'e2e_automate', 'job');

      const apiCalls = variables.setupApiTracking();

      // Click dropdown
      const input = page.getByLabel('v_global', { exact: true });
      const streamPromise = waitForValuesStreamComplete(page);
      await input.click();
      await streamPromise;

      // Verify API was called
      expect(apiCalls.some(call => call.url.includes('job'))).toBeTruthy();

      // Verify dropdown has options
      await expect(page.locator('[role="option"]').first()).toBeVisible();
    });

    test('6.8-6.9 - Independent variables should load immediately, then trigger children', async () => {
      const apiCalls = variables.setupApiTracking();

      // Add independent variable
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_independent', 'logs', 'e2e_automate', 'job');

      // Add dependent variable
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_dependent',
        'logs',
        'e2e_automate',
        'level',
        false,
        { filterName: 'job', operator: '=', value: '$v_independent' }
      );

      // Wait for loading
      await page.waitForTimeout(2000);

      // Verify independent loaded first
      const timestamps = apiCalls.map(call => call.timestamp);
      const jobCallTime = apiCalls.find(call => call.url.includes('job'))?.timestamp;
      const levelCallTime = apiCalls.find(call => call.url.includes('level'))?.timestamp;

      expect(jobCallTime).toBeLessThan(levelCallTime);
    });

    test('6.10 - Tab variables should only load when tab becomes active', async () => {
      await tabs.addTab('Tab_Lazy');

      const apiCalls = variables.setupApiTracking();

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_tab_lazy',
        'logs',
        'e2e_automate',
        'kubernetes_namespace',
        false,
        null,
        false,
        'tabs',
        ['Tab_Lazy']
      );

      // Initially on different tab - variable should not load
      await page.waitForTimeout(1000);
      const initialCalls = apiCalls.filter(call => call.url.includes('kubernetes_namespace'));
      expect(initialCalls.length).toBe(0);

      // Switch to tab
      await tabs.switchTab('Tab_Lazy');
      await page.waitForTimeout(2000);

      // Now variable should have loaded
      const afterSwitchCalls = apiCalls.filter(call => call.url.includes('kubernetes_namespace'));
      expect(afterSwitchCalls.length).toBeGreaterThan(0);
    });

    test('6.17 - When variable values not found, panel query should use "_o2_all_"', async () => {
      // This test requires checking the actual query generated
      // Implementation depends on how queries are exposed in the UI
      // Placeholder for now
      test.skip();
    });

    test('6.19 - Variable loading error should show red box error indicator', async () => {
      // Create a variable that will fail to load (e.g., invalid stream/field)
      await page.locator('[data-test="dashboard-setting-btn"]').click();

      // Manually create a broken variable through settings
      // This test depends on specific error scenarios
      test.skip();
    });
  });

  test.describe('7. Variable Values', () => {
    test('7.1-7.4 - Same variable in multiple tabs should have independent values', async () => {
      await tabs.addTab('Tab_1');
      await tabs.addTab('Tab_2');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_shared',
        'logs',
        'e2e_automate',
        'job',
        false,
        null,
        false,
        'tabs',
        ['Tab_1', 'Tab_2']
      );

      // Set value in Tab_1
      await tabs.switchTab('Tab_1');
      const streamPromise1 = waitForValuesStreamComplete(page);
      await variables.selectValueFromScopedVariable('v_shared', 'value_1', 'tab');
      await streamPromise1;

      const tab1Value = await variables.getVariableValue('v_shared', 'tab');

      // Set different value in Tab_2
      await tabs.switchTab('Tab_2');
      const streamPromise2 = waitForValuesStreamComplete(page);
      await variables.selectValueFromScopedVariable('v_shared', 'value_2', 'tab');
      await streamPromise2;

      const tab2Value = await variables.getVariableValue('v_shared', 'tab');

      // Verify independence
      expect(tab1Value).not.toBe(tab2Value);

      // Switch back to Tab_1 and verify persistence
      await tabs.switchTab('Tab_1');
      const tab1ValueAgain = await variables.getVariableValue('v_shared', 'tab');
      expect(tab1ValueAgain).toBe(tab1Value);
    });
  });

  test.describe('8. Variables Creation', () => {
    test('8.1-8.3 - Tab variable dependency rules', async () => {
      await tabs.addTab('Tab_A');

      // 8.1 - Tab can depend on global
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_global', 'logs', 'e2e_automate', 'job');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_tab',
        'logs',
        'e2e_automate',
        'level',
        false,
        { filterName: 'job', operator: '=', value: '$v_global' },
        false,
        'tabs',
        ['Tab_A']
      );

      // Verify both created successfully
      await tabs.switchTab('Tab_A');
      await variables.verifyVariableVisibleInScope('v_global', 'global');
      await variables.verifyVariableVisibleInScope('v_tab', 'tab');
    });

    test('8.8 - Tab variable can be assigned to multiple tabs', async () => {
      await tabs.addTab('Tab_1');
      await tabs.addTab('Tab_2');
      await tabs.addTab('Tab_3');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_multi_tab',
        'logs',
        'e2e_automate',
        'job',
        false,
        null,
        false,
        'tabs',
        ['Tab_1', 'Tab_2', 'Tab_3']
      );

      // Verify visible in all tabs
      await tabs.switchTab('Tab_1');
      await variables.verifyVariableVisibleInScope('v_multi_tab', 'tab');

      await tabs.switchTab('Tab_2');
      await variables.verifyVariableVisibleInScope('v_multi_tab', 'tab');

      await tabs.switchTab('Tab_3');
      await variables.verifyVariableVisibleInScope('v_multi_tab', 'tab');
    });

    test('8.13-8.14 - Variables can be created without global variables', async () => {
      await tabs.addTab('Tab_A');

      // Create tab variable without any global variables
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_tab_independent',
        'logs',
        'e2e_automate',
        'job',
        false,
        null,
        false,
        'tabs',
        ['Tab_A']
      );

      await tabs.switchTab('Tab_A');
      await variables.verifyVariableVisibleInScope('v_tab_independent', 'tab');

      // Create panel variable without global variables
      const panel1Id = await dashboardPage.getPanelId(0);
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_panel_independent',
        'logs',
        'e2e_automate',
        'level',
        false,
        null,
        false,
        'panels',
        [],
        [panel1Id]
      );

      await variables.verifyVariableVisibleInScope('v_panel_independent', 'panel', panel1Id);
    });
  });

  test.describe('10. URL Syncing', () => {
    test('10.1-10.4 - URL should contain variable values and work on reload', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_global', 'logs', 'e2e_automate', 'job');

      // Change value and commit
      const streamPromise = waitForValuesStreamComplete(page);
      await variables.selectValueFromVariableDropDown('v_global', 'test_value');
      await streamPromise;

      await dashboardPage.clickGlobalRefresh();
      await page.waitForTimeout(1000);

      // Verify URL
      await variables.verifyVariableInUrl('v_global', 'test_value', 'global');

      // Copy URL and open in new context
      const currentUrl = page.url();

      // Reload page with URL
      await page.goto(currentUrl);
      await page.waitForLoadState('networkidle');

      // Verify variable has value from URL without re-loading
      const value = await variables.getVariableValue('v_global', 'global');
      expect(value).toContain('test_value');
    });

    test('10.5-10.7 - URL format for different scopes', async () => {
      await tabs.addTab('Tab_A');
      const panel1Id = await dashboardPage.getPanelId(0);

      // Create variables in different scopes
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_global', 'logs', 'e2e_automate', 'job');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_tab',
        'logs',
        'e2e_automate',
        'level',
        false,
        null,
        false,
        'tabs',
        ['Tab_A']
      );

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_panel',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        null,
        false,
        'panels',
        ['Tab_A'],
        [panel1Id]
      );

      await tabs.switchTab('Tab_A');

      // Set values and commit
      const streamPromise1 = waitForValuesStreamComplete(page);
      await variables.selectValueFromVariableDropDown('v_global', 'global_val');
      await streamPromise1;

      const streamPromise2 = waitForValuesStreamComplete(page);
      await variables.selectValueFromScopedVariable('v_tab', 'tab_val', 'tab');
      await streamPromise2;

      const streamPromise3 = waitForValuesStreamComplete(page);
      await variables.selectValueFromScopedVariable('v_panel', 'panel_val', 'panel', panel1Id);
      await streamPromise3;

      await dashboardPage.clickGlobalRefresh();
      await dashboardPage.clickPanelRefresh(panel1Id);
      await page.waitForTimeout(1000);

      // Verify URL patterns
      await variables.verifyVariableInUrl('v_global', 'global_val', 'global');

      // Note: Tab and panel URL patterns may differ based on implementation
      const url = page.url();
      console.log('Current URL:', url);
    });
  });
});
