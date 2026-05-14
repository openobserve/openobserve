import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class CrossLinkPage {
    constructor(page) {
        this.page = page;

        // Navigation selectors
        this.streamsMenuItem = '[data-test="menu-link-\\/streams-item"]';
        this.streamSearchPlaceholder = 'Search Stream';
        this.streamDetailButton = 'Stream Detail';

        // CrossLinkManager selectors (VERIFIED from CrossLinkManager.vue)
        this.addCrossLinkBtn = '[data-test="add-cross-link-btn"]';
        this.crossLinkList = '[data-test="cross-link-list"]';
        this.crossLinkEmpty = '[data-test="cross-link-empty"]';

        // CrossLinkDialog selectors (VERIFIED from CrossLinkDialog.vue)
        // CrossLinkDialog is rendered via <ODialog data-test="cross-link-dialog" ...>.
        // After the ODialog migration the in-dialog Save/Cancel buttons were
        // removed and replaced by ODialog's built-in primary/secondary footer
        // buttons. Scope by the parent data-test to avoid matching other dialogs.
        this.crossLinkDialog = '[data-test="cross-link-dialog"]';
        this.crossLinkNameInput = '[data-test="cross-link-name-input"]';
        this.crossLinkUrlInput = '[data-test="cross-link-url-input"]';
        this.crossLinkFieldInput = '[data-test="cross-link-field-input"]';
        this.crossLinkAddFieldBtn = '[data-test="cross-link-add-field-btn"]';
        this.crossLinkCancelBtn = '[data-test="cross-link-dialog"] [data-test="o-dialog-secondary-btn"]';
        this.crossLinkSaveBtn = '[data-test="cross-link-dialog"] [data-test="o-dialog-primary-btn"]';
        this.crossLinkHelpBtn = '[data-test="cross-link-help-btn"]';

        // Schema update button
        this.schemaUpdateSettingsBtn = '[data-test="schema-update-settings-button"]';

        // Organization Settings page selectors
        this.settingsMenuItem = '[data-test="menu-link-settings-item"]';
        this.orgSettingsSaveBtn = '[data-test="add-alert-submit-btn"]';
    }

    // Dynamic selectors
    crossLinkItem(idx) {
        return `[data-test="cross-link-item-${idx}"]`;
    }

    crossLinkEditBtn(idx) {
        return `[data-test="cross-link-edit-${idx}"]`;
    }

    crossLinkDeleteBtn(idx) {
        return `[data-test="cross-link-delete-${idx}"]`;
    }

    crossLinkFieldChip(idx) {
        return `[data-test="cross-link-field-chip-${idx}"]`;
    }

    // Navigation methods
    async navigateToStreams() {
        testLogger.debug('Navigating to streams page via URL');
        const orgId = process.env["ORGNAME"] || 'default';
        await this.page.goto(`${process.env["ZO_BASE_URL"] || 'http://localhost:5080'}/web/streams?org_identifier=${orgId}`);
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await this.page.waitForTimeout(2000);
    }

    async searchStream(streamName) {
        testLogger.debug('Searching for stream', { streamName });
        const searchInput = this.page.getByPlaceholder(this.streamSearchPlaceholder);
        await searchInput.waitFor({ state: 'visible', timeout: 10000 });
        await searchInput.click();
        await searchInput.fill(streamName);
        await this.page.waitForTimeout(1500);
    }

    async openStreamDetail() {
        testLogger.debug('Opening stream details');
        const btn = this.page.getByRole('button', { name: this.streamDetailButton }).first();
        await btn.waitFor({ state: 'visible', timeout: 15000 });
        await btn.click();
        // Wait for the schema panel dialog to fully render with tabs
        await this.page.waitForTimeout(3000);
    }

    async isCrossLinkingTabVisible() {
        testLogger.debug('Checking if cross-linking tab is visible');
        const tab = this.page.locator('[data-test="schema-cross-linking-tab"]');
        try {
            await tab.waitFor({ state: 'visible', timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    async clickCrossLinkingTab() {
        testLogger.debug('Clicking cross-linking tab');
        const tab = this.page.locator('[data-test="schema-cross-linking-tab"]');
        await tab.waitFor({ state: 'visible', timeout: 10000 });
        await tab.click();
        // Wait for cross-link tab content to render
        await this.page.waitForTimeout(2000);
    }

    // CrossLinkManager methods
    async clickAddCrossLink() {
        testLogger.debug('Clicking add cross-link button');
        await this.page.locator(this.addCrossLinkBtn).click();
    }

    async expectEmptyState() {
        testLogger.debug('Expecting empty state');
        await expect(this.page.locator(this.crossLinkEmpty)).toBeVisible();
    }

    async expectCrossLinkListVisible() {
        testLogger.debug('Expecting cross-link list visible');
        await expect(this.page.locator(this.crossLinkList).first()).toBeVisible();
    }

    async expectCrossLinkItemVisible(idx) {
        await expect(this.page.locator(this.crossLinkItem(idx))).toBeVisible();
    }

    async clickEditCrossLink(idx) {
        testLogger.debug('Clicking edit cross-link', { idx });
        await this.page.locator(this.crossLinkEditBtn(idx)).click();
    }

    async clickDeleteCrossLink(idx) {
        testLogger.debug('Clicking delete cross-link', { idx });
        await this.page.locator(this.crossLinkDeleteBtn(idx)).click();
    }

    // CrossLinkDialog methods

    /**
     * Wait for the CrossLinkDialog to be fully visible and interactive.
     * Waits for the name input to appear, indicating the dialog has rendered.
     */
    async waitForDialog() {
        testLogger.debug('Waiting for cross-link dialog to render');
        await this.page.locator(this.crossLinkNameInput).waitFor({ state: 'visible', timeout: 15000 });
    }

    async fillCrossLinkName(name) {
        testLogger.debug('Filling cross-link name', { name });
        const input = this.page.locator(this.crossLinkNameInput);
        await input.click();
        await input.fill(name);
    }

    async fillCrossLinkUrl(url) {
        testLogger.debug('Filling cross-link URL', { url });
        const input = this.page.locator(this.crossLinkUrlInput);
        await input.click();
        await input.fill(url);
    }

    async fillFieldInput(fieldName) {
        testLogger.debug('Filling field input', { fieldName });
        const wrapper = this.page.locator(this.crossLinkFieldInput);
        await wrapper.waitFor({ state: 'visible', timeout: 10000 });
        // Field input can be q-select (data-test on wrapper) or q-input (data-test on input).
        // For q-select, we need to target the nested input; for q-input, wrapper IS the input.
        const tagName = await wrapper.evaluate(el => el.tagName.toLowerCase());
        if (tagName === 'input') {
            await wrapper.click();
            await wrapper.fill(fieldName);
        } else {
            const nestedInput = wrapper.locator('input');
            await nestedInput.click();
            await nestedInput.fill(fieldName);
        }
    }

    async clickAddFieldBtn() {
        testLogger.debug('Clicking add field button');
        await this.page.locator(this.crossLinkAddFieldBtn).click();
    }

    async addField(fieldName) {
        testLogger.debug('Adding field', { fieldName });
        await this.fillFieldInput(fieldName);
        // Press Enter on the actual input to add field
        const wrapper = this.page.locator(this.crossLinkFieldInput);
        const tagName = await wrapper.evaluate(el => el.tagName.toLowerCase());
        const input = tagName === 'input' ? wrapper : wrapper.locator('input');
        await input.press('Enter');
        await this.page.waitForTimeout(300);
    }

    async expectFieldChipVisible(idx) {
        await expect(this.page.locator(this.crossLinkFieldChip(idx))).toBeVisible();
    }

    async removeFieldChip(idx) {
        testLogger.debug('Removing field chip', { idx });
        await this.page.locator(this.crossLinkFieldChip(idx)).locator('.q-chip__icon--remove').last().click();
    }

    async clickSave() {
        testLogger.debug('Clicking save button');
        await this.page.locator(this.crossLinkSaveBtn).click();
    }

    async clickCancel() {
        testLogger.debug('Clicking cancel button');
        await this.page.locator(this.crossLinkCancelBtn).click();
    }

    async clickHelp() {
        testLogger.debug('Clicking help button');
        await this.page.locator(this.crossLinkHelpBtn).click();
    }

    async expectSaveDisabled() {
        testLogger.debug('Expecting save button disabled');
        await expect(this.page.locator(this.crossLinkSaveBtn)).toBeDisabled();
    }

    async expectSaveEnabled() {
        testLogger.debug('Expecting save button enabled');
        await expect(this.page.locator(this.crossLinkSaveBtn)).toBeEnabled();
    }

    async expectDialogVisible() {
        testLogger.debug('Expecting dialog visible');
        await this.waitForDialog();
    }

    async expectDialogNotVisible() {
        testLogger.debug('Expecting dialog not visible');
        await expect(this.page.locator(this.crossLinkDialog)).toBeHidden({ timeout: 5000 });
    }

    async clickUpdateSettings() {
        testLogger.debug('Clicking update settings button');
        await this.page.locator(this.schemaUpdateSettingsBtn).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // Composite workflows
    async navigateToStreamCrossLinkTab(streamName) {
        testLogger.debug('Navigating to stream cross-link tab', { streamName });
        await this.navigateToStreams();
        await this.searchStream(streamName);
        await this.openStreamDetail();
        await this.clickCrossLinkingTab();
    }

    async addCrossLink({ name, url, fields = [] }) {
        testLogger.debug('Adding complete cross-link', { name, url, fields });
        await this.clickAddCrossLink();
        await this.expectDialogVisible();
        await this.fillCrossLinkName(name);
        await this.fillCrossLinkUrl(url);
        for (const field of fields) {
            await this.addField(field);
        }
        await this.clickSave();
    }

    async getCrossLinkItemText(idx) {
        return await this.page.locator(this.crossLinkItem(idx)).textContent();
    }

    // Organization-level cross-link methods

    async navigateToOrgSettings() {
        testLogger.debug('Navigating to Organization Settings page via URL');
        const orgId = process.env["ORGNAME"] || 'default';
        await this.page.goto(`${process.env["ZO_BASE_URL"] || 'http://localhost:5080'}/web/settings/organization?org_identifier=${orgId}`);
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await this.page.waitForTimeout(3000);
        // Scroll to Cross-Linking Configuration section if it exists
        const addBtn = this.page.locator(this.addCrossLinkBtn);
        try {
            await addBtn.scrollIntoViewIfNeeded({ timeout: 5000 });
        } catch {
            // Button may not exist if feature is disabled
        }
    }

    async clickOrgSettingsSave() {
        testLogger.debug('Clicking org settings save button');
        await this.page.locator(this.orgSettingsSaveBtn).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
    }

    /**
     * Delete all existing cross-links on the current page (stream or org settings).
     * Only deletes items that have a visible delete button (i.e., editable items).
     * Org-level read-only items (which have no delete button) are skipped.
     */
    async deleteAllCrossLinks() {
        testLogger.debug('Deleting all existing cross-links');
        let count = await this.page.locator('[data-test^="cross-link-delete-"]').count();
        while (count > 0) {
            await this.clickDeleteCrossLink(0);
            await this.page.waitForTimeout(500);
            count = await this.page.locator('[data-test^="cross-link-delete-"]').count();
        }
        testLogger.debug('All deletable cross-links deleted', { remaining: count });
    }
}
