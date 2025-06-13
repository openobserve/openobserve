import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { LogsPage } from '../pages/logsPage.js';
import { IngestionPage } from '../pages/ingestionPage.js';
import { ManagementPage } from '../pages/managementPage.js';



test.describe.configure({ mode: 'parallel' });

test.describe("Streaming for logs", () => {
    let loginPage, logsPage, ingestionPage, managementPage;

    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        ingestionPage = new IngestionPage(page);
        logsPage = new LogsPage(page);
        managementPage = new ManagementPage(page);
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login(); // Login as root user
        await ingestionPage.ingestion();
        await ingestionPage.ingestionJoin();
        await managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await managementPage.checkStreaming();
    });

    test("Run query after selecting two streams after enabling streaming", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.displayTwoStreams();
        await logsPage.selectRunQuery();
     

    });

    test("Enable Streaming for running query after selecting two streams and SQL Mode On", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
       // await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.displayTwoStreams();
       

    });

    test("Enable Streaming for running query after selecting two streams, selecting field and SQL Mode On", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerName();
       // await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.validateResult();
    

    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join queries", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameJoin();
       // await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.displayCountQuery();
        await logsPage.validateResult();
       

    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join limit", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameJoinLimit();
       // await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.validateResult();
      

    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join like", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameJoinLike();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.validateResult();
       
      

    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Left join queries", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameLeftJoin();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.validateResult();
    

    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Right join queries", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameRightJoin();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.validateResult();
     

    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Full join queries", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameFullJoin();
       // await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.validateResult();
    

    });

    test("Enable Streaming for clicking on interesting field icon and display field in editor", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.enableSQLMode();
        await logsPage.clickQuickModeToggle();
        await logsPage.selectRunQuery();
        await logsPage.clickInterestingFields();
        await logsPage.validateInterestingFields();
    });

    test("Enable Streaming for clicking on interesting field icon and display query in editor", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.enableSQLMode();
        await logsPage.clickQuickModeToggle();
        await logsPage.selectRunQuery();
        await logsPage.clickInterestingFields();
        await logsPage.validateInterestingFieldsQuery();
    });

    test("Enable Streaming for Adding or removing interesting field removes it from editor and results too", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
       // await logsPage.enableSQLMode();
        await logsPage.clickQuickModeToggle();
        await logsPage.selectRunQuery();
        await logsPage.clickInterestingFields();
        await logsPage.addRemoveInteresting();
    });

    test("Streaming enabled histogram is disabled and run query, results appear and then user switches on Histogram, getting error", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexStreamDefault();
        await logsPage.selectRunQuery();
        await logsPage.toggleHistogram();
        await logsPage.selectRunQuery();
    
        await logsPage.toggleHistogram();
        
        // Check that the error message is not visible
        const errorHeading = page.getByRole('heading', { name: 'Error while fetching' });
        await expect(errorHeading).not.toBeVisible();

        // Ensure that the error details button is also not visible or disabled
        const errorDetailsButton = page.locator('[data-test="logs-page-histogram-error-details-btn"]');
        await expect(errorDetailsButton).not.toBeVisible();


    });

    test("No Histogram should be displayed if Data is not available", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexStreamDefault();
        await logsPage.enableSQLMode();
        await logsPage.clearAndFillQueryEditor('SELECT count(_timestamp)  FROM "default" where code = 201');
        await page.waitForTimeout(1000);
        await logsPage.selectRunQuery();
        await logsPage.waitForSearchResultAndCheckText('warning No data found for histogram.');
        
    });

    test("Histogram should be displayed if it is enabled again and data is available", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexStreamDefault();
        await logsPage.enableSQLMode();
        await logsPage.clearAndFillQueryEditor('SELECT count(_timestamp)  FROM "default" where code = 200');
        await page.waitForTimeout(1000);
        await logsPage.selectRunQuery();
        await expect(page.locator('[data-test="logs-search-result-bar-chart"] canvas')).toBeVisible();
        await logsPage.toggleHistogram();
        await logsPage.selectRunQuery();
        await expect(page.locator('[data-test="logs-search-result-bar-chart"] canvas')).not.toBeVisible();
        await logsPage.toggleHistogram();
        await logsPage.selectRunQuery();
        await expect(page.locator('[data-test="logs-search-result-bar-chart"] canvas')).toBeVisible();
        
    });

});
