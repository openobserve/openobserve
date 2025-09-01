const { test, expect } = require('../utils/enhanced-baseFixtures.js');
import { PageManager } from '../../pages/page-manager.js';

test.describe.configure({ mode: 'parallel' });

test.describe("Streaming for logs", () => {
    let pm;

    test.beforeEach(async ({ page }) => {
        pm = new PageManager(page);
        await pm.streamsPage.ingestion();
        await pm.streamsPage.ingestionJoin();
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.goToManagement();
        await page.waitForTimeout(3000);
        await pm.streamsPage.checkStreaming();
    });

    test("Run query after selecting two streams after enabling streaming", {
        tag: ['@streaming', '@all', '@streams']
    }, async ({ page }) => {
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.displayTwoStreams();
        await pm.streamsPage.selectRunQuery();
    });

    test("Enable Streaming for running query after selecting two streams and SQL Mode On", {
        tag: ['@streaming', '@sqlMode', '@all', '@streams']
    }, async ({ page }) => {
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
       // await pm.streamsPage.enableSQLMode();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.displayTwoStreams();
    });

    test("Enable Streaming for running query after selecting two streams, selecting field and SQL Mode On", {
        tag: ['@streaming', '@sqlMode', '@all', '@streams']
    }, async ({ page }) => {
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.kubernetesContainerName();
       // await pm.streamsPage.enableSQLMode();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join queries", {
        tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
    }, async ({ page }) => {
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.kubernetesContainerNameJoin();
       // await pm.streamsPage.enableSQLMode();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.displayCountQuery();
        await pm.streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join limit", {
        tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
    }, async ({ page }) => {
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.kubernetesContainerNameJoinLimit();
       // await pm.streamsPage.enableSQLMode();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join like", {
        tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
    }, async ({ page }) => {
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.kubernetesContainerNameJoinLike();
        await pm.streamsPage.enableSQLMode();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Left join queries", {
        tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
    }, async ({ page }) => {
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.kubernetesContainerNameLeftJoin();
        await pm.streamsPage.enableSQLMode();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Right join queries", {
        tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
    }, async ({ page }) => {
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.kubernetesContainerNameRightJoin();
        await pm.streamsPage.enableSQLMode();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Full join queries", {
        tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
    }, async ({ page }) => {
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.kubernetesContainerNameFullJoin();
       // await pm.streamsPage.enableSQLMode();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.validateResult();
    });

    test("Enable Streaming for clicking on interesting field icon and display field in editor", {
        tag: ['@streaming', '@interestingFields', '@all', '@streams']
    }, async ({ page }) => {
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.enableSQLMode();
        await pm.streamsPage.clickQuickModeToggle();
        await pm.streamsPage.clickAllFieldsButton();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.clickInterestingFields();
        await pm.streamsPage.validateInterestingFields();
    });

    test("Enable Streaming for clicking on interesting field icon and display query in editor", {
        tag: ['@streaming', '@interestingFields', '@all', '@streams']
    }, async ({ page }) => {
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.enableSQLMode();
        await pm.streamsPage.clickQuickModeToggle();
        await pm.streamsPage.clickAllFieldsButton();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.clickInterestingFields();
        await pm.streamsPage.validateInterestingFieldsQuery();
    });

    test("Enable Streaming for Adding or removing interesting field removes it from editor and results too", {
        tag: ['@streaming', '@interestingFields', '@all', '@streams']
    }, async ({ page }) => {
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
       // await pm.streamsPage.enableSQLMode();
        await pm.streamsPage.clickQuickModeToggle();
        await pm.streamsPage.clickAllFieldsButton();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.clickInterestingFields();
        await pm.streamsPage.addRemoveInteresting();
    });

    test("Streaming enabled histogram is disabled and run query, results appear and then user switches on Histogram, getting error", {
        tag: ['@streaming', '@histogram', '@all', '@streams']
    }, async ({ page }) => {
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexStreamDefault();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.toggleHistogram();
        await pm.streamsPage.selectRunQuery();
    
        await pm.streamsPage.toggleHistogram();
        
        await pm.streamsPage.verifyNoHistogramError();
    });

    test("No Histogram should be displayed if Data is not available", {
        tag: ['@streaming', '@histogram', '@all', '@streams']
    }, async ({ page }) => {
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexStreamDefault();
        await pm.streamsPage.enableSQLMode();
        await pm.streamsPage.clearAndFillQueryEditor('SELECT count(_timestamp)  FROM "default" where code = 201');
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.expectNoDataFoundForHistogram();
    });
}); 