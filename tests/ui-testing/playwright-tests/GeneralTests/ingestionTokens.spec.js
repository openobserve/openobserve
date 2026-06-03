const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { isCloudEnvironment } = require('../utils/cloud-auth.js');

test.describe.configure({ mode: 'parallel' });

test.describe("Org-Level Ingestion Tokens", () => {
    test.skip(isCloudEnvironment(), 'Ingestion tokens tab not available on cloud UI');
    let pageManager;

    // -------------------------------------------------------------------
    // Page rendering
    // -------------------------------------------------------------------

    test("Ingestion Tokens tab renders with table and columns", {
        tag: ['@ingestion', '@tokens', '@ui', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pageManager = new PageManager(page);

        await pageManager.ingestionTokensPage.gotoIamPage();
        await pageManager.ingestionTokensPage.gotoIngestionTokensTab();
        await pageManager.ingestionTokensPage.verifyTitleVisible();

        // Verify Create Token button is visible
        await expect(pageManager.ingestionTokensPage.createTokenButton).toBeVisible();

        // Verify table renders — OTable with row-key renders rows in tbody
        const table = pageManager.ingestionTokensPage.tokenTable;
        await expect(table).toBeVisible({ timeout: 5000 });
        // At least one row in tbody (token rows)
        const rows = pageManager.ingestionTokensPage.tokenTableRows;
        await expect(rows.first()).toBeVisible({ timeout: 5000 });

        testLogger.info('Test completed successfully');
    });

    // -------------------------------------------------------------------
    // Create token — happy path
    // -------------------------------------------------------------------

    test("Create token via UI dialog with name and description", {
        tag: ['@ingestion', '@tokens', '@create', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        const uniqueName = `ui_test_${Date.now()}`;
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pageManager = new PageManager(page);

        await pageManager.ingestionTokensPage.gotoIamPage();
        await pageManager.ingestionTokensPage.gotoIngestionTokensTab();

        // Open create dialog
        await pageManager.ingestionTokensPage.clickCreateToken();

        // Fill form
        await pageManager.ingestionTokensPage.fillTokenName(uniqueName);
        await pageManager.ingestionTokensPage.fillTokenDescription('UI test token');

        // Create — primary button should be enabled now
        await pageManager.ingestionTokensPage.clickCreate();

        // Should see success toast
        await pageManager.ingestionTokensPage.verifySuccessMessage('Token created successfully.');

        // Revealed dialog should show the token
        const revealedCode = pageManager.ingestionTokensPage.revealedTokenCode;
        await expect(revealedCode).toBeVisible({ timeout: 5000 });
        const tokenText = await revealedCode.textContent();
        expect(tokenText).toMatch(/^o2oi_/);
        expect(tokenText.length).toBe(37);

        // Close revealed dialog
        await pageManager.ingestionTokensPage.closeRevealedDialog();

        // Verify token appears in the table
        await pageManager.ingestionTokensPage.verifyTokenExists(uniqueName);

        testLogger.info('Test completed successfully');
    });

    // -------------------------------------------------------------------
    // Create token — validation error
    // -------------------------------------------------------------------

    test("Create token with empty name shows validation error", {
        tag: ['@ingestion', '@tokens', '@validation', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pageManager = new PageManager(page);

        await pageManager.ingestionTokensPage.gotoIamPage();
        await pageManager.ingestionTokensPage.gotoIngestionTokensTab();
        await pageManager.ingestionTokensPage.clickCreateToken();

        // Primary button should be disabled when name is empty
        await expect(pageManager.ingestionTokensPage.dialogPrimaryBtn).toBeDisabled();

        // Typing a valid name should enable the button
        await pageManager.ingestionTokensPage.fillTokenName('valid-name');
        await expect(pageManager.ingestionTokensPage.dialogPrimaryBtn).toBeEnabled();

        // Clearing the name should disable the button again
        await pageManager.ingestionTokensPage.fillTokenName('');
        await expect(pageManager.ingestionTokensPage.dialogPrimaryBtn).toBeDisabled();

        // Cancel and close
        await pageManager.ingestionTokensPage.clickCancel();

        testLogger.info('Test completed successfully');
    });

    // -------------------------------------------------------------------
    // Revealed token dialog
    // -------------------------------------------------------------------

    test("Revealed token dialog — copy token", {
        tag: ['@ingestion', '@tokens', '@copy', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        const uniqueName = `copy_test_${Date.now()}`;
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pageManager = new PageManager(page);

        await pageManager.ingestionTokensPage.gotoIamPage();
        await pageManager.ingestionTokensPage.gotoIngestionTokensTab();
        await pageManager.ingestionTokensPage.clickCreateToken();
        await pageManager.ingestionTokensPage.fillTokenName(uniqueName);
        await pageManager.ingestionTokensPage.clickCreate();

        // Wait for revealed dialog
        const revealedCode = pageManager.ingestionTokensPage.revealedTokenCode;
        await expect(revealedCode).toBeVisible({ timeout: 5000 });
        const tokenText = await revealedCode.textContent();
        expect(tokenText).toMatch(/^o2oi_/);

        // Grant clipboard permissions and copy
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await pageManager.ingestionTokensPage.clickCopyToken();

        // Verify clipboard contains the token
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toBe(tokenText);

        // Close dialog
        await pageManager.ingestionTokensPage.closeRevealedDialog();

        testLogger.info('Test completed successfully');
    });

    // -------------------------------------------------------------------
    // Enable / Disable toggle
    // -------------------------------------------------------------------

    test("Toggle token enable/disable from table actions", {
        tag: ['@ingestion', '@tokens', '@toggle', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        const uniqueName = `toggle_test_${Date.now()}`;
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pageManager = new PageManager(page);

        // Create a token first via UI
        await pageManager.ingestionTokensPage.gotoIamPage();
        await pageManager.ingestionTokensPage.gotoIngestionTokensTab();
        await pageManager.ingestionTokensPage.clickCreateToken();
        await pageManager.ingestionTokensPage.fillTokenName(uniqueName);
        await pageManager.ingestionTokensPage.clickCreate();

        // Reload page to dismiss all dialogs cleanly (avoids overlay race conditions)
        await page.reload();
        await pageManager.ingestionTokensPage.titleHeading.waitFor({ state: 'visible', timeout: 10000 });

        // Disable the token
        await pageManager.ingestionTokensPage.toggleToken(uniqueName);
        await pageManager.ingestionTokensPage.verifySuccessMessage('Token disabled');

        // Re-enable the token
        await pageManager.ingestionTokensPage.toggleToken(uniqueName);
        await pageManager.ingestionTokensPage.verifySuccessMessage('Token enabled');

        testLogger.info('Test completed successfully');
    });

    // -------------------------------------------------------------------
    // Ingestion page — Manage Tokens button
    // -------------------------------------------------------------------

    test("Manage Tokens button on ingestion page navigates to IAM", {
        tag: ['@ingestion', '@tokens', '@navigation', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        pageManager = new PageManager(page);

        // Navigate to ingestion page
        await page.goto(`${process.env.ZO_BASE_URL}/web/ingestion?org_identifier=${process.env.ORGNAME || 'default'}`);
        await page.waitForLoadState('domcontentloaded');

        // Click "Manage Tokens" button
        await page.getByRole('button', { name: /Manage Tokens/i }).click();

        // Should navigate to IAM > Ingestion Tokens
        await expect(pageManager.ingestionTokensPage.titleHeading).toBeVisible({ timeout: 10000 });
        await expect(page).toHaveURL(/ingestionTokens/);

        testLogger.info('Test completed successfully');
    });

    // -------------------------------------------------------------------
    // Ingestion page — token selector dropdown
    // -------------------------------------------------------------------
    // TODO: The OSelect on the ingestion page uses reka-ui's PopoverTrigger
    // (a <button> with data-state), but clicking it does NOT open a listbox
    // dropdown. Likely root cause: orgTokens data is loaded async from the
    // store when navigating directly to /web/ingestion, and the popover may
    // not render the ListboxRoot when options are empty or still loading.
    // Need dev confirmation on whether:
    //   (a) the OSelect needs `data-test` attribute for reliable targeting, or
    //   (b) orgTokens must be preloaded/fetched before the popover can open.
    // test("Ingestion page token selector shows available tokens", ...)
});
