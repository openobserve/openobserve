import { test, expect } from "../baseFixtures.js";
import PageManager from '../../pages/page-manager.js';

test.describe.configure({ mode: 'parallel' });

test.describe("Websocket for logs", () => {
    let pageManager;

    test.beforeEach(async ({ page }) => {
        pageManager = new PageManager(page);
        await pageManager.loginPage.gotoLoginPage();
        await pageManager.loginPage.loginAsInternalUser();
        await pageManager.loginPage.login(); // Login as root user
        await pageManager.ingestionPage.ingestion();
        await pageManager.ingestionPage.ingestionJoin();
        await pageManager.managementPage.goToManagement();
        await page.waitForTimeout(5000);
        await pageManager.managementPage.checkAndEnableWebSocket();
    });

    test.skip("Run query after selecting two streams after enabling websocket", async ({ page }) => {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexAndStreamJoin();
        await pageManager.logsPage.displayTwoStreams();
        await pageManager.logsPage.selectRunQuery();
    });

    test.skip("Enable Websocket for running query after selecting two streams and SQL Mode On", async ({ page }) => {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexAndStreamJoin();
        await pageManager.logsPage.enableSQLMode();
        await pageManager.logsPage.selectRunQuery();
        await pageManager.logsPage.displayTwoStreams();
    });

    test.skip("Enable Websocket for running query after selecting two streams, selecting field and SQL Mode On", async ({ page }) => {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexAndStreamJoin();
        await pageManager.logsPage.kubernetesContainerName();
        await pageManager.logsPage.enableSQLMode();
        await pageManager.logsPage.selectRunQuery();
        await pageManager.logsPage.validateResult();
    });

    test.skip("Enable Websocket for running query after selecting two streams, SQL Mode On and entering join queries", async ({ page }) => {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexAndStreamJoin();
        await pageManager.logsPage.kubernetesContainerNameJoin();
        await pageManager.logsPage.enableSQLMode();
        await pageManager.logsPage.selectRunQuery();
        await pageManager.logsPage.displayCountQuery();
        await pageManager.logsPage.validateResult();
    });

    test.skip("Enable Websocket for running query after selecting two streams, SQL Mode On and entering join limit", async ({ page }) => {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexAndStreamJoin();
        await pageManager.logsPage.kubernetesContainerNameJoinLimit();
        await pageManager.logsPage.enableSQLMode();
        await pageManager.logsPage.selectRunQuery();
        await pageManager.logsPage.validateResult();
    });

    test.skip("Enable Websocket for running query after selecting two streams, SQL Mode On and entering join like", async ({ page }) => {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexAndStreamJoin();
        await pageManager.logsPage.kubernetesContainerNameJoinLike();
        await pageManager.logsPage.enableSQLMode();
        await pageManager.logsPage.selectRunQuery();
    });

    test.skip("Enable Websocket for running query after selecting two streams, SQL Mode On and entering Left join queries", async ({ page }) => {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexAndStreamJoin();
        await pageManager.logsPage.kubernetesContainerNameLeftJoin();
        await pageManager.logsPage.enableSQLMode();
        await pageManager.logsPage.selectRunQuery();
        await pageManager.logsPage.validateResult();
    });

    test.skip("Enable Websocket for running query after selecting two streams, SQL Mode On and entering Right join queries", async ({ page }) => {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexAndStreamJoin();
        await pageManager.logsPage.kubernetesContainerNameRightJoin();
        await pageManager.logsPage.enableSQLMode();
        await pageManager.logsPage.selectRunQuery();
        await pageManager.logsPage.validateResult();
    });

    test.skip("Enable Websocket for running query after selecting two streams, SQL Mode On and entering Full join queries", async ({ page }) => {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexAndStreamJoin();
        await pageManager.logsPage.kubernetesContainerNameFullJoin();
        await pageManager.logsPage.enableSQLMode();
        await pageManager.logsPage.selectRunQuery();
        await pageManager.logsPage.validateResult();
    });

    test.skip("Enable Websocket for clicking on interesting field icon and display field in editor", async ({ page }) => {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexAndStreamJoin();
        await pageManager.logsPage.enableSQLMode();
        await pageManager.logsPage.clickQuickModeToggle();
        await pageManager.logsPage.selectRunQuery();
        await pageManager.logsPage.clickInterestingFields();
        await pageManager.logsPage.validateInterestingFields();
    });

    test.skip("Enable Websocket for clicking on interesting field icon and display query in editor", async ({ page }) => {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexAndStreamJoin();
        await pageManager.logsPage.enableSQLMode();
        await pageManager.logsPage.clickQuickModeToggle();
        await pageManager.logsPage.selectRunQuery();
        await pageManager.logsPage.clickInterestingFields();
        await pageManager.logsPage.validateInterestingFieldsQuery();
    });

    test.skip("Enable Websocket for Adding or removing interesting field removes it from editor and results too", async ({ page }) => {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexAndStreamJoin();
        await pageManager.logsPage.enableSQLMode();
        await pageManager.logsPage.clickQuickModeToggle();
        await pageManager.logsPage.selectRunQuery();
        await pageManager.logsPage.clickInterestingFields();
        await pageManager.logsPage.addRemoveInteresting();
    });

    test.skip("Websocket enabled histogram is disabled and run query, results appear and then user switches on Historgram, getting error", async ({ page }) => {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.selectIndexStreamDefault();
        await pageManager.logsPage.selectRunQuery();
        await pageManager.logsPage.toggleHistogram();
        await pageManager.logsPage.selectRunQuery();
    
        await pageManager.logsPage.toggleHistogram();
        
        // Check that the error message is not visible
        const errorHeading = page.getByRole('heading', { name: 'Error while fetching' });
        await expect(errorHeading).not.toBeVisible();

        // Ensure that the error details button is also not visible or disabled
        const errorDetailsButton = page.locator('[data-test="logs-page-histogram-error-details-btn"]');
        await expect(errorDetailsButton).not.toBeVisible();
    });
});
