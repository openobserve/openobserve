
import { expect } from '@playwright/test';
import { getOrgIdentifier } from '../../playwright-tests/utils/cloud-auth.js';


export class PipelineDestinations {
    constructor(page) {
        this.page = page;

        this.pipelineDestinationsTabSelector = 'button[data-test="pipeline-destinations-tab"]';
        this.addBtn = '[data-test="pipeline-destination-list-add-btn"]';
        this.editorTitle = '[data-test="pipeline-destination-editor-title"]';
        this.nameField = '[data-test="add-destination-name-input-field"]';
        this.nameError = '[data-test="add-destination-name-input-error"]';
        this.urlField = '[data-test="add-destination-url-input-field"]';
        this.urlError = '[data-test="add-destination-url-input-error"]';
        this.urlEndpointField = '[data-test="add-destination-url-endpoint-input-field"]';
        this.methodSelect = '[data-test="add-destination-method-select"]';
        this.submitBtn = '[data-test="add-destination-submit-btn"]';
        this.step1ContinueBtn = '[data-test="step1-continue-btn"]';
        this.step1CancelBtn = '[data-test="step1-cancel-btn"]';
        this.addDestinationCancelBtn = '[data-test="add-destination-cancel-btn"]';
        this.bulkDeleteBtn = '[data-test="pipeline-destination-list-delete-destinations-btn"]';
        this.confirmDialogSelector = '[data-test="confirm-dialog"]';
        this.confirmDialogPrimaryBtn = '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]';
        this.toastSuccess = '[data-test-variant="success"]';
    }

    async navigateToManagement() {

        // Wait for the settings menu link to be visible before clicking
        await this.page.locator('[data-test="menu-link-/settings-item"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="menu-link-/settings-item"]').click();
    }

    async navigateToPipelineDestinations() {
        // Wait for the pipeline destinations tab to be visible
        await this.page.locator(this.pipelineDestinationsTabSelector).waitFor({ state: 'visible' });   
        // Click the pipeline destinations tab
        await this.page.locator(this.pipelineDestinationsTabSelector).click();      
    }

    async addDestination(name, url) {
        await this.page.locator('[data-test="pipeline-destination-list-add-btn"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="pipeline-destination-list-add-btn"]').click();
        await this.page.locator('[data-test="destination-type-card-openobserve"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="destination-type-card-openobserve"]').click();
        await this.page.locator('[data-test="step1-continue-btn"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="step1-continue-btn"]').click();
        // OFormInput wraps OInput; inner native <input> has -field suffix. Use attached + force.
        const nameField = this.page.locator('[data-test="add-destination-name-input-field"]');
        await nameField.waitFor({ state: 'attached', timeout: 10000 });
        await nameField.fill(name, { force: true });
        const urlField = this.page.locator('[data-test="add-destination-url-input-field"]');
        await urlField.waitFor({ state: 'attached', timeout: 10000 });
        await urlField.fill(url, { force: true });
        await this.page.locator('[data-test="add-destination-submit-btn"]').waitFor({ state: 'visible' });
        await this.page.locator('[data-test="add-destination-submit-btn"]').click();
    }

    async verifyDestinationAdded() {
        await expect(this.page.locator('[data-test="pipeline-destination-list-add-btn"]')).toBeVisible();
    }

    async navigateToPipelineDestinationsByUrl() {
        const baseUrl = process.env['ZO_BASE_URL'];
        await this.page.goto(`${baseUrl}/web/settings/pipeline_destinations?org_identifier=${getOrgIdentifier()}`);
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async navigateToAddDestination() {
        const baseUrl = process.env['ZO_BASE_URL'];
        await this.page.goto(`${baseUrl}/web/settings/pipeline_destinations?action=add&org_identifier=${getOrgIdentifier()}`);
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async navigateToUpdateDestination(name) {
        const baseUrl = process.env['ZO_BASE_URL'];
        await this.page.goto(`${baseUrl}/web/settings/pipeline_destinations?action=update&name=${encodeURIComponent(name)}&org_identifier=${getOrgIdentifier()}`);
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    async expectEditorOpen(title) {
        const titleLocator = this.page.locator(this.editorTitle);
        await expect(titleLocator).toBeVisible({ timeout: 15000 });
        if (title) {
            await expect(titleLocator).toContainText(title);
        }
    }

    async expectEditorTitleHidden() {
        await expect(this.page.locator(this.editorTitle)).toBeHidden();
    }

    async expectAddBtnVisible() {
        await expect(this.page.locator(this.addBtn)).toBeVisible();
    }

    async selectDestinationType(type) {
        const card = this.page.locator(`[data-test="destination-type-card-${type}"]`);
        await card.waitFor({ state: 'visible' });
        await card.click();
    }

    async clickStep1Continue() {
        await this.page.locator(this.step1ContinueBtn).click();
    }

    async clickStep1Cancel() {
        await this.page.locator(this.step1CancelBtn).click();
    }

    async clickCancel() {
        await this.page.locator(this.addDestinationCancelBtn).click();
    }

    async clickSubmit() {
        await this.page.locator(this.submitBtn).click();
    }

    async expectNameFieldDisabled() {
        await expect(this.page.locator(this.nameField)).toBeDisabled();
    }

    async expectNameFieldVisible() {
        await expect(this.page.locator(this.nameField)).toBeVisible();
    }

    async fillName(name) {
        const field = this.page.locator(this.nameField);
        await field.waitFor({ state: 'attached', timeout: 10000 });
        await field.fill(name, { force: true });
    }

    async fillUrl(url) {
        const field = this.page.locator(this.urlField);
        await field.waitFor({ state: 'attached', timeout: 10000 });
        await field.fill(url, { force: true });
    }

    async expectUrlFieldValue(value) {
        await expect(this.page.locator(this.urlField)).toHaveValue(value);
    }

    async expectNameErrorVisible() {
        await expect(this.page.locator(this.nameError)).toBeVisible();
    }

    async expectUrlErrorVisible() {
        await expect(this.page.locator(this.urlError)).toBeVisible();
    }

    async expectUrlErrorContaining(text) {
        await expect(this.page.locator(this.urlError)).toContainText(text);
    }

    async expectMethodSelectVisible() {
        await expect(this.page.locator(this.methodSelect)).toBeVisible();
    }

    async expectEndpointFieldEnabled() {
        await expect(this.page.locator(this.urlEndpointField)).toBeEnabled();
    }

    async expectRowInList(name) {
        await expect(this.page.locator(`[data-test="alert-destination-list-${name}-update-destination"]`)).toBeVisible({ timeout: 15000 });
    }

    async expectRowNotInList(name) {
        await expect(this.page.locator(`[data-test="alert-destination-list-${name}-update-destination"]`)).toBeHidden();
    }

    async clickRowEdit(name) {
        await this.page.locator(`[data-test="alert-destination-list-${name}-update-destination"]`).click();
    }

    async clickRowDelete(name) {
        await this.page.locator(`[data-test="alert-destination-list-${name}-delete-destination"]`).click();
    }

    async confirmDialog() {
        await expect(this.page.locator(this.confirmDialogSelector)).toBeVisible();
        await this.page.locator(this.confirmDialogPrimaryBtn).first().click();
    }

    async selectRowCheckbox(name) {
        const row = this.page.locator('tr[data-test^="o2-table-row-"]').filter({ hasText: name });
        await row.locator('[data-test="o2-table-select-cell"] button[role="checkbox"]').click();
    }

    async expectBulkDeleteBtnVisible() {
        await expect(this.page.locator(this.bulkDeleteBtn)).toBeVisible();
    }

    async clickBulkDelete() {
        await this.page.locator(this.bulkDeleteBtn).click();
    }

    async expectToast(text) {
        await expect(this.page.locator(this.toastSuccess).filter({ hasText: text })).toBeVisible({ timeout: 10000 });
    }

}