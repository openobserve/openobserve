import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { LogsPage } from '../pages/logsPage.js';
import { IngestionPage } from '../pages/ingestionPage.js';
import { ManagementPage } from '../pages/managementPage.js';



test.describe.configure({ mode: 'parallel' });

test.describe("Pagination for logs", () => {
    let loginPage, logsPage, ingestionPage, managementPage;

    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        ingestionPage = new IngestionPage(page);
        logsPage = new LogsPage(page);
        managementPage = new ManagementPage(page);
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login(); // Login as root user
        await ingestionPage.ingestionJoin();
        
    });

    test("Enable Streaming for running query to validate match_all('ziox')", async ({ page }) => {

        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkStreaming();
        await logsPage.navigateToLogs();
        await logsPage.selectIndexStreamDefault();
        await logsPage.clearAndFillQueryEditor('SELECT * FROM "default" WHERE match_all("ziox")');
        await logsPage.selectRunQuery();
        await logsPage.validateResult();

    });

    test("Enable Streaming for running query to validate match_all('zio*')", async ({ page }) => {

        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkStreaming();
        await logsPage.navigateToLogs();
        await logsPage.selectIndexStreamDefault();
        await logsPage.clearAndFillQueryEditor('SELECT * FROM "default" WHERE match_all("zio*")');
        await logsPage.selectRunQuery();
        await logsPage.validateResult();

    });

    test("Enable Streaming for running query to validate match_all('us*')", async ({ page }) => {

        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkStreaming();
        await logsPage.navigateToLogs();
        await logsPage.selectIndexStreamDefault();
        await logsPage.clearAndFillQueryEditor('SELECT * FROM "default" WHERE match_all("us*")');
        await logsPage.selectRunQuery();
        await logsPage.validateResult();

    });

    test("Enable Streaming for running query to validatematch_all('ip-10-2-15-197.us-east-2.co*')", async ({ page }) => {

        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkStreaming();
        await logsPage.navigateToLogs();
        await logsPage.selectIndexStreamDefault();
        await logsPage.clearAndFillQueryEditor('SELECT * FROM "default" WHERE match_all("ip-10-2-15-197.us-east-2.co*")');
        await logsPage.selectRunQuery();
        await logsPage.validateResult();

    });


   
});
