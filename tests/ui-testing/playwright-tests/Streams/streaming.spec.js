const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: 'parallel' });

test.describe("Streaming for logs", () => {
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.streamsPage.ingestion();
        await pm.streamsPage.ingestionJoin();
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.goToManagement();
        await page.waitForTimeout(2000);
        testLogger.info('Test setup completed - ready for streaming tests');
    });

    test.afterEach(async ({}, testInfo) => {
        if (testInfo.status) {
            testLogger.testEnd(testInfo.title, testInfo.status, testInfo.duration);
        }
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
        testLogger.info('Testing streaming with two streams and SQL Mode');
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.displayTwoStreams();
    });

    test("Enable Streaming for running query after selecting two streams, selecting field and SQL Mode On", {
        tag: ['@streaming', '@sqlMode', '@all', '@streams']
    }, async ({ page }) => {
        testLogger.info('Testing streaming with two streams and field selection');
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.kubernetesContainerName();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join queries", {
        tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
    }, async ({ page }) => {
        testLogger.info('Testing streaming with join queries');
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.kubernetesContainerNameJoin();
        await pm.streamsPage.selectRunQuery();
        await pm.streamsPage.displayCountQuery();
        await pm.streamsPage.validateResult();
    });

    test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join limit", {
        tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
    }, async ({ page }) => {
        testLogger.info('Testing streaming with join limit');
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.kubernetesContainerNameJoinLimit();
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
        testLogger.info('Testing streaming with FULL JOIN queries');
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
        await pm.streamsPage.kubernetesContainerNameFullJoin();
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
        testLogger.info('Testing add/remove interesting fields');
        await pm.streamsPage.navigateToLogs();
        await pm.streamsPage.selectIndexAndStreamJoin();
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