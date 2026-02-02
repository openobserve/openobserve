const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: 'parallel' });

test.describe("Stream Index Type Configuration Tests", () => {
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.streamsPage.navigateToStreamExplorer();
        await page.waitForTimeout(1500);
        testLogger.info('Test setup completed - on Stream Explorer page');
    });

    test.afterEach(async ({}, testInfo) => {
        if (testInfo.status) {
            testLogger.testEnd(testInfo.title, testInfo.status, testInfo.duration);
        }
    });

    test("should check FTS and secondary index options are available", {
        tag: ['@streams', '@indexType', '@streamDetail', '@smoke', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing FTS and secondary index options availability');
        await pm.streamsPage.searchStream("e2e_automate");
        await pm.streamsPage.expectStreamExistsExact("e2e_automate");

        await pm.streamsPage.openStreamDetail("e2e_automate");
        await pm.streamsPage.searchForField("job");

        const availableOptions = await pm.streamsPage.verifyIndexTypeOptions();
        expect(availableOptions.length).toBeGreaterThan(0);
        testLogger.info('Index type options verified', { optionCount: availableOptions.length });
    });

    test("should show validation error when selecting both index types", {
        tag: ['@streams', '@indexType', '@validation', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing validation error when selecting both index types');
        await pm.streamsPage.searchStream("e2e_automate");
        await pm.streamsPage.expectStreamExistsExact("e2e_automate");

        await pm.streamsPage.openStreamDetail("e2e_automate");
        await pm.streamsPage.searchForField("level");

        // Select both index types (this should cause validation error)
        await pm.streamsPage.selectFullTextSearch();
        await pm.streamsPage.selectSecondaryIndex();
        await pm.streamsPage.clickUpdateSettingsButton();

        // STRICT ASSERTION: Verify validation error appears
        await pm.streamsPage.expectValidationErrorVisible();
        testLogger.info('Validation error correctly displayed');
    });

    test.skip("should select and delete extended retention period date", {
        tag: ['@streams', '@extendedRetention', '@dateSelection', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing extended retention period date selection and deletion');
        await pm.streamsPage.searchStream("e2e_automate");
        await pm.streamsPage.expectStreamExistsExact("e2e_automate");

        // Navigate to extended retention settings using POM
        await pm.streamsPage.navigateToExtendedRetention();

        // Select date range for current month using POM
        const dateRangeText = await pm.streamsPage.selectDateRangeForCurrentMonth();

        // Delete the retention period using POM
        await pm.streamsPage.deleteRetentionPeriod(dateRangeText);

        // Verify success message using POM
        await pm.streamsPage.expectStreamSettingsUpdatedMessage();
        testLogger.info('Extended retention period test completed');
    });
});