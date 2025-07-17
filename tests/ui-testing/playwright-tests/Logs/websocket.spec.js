import { test, expect } from "../baseFixtures.js";
import PageManager from '../../pages/page-manager.js';

test.describe.configure({ mode: "parallel" });

test.describe("WebSocket Tests", () => {
  let pageManager;
  let loginPage;
  let ingestionPage;
  let logsPage;
  let managementPage;

  test.beforeEach(async ({ page }) => {
    pageManager = new PageManager(page);
    loginPage = pageManager.loginPage;
    ingestionPage = pageManager.ingestionPage;
    logsPage = pageManager.logsPage;
    managementPage = pageManager.managementPage;
    
    await page.goto(process.env["ZO_BASE_URL"]);
    await page.waitForTimeout(1000);
    if (await page.getByText('Login as internal user').isVisible()) {
      await page.getByText('Login as internal user').click();
    }
    await page.waitForTimeout(1000);
    await page
      .locator('[data-cy="login-user-id"]')
      .fill(process.env["ZO_ROOT_USER_EMAIL"]);
    await page.locator("label").filter({ hasText: "Password *" }).click();
    await page
      .locator('[data-cy="login-password"]')
      .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
    await page.locator('[data-cy="login-sign-in"]').click();
    await page.waitForTimeout(4000);
  });

    test.skip("Run query after selecting two streams after enabling websocket", async ({ page }) => {

        // If using CommonJS
        // const managementPage = require('../pages/managementPage');
        

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.displayTwoStreams();
        await logsPage.selectRunQuery();
     

    });

    test.skip("Enable Websocket for running query after selecting two streams and SQL Mode On", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.displayTwoStreams();
       

    });

    test.skip("Enable Websocket for running query after selecting two streams, selecting field and SQL Mode On", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerName();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.validateResult();
    

    });

    test.skip("Enable Websocket for running query after selecting two streams, SQL Mode On and entering join queries", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameJoin();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.displayCountQuery();
        await logsPage.validateResult();
       

    });

    test.skip("Enable Websocket for running query after selecting two streams, SQL Mode On and entering join limit", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameJoinLimit();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.validateResult();
      

    });

    test.skip("Enable Websocket for running query after selecting two streams, SQL Mode On and entering join like", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameJoinLike();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
       
      

    });

    test.skip("Enable Websocket for running query after selecting two streams, SQL Mode On and entering Left join queries", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameLeftJoin();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.validateResult();
    

    });

    test.skip("Enable Websocket for running query after selecting two streams, SQL Mode On and entering Right join queries", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameRightJoin();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.validateResult();
     

    });

    test.skip("Enable Websocket for running query after selecting two streams, SQL Mode On and entering Full join queries", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameFullJoin();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.validateResult();
    

    });

    test.skip("Enable Websocket for clicking on interesting field icon and display field in editor", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.enableSQLMode();
        await logsPage.clickQuickModeToggle();
        await logsPage.selectRunQuery();
        await logsPage.clickInterestingFields();
        await logsPage.validateInterestingFields();
    });

    test.skip("Enable Websocket for clicking on interesting field icon and display query in editor", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.enableSQLMode();
        await logsPage.clickQuickModeToggle();
        await logsPage.selectRunQuery();
        await logsPage.clickInterestingFields();
        await logsPage.validateInterestingFieldsQuery();
    });

    test.skip("Enable Websocket for Adding or removing interesting field removes it from editor and results too", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.enableSQLMode();
        await logsPage.clickQuickModeToggle();
        await logsPage.selectRunQuery();
        await logsPage.clickInterestingFields();
        await logsPage.addRemoveInteresting();
    });

    test.skip("Websocket enabled histogram is disabled and run query, results appear and then user switches on Historgram, getting error", async ({ page }) => {

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

    test.skip("No Histogram should be displayed if Data is not available", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexStreamDefault();
        await logsPage.enableSQLMode();
        await logsPage.clearAndFillQueryEditor('SELECT count(_timestamp)  FROM "default" where code = 201');
        await page.waitForTimeout(1000);
        await logsPage.selectRunQuery();
        await logsPage.waitForSearchResultAndCheckText('warning No data found for histogram.');
        
    });

    test.skip("Histogram should be displayed if it is enabled again and data is available", async ({ page }) => {

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
