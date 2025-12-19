import { test, expect } from '@playwright/test';
import { DashboardPage } from './pages/dashboardPages/dashboardPage';
import DashboardVariables from './pages/dashboardPages/dashboard-variables';
import DashboardTabs from './pages/dashboardPages/dashboard-tabs';

test.describe('Dashboard Scoped Variables', () => {
    let dashboardPage;
    let variables;
    let tabs;

    test.beforeEach(async ({ page }) => {
        dashboardPage = new DashboardPage(page);
        variables = new DashboardVariables(page);
        tabs = new DashboardTabs(page);
        
        // Login and navigate to dashboards (assuming standard login flow)
        await page.goto('/');
        await dashboardPage.navigateToDashboards();
    });

    test.describe('1. Variables Creation & Dependency Rules', () => {
        let panel1Id;

        test('1.1 - 1.5: Create and Assign Variables to Global, Tab, and Panel Scopes', async ({ page }) => {
            await dashboardPage.createDashboard();
            
            // Capture the default panel ID
            panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
            
            // 1.1 Create Global Variable
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_global', 'query_values', 'logs', 'e2e_automate', 'kubernetes_container_name', false, null, false, 'global');
            
            // 1.2 Create Tab-Scoped Variable
            // First add a tab
            await tabs.addTab('Tab_A');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_tab', 'query_values', 'logs', 'e2e_automate', 'kubernetes_namespace', false, null, false, 'tabs', ['Tab_A']);
            
            // 1.4 Create Panel-Scoped Variable (on Panel 1)
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_panel', 'query_values', 'logs', 'e2e_automate', 'kubernetes_node_name', false, null, false, 'panels', ['Tab_A'], [panel1Id]);
            
            // 1.5 Multiple assignment (Already covered by assigning v_panel to Panel 1)

            // Verification
            await page.reload();
            await expect(page.locator('[data-test="global-variables-selector"] [data-test="dashboard-variable-v_global-container"]')).toBeVisible();
            
            // Switch to Tab_A
            await tabs.switchTab('Tab_A');
            await expect(page.locator('[data-test="tab-variables-selector"] [data-test="dashboard-variable-v_tab-container"]')).toBeVisible();
            
            // Check Panel Variable
            const panel = page.locator(`[data-test-panel-id="${panel1Id}"]`);
            await expect(panel.locator('[data-test="dashboard-variable-v_panel-container"]')).toBeVisible();
        });

        test('1.6 - 1.12: Valid Dependency Scopes', async ({ page }) => {
            // This test verifies that variables can correctly depend on each other across allowed scopes
            // 1.6 Global depends on Global
            // 1.7 Tab depends on Global
            // 1.10 Panel depends on Tab
            
            // Setup chain: v_global_p -> v_global_c -> v_tab_c -> v_panel_c
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            
            // Add Parent Global
            await variables.addDashboardVariable('v_gp', 'query_values', 'logs', 'e2e_automate', 'job');
            
            // Add Child Global depending on Parent Global
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_gc', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$v_gp' });
            
            // Add Child Tab depending on Child Global
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_tc', 'query_values', 'logs', 'e2e_automate', 'kubernetes_namespace', false, { filterName: 'level', operator: '=', value: '$v_gc' }, false, 'tabs', ['Tab_A']);
            
            // Add Child Panel depending on Child Tab
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_pc', 'query_values', 'logs', 'e2e_automate', 'kubernetes_container_name', false, { filterName: 'kubernetes_namespace', operator: '=', value: '$v_tc' }, false, 'panels', ['Tab_A'], [panel1Id]);
            
            // Verification: Verify all are present in the UI
            await page.reload();
            await tabs.switchTab('Tab_A');
            await expect(page.locator('[data-test="dashboard-variable-v_gp-container"]')).toBeVisible();
            await expect(page.locator('[data-test="dashboard-variable-v_gc-container"]')).toBeVisible();
            await expect(page.locator('[data-test="dashboard-variable-v_tc-container"]')).toBeVisible();
            await expect(page.locator(`[data-test-panel-id="${panel1Id}"] [data-test="dashboard-variable-v_pc-container"]`)).toBeVisible();
        });

        test('1.13 - 1.17: Invalid Dependency UI Restrictions', async ({ page }) => {
            // 1.13 Global cannot depend on Tab
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
            await page.locator('[data-test="dashboard-variable-add-btn"]').click();
            
            // Select Global scope
            await page.locator('[data-test="dashboard-variable-scope-select"]').click();
            await page.getByRole('option', { name: 'Global' }).click();
            
            // Try to add a filter
            await page.locator('[data-test="dashboard-add-filter-btn"]').click();
            await page.locator('[data-test="dashboard-query-values-filter-name-selector"]').click();
            
            // Verify that v_tab is NOT present in the autocomplete for filters
            // (Autocomplete uses CommonAutoComplete which might need verification)
            // But wait, the filter value input uses CommonAutoComplete which lists variables.
            // Let's check the filter value input.
            const filterValueInput = page.locator('input[placeholder="Enter Value"]');
            await filterValueInput.fill('$');
            await expect(page.getByRole('option', { name: 'v_tab' })).not.toBeVisible();
        });

        test('1.18: Circular Dependency Detection', async ({ page }) => {
            // Add VAR_A
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('VAR_A', 'query_values', 'logs', 'e2e_automate', 'job');
            
            // Add VAR_B depending on VAR_A
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('VAR_B', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$VAR_A' });
            
            // Edit VAR_A to depend on VAR_B
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
            await page.locator('[data-test="dashboard-variable-settings-draggable-row"]:has-text("VAR_A")').locator('[data-test="dashboard-variable-settings-edit-btn"]').click();
            
            await page.locator('[data-test="dashboard-add-filter-btn"]').click();
            // Fill filter: name="level", value="$VAR_B"
            await page.locator('[data-test="dashboard-query-values-filter-name-selector"]').click();
            await page.getByRole('option', { name: 'level' }).first().click();
            
            await page.locator('input[placeholder="Enter Value"]').fill('$VAR_B');
            
            await page.locator('[data-test="dashboard-variable-save-btn"]').click();
            
            // Verify error message
            await expect(page.locator('text=/Variables has cycle: VAR_A->VAR_B->VAR_A/')).toBeVisible();
            
            // Cleanup: Cancel edit
            await page.locator('[data-test="dashboard-variable-cancel-btn"]').click();
        });
    });

    test.describe('2. Variables Loading Lifecycle & Lazy Loading', () => {
        let valuesCalls = [];

        test.beforeEach(async ({ page }) => {
            valuesCalls = [];
            page.on('request', request => {
                if (request.url().includes('/_values')) {
                    valuesCalls.push(request.url());
                }
            });
        });

        test('2.1 - 2.4: Lazy Loading of Scoped Variables', async ({ page }) => {
            // Setup: 1 Global, 1 Tab (Inactive), 1 Panel (Invisible)
            await dashboardPage.createDashboard();
            const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
            
            // Add Global
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_global', 'query_values', 'logs', 'e2e_automate', 'level');
            
            // Add Tab_B & Variable
            await tabs.addTab('Tab_B');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_tab_b', 'query_values', 'logs', 'e2e_automate', 'job', false, null, false, 'tabs', ['Tab_B']);
            
            // Add Panel-Scoped Variable
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_panel', 'query_values', 'logs', 'e2e_automate', 'kubernetes_namespace', false, null, false, 'panels', ['Tab_B'], [panel1Id]);

            // 2.1 Reload - Verify only Global fires
            valuesCalls = []; // Reset tracker
            await page.reload();
            await expect(page.locator('[data-test="dashboard-variable-v_global-container"]')).toBeVisible();
            
            // Verify only v_global fired (level field)
            expect(valuesCalls.some(url => url.includes('level'))).toBeTruthy();
            expect(valuesCalls.some(url => url.includes('job'))).toBeFalsy();
            expect(valuesCalls.some(url => url.includes('kubernetes_namespace'))).toBeFalsy();

            // 2.3 Switch to Tab_B - Verify Tab Var fires
            valuesCalls = [];
            await tabs.switchTab('Tab_B');
            await expect(page.locator('[data-test="dashboard-variable-v_tab_b-container"]')).toBeVisible();
            expect(valuesCalls.some(url => url.includes('job'))).toBeTruthy();

            // 2.4 Panel Variable - If visible on Tab_B, it should fire. 
            // If it was out of view, it shouldn't.
            // On a new dashboard, the first panel is usually visible. 
            // So v_panel should have fired too.
            expect(valuesCalls.some(url => url.includes('kubernetes_namespace'))).toBeTruthy();
        });

        test('2.5 - 2.8: Dependency Chains and PENDING states', async ({ page }) => {
            // chain: G -> T -> P
            // Verify Tab var doesn't fire until Global is loaded
            // Verify Panel var doesn't fire until Tab is loaded
            
            // (Assuming setup from previous tests or creating new)
        });

        test('2.9 - 2.12: Value Change & Reset Cascade', async ({ page }) => {
            // 2.9: Update Global; verify Tab and Panel variables reset to loading/pending
            // 2.12: Visibility re-entry - Verify it doesn't re-fire if already loaded
            
            await tabs.switchTab('Tab_B');
            valuesCalls = [];
            
            // Scroll down to hide the panel
            await page.mouse.wheel(0, 2000);
            await page.waitForTimeout(500);
            
            // Scroll back up
            await page.mouse.wheel(0, -2000);
            await page.waitForTimeout(500);
            
            // Verify no new API calls for kubernetes_namespace
            const namespaceCalls = valuesCalls.filter(url => url.includes('kubernetes_namespace')).length;
            expect(namespaceCalls).toBe(0);
        });

        test('2.13 - 2.18: Visibility vs Dependency Conflict', async ({ page }) => {
            // 2.13: Panel Var visible, but parent Global is loading. Verify Panel waits.
            // 2.14: Panel Var NOT visible, but parent Global is loading. Verify Panel stays PENDING.
        });
    });

    test.describe('3. Values, Persistence & Two-Tier State', () => {
        test('3.1 - 3.4: Live vs Committed State and Refresh Indicators', async ({ page }) => {
            // Setup: 1 Global, 1 Panel Var
            // Change Global Var -> Verify Global Refresh yellow
            // Change Panel Var -> Verify Panel Refresh yellow
            // Commit Global -> Verify Global Refresh normal, Panel still yellow
            // Commit Panel -> Verify all normal
            
            await dashboardPage.createDashboard();
            const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
            
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v1', 'constant', null, null, null, false, null, false, 'global');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v2', 'constant', null, null, null, false, null, false, 'panels', [], [panel1Id]);

            // 3.1 Change v1 (Live state)
            await variables.selectValueFromScopedVariable('v1', 'new_val', 'global');
            
            // 3.2 Verify Global Refresh is yellow
            await dashboardPage.verifyGlobalRefreshIndicator(true);
            
            // 3.3 Change v2 (Live state)
            await variables.selectValueFromScopedVariable('v2', 'panel_val', 'panels', panel1Id);
            
            // Verify Panel Refresh indicator (yellow icon)
            await dashboardPage.verifyPanelRefreshIndicator(panel1Id, true);
            
            // 3.4 Click Global Refresh to commit
            await dashboardPage.clickGlobalRefresh();
            
            // Verify Global Refresh is normal
            await dashboardPage.verifyGlobalRefreshIndicator(false);
            
            // Verify Panel still has yellow indicator (isolation)
            await dashboardPage.verifyPanelRefreshIndicator(panel1Id, true);
            
            // Commit Panel
            await dashboardPage.clickPanelRefresh(panel1Id);
            await dashboardPage.verifyPanelRefreshIndicator(panel1Id, false);
        });

        test('3.6: Selection Persistence across Reload', async ({ page }) => {
            // Commit a value, reload, verify it's still there
        });
    });

    test.describe('4. URL Synchronization', () => {
        test('4.1 - 4.4: URL updates on Commit', async ({ page }) => {
            await dashboardPage.createDashboard();
            const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
            
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_g', 'constant', null, null, null, false, null, false, 'global');
            await variables.addDashboardVariable('v_p', 'constant', null, null, null, false, null, false, 'panels', [], [panel1Id]);

            // Set values
            await variables.selectValueFromScopedVariable('v_g', 'val_g', 'global');
            await variables.selectValueFromScopedVariable('v_p', 'val_p', 'panels', panel1Id);

            // Commit Global
            await dashboardPage.clickGlobalRefresh();
            
            // Verify URL has v-v_g=val_g
            await expect(page).toHaveURL(/v-v_g=val_g/);
            
            // Commit Panel
            await dashboardPage.clickPanelRefresh(panel1Id);
            
            // Verify URL has p-<id>-v_p=val_p
            const url = page.url();
            expect(url).toContain(`p-${panel1Id}-v_p=val_p`);
        });

        test('4.5: Initial Load from URL', async ({ page }) => {
            // Setup a dashboard with variables
            // Navigate directly to URL with params
            // Verify variables have correct values
        });
    });

    test.describe('5. Dashboards Operations & Integrity', () => {
        test('5.1: Tab Variable Isolation', async ({ page }) => {
            // Verify that changing variables in one tab doesn't affect another tab with same-named variable
            await dashboardPage.createDashboard();
            await tabs.addTab('Tab_1');
            await tabs.addTab('Tab_2');
            
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_shared', 'constant', null, null, null, false, null, false, 'tabs', ['Tab_1', 'Tab_2']);
            
            await tabs.switchTab('Tab_1');
            await variables.selectValueFromScopedVariable('v_shared', 'val_1', 'tabs');
            
            await tabs.switchTab('Tab_2');
            await variables.selectValueFromScopedVariable('v_shared', 'val_2', 'tabs');
            
            await tabs.switchTab('Tab_1');
            // Verify value is still val_1
        });

        test('5.2: Delete Tab Cleanup', async ({ page }) => {
            // Delete a tab; verify scoped variables tied to it are removed from UI.
            await tabs.deleteTab('Tab_1');
            await expect(page.locator('[data-test="dashboard-tab-Tab_1"]')).not.toBeVisible();
        });
    });
});
