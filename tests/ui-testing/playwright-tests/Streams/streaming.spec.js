import { test, expect } from "../baseFixtures.js";
import { StreamsPage } from '../../pages/streamsPages/streamsPage.js';

test.describe.configure({ mode: 'parallel' });

test.describe("Streaming for logs", () => {
    let streamsPage;

    test.beforeEach(async ({ page }) => {
        streamsPage = new StreamsPage(page);
        await streamsPage.gotoLoginPage();
        await streamsPage.loginAsInternalUser();
        await streamsPage.login(); // Login as root user
        await streamsPage.ingestion();
        await streamsPage.ingestionJoin();
        await streamsPage.goToManagement();
        await page.waitForTimeout(5000);
        await streamsPage.checkStreaming();
    });

    test("Run query after selecting two streams after enabling streaming", async ({ page }) => {
        await streamsPage.navigateToLogs();
        await streamsPage.selectIndexAndStreamJoin();
        await streamsPage.displayTwoStreams();
        await streamsPage.selectRunQuery();
    });

    test("Enable Streaming for running query after selecting two streams and SQL Mode On", async ({ page }) => {
        await streamsPage.navigateToLogs();
        await streamsPage.selectIndexAndStreamJoin();
       // await streamsPage.enableSQLMode();
        await streamsPage.selectRunQuery();
        await streamsPage.displayTwoStreams();
    });

    test("Enable Streaming for running query after selecting two streams, selecting field and SQL Mode On", async ({ page }) => {
        await streamsPage.navigateToLogs();
        await streamsPage.selectIndexAndStreamJoin();
        await streamsPage.kubernetesContainerName();
       // await streamsPage.enableSQLMode();
        await streamsPage.selectRunQuery();
        await streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join queries", async ({ page }) => {
        await streamsPage.navigateToLogs();
        await streamsPage.selectIndexAndStreamJoin();
        await streamsPage.kubernetesContainerNameJoin();
       // await streamsPage.enableSQLMode();
        await streamsPage.selectRunQuery();
        await streamsPage.displayCountQuery();
        await streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join limit", async ({ page }) => {
        await streamsPage.navigateToLogs();
        await streamsPage.selectIndexAndStreamJoin();
        await streamsPage.kubernetesContainerNameJoinLimit();
       // await streamsPage.enableSQLMode();
        await streamsPage.selectRunQuery();
        await streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join like", async ({ page }) => {
        await streamsPage.navigateToLogs();
        await streamsPage.selectIndexAndStreamJoin();
        await streamsPage.kubernetesContainerNameJoinLike();
        await streamsPage.enableSQLMode();
        await streamsPage.selectRunQuery();
        await streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Left join queries", async ({ page }) => {
        await streamsPage.navigateToLogs();
        await streamsPage.selectIndexAndStreamJoin();
        await streamsPage.kubernetesContainerNameLeftJoin();
        await streamsPage.enableSQLMode();
        await streamsPage.selectRunQuery();
        await streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Right join queries", async ({ page }) => {
        await streamsPage.navigateToLogs();
        await streamsPage.selectIndexAndStreamJoin();
        await streamsPage.kubernetesContainerNameRightJoin();
        await streamsPage.enableSQLMode();
        await streamsPage.selectRunQuery();
        await streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Full join queries", async ({ page }) => {
        await streamsPage.navigateToLogs();
        await streamsPage.selectIndexAndStreamJoin();
        await streamsPage.kubernetesContainerNameFullJoin();
       // await streamsPage.enableSQLMode();
        await streamsPage.selectRunQuery();
        await streamsPage.validateResult();
    });

    test("Enable Streaming for clicking on interesting field icon and display field in editor", async ({ page }) => {
        await streamsPage.navigateToLogs();
        await streamsPage.selectIndexAndStreamJoin();
        await streamsPage.enableSQLMode();
        await streamsPage.clickQuickModeToggle();
        await streamsPage.selectRunQuery();
        await streamsPage.clickInterestingFields();
        await streamsPage.validateInterestingFields();
    });

    test("Enable Streaming for clicking on interesting field icon and display query in editor", async ({ page }) => {
        await streamsPage.navigateToLogs();
        await streamsPage.selectIndexAndStreamJoin();
        await streamsPage.enableSQLMode();
        await streamsPage.clickQuickModeToggle();
        await streamsPage.selectRunQuery();
        await streamsPage.clickInterestingFields();
        await streamsPage.validateInterestingFieldsQuery();
    });

    test("Enable Streaming for Adding or removing interesting field removes it from editor and results too", async ({ page }) => {
        await streamsPage.navigateToLogs();
        await streamsPage.selectIndexAndStreamJoin();
       // await streamsPage.enableSQLMode();
        await streamsPage.clickQuickModeToggle();
        await streamsPage.selectRunQuery();
        await streamsPage.clickInterestingFields();
        await streamsPage.addRemoveInteresting();
    });

    test("Streaming enabled histogram is disabled and run query, results appear and then user switches on Histogram, getting error", async ({ page }) => {
        await streamsPage.navigateToLogs();
        await streamsPage.selectIndexStreamDefault();
        await streamsPage.selectRunQuery();
        await streamsPage.toggleHistogram();
        await streamsPage.selectRunQuery();
    
        await streamsPage.toggleHistogram();
        
        // Check that the error message is not visible
        const errorHeading = page.getByRole('heading', { name: 'Error while fetching' });
        await expect(errorHeading).not.toBeVisible();

        // Ensure that the error details button is also not visible or disabled
        const errorDetailsButton = page.locator('[data-test="logs-page-histogram-error-details-btn"]');
        await expect(errorDetailsButton).not.toBeVisible();
    });

    test("No Histogram should be displayed if Data is not available", async ({ page }) => {
        await streamsPage.navigateToLogs();
        await streamsPage.selectIndexStreamDefault();
        await streamsPage.enableSQLMode();
        await streamsPage.clearAndFillQueryEditor('SELECT count(_timestamp)  FROM "default" where code = 201');
        await page.waitForTimeout(1000);
        await streamsPage.selectRunQuery();
        await streamsPage.waitForSearchResultAndCheckText('warning No data found for histogram.');
    });
}); 