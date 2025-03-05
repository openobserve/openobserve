const { test, devices } = require('@playwright/test');
import { expect } from "./baseFixtures";
import { LoginPage } from '../pages/loginPage';
import { LogsPage } from '../pages/logsPage';
import { IngestionPage } from '../pages/ingestionPage';
import { ManagementPage } from '../pages/managementPage';
import { DashboardPage } from '../pages/dashboardPage';

// Create a function to set up the browser instances
const createBrowserInstances = () => {
    const instances = [];
    for (let i = 1; i <= 50; i++) {
        instances.push({
            name: `chrome-${i}`,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1500, height: 1024 } },
        });
    }
    return instances;
};

// Extend the base fixtures for multiple instances
const browserInstances = createBrowserInstances(); // Create 50 browser instances

test.describe.configure({ mode: 'parallel' });

test.describe("Websocket for UI Load Testing", () => {
    let loginPage, logsPage, ingestionPage, managementPage, dashboardPage;

    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        ingestionPage = new IngestionPage(page);
        logsPage = new LogsPage(page);
        managementPage = new ManagementPage(page);
        dashboardPage = new DashboardPage(page);
        
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login(); 
        await logsPage.navigateToLogs();
        await logsPage.logsPageOtlpOrg();
        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkAndEnableWebSocket();
    });

    test("Enable Websocket for running query after selecting stream, SQL Mode On and dashboard refresh", async ({ page }) => {
        await logsPage.navigateToLogs();
        await logsPage.selectStreamDefault();
        await logsPage.selectQueryDefault();
        await logsPage.enableSQLMode();
        await logsPage.selectQuery1DayTime();
        await logsPage.selectRunQuery();
        await dashboardPage.navigateToDashboards();
        await dashboardPage.navigateToDashboardFolder();
        await dashboardPage.selectQuery2DayTime();
        await dashboardPage.refreshDashboard();
        await logsPage.navigateToLogs();
        await logsPage.selectStreamDefault();
        await logsPage.selectQueryDefault();
        await logsPage.enableSQLMode();
        await logsPage.selectQuery1DayTime();
        await logsPage.selectRunQuery();

    });
});

// Export the browser instances for use in the Playwright config
export const projects = browserInstances;
// 

