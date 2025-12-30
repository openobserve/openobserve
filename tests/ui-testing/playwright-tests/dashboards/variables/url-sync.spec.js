import { test, expect } from '@playwright/test';
import { DashboardPage } from '../../../pages/dashboardPages/dashboardPage';
import DashboardVariables from '../../../pages/dashboardPages/dashboard-variables';
import DashboardTabs from '../../../pages/dashboardPages/dashboard-tabs';

test.describe('Dashboard Variables: URL Synchronization', () => {
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

    test('4.1: Global variable commit updates URL with var-name format', async ({ page }) => {
        await dashboardPage.createDashboard();
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_g', 'constant', null, null, null, false, null, false, 'global');
        await variables.selectValueFromScopedVariable('v_g', 'val1', 'global');
        await dashboardPage.clickGlobalRefresh();
        await expect(page).toHaveURL(/var-v_g=val1/);
    });

    test('4.2: Tab-scoped variable commit updates URL with name.t.tabId format', async ({ page }) => {
        await dashboardPage.createDashboard();
        await tabs.addTab('Tab_A');
        const tabNameLocator = page.locator('[data-test^="dashboard-tab-"][data-test$="-name"]:has-text("Tab_A")').first();
        const tabDataTest = await tabNameLocator.getAttribute('data-test');
        const tabId = tabDataTest.match(/dashboard-tab-(.+)-name/)[1];

        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_t', 'constant', null, null, null, false, null, false, 'tabs', ['Tab_A']);
        await tabs.switchTab('Tab_A');
        await variables.selectValueFromScopedVariable('v_t', 'val2', 'tabs');
        await dashboardPage.clickGlobalRefresh();
        await expect(page).toHaveURL(new RegExp(`var-v_t\\.t\\.${tabId}=val2`));
    });

    test('4.3: Panel-scoped variable commit updates URL with name.p.panelId format', async ({ page }) => {
        await dashboardPage.createDashboard();
        const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_p', 'constant', null, null, null, false, null, false, 'panels', [], [panel1Id]);
        await variables.selectValueFromScopedVariable('v_p', 'val3', 'panels', panel1Id);
        await dashboardPage.clickPanelRefresh(panel1Id);
        await expect(page).toHaveURL(new RegExp(`var-v_p\\.p\\.${panel1Id}=val3`));
    });

    test('4.4: Multi-select URL encoding (Commas)', async ({ page }) => {
        await dashboardPage.createDashboard();
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_m', 'query_values', 'logs', 'e2e_automate', 'level', true);
        
        await page.locator('[data-test="dashboard-variable-v_m-container"]').click();
        // Select multiple options
        await page.locator('[data-test="variable-option-INFO"]').click();
        await page.locator('[data-test="variable-option-ERROR"]').click();
        await page.keyboard.press('Escape');
        
        await dashboardPage.clickGlobalRefresh();
        await expect(page).toHaveURL(/var-v_m=INFO,ERROR/);
    });

    test('4.5: Deep Navigation - Restore all scopes from URL on load', async ({ page }) => {
        await dashboardPage.createDashboard();
        const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
        await tabs.addTab('Tab_X');
        const tabNameLocator = page.locator('[data-test^="dashboard-tab-"][data-test$="-name"]:has-text("Tab_X")').first();
        const tabDataTest = await tabNameLocator.getAttribute('data-test');
        const tabId = tabDataTest.match(/dashboard-tab-(.+)-name/)[1];

        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_g', 'constant', null, null, null, false, null, false, 'global');
        await variables.addDashboardVariable('v_t', 'constant', null, null, null, false, null, false, 'tabs', ['Tab_X']);
        await variables.addDashboardVariable('v_p', 'constant', null, null, null, false, null, false, 'panels', ['Tab_X'], [panel1Id]);

        const baseUrl = page.url().split('?')[0];
        const targetUrl = `${baseUrl}?var-v_g=u_g&var-v_t.t.${tabId}=u_t&var-v_p.p.${panel1Id}=u_p`;
        await page.goto(targetUrl);
        await tabs.switchTab('Tab_X');
        await expect(page.locator('[data-test="variable-v_g-value"]')).toHaveText('u_g');
        await expect(page.locator('[data-test="variable-v_t-value"]')).toHaveText('u_t');
        await expect(page.locator(`[data-test="panel-${panel1Id}-variable-v_p-value"]`)).toHaveText('u_p');
    });

    test('4.6: Special character encoding in URL', async ({ page }) => {
        await dashboardPage.createDashboard();
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_spec', 'constant', null, null, null);
        
        await variables.selectValueFromScopedVariable('v_spec', 'val with space!', 'global');
        await dashboardPage.clickGlobalRefresh();
        
        // Should be encoded
        await expect(page).toHaveURL(/var-v_spec=val%20with%20space%21/);
    });

    test('4.9: Drilldown Compatibility - Unscoped URL param applies to ALL instances', async ({ page }) => {
        await dashboardPage.createDashboard();
        const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
        await tabs.addTab('Tab_Y');
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('status', 'constant', null, null, null, false, null, false, 'global');
        await variables.addDashboardVariable('status', 'constant', null, null, null, false, null, false, 'tabs', ['Tab_Y']);
        await variables.addDashboardVariable('status', 'constant', null, null, null, false, null, false, 'panels', ['Tab_Y'], [panel1Id]);
        const baseUrl = page.url().split('?')[0];
        await page.goto(`${baseUrl}?var-status=drilldown`);
        await expect(page.locator('[data-test="variable-status-value"]').first()).toHaveText('drilldown');
        await tabs.switchTab('Tab_Y');
        await expect(page.locator('[data-test="variable-status-value"]').nth(1)).toHaveText('drilldown');
        await expect(page.locator(`[data-test="panel-${panel1Id}-variable-status-value"]`)).toHaveText('drilldown');
    });
});
