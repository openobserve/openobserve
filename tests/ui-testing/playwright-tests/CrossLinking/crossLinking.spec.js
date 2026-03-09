const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logsdata = require("../../../test-data/logs_data.json");

const STREAM_NAME = "e2e_automate";

async function ingestTestData(page) {
    const orgId = process.env["ORGNAME"];
    const basicAuthCredentials = Buffer.from(
        `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
    ).toString('base64');

    const headers = {
        "Authorization": `Basic ${basicAuthCredentials}`,
        "Content-Type": "application/json",
    };
    await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
        const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(logsdata)
        });
        return await fetchResponse.json();
    }, {
        url: process.env.INGESTION_URL,
        headers: headers,
        orgId: orgId,
        streamName: STREAM_NAME,
        logsdata: logsdata
    });
}

test.describe("Cross-Linking testcases", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForTimeout(1000);
        testLogger.info('Test setup completed');
    });

    test.afterEach(async ({}, testInfo) => {
        if (testInfo.status) {
            testLogger.testEnd(testInfo.title, testInfo.status, testInfo.duration);
        }
    });

    // P0 Tests - Critical
    test("should display cross-linking tab in stream schema when feature is enabled", {
        tag: ['@crossLinking', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cross-linking tab visibility in stream schema');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        // Verify the cross-linking tab is present (only when feature flag is enabled)
        const crossLinkTab = page.locator('.q-tab').filter({ hasText: /cross.link/i });
        const isVisible = await crossLinkTab.isVisible().catch(() => false);

        if (isVisible) {
            await pm.crossLinkPage.clickCrossLinkingTab();
            // Should show empty state initially or existing links
            const emptyState = page.locator('[data-test="cross-link-empty"]');
            const linkList = page.locator('[data-test="cross-link-list"]');
            const hasEmpty = await emptyState.isVisible().catch(() => false);
            const hasList = await linkList.isVisible().catch(() => false);
            expect(hasEmpty || hasList).toBe(true);
            testLogger.info('Cross-linking tab is visible and accessible');
        } else {
            testLogger.info('Cross-linking tab not visible - feature flag may be disabled, skipping gracefully');
        }

        testLogger.info('Test completed');
    });

    test("should show empty state when no cross-links are configured", {
        tag: ['@crossLinking', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing empty state display');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const crossLinkTab = page.locator('.q-tab').filter({ hasText: /cross.link/i });
        const isTabVisible = await crossLinkTab.isVisible().catch(() => false);
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // If no cross-links exist, verify empty state
        const emptyState = page.locator('[data-test="cross-link-empty"]');
        const linkList = page.locator('[data-test="cross-link-list"]');
        const hasEmpty = await emptyState.isVisible().catch(() => false);
        const hasList = await linkList.isVisible().catch(() => false);

        if (hasEmpty) {
            await pm.crossLinkPage.expectEmptyState();
            testLogger.info('Empty state verified');
        } else if (hasList) {
            testLogger.info('Cross-links already exist, empty state test not applicable');
        }

        testLogger.info('Test completed');
    });

    test("should open add cross-link dialog", {
        tag: ['@crossLinking', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing add cross-link dialog opens');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const crossLinkTab = page.locator('.q-tab').filter({ hasText: /cross.link/i });
        const isTabVisible = await crossLinkTab.isVisible().catch(() => false);
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Verify all dialog fields are present
        await expect(page.locator('[data-test="cross-link-name-input"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-url-input"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-field-input"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-save-btn"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-cancel-btn"]')).toBeVisible();

        testLogger.info('Test completed');
    });

    test("should add a new cross-link via stream schema", {
        tag: ['@crossLinking', '@functional', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing adding a new cross-link');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const crossLinkTab = page.locator('.q-tab').filter({ hasText: /cross.link/i });
        const isTabVisible = await crossLinkTab.isVisible().catch(() => false);
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Add a new cross-link
        const linkName = `E2E Test Link ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: linkName,
            url: 'https://example.com/trace/${field.__value}?from=${start_time}&to=${end_time}',
            fields: ['kubernetes_container_name']
        });

        // Verify the link appears in the list
        await pm.crossLinkPage.expectCrossLinkListVisible();
        const itemText = await pm.crossLinkPage.getCrossLinkItemText(0);
        expect(itemText).toContain(linkName);

        testLogger.info('Cross-link added successfully');
    });

    // P1 Tests - Functional
    test("should validate required fields - save button disabled without name and URL", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing save button disabled state');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const crossLinkTab = page.locator('.q-tab').filter({ hasText: /cross.link/i });
        const isTabVisible = await crossLinkTab.isVisible().catch(() => false);
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Save should be disabled when form is empty
        await pm.crossLinkPage.expectSaveDisabled();

        // Fill only name - save should still be disabled
        await pm.crossLinkPage.fillCrossLinkName('Test Link');
        await pm.crossLinkPage.expectSaveDisabled();

        // Fill URL too - save should now be enabled
        await pm.crossLinkPage.fillCrossLinkUrl('https://example.com/${field.__value}');
        await pm.crossLinkPage.expectSaveEnabled();

        testLogger.info('Test completed');
    });

    test("should add and remove field chips", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing field chip add and remove');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const crossLinkTab = page.locator('.q-tab').filter({ hasText: /cross.link/i });
        const isTabVisible = await crossLinkTab.isVisible().catch(() => false);
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Add a field
        await pm.crossLinkPage.addField('trace_id');
        await pm.crossLinkPage.expectFieldChipVisible(0);

        // Add another field
        await pm.crossLinkPage.addField('span_id');
        await pm.crossLinkPage.expectFieldChipVisible(1);

        // Remove first field chip
        await pm.crossLinkPage.removeFieldChip(0);

        // The second chip should now be at index 0
        await pm.crossLinkPage.expectFieldChipVisible(0);

        testLogger.info('Test completed');
    });

    test("should open help/user guide dialog", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing help button');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const crossLinkTab = page.locator('.q-tab').filter({ hasText: /cross.link/i });
        const isTabVisible = await crossLinkTab.isVisible().catch(() => false);
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Click help button
        await pm.crossLinkPage.clickHelp();

        // Verify user guide content appears (CrossLinkUserGuide renders help popup)
        const guideContent = page.locator('.q-menu, .q-popup-proxy').filter({ hasText: /template|variable|\$\{/i });
        await expect(guideContent.first()).toBeVisible({ timeout: 5000 });

        testLogger.info('Test completed');
    });

    test("should edit an existing cross-link", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing edit cross-link');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const crossLinkTab = page.locator('.q-tab').filter({ hasText: /cross.link/i });
        const isTabVisible = await crossLinkTab.isVisible().catch(() => false);
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Check if there's an existing link to edit
        const linkList = page.locator('[data-test="cross-link-list"]');
        const hasList = await linkList.isVisible().catch(() => false);

        if (!hasList) {
            // Create one first
            const linkName = `Edit Test ${Date.now()}`;
            await pm.crossLinkPage.addCrossLink({
                name: linkName,
                url: 'https://example.com/${field.__value}',
                fields: ['kubernetes_container_name']
            });
        }

        // Click edit on first link
        await pm.crossLinkPage.clickEditCrossLink(0);
        await pm.crossLinkPage.expectDialogVisible();

        // Verify form is populated (name input should have a value)
        const nameInput = page.locator('[data-test="cross-link-name-input"] input');
        const nameValue = await nameInput.inputValue();
        expect(nameValue.length).toBeGreaterThan(0);

        // Modify the URL
        await pm.crossLinkPage.fillCrossLinkUrl('https://updated.example.com/${field.__value}');
        await pm.crossLinkPage.clickSave();

        // Verify the update is reflected
        const itemText = await pm.crossLinkPage.getCrossLinkItemText(0);
        expect(itemText).toContain('updated.example.com');

        testLogger.info('Test completed');
    });

    test("should delete a cross-link", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing delete cross-link');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const crossLinkTab = page.locator('.q-tab').filter({ hasText: /cross.link/i });
        const isTabVisible = await crossLinkTab.isVisible().catch(() => false);
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Create a link to delete if none exist
        const linkList = page.locator('[data-test="cross-link-list"]');
        const hasList = await linkList.isVisible().catch(() => false);

        if (!hasList) {
            await pm.crossLinkPage.addCrossLink({
                name: `Delete Test ${Date.now()}`,
                url: 'https://delete.example.com/${field.__value}',
                fields: ['kubernetes_container_name']
            });
        }

        // Count links before delete
        const itemsBefore = await page.locator('[data-test^="cross-link-item-"]').count();
        expect(itemsBefore).toBeGreaterThan(0);

        // Delete first link
        await pm.crossLinkPage.clickDeleteCrossLink(0);

        // Verify count decreased
        const itemsAfter = await page.locator('[data-test^="cross-link-item-"]').count();
        expect(itemsAfter).toBe(itemsBefore - 1);

        testLogger.info('Test completed');
    });

    // P2 Tests - Edge Cases
    test("should cancel dialog without saving changes", {
        tag: ['@crossLinking', '@edgeCase', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cancel dialog discards changes');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const crossLinkTab = page.locator('.q-tab').filter({ hasText: /cross.link/i });
        const isTabVisible = await crossLinkTab.isVisible().catch(() => false);
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Count links before
        const itemsBefore = await page.locator('[data-test^="cross-link-item-"]').count();

        // Open dialog, fill form, cancel
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();
        await pm.crossLinkPage.fillCrossLinkName('Cancelled Link');
        await pm.crossLinkPage.fillCrossLinkUrl('https://cancelled.example.com');
        await pm.crossLinkPage.clickCancel();

        // Verify dialog closed
        await pm.crossLinkPage.expectDialogNotVisible();

        // Verify no new link was added
        const itemsAfter = await page.locator('[data-test^="cross-link-item-"]').count();
        expect(itemsAfter).toBe(itemsBefore);

        testLogger.info('Test completed');
    });

    test("should reset form when reopening dialog after cancel", {
        tag: ['@crossLinking', '@edgeCase', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing form reset on dialog reopen');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const crossLinkTab = page.locator('.q-tab').filter({ hasText: /cross.link/i });
        const isTabVisible = await crossLinkTab.isVisible().catch(() => false);
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Open dialog, fill form, cancel
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();
        await pm.crossLinkPage.fillCrossLinkName('Should Be Cleared');
        await pm.crossLinkPage.fillCrossLinkUrl('https://shouldbecleared.example.com');
        await pm.crossLinkPage.clickCancel();
        await pm.crossLinkPage.expectDialogNotVisible();

        // Reopen dialog
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Verify form is empty
        const nameInput = page.locator('[data-test="cross-link-name-input"] input');
        const urlInput = page.locator('[data-test="cross-link-url-input"] input');
        const nameValue = await nameInput.inputValue();
        const urlValue = await urlInput.inputValue();
        expect(nameValue).toBe('');
        expect(urlValue).toBe('');

        testLogger.info('Test completed');
    });
});
