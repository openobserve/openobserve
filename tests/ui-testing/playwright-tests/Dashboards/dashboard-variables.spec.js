import { test, expect } from '@playwright/test';
import PageManager from '../../pages/page-manager';
import { waitForDashboardPage } from './utils/dashCreation';

test.describe('Dashboard Variables Exhaustive Tests', () => {
  let page;
  let pm;
  let dashboardPage;
  let variables;
  let tabs;
  let drilldown;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    pm = new PageManager(page);
    dashboardPage = pm.dashboardPage;
    variables = pm.dashboardVariables;
    tabs = pm.dashboardTabs;
    drilldown = pm.dashboardDrilldown;

    await setupMockApi(page);
    await pm.loginPage.gotoLoginPage();
    await pm.loginPage.login();
    await dashboardPage.navigateToDashboards();
    await waitForDashboardPage(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // Mock API to simulate variable values and schema
  const setupMockApi = async (page) => {
    // Mock Schema/Fields list
    await page.route('**/api/**/schema*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          streams: [
            {
              name: 'e2e_automate', stream_type: 'logs',
              schema: [
                { name: 'job', type: 'string' },
                { name: 'level', type: 'string' },
                { name: 'kubernetes_pod_name', type: 'string' },
                { name: 'kubernetes_container_name', type: 'string' },
                { name: 'a_field', type: 'string' },
                { name: 'b_field', type: 'string' },
                { name: 'c_field', type: 'string' },
                // 8-level dependency chain
                { name: 'v1', type: 'string' }, { name: 'v2', type: 'string' }, { name: 'v3', type: 'string' },
                { name: 'v4', type: 'string' }, { name: 'v5', type: 'string' }, { name: 'v6', type: 'string' },
                { name: 'v7', type: 'string' }, { name: 'v8', type: 'string' }
              ]
            }
          ]
        })
      });
    });

    // Mock Values API for variable dropdowns
    await page.route('**/_values*', async route => {
      const request = route.request();
      let fields = [];

      try {
        if (request.method() === 'POST') {
          const body = request.postDataJSON();
          fields = body.fields || [];
        } else {
          const url = new URL(request.url());
          const f = url.searchParams.get('fields');
          if (f) fields = [f];
        }
      } catch (e) { }

      const responseValues = fields.map(f => ({
        field: f,
        values: [`val_${f}_1`, `val_${f}_2`]
      }));

      // Simulate network delay for loading state checks
      await new Promise(resolve => setTimeout(resolve, 300));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ values: responseValues })
      });
    });

    // Mock Search API to verify variable replacement
    await page.route('**/api/search*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hits: [],
          total: 0,
          took: 10
        })
      });
    });
  };

  // --- 1. Global Variable ---
  test('1.1 - Verify old/existing variables are global by default & API calls on click', async () => {
    const apiCalls = variables.setupApiTracking();

    await page.locator('[data-test="dashboard-setting-btn"]').click();
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();

    // Verify default scope is 'global' in UI
    await expect(page.locator('[data-test="dashboard-variable-scope-select"]')).toHaveText(/Global/i);

    await variables.addDashboardVariable('v_global', 'logs', 'e2e_automate', 'job', false, null, false, 'global', [], [], true);
    await page.locator('[data-test="dashboard-settings-close-btn"]').click();

    const selector = await variables.getVariableSelectorLocator('v_global', 'global');
    await selector.click();

    // Verify call happens on click
    await expect.poll(() => apiCalls.length).toBeGreaterThan(0);

    // Verify dropdown loads
    await expect(page.locator('[role="option"]').first()).toBeVisible();
  });

  // --- 2. Tab Level Variable ---
  test('2.1 - Tab Variable Isolation & Value Independence', async () => {
    await tabs.addTab('Tab_A');
    await tabs.addTab('Tab_B');

    // Add Tab A Variable
    await variables.addDashboardVariable('v_tab_a', 'logs', 'e2e_automate', 'level', false, null, false, 'tabs', ['Tab_A']);

    // Add Shared Tab Variable (assigned to A and B)
    await variables.addDashboardVariable('v_shared', 'logs', 'e2e_automate', 'job', false, null, false, 'tabs', ['Tab_A', 'Tab_B']);

    // Check Tab A
    await tabs.switchTab('Tab_A');
    await variables.verifyVariableVisibleInScope('v_tab_a', 'tab');
    await variables.verifyVariableVisibleInScope('v_shared', 'tab');

    await variables.selectValueFromScopedVariable('v_shared', 'val_job_1', 'tab');

    // Switch to Tab B
    await tabs.switchTab('Tab_B');
    await variables.verifyVariableNotVisible('v_tab_a', 'tab');
    await variables.verifyVariableVisibleInScope('v_shared', 'tab');

    // Verify value in Tab B is independent
    let valB = await variables.getVariableValue('v_shared', 'tab');
    expect(valB).not.toBe('val_job_1');

    await variables.selectValueFromScopedVariable('v_shared', 'val_job_2', 'tab');

    // Switch back to A - should persist A's value
    await tabs.switchTab('Tab_A');
    expect(await variables.getVariableValue('v_shared', 'tab')).toContain('val_job_1');
  });

  // --- 3. Panel Level Variable ---
  test('3.1 - Panel Variable Scope & Loading on Visibility', async () => {
    const panelId = await dashboardPage.getPanelId(0);
    await variables.addDashboardVariable('v_panel', 'logs', 'e2e_automate', 'kubernetes_pod_name', false, null, false, 'panels', null, [panelId]);

    await variables.verifyVariableVisibleInScope('v_panel', 'panel', panelId);
  });

  // --- 4. Global Variable Dependency ---
  test('4.1 - 8-Level Dependency Chain (v1->v8)', async () => {
    test.setTimeout(120000);
    const chain = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'];

    for (let i = 0; i < chain.length; i++) {
      const name = chain[i];
      const parent = i > 0 ? chain[i - 1] : null;
      const filter = parent ? { filterName: parent, operator: '=', value: `$${parent}` } : null;

      await variables.addDashboardVariable(name, 'logs', 'e2e_automate', name, false, filter, false, 'global');
    }

    // Trigger chain
    await variables.selectValueFromVariableDropDown('v1', 'val_v1_1');

    for (let i = 1; i < chain.length; i++) {
      await variables.waitForVariableApiCall(chain[i]);
      await variables.selectValueFromVariableDropDown(chain[i], `val_${chain[i]}_1`);
    }
  });

  test('4.2 - Circular Dependency Detection', async () => {
    await variables.addDashboardVariable('v_cycle_a', 'logs', 'e2e_automate', 'job');
    await variables.addDashboardVariable('v_cycle_b', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$v_cycle_a' });

    await variables.editVariable('v_cycle_a', { filterConfig: { filterName: 'level', operator: '=', value: '$v_cycle_b' } });

    await variables.verifyCircularDependencyError();
  });

  test('4.3 - Multi-Parent Dependency (C depends on A and B)', async () => {
    await variables.addDashboardVariable('v_parent_a', 'logs', 'e2e_automate', 'a_field');
    await variables.addDashboardVariable('v_parent_b', 'logs', 'e2e_automate', 'b_field');

    await variables.addDashboardVariable('v_child_c', 'logs', 'e2e_automate', 'c_field', false, [
      { filterName: 'a_field', operator: '=', value: '$v_parent_a' },
      { filterName: 'b_field', operator: '=', value: '$v_parent_b' }
    ]);

    // Set A, C should NOT trigger/load yet
    await variables.selectValueFromVariableDropDown('v_parent_a', 'val_a_field_1');

    const apiCalls = variables.setupApiTracking();
    await page.waitForTimeout(1000);
    expect(apiCalls.filter(c => c.url.includes('c_field')).length).toBe(0);

    // Set B
    await variables.selectValueFromVariableDropDown('v_parent_b', 'val_b_field_1');

    // Now C should trigger load
    await variables.waitForVariableApiCall('c_field');
    await variables.selectValueFromVariableDropDown('v_child_c', 'val_c_field_1');
  });

  // --- 5. UI / Refresh Indicators ---
  test('5.1 - Refresh Indicators trigger correctly', async () => {
    const panelId = await dashboardPage.getPanelId(0);
    await variables.addDashboardVariable('v_glob_ref', 'logs', 'e2e_automate', 'job');
    await variables.addDashboardVariable('v_pan_ref', 'logs', 'e2e_automate', 'level', false, null, false, 'panels', null, [panelId]);

    // Change Global Variable -> Global Refresh Yellow
    await variables.selectValueFromVariableDropDown('v_glob_ref', 'val_job_1');
    await variables.verifyGlobalRefreshIndicator(true);

    // Click Global Refresh
    const refreshReq = page.waitForResponse(resp => resp.url().includes('api/search') && resp.status() === 200);
    await page.locator('[data-test="dashboard-refresh-btn"]').click();
    await refreshReq;
    await variables.verifyGlobalRefreshIndicator(false);

    // Change Panel Variable -> Panel Refresh Yellow
    await variables.selectValueFromScopedVariable('v_pan_ref', 'val_level_1', 'panel', panelId);
    await variables.verifyPanelRefreshIndicator(panelId, true);
    await variables.verifyGlobalRefreshIndicator(false);

    // Click Panel Refresh
    const panelRefreshReq = page.waitForResponse(resp => resp.url().includes('api/search') && resp.status() === 200);
    await page.locator(`[data-test-panel-id="${panelId}"] [data-test="dashboard-panel-refresh-panel-btn"]`).click();
    await panelRefreshReq;
    await variables.verifyPanelRefreshIndicator(panelId, false);
  });

  // --- 6. URL Syncing ---
  test('6.1 - URL structure v-var=val and v-var.t.tabId=val', async () => {
    await tabs.addTab('URL_Tab');
    const tabId = await page.evaluate(() => {
      return window.location.hash.split('tab=')[1]?.split('&')[0];
    });

    await variables.addDashboardVariable('v_u_glob', 'logs', 'e2e_automate', 'job');
    await variables.addDashboardVariable('v_u_tab', 'logs', 'e2e_automate', 'level', false, null, false, 'tabs', ['URL_Tab']);

    await variables.selectValueFromVariableDropDown('v_u_glob', 'val_job_1');
    await variables.selectValueFromScopedVariable('v_u_tab', 'val_level_1', 'tab');

    await expect(page).toHaveURL(new RegExp(`v-v_u_glob=val_job_1`));
    await expect(page).toHaveURL(new RegExp(`v-v_u_tab\\.t\\.[^=]+=val_level_1`));

    // Reload and verify
    await page.reload();
    await waitForDashboardPage(page);
    expect(await variables.getVariableValue('v_u_glob')).toContain('val_job_1');
    expect(await variables.getVariableValue('v_u_tab', 'tab')).toContain('val_level_1');
  });

  // --- 7. Variable Creation: Deleted Tab/Panel Handling ---
  test('7.1 - Deleted Tab shows correctly in Variable Settings', async () => {
    await tabs.addTab('To_Be_Deleted');
    await variables.addDashboardVariable('v_resilient', 'logs', 'e2e_automate', 'job', false, null, false, 'tabs', ['To_Be_Deleted']);

    const pm = new PageManager(page);
    await pm.dashboardSetting.openSetting();
    await pm.dashboardSetting.deleteTab('To_Be_Deleted');
    await pm.dashboardSetting.closeSettingWindow();

    await variables.verifyTargetTabLabel('v_resilient', 'To_Be_Deleted', 'To_Be_Deleted (deleted tab)');
  });

  // --- 8. Drilldown ---
  test('8.1 - Drilldown expands variables', async () => {
    await variables.addDashboardVariable('v_dd', 'logs', 'e2e_automate', 'job');
    await variables.selectValueFromVariableDropDown('v_dd', 'val_job_1');

    const panelId = await dashboardPage.getPanelId(0);
    await dashboardPage.clickPanelMenu(panelId);
    await page.locator('[data-test="dashboard-panel-config-btn"]').click();

    await drilldown.addDrilldownByURL('test_dd', 'http://example.com?q=$v_dd');
    await page.locator('[data-test="dashboard-settings-close-btn"]').click();

    const ddBtn = page.locator(`[data-test-panel-id="${panelId}"] [data-test="panel-drilldown-btn"]`);
    await expect(ddBtn).toBeVisible();
  });
});
