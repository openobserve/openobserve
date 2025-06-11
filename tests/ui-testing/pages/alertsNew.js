import { expect } from '@playwright/test';

export class AlertsNewPage {
    constructor(page) {
        this.page = page;
        
        // Alert related locators
        this.alertMenuItem = '[data-test="menu-link-\\/alerts-item"]';
        this.newFolderButton = '[data-test="dashboard-new-folder-btn"]';
        this.folderNameInput = '[data-test="dashboard-folder-add-name"]';
        this.folderDescriptionInput = '[data-test="dashboard-folder-add-description"]';
        this.folderSaveButton = '[data-test="dashboard-folder-add-save"]';
        this.folderCancelButton = '[data-test="dashboard-folder-add-cancel"]';
        this.noDataAvailableText = 'text=No data available';
        this.folderExistsError = 'text=Folder with this name already';

        // Alert creation locators
        this.addAlertButton = '[data-test="alert-list-add-alert-btn"]';
        this.alertNameInput = '[data-test="add-alert-name-input row"]';
        this.alertSubmitButton = '[data-test="add-alert-submit-btn"]';
        this.streamTypeDropdown = '[data-test="alerts-index-dropdown-stream_type"]';
        this.alertTypeDropdown = '[data-test="add-alert-stream-type-select-dropdown"]';
        this.streamNameDropdown = '[data-test="add-alert-stream-name-select-dropdown"]';
        this.realtimeAlertRadio = '[data-test="add-alert-realtime-alert-radio"]';
        this.alertDelayInput = '[data-test="add-alert-delay-input"]';
        this.destinationSelect = '[data-test="add-alert-destination-select"]';
        this.columnInput = '[placeholder="Column"]';
        this.operatorSelect = '[data-test="alert-conditions-operator-select"]';
        this.valueInput = '[placeholder="Value"]';

        // Alert management locators
        this.alertUpdateButton = '[data-test="alert-list-{alertName}-update-alert"]';
        this.alertCloneButton = '[data-test="alert-list-{alertName}-clone-alert"]';
        this.alertMoreOptions = '[data-test="alert-list-{alertName}-more-options"]';
        this.confirmButton = '[data-test="confirm-button"]';

        // Store the generated folder name
        this.currentFolderName = '';
    }

    generateRandomFolderName() {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = 'automationFolder_';
        for (let i = 0; i < 5; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        this.currentFolderName = result;
        return result;
    }

    getCurrentFolderName() {
        return this.currentFolderName;
    }

    /** @param {string} folderName @param {string} [description] */
    async createFolder(folderName, description = '') {
        await this.page.locator(this.newFolderButton).click();
        await this.page.locator(this.folderNameInput).click();
        await this.page.locator(this.folderNameInput).fill(folderName);
        
        if (description) {
            await this.page.locator(this.folderDescriptionInput).click();
            await this.page.locator(this.folderDescriptionInput).fill(description);
        }
        
        await this.page.locator(this.folderSaveButton).click();
    }

    /** @param {string} folderName */
    async verifyFolderCreated(folderName) {
        await expect(this.page.getByText(folderName)).toBeVisible();
    }

    /** @param {string} folderName */
    async clickFolder(folderName) {
        await this.page.getByText(folderName).click();
    }

    /** @param {string} folderName */
    async navigateToFolder(folderName) {
        await this.page.getByText(folderName).click();
        await this.page.waitForTimeout(2000); // Wait for folder content to load
    }

    async verifyNoDataAvailable() {
        await expect(this.page.locator(this.noDataAvailableText)).toBeVisible();
    }

    async verifyFolderExistsError() {
        await expect(this.page.locator(this.folderExistsError)).toBeVisible();
    }

    async cancelFolderCreation() {
        await this.page.locator(this.folderCancelButton).click();
    }

    /** @param {string} alertName @param {string} streamType @param {string} streamName @param {string} column @param {string} value */
    async createAlert(alertName, streamType, streamName, column, value) {
        await this.page.locator(this.addAlertButton).click();
        await this.page.locator(this.alertNameInput).fill(alertName);
        await this.page.locator(this.streamTypeDropdown).click();
        await this.page.getByText(streamType).click();
        await this.page.locator(this.alertTypeDropdown).click();
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.locator(this.streamNameDropdown).click();
        await this.page.getByRole('option', { name: streamName }).locator('span').click();
        await this.page.locator(this.realtimeAlertRadio).click();
        await this.page.locator(this.alertDelayInput).getByLabel('').fill('0');
        await this.page.locator(this.columnInput).click();
        await this.page.getByRole('option', { name: column }).click();
        await this.page.locator(this.operatorSelect).getByText('arrow_drop_down').click();
        await this.page.getByText('Contains', { exact: true }).click();
        await this.page.locator(this.valueInput).fill(value);
        await this.page.locator(this.alertSubmitButton).click();
        await expect(this.page.getByText('Alert saved successfully.')).toBeVisible();
    }

    /** @param {string} alertName */
    async verifyAlertCreated(alertName) {
        await expect(this.page.getByRole('cell', { name: alertName })).toBeVisible();
        await expect(this.page.locator(`[data-test="alert-list-${alertName}-pause-start-alert"]`)).toBeVisible();
    }

    /** @param {string} alertName @param {string} newOperator */
    async updateAlert(alertName, newOperator) {
        await this.page.locator(this.alertUpdateButton.replace('{alertName}', alertName)).click();
        await expect(this.page.getByText('Alert Setup')).toBeVisible();
        await this.page.locator(this.operatorSelect).getByText('arrow_drop_down').click();
        await this.page.getByRole('option', { name: newOperator, exact: true }).locator('div').nth(2).click();
        await this.page.locator(this.alertSubmitButton).click();
        await expect(this.page.getByText('Alert updated successfully.')).toBeVisible();
    }

    /** @param {string} alertName @param {string} streamType @param {string} streamName */
    async cloneAlert(alertName, streamType, streamName) {
        await this.page.locator(this.alertCloneButton.replace('{alertName}', alertName)).click();
        await expect(this.page.locator('[data-test="clone-alert-title"]')).toBeVisible();
        await this.page.locator('[data-test="to-be-clone-stream-type"]').click();
        await this.page.getByRole('option', { name: streamType }).locator('div').nth(2).click();
        await this.page.locator('[data-test="to-be-clone-stream-name"]').click();
        await this.page.getByRole('option', { name: streamName }).locator('span').click();
        await this.page.locator('[data-test="clone-alert-submit-btn"]').click();
        await expect(this.page.getByText('Alert Cloned Successfully')).toBeVisible();
    }

    /** @param {string} alertName */
    async deleteAlert(alertName) {
        await this.page.locator(this.alertMoreOptions.replace('{alertName}', alertName)).click();
        await this.page.getByText('Delete').click();
        await expect(this.page.getByText('Are you sure you want to')).toBeVisible();
        await this.page.locator(this.confirmButton).click();
        await expect(this.page.getByText('Alert deleted')).toBeVisible();
    }
} 