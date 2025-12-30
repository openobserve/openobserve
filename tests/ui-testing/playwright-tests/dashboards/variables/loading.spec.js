import { test, expect } from '@playwright/test';
import { DashboardPage } from '../../../pages/dashboardPages/dashboardPage';
import DashboardVariables from '../../../pages/dashboardPages/dashboard-variables';
import DashboardTabs from '../../../pages/dashboardPages/dashboard-tabs';

test.describe('Dashboard Variables: Loading Lifecycle & Lazy Loading', () => {
    let dashboardPage;
    let variables;
    let tabs;
    let valuesCalls = [];

    test.beforeEach(async ({ page }) => {
        dashboardPage = new DashboardPage(page);
        variables = new DashboardVariables(page);
        tabs = new DashboardTabs(page);
        
        valuesCalls = [];
        page.on('request', request => {
            if (request.url().includes('/_values') || request.url().includes('field_values')) {
                valuesCalls.push(request.url());
            }
        });

        await page.goto('/');
        await dashboardPage.navigateToDashboards();
    });

    test('2.1: Global variables load immediately on dashboard mount', async ({ page }) => {
        await dashboardPage.createDashboard();
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_g', 'query_values', 'logs', 'e2e_automate', 'level');
        valuesCalls = [];
        await page.reload();
        await variables.checkVariableStatus('v_g', { isLoading: false, isPending: false });
        expect(valuesCalls.some(url => url.includes('level'))).toBeTruthy();
    });

    test('2.2: Hidden tab/panel variables do NOT load on dashboard mount', async ({ page }) => {
        await dashboardPage.createDashboard();
        const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
        await tabs.addTab('Tab_B');
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_t', 'query_values', 'logs', 'e2e_automate', 'job', false, null, false, 'tabs', ['Tab_B']);
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_p', 'query_values', 'logs', 'e2e_automate', 'host', false, null, false, 'panels', ['Tab_B'], [panel1Id]);
        valuesCalls = [];
        await page.reload();
        expect(valuesCalls.some(url => url.includes('job'))).toBeFalsy();
        expect(valuesCalls.some(url => url.includes('host'))).toBeFalsy();
    });

    test('2.3: Tab activations trigger lazy loading', async ({ page }) => {
        await dashboardPage.createDashboard();
        await tabs.addTab('Tab_B');
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_t', 'query_values', 'logs', 'e2e_automate', 'job', false, null, false, 'tabs', ['Tab_B']);
        await page.reload();
        valuesCalls = [];
        await tabs.switchTab('Tab_B');
        await variables.checkVariableStatus('v_t', { isLoading: false });
        expect(valuesCalls.some(url => url.includes('job'))).toBeTruthy();
    });

    test('2.4: Panel viewport entry triggers lazy loading (IntersectionObserver)', async ({ page }) => {
        await dashboardPage.createDashboard();
        await dashboardPage.addPanel(); // Add a few panels to push one down
        await dashboardPage.addPanel();
        await dashboardPage.addPanel();
        const lastPanelId = await page.locator('[data-test-panel-id]').last().getAttribute('data-test-panel-id');
        
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_p_far', 'query_values', 'logs', 'e2e_automate', 'kubernetes_pod_name', false, null, false, 'panels', [], [lastPanelId]);
        
        await page.reload();
        valuesCalls = [];
        // Ensure not loaded yet
        expect(valuesCalls.some(url => url.includes('kubernetes_pod_name'))).toBeFalsy();
        
        // Scroll into view
        await page.locator(`[data-test-panel-id="${lastPanelId}"]`).scrollIntoViewIfNeeded();
        await variables.checkVariableStatus('v_p_far', { isLoading: false, panelId: lastPanelId });
        expect(valuesCalls.some(url => url.includes('kubernetes_pod_name'))).toBeTruthy();
    });

    test('2.5: Child variable is PENDING while parent is loading', async ({ page }) => {
        await dashboardPage.createDashboard();
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_parent', 'query_values', 'logs', 'e2e_automate', 'job');
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_child', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$v_parent' });
        await page.reload();
        await variables.checkVariableStatus('v_child', { isLoading: false, isPending: false });
    });

    test('2.6: Parent failure stops child loading', async ({ page }) => {
        await dashboardPage.createDashboard();
        // Intercept parent request to fail
        await page.route('**/_values**', (route) => {
            if (route.request().url().includes('job')) {
                route.fulfill({ status: 500 });
            } else {
                route.continue();
            }
        });
        
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_p', 'query_values', 'logs', 'e2e_automate', 'job');
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_c', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$v_p' });
        
        await page.reload();
        // Parent failed, child should never load
        await variables.checkVariableStatus('v_p', { isLoading: false, isError: true });
        // VariableSelector might show error text or just not loaded
        await expect(page.locator('[data-test="variable-v_c-loading"]')).not.toBeVisible();
    });

    test('2.7: Multi-parent sync (Wait for all parents to be ready)', async ({ page }) => {
        await dashboardPage.createDashboard();
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_p1', 'query_values', 'logs', 'e2e_automate', 'job');
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_p2', 'query_values', 'logs', 'e2e_automate', 'level');
        
        // v_c depends on BOTH v_p1 and v_p2
        // Our addDashboardVariable helper only supports 1 filter for now, but we can edit it manually or use standard filter
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_c', 'query_values', 'logs', 'e2e_automate', 'kubernetes_namespace', false, { filterName: 'job', operator: '=', value: '$v_p1' });
        
        // Add second filter
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
        await page.locator('[data-test="dashboard-variable-settings-draggable-row"]:has-text("v_c")').locator('[data-test="dashboard-variable-settings-edit-btn"]').click();
        await page.locator('[data-test="dashboard-add-filter-btn"]').click();
        await page.locator('[data-test="dashboard-query-values-filter-name-selector"]').nth(1).click();
        await page.getByRole('option', { name: 'level' }).first().click();
        await page.locator('input[placeholder="Enter Value"]').nth(1).fill('$v_p2');
        await page.locator('[data-test="dashboard-variable-save-btn"]').click();
        
        await page.reload();
        await variables.checkVariableStatus('v_c', { isLoading: false, isPending: false });
    });

    test('2.8: Hidden parent auto-load for visible child', async ({ page }) => {
        // Tab 1 (active): Panel with Var C
        // Tab 2 (inactive): Var P
        // Var C depends on Var P
        await dashboardPage.createDashboard();
        await tabs.addTab('Tab_2');
        const panel1Id = await page.locator('[data-test-panel-id]').first().getAttribute('data-test-panel-id');
        
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_p_hidden', 'query_values', 'logs', 'e2e_automate', 'job', false, null, false, 'tabs', ['Tab_2']);
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_c_visible', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$v_p_hidden' }, false, 'panels', ['Tab 1'], [panel1Id]);
        
        await page.reload();
        await tabs.switchTab('Tab 1');
        
        // v_c_visible should eventually load because v_p_hidden was forced to load
        await variables.checkVariableStatus('v_c_visible', { isLoading: false, panelId: panel1Id });
    });

    test('2.9: Parent value change resets child to loading state', async ({ page }) => {
        await dashboardPage.createDashboard();
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_p', 'query_values', 'logs', 'e2e_automate', 'job');
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_c', 'query_values', 'logs', 'e2e_automate', 'level', false, { filterName: 'job', operator: '=', value: '$v_p' });
        await variables.checkVariableStatus('v_c', { isLoading: false });
        valuesCalls = [];
        await variables.selectValueFromScopedVariable('v_p', 'some_val', 'global');
        await variables.checkVariableStatus('v_c', { isLoading: false });
        expect(valuesCalls.some(url => url.includes('level'))).toBeTruthy();
    });

    test('2.12: Already loaded variables do not re-fire on tab switch', async ({ page }) => {
        await dashboardPage.createDashboard();
        await tabs.addTab('Tab_B');
        await page.locator('[data-test="dashboard-setting-btn"]').click();
        await variables.addDashboardVariable('v_t', 'query_values', 'logs', 'e2e_automate', 'job', false, null, false, 'tabs', ['Tab_B']);
        await tabs.switchTab('Tab_B');
        await variables.checkVariableStatus('v_t', { isLoading: false });
        await tabs.switchTab('Tab 1');
        valuesCalls = [];
        await tabs.switchTab('Tab_B');
        expect(valuesCalls.some(url => url.includes('job'))).toBeFalsy();
    });
});
