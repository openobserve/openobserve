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
        this.noDataAvailableText = 'No data available';
        this.folderExistsError = 'Folder with this name already exists in this organization';
        this.folderMoreOptionsButton = '//span[contains(text(),"{folderName}")]/../div/button/span[2]/i';
        this.deleteFolderOption = 'Delete';
        this.deleteFolderConfirmText = 'Delete Folder';
        this.folderDeletedMessage = 'Folder deleted successfully.';

        // Alert creation locators
        this.addAlertButton = '[data-test="alert-list-add-alert-btn"]';
        this.alertNameInput = '[data-test="add-alert-name-input row"]';
        this.alertSubmitButton = '[data-test="add-alert-submit-btn"]';
        this.streamTypeDropdown = '[data-test="add-alert-stream-type-select-dropdown"]';
        this.streamNameDropdown = '[data-test="add-alert-stream-name-select-dropdown"]';
        this.realtimeAlertRadio = '[data-test="add-alert-realtime-alert-radio"]';
        this.alertDelayInput = '[data-test="add-alert-delay-input"]';
        this.destinationSelect = '[data-test="add-alert-destination-select"]';
        this.columnInput = '[placeholder="Column"]';
        this.operatorSelect = '[data-test="alert-conditions-operator-select"]';
        this.valueInput = '[placeholder="Value"]';
        this.alertSuccessMessage = 'Alert saved successfully.';
        this.alertUpdatedMessage = 'Alert updated successfully.';
        this.alertClonedMessage = 'Alert Cloned Successfully';
        this.alertDeletedMessage = 'Alert deleted';
        this.alertSetupText = 'Alert Setup';
        this.deleteConfirmText = 'Are you sure you want to delete this alert?';
        this.deleteButtonText = 'Delete';
        this.containsOperatorText = 'Contains';
        this.arrowDropDownText = 'arrow_drop_down';
        this.cloneAlertTitle = '[data-test="clone-alert-title"]';
        this.cloneStreamType = '[data-test="to-be-clone-stream-type"]';
        this.cloneStreamName = '[data-test="to-be-clone-stream-name"]';
        this.cloneSubmitButton = '[data-test="clone-alert-submit-btn"]';
        this.pauseStartAlert = '[data-test="alert-list-{alertName}-pause-start-alert"]';

        // Alert management locators
        this.alertUpdateButton = '[data-test="alert-list-{alertName}-update-alert"]';
        this.alertCloneButton = '[data-test="alert-list-{alertName}-clone-alert"]';
        this.alertMoreOptions = '[data-test="alert-list-{alertName}-more-options"]';
        this.confirmButton = '[data-test="confirm-button"]';

        // Alert movement locators
        this.selectAllCheckbox = '[data-test="alert-list-select-all-checkbox"]';
        this.moveAcrossFoldersButton = '[data-test="alert-list-move-across-folders-btn"]';
        this.folderDropdown = '[data-test="alerts-index-dropdown-stream_type"]';
        this.moveButton = '[data-test="alerts-folder-move"]';
        this.alertsMovedMessage = 'alerts Moved successfully';

        // Alert search and deletion locators
        this.alertSearchInput = '[data-test="alert-list-search-input"]';
        this.alertDeleteOption = 'Delete';
        this.alertDeletedMessage = 'Alert deleted';

        // Store the generated folder name and alert name
        this.currentFolderName = '';
        this.currentAlertName = '';
    }

    generateRandomString() {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 5; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    }

    generateFolderName() {
        return 'auto_' + this.generateRandomString();
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

    /**
     * Navigate to a specific folder
     * @param {string} folderName - Name of the folder to navigate to
     */
    async navigateToFolder(folderName) {
        await this.page.getByText(folderName).click();
        await this.page.waitForTimeout(2000); // Wait for folder content to load
    }

    async verifyNoDataAvailable() {
        await expect(this.page.getByText('No data available')).toBeVisible();
    }

    async verifyFolderExistsError() {
        await expect(this.page.getByText(this.folderExistsError)).toBeVisible();
    }

    async cancelFolderCreation() {
        await this.page.locator(this.folderCancelButton).click();
    }

    /** @param {string} streamName @param {string} column @param {string} value @param {string} destinationName @param {string} randomValue */
    async createAlert(streamName, column, value, destinationName, randomValue) {
        const randomAlertName = 'Automation_Alert_' + randomValue;
        this.currentAlertName = randomAlertName;  // Store the alert name
        console.log('Created alert:', randomAlertName);

        await this.page.locator(this.addAlertButton).click();
        await this.page.waitForTimeout(1000); // Wait for alert creation form to load

        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill(randomAlertName);
        await this.page.waitForTimeout(1000); // Wait after filling alert name

        await this.page.locator(this.streamTypeDropdown).click();
        await this.page.waitForTimeout(2000); // Wait for stream type options to load
        await this.page.getByRole('option', { name: 'logs' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000); // Wait after selecting stream type

        await this.page.locator(this.streamNameDropdown).click();
        await this.page.waitForTimeout(2000); // Wait for stream name options to load
        await this.page.getByText(`${streamName}`, { exact: true }).click();
        await this.page.waitForTimeout(1000); // Wait after selecting stream name

        await this.page.locator(this.realtimeAlertRadio).click();
        await this.page.waitForTimeout(1000); // Wait after selecting realtime alert

        await this.page.locator(this.alertDelayInput).click();
        await this.page.locator(this.alertDelayInput).getByLabel('').fill('0');
        await this.page.waitForTimeout(1000); // Wait after setting delay

        await this.page.locator('[data-test="add-alert-destination-select"]').getByLabel('arrow_drop_down').click();
        await this.page.waitForTimeout(2000); // Wait for destination options to load
        await this.page.getByText(destinationName, { exact: true }).click();
        await this.page.waitForTimeout(1000); // Wait after selecting destination

        await this.page.locator(this.columnInput).click();
        await this.page.waitForTimeout(2000); // Wait for column options to load
        await this.page.waitForSelector(`[role="option"]:has-text("${column}")`);
        await this.page.getByRole('option', { name: column }).click();
        await this.page.waitForTimeout(1000); // Wait after selecting column

        await this.page.locator('[data-test="alert-conditions-operator-select"] div').filter({ hasText: '>' }).nth(3).click();
        await this.page.getByText('Contains', { exact: true }).click();
        await this.page.getByPlaceholder('Value').fill('test');

        await this.page.locator(this.valueInput).fill(value);
        await this.page.waitForTimeout(1000); // Wait after filling value

        await this.page.locator(this.alertSubmitButton).click();
        await expect(this.page.getByText(this.alertSuccessMessage)).toBeVisible();

        return randomAlertName;
    }

    /** @param {string} alertName */
    async verifyAlertCreated(alertName) {
        const nameToVerify = alertName || this.currentAlertName;  // Use provided name or stored name
        await expect(this.page.getByRole('cell', { name: nameToVerify })).toBeVisible();
        await expect(this.page.locator(this.pauseStartAlert.replace('{alertName}', nameToVerify))).toBeVisible();
    }

    /** @param {string} alertName @param {string} newOperator */
    async updateAlert(alertName, newOperator) {
        await this.page.locator(this.alertUpdateButton.replace('{alertName}', alertName)).click();
        await expect(this.page.getByText(this.alertSetupText)).toBeVisible();
        await this.page.locator(this.operatorSelect).getByText(this.arrowDropDownText).click();
        await this.page.getByRole('option', { name: newOperator, exact: true }).locator('div').nth(2).click();
        await this.page.locator(this.alertSubmitButton).click();
        await expect(this.page.getByText(this.alertUpdatedMessage)).toBeVisible();
    }

    /** @param {string} alertName @param {string} streamType @param {string} streamName */
    async cloneAlert(alertName, streamType, streamName) {
        await this.page.locator(this.alertCloneButton.replace('{alertName}', alertName)).click();
        await expect(this.page.locator(this.cloneAlertTitle)).toBeVisible();
        await this.page.locator(this.cloneStreamType).click();
        await this.page.waitForTimeout(2000); // Wait for stream type options to load
        await this.page.getByRole('option', { name: streamType }).locator('div').nth(2).click();
        await this.page.locator(this.cloneStreamName).click();
        await this.page.getByText(streamName, { exact: true }).click();
        await this.page.locator(this.cloneSubmitButton).click();
        await expect(this.page.getByText(this.alertClonedMessage)).toBeVisible();
    }

    async ensureFolderExists(folderName, description = '') {
        try {
            await this.page.getByText(folderName).waitFor({ timeout: 2000 });
            console.log('Folder exists:', folderName);
            return true;
        } catch (error) {
            await this.createFolder(folderName, description);
            console.log('Created folder:', folderName);
            return false;
        }
    }

    async moveAllAlertsToFolder(targetFolderName) {
        // Select all alerts
        await this.page.getByRole('row', { name: '# Name Owner Period Frequency' }).getByRole('checkbox').click();
        await expect(this.page.getByText('Showing 1 - 2 of').nth(1)).toBeVisible();

        // Click move across folders button
        await this.page.locator(this.moveAcrossFoldersButton).click();

        // Select target folder
        await this.page.locator(this.folderDropdown).click();
        await this.page.getByRole('option', { name: targetFolderName }).locator('span').click();

        // Click move button and verify
        await this.page.locator(this.moveButton).click();
        await expect(this.page.getByText(this.alertsMovedMessage)).toBeVisible();
        await expect(this.page.getByText(this.noDataAvailableText)).toBeVisible();
        
        console.log('Successfully moved alerts to folder:', targetFolderName);
    }

    async deleteFolder(folderName) {
        // 1. Hover on the folder row to trigger the menu to appear
        const folderRow = this.page.locator(`div.folder-item:has-text("${folderName}")`);
        await folderRow.hover();
        await this.page.waitForTimeout(500); // Give time for hover effect to apply

        // 2. Wait for the 3-dot button to appear
        const dotButton = this.page.locator(`div.folder-item:has-text("${folderName}") button.q-btn`);
        await dotButton.waitFor({ state: 'visible', timeout: 3000 });

        // 3. Optional: Verify Playwright thinks it's visible and enabled
        console.log('Button visible:', await dotButton.isVisible());
        console.log('Button enabled:', await dotButton.isEnabled());

        // 4. Force click the button
        await dotButton.click({ force: true });

        // Verify the click worked by checking for Delete option
        await expect(this.page.getByText(this.deleteFolderOption)).toBeVisible({ timeout: 3000 });

        // Continue with the rest of the deletion process
        await this.page.getByText(this.deleteFolderOption).click();
        await expect(this.page.getByText(this.deleteFolderConfirmText)).toBeVisible();
        await this.page.locator(this.confirmButton).click();
        await expect(this.page.getByText(this.folderDeletedMessage)).toBeVisible();

        console.log('Successfully deleted folder:', folderName);
    }

    /**
     * Pauses an alert
     * @param {string} alertName - Name of the alert to pause
     */
    async pauseAlert(alertName) {
        await this.page.getByRole('row', { name: `01 ${alertName}` })
            .locator(`[data-test="alert-list-${alertName}-pause-start-alert"]`)
            .click();
        await this.page.getByRole('button', { name: 'start' }).click();
        await expect(this.page.getByText('Alert Paused Successfully')).toBeVisible();
    }

    /**
     * Resumes an alert
     * @param {string} alertName - Name of the alert to resume
     */
    async resumeAlert(alertName) {
        await this.page.getByRole('row', { name: `01 ${alertName}` })
            .locator(`[data-test="alert-list-${alertName}-pause-start-alert"]`)
            .click();
        await this.page.getByRole('button', { name: 'start' }).click();
        await expect(this.page.getByText('Alert Resumed Successfully')).toBeVisible();
    }

    /**
     * Delete alert by name
     * @param {string} alertName - Name of the alert to delete
     */
    async deleteAlertByRow(alertName) {
        const kebabButton = this.page.locator(`//button[@data-test='alert-list-${alertName}-more-options']`).first();
        await kebabButton.click();
        await this.page.waitForTimeout(1000);
        await this.page.getByText('Delete', { exact: true }).click();
        await this.page.locator(this.confirmButton).click();
        await expect(this.page.getByText(this.alertDeletedMessage)).toBeVisible();
        await this.page.waitForTimeout(1000);
    }

    /**
     * Search for alerts by name
     * @param {string} alertName - Name of the alert to search for
     */
    async searchAlert(alertName) {
        await this.page.locator(this.alertSearchInput).click();
        await this.page.locator(this.alertSearchInput).fill('');  // Clear the input first
        await this.page.locator(this.alertSearchInput).fill(alertName.toLowerCase());
        await this.page.waitForTimeout(1000);
    }

    /**
     * Verify search results count
     * @param {number} expectedCount - Expected number of results
     */
    async verifySearchResults(expectedCount) {
        const resultText = expectedCount === 1 ? 'Showing 1 - 1 of' : 'Showing 1 - 2 of';
        await expect(this.page.getByText(resultText).nth(1)).toBeVisible();
    }
} 