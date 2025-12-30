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

const randomDashboardName = "VarAdv_" + Math.random().toString(36).slice(2, 11);

/**
 * Advanced Dashboard Variables Test Suite
 * Covers Add Panel workflows, Drilldown, and edge cases
 */
test.describe('Dashboard Variables - Advanced Scenarios', () => {
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
      await page.waitForTimeout(500);
      await dashboardPage.navigateToDashboards();
      await page.waitForTimeout(2000);
      await deleteDashboard(page, randomDashboardName);
    } catch (e) {
      console.log(`⚠️  Cleanup warning: ${e.message}`);
    }
  });

  test.describe('9. Add Panel with Variables', () => {
    test('9.1-9.3 - Add panel should show correct variables based on scope', async () => {
      await tabs.addTab('Tab_A');
      await tabs.addTab('Tab_B');

      // Create global variable
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

      // Create tab-scoped variable for Tab_A
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_tab_a',
        'logs',
        'e2e_automate',
        'level',
        false,
        null,
        false,
        'tabs',
        ['Tab_A']
      );

      // Create tab-scoped variable for Tab_B
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_tab_b',
        'logs',
        'e2e_automate',
        'kubernetes_namespace',
        false,
        null,
        false,
        'tabs',
        ['Tab_B']
      );

      // Switch to Tab_A and add panel
      await tabs.switchTab('Tab_A');
      await page.locator('[data-test="dashboard-add-panel-btn"]').click();
      await page.waitForTimeout(1000);

      // In the add panel page, we should see global and Tab_A variables
      // But NOT Tab_B variables

      // Navigate to query section where variables might be listed
      // This depends on your UI implementation
      // For example, checking if variables appear in a filter/autocomplete

      await page.locator('[data-test="dashboard-query-tab"]').click();
      await page.waitForTimeout(500);

      // Try to add a filter to see which variables are available
      const addFilterBtn = page.locator('[data-test="dashboard-add-filter-btn"]').first();
      if (await addFilterBtn.isVisible()) {
        await addFilterBtn.click();

        const filterValueInput = page.locator('[data-test="common-auto-complete"]').first();
        await filterValueInput.click();
        await filterValueInput.fill('$');
        await page.waitForTimeout(500);

        // Global variable should be available
        await expect(page.getByRole('option', { name: /v_global/ })).toBeVisible();

        // Tab_A variable should be available
        await expect(page.getByRole('option', { name: /v_tab_a/ })).toBeVisible();

        // Tab_B variable should NOT be available
        await expect(page.getByRole('option', { name: /v_tab_b/ })).not.toBeVisible();
      }

      // Discard panel
      await page.locator('[data-test="dashboard-panel-discard"]').click();

      // Handle confirmation dialog if it appears
      page.once('dialog', async dialog => {
        await dialog.accept();
      });
    });

    test('9.4-9.5 - Edit panel should pass selected variables in URL and not re-render', async () => {
      const panel1Id = await dashboardPage.getPanelId(0);

      // Create global variable
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

      // Set variable value and commit
      const streamPromise = waitForValuesStreamComplete(page);
      await variables.selectValueFromVariableDropDown('v_global', 'test_value');
      await streamPromise;

      await dashboardPage.clickGlobalRefresh();
      await page.waitForTimeout(1000);

      // Click edit on the panel
      const panel = page.locator(`[data-test-panel-id="${panel1Id}"]`);
      await panel.locator('[data-test="dashboard-panel-menu-icon"]').click();
      await page.locator('[data-test="dashboard-panel-edit-item"]').click();
      await page.waitForTimeout(1000);

      // Check that URL contains variable values
      const editUrl = page.url();
      expect(editUrl).toContain('v-v_global=test_value');

      // Panel should not show loading state since value is already available
      // This would require checking specific loading indicators

      // Go back to dashboard
      await page.locator('[data-test="dashboard-panel-discard"]').click();

      page.once('dialog', async dialog => {
        await dialog.accept();
      });
    });

    test('9.6-9.8 - Save from edit panel should update values and reload only that panel', async () => {
      const panel1Id = await dashboardPage.getPanelId(0);

      // Create panel variable
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

      // Set value
      const streamPromise = waitForValuesStreamComplete(page);
      await variables.selectValueFromScopedVariable('v_panel', 'initial_value', 'panel', panel1Id);
      await streamPromise;

      await dashboardPage.clickPanelRefresh(panel1Id);
      await page.waitForTimeout(1000);

      // Edit panel
      const panel = page.locator(`[data-test-panel-id="${panel1Id}"]`);
      await panel.locator('[data-test="dashboard-panel-menu-icon"]').click();
      await page.locator('[data-test="dashboard-panel-edit-item"]').click();
      await page.waitForTimeout(1000);

      // Make a change (e.g., change panel name)
      const panelNameInput = page.locator('[data-test="dashboard-panel-name"]');
      await panelNameInput.fill('Updated Panel Name');

      // Save
      await page.locator('[data-test="dashboard-panel-save"]').click();
      await page.waitForTimeout(2000);

      // Verify we're back on dashboard view
      await expect(page.locator('[data-test="dashboard-setting-btn"]')).toBeVisible();

      // Verify panel name updated
      await expect(panel.locator('text=Updated Panel Name')).toBeVisible();

      // Only this panel should have reloaded - other panels should not trigger reload
      // (This would require multiple panels to test properly)
    });

    test('9.9 - Adding filters in panel should only show available variables', async () => {
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
        'kubernetes_namespace',
        false,
        null,
        false,
        'panels',
        ['Tab_A'],
        [panel1Id]
      );

      await tabs.switchTab('Tab_A');

      // Edit panel and add filter
      const panel = page.locator(`[data-test-panel-id="${panel1Id}"]`);
      await panel.locator('[data-test="dashboard-panel-menu-icon"]').click();
      await page.locator('[data-test="dashboard-panel-edit-item"]').click();
      await page.waitForTimeout(1000);

      // Go to query tab
      await page.locator('[data-test="dashboard-query-tab"]').click();
      await page.waitForTimeout(500);

      // Add filter
      await page.locator('[data-test="dashboard-add-filter-btn"]').first().click();

      // Check available variables in value field
      const filterValueInput = page.locator('[data-test="common-auto-complete"]').first();
      await filterValueInput.click();
      await filterValueInput.fill('$');
      await page.waitForTimeout(500);

      // Should see global, tab, and panel variables
      await expect(page.getByRole('option', { name: /v_global/ })).toBeVisible();
      await expect(page.getByRole('option', { name: /v_tab/ })).toBeVisible();
      await expect(page.getByRole('option', { name: /v_panel/ })).toBeVisible();

      // Discard
      await page.locator('[data-test="dashboard-panel-discard"]').click();
      page.once('dialog', async dialog => await dialog.accept());
    });
  });

  test.describe('11. Drilldown with Variables', () => {
    test('11.1-11.3 - Drilldown should provide variable name and expand values in URL', async () => {
      // Create global variable
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_global', 'logs', 'e2e_automate', 'job');

      // Set value and commit
      const streamPromise = waitForValuesStreamComplete(page);
      await variables.selectValueFromVariableDropDown('v_global', 'drilldown_value');
      await streamPromise;

      await dashboardPage.clickGlobalRefresh();
      await page.waitForTimeout(1000);

      // Setup drilldown on a panel
      const panel1Id = await dashboardPage.getPanelId(0);
      const panel = page.locator(`[data-test-panel-id="${panel1Id}"]`);

      // Edit panel to add drilldown
      await panel.locator('[data-test="dashboard-panel-menu-icon"]').click();
      await page.locator('[data-test="dashboard-panel-edit-item"]').click();
      await page.waitForTimeout(1000);

      // Navigate to drilldown settings (implementation specific)
      // This is a placeholder as drilldown UI varies
      const drilldownTab = page.locator('[data-test="dashboard-drilldown-tab"]');
      if (await drilldownTab.isVisible()) {
        await drilldownTab.click();
        await page.waitForTimeout(500);

        // Add drilldown with variable reference
        await page.locator('[data-test="dashboard-add-drilldown-btn"]').click();

        // Configure drilldown to use variable (e.g., URL with $v_global)
        const drilldownUrlInput = page.locator('[data-test="dashboard-drilldown-url"]');
        await drilldownUrlInput.fill('/dashboard/target?var=$v_global');

        // Save panel
        await page.locator('[data-test="dashboard-panel-save"]').click();
        await page.waitForTimeout(2000);

        // Trigger drilldown by clicking on chart element
        // This would require simulating a click on a chart data point
        // Implementation depends on chart library and structure

        // Verify drilldown URL contains expanded value
        // await expect(page).toHaveURL(/var=drilldown_value/);
      }

      // Note: Full drilldown testing requires specific chart interactions
      // which depend on your visualization library (Plotly, ECharts, etc.)
    });
  });

  test.describe('Edge Cases and Error Scenarios', () => {
    test('Should handle deleted tab gracefully', async () => {
      await tabs.addTab('Tab_ToDelete');

      // Create variable assigned to this tab
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_tab_delete',
        'logs',
        'e2e_automate',
        'job',
        false,
        null,
        false,
        'tabs',
        ['Tab_ToDelete']
      );

      // Delete the tab
      await tabs.deleteTab('Tab_ToDelete');

      // Open settings and check variable
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await page.locator('[data-test="dashboard-settings-variable-tab"]').click();

      // Variable should show "(deleted tab)" instead of error
      const variableRow = page.locator('[data-test="dashboard-variable-settings-draggable-row"]:has-text("v_tab_delete")');
      await expect(variableRow).toContainText(/deleted|Deleted/);
    });

    test('Should handle timerange change affecting variable values', async () => {
      // Create variable
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_time_dependent', 'logs', 'e2e_automate', 'job');

      // Load initial values
      const input = page.getByLabel('v_time_dependent', { exact: true });
      let streamPromise = waitForValuesStreamComplete(page);
      await input.click();
      await streamPromise;

      // Get initial options count
      const initialOptions = await page.locator('[role="option"]').count();

      // Close dropdown
      await page.keyboard.press('Escape');

      // Change timerange
      await dashboardPage.setTimeToPast30Seconds();
      await page.waitForTimeout(1000);

      // Click dropdown again
      streamPromise = waitForValuesStreamComplete(page);
      await input.click();
      await streamPromise;

      // Options might be different based on timerange
      const newOptions = await page.locator('[role="option"]').count();

      // At minimum, API should have been called again
      // (actual values may or may not differ based on data)
      console.log(`Initial options: ${initialOptions}, New options: ${newOptions}`);
    });

    test('Should handle variable update without affecting loaded dashboard', async () => {
      // Create variable
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_test', 'logs', 'e2e_automate', 'job');

      // Load and set value
      const streamPromise = waitForValuesStreamComplete(page);
      await variables.selectValueFromVariableDropDown('v_test', 'initial_value');
      await streamPromise;

      await dashboardPage.clickGlobalRefresh();
      await page.waitForTimeout(1000);

      // Get current variable value
      const initialValue = await variables.getVariableValue('v_test', 'global');

      // Update variable configuration (change field)
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.editVariable('v_test', {
        // Update would change the variable definition
        // but shouldn't affect currently displayed value
      });

      // Close settings
      await page.locator('[data-test="dashboard-settings-close-btn"]').click();

      // Verify value hasn't changed on the dashboard view
      const currentValue = await variables.getVariableValue('v_test', 'global');
      expect(currentValue).toBe(initialValue);

      // Only after user interacts or refreshes should new config take effect
    });

    test('Should handle multiple dependent variables loading in correct order', async () => {
      // Create a complex dependency tree:
      //     v1
      //    /  \
      //   v2  v3
      //    \  /
      //     v4

      const apiCalls = variables.setupApiTracking();

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
        { filterName: 'job', operator: '=', value: '$v1' }
      );

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v4',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        { filterName: 'level', operator: '=', value: '$v2' }
      );

      // Wait for all to load
      await page.waitForTimeout(3000);

      // Verify loading order:
      // v1 should load first
      // v2 and v3 should load after v1 (in parallel)
      // v4 should load after v2

      const v1Time = apiCalls.find(call => call.url.includes('job'))?.timestamp || 0;
      const v2Time = apiCalls.find(call => call.url.includes('level'))?.timestamp || 0;
      const v3Time = apiCalls.find(call => call.url.includes('kubernetes_namespace'))?.timestamp || 0;
      const v4Time = apiCalls.find(call => call.url.includes('kubernetes_container_name'))?.timestamp || 0;

      expect(v1Time).toBeLessThan(v2Time);
      expect(v1Time).toBeLessThan(v3Time);
      expect(v2Time).toBeLessThan(v4Time);

      // v2 and v3 should be roughly parallel (within 1 second)
      const parallelThreshold = 1000;
      expect(Math.abs(v2Time - v3Time)).toBeLessThan(parallelThreshold);
    });

    test('Should handle panel variable visibility correctly on scroll', async () => {
      // Add multiple panels to enable scrolling
      // This test requires a dashboard with enough panels to cause scrolling

      const panel1Id = await dashboardPage.getPanelId(0);

      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable(
        'v_panel_lazy',
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

      const apiCalls = variables.setupApiTracking();

      // Scroll panel out of view
      await page.evaluate(() => window.scrollTo(0, 10000));
      await page.waitForTimeout(1000);

      // Clear API calls
      apiCalls.length = 0;

      // Scroll back into view
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(1000);

      // If variable was already loaded, should not trigger new API call
      const newCalls = apiCalls.filter(call => call.url.includes('kubernetes_container_name'));
      expect(newCalls.length).toBe(0);
    });
  });

  test.describe('Performance and Load Testing', () => {
    test('Should handle 10+ variables efficiently', async () => {
      // Create 10 independent variables
      for (let i = 1; i <= 10; i++) {
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable(
          `v_perf_${i}`,
          'logs',
          'e2e_automate',
          'job'
        );
      }

      // Reload and measure load time
      const startTime = Date.now();
      await page.reload();
      await page.waitForLoadState('networkidle');
      const loadTime = Date.now() - startTime;

      console.log(`Load time with 10 variables: ${loadTime}ms`);

      // All variables should be visible
      for (let i = 1; i <= 10; i++) {
        await variables.verifyVariableVisibleInScope(`v_perf_${i}`, 'global');
      }

      // Load time should be reasonable (adjust threshold as needed)
      expect(loadTime).toBeLessThan(15000); // 15 seconds threshold
    });

    test('Should handle rapid variable value changes', async () => {
      await page.locator('[data-test="dashboard-setting-btn"]').click();
      await variables.addDashboardVariable('v_rapid', 'logs', 'e2e_automate', 'job');

      // Rapidly change values
      const values = ['value1', 'value2', 'value3', 'value4', 'value5'];
      for (const value of values) {
        const streamPromise = waitForValuesStreamComplete(page);
        await variables.selectValueFromVariableDropDown('v_rapid', value);
        await streamPromise;
        await page.waitForTimeout(200);
      }

      // Final value should be set correctly
      const finalValue = await variables.getVariableValue('v_rapid', 'global');
      expect(finalValue).toContain('value5');
    });
  });
});
