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
    for (let i = 1; i <=100; i++) {
        instances.push({
            name: `chrome-${i}`,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1500, height: 1024 } },
        });
    }
    return instances;
};

// Extend the base fixtures for multiple instances
const browserInstances = createBrowserInstances(); // Create 50 browser instances

// Helper function to generate a random alphanumeric string
function generateRandomString(length) {
    const characters = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }
    return result;
}

async function createUser(page, email, password) {
    const orgId = process.env["ORGNAME"];
    const url = `${process.env["ZO_BASE_URL"]}/api/${orgId}/users`;
    const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');
    const headers = {
      "Authorization": `Basic Z29kQG1haW4uYWk6S2luZ3BpbiM0NTE=`,
      "Content-Type": "application/json",
    };

    const payload = {
      organization: orgId,
      email: email,
      password: password,
      first_name: "Shyam",
      last_name: "P",
      role: "admin",
    };  

    const response = await page.request.post(url, {
      data: payload,
      headers: headers,
    });
    console.log(basicAuthCredentials);
    console.log(process.env["ZO_ROOT_USER_EMAIL"]);
    console.log(process.env["ZO_ROOT_USER_PASSWORD"]);
    console.log(headers);

    console.log(`created user: ${email}`);
    console.log(orgId);
    console.log(url);
    console.log(response.status());
    console.log(response.body());
    console.log(payload);
    if (response.status() !== 200) {
        throw new Error(`Failed to create user ${email}. Status: ${response.status()}`);
    }

    console.log(`Successfully created user: ${email}`); 

    return response;
}


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
    });

    for (let i = 1; i <= 100; i++) {
        test(`Enable Websocket for running query after selecting stream, SQL Mode On and dashboard refresh: User ${i}`, async ({ page }) => {
            const randomEmail = `${generateRandomString(7)}admin${i}@gmail.com`; // Generate random email for login
            const randomPassword = `${generateRandomString(7)}12345678`;
            await createUser(page, randomEmail, randomPassword); // Pass page as an argument
            console.log(`Created user: ${randomEmail}`);
            console.log(`Created password: ${randomPassword}`);
            await page.waitForTimeout(10000); // Wait for user creation to propagate

            await loginPage.loginMultipleUsers(randomEmail, randomPassword);
            console.log(`Logged in user: ${randomEmail}`);
            await page.waitForTimeout(5000); // Wait for login to complete
            // await logsPage.logsPageOtlpOrg();
            await logsPage.navigateToLogs();
            
            await managementPage.goToManagement();
            await page.waitForTimeout(5000); // Wait for management page to load

            await managementPage.checkAndEnableWebSocket();
            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();

            await logsPage.selectQuery4DaysTime();

            await logsPage.selectRunQuery();
            await expect(page.locator('[data-test="logs-search-bar-refresh-btn"]')).toBeVisible();

            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
            await dashboardPage.selectQuery4DayTime();

            await dashboardPage.refreshDashboard();
            await expect(page.locator('[data-test="dashboard-refresh-btn"]')).toBeVisible();

            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);
            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();
            await logsPage.selectQuery4DaysTime();
            await logsPage.selectRunQuery();
            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
            
            await dashboardPage.selectQuery4DayTime();
            await dashboardPage.refreshDashboard();
            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);

            // 2nd times

            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();

            await logsPage.selectQuery4DaysTime();

            await logsPage.selectRunQuery();
            await expect(page.locator('[data-test="logs-search-bar-refresh-btn"]')).toBeVisible();

            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
           
            await dashboardPage.selectQuery4DayTime();

            await dashboardPage.refreshDashboard();
            await expect(page.locator('[data-test="dashboard-refresh-btn"]')).toBeVisible();

            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);
            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();
            await logsPage.selectQuery4DaysTime();
            await logsPage.selectRunQuery();
            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
          
            await dashboardPage.selectQuery4DayTime();
            await dashboardPage.refreshDashboard();
            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);

            // 3rd times

            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();

            await logsPage.selectQuery4DaysTime();

            await logsPage.selectRunQuery();
            await expect(page.locator('[data-test="logs-search-bar-refresh-btn"]')).toBeVisible();

            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
           
            await dashboardPage.selectQuery4DayTime();

            await dashboardPage.refreshDashboard();
            await expect(page.locator('[data-test="dashboard-refresh-btn"]')).toBeVisible();

            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);
            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();
            await logsPage.selectQuery4DaysTime();
            await logsPage.selectRunQuery();
            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
          
            await dashboardPage.selectQuery4DayTime();
            await dashboardPage.refreshDashboard();
            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);

            // 4th times

            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();

            await logsPage.selectQuery4DaysTime();

            await logsPage.selectRunQuery();
            await expect(page.locator('[data-test="logs-search-bar-refresh-btn"]')).toBeVisible();

            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
           
            await dashboardPage.selectQuery4DayTime();

            await dashboardPage.refreshDashboard();
            await expect(page.locator('[data-test="dashboard-refresh-btn"]')).toBeVisible();

            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);
            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();
            await logsPage.selectQuery4DaysTime();
            await logsPage.selectRunQuery();
            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
          
            await dashboardPage.selectQuery4DayTime();
            await dashboardPage.refreshDashboard();
            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);

            // 5th times

            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();

            await logsPage.selectQuery4DaysTime();

            await logsPage.selectRunQuery();
            await expect(page.locator('[data-test="logs-search-bar-refresh-btn"]')).toBeVisible();

            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
           
            await dashboardPage.selectQuery4DayTime();

            await dashboardPage.refreshDashboard();
            await expect(page.locator('[data-test="dashboard-refresh-btn"]')).toBeVisible();

            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);
            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();
            await logsPage.selectQuery4DaysTime();
            await logsPage.selectRunQuery();
            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
          
            await dashboardPage.selectQuery4DayTime();
            await dashboardPage.refreshDashboard();
            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);

            // 6th times

            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();

            await logsPage.selectQuery4DaysTime();

            await logsPage.selectRunQuery();
            await expect(page.locator('[data-test="logs-search-bar-refresh-btn"]')).toBeVisible();

            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
           
            await dashboardPage.selectQuery4DayTime();

            await dashboardPage.refreshDashboard();
            await expect(page.locator('[data-test="dashboard-refresh-btn"]')).toBeVisible();

            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);
            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();
            await logsPage.selectQuery4DaysTime();
            await logsPage.selectRunQuery();
            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
          
            await dashboardPage.selectQuery4DayTime();
            await dashboardPage.refreshDashboard();
            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);

            // 7th times

            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();

            await logsPage.selectQuery4DaysTime();

            await logsPage.selectRunQuery();
            await expect(page.locator('[data-test="logs-search-bar-refresh-btn"]')).toBeVisible();

            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
           
            await dashboardPage.selectQuery4DayTime();

            await dashboardPage.refreshDashboard();
            await expect(page.locator('[data-test="dashboard-refresh-btn"]')).toBeVisible();

            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);
            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();
            await logsPage.selectQuery4DaysTime();
            await logsPage.selectRunQuery();
            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
          
            await dashboardPage.selectQuery4DayTime();
            await dashboardPage.refreshDashboard();
            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);

            // 8th times

            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();

            await logsPage.selectQuery4DaysTime();

            await logsPage.selectRunQuery();
            await expect(page.locator('[data-test="logs-search-bar-refresh-btn"]')).toBeVisible();

            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
           
            await dashboardPage.selectQuery4DayTime();

            await dashboardPage.refreshDashboard();
            await expect(page.locator('[data-test="dashboard-refresh-btn"]')).toBeVisible();

            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);
            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();
            await logsPage.selectQuery4DaysTime();
            await logsPage.selectRunQuery();
            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
          
            await dashboardPage.selectQuery4DayTime();
            await dashboardPage.refreshDashboard();
            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);

            // 9th times

            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();

            await logsPage.selectQuery4DaysTime();

            await logsPage.selectRunQuery();
            await expect(page.locator('[data-test="logs-search-bar-refresh-btn"]')).toBeVisible();

            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
           
            await dashboardPage.selectQuery4DayTime();

            await dashboardPage.refreshDashboard();
            await expect(page.locator('[data-test="dashboard-refresh-btn"]')).toBeVisible();

            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);
            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();
            await logsPage.selectQuery4DaysTime();
            await logsPage.selectRunQuery();
            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
          
            await dashboardPage.selectQuery4DayTime();
            await dashboardPage.refreshDashboard();
            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);

            // 10th times

            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();

            await logsPage.selectQuery4DaysTime();

            await logsPage.selectRunQuery();
            await expect(page.locator('[data-test="logs-search-bar-refresh-btn"]')).toBeVisible();

            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
           
            await dashboardPage.selectQuery4DayTime();

            await dashboardPage.refreshDashboard();
            await expect(page.locator('[data-test="dashboard-refresh-btn"]')).toBeVisible();

            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);
            await logsPage.navigateToLogs();
            await logsPage.selectStreamDefault();
            await logsPage.selectQueryDefault();
            await logsPage.enableSQLMode();
            await logsPage.selectQuery4DaysTime();
            await logsPage.selectRunQuery();
            await dashboardPage.navigateToDashboards();
            await dashboardPage.navigateToDashboardFolder();
          
            await dashboardPage.selectQuery4DayTime();
            await dashboardPage.refreshDashboard();
            await page.locator('[data-test="menu-link-\\/streams-item"]').click();
            await page.waitForTimeout(5000);
            await page.getByRole('row', { name: '03 default logs' }).getByRole('button').first().click();
            await page.waitForTimeout(5000);
            

        });
    }
});

// Export the browser instances for use in the Playwright config
export const projects = browserInstances;
// 

