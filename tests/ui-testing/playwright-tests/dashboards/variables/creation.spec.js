import { test, expect } from '@playwright/test';
import { DashboardPage } from '../../../pages/dashboardPages/dashboardPage';
import DashboardVariables from '../../../pages/dashboardPages/dashboard-variables';
import DashboardTabs from '../../../pages/dashboardPages/dashboard-tabs';

test.describe('Dashboard Variables: Creation & Dependencies', () => {
    let dashboardPage;
    let variables;
    let tabs;

    test.beforeEach(async ({ page }) => {
        dashboardPage = new DashboardPage(page);
        variables = new DashboardVariables(page);
        tabs = new DashboardTabs(page);
        
        await page.goto('/');
        await dashboardPage.navigateToDashboards();
    });

    test.describe('1. Scoped Variable Creation', () => {
        test('1.1: Create Global Variable (Query)', async ({ page }) => {
            await dashboardPage.createDashboard();
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_global', 'query_values', 'logs', 'e2e_automate', 'kubernetes_container_name', false, null, false, 'global');
            await page.reload();
            await expect(page.locator('[data-test="global-variables-selector"] [data-test="dashboard-variable-v_global-container"]')).toBeVisible();
        });

        test('1.2: Create Tab-Scoped Variable (Query)', async ({ page }) => {
            await dashboardPage.createDashboard();
            await tabs.addTab('Tab_A');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_tab', 'query_values', 'logs', 'e2e_automate', 'kubernetes_namespace', false, null, false, 'tabs', ['Tab_A']);
            await page.reload();
            await tabs.switchTab('Tab_A');
            await expect(page.locator('[data-test="tab-variables-selector"] [data-test="dashboard-variable-v_tab-container"]')).toBeVisible();
        });

        test('1.3: Create Global Variable (Constant)', async ({ page }) => {
            await dashboardPage.createDashboard();
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_const', 'constant', null, null, null, false, null, false, 'global');
            await page.reload();
            await expect(page.locator('[data-test="dashboard-variable-v_const-container"]')).toBeVisible();
        });

        test('1.4: Create Panel-Scoped Variable', async ({ page }) => {
            await dashboardPage.createDashboard();
            const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_panel', 'query_values', 'logs', 'e2e_automate', 'kubernetes_node_name', false, null, false, 'panels', [], [panel1Id]);
            await page.reload();
            await expect(page.locator(`[data-test-panel-id="${panel1Id}"]`).locator('[data-test="dashboard-variable-v_panel-container"]')).toBeVisible();
        });

        test('1.5: Multiple Scope Assignment (Tab + Panel)', async ({ page }) => {
            await dashboardPage.createDashboard();
            await tabs.addTab('Tab_B');
            const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_multi', 'constant', null, null, null, false, null, false, 'panels', ['Tab_B'], [panel1Id]);
            await page.reload();
            await tabs.switchTab('Tab_B');
            await expect(page.locator(`[data-test-panel-id="${panel1Id}"]`).locator('[data-test="dashboard-variable-v_multi-container"]')).toBeVisible();
        });
    });

    test.describe('2. Valid Dependency Chains', () => {
        test('1.6: Rule: Global depends on Global', async ({ page }) => {
            await dashboardPage.createDashboard();
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_gp', 'query_values', 'logs', 'e2e_automate', 'job');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_gc', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$v_gp' });
            await page.reload();
            await variables.checkVariableStatus('v_gc', { isLoading: false });
        });

        test('1.7: Rule: Tab depends on Global', async ({ page }) => {
            await dashboardPage.createDashboard();
            await tabs.addTab('Tab_A');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_g', 'query_values', 'logs', 'e2e_automate', 'job');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_t', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$v_g' }, false, 'tabs', ['Tab_A']);
            await page.reload();
            await tabs.switchTab('Tab_A');
            await variables.checkVariableStatus('v_t', { isLoading: false });
        });

        test('1.8: Rule: Panel depends on Global', async ({ page }) => {
            await dashboardPage.createDashboard();
            const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_g', 'query_values', 'logs', 'e2e_automate', 'job');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_p', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$v_g' }, false, 'panels', [], [panel1Id]);
            await page.reload();
            await variables.checkVariableStatus('v_p', { isLoading: false, panelId: panel1Id });
        });

        test('1.9: Rule: Global -> Tab -> Panel Chain', async ({ page }) => {
            await dashboardPage.createDashboard();
            await tabs.addTab('Tab_A');
            const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_g', 'query_values', 'logs', 'e2e_automate', 'job');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_t', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$v_g' }, false, 'tabs', ['Tab_A']);
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_p', 'query_values', 'logs', 'e2e_automate', 'kubernetes_namespace', false, { filterName: 'level', operator: '=', value: '$v_t' }, false, 'panels', ['Tab_A'], [panel1Id]);
            await page.reload();
            await tabs.switchTab('Tab_A');
            await variables.checkVariableStatus('v_p', { isLoading: false, panelId: panel1Id });
        });

        test('1.10: Rule: Tab depends on Tab (Same Tab)', async ({ page }) => {
            await dashboardPage.createDashboard();
            await tabs.addTab('Tab_A');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_t1', 'query_values', 'logs', 'e2e_automate', 'job', false, null, false, 'tabs', ['Tab_A']);
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_t2', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$v_t1' }, false, 'tabs', ['Tab_A']);
            await page.reload();
            await tabs.switchTab('Tab_A');
            await variables.checkVariableStatus('v_t2', { isLoading: false });
        });

        test('1.11: Rule: Panel depends on Tab (In that tab)', async ({ page }) => {
            await dashboardPage.createDashboard();
            await tabs.addTab('Tab_A');
            const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_t', 'query_values', 'logs', 'e2e_automate', 'job', false, null, false, 'tabs', ['Tab_A']);
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_p', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$v_t' }, false, 'panels', ['Tab_A'], [panel1Id]);
            await page.reload();
            await tabs.switchTab('Tab_A');
            await variables.checkVariableStatus('v_p', { isLoading: false, panelId: panel1Id });
        });

        test('1.12: Rule: Panel depends on Panel (Same Panel)', async ({ page }) => {
            await dashboardPage.createDashboard();
            const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_p1', 'query_values', 'logs', 'e2e_automate', 'job', false, null, false, 'panels', [], [panel1Id]);
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_p2', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$v_p1' }, false, 'panels', [], [panel1Id]);
            await page.reload();
            await variables.checkVariableStatus('v_p2', { isLoading: false, panelId: panel1Id });
        });
    });

    test.describe('3. Dependency Restrictions & Errors', () => {
        test('1.13: Restriction: Global cannot depend on Tab', async ({ page }) => {
            await dashboardPage.createDashboard();
            await tabs.addTab('Tab_A');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_tab', 'constant', null, null, null, false, null, false, 'tabs', ['Tab_A']);
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
            await page.locator('[data-test="dashboard-variable-add-btn"]').click();
            await page.locator('[data-test="dashboard-variable-scope-select"]').click();
            await page.getByRole('option', { name: 'Global' }).click();
            await page.locator('[data-test="dashboard-add-filter-btn"]').click();
            await page.locator('input[placeholder="Enter Value"]').fill('$');
            await expect(page.getByRole('option', { name: 'v_tab' })).not.toBeVisible();
        });

        test('1.14: Restriction: Global cannot depend on Panel', async ({ page }) => {
            await dashboardPage.createDashboard();
            const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_panel', 'constant', null, null, null, false, null, false, 'panels', [], [panel1Id]);
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
            await page.locator('[data-test="dashboard-variable-add-btn"]').click();
            await page.locator('[data-test="dashboard-variable-scope-select"]').click();
            await page.getByRole('option', { name: 'Global' }).click();
            await page.locator('[data-test="dashboard-add-filter-btn"]').click();
            await page.locator('input[placeholder="Enter Value"]').fill('$');
            await expect(page.getByRole('option', { name: 'v_panel' })).not.toBeVisible();
        });

        test('1.15: Restriction: Tab cannot depend on Panel', async ({ page }) => {
            await dashboardPage.createDashboard();
            await tabs.addTab('Tab_A');
            const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_panel', 'constant', null, null, null, false, null, false, 'panels', ['Tab_A'], [panel1Id]);
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
            await page.locator('[data-test="dashboard-variable-add-btn"]').click();
            await page.locator('[data-test="dashboard-variable-scope-select"]').click();
            await page.getByRole('option', { name: 'Tabs' }).click();
            await page.locator('[data-test="dashboard-add-filter-btn"]').click();
            await page.locator('input[placeholder="Enter Value"]').fill('$');
            await expect(page.getByRole('option', { name: 'v_panel' })).not.toBeVisible();
        });

        test('1.16: Restriction: Tab1 cannot depend on Tab2', async ({ page }) => {
            await dashboardPage.createDashboard();
            await tabs.addTab('Tab1');
            await tabs.addTab('Tab2');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_t1', 'constant', null, null, null, false, null, false, 'tabs', ['Tab1']);
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
            await page.locator('[data-test="dashboard-variable-add-btn"]').click();
            await page.locator('[data-test="dashboard-variable-scope-select"]').click();
            await page.getByRole('option', { name: 'Tabs' }).click();
            await page.locator('[data-test="dashboard-variable-tabs-select"]').click();
            await page.getByRole('option', { name: 'Tab2' }).click();
            await page.keyboard.press('Escape');
            await page.locator('[data-test="dashboard-add-filter-btn"]').click();
            await page.locator('input[placeholder="Enter Value"]').fill('$');
            await expect(page.getByRole('option', { name: 'v_t1' })).not.toBeVisible();
        });

        test('1.17: Restriction: Panel1 cannot depend on Panel2', async ({ page }) => {
            await dashboardPage.createDashboard();
            const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
            await dashboardPage.addPanel();
            const panel2Id = await page.locator('[data-test-panel-id]').nth(1).getAttribute('data-test-panel-id');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('v_p1', 'constant', null, null, null, false, null, false, 'panels', [], [panel1Id]);
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
            await page.locator('[data-test="dashboard-variable-add-btn"]').click();
            await page.locator('[data-test="dashboard-variable-scope-select"]').click();
            await page.getByRole('option', { name: 'Panels' }).click();
            await page.locator('[data-test="dashboard-variable-panels-select"]').click();
            await page.getByRole('option', { name: panel2Id }).click();
            await page.keyboard.press('Escape');
            await page.locator('[data-test="dashboard-add-filter-btn"]').click();
            await page.locator('input[placeholder="Enter Value"]').fill('$');
            await expect(page.getByRole('option', { name: 'v_p1' })).not.toBeVisible();
        });

        test('1.18: Circular Dependency Detection (A -> B -> A)', async ({ page }) => {
            await dashboardPage.createDashboard();
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('VAR_A', 'query_values', 'logs', 'e2e_automate', 'job');
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await variables.addDashboardVariable('VAR_B', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$VAR_A' });
            await page.locator('[data-test="dashboard-settings-btn"]').click();
            await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
            await page.locator('[data-test="dashboard-variable-settings-draggable-row"]:has-text("VAR_A")').locator('[data-test="dashboard-variable-settings-edit-btn"]').click();
            await page.locator('[data-test="dashboard-add-filter-btn"]').click();
            await page.locator('[data-test="dashboard-query-values-filter-name-selector"]').click();
            await page.getByRole('option', { name: 'level' }).first().click();
            await page.locator('input[placeholder="Enter Value"]').fill('$VAR_B');
            await page.locator('[data-test="dashboard-variable-save-btn"]').click();
            await expect(page.locator('text=/Variables has cycle: VAR_A->VAR_B->VAR_A/')).toBeVisible();
        });
    });
});
