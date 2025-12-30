import fixtures from "./utils/enhanced-baseFixtures.js";
import { DashboardPage } from '../pages/dashboardPages/dashboardPage';
import DashboardVariables from '../pages/dashboardPages/dashboard-variables';
import DashboardTabs from '../pages/dashboardPages/dashboard-tabs';
import { waitForValuesStreamComplete } from './utils/streaming-helpers.js';
import { waitForDashboardPage, deleteDashboard } from './dashboards/utils/dashCreation.js';

const { test, expect, navigateToBase } = fixtures;

const randomDashboardName = "VarTest_" + Math.random().toString(36).slice(2, 11);

test.describe('Dashboard Variables - Comprehensive Test Suite @variables', () => {
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
    try {
      if (page && page.url().includes('dashboard')) {
        await dashboardPage.navigateToDashboards();
        await page.waitForTimeout(500); // Small wait to ensure list is stable
        await deleteDashboard(page, randomDashboardName);
      }
    } catch (e) {
      console.log(`⚠️  Cleanup warning: ${e.message}`);
    }
  });

  test.describe('1. Global Variables', () => {
    test.describe.configure({ mode: 'serial' });

    test('1.1 - Global variable should be visible across all tabs', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global', 'logs', 'e2e_automate', 'kubernetes_container_name', false, null, false, 'global'
      );

      await tabs.addTab('Tab_A');
      await tabs.addTab('Tab_B');

      await variables.verifyVariableVisibleInScope('v_global', 'global');
      await tabs.switchTab('Tab_A');
      await variables.verifyVariableVisibleInScope('v_global', 'global');
      await tabs.switchTab('Tab_B');
      await variables.verifyVariableVisibleInScope('v_global', 'global');
    });

    test('1.2 - Global variable value change should trigger API call', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global', 'logs', 'e2e_automate', 'kubernetes_container_name', false, null, false, 'global'
      );

      const apiCalls = variables.setupApiTracking();
      await variables.selectValueFromVariableDropDown('v_global', 'test_value');

      // Wait for at least one API call
      await expect.poll(() => apiCalls.some(call => call.url.includes('kubernetes_container_name')), {
        message: 'Expected API call for variable not found',
        timeout: 5000
      }).toBeTruthy();
    });

    test('1.3 - Global variable dropdown should load values on click', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global', 'logs', 'e2e_automate', 'kubernetes_container_name', false, null, false, 'global'
      );

      const input = page.getByLabel('v_global', { exact: true });
      const streamPromise = waitForValuesStreamComplete(page);
      await input.click();
      await streamPromise;

      await expect(page.locator('[role="option"]').first()).toBeVisible({ timeout: 5000 });
    });

    test('1.4 - Multiple global variables should work independently', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global_1', 'logs', 'e2e_automate', 'kubernetes_container_name', false, null, false, 'global'
      );

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global_2', 'logs', 'e2e_automate', 'kubernetes_namespace', false, null, false, 'global'
      );

      await variables.verifyVariableVisibleInScope('v_global_1', 'global');
      await variables.verifyVariableVisibleInScope('v_global_2', 'global');

      await variables.selectValueFromVariableDropDown('v_global_1', 'value1');
      await variables.selectValueFromVariableDropDown('v_global_2', 'value2');

      const value1 = await variables.getVariableValue('v_global_1', 'global');
      const value2 = await variables.getVariableValue('v_global_2', 'global');

      expect(value1).toContain('value1');
      expect(value2).toContain('value2');
    });

    test('1.5 - Global variable should persist across page reload', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global', 'logs', 'e2e_automate', 'kubernetes_container_name', false, null, false, 'global'
      );

      await variables.selectValueFromVariableDropDown('v_global', 'test_value');

      // Use global refresh to ensure state is "saved"
      await dashboardPage.clickGlobalRefresh();

      // Reload
      await page.reload();
      await page.waitForLoadState('networkidle');

      const value = await variables.getVariableValue('v_global', 'global');
      expect(value).toContain('test_value');
    });
  });

  test.describe('2. Tab Level Variables', () => {
    test.describe.configure({ mode: 'serial' });

    test('2.1 - Tab variable should only display in selected tab', async () => {
      await tabs.addTab('Tab_A');
      await tabs.addTab('Tab_B');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_tab_a', 'logs', 'e2e_automate', 'kubernetes_namespace', false, null, false, 'tabs', ['Tab_A']
      );

      await tabs.switchTab('Tab_A');
      await variables.verifyVariableVisibleInScope('v_tab_a', 'tab');

      await tabs.switchTab('Tab_B');
      await variables.verifyVariableNotVisible('v_tab_a', 'tab');
    });

    test('2.2 - Same variable name in different tabs should maintain independent values', async () => {
      await tabs.addTab('Tab_1');
      await tabs.addTab('Tab_2');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_shared', 'logs', 'e2e_automate', 'kubernetes_container_name', false, null, false, 'tabs', ['Tab_1', 'Tab_2']
      );

      await tabs.switchTab('Tab_1');
      await variables.selectValueFromScopedVariable('v_shared', 'value_tab1', 'tab');

      await tabs.switchTab('Tab_2');
      await variables.selectValueFromScopedVariable('v_shared', 'value_tab2', 'tab');

      await tabs.switchTab('Tab_1');
      expect(await variables.getVariableValue('v_shared', 'tab')).toContain('value_tab1');

      await tabs.switchTab('Tab_2');
      expect(await variables.getVariableValue('v_shared', 'tab')).toContain('value_tab2');
    });

    test('2.3 - Tab variable can depend on global variables', async () => {
      await tabs.addTab('Tab_A');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global', 'logs', 'e2e_automate', 'job', false, null, false, 'global'
      );

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_tab', 'logs', 'e2e_automate', 'level', false,
        { filterName: 'job', operator: '=', value: '$v_global' },
        false, 'tabs', ['Tab_A']
      );

      await tabs.switchTab('Tab_A');
      await variables.verifyVariableVisibleInScope('v_global', 'global');
      await variables.verifyVariableVisibleInScope('v_tab', 'tab');
    });
  });

  test.describe('3. Panel Level Variables', () => {
    test.describe.configure({ mode: 'serial' });

    test('3.1 - Panel variable should only display within specific panel', async () => {
      const panel1Id = await dashboardPage.getPanelId(0);

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_panel', 'logs', 'e2e_automate', 'kubernetes_node_name', false, null, false, 'panels', [], [panel1Id]
      );

      await variables.verifyVariableVisibleInScope('v_panel', 'panel', panel1Id);
      await variables.verifyVariableNotVisible('v_panel', 'global');
    });

    test('3.2 - Panel variable can use global and current tab variables', async () => {
      await tabs.addTab('Tab_A');
      const panel1Id = await dashboardPage.getPanelId(0);

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_global', 'logs', 'e2e_automate', 'job', false, null, false, 'global'
      );

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_tab', 'logs', 'e2e_automate', 'level', false,
        { filterName: 'job', operator: '=', value: '$v_global' },
        false, 'tabs', ['Tab_A']
      );

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_panel', 'logs', 'e2e_automate', 'kubernetes_container_name', false,
        { filterName: 'level', operator: '=', value: '$v_tab' },
        false, 'panels', ['Tab_A'], [panel1Id]
      );

      await tabs.switchTab('Tab_A');
      await variables.verifyVariableVisibleInScope('v_global', 'global');
      await variables.verifyVariableVisibleInScope('v_tab', 'tab');
      await variables.verifyVariableVisibleInScope('v_panel', 'panel', panel1Id);
    });
  });

  test.describe('4. Variable Dependencies & Loading', () => {
    test.describe.configure({ mode: 'serial' });

    test('4.1 - 2-level dependency chain (A -> B -> C) should cascade correctly', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_a', 'logs', 'e2e_automate', 'job');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_b', 'logs', 'e2e_automate', 'level', false,
        { filterName: 'job', operator: '=', value: '$v_a' });

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_c', 'logs', 'e2e_automate', 'kubernetes_container_name', false,
        { filterName: 'level', operator: '=', value: '$v_b' });

      const apiCalls = variables.setupApiTracking();
      await variables.selectValueFromVariableDropDown('v_a', 'new_value');

      await expect.poll(() => apiCalls.filter(call => call.url.includes('level')).length, { timeout: 10000 }).toBeGreaterThan(0);
      await expect.poll(() => apiCalls.filter(call => call.url.includes('kubernetes_container_name')).length, { timeout: 10000 }).toBeGreaterThan(0);
    });

    test('4.2 - Circular dependency should show error and not load', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_a', 'logs', 'e2e_automate', 'job');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_b', 'logs', 'e2e_automate', 'level', false,
        { filterName: 'job', operator: '=', value: '$v_a' });

      await variables.editVariable('v_a', { filterConfig: { filterName: 'level', operator: '=', value: '$v_b' } });
      await variables.verifyCircularDependencyError();
    });

    test('4.3 - Independent variables load immediately, dependents wait', async () => {
      const apiCalls = variables.setupApiTracking();

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_indep', 'logs', 'e2e_automate', 'job');

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_dep', 'logs', 'e2e_automate', 'level', false,
        { filterName: 'job', operator: '=', value: '$v_indep' });

      await page.reload();
      await page.waitForLoadState('networkidle');

      await variables.checkVariableStatus('v_indep', { isLoading: false });
      await variables.checkVariableStatus('v_dep', { isLoading: false });
    });
  });

  test.describe('5. UI Indicators & UX', () => {
    test('5.1 - Variable changes should show global refresh indicator', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_global', 'logs', 'e2e_automate', 'job');

      await variables.selectValueFromVariableDropDown('v_global', 'new_value');
      await variables.verifyGlobalRefreshIndicator(true);

      await dashboardPage.clickGlobalRefresh();
      await variables.verifyGlobalRefreshIndicator(false);
    });

    test('5.2 - Panel variable change should show panel refresh indicator', async () => {
      const panel1Id = await dashboardPage.getPanelId(0);
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_panel', 'logs', 'e2e_automate', 'kubernetes_node_name', false, null, false, 'panels', [], [panel1Id]
      );

      await variables.selectValueFromScopedVariable('v_panel', 'new_val', 'panel', panel1Id);
      await variables.verifyPanelRefreshIndicator(panel1Id, true);

      await dashboardPage.clickPanelRefresh(panel1Id);
      await variables.verifyPanelRefreshIndicator(panel1Id, false);
    });
  });

  test.describe('6. URL Syncing', () => {
    test('6.1 - URL should reflect variable values', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_global', 'logs', 'e2e_automate', 'job');

      await variables.selectValueFromVariableDropDown('v_global', 'url_test');

      await variables.verifyVariableInUrl('v_global', 'url_test', 'global');
    });

    test('6.2 - Loading URL with variables should set them', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_global', 'logs', 'e2e_automate', 'job');

      const currentUrl = page.url();
      const separator = currentUrl.includes('?') ? '&' : '?';
      const newUrl = `${currentUrl}${separator}v-v_global=pre_set_value`;

      await page.goto(newUrl);
      await page.waitForLoadState('networkidle');

      const val = await variables.getVariableValue('v_global', 'global');
      expect(val).toBe('pre_set_value');
    });
  });
});
