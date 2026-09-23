const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// Vehicle: IAM > Service Accounts — Model Pricing is Enterprise/Cloud-only and never renders on the OSS build this shard runs against.
const uniqueSaName = () => `sa${Date.now()}x${Math.floor(Math.random() * 10000)}`;

test.describe("OTable Select Cell Click Selection testcases", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;
    let email;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        const uniqueName = uniqueSaName();
        email = pm.iamPage.serviceAccountEmailFor(uniqueName);

        await pm.iamPage.gotoIamPage();
        await pm.iamPage.iamPageServiceAccountsTab();
        await pm.iamPage.iamPageAddServiceAccount();
        await pm.iamPage.enterNameServiceAccount(uniqueName);
        await pm.iamPage.clickSaveServiceAccount();
        await pm.iamPage.verifySuccessMessage('Service account created successfully.');
        await pm.iamPage.clickServiceAccountPopUpClosed();
        await pm.iamPage.reloadServiceAccountPage();
        await pm.iamPage.waitForSelectCell(email);
        testLogger.info('Test setup completed');
    });

    test.afterEach(async () => {
        // Best-effort: a failed cleanup delete shouldn't mask a test failure.
        try {
            await pm.iamPage.deletedServiceAccount(email);
            await pm.iamPage.requestServiceAccountOk();
        } catch {
            // Row may already be gone — nothing further to clean up.
        }
    });

    test("selects then deselects a row by clicking the select-cell padding", {
        tag: ['@otable-select-cell', '@selection', '@P0', '@all'],
    }, async () => {
        testLogger.info('Assert the row is initially unselected');
        await pm.iamPage.expectRowCheckboxUnchecked(email);
        await pm.iamPage.expectDeleteSelectedBtnHidden();

        testLogger.info('Click the select-cell padding to select the row');
        await pm.iamPage.clickSelectCellPadding(email);
        await pm.iamPage.expectRowCheckboxChecked(email);
        await pm.iamPage.expectDeleteSelectedBtnVisible();

        testLogger.info('Click the same padding again to deselect the row');
        await pm.iamPage.clickSelectCellPadding(email);
        await pm.iamPage.expectRowCheckboxUnchecked(email);
        await pm.iamPage.expectDeleteSelectedBtnHidden();

        testLogger.info('Test completed');
    });

    test("selects all then deselects all rows via the header select-cell padding", {
        tag: ['@otable-select-cell', '@selection', '@selectAll', '@P0', '@all'],
    }, async () => {
        testLogger.info('Assert no rows are selected before the header cell click');
        await pm.iamPage.expectSelectAllCheckboxUnchecked();
        await pm.iamPage.expectDeleteSelectedBtnHidden();

        testLogger.info('Click the header select-cell padding to select all rows');
        await pm.iamPage.clickSelectAllCellPadding();
        await pm.iamPage.expectSelectAllCheckboxChecked();
        await pm.iamPage.expectAllSelectableRowsSelected();
        await pm.iamPage.expectDeleteSelectedBtnVisible();

        testLogger.info('Click the header padding again to deselect all rows');
        await pm.iamPage.clickSelectAllCellPadding();
        await pm.iamPage.expectSelectAllCheckboxUnchecked();
        await pm.iamPage.expectDeleteSelectedBtnHidden();

        testLogger.info('Test completed');
    });

    test.fixme("checkbox square click toggles exactly once without double-firing — blocked by OCheckbox double-fire (label forwards a 2nd click to the button when the checkmark is clicked)", {
        tag: ['@otable-select-cell', '@checkbox', '@singleFire', '@P1', '@all'],
    }, async () => {
        testLogger.info('Assert the row is initially unselected');
        await pm.iamPage.expectRowCheckboxUnchecked(email);

        testLogger.info('Click the checkbox square to select the row');
        await pm.iamPage.clickCheckboxByEmail(email);
        await pm.iamPage.expectRowCheckboxChecked(email);

        testLogger.info('Click the checkbox square again to deselect the row');
        await pm.iamPage.clickCheckboxByEmail(email);
        await pm.iamPage.expectRowCheckboxUnchecked(email);

        testLogger.info('Test completed');
    });
});
