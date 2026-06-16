// Copyright 2026 OpenObserve Inc.

const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class StreamsFormValidationPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── Navigation ───────────────────────────────────────────────────────
        this.streamsMenuLink = '[data-test="menu-link-\\/streams-item"]';
        this.addStreamButton = '[data-test="log-stream-add-stream-btn"]';

        // ── Add Stream dialog ─────────────────────────────────────────────────
        // ODialog wrapper
        this.addStreamDialog = '[data-test="add-stream-dialog"]';

        // OInput: data-test="add-stream-name-input" → -field (native input) and -error
        this.nameField = '[data-test="add-stream-name-input-field"]';
        this.nameError = '[data-test="add-stream-name-input-error"]';

        // OSelect: data-test="add-stream-type-input" → -trigger (opens dropdown), -popover (content), -error
        this.typeTrigger = '[data-test="add-stream-type-input-trigger"]';
        this.typePopover = '[data-test="add-stream-type-input-popover"]';
        this.typeError   = '[data-test="add-stream-type-input-error"]';

        // Data retention wrapper div (conditionally rendered)
        this.dataRetentionWrapper = '[data-test="add-stream-data-retention-input"]';
        // OInput data-test="add-stream-data-retention" → -field (native input) and -error
        this.dataRetentionField = '[data-test="add-stream-data-retention-field"]';
        this.dataRetentionError = '[data-test="add-stream-data-retention-error"]';

        // ODialog built-in primary / secondary buttons scoped to dialog
        this.saveBtn   = '[data-test="add-stream-dialog"] [data-test="o-dialog-primary-btn"]';
        this.cancelBtn = '[data-test="add-stream-dialog"] [data-test="o-dialog-secondary-btn"]';

        // Toast selectors
        this.toastSuccess = '[data-test-variant="success"]';
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    async navigateToStreamsPage() {
        testLogger.info('Navigating to Streams explorer page');
        await this.page.locator(this.streamsMenuLink).click();
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async openAddStreamDialog() {
        testLogger.info('Opening Add Stream dialog');
        await this.page.locator(this.addStreamButton).click();
        await this.page.locator(this.addStreamDialog).waitFor({ state: 'visible', timeout: 10000 });
    }

    // ── Form interactions ─────────────────────────────────────────────────────

    async fillStreamName(name) {
        testLogger.info(`Filling stream name: "${name}"`);
        await this.page.locator(this.nameField).fill(name);
    }

    async clearStreamName() {
        testLogger.info('Clearing stream name field');
        await this.page.locator(this.nameField).fill('');
    }

    async selectStreamType(typeLabel) {
        testLogger.info(`Selecting stream type: "${typeLabel}"`);
        // Click the trigger to open the dropdown
        await this.page.locator(this.typeTrigger).click();
        // Wait for popover to open, then click the matching option
        await this.page.locator(this.typePopover).waitFor({ state: 'visible', timeout: 5000 });
        await this.page.getByRole('option', { name: typeLabel, exact: true }).click();
    }

    async fillDataRetention(value) {
        testLogger.info(`Filling data retention: ${value}`);
        // The retention field is conditionally rendered — wait for it before filling
        await this.page.locator(this.dataRetentionField).waitFor({ state: 'visible', timeout: 5000 });
        await this.page.locator(this.dataRetentionField).fill(String(value));
    }

    async clickSave() {
        testLogger.info('Clicking Save button');
        await this.page.locator(this.saveBtn).click();
    }

    async clickCancel() {
        testLogger.info('Clicking Cancel button');
        await this.page.locator(this.cancelBtn).click();
    }

    // ── StreamFieldInputs interactions ────────────────────────────────────────

    async clickAddFieldBtn() {
        testLogger.info('Clicking Add Field button');
        await this.page.locator('[data-test="add-stream-add-field-btn"]').first().click();
    }

    async fillFieldName(index, value) {
        testLogger.info(`Filling field name at index ${index}: "${value}"`);
        const row = this.page.locator(`[data-test="add-stream-field-row-${index}"]`);
        const input = row.locator('[data-test="add-stream-field-name-input"] input');
        await input.fill(value);
        await input.dispatchEvent('input');
    }

    async clickDeleteFieldBtn(index) {
        testLogger.info(`Clicking delete field button at row ${index}`);
        const row = this.page.locator(`[data-test="add-stream-field-row-${index}"]`);
        await row.locator('[data-test="add-stream-delete-field-btn"]').click();
    }

    getFieldRowLocator(index) {
        return this.page.locator(`[data-test="add-stream-field-row-${index}"]`);
    }

    getFieldNameErrorLocator(index) {
        // OInput has data-test="add-stream-field-name-input-{index}" → generates -error span
        return this.page.locator(`[data-test="add-stream-field-name-input-${index}-error"]`);
    }

    getFieldDataTypeErrorLocator(index) {
        const row = this.page.locator(`[data-test="add-stream-field-row-${index}"]`);
        // OSelect auto-generates ${parentDataTest}-error from data-test="add-stream-field-data-type-select"
        return row.locator('[data-test="add-stream-field-data-type-select-error"]');
    }

    // ── Assertions ────────────────────────────────────────────────────────────

    getDialogLocator() {
        return this.page.locator(this.addStreamDialog);
    }

    getNameErrorLocator() {
        return this.page.locator(this.nameError);
    }

    getTypeErrorLocator() {
        return this.page.locator(this.typeError);
    }

    getDataRetentionErrorLocator() {
        return this.page.locator(this.dataRetentionError);
    }

    getSaveBtnLocator() {
        return this.page.locator(this.saveBtn);
    }

    getCancelBtnLocator() {
        return this.page.locator(this.cancelBtn);
    }

    getDataRetentionWrapperLocator() {
        return this.page.locator(this.dataRetentionWrapper);
    }
}
