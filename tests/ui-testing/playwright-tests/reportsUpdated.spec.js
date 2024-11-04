import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/loginPage';
import { DashboardPage} from '../pages/dashboardPage';
import { ReportsPage} from '../pages/reportsPage';
import { IngestionPage } from '../pages/ingestionPage';


test.describe("Report test cases Updated", () => {
    let loginPage, dashboardPage, reportsPage, ingestionPage;

    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        ingestionPage = new  IngestionPage(page);
        dashboardPage = new DashboardPage(page);
        reportsPage = new ReportsPage(page);

        await loginPage.gotoLoginPage();
        await loginPage.login();
        await page.waitForTimeout(5000);
        await ingestionPage.ingestion();

    });

    test("Create, use, and delete dashboard and report", async ({ page }) => {
        await dashboardPage.navigateToDashboards();
        await dashboardPage.createDashboard();
       
       

    await page.goto(process.env["ZO_BASE_URL"] + "/web/reports");

        // await reportsPage.navigateToReports();
        await reportsPage.createReport(dashboardPage.dashboardName);
        await page.goto(process.env["ZO_BASE_URL"] + "/web/reports");
       
        await reportsPage.deleteReport("rreport1");
        await dashboardPage.navigateToDashboards();
        await dashboardPage.deleteDashboard();
    });
});
