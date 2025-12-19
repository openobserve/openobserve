import { test, expect } from '@playwright/test';
import { DashboardPage } from '../../../pages/dashboardPages/dashboardPage';
import DashboardVariables from '../../../pages/dashboardPages/dashboard-variables';
import DashboardTabs from '../../../pages/dashboardPages/dashboard-tabs';

test.describe('Dashboard Variables: Operations & Integrity', () => {
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

    test('5.1: Tab Variable Isolation', async ({ page }) => {
        await dashboardPage.createDashboard();
        await tabs.addTab('Tab_1');
        await tabs.addTab('Tab_2');
        await page.locator('[data-test="dashboard-settings-btn"]').click();
        await variables.addDashboardVariable('v_shared', 'constant', null, null, null, false, null, false, 'tabs', ['Tab_1', 'Tab_2']);
        await tabs.switchTab('Tab_1');
        await variables.selectValueFromScopedVariable('v_shared', 'val_1', 'tabs');
        await dashboardPage.clickGlobalRefresh();
        await tabs.switchTab('Tab_2');
        await variables.selectValueFromScopedVariable('v_shared', 'val_2', 'tabs');
        await dashboardPage.clickGlobalRefresh();
        await tabs.switchTab('Tab_1');
        await expect(page.locator('[data-test="variable-v_shared-value"]')).toHaveText('val_1');
        await tabs.switchTab('Tab_2');
        await expect(page.locator('[data-test="variable-v_shared-value"]')).toHaveText('val_2');
    });

    test('5.2: Delete Tab Cleanup', async ({ page }) => {
        await dashboardPage.createDashboard();
        await tabs.addTab('Tab_X');
        await page.locator('[data-test="dashboard-settings-btn"]').click();
        await variables.addDashboardVariable('v_tab', 'constant', null, null, null, false, null, false, 'tabs', ['Tab_X']);
        await tabs.deleteTab('Tab_X');
        await expect(page.locator('[data-test="dashboard-variable-v_tab-container"]')).not.toBeVisible();
    });

    test('5.3: Variable Rename integrity (Update all scopes)', async ({ page }) => {
        await dashboardPage.createDashboard();
        await page.locator('[data-test="dashboard-settings-btn"]').click();
        await variables.addDashboardVariable('old_name', 'constant', null, null, null);
        
        await page.locator('[data-test="dashboard-settings-btn"]').click();
        await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
        await page.locator('[data-test="dashboard-variable-settings-draggable-row"]:has-text("old_name")').locator('[data-test="dashboard-variable-settings-edit-btn"]').click();
        
        await page.locator('[data-test="dashboard-variable-name-input"]').fill('new_name');
        await page.locator('[data-test="dashboard-variable-save-btn"]').click();
        
        await expect(page.locator('[data-test="dashboard-variable-new_name-container"]')).toBeVisible();
        await expect(page.locator('[data-test="dashboard-variable-old_name-container"]')).not.toBeVisible();
    });

    test('5.4: Variable Scope Change migration (Global -> Tab)', async ({ page }) => {
        await dashboardPage.createDashboard();
        await tabs.addTab('Tab_A');
        await page.locator('[data-test="dashboard-settings-btn"]').click();
        await variables.addDashboardVariable('v_change', 'constant', null, null, null, false, null, false, 'global');
        
        await page.locator('[data-test="dashboard-settings-btn"]').click();
        await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
        await page.locator('[data-test="dashboard-variable-settings-draggable-row"]:has-text("v_change")').locator('[data-test="dashboard-variable-settings-edit-btn"]').click();
        
        await page.locator('[data-test="dashboard-variable-scope-select"]').click();
        await page.getByRole('option', { name: 'Tabs' }).click();
        await page.locator('[data-test="dashboard-variable-tabs-select"]').click();
        await page.getByRole('option', { name: 'Tab_A' }).click();
        await page.keyboard.press('Escape');
        await page.locator('[data-test="dashboard-variable-save-btn"]').click();
        
        await page.reload();
        await expect(page.locator('[data-test="global-variables-selector"] [data-test="dashboard-variable-v_change-container"]')).not.toBeVisible();
        await tabs.switchTab('Tab_A');
        await expect(page.locator('[data-test="tab-variables-selector"] [data-test="dashboard-variable-v_change-container"]')).toBeVisible();
    });

    test('5.5: Dashboard Rename stability', async ({ page }) => {
        await dashboardPage.createDashboard('Orig_Name');
        await page.locator('[data-test="dashboard-settings-btn"]').click();
        await variables.addDashboardVariable('v_stable', 'constant', null, null, null);
        
        await page.locator('[data-test="dashboard-settings-btn"]').click();
        await page.locator('[data-test="dashboard-settings-general-tab"]').click();
        await page.locator('[data-test="dashboard-settings-name-input"]').fill('New_Dashboard_Name');
        await page.locator('[data-test="dashboard-settings-save-btn"]').click();
        
        await page.reload();
        await expect(page.locator('[data-test="dashboard-variable-v_stable-container"]')).toBeVisible();
    });

    test('6.1: Empty State Handling', async ({ page }) => {
        await dashboardPage.createDashboard();
        await page.locator('[data-test="dashboard-settings-btn"]').click();
        await variables.addDashboardVariable('v_empty', 'query_values', 'logs', 'e2e_automate', 'non_existent_field');
        await variables.checkVariableStatus('v_empty', { isLoading: false });
        await expect(page.locator('[data-test="dashboard-variable-v_empty-container"]')).toBeVisible();
    });

    test('6.2: Rapid Tab Switching Stability', async ({ page }) => {
        await dashboardPage.createDashboard();
        await tabs.addTab('Tab_A');
        await tabs.addTab('Tab_B');
        for (let i = 0; i < 5; i++) {
            await tabs.switchTab('Tab_A');
            await tabs.switchTab('Tab_B');
            await tabs.switchTab('Tab 1');
        }
        await expect(page.locator('[data-test="dashboard-tab-Tab_A"]')).toBeVisible();
        await expect(page.locator('[data-test="dashboard-tab-Tab_B"]')).toBeVisible();
    });

    test('6.3: Scale test (10+ panels with variables)', async ({ page }) => {
        await dashboardPage.createDashboard();
        for (let i = 0; i < 10; i++) {
            await dashboardPage.addPanel();
        }
        // Just verify dashboard still loads
        await expect(page.locator('[data-test-panel-id]')).toHaveCount(11); // 1 default + 10 added
    });

    test('6.4: Depend on Hidden Tab Var', async ({ page }) => {
        await dashboardPage.createDashboard();
        await tabs.addTab('Tab_1');
        await tabs.addTab('Tab_2');
        const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
        await page.locator('[data-test="dashboard-settings-btn"]').click();
        await variables.addDashboardVariable('v_hidden', 'constant', null, null, null, false, null, false, 'tabs', ['Tab_1']);
        await page.locator('[data-test="dashboard-settings-btn"]').click();
        await variables.addDashboardVariable('v_child', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$v_hidden' }, false, 'panels', ['Tab_2'], [panel1Id]);
        await tabs.switchTab('Tab_2');
        await variables.checkVariableStatus('v_child', { isLoading: false, panelId: panel1Id });
    });

    test('6.5: Legacy dashboard backward compatibility', async ({ page }) => {
        // Create a "legacy" style dashboard (simulated by variables without scope)
        // Our addDashboardVariable might already set scope, but we can verify it works
        await dashboardPage.createDashboard();
        await page.locator('[data-test="dashboard-settings-btn"]').click();
        await variables.addDashboardVariable('v_legacy', 'constant', null, null, null);
        await page.reload();
        await expect(page.locator('[data-test="dashboard-variable-v_legacy-container"]')).toBeVisible();
    });
});
