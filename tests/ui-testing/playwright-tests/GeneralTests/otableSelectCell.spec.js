const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("OTable Select Cell Click Selection testcases", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await pm.modelPricingPage.gotoModelPricingPage();
        await pm.modelPricingPage.switchToAllTab();
        await pm.modelPricingPage.waitForFirstRowSelectCell();
        testLogger.info('Test setup completed');
    });

    test("selects then deselects a row by clicking the select-cell padding", {
        tag: ['@otable-select-cell', '@selection', '@P0', '@all'],
    }, async () => {
        testLogger.info('Assert the first row is initially unselected');
        await pm.modelPricingPage.expectFirstRowCheckboxUnchecked();
        await pm.modelPricingPage.expectExportSelectedBtnHidden();

        testLogger.info('Click the select-cell padding to select the first row');
        await pm.modelPricingPage.clickFirstRowSelectCellPadding();
        await pm.modelPricingPage.expectFirstRowCheckboxChecked();
        await pm.modelPricingPage.expectExportSelectedBtnVisible();

        testLogger.info('Click the same padding again to deselect the first row');
        await pm.modelPricingPage.clickFirstRowSelectCellPadding();
        await pm.modelPricingPage.expectFirstRowCheckboxUnchecked();
        await pm.modelPricingPage.expectExportSelectedBtnHidden();

        testLogger.info('Test completed');
    });

    test("selects all then deselects all rows via the header select-cell padding", {
        tag: ['@otable-select-cell', '@selection', '@selectAll', '@P0', '@all'],
    }, async () => {
        testLogger.info('Assert no rows are selected before the header cell click');
        await pm.modelPricingPage.expectSelectAllCheckboxUnchecked();
        await pm.modelPricingPage.expectExportSelectedBtnHidden();

        testLogger.info('Click the header select-cell padding to select all rows');
        await pm.modelPricingPage.clickSelectAllCellPadding();
        await pm.modelPricingPage.expectSelectAllCheckboxChecked();
        await pm.modelPricingPage.expectAllVisibleRowsSelected();
        await pm.modelPricingPage.expectExportSelectedBtnVisible();

        testLogger.info('Click the header padding again to deselect all rows');
        await pm.modelPricingPage.clickSelectAllCellPadding();
        await pm.modelPricingPage.expectSelectAllCheckboxUnchecked();
        await pm.modelPricingPage.expectExportSelectedBtnHidden();

        testLogger.info('Test completed');
    });

    test("checkbox square click toggles exactly once without double-firing", {
        tag: ['@otable-select-cell', '@checkbox', '@singleFire', '@P1', '@all'],
    }, async () => {
        testLogger.info('Assert the first row is initially unselected');
        await pm.modelPricingPage.expectFirstRowCheckboxUnchecked();

        testLogger.info('Click the checkbox square to select the row');
        await pm.modelPricingPage.clickFirstRowCheckbox();
        await pm.modelPricingPage.expectFirstRowCheckboxChecked();

        testLogger.info('Click the checkbox square again to deselect the row');
        await pm.modelPricingPage.clickFirstRowCheckbox();
        await pm.modelPricingPage.expectFirstRowCheckboxUnchecked();

        testLogger.info('Test completed');
    });
});
