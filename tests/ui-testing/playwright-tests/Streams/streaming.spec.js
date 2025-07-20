import { test, expect } from "../baseFixtures.js";
import PageManager from '../../pages/page-manager.js';

test.describe.configure({ mode: 'parallel' });

test.describe("Streaming for logs", () => {
    let pageManager;

    test.beforeEach(async ({ page }) => {
        pageManager = new PageManager(page);
        await pageManager.streamsPage.gotoLoginPage();
        await pageManager.streamsPage.loginAsInternalUser();
        await pageManager.streamsPage.login(); // Login as root user
        await pageManager.streamsPage.ingestion();
        await pageManager.streamsPage.ingestionJoin();
        await pageManager.streamsPage.goToManagement();
        await page.waitForTimeout(3000); // Reduced from 5000
        await pageManager.streamsPage.checkStreaming();
    });

    test("Run query after selecting two streams after enabling streaming", {
        tag: ['@streaming', '@all', '@streams']
    }, async ({ page }) => {
        await pageManager.streamsPage.navigateToLogs();
        await pageManager.streamsPage.selectIndexAndStreamJoin();
        await pageManager.streamsPage.displayTwoStreams();
        await pageManager.streamsPage.selectRunQuery();
    });

    test("Enable Streaming for running query after selecting two streams and SQL Mode On", {
        tag: ['@streaming', '@sqlMode', '@all', '@streams']
    }, async ({ page }) => {
        await pageManager.streamsPage.navigateToLogs();
        await pageManager.streamsPage.selectIndexAndStreamJoin();
       // await pageManager.streamsPage.enableSQLMode();
        await pageManager.streamsPage.selectRunQuery();
        await pageManager.streamsPage.displayTwoStreams();
    });

    test("Enable Streaming for running query after selecting two streams, selecting field and SQL Mode On", {
        tag: ['@streaming', '@sqlMode', '@all', '@streams']
    }, async ({ page }) => {
        await pageManager.streamsPage.navigateToLogs();
        await pageManager.streamsPage.selectIndexAndStreamJoin();
        await pageManager.streamsPage.kubernetesContainerName();
       // await pageManager.streamsPage.enableSQLMode();
        await pageManager.streamsPage.selectRunQuery();
        await pageManager.streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join queries", {
        tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
    }, async ({ page }) => {
        await pageManager.streamsPage.navigateToLogs();
        await pageManager.streamsPage.selectIndexAndStreamJoin();
        await pageManager.streamsPage.kubernetesContainerNameJoin();
       // await pageManager.streamsPage.enableSQLMode();
        await pageManager.streamsPage.selectRunQuery();
        await page.waitForTimeout(3000); // Wait for query results
        await pageManager.streamsPage.displayCountQuery();
        await page.waitForTimeout(3000); // Wait for query results
        await pageManager.streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join limit", {
        tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
    }, async ({ page }) => {
        await pageManager.streamsPage.navigateToLogs();
        await pageManager.streamsPage.selectIndexAndStreamJoin();
        await pageManager.streamsPage.kubernetesContainerNameJoinLimit();
       // await pageManager.streamsPage.enableSQLMode();
        await pageManager.streamsPage.selectRunQuery();
        await page.waitForTimeout(3000); // Wait for query results
        await pageManager.streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join like", {
        tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
    }, async ({ page }) => {
        await pageManager.streamsPage.navigateToLogs();
        await pageManager.streamsPage.selectIndexAndStreamJoin();
        await pageManager.streamsPage.kubernetesContainerNameJoinLike();
        await pageManager.streamsPage.enableSQLMode();
        await pageManager.streamsPage.selectRunQuery();
        await pageManager.streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Left join queries", {
        tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
    }, async ({ page }) => {
        await pageManager.streamsPage.navigateToLogs();
        await pageManager.streamsPage.selectIndexAndStreamJoin();
        await pageManager.streamsPage.kubernetesContainerNameLeftJoin();
        await pageManager.streamsPage.enableSQLMode();
        await pageManager.streamsPage.selectRunQuery();
        await pageManager.streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Right join queries", {
        tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
    }, async ({ page }) => {
        await pageManager.streamsPage.navigateToLogs();
        await pageManager.streamsPage.selectIndexAndStreamJoin();
        await pageManager.streamsPage.kubernetesContainerNameRightJoin();
        await pageManager.streamsPage.enableSQLMode();
        await pageManager.streamsPage.selectRunQuery();
        await pageManager.streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Full join queries", {
        tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
    }, async ({ page }) => {
        await pageManager.streamsPage.navigateToLogs();
        await pageManager.streamsPage.selectIndexAndStreamJoin();
        await pageManager.streamsPage.kubernetesContainerNameFullJoin();
       // await pageManager.streamsPage.enableSQLMode();
        await pageManager.streamsPage.selectRunQuery();
        await pageManager.streamsPage.validateResult();
    });

    test("Enable Streaming for clicking on interesting field icon and display field in editor", {
        tag: ['@streaming', '@interestingFields', '@all', '@streams']
    }, async ({ page }) => {
        await pageManager.streamsPage.navigateToLogs();
        await pageManager.streamsPage.selectIndexAndStreamJoin();
        await pageManager.streamsPage.enableSQLMode();
        await pageManager.streamsPage.clickQuickModeToggle();
        await pageManager.streamsPage.selectRunQuery();
        await pageManager.streamsPage.clickInterestingFields();
        await pageManager.streamsPage.validateInterestingFields();
    });

    test("Enable Streaming for clicking on interesting field icon and display query in editor", {
        tag: ['@streaming', '@interestingFields', '@all', '@streams']
    }, async ({ page }) => {
        await pageManager.streamsPage.navigateToLogs();
        await pageManager.streamsPage.selectIndexAndStreamJoin();
        await pageManager.streamsPage.enableSQLMode();
        await pageManager.streamsPage.clickQuickModeToggle();
        await pageManager.streamsPage.selectRunQuery();
        await pageManager.streamsPage.clickInterestingFields();
        await pageManager.streamsPage.validateInterestingFieldsQuery();
    });

    test("Enable Streaming for Adding or removing interesting field removes it from editor and results too", {
        tag: ['@streaming', '@interestingFields', '@all', '@streams']
    }, async ({ page }) => {
        await pageManager.streamsPage.navigateToLogs();
        await pageManager.streamsPage.selectIndexAndStreamJoin();
       // await pageManager.streamsPage.enableSQLMode();
        await pageManager.streamsPage.clickQuickModeToggle();
        await pageManager.streamsPage.selectRunQuery();
        await pageManager.streamsPage.clickInterestingFields();
        await pageManager.streamsPage.addRemoveInteresting();
    });

    test("Streaming enabled histogram is disabled and run query, results appear and then user switches on Histogram, getting error", {
        tag: ['@streaming', '@histogram', '@all', '@streams']
    }, async ({ page }) => {
        await pageManager.streamsPage.navigateToLogs();
        await pageManager.streamsPage.selectIndexStreamDefault();
        await pageManager.streamsPage.selectRunQuery();
        await pageManager.streamsPage.toggleHistogram();
        await pageManager.streamsPage.selectRunQuery();
    
        await pageManager.streamsPage.toggleHistogram();
        
        // Check that the error message is not visible
        const errorHeading = page.getByRole('heading', { name: 'Error while fetching' });
        await expect(errorHeading).not.toBeVisible();

        // Ensure that the error details button is also not visible or disabled
        const errorDetailsButton = page.locator('[data-test="logs-page-histogram-error-details-btn"]');
        await expect(errorDetailsButton).not.toBeVisible();
    });

    test("No Histogram should be displayed if Data is not available", {
        tag: ['@streaming', '@histogram', '@all', '@streams']
    }, async ({ page }) => {
        await pageManager.streamsPage.navigateToLogs();
        await pageManager.streamsPage.selectIndexStreamDefault();
        await pageManager.streamsPage.enableSQLMode();
        await pageManager.streamsPage.clearAndFillQueryEditor('SELECT count(_timestamp)  FROM "default" where code = 201');
        await page.waitForTimeout(1000);
        await pageManager.streamsPage.selectRunQuery();
        await pageManager.streamsPage.expectNoDataFoundForHistogram();
    });
}); 